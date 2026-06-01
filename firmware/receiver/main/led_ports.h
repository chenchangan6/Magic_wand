#pragma once

#include <stdint.h>

typedef struct {
    uint8_t red;
    uint8_t green;
    uint8_t blue;
} rgb_color_t;

bool led_ports_init(void);
void led_ports_clear_all(void);
int led_ports_count(void);
int led_ports_active_count(void);
int led_ports_led_count(int port_index);
const char *led_ports_label(int port_index);
void led_ports_set_all(int port_index, rgb_color_t color, float scale);
void led_ports_set_range(int port_index, int start_index, int count, rgb_color_t color, float scale);
void led_ports_refresh(int port_index);
