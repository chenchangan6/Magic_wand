idf_component_register(
    SRCS "main.cpp"
    INCLUDE_DIRS "."
    PRIV_REQUIRES
        esp_driver_rmt
        esp_driver_spi
        esp_event
        esp_netif
        esp_wifi
        nvs_flash
        led_strip
)
