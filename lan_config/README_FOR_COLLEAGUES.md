# MagicWand 本地工具使用说明

版本：v1.0.1

这个包给普通同事使用，只包含本地网页工具和已经编译好的固件，不包含 ESP-IDF 源码。

## 先看文档

- `示例设置手册.html` / `示例设置手册.pdf`：给 NPC 和普通员工照着配置游戏。
- `测试要求与用例.html` / `测试要求与用例.pdf`：给现场验收和开发回归使用。

## Windows 启动

1. 解压整个文件夹，不要只拷贝单个文件。
2. 双击 `start_config.cmd` 打开本地配置页。
3. 双击 `start_flasher.cmd` 打开网页烧录页。
4. 网页烧录请使用 Chrome 或 Edge。

## macOS 启动

1. 解压整个文件夹。
2. 双击 `start_config_mac.command` 打开本地配置页。
3. 双击 `start_flasher_mac.command` 打开网页烧录页。
4. Safari 不支持网页串口烧录，请使用 Chrome 或 Edge。

如果 macOS 提示脚本没有权限，可以在终端进入解压目录后执行：

```sh
chmod +x start_config_mac.command start_flasher_mac.command serve_macos.sh
```

## 开局前检查

1. 电脑连接控制端热点。
2. 打开本地配置页，点击扫描设备。
3. 使用点名确认设备身份，再分组。
4. 创建房间，确认源组、目标组、RSSI、计分和灯效。
5. 需要寻宝辅助时，到信号校准页设置并应用到当前房间。
6. 进入设备预备，点名参与设备，确认玩家没有拿错设备。
7. 下发预备，开始游戏，打开大屏。

## 固件版本

- 控制端：2026.06.05.1652
- 接收端：2026.06.05.1820

网页烧录页会显示 manifest 版本。烧录后如果现场现象不对，请先确认版本号。

## USB 驱动

ESP32-C6 使用原生 USB CDC/JTAG，不需要 CH340/CP210x 这类芯片驱动。Windows 10/11 通常会自动安装；如果浏览器看不到串口，请安装 Espressif USB-Serial-JTAG 驱动或换一根数据线。
