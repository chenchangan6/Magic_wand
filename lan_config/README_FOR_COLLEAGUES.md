# MagicWand 本地工具使用说明

统一发布版本：v1.0.4

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

## 版本检查

- 统一发布版本：v1.0.4
- 控制端固件：2026.06.06.1500
- 接收端固件：2026.06.06.1215

网页烧录页会显示统一发布版本、控制端 manifest 版本和接收端 manifest 版本。烧录后，设备页会在每台接收端下面显示它扫描上报的版本；如果显示“固件未知”或“不匹配”，请先重新扫描，仍异常就重新烧录接收端。

## GitHub 与版本管理

当前包内的 `release.json` 是版本号的唯一来源。启用 GitHub 后，建议每次稳定版本都创建一个 Git 标签，例如 `v1.0.4`，并把同事包上传到 GitHub Release。这样现场只要核对 GitHub Release、烧录页和设备上报版本三者是否一致。

## USB 驱动

ESP32-C6 使用原生 USB CDC/JTAG，不需要 CH340/CP210x 这类芯片驱动。Windows 10/11 通常会自动安装；如果浏览器看不到串口，请安装 Espressif USB-Serial-JTAG 驱动或更换一根数据线。
