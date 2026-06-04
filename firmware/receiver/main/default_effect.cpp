#include "default_effect.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_log.h"
#include "effects.h"
#include "led_ports.h"

static const char *TAG = "MAGIC_EFFECT";

typedef enum {
    EFFECT_MODE_SELFTEST = 0,
    EFFECT_MODE_SOLID = 1,
    EFFECT_MODE_BREATH = 2,
    EFFECT_MODE_BLINK = 3,
    EFFECT_MODE_SILENT = 4,
    EFFECT_MODE_CYCLE = 5,
    EFFECT_MODE_CHASE = 6,
    EFFECT_MODE_PULSE = 7,
    EFFECT_MODE_GRADIENT = 8,
} effect_mode_t;

typedef struct {
    rgb_color_t color;
    float phase;
} self_test_port_effect_t;

typedef struct {
    effect_mode_t mode;
    uint8_t port_mask;
    uint16_t start_index;
    uint16_t length;
    uint8_t gap;
    rgb_color_t colors[3];
    rgb_color_t end_color;
    uint16_t speed_x1000;
    uint8_t brightness_pct;
    uint8_t start_brightness_pct;
    uint8_t end_brightness_pct;
    uint16_t period_ms;
    uint8_t duty_pct;
    uint16_t repeat_count;   // 0 = infinite
    int8_t accel_pct;        // positive = faster over time
    uint16_t end_hold_ms;
    uint16_t pulse_duration_ms;
} runtime_effect_t;

typedef struct {
    float tick;
    uint32_t frame_ms;
    uint16_t completed_cycles;
    bool ended;
    bool hold_rendered;
} runtime_effect_state_t;

#define MAX_RUNTIME_TRACKS 3
#define MAX_RENDER_LEDS 200

static self_test_port_effect_t self_test_effects[] = {
    {{80, 0, 0}, 0.0f},
    {{0, 90, 255}, 1.570796f},
    {{0, 170, 120}, 3.141592f},
};

static const runtime_effect_t default_selftest_effect = {
    .mode = EFFECT_MODE_SELFTEST,
    .port_mask = 0x07,
    .start_index = 0,
    .length = 25,
    .gap = 0,
    .colors = {{80, 0, 0}, {0, 90, 255}, {0, 170, 120}},
    .end_color = {255, 255, 255},
    .speed_x1000 = 45,
    .brightness_pct = 100,
    .start_brightness_pct = 10,
    .end_brightness_pct = 100,
    .period_ms = 500,
    .duty_pct = 50,
    .repeat_count = 0,
    .accel_pct = 0,
    .end_hold_ms = 0,
    .pulse_duration_ms = 0,
};

static runtime_effect_t runtime_effects[MAX_RUNTIME_TRACKS] = {default_selftest_effect};
static runtime_effect_state_t runtime_states[MAX_RUNTIME_TRACKS] = {};
static uint8_t runtime_effect_count = 1;
static float selftest_tick = 0.0f;

static float clamp01(float value)
{
    if (value < 0.0f) return 0.0f;
    if (value > 1.0f) return 1.0f;
    return value;
}

static uint8_t clamp_u8_int(int value, int min_value, int max_value)
{
    if (value < min_value) value = min_value;
    if (value > max_value) value = max_value;
    return (uint8_t)value;
}

static uint16_t clamp_u16_int(int value, int min_value, int max_value)
{
    if (value < min_value) value = min_value;
    if (value > max_value) value = max_value;
    return (uint16_t)value;
}

static bool parse_hex_color(const char *text, rgb_color_t *out)
{
    if (text == NULL || out == NULL || strlen(text) < 6) return false;
    char buf[7] = {0};
    memcpy(buf, text, 6);
    char *end = NULL;
    long value = strtol(buf, &end, 16);
    if (end == buf || *end != '\0' || value < 0 || value > 0xFFFFFF) return false;
    out->red = (uint8_t)((value >> 16) & 0xFF);
    out->green = (uint8_t)((value >> 8) & 0xFF);
    out->blue = (uint8_t)(value & 0xFF);
    return true;
}

static rgb_color_t mix_color(rgb_color_t a, rgb_color_t b, float t)
{
    t = clamp01(t);
    rgb_color_t out;
    out.red = (uint8_t)((float)a.red + ((float)b.red - (float)a.red) * t);
    out.green = (uint8_t)((float)a.green + ((float)b.green - (float)a.green) * t);
    out.blue = (uint8_t)((float)a.blue + ((float)b.blue - (float)a.blue) * t);
    return out;
}

static void reset_effect_state(runtime_effect_state_t *state)
{
    if (!state) return;
    memset(state, 0, sizeof(*state));
}

