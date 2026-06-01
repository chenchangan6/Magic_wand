# Magic Wand 本地端打包说明

这是给同事电脑直接使用的本地配置包。

## 包内文件

- `lan_config/index.html` 本地配置页面
- `lan_config/serve.py` 本地中间服务
- `lan_config/serve.ps1` 启动脚本
- `run_local_config.cmd` 一键启动入口

## 使用方法

1. 把整个 `MagicWand_LocalPack` 文件夹复制到对方电脑。
2. 先让电脑连上控制端的 Wi-Fi 热点。
3. 双击 `run_local_config.cmd`。
4. 浏览器会自动打开本地配置页。
5. 在页面里先读取控制端，再编辑、保存或一键发布。

## 备注

- 本地端只负责配置与转发，不保存控制端程序。
- 启动端口固定为 `127.0.0.1:8777`，这样不会再在不同端口之间跳来跳去。
- 如果 Windows 拦截脚本，优先双击 `run_local_config.cmd`，不要直接双击 `serve.ps1`。
- `lan_config\launcher_debug.log` 和 `lan_config\serve_debug.log` 里会记录启动和请求信息，排查问题时先看这两个文件。
- 页面和本地服务都使用相对路径，拷到别的电脑后也可以直接运行。
