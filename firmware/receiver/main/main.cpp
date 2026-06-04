// ESP32-C6 receiver: ESP-NOW START/STOP control + three-port runtime effects.
// STOP: stop current effect and turn all LEDs off.
// START: resume the currently configured runtime effect. Duplicate START/STOP commands are ignored.
// FXSET|...: update the active effect profile used when START is running.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_now.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "nvs_flash.h"

#include "default_effect.h"
#include "identify_effect.h"
#include "led_ports.h"

static const char *TAG = "MAGIC_WAND_RX";

// The transmitter uses broadcast + channel=0. With no router connected, both
// ESP32-C6 modules normally stay on channel 1. If you later fix a channel on
// the transmitter, keep this value the same.
#define ESPNOW_CHANNEL 1
#define RUNTIME_SPEC_LEN 384
#define RUNTIME_BEACON_MS 300
#define RUNTIME_STAT_MS 120000
#define RUNTIME_TRIGGER_COOLDOWN_MS 5000
#define RUNTIME_PEER_LIMIT 16

typedef enum {
    CMD_START = 1,
    CMD_STOP = 2,
    CMD_IDENTIFY = 3,
    CMD_TEST_EFFECT = 4,
} wand_cmd_t;

static TaskHandle_t led_task_handle = NULL;
static QueueHandle_t command_queue = NULL;
static volatile bool effect_running = true; // Receiver starts in RUN state.
static volatile bool identify_requested = false;
static volatile bool identify_cancel_requested = false;
static volatile bool identify_restore_running = true;
static portMUX_TYPE runtime_mux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool runtime_configured = false;
static volatile bool runtime_started = false;
static uint16_t runtime_room_hash = 0;
static uint32_t runtime_group_mask = 0;
static uint32_t runtime_peer_mask = 0;
static bool runtime_compare_lte = false;
static int runtime_rssi_threshold = -70;
static uint32_t runtime_hold_ms = 2000;
static char runtime_idle_spec[RUNTIME_SPEC_LEN] = "silent";
static char runtime_trigger_spec[RUNTIME_SPEC_LEN] = "silent";
static uint8_t controller_mac[6] = {0};
static int64_t last_trigger_ms = 0;
static uint32_t beacon_seq = 0;
static uint32_t stat_seq = 0;

typedef struct {
    bool used;
    bool found;
    uint8_t mac[6];
    uint32_t group_mask;
    int rssi;
    int64_t last_seen_ms;
    int64_t candidate_first_ms;
} runtime_peer_t;

static runtime_peer_t runtime_peers[RUNTIME_PEER_LIMIT];

static const uint8_t broadcast_mac[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static const uint8_t zero_mac[6] = {0, 0, 0, 0, 0, 0};

static void ensure_peer_exists(const uint8_t *mac)
{
    if (mac == NULL || esp_now_is_peer_exist(mac)) {
        return;
    }

    esp_now_peer_info_t peer;
    memset(&peer, 0, sizeof(peer));
    memcpy(peer.peer_addr, mac, 6);
    peer.channel = ESPNOW_CHANNEL;
    peer.ifidx = WIFI_IF_STA;
    peer.encrypt = false;

    esp_err_t ret = esp_now_add_peer(&peer);
    if (ret != ESP_OK && ret != ESP_ERR_ESPNOW_EXIST) {
        ESP_LOGW(TAG, "Failed to add controller peer: %s", esp_err_to_name(ret));
    }
}

static void send_presence_reply(const uint8_t *dst_mac)
{
    if (dst_mac == NULL) {
        return;
    }

    ensure_peer_exists(dst_mac);

    uint8_t self_mac[6] = {0};
    ESP_ERROR_CHECK(esp_wifi_get_mac(WIFI_IF_STA, self_mac));

    char reply[48];
    snprintf(reply, sizeof(reply), "PRESENT,%02X:%02X:%02X:%02X:%02X:%02X",
             self_mac[0], self_mac[1], self_mac[2], self_mac[3], self_mac[4], self_mac[5]);

    esp_err_t ret = esp_now_send(dst_mac, (const uint8_t *)reply, strlen(reply) + 1);
    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "DISCOVER reply sent: %s", reply);
    } else {
        ESP_LOGW(TAG, "DISCOVER reply failed: %s", esp_err_to_name(ret));
    }
}