static void reset_all_effect_states(void)
{
    for (int i = 0; i < MAX_RUNTIME_TRACKS; i++) {
        reset_effect_state(&runtime_states[i]);
    }
    selftest_tick = 0.0f;
}

static const char *effect_mode_name(effect_mode_t mode)
{
    switch (mode) {
        case EFFECT_MODE_SOLID: return "solid";
        case EFFECT_MODE_BREATH: return "breath";
        case EFFECT_MODE_BLINK: return "blink";
        case EFFECT_MODE_SILENT: return "silent";
        case EFFECT_MODE_CYCLE: return "cycle";
        case EFFECT_MODE_CHASE: return "chase";
        case EFFECT_MODE_PULSE: return "pulse";
        case EFFECT_MODE_GRADIENT: return "gradient";
        case EFFECT_MODE_SELFTEST:
        default:
            return "selftest";
    }
}

static void sync_led_counts_from_effects(void)
{
    int desired[3] = {0, 0, 0};
    for (uint8_t i = 0; i < runtime_effect_count && i < MAX_RUNTIME_TRACKS; i++) {
        const runtime_effect_t *effect = &runtime_effects[i];
        if (effect->mode == EFFECT_MODE_SILENT || effect->mode == EFFECT_MODE_SELFTEST) continue;
        int required = (int)effect->start_index + (int)effect->length;
        if (required < 1) required = 1;
        if (required > MAX_RENDER_LEDS) required = MAX_RENDER_LEDS;
        for (int port = 0; port < 3; port++) {
            if ((effect->port_mask & (1 << port)) == 0) continue;
            if (required > desired[port]) desired[port] = required;
        }
    }
    for (int port = 0; port < 3; port++) {
        if (desired[port] > 0 && desired[port] != led_ports_led_count(port)) {
            led_ports_set_count(port, desired[port]);
        }
    }
}

static void log_runtime_effects(const char *source)
{
    ESP_LOGI(TAG, "%s parsed tracks=%u", source ? source : "effect", (unsigned int)runtime_effect_count);
    for (uint8_t i = 0; i < runtime_effect_count && i < MAX_RUNTIME_TRACKS; i++) {
        const runtime_effect_t *effect = &runtime_effects[i];
        ESP_LOGI(TAG,
                 "track%u mode=%s ports=0x%02X start=%u len=%u gap=%u speed=%u period=%u brightness=%u repeat=%u hold=%u",
                 (unsigned int)(i + 1),
                 effect_mode_name(effect->mode),
                 (unsigned int)effect->port_mask,
                 (unsigned int)effect->start_index,
                 (unsigned int)effect->length,
                 (unsigned int)effect->gap,
                 (unsigned int)effect->speed_x1000,
                 (unsigned int)effect->period_ms,
                 (unsigned int)effect->brightness_pct,
                 (unsigned int)effect->repeat_count,
                 (unsigned int)effect->end_hold_ms);
    }
}

static void set_selftest_defaults(void)
{
    runtime_effects[0] = default_selftest_effect;
    runtime_effect_count = 1;
    reset_all_effect_states();
}

static void set_silent_defaults(void)
{
    runtime_effects[0] = default_selftest_effect;
    runtime_effects[0].mode = EFFECT_MODE_SILENT;
    runtime_effect_count = 1;
    reset_all_effect_states();
}

static int next_int_token(char **saveptr, int fallback)
{
    char *p = strtok_r(NULL, "|", saveptr);
    return p ? atoi(p) : fallback;
}

static bool next_color_token(char **saveptr, rgb_color_t fallback, rgb_color_t *out)
{
    char *p = strtok_r(NULL, "|", saveptr);
    if (p && parse_hex_color(p, out)) return true;
    *out = fallback;
    return false;
}

static void parse_common_v2(char **saveptr, runtime_effect_t *next)
{
    next->port_mask = clamp_u8_int(next_int_token(saveptr, 7), 0, 7);
    next->start_index = clamp_u16_int(next_int_token(saveptr, 0), 0, 200);
    next->length = clamp_u16_int(next_int_token(saveptr, 25), 0, 200);
    next->gap = clamp_u8_int(next_int_token(saveptr, 0), 0, 20);
}

