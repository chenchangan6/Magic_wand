// ESP32-C6 receiver: ESP-NOW START/STOP control + three LED breathing strips.
// STOP: stop current effect and turn all LEDs off.
// START: resume the effect. Duplicate START/STOP commands are ignored.

#include <stdio.h>
#include <string.h>
#include <math.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_now.h"
#include "esp_wifi.h"
#include "nvs_flash.h"

#include "driver/spi_master.h"
#include "led_strip.h"
#include "led_strip_rmt.h"
#include "led_strip_spi.h"

static const char *TAG = "MAGIC_WAND_RX";

// Physical pins from SCH_ESP32C6MINI_WAND.
#define GPIO_LED2 21 // CN4
#define GPIO_LED3 20 // CN5
#define GPIO_LED4 22 // CN6

// Independent strip lengths.
#define LEN_LED2 28
#define LEN_LED3 38
#define LEN_LED4 18

// The transmitter uses broadcast + channel=0. With no router connected, both
// ESP32-C6 modules normally stay on channel 1. If you later fix a channel on
// the transmitter, keep this value the same.
#define ESPNOW_CHANNEL 1

static led_strip_handle_t strip2 = NULL;
static led_strip_handle_t strip3 = NULL;
static led_strip_handle_t strip4 = NULL;

static TaskHandle_t led_task_handle = NULL;
static QueueHandle_t command_queue = NULL;
static volatile bool effect_running = true; // Receiver starts in RUN state.

typedef enum {
    CMD_START = 1,
    CMD_STOP = 2,
} wand_cmd_t;

static void clear_all_leds(void)
{
    if (strip2) {
        led_strip_clear(strip2);
        led_strip_refresh(strip2);
    }
    if (strip3) {
        led_strip_clear(strip3);
        led_strip_refresh(strip3);
    }
    if (strip4) {
        led_strip_clear(strip4);
        led_strip_refresh(strip4);
    }
}

// SPI backend for LED4.
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
        ESP_LOGE(TAG, "SPI init failed: %s", esp_err_to_name(ret));
        return NULL;
    }

    led_strip_clear(strip);
    led_strip_refresh(strip);
    return strip;
}

// RMT backend for LED2 and LED3.
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
    rmt_config.resolution_hz = 10 * 1000 * 1000; // 10MHz
    rmt_config.flags.with_dma = false;

    esp_err_t ret = led_strip_new_rmt_device(&strip_config, &rmt_config, &strip);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "RMT init failed: %s", esp_err_to_name(ret));
        return NULL;
    }

    led_strip_clear(strip);
    led_strip_refresh(strip);
    return strip;
}

static bool wait_or_control_change(uint32_t delay_ms)
{
    if (led_task_handle == NULL) {
        vTaskDelay(pdMS_TO_TICKS(delay_ms));
        return false;
    }

    return ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(delay_ms)) > 0;
}

