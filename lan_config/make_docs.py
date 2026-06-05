from __future__ import annotations

import html
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RELEASE = json.loads((ROOT / "release.json").read_text(encoding="utf-8-sig"))
VERSION = str(RELEASE.get("release_version") or "v1.0.2")
CONTROLLER_FW = str(RELEASE.get("firmware", {}).get("controller", {}).get("version") or "")
RECEIVER_FW = str(RELEASE.get("firmware", {}).get("receiver", {}).get("version") or "")


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


STYLE = """
:root{--bg:#081120;--panel:#111827;--card:#13203a;--border:#2b3f68;--text:#f1f5f9;--muted:#94a3b8;--blue:#3b82f6;--green:#10b981;--amber:#f59e0b;--red:#ef4444}
*{box-sizing:border-box}
html{background:var(--bg);color:var(--text);font-family:Inter,"Microsoft YaHei","PingFang SC",Arial,sans-serif;line-height:1.68}
body{margin:0;background:radial-gradient(circle at 14% 0%,rgba(59,130,246,.2),transparent 32rem),var(--bg)}
.page{width:min(1180px,calc(100% - 40px));margin:0 auto;padding:28px 0 56px}
.hero,.panel,.card{border:1px solid var(--border);background:rgba(17,24,39,.86);border-radius:22px;box-shadow:0 24px 70px rgba(0,0,0,.28)}
.hero{padding:30px;background:linear-gradient(135deg,rgba(17,24,39,.96),rgba(19,32,58,.92))}
.panel{padding:20px;margin-top:18px}.card{padding:16px;background:rgba(19,32,58,.72)}
h1{margin:10px 0 8px;font-size:38px;line-height:1.14;letter-spacing:0}h2{margin:30px 0 12px;font-size:25px;line-height:1.25}h3{margin:22px 0 10px;font-size:19px}
p,li{color:#cbd5e1}.small{font-size:13px;color:var(--muted)}
.badge,.pill{display:inline-flex;align-items:center;border-radius:999px;padding:5px 10px;border:1px solid rgba(148,163,184,.25);color:#dbeafe;background:rgba(15,23,42,.72);font-size:12px;font-weight:800}
.pill.green{color:#d1fae5;border-color:rgba(16,185,129,.35);background:rgba(16,185,129,.12)}.pill.blue{color:#dbeafe;border-color:rgba(59,130,246,.35);background:rgba(59,130,246,.16)}.pill.amber{color:#fef3c7;border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.12)}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.grid{display:grid;gap:14px}.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.toc{display:grid;gap:8px;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:18px}.toc a{text-decoration:none;border:1px solid rgba(43,63,104,.8);border-radius:14px;padding:10px 12px;background:rgba(19,32,58,.62);color:#e2e8f0;font-weight:800}
.callout{border:1px solid rgba(16,185,129,.28);background:rgba(16,185,129,.1);border-radius:18px;padding:14px 16px;color:#d1fae5}.warn{border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.1);color:#fef3c7}
code{color:#bfdbfe;background:rgba(15,23,42,.9);border:1px solid rgba(148,163,184,.22);border-radius:8px;padding:2px 6px}
table{width:100%;border-collapse:collapse;overflow:hidden;border-radius:16px;border:1px solid var(--border);background:rgba(15,23,42,.82);margin:12px 0}th,td{border-bottom:1px solid rgba(43,63,104,.7);padding:10px 12px;text-align:left;vertical-align:top;font-size:14px}th{background:rgba(30,41,59,.94);color:#e2e8f0;font-size:13px}tr:last-child td{border-bottom:0}
@media(max-width:900px){.grid.two,.grid.three,.toc{grid-template-columns:1fr}h1{font-size:30px}.page{width:min(100% - 24px,1180px)}}
@media print{@page{size:A4;margin:12mm}html,body{background:#fff!important;color:#111827!important}body{font-size:12px}.page{width:100%;padding:0}.hero,.panel,.card,.callout,.warn,table{background:#fff!important;color:#111827!important;box-shadow:none!important;border-color:#9ca3af!important}h1,h2,h3,p,li,th,td,.small{color:#111827!important}code,.badge,.pill{background:#f3f4f6!important;color:#111827!important;border-color:#9ca3af!important}th{background:#e5e7eb!important}}
"""