static bool parse_single_effect_spec(const char *spec, runtime_effect_t *out)
{
    if (!spec || !out) return false;
    if (strcmp(spec, "selftest") == 0) {
        *out = default_selftest_effect;
        return true;
    }
    if (strcmp(spec, "silent") == 0) {
        *out = default_selftest_effect;
        out->mode = EFFECT_MODE_SILENT;
        return true;
    }

    char buf[384];
    snprintf(buf, sizeof(buf), "%s", spec);
    char *saveptr = NULL;
    char *mode = strtok_r(buf, "|", &saveptr);
    if (mode == NULL) return false;

    runtime_effect_t next = default_selftest_effect;
    rgb_color_t parsed_color;

    if (strcmp(mode, "solid") == 0 || strcmp(mode, "breath") == 0 || strcmp(mode, "blink") == 0) {
        if (strcmp(mode, "solid") == 0) next.mode = EFFECT_MODE_SOLID;
        if (strcmp(mode, "breath") == 0) next.mode = EFFECT_MODE_BREATH;
        if (strcmp(mode, "blink") == 0) next.mode = EFFECT_MODE_BLINK;
        char *c1 = strtok_r(NULL, "|", &saveptr);
        char *c2 = strtok_r(NULL, "|", &saveptr);
        char *c3 = strtok_r(NULL, "|", &saveptr);
        char *p4 = strtok_r(NULL, "|", &saveptr);
        char *p5 = strtok_r(NULL, "|", &saveptr);
        char *p6 = strtok_r(NULL, "|", &saveptr);
        if (c1 && parse_hex_color(c1, &parsed_color)) next.colors[0] = parsed_color;
        if (c2 && parse_hex_color(c2, &parsed_color)) next.colors[1] = parsed_color;
        if (c3 && parse_hex_color(c3, &parsed_color)) next.colors[2] = parsed_color;
        next.port_mask = 0x07;
        next.start_index = 0;
        next.length = 25;
        next.gap = 0;
        if (next.mode == EFFECT_MODE_SOLID) next.brightness_pct = clamp_u8_int(atoi(p4 ? p4 : "100"), 0, 100);
        if (next.mode == EFFECT_MODE_BREATH) {
            next.speed_x1000 = clamp_u16_int(atoi(p4 ? p4 : "45"), 1, 5000);
            next.brightness_pct = clamp_u8_int(atoi(p5 ? p5 : "100"), 0, 100);
        }
        if (next.mode == EFFECT_MODE_BLINK) {
            next.period_ms = clamp_u16_int(atoi(p4 ? p4 : "500"), 50, 20000);
            next.duty_pct = clamp_u8_int(atoi(p5 ? p5 : "50"), 1, 99);
            next.brightness_pct = clamp_u8_int(atoi(p6 ? p6 : "100"), 0, 100);
        }
    } else if (strcmp(mode, "solid2") == 0) {
        next.mode = EFFECT_MODE_SOLID;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
        next.colors[1] = next.colors[0];
        next.colors[2] = next.colors[0];
        next.brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
    } else if (strcmp(mode, "solid3") == 0) {
        next.mode = EFFECT_MODE_SOLID;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
        next_color_token(&saveptr, next.colors[0], &next.colors[1]);
        next_color_token(&saveptr, next.colors[0], &next.colors[2]);
        next.brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
    } else if (strcmp(mode, "gradient3") == 0) {
        next.mode = EFFECT_MODE_GRADIENT;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
        next_color_token(&saveptr, next.colors[0], &next.colors[1]);
        next_color_token(&saveptr, next.colors[0], &next.colors[2]);
        next.period_ms = clamp_u16_int(next_int_token(&saveptr, 1800), 50, 20000);
        next.brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
        next.repeat_count = clamp_u16_int(next_int_token(&saveptr, 0), 0, 9999);
        next.accel_pct = (int8_t)clamp_u8_int(next_int_token(&saveptr, 0) + 100, 0, 200) - 100;
        next.end_hold_ms = clamp_u16_int(next_int_token(&saveptr, 0), 0, 30000);
    } else if (strcmp(mode, "breath2") == 0) {
        next.mode = EFFECT_MODE_BREATH;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
        next.colors[1] = next.colors[0];
        next.colors[2] = next.colors[0];
        next.speed_x1000 = clamp_u16_int(next_int_token(&saveptr, 45), 1, 5000);
        next.brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
        next.repeat_count = clamp_u16_int(next_int_token(&saveptr, 0), 0, 9999);
        next.accel_pct = (int8_t)clamp_u8_int(next_int_token(&saveptr, 0) + 100, 0, 200) - 100;
        next.end_hold_ms = clamp_u16_int(next_int_token(&saveptr, 0), 0, 30000);
    } else if (strcmp(mode, "breath3") == 0) {
        next.mode = EFFECT_MODE_BREATH;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
        next_color_token(&saveptr, next.colors[0], &next.colors[1]);
        next_color_token(&saveptr, next.colors[0], &next.colors[2]);
        next.speed_x1000 = clamp_u16_int(next_int_token(&saveptr, 45), 1, 5000);
        next.brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
        next.repeat_count = clamp_u16_int(next_int_token(&saveptr, 0), 0, 9999);
        next.accel_pct = (int8_t)clamp_u8_int(next_int_token(&saveptr, 0) + 100, 0, 200) - 100;
        next.end_hold_ms = clamp_u16_int(next_int_token(&saveptr, 0), 0, 30000);
    } else if (strcmp(mode, "blink2") == 0) {
        next.mode = EFFECT_MODE_BLINK;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
        next.colors[1] = next.colors[0];
        next.colors[2] = next.colors[0];
        next.period_ms = clamp_u16_int(next_int_token(&saveptr, 500), 50, 20000);
        next.duty_pct = clamp_u8_int(next_int_token(&saveptr, 50), 1, 99);
        next.brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
        next.repeat_count = clamp_u16_int(next_int_token(&saveptr, 0), 0, 9999);
        next.accel_pct = (int8_t)clamp_u8_int(next_int_token(&saveptr, 0) + 100, 0, 200) - 100;
        next.end_hold_ms = clamp_u16_int(next_int_token(&saveptr, 0), 0, 30000);
    } else if (strcmp(mode, "blink3") == 0) {
        next.mode = EFFECT_MODE_BLINK;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
        next_color_token(&saveptr, next.colors[0], &next.colors[1]);
        next_color_token(&saveptr, next.colors[0], &next.colors[2]);
        next.period_ms = clamp_u16_int(next_int_token(&saveptr, 500), 50, 20000);
        next.duty_pct = clamp_u8_int(next_int_token(&saveptr, 50), 1, 99);
        next.brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
        next.repeat_count = clamp_u16_int(next_int_token(&saveptr, 0), 0, 9999);
        next.accel_pct = (int8_t)clamp_u8_int(next_int_token(&saveptr, 0) + 100, 0, 200) - 100;
        next.end_hold_ms = clamp_u16_int(next_int_token(&saveptr, 0), 0, 30000);
    } else if (strcmp(mode, "cycle2") == 0) {
        next.mode = EFFECT_MODE_CYCLE;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
        next_color_token(&saveptr, next.colors[1], &next.colors[1]);
        next_color_token(&saveptr, next.colors[2], &next.colors[2]);
        next.period_ms = clamp_u16_int(next_int_token(&saveptr, 500), 50, 20000);
        next.brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
        next.repeat_count = clamp_u16_int(next_int_token(&saveptr, 0), 0, 9999);
        next.accel_pct = (int8_t)clamp_u8_int(next_int_token(&saveptr, 0) + 100, 0, 200) - 100;
        next.end_hold_ms = clamp_u16_int(next_int_token(&saveptr, 0), 0, 30000);
    } else if (strcmp(mode, "chase2") == 0) {
        next.mode = EFFECT_MODE_CHASE;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
        next.colors[1] = next.colors[0];
        next.colors[2] = next.colors[0];
        next.period_ms = clamp_u16_int(next_int_token(&saveptr, 500), 50, 20000);
        next.brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
        next.repeat_count = clamp_u16_int(next_int_token(&saveptr, 0), 0, 9999);
        next.accel_pct = (int8_t)clamp_u8_int(next_int_token(&saveptr, 0) + 100, 0, 200) - 100;
        next.end_hold_ms = clamp_u16_int(next_int_token(&saveptr, 0), 0, 30000);
    } else if (strcmp(mode, "chase3") == 0) {
        next.mode = EFFECT_MODE_CHASE;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
        next_color_token(&saveptr, next.colors[0], &next.colors[1]);
        next_color_token(&saveptr, next.colors[0], &next.colors[2]);
        next.period_ms = clamp_u16_int(next_int_token(&saveptr, 500), 50, 20000);
        next.brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
        next.repeat_count = clamp_u16_int(next_int_token(&saveptr, 0), 0, 9999);
        next.accel_pct = (int8_t)clamp_u8_int(next_int_token(&saveptr, 0) + 100, 0, 200) - 100;
        next.end_hold_ms = clamp_u16_int(next_int_token(&saveptr, 0), 0, 30000);
    } else if (strcmp(mode, "pulse2") == 0) {
        next.mode = EFFECT_MODE_PULSE;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
        next_color_token(&saveptr, next.end_color, &next.end_color);
        next.colors[1] = next.colors[0];
        next.colors[2] = next.end_color;
        next.period_ms = clamp_u16_int(next_int_token(&saveptr, 600), 50, 20000);
        next.start_brightness_pct = clamp_u8_int(next_int_token(&saveptr, 10), 0, 100);
        next.end_brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
        next.repeat_count = clamp_u16_int(next_int_token(&saveptr, 20), 0, 9999);
        next.accel_pct = (int8_t)clamp_u8_int(next_int_token(&saveptr, 70) + 100, 0, 200) - 100;
        next.end_hold_ms = clamp_u16_int(next_int_token(&saveptr, 3000), 0, 30000);
    } else if (strcmp(mode, "pulse3") == 0) {
        next.mode = EFFECT_MODE_PULSE;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
        next_color_token(&saveptr, next.colors[0], &next.colors[1]);
        next_color_token(&saveptr, next.colors[0], &next.colors[2]);
        next.end_color = next.colors[2];
        next.period_ms = clamp_u16_int(next_int_token(&saveptr, 600), 50, 20000);
        next.start_brightness_pct = clamp_u8_int(next_int_token(&saveptr, 10), 0, 100);
        next.end_brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
        next.repeat_count = clamp_u16_int(next_int_token(&saveptr, 20), 0, 9999);
        next.accel_pct = (int8_t)clamp_u8_int(next_int_token(&saveptr, 70) + 100, 0, 200) - 100;
        next.end_hold_ms = clamp_u16_int(next_int_token(&saveptr, 3000), 0, 30000);
        next.pulse_duration_ms = clamp_u16_int(next_int_token(&saveptr, 0), 0, 30000);
    } else {
        return false;
    }

    *out = next;
    return true;
}

