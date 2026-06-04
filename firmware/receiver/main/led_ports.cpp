#include "led_ports.h"

#include <string.h>

#include "driver/spi_master.h"
#include "esp_err.h"
#include "esp_log.h"
#include "led_strip.h"
#include "led_strip_rmt.h"
#include "led_strip_spi.h"

static const char *TAG = "LED_PORTS";

#define GPIO_LED1 22
#define GPIO_LED2 21
#define GPIO_LED3 20

#define LED_PORT_COUNT 3
#define DEFAULT_LED_COUNT 25
#define MAX_LED_COUNT 200

typedef struct {
    const char *label;
    int gpio;
    int led_count;
    bool use_spi;
    led_strip_handle_t strip;
} led_port_t;

static led_port_t led_ports[LED_PORT_COUNT] = {
    {"LED1", GPIO_LED1, DEFAULT_LED_COUNT, true, NULL},
    {"LED2", GPIO_LED2, DEFAULT_LED_COUNT, false, NULL},
    {"LED3", GPIO_LED3, DEFAULT_LED_COUNT, false, NULL},
};

static int active_led_port_count = 0;

static led_strip_handle_t init_led_strip_spi_fixed(int gpio_num, int led_num);
static led_strip_handle_t init_led_strip_rmt_fixed(int gpio_num, int led_num);

static led_strip_handle_t create_strip_for_port(const led_port_t *cfg, int led_num)
{
    if (!cfg || led_num <= 0) return NULL;
    return cfg->use_spi
        ? init_led_strip_spi_fixed(cfg->gpio, led_num)
        : init_led_strip_rmt_fixed(cfg->gpio, led_num);
}

static led_strip_handle_t init_led_strip_spi_fixed(int gpio_num, int led_num)
{
    if (led_num <= 0) return NULL;

    led_strip_handle_t strip = NULL;

    led_strip_config_t strip_config;
    memset(&strip_config, 0, sizeof(strip_config));
    strip_config.strip_gpio_num = gpio_num;
    strip_config.max_leds = (uint32_t)led_num;

    led_strip_spi_config_t spi_config;
    memset(&spi_config, 0, sizeof(spi_config));
    spi_config.spi_bus = SPI2_HOST;
    spi_config.flags.with_dma = true;

    esp_err_t ret = led_strip_new_spi_device(&strip_config, &spi_config, &strip);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "SPI init failed on GPIO%d: %s", gpio_num, esp_err_to_name(ret));
        return NULL;
    }

    led_strip_clear(strip);
    led_strip_refresh(strip);
    return strip;
}

static led_strip_handle_t init_led_strip_rmt_fixed(int gpio_num, int led_num)
{
    if (led_num <= 0) return NULL;

    led_strip_handle_t strip = NULL;
    led_strip_config_t strip_config;
    memset(&strip_config, 0, sizeof(strip_config));
    strip_config.strip_gpio_num = gpio_num;
    strip_config.max_leds = (uint32_t)led_num;

    led_strip_rmt_config_t rmt_config;
    memset(&rmt_config, 0, sizeof(rmt_config));
    rmt_config.clk_src = RMT_CLK_SRC_DEFAULT;
    rmt_config.resolution_hz = 10 * 1000 * 1000;
    rmt_config.flags.with_dma = false;

    esp_err_t ret = led_strip_new_rmt_device(&strip_config, &rmt_config, &strip);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "RMT init failed on GPIO%d: %s", gpio_num, esp_err_to_name(ret));
        return NULL;
    }

    led_strip_clear(strip);
    led_strip_refresh(strip);
    return strip;
}

bool led_ports_init(void)
{
    active_led_port_count = 0;

    for (int port = 0; port < LED_PORT_COUNT; port++) {
        led_port_t *cfg = &led_ports[port];
        cfg->strip = create_strip_for_port(cfg, cfg->led_count);

        if (cfg->strip) {
            ESP_LOGI(TAG, "%s ready: GPIO%d, %d LEDs, backend=%s",
                     cfg->label, cfg->gpio, cfg->led_count, cfg->use_spi ? "SPI" : "RMT");
            active_led_port_count++;
        } else {
            ESP_LOGW(TAG, "%s unavailable: GPIO%d, backend=%s",
                     cfg->label, cfg->gpio, cfg->use_spi ? "SPI" : "RMT");
        }
    }

    ESP_LOGI(TAG, "LED port init summary: %d/%d ports active.", active_led_port_count, LED_PORT_COUNT);
    return active_led_port_count > 0;
}

