# MagicWand 本地配置和网页烧录工具

## Windows 启动

1. 解压整个文件夹，不要只拷贝其中一个文件。
2. 双击 `start_config.cmd` 打开本地配置页面。
3. 双击 `start_flasher.cmd` 直接打开固件烧录页面。
4. 用 Chrome 或 Edge 浏览器操作网页烧录。

## macOS 启动

1. 解压整个文件夹，不要只拷贝其中一个文件。
2. 双击 `start_config_mac.command` 打开本地配置页面。
3. 双击 `start_flasher_mac.command` 直接打开固件烧录页面。
4. 用 Chrome 或 Edge 浏览器操作网页烧录，Safari 不支持网页串口烧录。

如果 macOS 提示脚本没有权限，打开“终端”，进入解压后的目录，执行一次：

```sh
chmod +x start_config_mac.command start_flasher_mac.command serve_macos.sh
```

然后再双击 `.command` 文件。

macOS 需要安装 Python 3。如果双击后提示找不到 Python 3，请先安装：

https://www.python.org/downloads/macos/

## 烧录前准备

- 用 USB 数据线连接 ESP32-C6 MINI 4M 的原生 USB 口。
- 关闭 VS Code 串口监视器、Arduino、PlatformIO、其他串口工具。
- 在烧录页里选择正确固件：控制端烧控制端，接收端烧接收端。
- 第一次烧录或无法连接时，按住 BOOT，点一下 RESET，然后松开 BOOT，再开始烧录。

## USB 驱动说明

ESP32-C6 使用原生 USB CDC/JTAG，不需要 CH340、CP210x 这类 USB 转串口芯片驱动。

- Windows 10/11：联网时通常会自动安装驱动。
- 如果浏览器看不到串口，或设备管理器显示异常 USB JTAG/Serial 设备，需要安装 Espressif USB-Serial-JTAG 驱动。
- macOS：通常不需要手动安装串口驱动。
- Linux：通常不需要串口驱动，但可能需要 udev 权限规则。

官方说明：

- https://docs.espressif.com/projects/esp-idf/en/stable/esp32c6/get-started/establish-serial-connection.html
- https://docs.espressif.com/projects/esp-idf/en/stable/esp32c6/api-guides/jtag-debugging/configure-builtin-jtag.html

## 开发者更新固件

开发电脑重新编译固件后，在 `lan_config` 目录运行：

```powershell
.\refresh_firmware_bins.ps1
```

然后重新打包：

```powershell
.\make_colleague_package.ps1
```

生成的包只包含本地网页工具和已编译 `.bin`，不包含 ESP-IDF 固件源码。