bool default_effect_set_spec(const char *spec)
{
    if (spec == NULL || spec[0] == '\0' || strcmp(spec, "selftest") == 0) {
        set_selftest_defaults();
        log_runtime_effects("selftest");
        return true;
    }

    if (strcmp(spec, "silent") == 0) {
        set_silent_defaults();
        log_runtime_effects("silent");
        return true;
    }

    if (strncmp(spec, "multi2;", 7) == 0) {
        char buf[384];
        snprintf(buf, sizeof(buf), "%s", spec + 7);
        char *saveptr = NULL;
        char *part = strtok_r(buf, ";", &saveptr);
        runtime_effect_t parsed[MAX_RUNTIME_TRACKS];
        uint8_t count = 0;
        while (part && count < MAX_RUNTIME_TRACKS) {
            if (part[0] != '\0' && parse_single_effect_spec(part, &parsed[count])) {
                count++;
            }
            part = strtok_r(NULL, ";", &saveptr);
        }
        if (count == 0) return false;
        memset(runtime_effects, 0, sizeof(runtime_effects));
        for (uint8_t i = 0; i < count; i++) {
            runtime_effects[i] = parsed[i];
        }
        runtime_effect_count = count;
        reset_all_effect_states();
        sync_led_counts_from_effects();
        log_runtime_effects("multi");
        return true;
    }

    if (!parse_single_effect_spec(spec, &runtime_effects[0])) return false;
    runtime_effect_count = 1;
    reset_all_effect_states();
    sync_led_counts_from_effects();
    log_runtime_effects("single");
    return true;
}

