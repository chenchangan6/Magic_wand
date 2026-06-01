# Magic Wand Receiver

ESP32-C6 receiver firmware for ESP-NOW `START` / `STOP` control and three LED breathing strips.

## Build In VS Code

1. Open this folder in VS Code.
2. Make sure the Espressif IDF extension has been configured.
3. Set target to `esp32c6`.
4. Select the serial port.
5. Run Build, Flash, then Monitor from the ESP-IDF toolbar.

The LED strip component is declared in `main/idf_component.yml`. On the first build, ESP-IDF may download `espressif/led_strip`.

If ESP-NOW packets are not received, make sure the transmitter and receiver are on the same Wi-Fi channel. This receiver currently uses channel 1.
