#include "default_effect.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "effects.h"
#include "led_ports.h"

typedef enum {
    EFFECT_MODE_SELFTEST = 0,
    EFFECT_MODE_SOLID = 1,
    EFFECT_MODE_BREATH = 2,
    EFFECT_MODE_BLINK = 3,
    EFFECT_MODE_SILENT = 4,
    EFFECT_MODE_CYCLE = 5,
    EFFECT_MODE_CHASE = 6,
    EFFECT_MODE_PULSE = 7,
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
} runtime_effect_t;

static self_test_port_effect_t self_test_effects[] = {
    {{80, 0, 0}, 0.0f},
    {{0, 90, 255}, 1.570796f},
    {{0, 170, 120}, 3.141592f},
};

static runtime_effect_t runtime_effect = {
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
};
static float tick = 0.0f;
static uint32_t frame_ms = 0;
static uint16_t completed_cycles = 0;
static bool ended = false;
static bool hold_rendered = false;

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

static void set_selftest_defaults(void)
{
    memset(&runtime_effect, 0, sizeof(runtime_effect));
    runtime_effect.mode = EFFECT_MODE_SELFTEST;
    runtime_effect.port_mask = 0x07;
    runtime_effect.start_index = 0;
    runtime_effect.length = 25;
    runtime_effect.gap = 0;
    runtime_effect.colors[0] = (rgb_color_t){80, 0, 0};
    runtime_effect.colors[1] = (rgb_color_t){0, 90, 255};
    runtime_effect.colors[2] = (rgb_color_t){0, 170, 120};
    runtime_effect.end_color = (rgb_color_t){255, 255, 255};
    runtime_effect.speed_x1000 = 45;
    runtime_effect.brightness_pct = 100;
    runtime_effect.start_brightness_pct = 10;
    runtime_effect.end_brightness_pct = 100;
    runtime_effect.period_ms = 500;
    runtime_effect.duty_pct = 50;
    runtime_effect.repeat_count = 0;
    runtime_effect.accel_pct = 0;
    runtime_effect.end_hold_ms = 0;
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

bool default_effect_set_spec(const char *spec)
{
    if (spec == NULL || spec[0] == '\0' || strcmp(spec, "selftest") == 0) {
        set_selftest_defaults();
        default_effect_reset();
        return true;
    }

    if (strcmp(spec, "silent") == 0) {
        runtime_effect.mode = EFFECT_MODE_SILENT;
        default_effect_reset();
        return true;
    }

    char buf[192];
    snprintf(buf, sizeof(buf), "%s", spec);
    char *saveptr = NULL;
    char *mode = strtok_r(buf, "|", &saveptr);
    if (mode == NULL) return false;

    runtime_effect_t next = runtime_effect;
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
        next.brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
    } else if (strcmp(mode, "breath2") == 0) {
        next.mode = EFFECT_MODE_BREATH;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
        next.speed_x1000 = clamp_u16_int(next_int_token(&saveptr, 45), 1, 5000);
        next.brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
        next.repeat_count = clamp_u16_int(next_int_token(&saveptr, 0), 0, 9999);
        next.accel_pct = (int8_t)clamp_u8_int(next_int_token(&saveptr, 0) + 100, 0, 200) - 100;
        next.end_hold_ms = clamp_u16_int(next_int_token(&saveptr, 0), 0, 30000);
    } else if (strcmp(mode, "blink2") == 0) {
        next.mode = EFFECT_MODE_BLINK;
        parse_common_v2(&saveptr, &next);
        next_color_token(&saveptr, next.colors[0], &next.colors[0]);
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
        next.period_ms = clamp_u16_int(next_int_token(&saveptr, 600), 50, 20000);
        next.start_brightness_pct = clamp_u8_int(next_int_token(&saveptr, 10), 0, 100);
        next.end_brightness_pct = clamp_u8_int(next_int_token(&saveptr, 100), 0, 100);
        next.repeat_count = clamp_u16_int(next_int_token(&saveptr, 20), 0, 9999);
        next.accel_pct = (int8_t)clamp_u8_int(next_int_token(&saveptr, 70) + 100, 0, 200) - 100;
        next.end_hold_ms = clamp_u16_int(next_int_token(&saveptr, 3000), 0, 30000);
    } else {
        return false;
    }

    runtime_effect = next;
    default_effect_reset();
    return true;
}

