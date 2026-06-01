// ESP32-C6 receiver: ESP-NOW START/STOP control + three-port LED self-test.
// STOP: stop current effect and turn all LEDs off.
// START: resume the default self-test effect. Duplicate START/STOP commands are ignored.
// FXSET|...: update the active effect profile used when START is running.

#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_now.h"
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

typedef enum {
    CMD_START = 1,
    CMD_STOP = 2,
    CMD_IDENTIFY = 3,
} wand_cmd_t;

static TaskHandle_t led_task_handle = NULL;
static QueueHandle_t command_queue = NULL;
static volatile bool effect_running = true; // Receiver starts in RUN state.
static volatile bool identify_requested = false;
static volatile bool identify_cancel_requested = false;
static volatile bool identify_restore_running = true;

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
        if (effect_running) {
            ESP_LOGI(TAG, "START ignored: effect already running.");
            return;
        }

        effect_running = true;
        identify_restore_running = true;
        ESP_LOGI(TAG, "START received: effect resumed.");
    } else if (cmd == CMD_STOP) {
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

    char msg[128];
    int copy_len = data_len;
    if (copy_len >= (int)sizeof(msg)) {
        copy_len = sizeof(msg) - 1;
    }
    memcpy(msg, data, copy_len);
    msg[copy_len] = '\0';

    if (strncmp(msg, "FXSET|", 6) == 0) {
        const char *spec = msg + 6;
        if (default_effect_set_spec(spec)) {
            ESP_LOGI(TAG, "FXSET received: %s", spec);
            if (led_task_handle) {
                xTaskNotifyGive(led_task_handle);
            }
        } else {
            ESP_LOGW(TAG, "Invalid FXSET spec: %s", spec);
        }
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
    } else {
        ESP_LOGE(TAG, "Hardware init failed. Check pins and memory/stack.");
        led_ports_clear_all();
    }
}
