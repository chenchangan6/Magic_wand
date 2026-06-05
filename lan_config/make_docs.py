from __future__ import annotations

import html
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION = "v1.0.1"
CONTROLLER_FW = "2026.06.05.1652"
RECEIVER_FW = "2026.06.05.1820"


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


STYLE = """
:root {
  --bg: #081120;
  --panel: #111827;
  --card: #13203a;
  --border: #2b3f68;
  --text: #f1f5f9;
  --muted: #94a3b8;
  --blue: #3b82f6;
  --green: #10b981;
  --amber: #f59e0b;
  --red: #ef4444;
}
* { box-sizing: border-box; }
html { background: var(--bg); color: var(--text); font-family: Inter, "Microsoft YaHei", "PingFang SC", Arial, sans-serif; line-height: 1.68; }
body { margin: 0; background: radial-gradient(circle at 15% 0%, rgba(59,130,246,.2), transparent 32rem), var(--bg); }
.page { width: min(1180px, calc(100% - 40px)); margin: 0 auto; padding: 28px 0 56px; }
.hero, .panel, .card { border: 1px solid var(--border); background: rgba(17,24,39,.86); border-radius: 22px; box-shadow: 0 24px 70px rgba(0,0,0,.28); }
.hero { padding: 30px; background: linear-gradient(135deg, rgba(17,24,39,.96), rgba(19,32,58,.92)); }
.panel { padding: 20px; margin-top: 18px; }
.card { padding: 16px; background: rgba(19,32,58,.72); }
h1 { margin: 10px 0 8px; font-size: 38px; line-height: 1.14; letter-spacing: 0; }
h2 { margin: 30px 0 12px; font-size: 25px; line-height: 1.25; }
h3 { margin: 22px 0 10px; font-size: 19px; }
h4 { margin: 16px 0 8px; font-size: 16px; color: #dbeafe; }
p, li { color: #cbd5e1; }
a { color: #93c5fd; }
code { color: #bfdbfe; background: rgba(15,23,42,.9); border: 1px solid rgba(148,163,184,.22); border-radius: 8px; padding: 2px 6px; }
.badge, .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 5px 10px; border: 1px solid rgba(148,163,184,.25); color: #dbeafe; background: rgba(15,23,42,.72); font-size: 12px; font-weight: 800; }
.pill.green { color: #d1fae5; border-color: rgba(16,185,129,.35); background: rgba(16,185,129,.12); }
.pill.blue { color: #dbeafe; border-color: rgba(59,130,246,.35); background: rgba(59,130,246,.16); }
.pill.amber { color: #fef3c7; border-color: rgba(245,158,11,.35); background: rgba(245,158,11,.12); }
.row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.grid { display: grid; gap: 14px; }
.grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.toc { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 18px; }
.toc a { text-decoration: none; border: 1px solid rgba(43,63,104,.8); border-radius: 14px; padding: 10px 12px; background: rgba(19,32,58,.62); color: #e2e8f0; font-weight: 800; }
.callout { border: 1px solid rgba(16,185,129,.28); background: rgba(16,185,129,.1); border-radius: 18px; padding: 14px 16px; color: #d1fae5; }
.warn { border-color: rgba(245,158,11,.35); background: rgba(245,158,11,.1); color: #fef3c7; }
.danger { border-color: rgba(239,68,68,.35); background: rgba(239,68,68,.1); color: #fee2e2; }
table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 16px; border: 1px solid var(--border); background: rgba(15,23,42,.82); margin: 12px 0; }
th, td { border-bottom: 1px solid rgba(43,63,104,.7); padding: 10px 12px; text-align: left; vertical-align: top; font-size: 14px; }
th { background: rgba(30,41,59,.94); color: #e2e8f0; font-size: 13px; }
tr:last-child td { border-bottom: 0; }
.flow { width: 100%; height: auto; border-radius: 18px; border: 1px solid var(--border); background: #0b1220; margin-top: 12px; }
.small { font-size: 13px; color: var(--muted); }
@media (max-width: 900px) {
  .grid.two, .grid.three, .toc { grid-template-columns: 1fr; }
  h1 { font-size: 30px; }
  .page { width: min(100% - 24px, 1180px); }
}
@media print {
  @page { size: A4; margin: 12mm; }
  html, body { background: #fff !important; color: #111827 !important; }
  body { font-size: 12px; }
  .page { width: 100%; padding: 0; }
  .hero, .panel, .card, .callout, .warn, .danger, table { background: #fff !important; color: #111827 !important; box-shadow: none !important; border-color: #9ca3af !important; }
  h1, h2, h3, h4, p, li, th, td, .small { color: #111827 !important; }
  code, .badge, .pill { background: #f3f4f6 !important; color: #111827 !important; border-color: #9ca3af !important; }
  th { background: #e5e7eb !important; }
  a { color: #1d4ed8 !important; }
}
"""