static bool parse_u32_token(char **cursor, uint32_t *out)
{
    if (!cursor || !*cursor || !out) return false;
    char *start = *cursor;
    char *bar = strchr(start, '|');
    if (!bar) return false;
    *bar = '\0';
    *out = (uint32_t)strtoul(start, NULL, 10);
    *cursor = bar + 1;
    return true;
}

static bool parse_i32_token(char **cursor, int *out)
{
    if (!cursor || !*cursor || !out) return false;
    char *start = *cursor;
    char *bar = strchr(start, '|');
    if (!bar) return false;
    *bar = '\0';
    *out = atoi(start);
    *cursor = bar + 1;
    return true;
}

static bool parse_string_token(char **cursor, char *out, size_t out_size)
{
    if (!cursor || !*cursor || !out || out_size == 0) return false;
    char *start = *cursor;
    char *bar = strchr(start, '|');
    if (!bar) return false;
    *bar = '\0';
    snprintf(out, out_size, "%s", start);
    *cursor = bar + 1;
    return true;
}

static void mac_to_string(const uint8_t *mac, char *out, size_t out_size)
{
    if (!mac || !out || out_size < 18) return;
    snprintf(out, out_size, "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

static void runtime_clear_peers_locked(void)
{
    memset(runtime_peers, 0, sizeof(runtime_peers));
}

static runtime_peer_t *runtime_peer_slot_locked(const uint8_t *mac, int64_t now_ms)
{
    int empty = -1;
    int oldest = 0;
    for (int i = 0; i < RUNTIME_PEER_LIMIT; i++) {
        if (runtime_peers[i].used && memcmp(runtime_peers[i].mac, mac, 6) == 0) {
            return &runtime_peers[i];
        }
        if (!runtime_peers[i].used && empty < 0) empty = i;
        if (runtime_peers[i].last_seen_ms < runtime_peers[oldest].last_seen_ms) oldest = i;
    }
    int idx = empty >= 0 ? empty : oldest;
    memset(&runtime_peers[idx], 0, sizeof(runtime_peers[idx]));
    runtime_peers[idx].used = true;
    runtime_peers[idx].last_seen_ms = now_ms;
    memcpy(runtime_peers[idx].mac, mac, 6);
    return &runtime_peers[idx];
}

static void runtime_counts_locked(uint16_t *seen_count, uint16_t *found_count)
{
    uint16_t seen = 0;
    uint16_t found = 0;
    for (int i = 0; i < RUNTIME_PEER_LIMIT; i++) {
        if (!runtime_peers[i].used) continue;
        seen++;
        if (runtime_peers[i].found) found++;
    }
    if (seen_count) *seen_count = seen;
    if (found_count) *found_count = found;
}

static bool apply_runtime_config(const uint8_t *src_mac, const char *payload)
{
    if (!src_mac || !payload) return false;

    char buf[250];
    snprintf(buf, sizeof(buf), "%s", payload);
    char *cursor = buf;
    uint32_t room = 0;
    uint32_t group_mask = 0;
    uint32_t peer_mask = 0;
    uint32_t hold = 0;
    int rssi = -70;
    bool compare_lte = false;
    if (!parse_u32_token(&cursor, &room) ||
        !parse_u32_token(&cursor, &group_mask) ||
        !parse_u32_token(&cursor, &peer_mask)) {
        return false;
    }
    char token[8] = {0};
    if (!parse_string_token(&cursor, token, sizeof(token))) return false;
    if (strcmp(token, "gte") == 0 || strcmp(token, "lte") == 0) {
        compare_lte = strcmp(token, "lte") == 0;
        if (!parse_i32_token(&cursor, &rssi) || !parse_u32_token(&cursor, &hold)) {
            return false;
        }
    } else {
        rssi = atoi(token);
        if (!parse_u32_token(&cursor, &hold)) {
            return false;
        }
    }
    if (!cursor || cursor[0] == '\0') return false;

    portENTER_CRITICAL(&runtime_mux);
    memcpy(controller_mac, src_mac, sizeof(controller_mac));
    runtime_room_hash = (uint16_t)room;
    runtime_group_mask = group_mask;
    runtime_peer_mask = peer_mask;
    runtime_compare_lte = compare_lte;
    runtime_rssi_threshold = rssi;
    runtime_hold_ms = hold;
    snprintf(runtime_idle_spec, sizeof(runtime_idle_spec), "%s", cursor);
    if (runtime_trigger_spec[0] == '\0') {
        snprintf(runtime_trigger_spec, sizeof(runtime_trigger_spec), "%s", cursor);
    }
    runtime_configured = true;
    runtime_started = false;
    runtime_clear_peers_locked();
    stat_seq = 0;
    portEXIT_CRITICAL(&runtime_mux);

    default_effect_set_spec(cursor);
    ESP_LOGI(TAG, "CFG applied room=%u groups=%u peers=%u compare=%s rssi=%d hold=%u idle_len=%u idle=%s",
             room, group_mask, peer_mask, compare_lte ? "lte" : "gte", rssi, hold, (unsigned int)strlen(cursor), cursor);
    return true;
}

static bool apply_runtime_trigger_spec(const char *spec)
{
    if (!spec || spec[0] == '\0') return false;
    portENTER_CRITICAL(&runtime_mux);
    snprintf(runtime_trigger_spec, sizeof(runtime_trigger_spec), "%s", spec);
    portEXIT_CRITICAL(&runtime_mux);
    ESP_LOGI(TAG, "Trigger effect set len=%u: %s", (unsigned int)strlen(spec), spec);
    return true;
}

static void send_runtime_event(const uint8_t *peer_mac, uint32_t peer_group_mask, int rssi)
{
    uint8_t dst[6];
    uint16_t room = 0;
    uint32_t group_mask = 0;
    uint8_t self_mac[6] = {0};
    portENTER_CRITICAL(&runtime_mux);
    memcpy(dst, controller_mac, sizeof(dst));
    room = runtime_room_hash;
    group_mask = runtime_group_mask;
    portEXIT_CRITICAL(&runtime_mux);
    if (memcmp(dst, zero_mac, 6) == 0) return;
    esp_wifi_get_mac(WIFI_IF_STA, self_mac);
    ensure_peer_exists(dst);
    char self_text[18];
    char peer_text[18];
    mac_to_string(self_mac, self_text, sizeof(self_text));
    mac_to_string(peer_mac, peer_text, sizeof(peer_text));
    char msg[160];
    snprintf(msg, sizeof(msg), "EVENT|%u|%s|%s|%u|%u|%d|%lld",
             (unsigned int)room,
             self_text,
             peer_text,
             (unsigned int)group_mask,
             (unsigned int)peer_group_mask,
             rssi,
             (long long)(esp_timer_get_time() / 1000));
    esp_err_t ret = esp_now_send(dst, (const uint8_t *)msg, strlen(msg) + 1);
    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "EVENT sent: self=%s peer=%s self_group=%u peer_group=%u rssi=%d",
                 self_text, peer_text, (unsigned int)group_mask, (unsigned int)peer_group_mask, rssi);
    } else {
        ESP_LOGW(TAG, "EVENT send failed: %s", esp_err_to_name(ret));
    }
}

