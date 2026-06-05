// ESP32-C6 receiver: ESP-NOW START/STOP control + three-port runtime effects.
// STOP: stop current effect and turn all LEDs off.
// START: resume the currently configured runtime effect. Duplicate START/STOP commands are ignored.
// FXSET|...: update the active effect profile used when START is running.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

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
#define RUNTIME_TRIGGER_EFFECT_MS 5000
#define RUNTIME_PEER_LIMIT 64
#define LED_BLACKOUT_SWEEP_COUNT 200
#define SIGNAL_METER_RENDER_MS 500
#define SIGNAL_METER_LOCK_MIN_MS 2000

typedef enum {
    CMD_START = 1,
    CMD_STOP = 2,
    CMD_IDENTIFY = 3,
    CMD_TEST_EFFECT = 4,
    CMD_PLAY_ONCE = 5,
} wand_cmd_t;

static TaskHandle_t led_task_handle = NULL;
static QueueHandle_t command_queue = NULL;
static volatile bool effect_running = false; // Game hardware stays dark until START/TEST/IDENTIFY.
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
static volatile bool runtime_trigger_effect_active = false;
static int64_t runtime_trigger_effect_until_ms = 0;
static uint8_t controller_mac[6] = {0};
static int64_t last_trigger_ms = 0;
static uint32_t beacon_seq = 0;
static uint32_t stat_seq = 0;
static uint8_t runtime_rule_id = 1;
static uint8_t runtime_rule_base = 1;
static uint8_t runtime_rule_judge = 1;
static uint8_t runtime_rule_signal = 1;
static int runtime_rule_rssi_min = -70;
static int runtime_rule_rssi_max = -127;
static uint32_t runtime_rule_missing_ms = 3000;
static uint8_t runtime_rule_smooth_samples = 5;
static uint8_t runtime_rule_trigger = 1;
static uint32_t runtime_rule_target_ms = 0;
static uint16_t runtime_rule_target_count = 1;
static uint32_t runtime_rule_period_ms = 0;
static uint8_t runtime_rule_score_target = 1;
static int runtime_rule_points = 1;
static uint8_t runtime_rule_repeat = 2;
static uint32_t runtime_rule_cooldown_ms = RUNTIME_TRIGGER_COOLDOWN_MS;
static uint8_t runtime_rule_after = 0;
static uint8_t runtime_rule_target_state = 0;
static uint8_t runtime_rule_timer_action = 0;
static bool runtime_meter_enabled = false;
static uint8_t runtime_meter_port = 0;
static uint16_t runtime_meter_led_count = 10;
static int runtime_meter_weak_rssi = -90;
static int runtime_meter_strong_rssi = -35;
static uint16_t runtime_meter_compression_x100 = 100;
static bool runtime_meter_track_active = false;
static uint8_t runtime_meter_tracked_mac[6] = {0};
static uint32_t runtime_event_seq = 0;
static bool runtime_pair_filter_enabled = false;
static uint8_t runtime_allowed_peers[RUNTIME_PEER_LIMIT][6];
static uint8_t runtime_allowed_peer_count = 0;