void default_effect_reset(void)
{
    reset_all_effect_states();
}

static void clear_selected_ports(const runtime_effect_t *effect)
{
    rgb_color_t black = {0, 0, 0};
    int port_count = led_ports_count();
    if (port_count > 3) port_count = 3;
    for (int port = 0; port < port_count; port++) {
        if ((effect->port_mask & (1 << port)) == 0) continue;
        led_ports_set_all(port, black, 0.0f);
    }
}

static void refresh_selected_ports(const runtime_effect_t *effect)
{
    int port_count = led_ports_count();
    if (port_count > 3) port_count = 3;
    for (int port = 0; port < port_count; port++) {
        if ((effect->port_mask & (1 << port)) == 0) continue;
        led_ports_refresh(port);
    }
}

static void set_selected_pattern(const runtime_effect_t *effect, rgb_color_t color, float scale)
{
    int port_count = led_ports_count();
    if (port_count > 3) port_count = 3;
    int step = (int)effect->gap + 1;
    if (step <= 0) step = 1;
    for (int port = 0; port < port_count; port++) {
        if ((effect->port_mask & (1 << port)) == 0) continue;
        led_ports_set_all(port, (rgb_color_t){0, 0, 0}, 0.0f);
        for (int i = 0; i < (int)effect->length; i += step) {
            led_ports_set_range(port, (int)effect->start_index + i, 1, color, scale);
        }
    }
    refresh_selected_ports(effect);
}

static uint16_t adjusted_period_ms(const runtime_effect_t *effect, const runtime_effect_state_t *state)
{
    float factor = 1.0f - ((float)effect->accel_pct / 100.0f) * ((float)state->completed_cycles / (float)(effect->repeat_count ? effect->repeat_count : 20));
    if (factor < 0.15f) factor = 0.15f;
    if (factor > 3.0f) factor = 3.0f;
    uint16_t period = (uint16_t)((float)effect->period_ms * factor);
    if (period < 30) period = 30;
    return period;
}