static void send_runtime_stat(void)
{
    uint8_t dst[6];
    uint16_t room = 0;
    uint16_t seen_count = 0;
    uint16_t found_count = 0;
    portENTER_CRITICAL(&runtime_mux);
    memcpy(dst, controller_mac, sizeof(dst));
    room = runtime_room_hash;
    runtime_counts_locked(&seen_count, &found_count);
    portEXIT_CRITICAL(&runtime_mux);
    if (memcmp(dst, zero_mac, 6) == 0) return;
    ensure_peer_exists(dst);
    uint8_t self_mac[6] = {0};
    esp_wifi_get_mac(WIFI_IF_STA, self_mac);
    char self_text[18];
    mac_to_string(self_mac, self_text, sizeof(self_text));
    char msg[96];
    snprintf(msg, sizeof(msg), "STAT|%u|%s|%u|%u|%u",
             (unsigned int)room,
             self_text,
             (unsigned int)seen_count,
             (unsigned int)found_count,
             (unsigned int)stat_seq++);
    esp_err_t ret = esp_now_send(dst, (const uint8_t *)msg, strlen(msg) + 1);
    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "STAT sent: seen=%u found=%u", (unsigned int)seen_count, (unsigned int)found_count);
    } else {
        ESP_LOGW(TAG, "STAT send failed: %s", esp_err_to_name(ret));
    }
}

