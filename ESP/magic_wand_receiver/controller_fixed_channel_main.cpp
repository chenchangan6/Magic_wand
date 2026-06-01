// ESP32-C6 transmitter reference code.
// Use this as the control-side main.cpp if the receiver does not see packets.
// It fixes Wi-Fi channel to 1 and logs ESP-NOW send results.

#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_now.h"
#include "esp_wifi.h"
#include "nvs_flash.h"

static const char *TAG = "TX";

#define BTN ((gpio_num_t)9)
#define ESPNOW_CHANNEL 1

static uint8_t broadcast_mac[6] = {
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF
};

static bool next_stop = true;

static void send_cb(const uint8_t *mac_addr, esp_now_send_status_t status)
{
    ESP_LOGI(TAG, "SEND CB: %s", status == ESP_NOW_SEND_SUCCESS ? "SUCCESS" : "FAIL");
}

static void espnow_init(void)
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
    ESP_ERROR_CHECK(esp_now_register_send_cb(send_cb));

    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, broadcast_mac, 6);
    peer.channel = ESPNOW_CHANNEL;
    peer.ifidx = WIFI_IF_STA;
    peer.encrypt = false;
    ESP_ERROR_CHECK(esp_now_add_peer(&peer));

    uint8_t mac[6] = {0};
    uint8_t primary = 0;
    wifi_second_chan_t second = WIFI_SECOND_CHAN_NONE;
    ESP_ERROR_CHECK(esp_wifi_get_mac(WIFI_IF_STA, mac));
    ESP_ERROR_CHECK(esp_wifi_get_channel(&primary, &second));

    ESP_LOGI(TAG, "ESP-NOW READY, STA MAC=%02X:%02X:%02X:%02X:%02X:%02X, channel=%u",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5], primary);
}

static void btn_task(void *)
{
    gpio_config_t io = {};
    io.pin_bit_mask = (1ULL << BTN);
    io.mode = GPIO_MODE_INPUT;
    io.pull_up_en = GPIO_PULLUP_ENABLE;
    gpio_config(&io);

    bool last = true;

    while (1) {
        int now = gpio_get_level(BTN);

        if (last == 1 && now == 0) {
            vTaskDelay(pdMS_TO_TICKS(30));

            if (gpio_get_level(BTN) == 0) {
                const char *msg = next_stop ? "STOP" : "START";
                next_stop = !next_stop;

                ESP_LOGI(TAG, "BUTTON -> %s", msg);

                esp_err_t ret = esp_now_send(
                    broadcast_mac,
                    (const uint8_t *)msg,
                    strlen(msg) + 1
                );

                if (ret != ESP_OK) {
                    ESP_LOGE(TAG, "SEND FAIL: %s", esp_err_to_name(ret));
                }

                while (gpio_get_level(BTN) == 0) {
                    vTaskDelay(pdMS_TO_TICKS(10));
                }
            }
        }

        last = now;
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

extern "C" void app_main(void)
{
    ESP_LOGI(TAG, "BOOT");
    espnow_init();
    xTaskCreate(btn_task, "btn", 4096, NULL, 5, NULL);
}
