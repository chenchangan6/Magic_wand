#include "effects.h"

#include <math.h>

static float clamp01(float value)
{
    if (value < 0.0f) return 0.0f;
    if (value > 1.0f) return 1.0f;
    return value;
}

float effects_sine_breath_scale(float tick, float phase)
{
    float scale = (sinf(tick + phase) + 1.0f) / 2.0f;
    return scale * scale;
}

float effects_square_blink_scale(float tick, float period, float duty)
{
    if (period <= 0.0f) {
        return 1.0f;
    }

    duty = clamp01(duty);
    float position = fmodf(tick, period);
    if (position < 0.0f) {
        position += period;
    }

    return position < (period * duty) ? 1.0f : 0.0f;
}

void effects_solid_port(int port_index, rgb_color_t color, float brightness)
{
    led_ports_set_all(port_index, color, clamp01(brightness));
    led_ports_refresh(port_index);
}

void effects_breath_port(int port_index, rgb_color_t color, float tick, float phase)
{
    effects_solid_port(port_index, color, effects_sine_breath_scale(tick, phase));
}

void effects_blink_port(int port_index, rgb_color_t color, float tick, float period, float duty, float brightness)
{
    float scale = effects_square_blink_scale(tick, period, duty) * clamp01(brightness);
    effects_solid_port(port_index, color, scale);
}