static void handle_runtime_beacon(const esp_now_recv_info_t *recv_info, const char *payload)
{
    if (!recv_info || !recv_info->src_addr || !payload) return;
    bool configured = false;
    bool started = false;
    bool running = effect_running;
    uint16_t room = 0;
    uint32_t peer_mask = 0;
    uint32_t remote_mask = 0;
    uint32_t hold = 0;
    int threshold = -70;
    bool compare_lte = false;
    char trigger_spec[RUNTIME_SPEC_LEN] = {0};

    char buf[96];
    snprintf(buf, sizeof(buf), "%s", payload);
    char *cursor = buf;
    uint32_t remote_room = 0;
    if (!parse_u32_token(&cursor, &remote_room) || !parse_u32_token(&cursor, &remote_mask)) return;

    portENTER_CRITICAL(&runtime_mux);
    configured = runtime_configured;
    started = runtime_started;
    room = runtime_room_hash;
    peer_mask = runtime_peer_mask;
    threshold = runtime_rssi_threshold;
    compare_lte = runtime_compare_lte;
    hold = runtime_hold_ms;
    snprintf(trigger_spec, sizeof(trigger_spec), "%s", runtime_trigger_spec);
    portEXIT_CRITICAL(&runtime_mux);

    if (!configured || !started || !running || remote_room != room || (remote_mask & peer_mask) == 0) return;
    int rssi = recv_info->rx_ctrl ? recv_info->rx_ctrl->rssi : -127;
    int64_t now_ms = esp_timer_get_time() / 1000;
    bool should_trigger = false;
    portENTER_CRITICAL(&runtime_mux);
    runtime_peer_t *peer = runtime_peer_slot_locked(recv_info->src_addr, now_ms);
    peer->group_mask = remote_mask;
    peer->rssi = rssi;
    peer->last_seen_ms = now_ms;
    bool matched = compare_lte ? (rssi <= threshold) : (rssi >= threshold);
    if (!matched) {
        peer->candidate_first_ms = 0;
    } else if (!peer->found) {
        if (peer->candidate_first_ms == 0) {
            peer->candidate_first_ms = now_ms;
        } else if ((uint32_t)(now_ms - peer->candidate_first_ms) >= hold) {
            peer->found = true;
            should_trigger = true;
        }
    }
    portEXIT_CRITICAL(&runtime_mux);

    if (!should_trigger) return;
    last_trigger_ms = now_ms;
    if (default_effect_set_spec(trigger_spec)) {
            ESP_LOGI(TAG, "Runtime trigger rssi=%d spec=%s", rssi, trigger_spec);
        if (led_task_handle) xTaskNotifyGive(led_task_handle);
    }
    send_runtime_event(recv_info->src_addr, remote_mask, rssi);
}

static void runtime_beacon_task(void *pvParameter)
{
    ensure_peer_exists(broadcast_mac);
    int64_t last_stat_ms = 0;
    while (1) {
        bool configured = false;
        bool started = false;
        bool running = effect_running;
        uint16_t room = 0;
        uint32_t group_mask = 0;
        portENTER_CRITICAL(&runtime_mux);
        configured = runtime_configured;
        started = runtime_started;
        room = runtime_room_hash;
        group_mask = runtime_group_mask;
        portEXIT_CRITICAL(&runtime_mux);

        if (configured && started && running && group_mask != 0) {
            char msg[96];
            snprintf(msg, sizeof(msg), "BEACON|%u|%u|%u",
                     (unsigned int)room, (unsigned int)group_mask, (unsigned int)beacon_seq++);
            esp_now_send(broadcast_mac, (const uint8_t *)msg, strlen(msg) + 1);
            int64_t now_ms = esp_timer_get_time() / 1000;
            if (last_stat_ms == 0 || now_ms - last_stat_ms >= RUNTIME_STAT_MS) {
                send_runtime_stat();
                last_stat_ms = now_ms;
            }
        }
        vTaskDelay(pdMS_TO_TICKS(RUNTIME_BEACON_MS));
    }
}

static bool wait_or_control_change(uint32_t delay_ms)
{
    if (led_task_handle == NULL) {
        vTaskDelay(pdMS_TO_TICKS(delay_ms));
        return false;
    }

    return ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(delay_ms)) > 0;
}