typedef struct {
    bool used;
    bool found;
    uint8_t mac[6];
    uint32_t group_mask;
    int rssi;
    int smooth_rssi;
    int64_t last_seen_ms;
    int64_t candidate_first_ms;
    int64_t mismatch_start_ms;
    int64_t active_start_ms;
    uint32_t accumulated_ms;
    int64_t last_update_ms;
    int64_t last_event_ms;
    uint16_t matched_count;
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

static bool parse_mac_string(const char *text, uint8_t *mac)
{
    if (!text || !mac) return false;
    unsigned int values[6] = {0};
    if (sscanf(text, "%2x:%2x:%2x:%2x:%2x:%2x",
               &values[0], &values[1], &values[2],
               &values[3], &values[4], &values[5]) != 6) {
        return false;
    }
    for (int i = 0; i < 6; i++) {
        mac[i] = (uint8_t)values[i];
    }
    return true;
}

static bool runtime_signal_match_from_rssi(int smooth_rssi, int rssi_min, int rssi_max, uint8_t signal)
{
    bool in_range = (smooth_rssi >= rssi_min) && (rssi_max <= -126 || smooth_rssi <= rssi_max);
    switch (signal) {
        case 2: // leave_range
        case 5: // lost
            return !in_range;
        case 6: // stronger
            return smooth_rssi >= rssi_min;
        case 7: // weaker
            return smooth_rssi <= rssi_min;
        default:
            return in_range;
    }
}

static void runtime_clear_meter_track_locked(void)
{
    runtime_meter_track_active = false;
    memset(runtime_meter_tracked_mac, 0, sizeof(runtime_meter_tracked_mac));
}

static void runtime_clear_peers_locked(void)
{
    memset(runtime_peers, 0, sizeof(runtime_peers));
    runtime_clear_meter_track_locked();
}

static void runtime_clear_allowed_peers_locked(void)
{
    memset(runtime_allowed_peers, 0, sizeof(runtime_allowed_peers));
    runtime_allowed_peer_count = 0;
    runtime_pair_filter_enabled = false;
}

static void runtime_clear_trigger_effect_locked(void)
{
    runtime_trigger_effect_active = false;
    runtime_trigger_effect_until_ms = 0;
}

static void runtime_copy_idle_spec_locked(char *out, size_t out_size)
{
    if (!out || out_size == 0) return;
    snprintf(out, out_size, "%s", runtime_idle_spec[0] ? runtime_idle_spec : "silent");
}

static void runtime_restore_idle_if_trigger_expired(void)
{
    char idle_spec[RUNTIME_SPEC_LEN] = {0};
    bool should_restore = false;
    int64_t now_ms = esp_timer_get_time() / 1000;

    portENTER_CRITICAL(&runtime_mux);
    if (runtime_trigger_effect_active && runtime_trigger_effect_until_ms > 0 &&
        now_ms >= runtime_trigger_effect_until_ms) {
        runtime_clear_trigger_effect_locked();
        runtime_copy_idle_spec_locked(idle_spec, sizeof(idle_spec));
        should_restore = runtime_configured && runtime_started && effect_running;
    }
    portEXIT_CRITICAL(&runtime_mux);

    if (!should_restore) {
        return;
    }

    if (default_effect_set_spec(idle_spec)) {
        ESP_LOGI(TAG, "Runtime trigger effect expired; restored idle effect len=%u: %s",
                 (unsigned int)strlen(idle_spec), idle_spec);
    } else {
        ESP_LOGW(TAG, "Runtime trigger effect expired; idle spec invalid: %s", idle_spec);
    }
}

static void runtime_play_trigger_effect_once(const char *trigger_spec, int rssi, int smooth_rssi)
{
    if (!trigger_spec || trigger_spec[0] == '\0') {
        return;
    }

    uint32_t effect_ms = RUNTIME_TRIGGER_EFFECT_MS;
    int64_t now_ms = esp_timer_get_time() / 1000;
    portENTER_CRITICAL(&runtime_mux);
    if (runtime_rule_cooldown_ms > 0 && runtime_rule_cooldown_ms < effect_ms) {
        effect_ms = runtime_rule_cooldown_ms;
    }
    runtime_trigger_effect_active = true;
    runtime_trigger_effect_until_ms = now_ms + effect_ms;
    portEXIT_CRITICAL(&runtime_mux);

    default_effect_set_suppressed_ports(0);
    if (default_effect_set_spec(trigger_spec)) {
        ESP_LOGI(TAG, "Runtime trigger rssi=%d smooth=%d play_ms=%u spec_len=%u spec=%s",
                 rssi, smooth_rssi, (unsigned int)effect_ms,
                 (unsigned int)strlen(trigger_spec), trigger_spec);
        if (led_task_handle) xTaskNotifyGive(led_task_handle);
    } else {
        ESP_LOGW(TAG, "Runtime trigger spec invalid: %s", trigger_spec);
    }
}

static bool runtime_peer_allowed_locked(const uint8_t *mac)
{
    if (!runtime_pair_filter_enabled) return true;
    for (int i = 0; i < runtime_allowed_peer_count && i < RUNTIME_PEER_LIMIT; i++) {
        if (memcmp(runtime_allowed_peers[i], mac, 6) == 0) return true;
    }
    return false;
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

static runtime_peer_t *runtime_competition_owner_locked(int rssi_min, int rssi_max, uint8_t signal,
                                                        int64_t now_ms, uint32_t missing_ms)
{
    runtime_peer_t *best = NULL;
    int best_rssi = -127;
    for (int i = 0; i < RUNTIME_PEER_LIMIT; i++) {
        runtime_peer_t *peer = &runtime_peers[i];
        if (!peer->used) continue;
        if (peer->last_seen_ms == 0) continue;
        if ((uint32_t)(now_ms - peer->last_seen_ms) > missing_ms) continue;
        if (!runtime_signal_match_from_rssi(peer->smooth_rssi, rssi_min, rssi_max, signal)) continue;
        if (!best || peer->smooth_rssi > best_rssi) {
            best = peer;
            best_rssi = peer->smooth_rssi;
        }
    }
    return best;
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

    char buf[512];
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
    runtime_clear_trigger_effect_locked();
    runtime_clear_peers_locked();
    runtime_clear_allowed_peers_locked();
    stat_seq = 0;
    portEXIT_CRITICAL(&runtime_mux);

    effect_running = false;
    identify_cancel_requested = true;
    identify_restore_running = false;
    default_effect_set_spec(cursor);
    if (led_task_handle) {
        xTaskNotifyGive(led_task_handle);
    }
    ESP_LOGI(TAG, "CFG applied room=%u groups=%u peers=%u compare=%s rssi=%d hold=%u idle_len=%u idle=%s",
             room, group_mask, peer_mask, compare_lte ? "lte" : "gte", rssi, hold, (unsigned int)strlen(cursor), cursor);
    return true;
}

static bool apply_runtime_rule(const uint8_t *src_mac, const char *payload)
{
    if (!src_mac || !payload) return false;
    char buf[256];
    snprintf(buf, sizeof(buf), "%s", payload);
    char *cursor = buf;
    uint32_t version = 0;
    uint32_t room = 0;
    uint32_t rule_id = 1;
    uint32_t base = 1;
    uint32_t judge = 1;
    uint32_t group_mask = 0;
    uint32_t peer_mask = 0;
    uint32_t signal = 1;
    int rssi_min = -70;
    int rssi_max = -127;
    uint32_t hold = 2000;
    uint32_t missing = 3000;
    uint32_t smooth = 5;
    uint32_t trigger = 1;
    uint32_t target_ms = 0;
    uint32_t target_count = 1;
    uint32_t period_ms = 0;
    uint32_t score_target = 1;
    int points = 1;
    uint32_t repeat = 2;
    uint32_t cooldown = RUNTIME_TRIGGER_COOLDOWN_MS;
    uint32_t after = 0;

    if (!parse_u32_token(&cursor, &version) ||
        !parse_u32_token(&cursor, &room) ||
        !parse_u32_token(&cursor, &rule_id) ||
        !parse_u32_token(&cursor, &base) ||
        !parse_u32_token(&cursor, &judge) ||
        !parse_u32_token(&cursor, &group_mask) ||
        !parse_u32_token(&cursor, &peer_mask) ||
        !parse_u32_token(&cursor, &signal) ||
        !parse_i32_token(&cursor, &rssi_min) ||
        !parse_i32_token(&cursor, &rssi_max) ||
        !parse_u32_token(&cursor, &hold) ||
        !parse_u32_token(&cursor, &missing) ||
        !parse_u32_token(&cursor, &smooth) ||
        !parse_u32_token(&cursor, &trigger) ||
        !parse_u32_token(&cursor, &target_ms) ||
        !parse_u32_token(&cursor, &target_count) ||
        !parse_u32_token(&cursor, &period_ms) ||
        !parse_u32_token(&cursor, &score_target) ||
        !parse_i32_token(&cursor, &points) ||
        !parse_u32_token(&cursor, &repeat) ||
        !parse_u32_token(&cursor, &cooldown)) {
        return false;
    }
    after = (uint32_t)atoi(cursor);
    if (version != 2 || group_mask == 0 || peer_mask == 0) return false;

    portENTER_CRITICAL(&runtime_mux);
    memcpy(controller_mac, src_mac, sizeof(controller_mac));
    runtime_room_hash = (uint16_t)room;
    runtime_group_mask = group_mask;
    runtime_peer_mask = peer_mask;
    runtime_rule_id = (uint8_t)rule_id;
    runtime_rule_base = (uint8_t)base;
    runtime_rule_judge = (uint8_t)judge;
    runtime_rule_signal = (uint8_t)signal;
    runtime_rule_rssi_min = rssi_min;
    runtime_rule_rssi_max = rssi_max;
    runtime_hold_ms = hold;
    runtime_rule_missing_ms = missing;
    runtime_rule_smooth_samples = (uint8_t)(smooth < 1 ? 1 : smooth > 10 ? 10 : smooth);
    runtime_rule_trigger = (uint8_t)trigger;
    runtime_rule_target_ms = target_ms;
    runtime_rule_target_count = (uint16_t)(target_count ? target_count : 1);
    runtime_rule_period_ms = period_ms;
    runtime_rule_score_target = (uint8_t)score_target;
    runtime_rule_points = points;
    runtime_rule_repeat = (uint8_t)repeat;
    runtime_rule_cooldown_ms = cooldown;
    runtime_rule_after = (uint8_t)after;
    runtime_rule_target_state = (uint8_t)(after & 0x0F);
    runtime_rule_timer_action = (uint8_t)((after >> 4) & 0x0F);
    runtime_meter_enabled = false;
    runtime_meter_port = 0;
    runtime_meter_led_count = 10;
    runtime_meter_weak_rssi = -90;
    runtime_meter_strong_rssi = rssi_min;
    runtime_meter_compression_x100 = 100;
    runtime_rssi_threshold = rssi_min;
    runtime_compare_lte = false;
    runtime_configured = true;
    runtime_started = false;
    runtime_clear_trigger_effect_locked();
    runtime_clear_peers_locked();
    runtime_clear_allowed_peers_locked();
    stat_seq = 0;
    runtime_event_seq = 0;
    portEXIT_CRITICAL(&runtime_mux);

    effect_running = false;
    identify_cancel_requested = true;
    identify_restore_running = false;
    if (led_task_handle) {
        xTaskNotifyGive(led_task_handle);
    }
    ESP_LOGI(TAG, "RULE applied room=%u rule=%u base=%u judge=%u self=%u peers=%u signal=%u range=%d..%d hold=%u trigger=%u target=%u period=%u score=%u points=%d repeat=%u cooldown=%u after=%u timer=%u",
             room, rule_id, base, judge, group_mask, peer_mask, signal, rssi_min, rssi_max,
             hold, trigger, target_ms, period_ms, score_target, points, repeat, cooldown,
             (unsigned int)runtime_rule_target_state, (unsigned int)runtime_rule_timer_action);
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

static bool apply_runtime_meter_config(const char *payload)
{
    if (!payload) return false;
    char buf[128];
    snprintf(buf, sizeof(buf), "%s", payload);
    char *cursor = buf;
    uint32_t room = 0;
    uint32_t rule_id = 0;
    uint32_t enabled = 0;
    uint32_t port = 1;
    uint32_t led_count = 10;
    int weak_rssi = -90;
    int strong_rssi = -35;
    uint32_t compression_x100 = 100;
    if (!parse_u32_token(&cursor, &room) ||
        !parse_u32_token(&cursor, &rule_id) ||
        !parse_u32_token(&cursor, &enabled) ||
        !parse_u32_token(&cursor, &port) ||
        !parse_u32_token(&cursor, &led_count) ||
        !parse_i32_token(&cursor, &weak_rssi)) {
        return false;
    }
    char *compression = strchr(cursor, '|');
    if (compression) {
        *compression = '\0';
        compression_x100 = (uint32_t)strtoul(compression + 1, NULL, 10);
    }
    strong_rssi = atoi(cursor);
    if (port < 1) port = 1;
    if (port > 3) port = 3;
    if (led_count < 1) led_count = 1;
    if (led_count > 200) led_count = 200;
    if (compression_x100 < 20) compression_x100 = 20;
    if (compression_x100 > 500) compression_x100 = 500;

    portENTER_CRITICAL(&runtime_mux);
    if (room != runtime_room_hash || (uint8_t)rule_id != runtime_rule_id) {
        portEXIT_CRITICAL(&runtime_mux);
        return false;
    }
    runtime_meter_enabled = enabled ? true : false;
    runtime_meter_port = (uint8_t)(port - 1);
    runtime_meter_led_count = (uint16_t)led_count;
    runtime_meter_weak_rssi = weak_rssi;
    runtime_meter_strong_rssi = strong_rssi;
    runtime_meter_compression_x100 = (uint16_t)compression_x100;
    runtime_clear_meter_track_locked();
    portEXIT_CRITICAL(&runtime_mux);

    if (runtime_meter_enabled) {
        led_ports_set_count((int)(port - 1), (int)led_count);
    }
    ESP_LOGI(TAG, "METER applied room=%u rule=%u enabled=%u port=LED%u count=%u weak=%d strong=%d compression=%u",
             room, rule_id, enabled ? 1 : 0, port, led_count, weak_rssi, strong_rssi, compression_x100);
    return true;
}

static bool apply_runtime_pair_filter(const char *payload)
{
    if (!payload) return false;
    char buf[384];
    snprintf(buf, sizeof(buf), "%s", payload);
    char *cursor = buf;
    uint32_t room = 0;
    uint32_t rule_id = 0;
    uint32_t count = 0;
    if (!parse_u32_token(&cursor, &room) ||
        !parse_u32_token(&cursor, &rule_id) ||
        !parse_u32_token(&cursor, &count)) {
        return false;
    }

    portENTER_CRITICAL(&runtime_mux);
    if (room != runtime_room_hash || (uint8_t)rule_id != runtime_rule_id) {
        portEXIT_CRITICAL(&runtime_mux);
        return false;
    }
    runtime_clear_allowed_peers_locked();
    runtime_pair_filter_enabled = true;
    portEXIT_CRITICAL(&runtime_mux);

    int loaded = 0;
    char *token = cursor;
    while (token && *token && loaded < (int)count && loaded < RUNTIME_PEER_LIMIT) {
        char *comma = strchr(token, ',');
        if (comma) *comma = '\0';
        uint8_t mac[6] = {0};
        if (parse_mac_string(token, mac)) {
            portENTER_CRITICAL(&runtime_mux);
            memcpy(runtime_allowed_peers[loaded], mac, 6);
            runtime_allowed_peer_count = (uint8_t)(loaded + 1);
            portEXIT_CRITICAL(&runtime_mux);
            loaded++;
        }
        token = comma ? (comma + 1) : NULL;
    }

    ESP_LOGI(TAG, "PAIR filter applied room=%u rule=%u allow=%d/%u", room, rule_id, loaded, count);
    return true;
}

static void send_runtime_event_v2(const uint8_t *source_mac, const uint8_t *target_mac,
                                  uint32_t source_mask, uint32_t target_mask, int rssi, uint8_t kind)
{
    uint8_t dst[6] = {0};
    uint16_t room = 0;
    uint8_t rule_id = 1;
    int points = 1;
    unsigned int seq = 0;
    portENTER_CRITICAL(&runtime_mux);
    memcpy(dst, controller_mac, sizeof(dst));
    room = runtime_room_hash;
    rule_id = runtime_rule_id;
    points = runtime_rule_points;
    seq = runtime_event_seq++;
    portEXIT_CRITICAL(&runtime_mux);
    if (memcmp(dst, zero_mac, sizeof(dst)) == 0) memcpy(dst, broadcast_mac, sizeof(dst));
    ensure_peer_exists(dst);

    uint8_t self_mac[6] = {0};
    ESP_ERROR_CHECK(esp_wifi_get_mac(WIFI_IF_STA, self_mac));
    char judge_text[18];
    char source_text[18];
    char target_text[18];
    mac_to_string(self_mac, judge_text, sizeof(judge_text));
    mac_to_string(source_mac, source_text, sizeof(source_text));
    mac_to_string(target_mac, target_text, sizeof(target_text));
    int64_t now_ms = esp_timer_get_time() / 1000;

    char msg[256];
    snprintf(msg, sizeof(msg), "EVT2|%u|%u|%u|%s|%s|%s|%u|%u|%d|%d|%u|%lld",
             (unsigned int)room,
             (unsigned int)rule_id,
             (unsigned int)kind,
             judge_text,
             source_text,
             target_text,
             (unsigned int)source_mask,
             (unsigned int)target_mask,
             rssi,
             points,
             seq,
             (long long)now_ms);
    esp_err_t ret = esp_now_send(dst, (const uint8_t *)msg, strlen(msg) + 1);
    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "EVT2 sent: source=%s target=%s rssi=%d points=%d seq=%u", source_text, target_text, rssi, points, seq);
    } else {
        ESP_LOGW(TAG, "EVT2 send failed: %s", esp_err_to_name(ret));
    }
}

static void send_runtime_stat(void)
{
    uint8_t dst[6];
    uint16_t room = 0;
    uint16_t seen_count = 0;
    uint16_t found_count = 0;
    uint8_t rule_id = 1;
    uint8_t best_peer[6] = {0};
    int best_rssi = -127;
    uint32_t active_ms = 0;
    portENTER_CRITICAL(&runtime_mux);
    memcpy(dst, controller_mac, sizeof(dst));
    room = runtime_room_hash;
    rule_id = runtime_rule_id;
    runtime_counts_locked(&seen_count, &found_count);
    for (int i = 0; i < RUNTIME_PEER_LIMIT; i++) {
        if (!runtime_peers[i].used) continue;
        if (runtime_peers[i].smooth_rssi > best_rssi) {
            best_rssi = runtime_peers[i].smooth_rssi;
            memcpy(best_peer, runtime_peers[i].mac, sizeof(best_peer));
            active_ms = runtime_peers[i].accumulated_ms;
        }
    }
    portEXIT_CRITICAL(&runtime_mux);
    if (memcmp(dst, zero_mac, 6) == 0) return;
    ensure_peer_exists(dst);
    uint8_t self_mac[6] = {0};
    esp_wifi_get_mac(WIFI_IF_STA, self_mac);
    char self_text[18];
    char best_text[18];
    mac_to_string(self_mac, self_text, sizeof(self_text));
    mac_to_string(best_peer, best_text, sizeof(best_text));
    char msg[160];
    snprintf(msg, sizeof(msg), "STAT2|%u|%s|%u|%u|%u|%s|%d|%u|%u",
             (unsigned int)room,
             self_text,
             (unsigned int)rule_id,
             (unsigned int)seen_count,
             (unsigned int)found_count,
             best_text,
             best_rssi,
             (unsigned int)active_ms,
             (unsigned int)stat_seq++);
    esp_err_t ret = esp_now_send(dst, (const uint8_t *)msg, strlen(msg) + 1);
    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "STAT2 sent: seen=%u events=%u best=%d", (unsigned int)seen_count, (unsigned int)found_count, best_rssi);
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
    int rssi_min = -70;
    int rssi_max = -127;
    uint8_t signal = 1;
    uint8_t base = 1;
    uint8_t judge = 1;
    uint8_t trigger = 1;
    uint32_t target_ms = 0;
    uint32_t period_ms = 0;
    uint8_t repeat = 2;
    uint32_t cooldown_ms = RUNTIME_TRIGGER_COOLDOWN_MS;
    uint32_t missing_ms = 3000;
    uint8_t smooth_samples = 5;
    uint8_t timer_action = 0;
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
    rssi_min = runtime_rule_rssi_min;
    rssi_max = runtime_rule_rssi_max;
    signal = runtime_rule_signal;
    base = runtime_rule_base;
    judge = runtime_rule_judge;
    trigger = runtime_rule_trigger;
    target_ms = runtime_rule_target_ms;
    period_ms = runtime_rule_period_ms;
    repeat = runtime_rule_repeat;
    cooldown_ms = runtime_rule_cooldown_ms;
    missing_ms = runtime_rule_missing_ms;
    smooth_samples = runtime_rule_smooth_samples;
    timer_action = runtime_rule_timer_action;
    hold = runtime_hold_ms;
    snprintf(trigger_spec, sizeof(trigger_spec), "%s", runtime_trigger_spec);
    if (!runtime_peer_allowed_locked(recv_info->src_addr)) {
        portEXIT_CRITICAL(&runtime_mux);
        return;
    }
    portEXIT_CRITICAL(&runtime_mux);

    if (!configured || !started || !running || remote_room != room || (remote_mask & peer_mask) == 0) return;
    int rssi = recv_info->rx_ctrl ? recv_info->rx_ctrl->rssi : -127;
    int64_t now_ms = esp_timer_get_time() / 1000;
    bool should_trigger = false;
    int smooth_rssi = rssi;
    uint32_t source_mask = runtime_group_mask;
    uint32_t target_mask = remote_mask;
    uint8_t source_mac[6] = {0};
    uint8_t target_mac[6] = {0};
    uint8_t self_mac[6] = {0};
    ESP_ERROR_CHECK(esp_wifi_get_mac(WIFI_IF_STA, self_mac));
    portENTER_CRITICAL(&runtime_mux);
    runtime_peer_t *peer = runtime_peer_slot_locked(recv_info->src_addr, now_ms);
    peer->group_mask = remote_mask;
    peer->rssi = rssi;
    if (peer->smooth_rssi == 0) peer->smooth_rssi = rssi;
    int samples = smooth_samples < 1 ? 1 : smooth_samples;
    peer->smooth_rssi = ((peer->smooth_rssi * (samples - 1)) + rssi) / samples;
    smooth_rssi = peer->smooth_rssi;
    uint32_t delta_ms = 0;
    if (peer->last_update_ms > 0 && now_ms > peer->last_update_ms) {
        delta_ms = (uint32_t)(now_ms - peer->last_update_ms);
    }
    peer->last_seen_ms = now_ms;
    peer->last_update_ms = now_ms;
    if (judge == 0) {
        portEXIT_CRITICAL(&runtime_mux);
        return;
    }
    bool matched = runtime_signal_match_from_rssi(smooth_rssi, rssi_min, rssi_max, signal);
    runtime_peer_t *competition_owner = NULL;
    bool owner_active = true;
    if (base == 3) {
        competition_owner = runtime_competition_owner_locked(rssi_min, rssi_max, signal, now_ms, missing_ms);
        owner_active = (competition_owner == peer);
    }
    bool active_for_rule = matched && owner_active;
    if (!active_for_rule) {
        if (peer->mismatch_start_ms == 0) {
            peer->mismatch_start_ms = now_ms;
        }
        if ((uint32_t)(now_ms - peer->mismatch_start_ms) >= missing_ms) {
            peer->candidate_first_ms = 0;
            peer->active_start_ms = 0;
            peer->matched_count = 0;
            if (timer_action == 1 || base == 3) {
                peer->accumulated_ms = 0;
            }
        }
    } else {
        peer->mismatch_start_ms = 0;
        peer->matched_count++;
        if (peer->candidate_first_ms == 0) {
            peer->candidate_first_ms = now_ms;
            peer->active_start_ms = now_ms;
        }
        if (trigger == 2 || trigger == 3 || trigger == 5 || base == 2 || base == 3) {
            peer->accumulated_ms += delta_ms;
        }
        bool cooldown_ok = peer->last_event_ms == 0 || (uint32_t)(now_ms - peer->last_event_ms) >= cooldown_ms;
        bool repeat_ok = repeat == 1 || repeat == 5 || !peer->found;
        if (repeat != 1 && repeat != 5 && peer->found) repeat_ok = false;
        if (cooldown_ok && repeat_ok) {
            uint32_t target_window = target_ms ? target_ms : hold;
            if (trigger == 2 || base == 2 || base == 3) {
                should_trigger = peer->accumulated_ms >= target_window;
            } else if (trigger == 3) {
                should_trigger = peer->accumulated_ms >= target_window;
            } else if (trigger == 4) {
                should_trigger = peer->matched_count >= runtime_rule_target_count;
            } else if (trigger == 5) {
                should_trigger = peer->accumulated_ms >= (period_ms ? period_ms : hold);
            } else {
                should_trigger = (uint32_t)(now_ms - peer->candidate_first_ms) >= hold;
            }
        }
        if (should_trigger) {
            peer->found = true;
            peer->last_event_ms = now_ms;
            if (trigger == 5 || repeat == 5 || repeat == 1) {
                peer->accumulated_ms = 0;
                peer->candidate_first_ms = now_ms;
                peer->active_start_ms = now_ms;
                peer->matched_count = 0;
            }
        }
    }
    if (judge == 2) {
        memcpy(source_mac, recv_info->src_addr, 6);
        memcpy(target_mac, self_mac, 6);
        source_mask = remote_mask;
        target_mask = runtime_group_mask;
    } else {
        memcpy(source_mac, self_mac, 6);
        memcpy(target_mac, recv_info->src_addr, 6);
        source_mask = runtime_group_mask;
        target_mask = remote_mask;
    }
    portEXIT_CRITICAL(&runtime_mux);

    if (!should_trigger) return;
    last_trigger_ms = now_ms;
    runtime_play_trigger_effect_once(trigger_spec, rssi, smooth_rssi);
    send_runtime_event_v2(source_mac, target_mac, source_mask, target_mask, smooth_rssi, trigger);
}

