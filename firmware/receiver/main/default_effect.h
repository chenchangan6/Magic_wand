#pragma once

#include <stdint.h>

void default_effect_reset(void);
void default_effect_render_frame(void);
bool default_effect_set_spec(const char *spec);
void default_effect_set_suppressed_ports(uint8_t port_mask);
