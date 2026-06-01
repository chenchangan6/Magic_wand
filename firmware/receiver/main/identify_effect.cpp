#include "identify_effect.h"

#include "led_ports.h"

#define IDENTIFY_VISIBLE_LEDS 10
#define IDENTIFY_STEP_COUNT 4
#define IDENTIFY_STEP_MS 500

int identify_effect_step_count(void)
{
    return IDENTIFY_STEP_COUNT;
}

uint32_t identify_effect_step_ms(void)
{
    return IDENTIFY_STEP_MS;
}

void identify_effect_render_step(int step_index)
{
    const rgb_color_t yellow = {255, 180, 0};
    const rgb_color_t blue = {0, 80, 255};

    led_ports_clear_all();

    if ((step_index % 2) == 0) {
        led_ports_set_range(0, 0, IDENTIFY_VISIBLE_LEDS, yellow, 1.0f);
        led_ports_refresh(0);
    } else {
        led_ports_set_range(1, 0, IDENTIFY_VISIBLE_LEDS, blue, 1.0f);
        led_ports_refresh(1);
    }
}