static void runtime_beacon_task(void *pvParameter)
{
    ensure_peer_exists(broadcast_mac);
    int64_t last_stat_ms = 0;
    while (1) {
        bool configured = false;
        bool started = false;
        bool running = effect_running;
        bool meter_enabled = false;
        uint16_t room = 0;
        uint32_t group_mask = 0;
        portENTER_CRITICAL(&runtime_mux);
        configured = runtime_configured;
        started = runtime_started;
        room = runtime_room_hash;
        group_mask = runtime_group_mask;
        meter_enabled = runtime_meter_enabled;
        portEXIT_CRITICAL(&runtime_mux);

        if (configured && started && running && group_mask != 0) {
            char msg[96];
            snprintf(msg, sizeof(msg), "BEACON|%u|%u|%u",
                     (unsigned int)room, (unsigned int)group_mask, (unsigned int)beacon_seq++);
            esp_now_send(broadcast_mac, (const uint8_t *)msg, strlen(msg) + 1);
            int64_t now_ms = esp_timer_get_time() / 1000;
            uint32_t stat_interval_ms = meter_enabled ? 1000 : RUNTIME_STAT_MS;
            if (last_stat_ms == 0 || now_ms - last_stat_ms >= stat_interval_ms) {
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

static rgb_color_t signal_meter_color(float ratio)
{
    if (ratio < 0.0f) ratio = 0.0f;
    if (ratio > 1.0f) ratio = 1.0f;
    if (ratio < 0.5f) {
        float t = ratio * 2.0f;
        return (rgb_color_t){255, (uint8_t)(180.0f * t), 0};
    }
    float t = (ratio - 0.5f) * 2.0f;
    return (rgb_color_t){(uint8_t)(255.0f * (1.0f - t)), 220, (uint8_t)(40.0f * t)};
}

static uint8_t runtime_signal_meter_suppress_mask(void)
{
    uint8_t mask = 0;
    portENTER_CRITICAL(&runtime_mux);
    if (runtime_meter_enabled && runtime_configured && runtime_started &&
        !runtime_trigger_effect_active && runtime_meter_port < 3) {
        mask = (uint8_t)(1 << runtime_meter_port);
    }
    portEXIT_CRITICAL(&runtime_mux);
    return mask;
}

static bool runtime_meter_peer_is_trackable(const runtime_peer_t *peer, uint8_t repeat_mode,
                                            int64_t now_ms, uint32_t missing_ms)
{
    if (!peer || !peer->used || peer->last_seen_ms == 0) return false;
    if ((uint32_t)(now_ms - peer->last_seen_ms) > missing_ms) return false;
    if (peer->found && repeat_mode != 1 && repeat_mode != 5) return false;
    return true;
}

static void render_signal_meter_overlay(void)
{
    bool enabled = false;
    bool configured = false;
    bool started = false;
    uint8_t port = 0;
    uint16_t led_count = 10;
    int weak_rssi = -90;
    int strong_rssi = -35;
    uint16_t compression_x100 = 100;
    uint32_t missing_ms = 3000;
    uint8_t repeat_mode = 2;
    int best_rssi = -127;
    bool have_signal = false;
    bool trigger_active = false;
    int64_t now_ms = esp_timer_get_time() / 1000;
    static int64_t last_render_ms = 0;
    static int last_lit = -1;
    static uint8_t last_port = 0xff;

    portENTER_CRITICAL(&runtime_mux);
    enabled = runtime_meter_enabled;
    configured = runtime_configured;
    started = runtime_started;
    trigger_active = runtime_trigger_effect_active;
    port = runtime_meter_port;
    led_count = runtime_meter_led_count;
    weak_rssi = runtime_meter_weak_rssi;
    strong_rssi = runtime_meter_strong_rssi;
    compression_x100 = runtime_meter_compression_x100;
    missing_ms = runtime_rule_missing_ms;
    repeat_mode = runtime_rule_repeat;
    if (enabled && configured && started) {
        runtime_peer_t *tracked = NULL;
        if (runtime_meter_track_active) {
            for (int i = 0; i < RUNTIME_PEER_LIMIT; i++) {
                runtime_peer_t *peer = &runtime_peers[i];
                if (peer->used && memcmp(peer->mac, runtime_meter_tracked_mac, 6) == 0) {
                    tracked = peer;
                    break;
                }
            }
        }

        uint32_t track_missing_ms = missing_ms > SIGNAL_METER_LOCK_MIN_MS ? missing_ms : SIGNAL_METER_LOCK_MIN_MS;
        if (tracked && runtime_meter_peer_is_trackable(tracked, repeat_mode, now_ms, track_missing_ms)) {
            have_signal = (uint32_t)(now_ms - tracked->last_seen_ms) <= missing_ms;
            best_rssi = tracked->smooth_rssi;
        } else {
            runtime_clear_meter_track_locked();
            tracked = NULL;
        }

        for (int i = 0; i < RUNTIME_PEER_LIMIT; i++) {
            runtime_peer_t *peer = &runtime_peers[i];
            if (tracked) break;
            if (!runtime_meter_peer_is_trackable(peer, repeat_mode, now_ms, missing_ms)) continue;
            if (!have_signal || peer->smooth_rssi > best_rssi) {
                have_signal = true;
                best_rssi = peer->smooth_rssi;
                runtime_meter_track_active = true;
                memcpy(runtime_meter_tracked_mac, peer->mac, sizeof(runtime_meter_tracked_mac));
            }
        }
    }
    portEXIT_CRITICAL(&runtime_mux);

    if (!enabled || !configured || !started || port >= 3) return;
    if (led_count < 1) led_count = 1;
    if (led_count > 200) led_count = 200;
    if (led_ports_led_count((int)port) < (int)led_count) {
        led_ports_set_count((int)port, (int)led_count);
    }

    int lit = 0;
    float ratio = 0.0f;
    int low = weak_rssi;
    int high = strong_rssi;
    if (have_signal && high < low) {
        int tmp = low;
        low = high;
        high = tmp;
    }
    if (have_signal) {
        ratio = high == low ? 1.0f : ((float)(best_rssi - low) / (float)(high - low));
        if (ratio < 0.0f) ratio = 0.0f;
        if (ratio > 1.0f) ratio = 1.0f;
        float curve = (float)compression_x100 / 100.0f;
        if (curve < 0.2f) curve = 0.2f;
        if (curve > 5.0f) curve = 5.0f;
        ratio = powf(ratio, curve);
        lit = (int)(ratio * (float)led_count + 0.999f);
        if (lit < 0) lit = 0;
        if (lit > (int)led_count) lit = (int)led_count;
    }

    if (trigger_active) {
        last_lit = -1;
        return;
    }
    if (last_port == port && last_lit == lit && (now_ms - last_render_ms) < SIGNAL_METER_RENDER_MS) {
        return;
    }

    led_ports_render_meter((int)port, (int)led_count, lit, signal_meter_color(ratio), 0.95f);
    last_render_ms = now_ms;
    last_lit = lit;
    last_port = port;
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

            led_ports_force_clear_all(LED_BLACKOUT_SWEEP_COUNT);
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
                default_effect_set_suppressed_ports(0);
                led_ports_force_clear_all(LED_BLACKOUT_SWEEP_COUNT);
                leds_already_cleared = true;
                default_effect_reset();
                ESP_LOGI(TAG, "Effect stopped, all LEDs off.");
            }

            wait_or_control_change(1000);
            continue;
        }

        leds_already_cleared = false;
        runtime_restore_idle_if_trigger_expired();
        default_effect_set_suppressed_ports(runtime_signal_meter_suppress_mask());
        default_effect_render_frame();
        render_signal_meter_overlay();
        wait_or_control_change(30);
    }
}

static void apply_command(wand_cmd_t cmd)
{
    if (cmd == CMD_START) {
        char idle_spec[RUNTIME_SPEC_LEN] = {0};
        portENTER_CRITICAL(&runtime_mux);
        runtime_started = true;
        runtime_clear_trigger_effect_locked();
        runtime_clear_peers_locked();
        runtime_copy_idle_spec_locked(idle_spec, sizeof(idle_spec));
        stat_seq = 0;
        portEXIT_CRITICAL(&runtime_mux);

        if (!default_effect_set_spec(idle_spec)) {
            default_effect_set_spec("silent");
            ESP_LOGW(TAG, "START idle spec invalid, falling back to silent: %s", idle_spec);
        }
        effect_running = true;
        identify_restore_running = true;
        identify_cancel_requested = true;
        ESP_LOGI(TAG, "START received: idle effect restored and runtime resumed len=%u.",
                 (unsigned int)strlen(idle_spec));
    } else if (cmd == CMD_STOP) {
        portENTER_CRITICAL(&runtime_mux);
        runtime_started = false;
        runtime_clear_trigger_effect_locked();
        portEXIT_CRITICAL(&runtime_mux);

        effect_running = false;
        identify_requested = false;
        identify_cancel_requested = true;
        identify_restore_running = false;
        default_effect_set_suppressed_ports(0);
        led_ports_force_clear_all(LED_BLACKOUT_SWEEP_COUNT);
        default_effect_reset();
        ESP_LOGI(TAG, "STOP received: stopping effect and force-clearing LEDs.");
    } else if (cmd == CMD_IDENTIFY) {
        identify_restore_running = effect_running;
        identify_cancel_requested = false;
        identify_requested = true;
        ESP_LOGI(TAG, "IDENTIFY received: flashing LED1/LED2/LED3.");
    } else if (cmd == CMD_TEST_EFFECT) {
        char trigger_spec[RUNTIME_SPEC_LEN] = {0};
        portENTER_CRITICAL(&runtime_mux);
        runtime_clear_trigger_effect_locked();
        snprintf(trigger_spec, sizeof(trigger_spec), "%s", runtime_trigger_spec);
        portEXIT_CRITICAL(&runtime_mux);
        if (trigger_spec[0] == '\0') {
            snprintf(trigger_spec, sizeof(trigger_spec), "silent");
        }
        led_ports_force_clear_all(LED_BLACKOUT_SWEEP_COUNT);
        default_effect_reset();
        if (default_effect_set_spec(trigger_spec)) {
            effect_running = true;
            identify_cancel_requested = true;
            identify_restore_running = true;
            ESP_LOGI(TAG, "TEST_EFFECT received: playing trigger effect until STOP len=%u: %s", (unsigned int)strlen(trigger_spec), trigger_spec);
        } else {
            ESP_LOGW(TAG, "TEST_EFFECT ignored, invalid trigger spec: %s", trigger_spec);
        }
    } else if (cmd == CMD_PLAY_ONCE) {
        char trigger_spec[RUNTIME_SPEC_LEN] = {0};
        portENTER_CRITICAL(&runtime_mux);
        snprintf(trigger_spec, sizeof(trigger_spec), "%s", runtime_trigger_spec);
        portEXIT_CRITICAL(&runtime_mux);
        if (trigger_spec[0] == '\0') {
            snprintf(trigger_spec, sizeof(trigger_spec), "silent");
        }
        effect_running = true;
        identify_cancel_requested = true;
        identify_restore_running = true;
        runtime_play_trigger_effect_once(trigger_spec, 0, 0);
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

    if (strncmp(msg, "RULE|", 5) == 0) {
        if (!apply_runtime_rule(recv_info ? recv_info->src_addr : NULL, msg + 5)) {
            ESP_LOGW(TAG, "Invalid RULE: %s", msg);
        }
        return;
    }

    if (strncmp(msg, "METER|", 6) == 0) {
        if (!apply_runtime_meter_config(msg + 6)) {
            ESP_LOGW(TAG, "Invalid METER: %s", msg);
        }
        return;
    }

    if (strncmp(msg, "TRG|", 4) == 0) {
        apply_runtime_trigger_spec(msg + 4);
        return;
    }

    if (strncmp(msg, "PAIR|", 5) == 0) {
        if (!apply_runtime_pair_filter(msg + 5)) {
            ESP_LOGW(TAG, "Invalid PAIR: %s", msg);
        }
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
    } else if (strcmp(msg, "PLAY_ONCE") == 0) {
        cmd = CMD_PLAY_ONCE;
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
        led_ports_force_clear_all(LED_BLACKOUT_SWEEP_COUNT);
    }
}
