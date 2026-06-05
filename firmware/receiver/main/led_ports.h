#pragma once

#include <stdint.h>

typedef struct {
    uint8_t red;
    uint8_t green;
    uint8_t blue;
} rgb_color_t;

bool led_ports_init(void);
void led_ports_clear_all(void);
void led_ports_clear_port(int port_index);
void led_ports_force_clear_all(int sweep_count);
int led_ports_count(void);
int led_ports_active_count(void);
int led_ports_led_count(int port_index);
bool led_ports_set_count(int port_index, int led_count);
const char *led_ports_label(int port_index);
void led_ports_set_all(int port_index, rgb_color_t color, float scale);
void led_ports_set_range(int port_index, int start_index, int count, rgb_color_t color, float scale);
void led_ports_render_meter(int port_index, int led_count, int lit_count, rgb_color_t color, float scale);
void led_ports_refresh(int port_index);