void led_ports_clear_all(void)
{
    for (int port = 0; port < LED_PORT_COUNT; port++) {
        if (led_ports[port].strip) {
            led_strip_clear(led_ports[port].strip);
            led_strip_refresh(led_ports[port].strip);
        }
    }
}

int led_ports_count(void)
{
    return LED_PORT_COUNT;
}

int led_ports_active_count(void)
{
    return active_led_port_count;
}

int led_ports_led_count(int port_index)
{
    if (port_index < 0 || port_index >= LED_PORT_COUNT) {
        return 0;
    }
    return led_ports[port_index].led_count;
}

bool led_ports_set_count(int port_index, int led_count)
{
    if (port_index < 0 || port_index >= LED_PORT_COUNT) {
        return false;
    }
    if (led_count < 1) led_count = 1;
    if (led_count > MAX_LED_COUNT) led_count = MAX_LED_COUNT;

    led_port_t *cfg = &led_ports[port_index];
    if (cfg->strip && cfg->led_count == led_count) {
        return true;
    }

    led_strip_handle_t next = create_strip_for_port(cfg, led_count);
    if (!next) {
        ESP_LOGW(TAG, "%s reconfigure failed, keeping %d LEDs", cfg->label, cfg->led_count);
        return false;
    }

    if (cfg->strip) {
        led_strip_clear(cfg->strip);
        led_strip_refresh(cfg->strip);
        led_strip_del(cfg->strip);
    } else {
        active_led_port_count++;
    }
    cfg->strip = next;
    cfg->led_count = led_count;
    ESP_LOGI(TAG, "%s reconfigured: GPIO%d, %d LEDs, backend=%s",
             cfg->label, cfg->gpio, cfg->led_count, cfg->use_spi ? "SPI" : "RMT");
    return true;
}

const char *led_ports_label(int port_index)
{
    if (port_index < 0 || port_index >= LED_PORT_COUNT) {
        return "";
    }
    return led_ports[port_index].label;
}

void led_ports_set_all(int port_index, rgb_color_t color, float scale)
{
    if (port_index < 0 || port_index >= LED_PORT_COUNT || !led_ports[port_index].strip) {
        return;
    }

    if (scale < 0.0f) scale = 0.0f;
    if (scale > 1.0f) scale = 1.0f;

    for (int i = 0; i < led_ports[port_index].led_count; i++) {
        led_strip_set_pixel(
            led_ports[port_index].strip,
            i,
            (uint32_t)(color.red * scale),
            (uint32_t)(color.green * scale),
            (uint32_t)(color.blue * scale)
        );
    }
}

void led_ports_set_range(int port_index, int start_index, int count, rgb_color_t color, float scale)
{
    if (port_index < 0 || port_index >= LED_PORT_COUNT || !led_ports[port_index].strip) {
        return;
    }

    if (start_index < 0) {
        count += start_index;
        start_index = 0;
    }
    if (count <= 0 || start_index >= led_ports[port_index].led_count) {
        return;
    }

    int end_index = start_index + count;
    if (end_index > led_ports[port_index].led_count) {
        end_index = led_ports[port_index].led_count;
    }

    if (scale < 0.0f) scale = 0.0f;
    if (scale > 1.0f) scale = 1.0f;

    for (int i = start_index; i < end_index; i++) {
        led_strip_set_pixel(
            led_ports[port_index].strip,
            i,
            (uint32_t)(color.red * scale),
            (uint32_t)(color.green * scale),
            (uint32_t)(color.blue * scale)
        );
    }
}

void led_ports_refresh(int port_index)
{
    if (port_index < 0 || port_index >= LED_PORT_COUNT || !led_ports[port_index].strip) {
        return;
    }
    led_strip_refresh(led_ports[port_index].strip);
}