// Main LED task. It is the only task that touches led_strip handles.
static void led_breathing_task(void *pvParameter)
{
    float tick = 0.0f;
    bool leds_already_cleared = false;

    // 0.0434 stretches the active light time to roughly 7.2 seconds.
    const float speed = 0.0434f;

    const float PI_2 = 6.283185f;
    const float PHASE_SHIFT = 2.094f;
    const float TIME_OFFSET = 1.570796f;
    const float TOTAL_ACTIVE_TICK = PI_2 + (PHASE_SHIFT * 2.0f);

    while (1) {
        if (!effect_running) {
            if (!leds_already_cleared) {
                clear_all_leds();
                leds_already_cleared = true;
                tick = 0.0f;
                ESP_LOGI(TAG, "Effect stopped, all LEDs off.");
            }

            wait_or_control_change(1000);
            continue;
        }

        leds_already_cleared = false;

        float scale2 = 0.0f;
        float scale3 = 0.0f;
        float scale4 = 0.0f;

        if (tick >= 0.0f && tick <= PI_2) {
            scale2 = (sin(tick - TIME_OFFSET) + 1.0f) / 2.0f;
        }

        if (tick >= PHASE_SHIFT && tick <= (PI_2 + PHASE_SHIFT)) {
            scale3 = (sin((tick - PHASE_SHIFT) - TIME_OFFSET) + 1.0f) / 2.0f;
        }

        if (tick >= (PHASE_SHIFT * 2.0f) && tick <= TOTAL_ACTIVE_TICK) {
            scale4 = (sin((tick - PHASE_SHIFT * 2.0f) - TIME_OFFSET) + 1.0f) / 2.0f;
        }

        if (strip2) {
            for (int i = 0; i < LEN_LED2; i++) {
                led_strip_set_pixel(strip2, i, 0, (uint32_t)(191 * scale2), (uint32_t)(255 * scale2));
            }
            led_strip_refresh(strip2);
        }

        if (strip3) {
            for (int i = 0; i < LEN_LED3; i++) {
                led_strip_set_pixel(strip3, i, 0, (uint32_t)(255 * scale3), (uint32_t)(128 * scale3));
            }
            led_strip_refresh(strip3);
        }

        if (strip4) {
            for (int i = 0; i < LEN_LED4; i++) {
                led_strip_set_pixel(strip4, i, (uint32_t)(150 * scale4), 0, 0);
            }
            led_strip_refresh(strip4);
        }

        tick += speed;

        if (tick > TOTAL_ACTIVE_TICK) {
            clear_all_leds();
            ESP_LOGI(TAG, "Breathing cycle ended, entering 5-second idle.");

            // A notify-aware wait lets START/STOP interrupt the 5-second idle.
            wait_or_control_change(5000);
            tick = 0.0f;
        } else {
            wait_or_control_change(30);
        }
    }
}

static void apply_command(wand_cmd_t cmd)
{
    if (cmd == CMD_START) {
        if (effect_running) {
            ESP_LOGI(TAG, "START ignored: effect already running.");
            return;
        }

        effect_running = true;
        ESP_LOGI(TAG, "START received: effect resumed.");
    } else if (cmd == CMD_STOP) {
        if (!effect_running) {
            ESP_LOGI(TAG, "STOP ignored: effect already stopped.");
            return;
        }

        effect_running = false;
        ESP_LOGI(TAG, "STOP received: stopping effect.");
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

    char msg[16];
    int copy_len = data_len;
    if (copy_len >= (int)sizeof(msg)) {
        copy_len = sizeof(msg) - 1;
    }
    memcpy(msg, data, copy_len);
    msg[copy_len] = '\0';

    wand_cmd_t cmd;
    if (strcmp(msg, "START") == 0 || strcmp(msg, "STRAT") == 0) {
        cmd = CMD_START;
    } else if (strcmp(msg, "STOP") == 0) {
        cmd = CMD_STOP;
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
    ESP_LOGI(TAG, "Boot: initializing ESP-NOW and LED strips...");

    command_queue = xQueueCreate(8, sizeof(wand_cmd_t));
    if (command_queue == NULL) {
        ESP_LOGE(TAG, "Command queue creation failed.");
        return;
    }

    wifi_espnow_init();

    strip2 = init_led_strip_rmt_fixed(GPIO_LED2, LEN_LED2);
    strip3 = init_led_strip_rmt_fixed(GPIO_LED3, LEN_LED3);
    strip4 = init_led_strip_spi_fixed(GPIO_LED4, LEN_LED4);

    if (strip2 && strip3 && strip4) {
        ESP_LOGI(TAG, "Hardware init OK, starting LED and command tasks.");
        xTaskCreate(led_breathing_task, "led_breathing", 4096, NULL, 5, &led_task_handle);
        xTaskCreate(command_task, "wand_command", 4096, NULL, 6, NULL);
    } else {
        ESP_LOGE(TAG, "Hardware init failed. Check pins and memory/stack.");
        clear_all_leds();
    }
}