static bool handle_end_state(runtime_effect_t *effect, runtime_effect_state_t *state, rgb_color_t hold_color)
{
    if (!state->ended) return false;
    if (effect->end_hold_ms > 0 && state->frame_ms <= effect->end_hold_ms) {
        if (!state->hold_rendered) {
            set_selected_pattern(effect, hold_color, 1.0f);
            state->hold_rendered = true;
        }
        state->frame_ms += 30;
        return true;
    }
    clear_selected_ports(effect);
    refresh_selected_ports(effect);
    effect->mode = EFFECT_MODE_SILENT;
    reset_effect_state(state);
    return false;
}

static bool update_cycle_count(runtime_effect_t *effect, runtime_effect_state_t *state, uint16_t period)
{
    state->frame_ms += 30;
    if (state->frame_ms >= period) {
        state->frame_ms = 0;
        if (effect->repeat_count > 0) {
            state->completed_cycles++;
            if (state->completed_cycles >= effect->repeat_count) {
                state->ended = true;
                state->frame_ms = 0;
                return true;
            }
        }
    }
    return false;
}

static int selected_active_count(const runtime_effect_t *effect)
{
    int step = (int)effect->gap + 1;
    if (step <= 0) step = 1;
    int count = ((int)effect->length + step - 1) / step;
    return count > 0 ? count : 1;
}

static int circular_distance_int(int index, int head, int total)
{
    if (total <= 0) return 0;
    int diff = index - head;
    if (diff < 0) diff = -diff;
    int wrap = total - diff;
    return diff < wrap ? diff : wrap;
}

static rgb_color_t palette_color_for(const runtime_effect_t *effect, int active_index, int offset)
{
    int idx = (active_index + offset) % 3;
    if (idx < 0) idx += 3;
    return effect->colors[idx];
}

static void set_indexed_pattern(const runtime_effect_t *effect, const rgb_color_t *colors, const float *scales)
{
    int port_count = led_ports_count();
    if (port_count > 3) port_count = 3;
    int step = (int)effect->gap + 1;
    if (step <= 0) step = 1;
    int active_count = selected_active_count(effect);
    for (int port = 0; port < port_count; port++) {
        if ((effect->port_mask & (1 << port)) == 0) continue;
        led_ports_set_all(port, (rgb_color_t){0, 0, 0}, 0.0f);
        for (int i = 0; i < active_count; i++) {
            int led_index = (int)effect->start_index + (i * step);
            if (led_index >= (int)effect->start_index + (int)effect->length) break;
            led_ports_set_range(port, led_index, 1, colors[i], scales[i]);
        }
    }
    refresh_selected_ports(effect);
}

static uint16_t preview_shift_period(uint16_t period, int divisions)
{
    if (divisions <= 0) divisions = 1;
    uint16_t value = period / divisions;
    return value < 120 ? 120 : value;
}

static float pulse_speed_scale_int(int speed)
{
    float normalized = clamp01((float)speed / 100.0f);
    return 10.0f - (9.0f * powf(normalized, 0.8f));
}

static void render_selftest(void)
{
    const float pi_2 = 6.283185f;
    int port_count = led_ports_count();
    int effect_count = (int)(sizeof(self_test_effects) / sizeof(self_test_effects[0]));
    if (port_count > effect_count) port_count = effect_count;
    for (int port = 0; port < port_count; port++) {
        float scale = effects_sine_breath_scale(selftest_tick, self_test_effects[port].phase);
        led_ports_set_all(port, self_test_effects[port].color, scale);
        led_ports_refresh(port);
    }
    selftest_tick += 0.045f;
    if (selftest_tick > pi_2) selftest_tick -= pi_2;
}

static void render_solid(runtime_effect_t *effect)
{
    int active_count = selected_active_count(effect);
    if (active_count > MAX_RENDER_LEDS) active_count = MAX_RENDER_LEDS;
    rgb_color_t colors[MAX_RENDER_LEDS];
    float scales[MAX_RENDER_LEDS];
    float brightness = clamp01((float)effect->brightness_pct / 100.0f);
    for (int i = 0; i < active_count; i++) {
        colors[i] = palette_color_for(effect, i, 0);
        scales[i] = brightness;
    }
    set_indexed_pattern(effect, colors, scales);
}