void default_effect_reset(void)
{
    tick = 0.0f;
    frame_ms = 0;
    completed_cycles = 0;
    ended = false;
    hold_rendered = false;
}

static void clear_selected_ports(void)
{
    rgb_color_t black = {0, 0, 0};
    int port_count = led_ports_count();
    if (port_count > 3) port_count = 3;
    for (int port = 0; port < port_count; port++) {
        if ((runtime_effect.port_mask & (1 << port)) == 0) continue;
        led_ports_set_all(port, black, 0.0f);
    }
}

static void refresh_selected_ports(void)
{
    int port_count = led_ports_count();
    if (port_count > 3) port_count = 3;
    for (int port = 0; port < port_count; port++) {
        if ((runtime_effect.port_mask & (1 << port)) == 0) continue;
        led_ports_refresh(port);
    }
}

static void set_selected_pattern(rgb_color_t color, float scale)
{
    int port_count = led_ports_count();
    if (port_count > 3) port_count = 3;
    int step = (int)runtime_effect.gap + 1;
    if (step <= 0) step = 1;
    for (int port = 0; port < port_count; port++) {
        if ((runtime_effect.port_mask & (1 << port)) == 0) continue;
        led_ports_set_all(port, (rgb_color_t){0, 0, 0}, 0.0f);
        for (int i = 0; i < (int)runtime_effect.length; i += step) {
            led_ports_set_range(port, (int)runtime_effect.start_index + i, 1, color, scale);
        }
    }
    refresh_selected_ports();
}

static uint16_t adjusted_period_ms(void)
{
    float factor = 1.0f - ((float)runtime_effect.accel_pct / 100.0f) * ((float)completed_cycles / (float)(runtime_effect.repeat_count ? runtime_effect.repeat_count : 20));
    if (factor < 0.15f) factor = 0.15f;
    if (factor > 3.0f) factor = 3.0f;
    uint16_t period = (uint16_t)((float)runtime_effect.period_ms * factor);
    if (period < 30) period = 30;
    return period;
}

static bool handle_end_state(rgb_color_t hold_color)
{
    if (!ended) return false;
    if (runtime_effect.end_hold_ms > 0 && frame_ms <= runtime_effect.end_hold_ms) {
        if (!hold_rendered) {
            set_selected_pattern(hold_color, 1.0f);
            hold_rendered = true;
        }
        frame_ms += 30;
        return true;
    }
    set_selftest_defaults();
    default_effect_reset();
    return false;
}

static bool update_cycle_count(uint16_t period)
{
    frame_ms += 30;
    if (frame_ms >= period) {
        frame_ms = 0;
        if (runtime_effect.repeat_count > 0) {
            completed_cycles++;
            if (completed_cycles >= runtime_effect.repeat_count) {
                ended = true;
                frame_ms = 0;
                return true;
            }
        }
    }
    return false;
}

static void render_selftest(void)
{
    const float pi_2 = 6.283185f;
    int port_count = led_ports_count();
    int effect_count = (int)(sizeof(self_test_effects) / sizeof(self_test_effects[0]));
    if (port_count > effect_count) port_count = effect_count;
    for (int port = 0; port < port_count; port++) {
        float scale = effects_sine_breath_scale(tick, self_test_effects[port].phase);
        led_ports_set_all(port, self_test_effects[port].color, scale);
        led_ports_refresh(port);
    }
    tick += 0.045f;
    if (tick > pi_2) tick -= pi_2;
}

static void render_solid(void)
{
    set_selected_pattern(runtime_effect.colors[0], clamp01((float)runtime_effect.brightness_pct / 100.0f));
}

