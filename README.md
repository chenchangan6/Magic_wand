# Magic Wand Project

这是一个基于 ESP32-C6 的魔杖/宝箱交互项目。现在的项目结构已经整理成两层：

- `firmware/receiver`：接收端固件，负责灯效、ESP-NOW 接收、STOP/START、基础测试。
- `firmware/controller`：控制端固件，负责 AP、扫描、点名、命名、配置导入、状态展示。
- `lan_config`：电脑上的局域网配置页，负责复杂编辑、本地保存、离线编辑和一键发布。
- `docs`：说明文档、流程说明、硬件说明、用例说明。

## 现在怎么跑

1. 烧录接收端或控制端固件。
2. 控制端默认会开出自己的 Wi-Fi AP。
3. 电脑连接控制端 AP。
4. 双击 `D:\MagicProject\lan_config\serve.ps1` 打开局域网配置页。
5. 在页面里先读取控制端，再修改、保存、发布。

## 推荐阅读顺序

1. [项目结构](docs/project_structure.md)
2. [局域网配置页说明](docs/local_config_page.md)
3. [配置流转说明](docs/config_flow.md)
4. [使用示例](docs/use_cases.md)
5. [配置样例](docs/config_schema_example.json)

## 当前原则

- 控制端只保留现场动作和必要的状态查看。
- 复杂规则统一放在电脑端配置页。
- 本地保存优先写到电脑同级文件夹中的 `magic_wand_config.json`。
- 离线时也可以编辑，联网后再发布。