static void render_breath(runtime_effect_t *effect, runtime_effect_state_t *state)
{
    if (handle_end_state(effect, state, effect->colors[0])) return;
    const float pi_2 = 6.283185f;
    if (state->frame_ms == 0 && state->completed_cycles == 0 && state->tick == 0.0f) {
        state->tick = -1.570796f;
    }
    float brightness = clamp01((float)effect->brightness_pct / 100.0f);
    float speed = (float)effect->speed_x1000 / 1000.0f;
    if (effect->accel_pct != 0 && effect->repeat_count > 0) {
        float progress = clamp01((float)state->completed_cycles / (float)effect->repeat_count);
        speed *= 1.0f + ((float)effect->accel_pct / 100.0f) * progress;
        if (speed < 0.005f) speed = 0.005f;
    }
    float sweep = 0.5f + 0.5f * sinf(state->tick);
    float wave = sweep * sweep;
    rgb_color_t color = sweep < 0.5f
        ? mix_color(effect->colors[0], effect->colors[1], sweep * 2.0f)
        : mix_color(effect->colors[1], effect->colors[2], (sweep - 0.5f) * 2.0f);
    set_selected_pattern(effect, color, brightness * wave);
    state->tick += speed;
    state->frame_ms += 30;
    if (state->tick > pi_2) {
        state->tick -= pi_2;
        if (effect->repeat_count > 0 && ++state->completed_cycles >= effect->repeat_count) {
            state->ended = true;
            state->frame_ms = 0;
        }
    }
}

static void render_gradient(runtime_effect_t *effect, runtime_effect_state_t *state)
{
    if (handle_end_state(effect, state, effect->colors[2])) return;
    uint16_t period = adjusted_period_ms(effect, state);
    float pos = (float)state->frame_ms / (float)period;
    if (pos < 0.0f) pos = 0.0f;
    if (pos > 1.0f) pos = 1.0f;
    rgb_color_t color = pos < 0.5f
        ? mix_color(effect->colors[0], effect->colors[1], pos * 2.0f)
        : mix_color(effect->colors[1], effect->colors[2], (pos - 0.5f) * 2.0f);
    float brightness = clamp01((float)effect->brightness_pct / 100.0f);
    set_selected_pattern(effect, color, brightness);
    update_cycle_count(effect, state, period);
}

static void render_blink(runtime_effect_t *effect, runtime_effect_state_t *state)
{
    if (handle_end_state(effect, state, effect->colors[0])) return;
    uint16_t period = adjusted_period_ms(effect, state);
    float duty = clamp01((float)effect->duty_pct / 100.0f);
    float pos = (float)state->frame_ms / (float)period;
    float scale = (pos < duty) ? clamp01((float)effect->brightness_pct / 100.0f) : 0.0f;
    int active_count = selected_active_count(effect);
    if (active_count > MAX_RENDER_LEDS) active_count = MAX_RENDER_LEDS;
    rgb_color_t colors[MAX_RENDER_LEDS];
    float scales[MAX_RENDER_LEDS];
    for (int i = 0; i < active_count; i++) {
        colors[i] = palette_color_for(effect, i, 0);
        scales[i] = scale;
    }
    set_indexed_pattern(effect, colors, scales);
    update_cycle_count(effect, state, period);
}

static void render_cycle(runtime_effect_t *effect, runtime_effect_state_t *state)
{
    if (handle_end_state(effect, state, effect->colors[2])) return;
    uint16_t period = adjusted_period_ms(effect, state);
    int active_count = selected_active_count(effect);
    if (active_count > MAX_RENDER_LEDS) active_count = MAX_RENDER_LEDS;
    uint16_t shift_period = preview_shift_period(period, 3);
    int shift = (int)(state->frame_ms / shift_period);
    rgb_color_t colors[MAX_RENDER_LEDS];
    float scales[MAX_RENDER_LEDS];
    float brightness = clamp01((float)effect->brightness_pct / 100.0f);
    for (int i = 0; i < active_count; i++) {
        colors[i] = palette_color_for(effect, i, shift);
        scales[i] = brightness;
    }
    set_indexed_pattern(effect, colors, scales);
    update_cycle_count(effect, state, period);
}

