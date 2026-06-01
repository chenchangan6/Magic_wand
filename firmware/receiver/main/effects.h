#pragma once

#include "led_ports.h"

float effects_sine_breath_scale(float tick, float phase);
float effects_square_blink_scale(float tick, float period, float duty);
void effects_solid_port(int port_index, rgb_color_t color, float brightness);
void effects_breath_port(int port_index, rgb_color_t color, float tick, float phase);
void effects_blink_port(int port_index, rgb_color_t color, float tick, float period, float duty, float brightness);