static void led_self_test_task(void *pvParameter)
{
    bool leds_already_cleared = false;

    while (1) {
        if (identify_requested) {
            bool restore_running = identify_restore_running;

            identify_requested = false;
            identify_cancel_requested = false;
            leds_already_cleared = false;

            ESP_LOGI(TAG, "IDENTIFY started.");
            for (int step = 0; step < identify_effect_step_count(); step++) {
                if (identify_cancel_requested) {
                    break;
                }

                identify_effect_render_step(step);
                wait_or_control_change(identify_effect_step_ms());
            }

            led_ports_clear_all();
            default_effect_reset();

            effect_running = restore_running && !identify_cancel_requested;
            if (effect_running) {
                ESP_LOGI(TAG, "IDENTIFY finished, default effect resumed.");
            } else {
                leds_already_cleared = true;
                ESP_LOGI(TAG, "IDENTIFY finished, receiver remains stopped.");
            }
            continue;
        }

        if (!effect_running) {
            if (!leds_already_cleared) {
                led_ports_clear_all();
                leds_already_cleared = true;
                default_effect_reset();
                ESP_LOGI(TAG, "Effect stopped, all LEDs off.");
            }

            wait_or_control_change(1000);
            continue;
        }

        leds_already_cleared = false;
        default_effect_render_frame();
        wait_or_control_change(30);
    }
}

static void apply_command(wand_cmd_t cmd)
{
    if (cmd == CMD_START) {
        portENTER_CRITICAL(&runtime_mux);
        runtime_started = true;
        runtime_clear_peers_locked();
        stat_seq = 0;
        portEXIT_CRITICAL(&runtime_mux);
        if (effect_running) {
            ESP_LOGI(TAG, "START ignored: effect already running.");
            return;
        }

        effect_running = true;
        identify_restore_running = true;
        ESP_LOGI(TAG, "START received: effect resumed.");
    } else if (cmd == CMD_STOP) {
        portENTER_CRITICAL(&runtime_mux);
        runtime_started = false;
        portEXIT_CRITICAL(&runtime_mux);
        if (!effect_running) {
            ESP_LOGI(TAG, "STOP ignored: effect already stopped.");
            return;
        }

        effect_running = false;
        identify_requested = false;
        identify_cancel_requested = true;
        identify_restore_running = false;
        ESP_LOGI(TAG, "STOP received: stopping effect.");
    } else if (cmd == CMD_IDENTIFY) {
        identify_restore_running = effect_running;
        identify_cancel_requested = false;
        identify_requested = true;
        ESP_LOGI(TAG, "IDENTIFY received: flashing LED1/LED2.");
    } else if (cmd == CMD_TEST_EFFECT) {
        char trigger_spec[RUNTIME_SPEC_LEN] = {0};
        portENTER_CRITICAL(&runtime_mux);
        snprintf(trigger_spec, sizeof(trigger_spec), "%s", runtime_trigger_spec);
        portEXIT_CRITICAL(&runtime_mux);
        if (trigger_spec[0] == '\0') {
            snprintf(trigger_spec, sizeof(trigger_spec), "silent");
        }
        if (default_effect_set_spec(trigger_spec)) {
            effect_running = true;
            identify_cancel_requested = true;
            identify_restore_running = true;
            ESP_LOGI(TAG, "TEST_EFFECT received: playing trigger effect until STOP len=%u: %s", (unsigned int)strlen(trigger_spec), trigger_spec);
        } else {
            ESP_LOGW(TAG, "TEST_EFFECT ignored, invalid trigger spec: %s", trigger_spec);
        }
    }

    if (led_task_handle) {
        xTaskNotifyGive(led_task_handle);
    }
}

static void command_task(void *pvParameter)
{
    wand_cmd_t cmd;
    while (1) {
        if (xQueueReceive(command_queue, &cmd, portMAX_DELAY) == pdTRUE) {
            apply_command(cmd);
        }
    }
}