static void render_chase_like(runtime_effect_t *effect, runtime_effect_state_t *state, bool pulse)
{
    rgb_color_t hold = pulse ? effect->end_color : effect->colors[0];
    if (handle_end_state(effect, state, hold)) return;
    uint16_t period = adjusted_period_ms(effect, state);
    int active_count = selected_active_count(effect);
    if (active_count > MAX_RENDER_LEDS) active_count = MAX_RENDER_LEDS;
    rgb_color_t colors[MAX_RENDER_LEDS];
    float scales[MAX_RENDER_LEDS];
    float brightness = clamp01((float)effect->brightness_pct / 100.0f);

    if (!pulse) {
        uint16_t head_period = period / active_count;
        if (head_period < 180) head_period = 180;
        uint32_t loop_period = (uint32_t)head_period * (uint32_t)active_count;
        if (loop_period < (uint32_t)head_period) loop_period = head_period;
        int head = (int)((state->frame_ms / head_period) % active_count);
        for (int i = 0; i < active_count; i++) {
            int dist = circular_distance_int(i, head, active_count);
            float trail = dist == 0 ? 1.0f : 0.0f;
            colors[i] = palette_color_for(effect, i, 0);
            scales[i] = trail * brightness;
        }
        set_indexed_pattern(effect, colors, scales);
        state->frame_ms += 30;
        if (state->frame_ms >= loop_period) {
            state->frame_ms = 0;
            if (effect->repeat_count > 0) {
                state->completed_cycles++;
                if (state->completed_cycles >= effect->repeat_count) {
                    state->ended = true;
                }
            }
        }
        return;
    }

    int pulse_count = effect->repeat_count ? effect->repeat_count : 15;
    if (pulse_count < 1) pulse_count = 1;
    if (pulse_count > 80) pulse_count = 80;
    float weights[80];
    float total_weight = 0.0f;
    for (int i = 0; i < pulse_count; i++) {
        float t = pulse_count == 1 ? 1.0f : (float)i / (float)(pulse_count - 1);
        int speed = (int)((float)effect->start_brightness_pct + ((float)effect->end_brightness_pct - (float)effect->start_brightness_pct) * t);
        weights[i] = pulse_speed_scale_int(speed);
        total_weight += weights[i];
    }
    if (total_weight <= 0.0f) total_weight = 1.0f;
    float base_span = (float)period / (float)pulse_count;
    if (base_span < 140.0f) base_span = 140.0f;
    float total_span = 0.0f;
    for (int i = 0; i < pulse_count; i++) {
        total_span += effect->pulse_duration_ms > 0
            ? ((float)effect->pulse_duration_ms * weights[i]) / total_weight
            : base_span * weights[i];
    }
    if (total_span < 1.0f) total_span = (float)period;
    float loop_ms = total_span + (float)effect->end_hold_ms;
    float loop_time = loop_ms > 0.0f ? fmodf((float)state->frame_ms, loop_ms) : (float)state->frame_ms;
    if (loop_time >= total_span) {
        for (int i = 0; i < active_count; i++) {
            colors[i] = palette_color_for(effect, i, 0);
            scales[i] = brightness;
        }
        set_indexed_pattern(effect, colors, scales);
        state->frame_ms += 30;
        if (state->frame_ms > (uint32_t)(loop_ms + 60000.0f)) state->frame_ms = 0;
        return;
    }
    float cursor = 0.0f;
    int pulse_index = 0;
    for (; pulse_index < pulse_count; pulse_index++) {
        float span = effect->pulse_duration_ms > 0
            ? ((float)effect->pulse_duration_ms * weights[pulse_index]) / total_weight
            : base_span * weights[pulse_index];
        if (loop_time < cursor + span) break;
        cursor += span;
    }
    if (pulse_index >= pulse_count) pulse_index = pulse_count - 1;
    float span = effect->pulse_duration_ms > 0
        ? ((float)effect->pulse_duration_ms * weights[pulse_index]) / total_weight
        : base_span * weights[pulse_index];
    if (span < 1.0f) span = 1.0f;
    float pulse_phase = clamp01((loop_time - cursor) / span);
    int head = (int)(pulse_phase * (float)active_count);
    if (head >= active_count) head = active_count - 1;
    for (int i = 0; i < active_count; i++) {
        int dist = circular_distance_int(i, head, active_count);
        float trail = dist == 0 ? 1.0f : dist == 1 ? 0.35f : 0.0f;
        colors[i] = palette_color_for(effect, i, pulse_index);
        scales[i] = trail * brightness;
    }
    set_indexed_pattern(effect, colors, scales);
    state->frame_ms += 30;
    if (state->frame_ms > (uint32_t)(loop_ms + 60000.0f)) state->frame_ms = 0;
}

void default_effect_render_frame(void)
{
    for (uint8_t i = 0; i < runtime_effect_count && i < MAX_RUNTIME_TRACKS; i++) {
        runtime_effect_t *effect = &runtime_effects[i];
        runtime_effect_state_t *state = &runtime_states[i];
        switch (effect->mode) {
            case EFFECT_MODE_SILENT:
                break;
            case EFFECT_MODE_SOLID:
                render_solid(effect);
                break;
            case EFFECT_MODE_BREATH:
                render_breath(effect, state);
                break;
            case EFFECT_MODE_BLINK:
                render_blink(effect, state);
                break;
            case EFFECT_MODE_GRADIENT:
                render_gradient(effect, state);
                break;
            case EFFECT_MODE_CYCLE:
                render_cycle(effect, state);
                break;
            case EFFECT_MODE_CHASE:
                render_chase_like(effect, state, false);
                break;
            case EFFECT_MODE_PULSE:
                render_chase_like(effect, state, true);
                break;
            case EFFECT_MODE_SELFTEST:
            default:
                render_selftest();
                break;
        }
    }
}