static void render_breath(void)
{
    if (handle_end_state(runtime_effect.colors[0])) return;
    const float pi_2 = 6.283185f;
    float brightness = clamp01((float)runtime_effect.brightness_pct / 100.0f);
    float speed = (float)runtime_effect.speed_x1000 / 1000.0f;
    if (runtime_effect.accel_pct != 0 && runtime_effect.repeat_count > 0) {
        float progress = clamp01((float)completed_cycles / (float)runtime_effect.repeat_count);
        speed *= 1.0f + ((float)runtime_effect.accel_pct / 100.0f) * progress;
        if (speed < 0.005f) speed = 0.005f;
    }
    set_selected_pattern(runtime_effect.colors[0], brightness * effects_sine_breath_scale(tick, 0.0f));
    tick += speed;
    if (tick > pi_2) {
        tick -= pi_2;
        if (runtime_effect.repeat_count > 0 && ++completed_cycles >= runtime_effect.repeat_count) {
            ended = true;
            frame_ms = 0;
        }
    }
}

static void render_blink(void)
{
    if (handle_end_state(runtime_effect.colors[0])) return;
    uint16_t period = adjusted_period_ms();
    float duty = clamp01((float)runtime_effect.duty_pct / 100.0f);
    float pos = (float)frame_ms / (float)period;
    float scale = (pos < duty) ? clamp01((float)runtime_effect.brightness_pct / 100.0f) : 0.0f;
    set_selected_pattern(runtime_effect.colors[0], scale);
    update_cycle_count(period);
}

static void render_cycle(void)
{
    if (handle_end_state(runtime_effect.colors[2])) return;
    uint16_t period = adjusted_period_ms();
    int color_index = completed_cycles % 3;
    set_selected_pattern(runtime_effect.colors[color_index], clamp01((float)runtime_effect.brightness_pct / 100.0f));
    update_cycle_count(period);
}

static void render_chase_like(bool pulse)
{
    rgb_color_t hold = pulse ? runtime_effect.end_color : runtime_effect.colors[0];
    if (handle_end_state(hold)) return;
    uint16_t period = adjusted_period_ms();
    int lit_count = runtime_effect.length > 0 ? runtime_effect.length : 1;
    int pos = completed_cycles % lit_count;
    float progress = runtime_effect.repeat_count ? clamp01((float)completed_cycles / (float)runtime_effect.repeat_count) : 0.0f;
    rgb_color_t color = pulse ? mix_color(runtime_effect.colors[0], runtime_effect.end_color, progress) : runtime_effect.colors[0];
    float brightness = pulse
        ? ((float)runtime_effect.start_brightness_pct + ((float)runtime_effect.end_brightness_pct - (float)runtime_effect.start_brightness_pct) * progress) / 100.0f
        : (float)runtime_effect.brightness_pct / 100.0f;

    clear_selected_ports();
    int port_count = led_ports_count();
    if (port_count > 3) port_count = 3;
    for (int port = 0; port < port_count; port++) {
        if ((runtime_effect.port_mask & (1 << port)) == 0) continue;
        led_ports_set_range(port, (int)runtime_effect.start_index + pos, 1, color, clamp01(brightness));
    }
    refresh_selected_ports();
    update_cycle_count(period);
}

void default_effect_render_frame(void)
{
    switch (runtime_effect.mode) {
        case EFFECT_MODE_SILENT:
            break;
        case EFFECT_MODE_SOLID:
            render_solid();
            break;
        case EFFECT_MODE_BREATH:
            render_breath();
            break;
        case EFFECT_MODE_BLINK:
            render_blink();
            break;
        case EFFECT_MODE_CYCLE:
            render_cycle();
            break;
        case EFFECT_MODE_CHASE:
            render_chase_like(false);
            break;
        case EFFECT_MODE_PULSE:
            render_chase_like(true);
            break;
        case EFFECT_MODE_SELFTEST:
        default:
            render_selftest();
            break;
    }
}