static void espnow_recv_cb(const esp_now_recv_info_t *recv_info, const uint8_t *data, int data_len)
{
    if (data == NULL || data_len <= 0 || command_queue == NULL) {
        return;
    }

    char msg[512];
    int copy_len = data_len;
    if (copy_len >= (int)sizeof(msg)) {
        copy_len = sizeof(msg) - 1;
    }
    memcpy(msg, data, copy_len);
    msg[copy_len] = '\0';

    if (strncmp(msg, "FXSET|", 6) == 0) {
        const char *spec = msg + 6;
        if (default_effect_set_spec(spec)) {
            ESP_LOGI(TAG, "FXSET received len=%u: %s", (unsigned int)strlen(spec), spec);
            if (led_task_handle) {
                xTaskNotifyGive(led_task_handle);
            }
        } else {
            ESP_LOGW(TAG, "Invalid FXSET spec: %s", spec);
        }
        return;
    }

    if (strncmp(msg, "CFG|", 4) == 0) {
        if (!apply_runtime_config(recv_info ? recv_info->src_addr : NULL, msg + 4)) {
            ESP_LOGW(TAG, "Invalid CFG: %s", msg);
        }
        return;
    }

    if (strncmp(msg, "TRG|", 4) == 0) {
        apply_runtime_trigger_spec(msg + 4);
        return;
    }

    if (strncmp(msg, "BEACON|", 7) == 0) {
        handle_runtime_beacon(recv_info, msg + 7);
        return;
    }

    if (strcmp(msg, "DISCOVER") == 0) {
        if (recv_info && recv_info->src_addr) {
            ESP_LOGI(TAG, "DISCOVER received.");
            send_presence_reply(recv_info->src_addr);
        }
        return;
    }

    wand_cmd_t cmd;
    if (strcmp(msg, "START") == 0 || strcmp(msg, "STRAT") == 0) {
        cmd = CMD_START;
    } else if (strcmp(msg, "STOP") == 0) {
        cmd = CMD_STOP;
    } else if (strcmp(msg, "IDENTIFY") == 0 || strcmp(msg, "ID") == 0) {
        cmd = CMD_IDENTIFY;
        if (recv_info && recv_info->src_addr) {
            send_presence_reply(recv_info->src_addr);
        }
    } else if (strcmp(msg, "TEST_EFFECT") == 0) {
        cmd = CMD_TEST_EFFECT;
    } else {
        ESP_LOGW(TAG, "Unknown ESP-NOW message: %s", msg);
        return;
    }

    if (recv_info && recv_info->src_addr) {
        ESP_LOGI(TAG, "ESP-NOW RX %s from %02X:%02X:%02X:%02X:%02X:%02X",
                 msg,
                 recv_info->src_addr[0], recv_info->src_addr[1], recv_info->src_addr[2],
                 recv_info->src_addr[3], recv_info->src_addr[4], recv_info->src_addr[5]);
    }

    xQueueSend(command_queue, &cmd, 0);
}

static void wifi_espnow_init(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    } else {
        ESP_ERROR_CHECK(ret);
    }

    ESP_ERROR_CHECK(esp_netif_init());

    ret = esp_event_loop_create_default();
    if (ret != ESP_ERR_INVALID_STATE) {
        ESP_ERROR_CHECK(ret);
    }

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(esp_wifi_set_protocol(WIFI_IF_STA, WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N));
    ESP_ERROR_CHECK(esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE));

    ESP_ERROR_CHECK(esp_now_init());
    ESP_ERROR_CHECK(esp_now_register_recv_cb(espnow_recv_cb));
    ensure_peer_exists(broadcast_mac);

    uint8_t mac[6] = {0};
    uint8_t primary = 0;
    wifi_second_chan_t second = WIFI_SECOND_CHAN_NONE;
    ESP_ERROR_CHECK(esp_wifi_get_mac(WIFI_IF_STA, mac));
    ESP_ERROR_CHECK(esp_wifi_get_channel(&primary, &second));

    ESP_LOGI(TAG, "ESP-NOW READY, STA MAC=%02X:%02X:%02X:%02X:%02X:%02X, channel=%u",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5], primary);
}

extern "C" void app_main(void)
{
    ESP_LOGI(TAG, "Boot: initializing ESP-NOW and 3 LED ports...");

    command_queue = xQueueCreate(8, sizeof(wand_cmd_t));
    if (command_queue == NULL) {
        ESP_LOGE(TAG, "Command queue creation failed.");
        return;
    }

    wifi_espnow_init();

    if (led_ports_init()) {
        ESP_LOGI(TAG, "Hardware init OK, starting self-test and command tasks.");
        xTaskCreate(led_self_test_task, "led_self_test", 4096, NULL, 5, &led_task_handle);
        xTaskCreate(command_task, "wand_command", 4096, NULL, 6, NULL);
        xTaskCreate(runtime_beacon_task, "runtime_beacon", 4096, NULL, 4, NULL);
    } else {
        ESP_LOGE(TAG, "Hardware init failed. Check pins and memory/stack.");
        led_ports_clear_all();
    }
}