def page(title: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{esc(title)}</title><style>{STYLE}</style></head>
<body><main class="page">{body}</main></body>
</html>
"""


def write_readme() -> None:
    text = f"""# MagicWand 本地工具使用说明

统一发布版本：{VERSION}

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

- 统一发布版本：{VERSION}
- 控制端固件：{CONTROLLER_FW}
- 接收端固件：{RECEIVER_FW}

网页烧录页会显示统一发布版本、控制端 manifest 版本和接收端 manifest 版本。烧录后，设备页会在每台接收端下面显示它扫描上报的版本；如果显示“固件未知”或“不匹配”，请先重新扫描，仍异常就重新烧录接收端。

## GitHub 与版本管理

当前包内的 `release.json` 是版本号的唯一来源。启用 GitHub 后，建议每次稳定版本都创建一个 Git 标签，例如 `{VERSION}`，并把同事包上传到 GitHub Release。这样现场只要核对 GitHub Release、烧录页和设备上报版本三者是否一致。

## USB 驱动

ESP32-C6 使用原生 USB CDC/JTAG，不需要 CH340/CP210x 这类芯片驱动。Windows 10/11 通常会自动安装；如果浏览器看不到串口，请安装 Espressif USB-Serial-JTAG 驱动或更换一根数据线。
"""
    (ROOT / "README_FOR_COLLEAGUES.md").write_text(text, encoding="utf-8")


def manual_html() -> str:
    presets = [
        ("多人寻宝混战", "源设备靠近目标设备，RSSI 达标并保持后，源设备得分。目标设备找到前静默，触发时短闪，触发后熄灭。", "RSSI >= -35 dBm，持续 2000 ms；源组启用信号强度灯，目标组禁用信号灯。"),
        ("双人魔杖共鸣", "两名玩家保持指定距离范围，连续达标后双方计分。适合合作玩法。", "-40 <= RSSI <= -20，连续 60 秒；离开超过宽限后清零或暂停。"),
        ("距离保持", "玩家需要持续保持在某个信号范围内，按周期或累计时间计分。", "使用范围 RSSI，建议先在信号校准页测真实距离。"),
        ("小组占点", "多个源设备竞争同一个目标，目标端按最强平滑 RSSI 判断当前占领者。", "适合多人抢点；得分对象通常是源小组。"),
        ("灯效测试", "不计分，只用于确认灯效、点名和硬件灯路。", "测试结束、预备、开始游戏、停止游戏时都应自动清灯。"),
    ]
    rows = "".join(f"<tr><td><b>{esc(name)}</b></td><td>{esc(desc)}</td><td>{esc(params)}</td></tr>" for name, desc, params in presets)
    body = f"""
      <section class="hero">
        <div class="row"><span class="badge">Magic Wand {esc(VERSION)}</span><span class="badge">控制端 {esc(CONTROLLER_FW)}</span><span class="badge">接收端 {esc(RECEIVER_FW)}</span></div>
        <h1>示例设置手册</h1>
        <p>给现场 NPC 和普通员工使用。先确认版本，再扫描点名，再配置房间和信号校准。</p>
        <div class="toc"><a href="#version">版本检查</a><a href="#flow">开局流程</a><a href="#presets">玩法示例</a></div>
      </section>
      <section id="version" class="panel">
        <h2>版本检查</h2>
        <div class="grid three">
          <div class="card"><h3>统一版本</h3><p>{esc(VERSION)}</p></div>
          <div class="card"><h3>控制端固件</h3><p>{esc(CONTROLLER_FW)}</p></div>
          <div class="card"><h3>接收端固件</h3><p>{esc(RECEIVER_FW)}</p></div>
        </div>
        <p class="small">烧录页会检查 manifest 是否匹配；设备页会显示每台接收端扫描上报的版本。</p>
      </section>
      <section id="flow" class="panel">
        <h2>标准开局流程</h2>
        <ol>
          <li>电脑连接控制端热点，打开本地配置页。</li>
          <li>扫描设备，在设备页、分组页、信号校准页或预备页点名确认身份。</li>
          <li>创建或选择玩法预设，建立房间，选择源组和目标组。</li>
          <li>用信号校准页测试源设备到目标设备的 RSSI，设置弱信号、强信号、压缩比例和信号灯 LED 路数。</li>
          <li>进入设备预备，点名参与设备，确认玩家没有拿错设备，然后下发预备。</li>
          <li>开始游戏并打开大屏。结束后停止游戏并保存历史。</li>
        </ol>
      </section>
      <section id="presets" class="panel">
        <h2>玩法示例参数</h2>
        <table><thead><tr><th>玩法</th><th>说明</th><th>建议参数</th></tr></thead><tbody>{rows}</tbody></table>
      </section>
      <section class="panel">
        <h2>无灯宝箱测试设备</h2>
        <p>无灯设备可以作为纯信号目标。它不会通过灯光暴露位置，但仍然会扫描上报 MAC、RSSI 和固件版本。现场需要靠点名、命名和分组确认它是否进入正确房间。</p>
      </section>
    """
    return page("Magic Wand 示例设置手册", body)


def test_html() -> str:
    cases = [
        ("T01", "启动与版本", "打开本地服务并读取 /api/status。", f"服务返回 {VERSION}；控制端期望 {CONTROLLER_FW}；接收端期望 {RECEIVER_FW}。"),
        ("T02", "烧录页版本", "打开 flash.html。", "显示统一发布版本、期望版本、当前 manifest 和匹配状态。"),
        ("T03", "设备扫描版本", "连接控制端热点，扫描设备。", "新版接收端在设备行显示接收端固件版本；旧固件显示未知或需升级。"),
        ("T04", "无灯目标", "加入无灯宝箱设备并扫描。", "能显示设备、RSSI、版本；不依赖 LED 判断是否工作。"),
        ("T05", "设备点名", "在设备、分组、信号校准、设备预备位置点名。", "能点名单台、全组、参与设备；有灯设备三路 LED 闪烁。"),
        ("T06", "信号校准", "选择源设备和目标设备，开始信号灯测试。", "源设备显示信号格，目标保持熄灭；停止后全部熄灭。"),
        ("T07", "多人寻宝", "源设备靠近目标，RSSI >= -35 dBm 持续 2 秒。", "源得分，目标不计分；事件显示“源发现目标”。"),
        ("T08", "目标静默", "第一个玩家找到目标后，第二个玩家继续寻找。", "目标短闪后熄灭，不因常亮暴露位置。"),
        ("T09", "自动刷新", "打开预备页或大屏等待刷新。", "滚动位置不跳回顶部；大屏不退出全屏/展示模式。"),
        ("T10", "停止与历史", "停止游戏并查看历史。", "设备熄灭，场次写入历史，当前分数和历史分数分开。"),
    ]
    rows = "".join(f"<tr><td><b>{esc(cid)}</b></td><td>{esc(title)}</td><td>{esc(step)}</td><td>{esc(expect)}</td></tr>" for cid, title, step, expect in cases)
    body = f"""
      <section class="hero">
        <div class="row"><span class="badge">Magic Wand {esc(VERSION)}</span><span class="badge">测试要求与用例</span></div>
        <h1>系统测试要求与用例</h1>
        <p>从玩家、NPC 和开发人员三个角度验收。修复后必须重测对应用例。</p>
      </section>
      <section class="panel">
        <h2>测试用例</h2>
        <table><thead><tr><th>ID</th><th>场景</th><th>操作</th><th>期望结果</th></tr></thead><tbody>{rows}</tbody></table>
      </section>
      <section class="panel">
        <h2>开发回归命令</h2>
        <ul>
          <li><code>node --check lan_config\\index_ui_rebuild.js</code></li>
          <li><code>python -m py_compile lan_config\\serve.py lan_config\\make_docs.py</code></li>
          <li><code>GET http://127.0.0.1:8777/api/status</code></li>
          <li><code>GET http://127.0.0.1:8777/api/controller/state</code></li>
          <li><code>cd lan_config; .\\make_colleague_package.ps1</code></li>
        </ul>
      </section>
    """
    return page("Magic Wand 测试要求与用例", body)


def write_pdf(path: Path, title: str, sections: list[tuple[str, list[str]]]) -> None:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    font_candidates = [
        Path("C:/Windows/Fonts/NotoSansSC-VF.ttf"),
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
    ]
    font_name = "Helvetica"
    for font_path in font_candidates:
        if font_path.exists():
            try:
                pdfmetrics.registerFont(TTFont("MagicCN", str(font_path)))
                font_name = "MagicCN"
                break
            except Exception:
                continue

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="CNTitle", fontName=font_name, fontSize=22, leading=28, textColor=colors.HexColor("#111827"), spaceAfter=8))
    styles.add(ParagraphStyle(name="CNH2", fontName=font_name, fontSize=15, leading=20, textColor=colors.HexColor("#1f2937"), spaceBefore=10, spaceAfter=6))
    styles.add(ParagraphStyle(name="CNBody", fontName=font_name, fontSize=10.5, leading=15, textColor=colors.HexColor("#111827")))
    styles.add(ParagraphStyle(name="CNMuted", fontName=font_name, fontSize=9.2, leading=13, textColor=colors.HexColor("#4b5563")))

    doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=14 * mm, leftMargin=14 * mm, topMargin=14 * mm, bottomMargin=14 * mm)
    story = [
        Paragraph(title, styles["CNTitle"]),
        Paragraph(f"Magic Wand {VERSION} · 控制端 {CONTROLLER_FW} · 接收端 {RECEIVER_FW}", styles["CNMuted"]),
        Spacer(1, 5 * mm),
    ]
    for heading, lines in sections:
        story.append(Paragraph(heading, styles["CNH2"]))
        rows = []
        for line in lines:
            if "：" in line:
                left, right = line.split("：", 1)
                rows.append([Paragraph(left, styles["CNBody"]), Paragraph(right, styles["CNBody"])])
            else:
                rows.append([Paragraph("说明", styles["CNBody"]), Paragraph(line, styles["CNBody"])])
        table = Table(rows, colWidths=[42 * mm, 126 * mm])
        table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font_name),
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f3f4f6")),
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#111827")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#9ca3af")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(table)
        story.append(Spacer(1, 3 * mm))
    doc.build(story)


def main() -> None:
    (ROOT / "示例设置手册.html").write_text(manual_html(), encoding="utf-8")
    (ROOT / "测试要求与用例.html").write_text(test_html(), encoding="utf-8")
    write_readme()
    write_pdf(
        ROOT / "示例设置手册.pdf",
        "Magic Wand 示例设置手册",
        [
            ("版本检查", [f"统一发布版本：{VERSION}", f"控制端固件：{CONTROLLER_FW}", f"接收端固件：{RECEIVER_FW}"]),
            ("标准开局", ["扫描并点名设备", "创建房间并选择分组", "信号校准并应用到房间", "设备预备后开始游戏", "停止后保存历史"]),
            ("寻宝参数", ["源组：启用信号强度灯", "目标组：找到前静默，触发短闪后熄灭", "触发：RSSI >= -35 dBm，持续 2000 ms"]),
        ],
    )
    write_pdf(
        ROOT / "测试要求与用例.pdf",
        "Magic Wand 测试要求与用例",
        [
            ("版本", [f"统一发布版本：{VERSION}", f"控制端 manifest：{CONTROLLER_FW}", f"接收端 manifest：{RECEIVER_FW}", "设备页：显示接收端扫描上报版本"]),
            ("现场测试", ["设备扫描保持", "点名单台/全组/参与设备", "信号校准源亮目标灭", "多人寻宝源得分目标不计分", "目标短闪后熄灭"]),
            ("开发回归", ["JS：node --check lan_config\\index_ui_rebuild.js", "Python：python -m py_compile lan_config\\serve.py lan_config\\make_docs.py", "服务：GET /api/status", "打包：lan_config\\make_colleague_package.ps1"]),
        ],
    )
    print("Generated README, HTML guides, and PDFs.")


if __name__ == "__main__":
    main()