def page(title: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{esc(title)}</title>
  <style>{STYLE}</style>
</head>
<body>
  <main class="page">{body}</main>
</body>
</html>
"""


def flow_svg() -> str:
    labels = ["连接控制端", "扫描并点名", "分组/建房", "信号校准", "下发预备", "开始游戏", "大屏记分", "停止入库"]
    x = 24
    parts = [
        '<svg class="flow" viewBox="0 0 1160 160" role="img" aria-label="Magic Wand 开局流程图" xmlns="http://www.w3.org/2000/svg">',
        '<rect width="1160" height="160" rx="18" fill="#0b1220"/>',
    ]
    for i, label in enumerate(labels):
        parts.append(f'<rect x="{x}" y="48" width="120" height="56" rx="14" fill="#13203a" stroke="#2b3f68"/>')
        parts.append(f'<text x="{x + 60}" y="82" text-anchor="middle" font-size="15" font-weight="700" fill="#e5f0ff">{esc(label)}</text>')
        if i < len(labels) - 1:
            parts.append(f'<path d="M{x + 126} 76 H{x + 154}" stroke="#3b82f6" stroke-width="3" stroke-linecap="round"/>')
            parts.append(f'<path d="M{x + 154} 76 l-8 -6 v12 z" fill="#3b82f6"/>')
        x += 140
    parts.append("</svg>")
    return "".join(parts)


def manual_html() -> str:
    samples = [
        (
            "多人寻宝混战",
            "一次触发计分",
            [
                ("对象关系", "多对多，源组 -> 目标组。源组是玩家魔杖，目标组是宝箱或目标物。"),
                ("RSSI", "进入范围，RSSI >= -35 dBm，持续 2000 ms，丢失宽限 3000 ms，平滑样本 5。"),
                ("计分", "源玩家 +1。目标设备不计分。推荐重复规则为每对设备只算一次，这样多个玩家可以分别找到同一个目标。"),
                ("灯效", "源组空闲可用信号强度指示灯；源组触发短闪。目标组空闲必须静默，找到时短闪，短闪结束后回到静默。"),
                ("信号指示灯", "只建议给源组开启。LED1，10 格，弱信号 -75 dBm，满格 -20 dBm，压缩 160%。没有目标信号时不亮。"),
            ],
        ),
        (
            "单人寻宝",
            "一次触发计分",
            [
                ("对象关系", "1 对多或 1 对 1。适合单个玩家寻找多个宝箱，也适合一人一目标。"),
                ("RSSI", "默认 RSSI >= -35 dBm，持续 2000 ms。房间较小可以提高到 -25 dBm，房间较大可以降低到 -45 dBm。"),
                ("计分", "源玩家 +1。每对设备只算一次或冷却后重复，按玩法需要选择。"),
                ("灯效", "魔杖显示信号强度，找到后播放触发灯效；目标未找到前静默，找到后短闪再熄灭。"),
            ],
        ),
        (
            "双人魔杖共鸣",
            "持续达标计分",
            [
                ("对象关系", "1 对 1，指定配对。每对玩家设备需要在房间向导里明确绑定。"),
                ("RSSI", "保持在范围内，建议 -40 <= RSSI <= -20 dBm，连续达标 60000 ms。离开范围超过 2000 ms 后计时清零。"),
                ("计分", "双方玩家各 +1。重复规则建议冷却 10000 ms 后可再次触发。"),
                ("灯效", "双方空闲可轻微呼吸，成功时双方同时播放成功灯效。信号强度指示灯通常关闭，避免干扰共鸣氛围。"),
            ],
        ),
        (
            "小组占点",
            "竞争归属计分",
            [
                ("对象关系", "多对 1。多个源设备或源小组竞争同一个目标设备。"),
                ("RSSI", "RSSI >= -45 dBm 后进入竞争。目标端按平滑 RSSI 选择当前最强者，只给当前最强者累计占领时间。"),
                ("计分", "源小组 +1。目标组不计分。建议目标时间 30000 ms，冷却后可重复。"),
                ("灯效", "目标空闲可以低亮提示位置，成功占领时播放占领灯效；源设备可显示自身信号或成功反馈。"),
            ],
        ),
        (
            "距离保持",
            "持续达标计分",
            [
                ("对象关系", "1 对 1 或多对多，按现场玩法选择。"),
                ("RSSI", "保持在范围内，例如 -55 <= RSSI <= -35 dBm。触发模式可选周期计分，每 10000 ms 得分一次。"),
                ("计分", "源玩家或双方玩家得分。失败后可选择计时暂停或清零。"),
                ("灯效", "在范围内可显示稳定灯效，离开范围可播放失败或熄灭。"),
            ],
        ),
        (
            "灯效测试",
            "一次触发/不计分",
            [
                ("对象关系", "用于现场验证灯效和设备响应，不作为正式计分玩法。"),
                ("RSSI", "可忽略或设置很宽范围。"),
                ("计分", "不计分，只触发灯效。"),
                ("灯效", "测试效果必须能停止；关闭预备窗口、开始游戏、停止游戏时都应自动结束测试灯效。"),
            ],
        ),
    ]
    sample_sections = []
    for name, base, rows in samples:
        tr = "".join(f"<tr><th>{esc(k)}</th><td>{esc(v)}</td></tr>" for k, v in rows)
        sample_sections.append(f"""
        <section class="panel" id="{esc(name)}">
          <div class="row"><h2>{esc(name)}</h2><span class="pill blue">{esc(base)}</span></div>
          <table><tbody>{tr}</tbody></table>
        </section>
        """)
    body = f"""
    <section class="hero">
      <div class="row"><span class="badge">Magic Wand {VERSION}</span><span class="badge">控制端固件 {CONTROLLER_FW}</span><span class="badge">接收端固件 {RECEIVER_FW}</span></div>
      <h1>Magic Wand 示例设置手册</h1>
      <p>这份手册给普通员工、NPC 和现场主持人使用。它说明如何从零开始配置设备、分组、玩法、信号校准、游戏预备和大屏记分。</p>
      {flow_svg()}
      <div class="toc">
        <a href="#quick">快速开局</a>
        <a href="#identify">设备点名</a>
        <a href="#signal">信号校准</a>
        <a href="#idle">空闲灯效定义</a>
        <a href="#samples">玩法参数示例</a>
        <a href="#trouble">常见问题</a>
      </div>
    </section>

    <section class="panel" id="quick">
      <h2>快速开局流程</h2>
      <ol>
        <li>电脑连接控制端热点，打开本地配置页。</li>
        <li>进入设备页，点击扫描，给设备命名，并用点名确认每台设备身份。</li>
        <li>进入分组页，把玩家魔杖放入源组，把宝箱/目标放入目标组。可点名全组确认玩家没有拿错设备。</li>
        <li>进入玩法预设，选择系统玩法或创建“我的玩法预设”。系统玩法不可删除；我的玩法可以编辑、复制和删除。</li>
        <li>进入游戏房间，选择玩法，选择源组/目标组，设置本局 RSSI、持续时间、计分和灯效矩阵。</li>
        <li>需要信号灯时，进入信号校准，选择两台设备，设置弱信号、满格信号、压缩比例，点击应用到当前房间。</li>
        <li>打开设备预备，先再次扫描，然后点名参与设备，确认在线和分组正确，再下发预备。</li>
        <li>点击开始游戏。开始后接收端自主判断 RSSI，控制端只汇总事件，本地端显示大屏和历史。</li>
      </ol>
    </section>

    <section class="panel" id="identify">
      <h2>设备点名和分组核对</h2>
      <div class="grid two">
        <div class="card"><h3>哪里可以点名</h3><ul><li>设备页：全点名、点名选中、单台点名。</li><li>分组页：点名全组、展开后单台点名。</li><li>信号校准：源设备和目标设备卡片都能单台点名。</li><li>设备预备：点名参与设备，也能对单台参与设备点名。</li></ul></div>
        <div class="card"><h3>点名目的</h3><ul><li>确认设备没死机。</li><li>确认玩家手里拿的是正确设备。</li><li>确认分组没有弄错。</li><li>确认外观相同的设备能被现场 NPC 区分。</li></ul></div>
      </div>
    </section>

    <section class="panel" id="signal">
      <h2>信号校准和信号强度指示灯</h2>
      <div class="callout">RSSI 是负数，-20 dBm 比 -40 dBm 信号更强。多人寻宝时，信号灯应只给源组/玩家设备开启，不应给宝箱目标组开启。</div>
      <table>
        <tbody>
          <tr><th>默认建议</th><td>LED1，10 格，弱信号 -75 dBm，满格 -20 dBm，压缩 160%，平滑样本 5。</td></tr>
          <tr><th>刷新节奏</th><td>接收端信号灯约 0.5 秒刷新一次。没有目标信号时不亮。</td></tr>
          <tr><th>追踪策略</th><td>一次只围绕一个目标信号显示强度，短暂丢失不会马上跳到另一个目标。找到一个目标后，应跳过已找到的目标，继续寻找其他目标。</td></tr>
          <tr><th>优先级</th><td>点名/测试/触发灯效优先于信号灯。触发完成后，如果这一对设备已完成计分，信号灯不应继续对同一目标常亮。</td></tr>
        </tbody>
      </table>
    </section>

    <section class="panel" id="idle">
      <h2>空闲灯效的准确定义</h2>
      <p>空闲灯效指设备已经收到本局配置并进入 START 状态，但尚未触发成功、没有正在点名、没有正在测试灯效、也没有处于 STOP 状态时显示的背景灯效。</p>
      <div class="grid two">
        <div class="card"><h3>源组空闲</h3><p>如果启用信号强度指示灯，信号灯优先于源组空闲灯效。魔杖通常只有一路 LED，不要同时叠加信号灯和空闲呼吸灯。</p></div>
        <div class="card"><h3>目标组空闲</h3><p>寻宝类目标在被找到之前建议静默。目标被找到时短闪，短闪结束后回到静默，不能变成常亮，避免后续玩家直接看到目标。</p></div>
      </div>
    </section>

    <section class="panel" id="samples">
      <h2>玩法参数示例</h2>
      <p>以下参数是推荐起点。每个房间都可以覆盖 RSSI、持续时间、计分和灯效，不会改掉玩法预设本身。</p>
    </section>
    {''.join(sample_sections)}

    <section class="panel" id="trouble">
      <h2>常见问题</h2>
      <table>
        <thead><tr><th>现象</th><th>处理</th></tr></thead>
        <tbody>
          <tr><td>设备列表没有设备</td><td>确认电脑连接控制端热点，点击扫描。仍为空时重启接收端，再扫描。</td></tr>
          <tr><td>不知道哪台设备是谁</td><td>使用设备页、信号校准、分组页或设备预备里的点名功能。</td></tr>
          <tr><td>信号灯一直满格</td><td>进入信号校准，把满格信号调高，例如 -20 dBm，并把压缩比例调到 160% 或 200%。</td></tr>
          <tr><td>宝箱被找到后一直亮</td><td>目标组空闲应设为静默，目标触发灯效应为短闪，停止测试/开始游戏前会自动清灯。</td></tr>
          <tr><td>大屏没有更新</td><td>确认控制端 /state 有事件；若有事件但页面没刷新，点击刷新历史或重新打开页面。</td></tr>
        </tbody>
      </table>
    </section>
    """
    return page("Magic Wand 示例设置手册", body)


def tests_html() -> str:
    cases = [
        ("T01", "启动与版本", "打开本地服务，读取 /api/status。", f"服务版本为 {VERSION}，控制端固件 {CONTROLLER_FW}，接收端固件 {RECEIVER_FW}。"),
        ("T02", "设备扫描", "连接控制端热点，点击扫描设备。", "设备列表显示现场设备；不会因 20 秒刷新自动清空。无控制端连接时不显示旧残影。"),
        ("T03", "设备点名", "在设备页、分组页、信号校准和设备预备里分别点名单台、全组、参与设备。", "被点名设备 LED1/LED2/LED3 同时闪烁，便于确认身份和硬件灯路。"),
        ("T04", "信号校准", "选择魔杖1和宝箱1，LED1，10 格，弱 -75，满格 -20，压缩 160%，开始测试。", "魔杖信号灯随距离变化；没有频闪；目标设备保持熄灭。点击停止后全部熄灭。"),
        ("T05", "应用校准", "点击应用到当前房间，再下发预备。", "控制端组配置包含 meter_enabled=1、weak=-75、strong=-20、compression=160；目标组 meter_enabled=0。"),
        ("T06", "预备弹窗", "打开设备预备，滚动列表，等待自动刷新。", "顶部始终有下发预备；滚动位置不被刷新强制拉回顶部；有再次扫描和点名参与设备。"),
        ("T07", "测试灯效生命周期", "点击测试效果，不手动停止，直接下发预备或开始游戏。", "系统先自动停止测试灯效，再下发正式配置；不会留下单颗常亮或呼吸残留。"),
        ("T08", "多人寻宝触发", "源组魔杖靠近目标宝箱，RSSI >= -35 dBm 持续 2 秒。", "事件为魔杖1发现宝箱1，魔杖得分 +1，宝箱不计分。"),
        ("T09", "目标静默", "宝箱被找到后继续观察。", "宝箱只在触发时短闪，随后熄灭；第二个玩家来找时不能因为目标常亮而暴露位置。"),
        ("T10", "信号灯优先级", "魔杖只有一路 LED 时启用信号灯并触发成功。", "触发前显示信号格；触发时播放短闪；触发后不再叠加空闲呼吸和信号灯。"),
        ("T11", "多目标策略", "多个目标存在时，源设备找到其中一个目标。", "只完成这一对设备，不结束整局；信号灯跳过已找到目标，继续追踪其他未完成目标。"),
        ("T12", "大屏", "点击显示大屏并等待自动刷新。", "页面级大屏不退出；排行榜、发现记录和分数随控制端事件刷新。"),
        ("T13", "停止与历史", "停止游戏并确认结算。", "控制端广播 STOP，设备熄灭；本地写入历史场次，当前场次和历史积分分开。"),
        ("T14", "网页烧录", "打开 flash.html，查看自检和固件版本。", "Chrome/Edge 显示 Web Serial 状态；接收端 manifest 为 2026.06.05.1820。"),
    ]
    rows = "".join(f"<tr><td><b>{esc(cid)}</b></td><td>{esc(name)}</td><td>{esc(steps)}</td><td>{esc(expected)}</td></tr>" for cid, name, steps, expected in cases)
    body = f"""
    <section class="hero">
      <div class="row"><span class="badge">Magic Wand {VERSION}</span><span class="badge">测试要求与用例</span><span class="badge">现场 + 开发双视角</span></div>
      <h1>Magic Wand 测试要求与用例</h1>
      <p>本文件把最近现场发现的问题固化成回归测试：扫描不稳定、预备弹窗滚动、全屏大屏、信号校准、目标静默、信号灯优先级、点名入口和计分归属。</p>
    </section>

    <section class="panel">
      <h2>验收原则</h2>
      <div class="grid two">
        <div class="card"><h3>玩家/NPC 视角</h3><ul><li>能知道每台设备是谁。</li><li>能确认玩家拿到正确分组设备。</li><li>能用大屏向玩家展示比分和发现记录。</li><li>宝箱未找到前不暴露位置。</li><li>信号灯能帮助寻找，但不能干扰触发灯效。</li></ul></div>
        <div class="card"><h3>开发人员视角</h3><ul><li>本地端保存的是本局配置，控制端只下发和汇总。</li><li>接收端自主按 RSSI 判定，不依赖本地端实时参与。</li><li>每次修复后要重新测试相关用例。</li><li>固件和本地工具都要有可见版本号。</li></ul></div>
      </div>
    </section>

    <section class="panel">
      <h2>系统测试用例</h2>
      <table>
        <thead><tr><th>编号</th><th>项目</th><th>步骤</th><th>期望结果</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </section>

    <section class="panel">
      <h2>{VERSION} 当前现场结果</h2>
      <div class="callout">已与两台接收端实测：多人寻宝触发成功，事件为“魔杖1 发现 宝箱1”，宝箱不计分；宝箱触发时短闪后熄灭；未出现频闪和开机三色呼吸残留；信号灯随距离变化，约 6-8 米仍有 7-8 格，靠近约 1.6 米触发。</div>
      <div class="warn">仍需在更多设备数量下继续压力测试：多玩家、多宝箱、重复寻找、设备掉电重连、不同场地遮挡。这些不是当前两台设备测试能完全覆盖的风险。</div>
    </section>

    <section class="panel">
      <h2>开发回归命令</h2>
      <table><tbody>
        <tr><th>JS 语法</th><td><code>node --check lan_config\\index_ui_rebuild.js</code></td></tr>
        <tr><th>Python 语法</th><td><code>python -m py_compile lan_config\\serve.py</code></td></tr>
        <tr><th>服务状态</th><td><code>GET http://127.0.0.1:8777/api/status</code></td></tr>
        <tr><th>控制端状态</th><td><code>GET http://127.0.0.1:8777/api/controller/state</code></td></tr>
        <tr><th>打包</th><td><code>cd lan_config; .\\make_colleague_package.ps1</code></td></tr>
      </tbody></table>
    </section>
    """
    return page("Magic Wand 测试要求与用例", body)


def write_readme() -> None:
    text = f"""# MagicWand 本地工具使用说明

版本：{VERSION}

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

- 控制端：{CONTROLLER_FW}
- 接收端：{RECEIVER_FW}

网页烧录页会显示 manifest 版本。烧录后如果现场现象不对，请先确认版本号。

## USB 驱动

ESP32-C6 使用原生 USB CDC/JTAG，不需要 CH340/CP210x 这类芯片驱动。Windows 10/11 通常会自动安装；如果浏览器看不到串口，请安装 Espressif USB-Serial-JTAG 驱动或换一根数据线。
"""
    (ROOT / "README_FOR_COLLEAGUES.md").write_text(text, encoding="utf-8")


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
        table = Table(rows, colWidths=[36 * mm, 132 * mm])
        table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font_name),
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f3f4f6")),
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#111827")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#9ca3af")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(table)
        story.append(Spacer(1, 3 * mm))
    doc.build(story)


def write_pdfs() -> None:
    manual_sections = [
        ("快速开局", [
            "步骤：连接控制端热点 -> 扫描设备 -> 点名 -> 分组 -> 创建房间 -> 信号校准 -> 设备预备 -> 开始游戏 -> 大屏展示。",
            "设备：扫描后先点名，再命名和分组。不要依赖外观相同的设备标签。",
            "预备：下发预备前点名参与设备，确认玩家手中的设备属于正确分组。",
            "大屏：NPC 开始游戏后把大屏展示给玩家，当前场次和历史场次分开。"
        ]),
        ("多人寻宝推荐参数", ["RSSI：>= -35 dBm，持续 2000 ms，丢失宽限 3000 ms，平滑样本 5。", "计分：源玩家 +1，目标设备不计分。", "重复：推荐每对设备只算一次，让多个玩家都能寻找同一个目标。", "灯效：源组可显示信号灯，目标组空闲静默，找到后短闪再熄灭。", "信号灯：LED1，10 格，弱 -75，满格 -20，压缩 160%。"]),
        ("单人寻宝", ["对象关系：1 对多或 1 对 1。", "RSSI：默认 >= -35 dBm，房间很小时可提高到 -25 dBm，房间较大可降低到 -45 dBm。", "计分：源玩家 +1。", "灯效：源设备显示信号强度，目标未找到前静默，找到后短闪。"]),
        ("双人魔杖共鸣", ["规则类型：持续达标计分。", "对象关系：1 对 1，指定配对。", "RSSI：-40 <= RSSI <= -20 dBm，连续 60000 ms。", "计分：双方玩家各 +1。", "失败处理：离开范围超过 2000 ms 后计时清零。"]),
        ("小组占点", ["规则类型：竞争归属计分。", "对象关系：多对 1。", "RSSI：>= -45 dBm 后进入竞争。", "归属：目标设备选择平滑 RSSI 最强者，并只给当前最强者累计占领时间。", "计分：源小组 +1。"]),
        ("距离保持", ["规则类型：持续达标计分。", "RSSI：例如 -55 <= RSSI <= -35 dBm。", "触发：周期计分或累计达标。", "计分：源玩家、源小组或双方，按玩法设定。", "失败处理：计时暂停或清零。"]),
        ("空闲灯效定义", ["定义：设备 START 后、尚未触发、没有点名/测试/停止时显示的背景灯效。", "优先级：点名/测试/触发灯效优先于信号灯，信号灯优先于源组空闲灯效。", "目标：寻宝目标未找到前建议静默，找到后短闪再回到静默。"]),
        ("设备点名", ["入口：设备页、分组页、信号校准页、设备预备弹窗。", "用途：确认设备身份、分组正确、玩家没有拿错、设备没有死机。"]),
        ("常见问题", ["设备不出现：先确认电脑连接控制端热点，再扫描；仍为空时重启接收端。", "信号灯满格：提高满格信号，例如 -20 dBm，并提高压缩比例。", "宝箱暴露：目标组空闲必须静默，目标触发灯效必须短闪并结束。", "灯效残留：停止测试/熄灭，开始游戏前系统会自动清理测试灯效。"]),
    ]
    test_cases = [
        "T01 启动与版本：/api/status 返回 v1.0.1，固件版本显示正确。",
        "T02 设备扫描：设备不会在短时间自动消失，无控制端连接时不显示旧残影。",
        "T03 设备点名：设备页、分组页、信号校准、预备弹窗均可点名。",
        "T04 信号校准：-75 到 -20、压缩 160%、10 格，信号灯随距离变化，无频闪。",
        "T05 应用校准：下发预备后控制端 meter 参数与页面一致。",
        "T06 预备弹窗：顶部下发预备可见，滚动不被刷新拉回顶部。",
        "T07 测试灯效：不停止直接预备/开始时，会先自动停止测试灯效。",
        "T08 多人寻宝：魔杖发现宝箱，源玩家 +1，目标不计分。",
        "T09 目标静默：宝箱找到后短闪再熄灭，后续玩家不会被常亮暴露。",
        "T10 信号灯优先级：一路 LED 不叠加信号灯和呼吸灯，触发后不频闪。",
        "T11 多目标策略：找到一个目标只完成这一对，不结束整局。",
        "T12 大屏：页面级大屏不自动退出，事件和比分刷新。",
        "T13 停止与历史：STOP 后设备熄灭，结束时写入历史场次。",
        "T14 网页烧录：flash.html 自检 Web Serial，显示固件 manifest 版本。",
    ]
    test_sections = [
        ("核心验收", ["扫描：设备不会在短时间自动消失。", "预备：顶部有下发预备，滚动不会被自动刷新拉回顶部。", "大屏：页面级大屏不自动退出，比分和发现记录自动刷新。", "信号灯：只给源组显示，目标组不显示，触发后不频闪不残留。"]),
        ("系统测试用例", test_cases),
        ("现场实测结果", ["结果：魔杖1 发现 宝箱1，魔杖得分 +1，宝箱不计分。", "灯光：宝箱触发时短闪，随后熄灭；未出现频闪和三色呼吸残留。", "信号：信号灯随距离变化，约 1.6 米触发。"]),
        ("开发回归", ["JS：node --check lan_config\\index_ui_rebuild.js", "Python：python -m py_compile lan_config\\serve.py", "服务：GET /api/status", "状态：GET /api/controller/state", "打包：lan_config\\make_colleague_package.ps1"]),
    ]
    write_pdf(ROOT / "示例设置手册.pdf", "Magic Wand 示例设置手册", manual_sections)
    write_pdf(ROOT / "测试要求与用例.pdf", "Magic Wand 测试要求与用例", test_sections)


def main() -> None:
    write_readme()
    (ROOT / "示例设置手册.html").write_text(manual_html(), encoding="utf-8")
    (ROOT / "测试要求与用例.html").write_text(tests_html(), encoding="utf-8")
    write_pdfs()
    print("Docs generated")


if __name__ == "__main__":
    main()
