(() => {
  const MAX_GROUPS = 16;
  const MAX_VISIBLE_LOG_LINES = 120;
  const STORAGE_KEYS = {
    localState: 'magic_wand_local_state_backup_v1',
    roomRecords: 'magic_wand_room_records_backup_v1',
    controllerDraft: 'magic_wand_controller_draft_v1',
    lastPort: 'magic_wand_last_local_port_v1'
  };

  const state = {
    apiBase: '',
    controllerBase: '',
    serverStatus: null,
    controllerOnline: false,
    controllerState: null,
    localState: null,
    roomRecords: [],
    serverLogText: '',
    debugLines: [],
    activeTab: 'overview',
    deviceFilterMode: 'ungrouped',
    deviceFilterGroupId: -1,
    selectedDeviceIds: new Set(),
    editingMac: null,
    editingDraft: '',
    selectedTemplateId: '',
    currentRoomId: '',
    selectedEffectId: 'builtin-breath',
    previewPlaying: true,
    previewTick: 0,
    busy: {
      status: false,
      controller: false,
      local: false,
      records: false,
      log: false,
      scan: false,
      identify: false,
      publish: false,
      save: false,
      restore: false
    }
  };

  const builtinEffects = [
    { id: 'builtin-selftest', name: '自检', note: '默认三路呼吸，自检和回退使用。', mode: 'selftest', colorA: '#FFD24D', colorB: '#34B3FF', colorC: '#61E09A' },
    { id: 'builtin-silent', name: '静默', note: '不发光，只保留状态。', mode: 'silent', colorA: '#7487a7', colorB: '#7487a7', colorC: '#7487a7' },
    { id: 'builtin-solid', name: '常亮', note: '固定颜色常亮。', mode: 'solid', colorA: '#FFD24D', colorB: '#34B3FF', colorC: '#61E09A' },
    { id: 'builtin-breath', name: '呼吸', note: '亮度起伏，适合常驻提示。', mode: 'breath', colorA: '#FFD24D', colorB: '#34B3FF', colorC: '#61E09A' },
    { id: 'builtin-blink', name: '闪烁', note: '按周期亮灭。', mode: 'blink', colorA: '#FFD24D', colorB: '#34B3FF', colorC: '#FFFFFF' },
    { id: 'builtin-cycle', name: '多色循环', note: '三色轮换。', mode: 'cycle', colorA: '#FFD24D', colorB: '#34B3FF', colorC: '#61E09A' },
    { id: 'builtin-chase', name: '跑马灯', note: '单灯位移动。', mode: 'chase', colorA: '#FFD24D', colorB: '#34B3FF', colorC: '#61E09A' },
    { id: 'builtin-pulse', name: '脉冲跑马', note: '渐变、加速、结束停留。', mode: 'pulse', colorA: '#FFD24D', colorB: '#FFFBF0', colorC: '#FFFFFF' }
  ];

  const builtinTemplates = [
    {
      id: 'tpl-solo',
      name: '魔杖寻宝-单人轮巡',
      note: '每支魔杖独立记录目标，适合一个人带多个组。'
    },
    {
      id: 'tpl-team',
      name: '魔杖寻宝-双人组共享',
      note: '同组共享找到记录，适合双人协作。'
    },
    {
      id: 'tpl-rssi',
      name: '距离提示测试',
      note: '只看 RSSI 强弱变化，用于阈值和映射测试。'
    },
    {
      id: 'tpl-effect',
      name: '灯效演示',
      note: '展示常亮、呼吸、闪烁、跑马灯与脉冲跑马。'
    }
  ];

  const groupPalette = ['blue', 'green', 'yellow', 'purple'];

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function uid(prefix = 'id') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function portFromBase(base, fallback = '8777') {
    try {
      const url = new URL(String(base || ''), window.location.href);
      return url.port || String(fallback);
    } catch (_) {
      return String(fallback);
    }
  }

  function formatTime(iso) {
    if (!iso) return '未开始';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatDuration(startIso, endIso) {
    if (!startIso) return '0m';
    const a = new Date(startIso).getTime();
    const b = new Date(endIso || nowIso()).getTime();
    const sec = Math.max(0, Math.round((b - a) / 1000));
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return min ? `${min}m${rem.toString().padStart(2, '0')}s` : `${sec}s`;
  }

  function formatAgo(ms) {
    const value = Math.max(0, normalizeNumber(ms, 0));
    if (value < 1000) return `${value} ms 前`;
    const sec = Math.floor(value / 1000);
    if (sec < 60) return `${sec}.${Math.floor((value % 1000) / 100)}s 前`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${min}m ${rem}s 前`;
  }

  function countBits32(value) {
    let v = value >>> 0;
    let count = 0;
    while (v) {
      v &= v - 1;
      count++;
    }
    return count;
  }

  function svgIcon(name) {
    const shell = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
    switch (name) {
      case 'refresh':
        return shell('<path d="M16.023 9.348h4.992v-5"></path><path d="M20.015 4.348a9.25 9.25 0 0 0-15.24 3.01"></path><path d="M7.978 14.652H3.016v5"></path><path d="M3.985 19.652a9.25 9.25 0 0 0 15.24-3.01"></path>');
      case 'arrow':
        return shell('<path d="M3 12h18"></path><path d="M14.25 5.25 21 12l-6.75 6.75"></path>');
      case 'search':
        return shell('<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>');
      case 'plus':
        return shell('<path d="M12 4.5v15"></path><path d="M4.5 12h15"></path>');
      case 'save':
        return shell('<path d="M3 20.25h18"></path><path d="M5.25 20.25V3.75h11.19l2.31 2.31v14.19"></path><path d="M8.25 3.75v6h7.5v-6"></path><path d="M9 20.25v-6.75h6v6.75"></path>');
      case 'trash':
        return shell('<path d="M4.5 7.5h15"></path><path d="M10.5 4.5h3"></path><path d="M9 4.5h6"></path><path d="M7.5 7.5l.75 11.25h7.5L16.5 7.5"></path><path d="M10.5 10.5v6"></path><path d="M13.5 10.5v6"></path>');
      case 'play':
        return shell('<path d="M8.25 5.25v13.5l11.25-6.75L8.25 5.25Z"></path>');
      case 'pause':
        return shell('<path d="M8.25 5.25v13.5"></path><path d="M15.75 5.25v13.5"></path>');
      case 'check':
        return shell('<path d="M5.25 12.75 9 16.5 18.75 6.75"></path>');
      case 'gear':
        return shell('<path d="M4.5 12a7.5 7.5 0 1 0 15 0 7.5 7.5 0 0 0-15 0Z"></path><path d="M12 8.25v7.5"></path><path d="M8.25 12h7.5"></path>');
      case 'copy':
        return shell('<path d="M9 9.75h6a2.25 2.25 0 0 1 2.25 2.25v6A2.25 2.25 0 0 1 15 20.25H9A2.25 2.25 0 0 1 6.75 18v-6A2.25 2.25 0 0 1 9 9.75Z"></path><path d="M15.75 6.75h1.5A2.25 2.25 0 0 1 19.5 9v6"></path><path d="M9.75 6.75H8.25A2.25 2.25 0 0 0 6 9v6"></path>');
      case 'list':
        return shell('<path d="M8.25 6h12"></path><path d="M8.25 12h12"></path><path d="M8.25 18h12"></path><path d="M4.5 6h.01"></path><path d="M4.5 12h.01"></path><path d="M4.5 18h.01"></path>');
      case 'device':
        return shell('<rect x="4.5" y="5.25" width="15" height="9.75" rx="2"></rect><path d="M9 19.5h6"></path><path d="M12 15v4.5"></path>');
      case 'group':
        return shell('<rect x="4.5" y="4.5" width="6" height="6" rx="1.5"></rect><rect x="13.5" y="4.5" width="6" height="6" rx="1.5"></rect><rect x="4.5" y="13.5" width="6" height="6" rx="1.5"></rect><rect x="13.5" y="13.5" width="6" height="6" rx="1.5"></rect>');
      case 'effect':
        return shell('<path d="M9.813 15.904 8.5 21l3.875-2.563L16.25 21l-1.313-5.096L20.5 12l-5.563-.095L12.375 7 10.95 11.905 5.5 12l4.313 3.904Z"></path>');
      case 'record':
        return shell('<path d="M6.75 4.5h10.5a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 17.25 19.5H6.75A1.5 1.5 0 0 1 5.25 18V6A1.5 1.5 0 0 1 6.75 4.5Z"></path><path d="M9 8.25h6"></path><path d="M9 12h6"></path><path d="M9 15.75h3.75"></path>');
      case 'room':
        return shell('<path d="M3.75 20.25V8.25l8.25-4.5 8.25 4.5v12"></path><path d="M9 20.25V13.5h6v6.75"></path>');
      default:
        return '';
    }
  }

  function makePill(label, active = false, extra = '') {
    const classes = [
      'inline-flex items-center justify-center gap-2 h-8 px-3 rounded-full border whitespace-nowrap',
      'border-[rgba(88,113,145,0.28)] bg-[rgba(24,33,47,0.92)] text-[#dae5f4] text-[12px]',
      active ? 'bg-gradient-to-b from-[#396ecc] to-[#315ea7] text-white border-transparent' : '',
      extra
    ].filter(Boolean).join(' ');
    return `<span class="${classes}">${escapeHtml(label)}</span>`;
  }

  function makePillButton(label, action, active = false, extra = '') {
    const classes = [
      'inline-flex items-center justify-center gap-2 h-8 px-3 rounded-full border whitespace-nowrap cursor-pointer transition',
      'border-[rgba(88,113,145,0.28)] bg-[rgba(24,33,47,0.92)] text-[#dae5f4] text-[12px] hover:brightness-105 active:translate-y-px',
      active ? 'bg-gradient-to-b from-[#396ecc] to-[#315ea7] text-white border-transparent' : '',
      extra
    ].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-action="${escapeHtml(action)}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
  }

  function makeChip(label, active = false) {
    const classes = [
      'inline-flex items-center justify-center h-7 px-3 rounded-full border whitespace-nowrap',
      'border-[rgba(88,113,145,0.28)] bg-[rgba(24,33,47,0.92)] text-[#dae5f4] text-[11px]',
      active ? 'bg-gradient-to-b from-[#396ecc] to-[#315ea7] text-white border-transparent' : ''
    ].filter(Boolean).join(' ');
    return `<span class="${classes}">${escapeHtml(label)}</span>`;
  }

  function buildDefaultDevices() {
    return [
      { idx: 0, mac: '58:E6:C5:F0:AD:44', name: '碎片1号', group_mask: 1, rssi: -14, seen_ms: 1283 },
      { idx: 1, mac: '58:E6:C5:F0:C4:74', name: '碎片2', group_mask: 2, rssi: -12, seen_ms: 2150 },
      { idx: 2, mac: '58:E6:C5:F1:DF:18', name: '碎片3', group_mask: 3, rssi: -16, seen_ms: 1810 }
    ];
  }

  function buildDefaultGroups() {
    return [
      {
        id: 0,
        valid: true,
        name: '魔杖组',
        note: '地图魔杖区域触发设备',
        target: 1,
        mode: 1,
        sense_mode: 'ring',
        rssi: -70,
        hold: 2000,
        template: '标准魔杖玩法',
        effect_template_id: 'builtin-breath',
        effect: 'builtin-breath',
        effect_ui: { mode: 'breath', ports: [true, false, false], colors: ['#FFD24D', '#34B3FF', '#61E09A'], brightness: 60, speed: 45, period: 700, duty: 50, count: 0, accel: 0, endHold: 0, endColor: '#FFFFFF' },
        idle_effect: 'builtin-breath',
        silence: '',
        signal_ui: { reverse: false, weak_rssi: -90, strong_rssi: -20, weak_output: '低亮 / 慢闪', strong_output: '高亮 / 快闪', hold_ms: 2000 },
        score: { enabled: true, led_count: 10, color_mode: 'single', max_score: 10 }
      },
      {
        id: 1,
        valid: true,
        name: '宝箱组',
        note: '宝箱触发设备集合',
        target: 0,
        mode: 0,
        sense_mode: 'shared',
        rssi: -68,
        hold: 2000,
        template: '宝箱反馈',
        effect_template_id: 'builtin-chase',
        effect: 'builtin-chase',
        effect_ui: { mode: 'chase', ports: [true, true, true], colors: ['#61E09A', '#F3C44D', '#4BA9FF'], brightness: 80, speed: 420, period: 420, duty: 50, count: 0, accel: 0, endHold: 0, endColor: '#FFFFFF' },
        idle_effect: 'builtin-solid',
        silence: '',
        signal_ui: { reverse: false, weak_rssi: -90, strong_rssi: -20, weak_output: '低亮', strong_output: '高亮', hold_ms: 2000 },
        score: { enabled: false, led_count: 0, color_mode: 'none', max_score: 0 }
      },
      {
        id: 2,
        valid: true,
        name: '中距离组',
        note: '中距离感应设备',
        target: 3,
        mode: 2,
        sense_mode: 'response',
        rssi: -65,
        hold: 1800,
        template: '距离提示',
        effect_template_id: 'builtin-blink',
        effect: 'builtin-blink',
        effect_ui: { mode: 'blink', ports: [true, true, true], colors: ['#F3C44D', '#34B3FF', '#61E09A'], brightness: 100, speed: 0, period: 700, duty: 50, count: 0, accel: 0, endHold: 0, endColor: '#FFFFFF' },
        idle_effect: 'builtin-breath',
        silence: '',
        signal_ui: { reverse: false, weak_rssi: -85, strong_rssi: -30, weak_output: '慢闪', strong_output: '快闪', hold_ms: 1800 },
        score: { enabled: true, led_count: 6, color_mode: 'single', max_score: 6 }
      },
      {
        id: 3,
        valid: true,
        name: '全局组',
        note: '全局广播或特殊设备',
        target: 255,
        mode: 2,
        sense_mode: 'response',
        rssi: -72,
        hold: 2500,
        template: '全局控制',
        effect_template_id: 'builtin-selftest',
        effect: 'builtin-selftest',
        effect_ui: { mode: 'selftest', ports: [true, true, true], colors: ['#FFD24D', '#34B3FF', '#61E09A'], brightness: 60, speed: 45, period: 1000, duty: 50, count: 0, accel: 0, endHold: 0, endColor: '#FFFFFF' },
        idle_effect: 'builtin-silent',
        silence: '',
        signal_ui: { reverse: false, weak_rssi: -90, strong_rssi: -20, weak_output: '静默', strong_output: '提示', hold_ms: 2500 },
        score: { enabled: false, led_count: 0, color_mode: 'none', max_score: 0 }
      }
    ];
  }

  function buildDefaultControllerState() {
    return {
      schema_version: 2,
      devices: buildDefaultDevices(),
      groups: buildDefaultGroups(),
      records: [],
      rules: [],
      presets: builtinTemplates.map((item) => ({
        id: item.id,
        name: item.name,
        note: item.note,
        source_group_hint: '',
        target_group_hint: '',
        config: null
      })),
      effects: builtinEffects.map((item) => ({
        id: item.id,
        name: item.name,
        note: item.note,
        builtIn: true,
        effect_ui: {
          mode: item.mode,
          ports: [true, true, true],
          colors: [item.colorA, item.colorB, item.colorC],
          brightness: 80,
          speed: 45,
          period: 700,
          duty: 50,
          count: 20,
          accel: 0,
          endHold: 0,
          endColor: '#FFFFFF'
        },
        updated_at: '1970-01-01T00:00:00'
      })),
      active_preset: '魔杖寻宝-单人轮巡'
    };
  }

  function buildDefaultLocalState() {
    return {
      schema: 1,
      updated_at: nowIso(),
      device_drafts: {},
      templates: builtinTemplates.map((tpl) => ({
        id: tpl.id,
        name: tpl.name,
        note: tpl.note,
        created_at: nowIso(),
        updated_at: nowIso(),
        config: null
      })),
      rooms: [],
      active_room_id: '',
      current_room: null,
      room_history: [],
      ui: {
        active_tab: 'overview',
        show_unassigned: true,
        device_filter_mode: 'ungrouped',
        device_filter_group_id: -1,
        selected_template_id: builtinTemplates[0].id,
        wizard: {
          open: false,
          step: 0,
          return_tab: 'overview'
        }
      }
    };
  }

  function normalizeRoomDraft(raw, fallbackTemplate = null) {
    if (!raw || typeof raw !== 'object') return null;
    const templateId = String(raw.template_id || fallbackTemplate?.id || builtinTemplates[0].id || '');
    const templateName = String(raw.template_name || fallbackTemplate?.name || '');
    const sourceGroupIds = Array.isArray(raw.source_group_ids)
      ? raw.source_group_ids
      : Array.isArray(raw.group_ids)
        ? raw.group_ids
        : [];
    const targetGroupIds = Array.isArray(raw.target_group_ids) ? raw.target_group_ids : [];
    const combined = Array.isArray(raw.group_ids)
      ? raw.group_ids
      : Array.from(new Set([...sourceGroupIds, ...targetGroupIds]));
    return {
      id: String(raw.id || uid('room')),
      name: String(raw.name || ''),
      template_id: templateId,
      template_name: templateName,
      status: String(raw.status || 'draft'),
      started_at: String(raw.started_at || ''),
      ended_at: String(raw.ended_at || ''),
      created_at: String(raw.created_at || nowIso()),
      updated_at: String(raw.updated_at || nowIso()),
      source_group_ids: sourceGroupIds
        .map((v) => normalizeNumber(v, -1))
        .filter((v) => v >= 0 && v < MAX_GROUPS),
      target_group_ids: targetGroupIds
        .map((v) => normalizeNumber(v, -1))
        .filter((v) => v >= 0 && v < MAX_GROUPS),
      group_ids: combined
        .map((v) => normalizeNumber(v, -1))
        .filter((v) => v >= 0 && v < MAX_GROUPS),
      notes: String(raw.notes || ''),
      summary: raw.summary && typeof raw.summary === 'object' ? clone(raw.summary) : {}
    };
  }

  function normalizeDeviceName(name, idx, mac = '') {
    const cleaned = String(name ?? '').trim();
    if (cleaned) return cleaned;
    const fallback = ['碎片', '魔杖', '宝箱', '中距离', '设备'];
    const prefix = fallback[idx % fallback.length];
    const suffix = idx >= 0 ? String(idx + 1) : (mac ? mac.slice(-4) : 'X');
    return `${prefix}${suffix}`;
  }

  function normalizeEffectEffects(raw) {
    const source = Array.isArray(raw) ? raw : builtinEffects;
    return source.map((item) => ({
      id: String(item?.id || ''),
      name: String(item?.name || '未命名'),
      note: String(item?.note || ''),
      builtIn: item?.builtIn === true,
      effect_ui: item?.effect_ui && typeof item.effect_ui === 'object' ? clone(item.effect_ui) : null,
      updated_at: String(item?.updated_at || nowIso())
    })).filter((item) => item.id);
  }

  function normalizeTemplates(raw) {
    const source = Array.isArray(raw) ? raw : [];
    const byId = new Map();
    for (const tpl of builtinTemplates) {
      byId.set(tpl.id, {
        id: tpl.id,
        name: tpl.name,
        note: tpl.note,
        created_at: nowIso(),
        updated_at: nowIso(),
        config: null
      });
    }
    for (const item of source) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '').trim() || uid('tpl');
      byId.set(id, {
        id,
        name: String(item.name || '未命名模板'),
        note: String(item.note || ''),
        created_at: String(item.created_at || nowIso()),
        updated_at: String(item.updated_at || nowIso()),
        config: item.config && typeof item.config === 'object' ? clone(item.config) : null
      });
    }
    return Array.from(byId.values());
  }

  function normalizeRecords(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => ({
      src_group: normalizeNumber(r?.src_group, 0),
      target_group: normalizeNumber(r?.target_group, 0),
      src_idx: normalizeNumber(r?.src_idx, -1),
      dst_idx: normalizeNumber(r?.dst_idx, -1),
      first_seen_ms: normalizeNumber(r?.first_seen_ms, 0),
      last_seen_ms: normalizeNumber(r?.last_seen_ms, 0)
    }));
  }

  function normalizeGroups(raw, existing = []) {
    const output = Array.from({ length: MAX_GROUPS }, (_, id) => clone(existing[id] || buildDefaultGroups()[id] || emptyGroup(id)));
    if (!Array.isArray(raw)) return output;
    for (const g of raw) {
      if (!g || typeof g !== 'object') continue;
      const id = normalizeNumber(g.id, -1);
      if (id < 0 || id >= MAX_GROUPS) continue;
      const prev = output[id] || emptyGroup(id);
      output[id] = {
        ...prev,
        id,
        valid: g.valid === true || Number(g.valid) === 1,
        name: String(g.name || `分组${id + 1}`),
        note: String(g.note || ''),
        target: normalizeNumber(g.target, 255),
        mode: normalizeNumber(g.mode, 1),
        sense_mode: String(g.sense_mode || prev.sense_mode || 'ring'),
        rssi: normalizeNumber(g.rssi, -70),
        hold: normalizeNumber(g.hold, 2000),
        template: String(g.template || ''),
        effect_template_id: String(g.effect_template_id || prev.effect_template_id || ''),
        effect: String(g.effect || prev.effect || 'builtin-selftest'),
        effect_ui: g.effect_ui && typeof g.effect_ui === 'object' ? clone(g.effect_ui) : clone(prev.effect_ui || {}),
        idle_effect: String(g.idle_effect || prev.idle_effect || 'builtin-selftest'),
        silence: String(g.silence || ''),
        signal_ui: g.signal_ui && typeof g.signal_ui === 'object'
          ? clone(g.signal_ui)
          : clone(prev.signal_ui || {
            reverse: false,
            weak_rssi: -90,
            strong_rssi: -20,
            weak_output: '低亮 / 慢闪',
            strong_output: '高亮 / 快闪',
            hold_ms: 2000
          }),
        score: g.score && typeof g.score === 'object'
          ? clone(g.score)
          : clone(prev.score || { enabled: false, led_count: 0, color_mode: 'none', max_score: 0 })
      };
    }
    return output;
  }

  function normalizeControllerState(raw, existing = null) {
    const fallback = buildDefaultControllerState();
    const out = {
      schema_version: normalizeNumber(raw?.schema_version ?? raw?.schema, 2) >= 2 ? 2 : 1,
      devices: clone(fallback.devices),
      groups: clone(fallback.groups),
      records: [],
      rules: [],
      presets: clone(fallback.presets),
      effects: clone(fallback.effects),
        active_preset: fallback.active_preset
      };

    if (existing && Array.isArray(existing.devices)) out.devices = clone(existing.devices);
    if (existing && Array.isArray(existing.groups)) out.groups = clone(existing.groups);
    if (existing && Array.isArray(existing.records)) out.records = clone(existing.records);
    if (existing && Array.isArray(existing.rules)) out.rules = clone(existing.rules);
    if (existing && Array.isArray(existing.presets)) out.presets = clone(existing.presets);
    if (existing && Array.isArray(existing.effects)) out.effects = clone(existing.effects);
    if (existing && existing.active_preset) out.active_preset = String(existing.active_preset);

    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.devices)) {
        out.devices = raw.devices.map((d, idx) => ({
          idx: normalizeNumber(d?.idx, idx),
          mac: String(d?.mac || '').trim(),
          name: normalizeDeviceName(d?.name, idx, d?.mac),
          group_mask: normalizeNumber(d?.group_mask, 0) >>> 0,
          rssi: normalizeNumber(d?.rssi, 0),
          seen_ms: Math.max(0, normalizeNumber(d?.seen_ms, 0))
        }));
      }
      if (Array.isArray(raw.groups)) {
        out.groups = normalizeGroups(raw.groups, out.groups);
      }
      if (Array.isArray(raw.records)) out.records = normalizeRecords(raw.records);
      if (Array.isArray(raw.rules)) out.rules = raw.rules.map((r, i) => ({ id: normalizeNumber(r?.id, i), ...clone(r) }));
      if (Array.isArray(raw.presets)) out.presets = normalizeTemplates(raw.presets);
      if (Array.isArray(raw.effects)) out.effects = normalizeEffectEffects(raw.effects);
        if (raw.active_preset !== undefined) out.active_preset = String(raw.active_preset || '自定义');
    }
    return out;
  }

  function normalizeLocalState(raw) {
    const fallback = buildDefaultLocalState();
    if (!raw || typeof raw !== 'object') return clone(fallback);
    const out = clone(fallback);
    out.schema = normalizeNumber(raw.schema, 1);
    out.updated_at = String(raw.updated_at || nowIso());
    out.device_drafts = raw.device_drafts && typeof raw.device_drafts === 'object' ? clone(raw.device_drafts) : {};
    out.templates = normalizeTemplates(raw.templates || fallback.templates);
    const templateForRoom = (roomRaw) => out.templates.find((tpl) => tpl.id === roomRaw?.template_id) || out.templates.find((tpl) => tpl.id === raw?.ui?.selected_template_id) || out.templates[0] || null;
    const roomMap = new Map();
    if (Array.isArray(raw.rooms)) {
      for (const item of raw.rooms) {
        const room = normalizeRoomDraft(item, templateForRoom(item));
        if (room) roomMap.set(room.id, room);
      }
    }
    if (raw.current_room) {
      const current = normalizeRoomDraft(raw.current_room, templateForRoom(raw.current_room));
      if (current && !roomMap.has(current.id)) roomMap.set(current.id, current);
    }
    out.rooms = Array.from(roomMap.values());
    out.active_room_id = String(raw.active_room_id || raw?.ui?.active_room_id || raw?.current_room?.id || out.rooms[0]?.id || '');
    out.current_room = out.rooms.find((room) => room.id === out.active_room_id) ? clone(out.rooms.find((room) => room.id === out.active_room_id)) : (out.rooms[0] ? clone(out.rooms[0]) : null);
    out.room_history = Array.isArray(raw.room_history) ? raw.room_history.map((item) => clone(item)) : [];
    out.ui = {
      active_tab: String(raw?.ui?.active_tab || fallback.ui.active_tab || 'overview'),
      show_unassigned: raw?.ui?.show_unassigned !== false,
      device_filter_mode: String(raw?.ui?.device_filter_mode || fallback.ui.device_filter_mode || 'ungrouped'),
      device_filter_group_id: normalizeNumber(raw?.ui?.device_filter_group_id, -1),
      selected_template_id: String(raw?.ui?.selected_template_id || out.current_room?.template_id || fallback.ui.selected_template_id || builtinTemplates[0].id),
      wizard: {
        open: raw?.ui?.wizard?.open === true,
        step: clamp(normalizeNumber(raw?.ui?.wizard?.step, 0), 0, 3)
      }
    };
    return out;
  }

  function emptyGroup(id) {
    return {
      id,
      valid: false,
      name: '',
      note: '',
      target: 255,
      mode: 1,
      sense_mode: 'ring',
      rssi: -70,
      hold: 2000,
      template: '',
      effect_template_id: '',
      effect: 'builtin-selftest',
      effect_ui: {
        mode: 'selftest',
        ports: [true, true, true],
        colors: ['#FFD24D', '#34B3FF', '#61E09A'],
        brightness: 60,
        speed: 45,
        period: 700,
        duty: 50,
        count: 0,
        accel: 0,
        endHold: 0,
        endColor: '#FFFFFF'
      },
      idle_effect: 'builtin-selftest',
      silence: '',
      signal_ui: {
        reverse: false,
        weak_rssi: -90,
        strong_rssi: -20,
        weak_output: '低亮 / 慢闪',
        strong_output: '高亮 / 快闪',
        hold_ms: 2000
      },
      score: {
        enabled: false,
        led_count: 0,
        color_mode: 'none',
        max_score: 0
      }
    };
  }

  function clone(obj) {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj));
  }

  function deviceDraftName(device) {
    const draft = state.localState?.device_drafts?.[device.mac];
    if (draft && typeof draft === 'object' && String(draft.name || '').trim()) return String(draft.name).trim();
    return device.name;
  }

  function mergeDraftsIntoController(controllerState, localState) {
    const out = clone(controllerState);
    const drafts = localState?.device_drafts || {};
    out.devices = (out.devices || []).map((device) => {
      const draft = drafts[device.mac];
      const name = draft && typeof draft === 'object' && String(draft.name || '').trim();
      return {
        ...device,
        name: name || device.name
      };
    });
    return out;
  }

  function controllerDevices() {
    return Array.isArray(state.controllerState?.devices) ? state.controllerState.devices : [];
  }

  function controllerGroups() {
    return Array.isArray(state.controllerState?.groups) ? state.controllerState.groups.filter((g) => g && g.valid) : [];
  }

  function controllerEffects() {
    return Array.isArray(state.controllerState?.effects) && state.controllerState.effects.length
      ? state.controllerState.effects
      : builtinEffects;
  }

  function activeTemplate() {
    return state.localState?.templates?.find((tpl) => tpl.id === state.selectedTemplateId) || state.localState?.templates?.[0] || null;
  }

  function roomList() {
    return Array.isArray(state.localState?.rooms) ? state.localState.rooms : [];
  }

  function roomById(id) {
    const roomId = String(id || '');
    if (!roomId) return null;
    return roomList().find((room) => room.id === roomId) || null;
  }

  function activeRoomId() {
    const rooms = roomList();
    // 优先使用本地状态的 active_room_id，回退到第一个房间以支持多房间模型
    return String(state.localState?.active_room_id || rooms.length > 0 ? rooms[0].id : '');
  }

  function activeRoom() {
    return roomById(activeRoomId()) || state.localState?.current_room || null;
  }

    /**
     * @description 修正活动房间别名和ID的同步，确保 state.current_room 和 state.localState.active_room_id 同时更新。
     * @param {object} room - 传入的房间对象，如果未提供，则使用当前的活动房间。
     */
    /**
     * @description 修正活动房间别名和ID的同步，确保 state.current_room 和 state.localState.active_room_id 同时更新。
     * @param {object} room - 传入的房间对象，如果未提供，则使用当前的活动房间。
     */
    function syncActiveRoomAlias(room = activeRoom()) {
      if (!state.localState) return null;
      const next = room ? normalizeRoomDraft(room, state.localState.templates.find((tpl) => tpl.id === room.template_id) || state.localState.templates[0] || builtinTemplates[0]) : null;
      
      // 核心修正：主动更新 active_room_id 和 current_room 副本
      state.localState.active_room_id = next?.id || '';
      state.localState.current_room = next ? clone(next) : null;
      // 移除对 state.currentRoomId 的依赖，完全依赖 state.localState 结构。
      
      if (next?.template_id) {
        state.selectedTemplateId = next.template_id;
        if (state.localState.ui) state.localState.ui.selected_template_id = next.template_id;
      }
      return next;
    }
      return next;
    }

  function setActiveRoom(roomOrId) {
    const room = typeof roomOrId === 'string' ? roomById(roomOrId) : roomOrId || null;
    return syncActiveRoomAlias(room);
  }

  function currentRoom() {
    return activeRoom();
  }

  function selectedVisibleDevices() {
    return filteredDevices().filter((device) => state.selectedDeviceIds.has(device.mac));
  }

  function visibleGroupIdsForDevice(device) {
    const mask = normalizeNumber(device?.group_mask, 0) >>> 0;
    const ids = [];
    for (let gid = 0; gid < MAX_GROUPS; gid++) {
      if ((mask & (1 << gid)) !== 0) ids.push(gid);
    }
    return ids;
  }

  function groupById(id) {
    return controllerGroups().find((g) => g.id === id) || null;
  }

  function groupNameById(id) {
    const group = groupById(id);
    return group ? group.name : `分组${id + 1}`;
  }

  function groupTargetName(group) {
    const target = normalizeNumber(group?.target, 255);
    if (target < 0 || target >= MAX_GROUPS) return '无';
    const tg = groupById(target);
    return tg ? tg.name : '无';
  }

  function modeLabel(mode) {
    const value = normalizeNumber(mode, 1);
    if (value === 0) return '组共享型';
    if (value === 2) return '纯响应型';
    return '轮巡型';
  }

  function senseLabel(mode) {
    const value = String(mode || 'ring');
    if (value === 'shared') return '组共享';
    if (value === 'response') return '纯响应';
    return '轮巡';
  }

  function effectNameById(effectId) {
    const id = String(effectId || '');
    const match = controllerEffects().find((item) => String(item.id) === id);
    return match ? match.name : id || '未设置';
  }

  function filteredDevices() {
    const devices = controllerDevices();
    const mode = state.deviceFilterMode;
    const gid = normalizeNumber(state.deviceFilterGroupId, -1);
    if (mode === 'all') return devices;
    if (mode === 'group' && gid >= 0) {
      const bit = 1 << gid;
      return devices.filter((device) => ((normalizeNumber(device.group_mask, 0) >>> 0) & bit) !== 0);
    }
    return devices.filter((device) => (normalizeNumber(device.group_mask, 0) >>> 0) === 0);
  }

  function onlineCount() {
    return controllerDevices().filter((device) => normalizeNumber(device.seen_ms, 999999) < 10000).length;
  }

  function ungroupedCount() {
    return controllerDevices().filter((device) => (normalizeNumber(device.group_mask, 0) >>> 0) === 0).length;
  }

  function activeGroupsCount() {
    return controllerGroups().length;
  }

  function effectTemplatesCount() {
    return controllerEffects().length;
  }

  function lastPublishStatus() {
    const log = state.serverLogText || '';
    if (log.includes('Publish completed') || log.includes('publish success') || log.includes('发布成功')) return '成功';
    if (log.includes('failed') || log.includes('失败')) return '失败';
    return state.controllerOnline ? '待发布' : '离线';
  }

  function selectedTemplateName() {
    const tpl = activeTemplate();
    return tpl ? tpl.name : '未选择';
  }

  function currentRoomStatusLabel() {
    const room = currentRoom();
    if (!room) return '未创建';
    if (room.status === 'draft') return '草稿';
    if (room.status === 'running') return '进行中';
    if (room.status === 'ended') return '已结束';
    return '待开始';
  }

  function currentRoomDuration() {
    const room = currentRoom();
    if (!room) return '0s';
    return formatDuration(room.started_at, room.ended_at);
  }

  function wizardState() {
    const wizard = state.localState?.ui?.wizard || {};
    return {
      open: wizard.open === true,
      step: clamp(normalizeNumber(wizard.step, 0), 0, 3),
      returnTab: String(wizard.return_tab || 'overview')
    };
  }

  function syncWizardState(patch = {}) {
    if (!state.localState.ui) state.localState.ui = {};
    if (!state.localState.ui.wizard) state.localState.ui.wizard = { open: false, step: 0, return_tab: 'overview' };
    state.localState.ui.wizard = {
      open: patch.open !== undefined ? !!patch.open : state.localState.ui.wizard.open === true,
      step: patch.step !== undefined ? clamp(normalizeNumber(patch.step, 0), 0, 3) : clamp(normalizeNumber(state.localState.ui.wizard.step, 0), 0, 3),
      return_tab: patch.returnTab !== undefined
        ? String(patch.returnTab || 'overview')
      : String(state.localState.ui.wizard.return_tab || 'overview')
    };
  }

  function ensureRoomCollection() {
    if (!state.localState) state.localState = buildDefaultLocalState();
    if (!Array.isArray(state.localState.rooms)) state.localState.rooms = [];
    if (!state.localState.ui) state.localState.ui = buildDefaultLocalState().ui;
    return state.localState.rooms;
  }

  function upsertRoom(room, { activate = true } = {}) {
    if (!room || typeof room !== 'object') return null;
    const rooms = ensureRoomCollection();
    const normalized = normalizeRoomDraft(room, state.localState?.templates?.find((tpl) => tpl.id === room.template_id) || state.localState?.templates?.[0] || builtinTemplates[0]);
    const index = rooms.findIndex((item) => item.id === normalized.id);
    if (index >= 0) rooms[index] = normalized;
    else rooms.push(normalized);
    if (activate) setActiveRoom(normalized);
    return normalized;
  }

  function validateRoomReady(room = currentRoom()) {
    const issues = [];
    const template = state.localState?.templates?.find((item) => item.id === room?.template_id) || activeTemplate() || state.localState?.templates?.[0] || builtinTemplates[0];
    if (!String(room?.name || '').trim()) issues.push('请先填写房间名称。');
    if (!template?.id) issues.push('请先选择一个游戏模板。');
    if (!(Array.isArray(room?.source_group_ids) && room.source_group_ids.length)) issues.push('请至少选择一个源组。');
    if (!(Array.isArray(room?.target_group_ids) && room.target_group_ids.length)) issues.push('请至少选择一个目标组。');
    return { issues, template };
  }

  function ensureRoomDraft(templateId = state.selectedTemplateId || activeTemplate()?.id || builtinTemplates[0].id, options = {}) {
    const rooms = ensureRoomCollection();
    const template = state.localState?.templates?.find((tpl) => tpl.id === templateId)
      || state.localState?.templates?.[0]
      || builtinTemplates[0];
    const forceNew = options.forceNew === true;
    let room = activeRoom();
    const canReuseDraft = room && room.status === 'draft' && !forceNew;
    if (!canReuseDraft) {
      room = {
        id: uid('room'),
        name: '',
        template_id: template?.id || builtinTemplates[0].id,
        template_name: template?.name || builtinTemplates[0].name,
        status: 'draft',
        started_at: '',
        ended_at: '',
        created_at: nowIso(),
        updated_at: nowIso(),
        source_group_ids: [],
        target_group_ids: [],
        group_ids: [],
        notes: '',
        summary: {}
      };
      rooms.push(normalizeRoomDraft(room, template));
      room = rooms[rooms.length - 1];
      setActiveRoom(room);
    }
    room.template_id = template?.id || room.template_id || builtinTemplates[0].id;
    room.template_name = template?.name || room.template_name || builtinTemplates[0].name;
    if (room.status !== 'running') room.status = 'draft';
    room.updated_at = nowIso();
    if (!Array.isArray(room.source_group_ids)) room.source_group_ids = [];
    if (!Array.isArray(room.target_group_ids)) room.target_group_ids = [];
    if (!Array.isArray(room.group_ids)) {
      room.group_ids = Array.from(new Set([...(room.source_group_ids || []), ...(room.target_group_ids || [])]));
    }
    const normalized = upsertRoom(room, { activate: true });
    syncActiveRoomAlias(normalized);
    state.selectedTemplateId = normalized.template_id;
    state.localState.ui.selected_template_id = normalized.template_id;
    return normalized;
  }

  function updateRoomDraftSummary(room = currentRoom()) {
    if (!room) return;
    room.group_ids = Array.from(new Set([
      ...(Array.isArray(room.source_group_ids) ? room.source_group_ids : []),
      ...(Array.isArray(room.target_group_ids) ? room.target_group_ids : [])
    ])).sort((a, b) => a - b);
    room.summary = {
      source_group_names: (room.source_group_ids || []).map((gid) => groupNameById(gid)),
      target_group_names: (room.target_group_ids || []).map((gid) => groupNameById(gid)),
      source_count: (room.source_group_ids || []).length,
      target_count: (room.target_group_ids || []).length
    };
    room.updated_at = nowIso();
    syncActiveRoomAlias(room);
  }

  function openWizard(templateId = state.selectedTemplateId || activeTemplate()?.id || builtinTemplates[0].id, options = {}) {
    const returnTab = state.activeTab || state.localState?.ui?.active_tab || 'overview';
    state.selectedTemplateId = templateId || builtinTemplates[0].id;
    state.localState.ui.selected_template_id = state.selectedTemplateId;
    const current = activeRoom();
    const room = !options.forceNew && current && current.status === 'draft'
      ? ensureRoomDraft(state.selectedTemplateId)
      : ensureRoomDraft(state.selectedTemplateId, { forceNew: true });
    updateRoomDraftSummary(room);
    syncWizardState({ open: true, step: 0, returnTab });
    persistStateToServer();
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector('[data-role="wizard-room-name"]');
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  function closeWizard() {
    const returnTab = wizardState().returnTab || 'overview';
    syncWizardState({ open: false });
    state.activeTab = returnTab;
    state.localState.ui.active_tab = returnTab;
    persistStateToServer();
    render();
  }

  function wizardNext() {
    syncWizardState({ step: clamp(wizardState().step + 1, 0, 3) });
    persistStateToServer();
    render();
  }

  function wizardPrev() {
    syncWizardState({ step: clamp(wizardState().step - 1, 0, 3) });
    persistStateToServer();
    render();
  }

  function setWizardRoomName(value) {
    const room = ensureRoomDraft();
    room.name = String(value || '').trim();
    room.updated_at = nowIso();
    updateRoomDraftSummary(room);
    persistStateToServer();
    render();
  }

  function setWizardRoomNotes(value) {
    const room = ensureRoomDraft();
    room.notes = String(value || '');
    room.updated_at = nowIso();
    updateRoomDraftSummary(room);
    persistStateToServer();
  }

  function setWizardTemplate(templateId) {
    const template = state.localState.templates.find((item) => item.id === templateId) || activeTemplate() || state.localState.templates[0] || builtinTemplates[0];
    state.selectedTemplateId = template.id;
    state.localState.ui.selected_template_id = template.id;
    const room = ensureRoomDraft(template.id);
    room.template_id = template.id;
    room.template_name = template.name;
    updateRoomDraftSummary(room);
    persistStateToServer();
    render();
  }

  function toggleWizardGroup(kind, gid, checked) {
    const room = ensureRoomDraft();
    const key = kind === 'target' ? 'target_group_ids' : 'source_group_ids';
    const current = new Set(Array.isArray(room[key]) ? room[key] : []);
    if (checked) current.add(gid);
    else current.delete(gid);
    room[key] = Array.from(current).sort((a, b) => a - b);
    updateRoomDraftSummary(room);
    persistStateToServer();
    render();
  }

  async function saveWizardDraft() {
    const room = ensureRoomDraft();
    if (!String(room.name || '').trim()) {
      alert('请先输入房间名称。');
      return;
    }
    room.status = 'draft';
    updateRoomDraftSummary(room);
    setActiveRoom(room);
    await persistStateToServer();
    logDebug(`向导草稿已保存 | ${room.name}`);
    render();
  }

async function startWizardRoom() {
    const room = currentRoom();
    if (!room) {
      // 确保这是用户在向导上操作：需要一个房间才能启动
      alert('无法启动房间。请先通过向导创建或选择一个房间。');
      return;
    }
    
    // 重新校验房间是否符合上线的最低标准
    const { issues } = validateRoomReady(room);
    if (issues.length) {
      // 这是流程级的关键反馈，需要指引用户。
      alert('配置不完整，无法开始游戏。请修正以下问题，然后重试，修复的关键点有：\n' + issues.join('\n'));
      
      // 引导用户修正第一个问题，确保下一轮 UI 引导是精确的
      const firstMissing = issues[0];
      if (/名称/.test(firstMissing)) syncWizardState({ step: 0 });
      else if (/模板/.test(firstMissing)) syncWizardState({ step: 1 });
      else if (/源组/.test(firstMissing)) syncWizardState({ step: 2 });
      else syncSync({ step: 3 });
      render();
      return;
    }
    
    // 流程原子性保证：确保所有关键的数组属性是同步的，作为进入运行状态的最后一次修正
    room.group_ids = Array.from(new Set([
      ...(Array.isArray(room.source_group_ids) ? room.source_group_ids : []),
      ...(Array.isArray(room.target_group_ids) ? room.target_group_ids : []),
    ])).sort((a, b) => a - b);
    
    // 状态和时间记录：从草稿 (draft) 切换到运行中 (running)
    room.status = 'running';
    room.started_at = room.started_at || nowIso();
    room.ended_at = '';
    room.updated_at = nowIso();
    
    // 使用新的同步函数确保状态同步
    const updatedRoom = upsertRoom(room, { activate: true });
    
    // 异步API调用和本地缓存更新
    await persistStateToServer();
    
    // 最终 UI 和逻辑状态重置
    syncWizardState({ open: false });
    state.activeTab = 'room';
    state.localState.ui.active_tab = 'room';
    logDebug(`✅ 房间 ${room.name} (${room.id}) 成功从草稿(draft)切换到运行中(running)。`);
    render();
  }
    updateRoomDraftSummary(room);
    room.status = 'running';
    room.started_at = room.started_at || nowIso();
    room.ended_at = '';
    room.updated_at = nowIso();
    upsertRoom(room, { activate: true });
    await persistStateToServer();
    syncWizardState({ open: false });
    state.activeTab = 'room';
    state.localState.ui.active_tab = 'room';
    logDebug(`向导开局 | ${room.name} / ${room.template_name}`);
    render();
  }

  function buildControllerPayload() {
    const payload = mergeDraftsIntoController(state.controllerState || buildDefaultControllerState(), state.localState || buildDefaultLocalState());
    payload.schema_version = 2;
    payload.active_preset = selectedTemplateName();
    payload.records = Array.isArray(payload.records) ? payload.records : [];
    payload.rules = Array.isArray(payload.rules) ? payload.rules : [];
    return payload;
  }

  function buildLocalStatePayload() {
    const payload = clone(state.localState || buildDefaultLocalState());
    payload.schema = 1;
    payload.updated_at = nowIso();
    payload.ui = {
      active_tab: state.activeTab,
      show_unassigned: payload.ui?.show_unassigned !== false,
      device_filter_mode: state.deviceFilterMode,
      device_filter_group_id: state.deviceFilterGroupId,
      selected_template_id: state.selectedTemplateId,
      wizard: {
        open: !!state.localState?.ui?.wizard?.open,
        step: clamp(normalizeNumber(state.localState?.ui?.wizard?.step, 0), 0, 3)
      }
    };
    payload.rooms = roomList().map((room) => clone(room));
    payload.active_room_id = activeRoomId();
    payload.current_room = currentRoom() ? clone(currentRoom()) : null;
    payload.room_history = Array.isArray(payload.room_history) ? payload.room_history : [];
    payload.templates = Array.isArray(payload.templates) ? payload.templates : [];
    return payload;
  }

  function groupMaskCount(mask) {
    return countBits32(normalizeNumber(mask, 0));
  }

  function validateDeviceGroupLimit(payload) {
    const devices = Array.isArray(payload?.devices) ? payload.devices : [];
    const offenders = devices.filter((device) => groupMaskCount(device?.group_mask) > 8);
    if (!offenders.length) return '';
    const first = offenders[0];
    return `设备 #${normalizeNumber(first?.idx, -1)} 的分组数超过 8 个，请先减少后再保存或发布。`;
  }

  function setBusy(key, value) {
    state.busy[key] = !!value;
    render();
  }

  function logDebug(line) {
    const ts = new Date().toISOString();
    state.debugLines.unshift(`[${ts}] ${line}`);
    state.debugLines = state.debugLines.slice(0, MAX_VISIBLE_LOG_LINES);
  }

  function persistLocalCache() {
    try {
      localStorage.setItem(STORAGE_KEYS.localState, JSON.stringify(buildLocalStatePayload()));
    } catch (_) {}
  }

  function persistRecordsCache() {
    try {
      localStorage.setItem(STORAGE_KEYS.roomRecords, JSON.stringify(state.roomRecords));
    } catch (_) {}
  }

  async function requestJson(path, options = {}) {
    const timeoutMs = options.timeoutMs ?? 12000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    try {
      const response = await fetch(`${state.apiBase}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (!response.ok) {
        const detail = typeof body === 'object' && body ? JSON.stringify(body) : String(body || response.statusText);
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestText(path, options = {}) {
    const timeoutMs = options.timeoutMs ?? 12000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    try {
      const response = await fetch(`${state.apiBase}${path}`, {
        ...options,
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  async function discoverApiBase() {
    const origin = window.location.origin;
    if (origin && origin !== 'null' && window.location.protocol !== 'file:') {
      return origin.replace(/\/$/, '');
    }

    const storedPort = Number(localStorage.getItem(STORAGE_KEYS.lastPort) || 0);
    const candidatePorts = [];
    if (storedPort >= 8777 && storedPort <= 8787) candidatePorts.push(storedPort);
    for (let port = 8777; port <= 8787; port++) {
      if (!candidatePorts.includes(port)) candidatePorts.push(port);
    }
    for (const port of candidatePorts) {
      const base = `http://127.0.0.1:${port}`;
      try {
        const result = await requestJsonFromBase(base, '/api/status', { timeoutMs: 900 });
        if (result && result.ok) {
          localStorage.setItem(STORAGE_KEYS.lastPort, String(port));
          return base;
        }
      } catch (_) {}
    }
    return 'http://127.0.0.1:8777';
  }

  async function requestJsonFromBase(base, path, options = {}) {
    const timeoutMs = options.timeoutMs ?? 12000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    try {
      const response = await fetch(`${base}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (!response.ok) {
        const detail = typeof body === 'object' && body ? JSON.stringify(body) : String(body || response.statusText);
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchStatus() {
    return requestJson('/api/status', { timeoutMs: 5000 });
  }

  async function fetchControllerState() {
    return requestJson('/api/controller/state?t=' + Date.now(), { timeoutMs: 12000, headers: { 'Content-Type': 'application/json' } });
  }

  async function fetchLocalState() {
    return requestJson('/api/local/state', { timeoutMs: 5000, headers: { 'Content-Type': 'application/json' } });
  }

  async function fetchRecords() {
    return requestJson('/api/local/records?tail=200', { timeoutMs: 5000, headers: { 'Content-Type': 'application/json' } });
  }

  async function fetchServerLog() {
    return requestText('/api/log?tail=250', { timeoutMs: 5000 });
  }

  async function persistStateToServer() {
    try {
      await requestJson('/api/local/state', {
        method: 'POST',
        body: JSON.stringify(buildLocalStatePayload()),
        timeoutMs: 8000
      });
      persistLocalCache();
      return true;
    } catch (err) {
      logDebug(`本地状态保存失败 | ${err.message}`);
      persistLocalCache();
      return false;
    }
  }

  async function persistDraftToServer() {
    try {
      await requestJson('/api/save', {
        method: 'POST',
        body: JSON.stringify(buildControllerPayload()),
        timeoutMs: 15000
      });
      return true;
    } catch (err) {
      logDebug(`鎺у埗绔崏绋夸繚瀛樺け璐?| ${err.message}`);
      return false;
    }
  }

  async function appendRoomRecord(record) {
    try {
      const saved = await requestJson('/api/local/records', {
        method: 'POST',
        body: JSON.stringify(record),
        timeoutMs: 8000
      });
      return saved?.record || record;
    } catch (err) {
    logDebug(`房间记录追加失败 | ${err.message}`);
      try {
        state.roomRecords.push(record);
        persistRecordsCache();
      } catch (_) {}
      return record;
    }
  }

  function deviceDisplayName(device) {
    return deviceDraftName(device);
  }

  function beginEditDevice(mac) {
    const device = controllerDevices().find((item) => item.mac === mac);
    if (!device) return;
    state.editingMac = mac;
    state.editingDraft = deviceDisplayName(device);
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector(`[data-role="device-name-input"][data-mac="${cssEscape(mac)}"]`);
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  function cancelEditDevice() {
    state.editingMac = '';
    state.editingDraft = '';
    render();
  }

  function updateEditDraft(value) {
    state.editingDraft = value;
  }

  async function saveDeviceName(mac) {
    const device = controllerDevices().find((item) => item.mac === mac);
    if (!device) return;
    const name = String(state.editingDraft || '').trim();
    if (!name) {
      alert('设备名称不能为空。');
      return;
    }
    device.name = name;
    state.localState.device_drafts[mac] = { name };
    state.editingMac = '';
    state.editingDraft = '';
    await persistStateToServer();
    render();
    logDebug(`设备改名 | ${device.mac} -> ${name}`);
  }

  function toggleDeviceSelect(mac, checked) {
    if (checked) state.selectedDeviceIds.add(mac);
    else state.selectedDeviceIds.delete(mac);
    render();
  }

  function toggleSelectAllVisible(checked) {
    const visible = filteredDevices();
    for (const device of visible) {
      if (checked) state.selectedDeviceIds.add(device.mac);
      else state.selectedDeviceIds.delete(device.mac);
    }
    render();
  }

  function toggleGroupMembership(mac, gid, checked) {
    const device = controllerDevices().find((item) => item.mac === mac);
    if (!device) return;
    const mask = normalizeNumber(device.group_mask, 0) >>> 0;
    const bit = 1 << gid;
    device.group_mask = checked ? ((mask | bit) >>> 0) : ((mask & ~bit) >>> 0);
    render();
    persistStateToServer();
  }

  function clearSelectedGroups() {
    const selected = selectedVisibleDevices();
    if (!selected.length) return;
    for (const device of selected) {
      device.group_mask = 0;
    }
    render();
    persistStateToServer();
    logDebug(`取消分组 | 已清除 ${selected.length} 台设备的分组`);
  }

  async function saveDeviceRow(mac) {
    const device = controllerDevices().find((item) => item.mac === mac);
    if (!device) return;
    const input = document.querySelector(`[data-role="device-name-input"][data-mac="${cssEscape(mac)}"]`);
    const name = String(input?.value ?? deviceDisplayName(device)).trim();
    if (!name) {
      alert('设备名称不能为空。');
      return;
    }
    device.name = name;
    state.localState.device_drafts[mac] = { name };
    await persistStateToServer();
    render();
    logDebug(`保存设备 | ${mac} = ${name}`);
  }

  async function identifyDevice(idx) {
    if (!state.controllerOnline) return;
    try {
      setBusy('identify', true);
      await requestJson(`/api/controller/identify?idx=${encodeURIComponent(idx)}&t=${Date.now()}`, {
        method: 'GET',
        timeoutMs: 6000
      });
      logDebug(`点名设备 | idx=${idx}`);
    } catch (err) {
      logDebug(`点名设备失败 | idx=${idx} | ${err.message}`);
    } finally {
      setBusy('identify', false);
    }
  }

  async function identifyAllDevices() {
    if (!state.controllerOnline) {
      logDebug('全部点名失败 | 控制端未连接');
      return;
    }
    try {
      setBusy('identify', true);
      await requestJson(`/api/controller/cmd?name=IDENTIFY&t=${Date.now()}`, {
        method: 'GET',
        timeoutMs: 6000
      });
      logDebug('全部点名 | 已发送 IDENTIFY');
    } catch (err) {
      logDebug(`全部点名失败 | ${err.message}`);
    } finally {
      setBusy('identify', false);
    }
  }

  async function identifySelectedDevices() {
    const selected = selectedVisibleDevices();
    if (!selected.length) return;
    if (!state.controllerOnline) {
      logDebug('点名选中失败 | 控制端未连接');
      return;
    }
    try {
      setBusy('identify', true);
      for (const device of selected) {
        const idx = normalizeNumber(device.idx, -1);
        if (idx < 0) continue;
        await requestJson(`/api/controller/identify?idx=${encodeURIComponent(idx)}&t=${Date.now()}`, {
          method: 'GET',
          timeoutMs: 6000
        });
      }
      logDebug(`点名选中 | ${selected.length} 台`);
    } catch (err) {
      logDebug(`点名选中失败 | ${err.message}`);
    } finally {
      setBusy('identify', false);
    }
  }

  async function loadFromController() {
    try {
      setBusy('controller', true);
      const data = await fetchControllerState();
      state.controllerState = mergeDraftsIntoController(normalizeControllerState(data, state.controllerState), state.localState);
      state.controllerOnline = true;
      localStorage.setItem(STORAGE_KEYS.lastPort, portFromBase(state.apiBase, 8777));
      logDebug(`从控制端读取成功 | devices=${controllerDevices().length} groups=${controllerGroups().length}`);
      await reloadServerLog(false);
      render();
    } catch (err) {
      state.controllerOnline = false;
      state.controllerState = normalizeControllerState(null, state.controllerState);
      state.controllerState = mergeDraftsIntoController(state.controllerState, state.localState);
      logDebug(`从控制端读取失败 | ${err.message}`);
      render();
    } finally {
      setBusy('controller', false);
    }
  }

  async function scanDevices() {
    if (!state.controllerOnline) {
      logDebug('扫描设备失败 | 控制端未连接');
      return;
    }
    try {
      setBusy('scan', true);
      await requestJson(`/api/controller/scan?t=${Date.now()}`, {
        method: 'GET',
        timeoutMs: 8000
      });
      logDebug('扫描设备 | 已发送 DISCOVER');
      await sleep(700);
      await loadFromController();
    } catch (err) {
      logDebug(`扫描设备失败 | ${err.message}`);
    } finally {
      setBusy('scan', false);
    }
  }

  function selectTab(tab) {
    state.activeTab = tab;
    state.localState.ui.active_tab = tab;
    persistStateToServer();
    render();
  }

  function selectTemplate(templateId) {
    state.selectedTemplateId = templateId;
    state.localState.ui.selected_template_id = templateId;
    persistStateToServer();
    render();
  }

  function createTemplateFromCurrent() {
    const name = prompt('模板名称：', `新模板 ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
    if (!name) return;
    const template = {
      id: uid('tpl'),
      name: name.trim(),
      note: '从当前配置创建',
      created_at: nowIso(),
      updated_at: nowIso(),
      config: buildControllerPayload()
    };
    state.localState.templates.unshift(template);
    state.selectedTemplateId = template.id;
    state.localState.ui.selected_template_id = template.id;
    persistStateToServer();
    logDebug(`新建模板 | ${template.name}`);
    render();
  }

  function cloneTemplate(templateId) {
    const source = state.localState.templates.find((item) => item.id === templateId);
    if (!source) return;
    const name = prompt('复制后的模板名称：', `${source.name} 副本`);
    if (!name) return;
    const template = {
      id: uid('tpl'),
      name: name.trim(),
      note: `复制自 ${source.name}`,
      created_at: nowIso(),
      updated_at: nowIso(),
      config: clone(source.config)
    };
    state.localState.templates.unshift(template);
    state.selectedTemplateId = template.id;
    state.localState.ui.selected_template_id = template.id;
    persistStateToServer();
    logDebug(`复制模板 | ${source.name} -> ${template.name}`);
    render();
  }

  function deleteTemplate(templateId) {
    const template = state.localState.templates.find((item) => item.id === templateId);
    if (!template) return;
    if (!confirm(`删除模板「${template.name}」？`)) return;
    state.localState.templates = state.localState.templates.filter((item) => item.id !== templateId);
    if (state.selectedTemplateId === templateId) {
      state.selectedTemplateId = state.localState.templates[0]?.id || '';
      state.localState.ui.selected_template_id = state.selectedTemplateId;
    }
    persistStateToServer();
    logDebug(`删除模板 | ${template.name}`);
    render();
  }

  function loadTemplateIntoCurrent(templateId) {
    const template = state.localState.templates.find((item) => item.id === templateId);
    if (!template || !template.config) return;
    const next = normalizeControllerState(template.config, state.controllerState);
    state.controllerState = mergeDraftsIntoController(next, state.localState);
    state.selectedTemplateId = template.id;
    state.localState.ui.selected_template_id = template.id;
    persistStateToServer();
    logDebug(`应用模板 | ${template.name}`);
    render();
  }

  function createRoomFromTemplate() {
    openWizard(state.selectedTemplateId || activeTemplate()?.id || builtinTemplates[0].id, { forceNew: true });
  }

  async function startRoom() {
    const room = currentRoom();
    if (!room) {
      createRoomFromTemplate();
      return;
    }
    const { issues } = validateRoomReady(room);
    if (issues.length) {
      alert(issues[0]);
      if (state.activeTab !== 'room') {
        state.activeTab = 'room';
        state.localState.ui.active_tab = 'room';
      }
      render();
      return;
    }
    room.status = 'running';
    room.started_at = room.started_at || nowIso();
    room.ended_at = '';
    room.updated_at = nowIso();
    upsertRoom(room, { activate: true });
    await persistStateToServer();
    logDebug(`开始游戏 | ${room.name}`);
    render();
  }

async function endRoom() {
    const room = currentRoom();
    if (!room) {
      alert('无法结束房间。请先创建一个正在运行的房间。');
      return;
    }
    if (room.status === 'ended') {
      alert('该房间已结束。');
      return;
    }
    
    const endDate = room.ended_at || nowIso();
    const duration = formatDuration(room.started_at, endDate);
    
    // 1. 更新房间状态和时间
    if (!room.ended_at) room.ended_at = endDate;
    room.status = 'ended';
    room.updated_at = nowIso();
    
    // 2. 使用 upsert 确保局部状态的正确更新
    const updatedRoom = upsertRoom(room, { activate: true });
    
    // 3. 写入历史记录：这是流程的最后收尾动作。
    const record = {
      // 从当前活动房间对象获取所有必需字段
      room_id: updatedRoom.id,
      room_name: updatedRoom.name,
      template_id: updatedRoom.template_id,
      template_name: updatedRoom.template_name,
      status: updatedRoom.status,
      started_at: updatedRoom.started_at,
      ended_at: updatedRoom.ended_at,
      duration: duration,
      source_group_ids: updatedRoom.source_group_ids,
      target_group_ids: updatedRoom.target_group_ids,
      notes: updatedRoom.notes,
      summary: updatedRoom.summary,
      room_end_time: endDate
    };
    
    // 异步API调用和持久化历史记录
    const storedRecord = await appendRoomRecord(record);
    
    if (storedRecord) {
      logDebug(`✅ 房间 ${updatedRoom.name} 成功结束，记录已保存。${formattedCompletionMessage(updatedRoom, storedRecord)}`);
      await persistStateToServer();
      // 4. 切换离开房间视图，回到 Overview
      syncWizardState({ open: false });
      state.activeTab = 'overview';
      state.localState.ui.active_tab = 'overview';
      render();
    } else {
      alert('写入房间历史记录失败，请检查控制台日志。');
    }
  }

  async function saveLocalConfig() {
    try {
      setBusy('save', true);
      const ok = await persistDraftToServer();
      if (ok) {
        logDebug('本地草稿已保存到控制端可发布配置文件');
      }
    } finally {
      setBusy('save', false);
      render();
    }
  }

  async function publishConfig() {
    const payload = buildControllerPayload();
    const limitError = validateDeviceGroupLimit(payload);
    if (limitError) {
      alert(limitError);
      return;
    }
    try {
      setBusy('publish', true);
      const saved = await persistDraftToServer();
      if (!saved) return;
      await requestJson('/api/publish', {
        method: 'POST',
        timeoutMs: 20000,
        body: JSON.stringify({ source: 'ui_rebuild' })
      });
      logDebug(`发布成功 | devices=${payload.devices.length} groups=${payload.groups.length}`);
      await loadFromController();
    } catch (err) {
      logDebug(`发布失败 | ${err.message}`);
      alert(`发布失败：${err.message}`);
    } finally {
      setBusy('publish', false);
      render();
    }
  }

  async function restoreDraft() {
    try {
      setBusy('restore', true);
      let localPayload = null;
      try {
        localPayload = await fetchLocalState();
      } catch (_) {
        const backup = localStorage.getItem(STORAGE_KEYS.localState);
        localPayload = backup ? JSON.parse(backup) : null;
      }
      state.localState = normalizeLocalState(localPayload || buildDefaultLocalState());
      state.activeTab = state.localState.ui.active_tab || 'overview';
      state.deviceFilterMode = state.localState.ui.device_filter_mode || 'ungrouped';
      state.deviceFilterGroupId = normalizeNumber(state.localState.ui.device_filter_group_id, -1);
      state.selectedTemplateId = state.localState.ui.selected_template_id || builtinTemplates[0].id;
      state.controllerState = mergeDraftsIntoController(normalizeControllerState(state.controllerState, state.controllerState), state.localState);
      logDebug('已恢复本地草稿');
      await reloadServerLog(false);
      render();
    } catch (err) {
      logDebug(`恢复草稿失败 | ${err.message}`);
    } finally {
      setBusy('restore', false);
    }
  }

  async function reloadServerLog(silent = false) {
    try {
      setBusy('log', true);
      state.serverLogText = await fetchServerLog();
      if (!silent) logDebug('已读取 serve 日志');
    } catch (err) {
      state.serverLogText = `读取 serve 日志失败：${err.message}`;
      if (!silent) logDebug(`读取 serve 日志失败 | ${err.message}`);
    } finally {
      setBusy('log', false);
    }
  }

  async function clearServerLog() {
    if (!confirm('确认清空 serve 日志？')) return;
    try {
      await requestJson('/api/log/clear', {
        method: 'POST',
        timeoutMs: 5000
      });
      state.serverLogText = '';
      state.debugLines = [];
      await reloadServerLog(true);
      render();
    } catch (err) {
      alert(`清空日志失败：${err.message}`);
    }
  }

  function renderIconButton(tooltip, action, iconName) {
    return `<button class="inline-flex h-7 w-7 items-center justify-center rounded-[12px] border border-[rgba(88,116,154,0.28)] bg-[rgba(21,30,43,0.92)] text-[#dfe9f7] transition hover:brightness-105 active:translate-y-px" type="button" title="${escapeHtml(tooltip)}" data-action="${action}">${svgIcon(iconName)}</button>`;
  }

  function renderTopActions() {
    return `
      <div class="grid min-w-0 items-stretch gap-2.5 [grid-template-columns:minmax(250px,1fr)_minmax(210px,0.88fr)_minmax(260px,1.02fr)_minmax(220px,0.84fr)] max-[1680px]:grid-cols-2 max-[1160px]:grid-cols-1">
        <section class="min-h-[74px] min-w-0 rounded-[16px] border border-[rgba(88,116,154,0.34)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] p-2.5 shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
          <div class="mb-1.5 text-[11px] font-bold text-[#c7d5eb]">快速发布</div>
          <div class="flex w-full flex-wrap items-center justify-center gap-1.5">
            <button class="inline-flex h-7 min-w-[90px] items-center justify-center gap-1.5 rounded-[11px] border-0 bg-gradient-to-b from-[#4caeff] to-[#428fe0] px-2.5 text-[10.5px] font-extrabold whitespace-nowrap text-[#f7fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:brightness-105 active:translate-y-px" type="button" data-action="load-controller">${svgIcon('refresh')}读取控制端</button>
            <button class="inline-flex h-7 min-w-[90px] items-center justify-center gap-1.5 rounded-[11px] border-0 bg-gradient-to-b from-[#62d89a] to-[#48bb7c] px-2.5 text-[10.5px] font-extrabold whitespace-nowrap text-[#f8fffb] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:brightness-105 active:translate-y-px" type="button" data-action="publish">${svgIcon('arrow')}一键发布</button>
          </div>
        </section>
        <section class="min-h-[74px] min-w-0 rounded-[16px] border border-[rgba(88,116,154,0.34)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] p-2.5 shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
          <div class="mb-1.5 text-[11px] font-bold text-[#c7d5eb]">设备操作</div>
          <div class="flex w-full flex-wrap items-center justify-center gap-1.5">
            <button class="inline-flex h-7 min-w-[90px] items-center justify-center gap-1.5 rounded-[11px] border-0 bg-gradient-to-b from-[#f3c95f] to-[#c7a144] px-2.5 text-[10.5px] font-extrabold whitespace-nowrap text-[#17130a] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:brightness-105 active:translate-y-px" type="button" data-action="scan-devices">${svgIcon('search')}扫描设备</button>
            <button class="inline-flex h-7 min-w-[90px] items-center justify-center gap-1.5 rounded-[11px] border-0 bg-gradient-to-b from-[#4caeff] to-[#428fe0] px-2.5 text-[10.5px] font-extrabold whitespace-nowrap text-[#f7fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:brightness-105 active:translate-y-px" type="button" data-action="identify-all">${svgIcon('plus')}全部点名</button>
            <button class="inline-flex h-7 min-w-[90px] items-center justify-center gap-1.5 rounded-[11px] border-0 bg-gradient-to-b from-[#4caeff] to-[#428fe0] px-2.5 text-[10.5px] font-extrabold whitespace-nowrap text-[#f7fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:brightness-105 active:translate-y-px" type="button" data-action="identify-selected">${svgIcon('plus')}点名选中</button>
          </div>
        </section>
        <section class="min-h-[74px] min-w-0 rounded-[16px] border border-[rgba(88,116,154,0.34)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] p-2.5 shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
          <div class="mb-1.5 text-[11px] font-bold text-[#c7d5eb]">本地与模板</div>
          <div class="flex w-full flex-wrap items-center justify-center gap-1.5">
            <button class="inline-flex h-7 min-w-[90px] items-center justify-center gap-1.5 rounded-[11px] border-0 bg-gradient-to-b from-[#afbed2] to-[#95a7bc] px-2.5 text-[10.5px] font-extrabold whitespace-nowrap text-[#0f1825] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:brightness-105 active:translate-y-px" type="button" data-action="restore-draft">${svgIcon('refresh')}恢复草稿</button>
            <button class="inline-flex h-7 min-w-[90px] items-center justify-center gap-1.5 rounded-[11px] border-0 bg-gradient-to-b from-[#62d89a] to-[#48bb7c] px-2.5 text-[10.5px] font-extrabold whitespace-nowrap text-[#f8fffb] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:brightness-105 active:translate-y-px" type="button" data-action="save-local">${svgIcon('save')}保存本地</button>
            <button class="inline-flex h-7 min-w-[90px] items-center justify-center gap-1.5 rounded-[11px] border-0 bg-gradient-to-b from-[#afbed2] to-[#95a7bc] px-2.5 text-[10.5px] font-extrabold whitespace-nowrap text-[#0f1825] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:brightness-105 active:translate-y-px" type="button" data-action="open-templates">${svgIcon('list')}游戏模板</button>
            <button class="inline-flex h-7 min-w-[90px] items-center justify-center gap-1.5 rounded-[11px] border-0 bg-gradient-to-b from-[#6a87c9] to-[#5474b8] px-2.5 text-[10.5px] font-extrabold whitespace-nowrap text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:brightness-105 active:translate-y-px" type="button" data-action="open-wizard">${svgIcon('room')}向导开局</button>
          </div>
        </section>
        <section class="grid min-w-0 grid-cols-[minmax(0,1fr)_28px] items-center gap-2 rounded-[16px] border border-[rgba(88,116,154,0.34)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] p-2.5 shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
          <div class="min-w-0">
            <div class="mt-0.5 flex items-center gap-1.5 text-[11.5px] font-extrabold leading-[1.2]">
              <span class="h-[13px] w-[13px] rounded-full bg-[#6be29d] shadow-[0_0_0_4px_rgba(67,209,122,0.16)]"></span>
              <span>控制端：${state.controllerOnline ? '已连接' : '未连接'}</span>
            </div>
            <div class="mt-1.5 break-all text-[10.5px] leading-[1.35] text-[#d6e1f1]">${escapeHtml(state.controllerBase || '/api/controller')}</div>
          </div>
          ${renderIconButton('设置 / 调试', 'open-debug', 'gear')}
        </section>
      </div>
    `;
  }

  function renderOverview() {
    return `
      <section class="rounded-[16px] border border-[rgba(88,116,154,0.34)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] p-3.5 shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
        <div class="mb-3 flex items-start justify-between gap-3">
          <h3 class="m-0 text-[16px] font-extrabold leading-none">总览</h3>
          <div class="flex flex-wrap justify-end gap-2">
            ${makePill('桌面端导航布局', true)}
            ${makePill(state.deviceFilterMode === 'ungrouped' ? '默认显示未分组设备' : '当前过滤中')}
          </div>
        </div>
        <div class="grid gap-2.5 [grid-template-columns:repeat(3,minmax(0,1fr))] max-[1680px]:grid-cols-3 max-[1160px]:grid-cols-2">
          <div class="min-h-[98px] rounded-[16px] border border-[rgba(75,169,255,0.35)] bg-[rgba(19,26,38,0.94)] p-2.5 shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
            <div class="mb-2.5 flex items-center gap-2"><span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(75,169,255,0.18)] text-[#7ec6ff]">${svgIcon('device')}</span><span class="text-[11px] font-bold text-[#c7d5eb]">在线设备</span></div>
            <div class="text-[23px] font-extrabold leading-none">${onlineCount()} <span class="text-[13px] font-normal text-[#9fb2c8]">/ ${controllerDevices().length}</span></div>
            <div class="mt-2.5 text-[11px] leading-[1.35] text-[#aabbd1]">当前加载进页面的设备数量</div>
          </div>
          <div class="min-h-[98px] rounded-[16px] border border-[rgba(240,201,85,0.35)] bg-[rgba(19,26,38,0.94)] p-2.5 shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
            <div class="mb-2.5 flex items-center gap-2"><span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(240,201,85,0.18)] text-[#f3c44d]">${svgIcon('device')}</span><span class="text-[11px] font-bold text-[#c7d5eb]">未分组设备</span></div>
            <div class="text-[23px] font-extrabold leading-none">${ungroupedCount()}</div>
            <div class="mt-2.5 text-[11px] leading-[1.35] text-[#aabbd1]">默认先看这个，避免漏掉新接入设备</div>
          </div>
          <div class="min-h-[98px] rounded-[16px] border border-[rgba(93,225,143,0.35)] bg-[rgba(19,26,38,0.94)] p-2.5 shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
            <div class="mb-2.5 flex items-center gap-2"><span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(93,225,143,0.18)] text-[#6be29d]">${svgIcon('group')}</span><span class="text-[11px] font-bold text-[#c7d5eb]">活跃分组</span></div>
            <div class="text-[23px] font-extrabold leading-none">${activeGroupsCount()}</div>
            <div class="mt-2.5 text-[11px] leading-[1.35] text-[#aabbd1]">当前启用并可编辑的分组数量</div>
          </div>
          <div class="min-h-[98px] rounded-[16px] border border-[rgba(177,103,255,0.35)] bg-[rgba(19,26,38,0.94)] p-2.5 shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
            <div class="mb-2.5 flex items-center gap-2"><span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(177,103,255,0.18)] text-[#a966ff]">${svgIcon('effect')}</span><span class="text-[11px] font-bold text-[#c7d5eb]">灯效模板</span></div>
            <div class="text-[23px] font-extrabold leading-none">${effectTemplatesCount()}</div>
            <div class="mt-2.5 text-[11px] leading-[1.35] text-[#aabbd1]">可复用的灯效模板总数</div>
          </div>
          <div class="min-h-[98px] rounded-[16px] border border-[rgba(239,106,120,0.35)] bg-[rgba(19,26,38,0.94)] p-2.5 shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
            <div class="mb-2.5 flex items-center gap-2"><span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(239,106,120,0.18)] text-[#ef6a78]">${svgIcon('record')}</span><span class="text-[11px] font-bold text-[#c7d5eb]">发现记录</span></div>
            <div class="text-[23px] font-extrabold leading-none">${state.roomRecords.length}</div>
            <div class="mt-2.5 text-[11px] leading-[1.35] text-[#aabbd1]">当前保存的配对与房间历史</div>
          </div>
          <div class="min-h-[98px] rounded-[16px] border border-[rgba(75,169,255,0.35)] bg-[rgba(19,26,38,0.94)] p-2.5 shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
            <div class="mb-2.5 flex items-center gap-2"><span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(75,169,255,0.18)] text-[#7ec6ff]">${svgIcon('room')}</span><span class="text-[11px] font-bold text-[#c7d5eb]">当前游戏房间</span></div>
            <div class="text-[19px] font-extrabold leading-[1.08]">${escapeHtml(selectedTemplateName())}</div>
            <div class="mt-2.5 text-[11px] leading-[1.35] text-[#aabbd1]">房间状态：${currentRoomStatusLabel()} · ${formatTime(currentRoom()?.started_at || '') || '未开始'}</div>
          </div>
        </div>
      </section>
    `;
  }

  function renderLogPanel() {
    const serverLines = (state.serverLogText || '')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-10)
      .reverse();
    const debugLines = state.debugLines.slice(0, 8);
    const lines = [...debugLines, ...serverLines.map((line) => `[serve] ${line}`)].slice(0, 12);
    return `
      <details class="rounded-[16px] border border-[rgba(88,116,154,0.34)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-[12px] font-extrabold">
          <span>调试日志（原始错误）</span>
          <span class="text-[10px] font-medium text-[#9cadc6]">可展开 / 收起</span>
        </summary>
        <div class="border-t border-[rgba(88,116,154,0.18)] px-4 py-3">
          <div class="mb-2.5 flex flex-wrap justify-end gap-2">
            <button class="inline-flex h-[26px] items-center justify-center rounded-full border border-[rgba(88,113,145,0.28)] bg-[rgba(24,33,47,0.92)] px-2.5 text-[10px] text-[#dae5f4] hover:brightness-105" type="button" data-action="load-serve-log">读取 serve 日志</button>
            <button class="inline-flex h-[26px] items-center justify-center rounded-full border border-[rgba(88,113,145,0.28)] bg-[rgba(24,33,47,0.92)] px-2.5 text-[10px] text-[#dae5f4] hover:brightness-105" type="button" data-action="clear-serve-log">清空 serve 日志</button>
            <button class="inline-flex h-[26px] items-center justify-center rounded-full border border-[rgba(88,113,145,0.28)] bg-[rgba(24,33,47,0.92)] px-2.5 text-[10px] text-[#dae5f4] hover:brightness-105" type="button" data-action="copy-debug">复制调试文本</button>
            <button class="inline-flex h-[26px] items-center justify-center rounded-full border border-[rgba(88,113,145,0.28)] bg-[rgba(24,33,47,0.92)] px-2.5 text-[10px] text-[#dae5f4] hover:brightness-105" type="button" data-action="clear-debug">清空页面调试</button>
          </div>
          <div class="max-h-[200px] overflow-auto rounded-[14px] border border-[rgba(84,108,141,0.24)] bg-[rgba(16,22,31,0.94)] p-3 text-[11px] leading-[1.55] text-[#dbe5f6]">
            ${lines.length ? lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('') : '<div class="text-[#8fa4bf]">暂无日志。</div>'}
          </div>
        </div>
      </details>
    `;
  }

  function renderTabs() {
    const tabs = [
      ['overview', '总览'],
      ['devices', '设备'],
      ['groups', '分组'],
      ['game', '游戏功能'],
      ['effects', '灯效库'],
      ['preview', '预览台'],
      ['templates', '游戏模板'],
      ['room', '游戏房间'],
      ['debug', '调试']
    ];
    return `
      <div class="rounded-[16px] border border-[rgba(88,116,154,0.34)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
        <div class="flex flex-wrap gap-1 border-b border-[rgba(88,116,154,0.18)] px-3 pt-3">
          ${tabs.map(([key, label]) => `<button class="inline-flex h-7 items-center rounded-t-[11px] border border-b-0 border-transparent px-3 text-[11px] font-extrabold text-[#96a7bd] transition hover:text-white ${state.activeTab === key ? 'border-[rgba(88,116,154,0.28)] bg-[rgba(28,39,55,0.98)] text-white' : 'bg-transparent'}" type="button" data-action="tab" data-tab="${key}">${escapeHtml(label)}</button>`).join('')}
        </div>
        <div class="grid gap-0">
          <section class="p-3.5" data-page="overview" style="display:${state.activeTab === 'overview' ? 'block' : 'none'}">
            ${renderOverview()}
          </section>
          <section class="p-3.5" data-page="devices" style="display:${state.activeTab === 'devices' ? 'block' : 'none'}">
            ${renderDevicesPage()}
          </section>
          <section class="p-3.5" data-page="groups" style="display:${state.activeTab === 'groups' ? 'block' : 'none'}">
            ${renderGroupsPage()}
          </section>
          <section class="p-3.5" data-page="game" style="display:${state.activeTab === 'game' ? 'block' : 'none'}">
            ${renderGamePage()}
          </section>
          <section class="p-3.5" data-page="effects" style="display:${state.activeTab === 'effects' ? 'block' : 'none'}">
            ${renderEffectsPage()}
          </section>
          <section class="p-3.5" data-page="preview" style="display:${state.activeTab === 'preview' ? 'block' : 'none'}">
            ${renderPreviewPage()}
          </section>
          <section class="p-3.5" data-page="templates" style="display:${state.activeTab === 'templates' ? 'block' : 'none'}">
            ${renderTemplatesPage()}
          </section>
          <section class="p-3.5" data-page="room" style="display:${state.activeTab === 'room' ? 'block' : 'none'}">
            ${renderRoomPage()}
          </section>
          <section class="p-3.5" data-page="debug" style="display:${state.activeTab === 'debug' ? 'block' : 'none'}">
            ${renderDebugPage()}
          </section>
        </div>
      </div>
    `;
  }

  function renderDevicesToolbar() {
    const visible = filteredDevices();
    const checked = visible.length > 0 && visible.every((device) => state.selectedDeviceIds.has(device.mac));
    const groupOptions = controllerGroups()
      .map((group) => `<option value="${group.id}" ${normalizeNumber(state.deviceFilterGroupId, -1) === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`)
      .join('');
    return `
      <div class="sub-row">
        <div class="pill-actions">
          ${makePillButton(`全部 ${controllerDevices().length}`, 'device-filter-mode-all', state.deviceFilterMode === 'all')}
          ${makePillButton(`未分组 ${ungroupedCount()}`, 'device-filter-mode-ungrouped', state.deviceFilterMode === 'ungrouped')}
          ${makePillButton('按分组筛选', 'device-filter-mode-group', state.deviceFilterMode === 'group')}
          <select class="page-select" data-action="device-filter-group" ${state.deviceFilterMode === 'group' ? '' : 'disabled'}>
            <option value="-1">全部分组</option>
            ${groupOptions}
          </select>
        </div>
        <div class="pill-actions">
          ${makePill(`总数 ${controllerDevices().length}`)}
          ${makePill(`可见 ${visible.length}`)}
          ${makePill(`已选 ${state.selectedDeviceIds.size}`)}
        </div>
      </div>
      <div class="sub-row">
        <label class="checkbox-line">
          <input type="checkbox" data-action="select-all-visible" ${checked ? 'checked' : ''}>
          全选（当前可见）
        </label>
        <div class="pill-actions">
          <button class="ghost-btn" type="button" data-action="clear-selected-groups">${svgIcon('trash')}取消所选设备分组</button>
          <button class="ghost-btn" type="button" data-action="clear-selection">${svgIcon('refresh')}清空选择</button>
        </div>
      </div>
    `;
  }

  function renderDeviceRow(device) {
    const idx = normalizeNumber(device.idx, 0);
    const mac = String(device.mac || '');
    const online = normalizeNumber(device.seen_ms, 999999) < 10000;
    const editing = state.editingMac === mac;
    const name = deviceDisplayName(device);
    const selected = state.selectedDeviceIds.has(mac);
    const groupIds = visibleGroupIdsForDevice(device);
    const draftName = editing ? state.editingDraft : name;
    const groupCells = controllerGroups().map((group) => {
      const checked = groupIds.includes(group.id);
      return `
        <label class="group-check">
          <input type="checkbox" data-action="toggle-device-group" data-mac="${escapeHtml(mac)}" data-gid="${group.id}" ${checked ? 'checked' : ''}>
          ${escapeHtml(group.name)}
        </label>
      `;
    }).join('');

    return `
      <tr data-device-row="${escapeHtml(mac)}">
        <td>
          <label class="checkbox-line">
            <input type="checkbox" data-action="toggle-device-select" data-mac="${escapeHtml(mac)}" ${selected ? 'checked' : ''}>
          </label>
        </td>
        <td class="name-cell">
          <div class="device-name-wrap">
            <div class="device-name-top">
              <div class="device-name-main">
                ${editing ? `<input class="name-editor" data-role="device-name-input" data-mac="${escapeHtml(mac)}" value="${escapeHtml(draftName)}">` : `<div>${escapeHtml(name)}</div>`}
              </div>
              <div class="device-name-actions">
                ${editing
                  ? `<button class="table-btn save" type="button" data-action="save-device-name" data-mac="${escapeHtml(mac)}">保存</button>
                     <button class="table-btn cancel" type="button" data-action="cancel-device-name" data-mac="${escapeHtml(mac)}">取消</button>`
                  : `<button class="table-btn" type="button" data-action="edit-device-name" data-mac="${escapeHtml(mac)}">编辑</button>`}
              </div>
            </div>
            <div class="status-line"><span class="tiny-dot" style="background:${online ? '#42d96f' : '#f0c955'}"></span>${online ? '在线' : '离线'}</div>
          </div>
        </td>
        <td>${escapeHtml(mac)}</td>
        <td><span class="rssi">${normalizeNumber(device.rssi, 0)} dBm</span><span class="signal-icon" style="color:${normalizeNumber(device.rssi, 0) > -50 ? '#57da78' : '#f0c955'}"><span></span><span></span><span></span><span></span></span></td>
        <td>${escapeHtml(formatAgo(device.seen_ms))}</td>
        <td>
          <div class="device-name-actions">
            <button class="table-btn" type="button" data-action="identify-device" data-idx="${idx}">点名</button>
            <button class="table-btn save" type="button" data-action="save-device-row" data-mac="${escapeHtml(mac)}">保存设备</button>
          </div>
        </td>
        <td><div class="group-cell">${groupCells || '<span style="color:#8ea1bc">无可选分组</span>'}</div></td>
      </tr>
    `;
  }

  function renderDevicesPage() {
    const devices = filteredDevices();
    return `
      <div class="page-section-head">
        <div>
          <h3>设备</h3>
          <p>这里负责命名、筛选、批量分组和点名。默认先看未分组设备，避免漏掉新接入设备。</p>
        </div>
        <div class="pill-actions">
          ${makePill(`总数 ${controllerDevices().length}`)}
          ${makePill(`可见 ${devices.length}`)}
          ${makePill(`已选 ${state.selectedDeviceIds.size}`)}
        </div>
      </div>
      <div class="page-section-body" style="display:grid;grid-template-columns:minmax(0,1.58fr) 540px;gap:16px;align-items:start">
        <div class="table-panel" style="padding:14px 14px 16px">
          <h4 style="margin:0 0 8px;font-size:17px;">设备列表</h4>
          <div style="color:#9db0c8;font-size:14px;margin-bottom:10px">这里负责命名、筛选、批量分组和点名。默认先看未分组设备，避免漏掉新接入设备。</div>
          ${renderDevicesToolbar()}
          <div style="overflow:auto">
            <table>
              <thead>
                <tr>
                  <th style="width:44px"></th>
                  <th>设备名称</th>
                  <th>MAC 地址</th>
                  <th>信号 (RSSI)</th>
                  <th>最后上线</th>
                  <th>操作</th>
                  <th>分组成员（可多选）</th>
                </tr>
              </thead>
              <tbody>
                ${devices.length ? devices.map((device) => renderDeviceRow(device)).join('') : `<tr><td colspan="7" style="color:#91a5c3;text-align:center;padding:28px">当前筛选下没有设备。</td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="pager">
            <div>共 ${controllerDevices().length} 条 · 当前显示 ${devices.length} 条</div>
            <div class="pager-center">
              <button class="page-btn active" type="button">1</button>
              <button class="page-btn" type="button">2</button>
            </div>
            <div class="page-select">10 条 / 页</div>
          </div>
        </div>
        <aside class="groups-panel">
          <div class="groups-head">
            <h3>分组（预览）</h3>
            <button class="mini-btn" type="button" data-action="open-groups">管理分组</button>
          </div>
          <div class="group-list">
            ${controllerGroups().map((group) => renderGroupCard(group)).join('') || '<div class="notice">暂无分组。先创建分组后再分配设备。</div>'}
          </div>
        </aside>
      </div>
    `;
  }

  function renderGroupCard(group) {
    const colorClass = groupPalette[group.id % groupPalette.length];
    const memberCount = controllerDevices().filter((device) => ((normalizeNumber(device.group_mask, 0) >>> 0) & (1 << group.id)) !== 0).length;
    return `
      <div class="group-card ${colorClass}">
        <div class="group-top">
          <div class="group-name"><span class="bullet"></span>${escapeHtml(group.name)} <span class="group-id">ID: ${group.id + 1001}</span></div>
          <button class="more-btn" type="button" data-action="select-group" data-gid="${group.id}">⋯</button>
        </div>
        <div class="group-desc">${escapeHtml(group.note || '未填写备注')}</div>
        <div class="group-meta">
          <div class="meta-left"><span>👥</span><span>${memberCount} 台设备</span></div>
          <div class="target">目标组：<strong>${escapeHtml(groupTargetName(group))}${group.mode === 0 ? ` (+${group.id + 2})` : ''}</strong></div>
        </div>
      </div>
    `;
  }

  function renderGroupsPage() {
    const groups = controllerGroups();
    return `
      <div class="page-section-head">
        <div>
          <h3>分组</h3>
          <p>分组是轻量标签容器，只保留名称、备注、成员和目标关系。复杂规则放到“游戏功能”里。</p>
        </div>
        <div class="pill-actions">
          ${makePill('每个设备最多 8 个组', true)}
          ${makePill('删除分组会自动清标记')}
        </div>
      </div>
      <div class="page-section-body two-col">
        <div class="mini-panel">
          <h4>分组列表</h4>
          <div class="group-mini-list">
            ${groups.map((group) => `
              <div class="group-mini-item">
                <div>
                  <div class="title">${escapeHtml(group.name)}</div>
                  <div class="desc">ID ${group.id + 1001} · ${escapeHtml(group.note || '')} · ${controllerDevices().filter((device) => ((normalizeNumber(device.group_mask, 0) >>> 0) & (1 << group.id)) !== 0).length} 台设备</div>
                </div>
                <span class="pill">目标：${escapeHtml(groupTargetName(group))}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="mini-panel">
          <h4>分组编辑</h4>
          <div class="form-grid">
            <div class="field"><label>分组名称</label><div class="fake-input">${escapeHtml(controllerGroups()[0]?.name || '魔杖组')}</div></div>
            <div class="field"><label>备注名称</label><div class="fake-input">${escapeHtml(controllerGroups()[0]?.note || '地图魔杖区域触发设备')}</div></div>
            <div class="field"><label>目标分组</label><div class="fake-select">${escapeHtml(groupTargetName(controllerGroups()[0] || null))}</div></div>
            <div class="field"><label>成员统计</label><div class="fake-input">${controllerDevices().length} 台设备 · ${activeGroupsCount()} 个目标组</div></div>
          </div>
          <div class="chip-row" style="margin-top:12px">
            ${makeChip('保存分组', true)}
            ${makeChip('新建分组')}
            ${makeChip('删除分组')}
          </div>
        </div>
      </div>
    `;
  }

  function renderGamePage() {
    const groups = controllerGroups();
    const sourceGroup = groups[0];
    const targetGroup = groups[1] || groups[0];
    return `
      <div class="page-section-head">
        <div>
          <h3>游戏功能</h3>
          <p>这里承接感应模式、RSSI 阈值、保持时间、计分灯和默认灯效。分组本身保持轻量，只负责容器关系。</p>
        </div>
        <div class="pill-actions">
          ${makePill('轮巡型', true)}
          ${makePill('组共享型')}
          ${makePill('纯响应型')}
        </div>
      </div>
      <div class="page-section-body stack-col">
        <div class="mini-panel">
          <h4>感应方式</h4>
          <div class="switch-row">
            <div class="switch-card">
              <div class="name">轮巡型</div>
              <div class="value">每个源设备独立记录目标，适合单人寻宝。</div>
            </div>
            <div class="switch-card">
              <div class="name">组共享型</div>
              <div class="value">同组共享找到记录，适合多人协作。</div>
            </div>
            <div class="switch-card">
              <div class="name">纯响应型</div>
              <div class="value">只按 RSSI 响应，不记录找到状态。</div>
            </div>
          </div>
        </div>
        <div class="mini-panel">
          <h4>RSSI 映射</h4>
          <div class="form-grid">
            <div class="field"><label>输入端点 A</label><div class="fake-input">-90 dBm</div></div>
            <div class="field"><label>输出端点 A</label><div class="fake-input">低亮 / 慢闪</div></div>
            <div class="field"><label>输入端点 B</label><div class="fake-input">-20 dBm</div></div>
            <div class="field"><label>输出端点 B</label><div class="fake-input">高亮 / 快闪</div></div>
          </div>
          <div class="chip-row" style="margin-top:12px">
            ${makeChip('反向映射', true)}
            ${makeChip('保持时间 2000ms')}
            ${makeChip('阈值 -70dBm')}
          </div>
        </div>
        <div class="mini-panel">
          <h4>计分与默认灯效</h4>
          <div class="switch-row">
            <div class="switch-card">
              <div class="name">计分灯</div>
              <div class="value">10 格一组，满格后可切换颜色并继续累加。</div>
            </div>
            <div class="switch-card">
              <div class="name">空闲灯效</div>
              <div class="value">静默 / 低亮呼吸 / 间隔闪烁。</div>
            </div>
            <div class="switch-card">
              <div class="name">触发次数</div>
              <div class="value">无限 / 10 次后停止 / 完成后定格。</div>
            </div>
          </div>
        </div>
        <div class="mini-panel">
          <h4>当前绑定示意</h4>
          <div class="form-grid">
            <div class="field"><label>源组</label><div class="fake-select">${escapeHtml(sourceGroup?.name || '魔杖组')}</div></div>
            <div class="field"><label>目标组</label><div class="fake-select">${escapeHtml(targetGroup?.name || '宝箱组')}</div></div>
            <div class="field"><label>感应规则</label><div class="fake-input">${modeLabel(sourceGroup?.mode ?? 1)}</div></div>
            <div class="field"><label>灯效绑定</label><div class="fake-input">${effectNameById(sourceGroup?.effect_template_id || sourceGroup?.effect || 'builtin-breath')}</div></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderEffectsPage() {
    const effects = controllerEffects();
    return `
      <div class="page-section-head">
        <div>
          <h3>灯效库</h3>
          <p>灯效模板独立成库，分组和预设只引用模板，不再把所有参数塞回页面里。</p>
        </div>
        <div class="pill-actions">
          ${makePill('可新建', true)}
          ${makePill('可复制')}
          ${makePill('可预览')}
        </div>
      </div>
      <div class="page-section-body">
        <div class="effect-grid">
          ${effects.map((effect) => `
            <div class="effect-card ${state.selectedEffectId === effect.id ? 'selected' : ''}" data-action="select-effect" data-effect-id="${escapeHtml(effect.id)}">
              <div class="title">${escapeHtml(effect.name)}</div>
              <div class="thumb" style="background:linear-gradient(135deg, ${escapeHtml(effect.effect_ui?.colors?.[0] || '#ffd24d')}22, ${escapeHtml(effect.effect_ui?.colors?.[1] || '#34b3ff')}44, ${escapeHtml(effect.effect_ui?.colors?.[2] || '#61e09a')}22)"></div>
              <div class="meta">${escapeHtml(effect.note || '无说明')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderPreviewBars(effectId) {
    const effect = controllerEffects().find((item) => item.id === effectId) || controllerEffects()[0];
    const colors = effect?.effect_ui?.colors || ['#F3C44D', '#34B3FF', '#61E09A'];
    return `
      <div class="led-stack">
        <div class="led-row">
          <div class="led-label">魔杖组 · 计分灯</div>
          <div class="led-track" style="background:linear-gradient(90deg, ${colors[0]}40, ${colors[1]}66, ${colors[2]}44)"></div>
        </div>
        <div class="led-row">
          <div class="led-label">宝箱组 · 触发反馈</div>
          <div class="led-track" style="background:linear-gradient(90deg, rgba(91,225,143,0.18), rgba(243,196,77,0.35))"></div>
        </div>
        <div class="led-row">
          <div class="led-label">默认空闲态</div>
          <div class="led-track" style="background:linear-gradient(90deg, rgba(159,175,195,0.18), rgba(159,175,195,0.06))"></div>
        </div>
      </div>
    `;
  }

  function renderPreviewPage() {
    const effect = controllerEffects().find((item) => item.id === state.selectedEffectId) || controllerEffects()[0];
    return `
      <div class="page-section-head">
        <div>
          <h3>预览台</h3>
          <p>先在浏览器里看灯效感觉，不接真实硬件也能确认大致节奏。</p>
        </div>
        <div class="pill-actions">
          ${makePill(state.previewPlaying ? '暂停播放' : '开始播放', true)}
          ${makePill('实时刷新')}
          ${makePill(effect?.name || '未选择')}
        </div>
      </div>
      <div class="page-section-body preview-stage">
        <div class="mini-panel">
          <h4>LED 预览轨道</h4>
          ${renderPreviewBars(state.selectedEffectId)}
        </div>
        <div class="mini-panel">
          <h4>预览参数</h4>
          <div class="stack-col">
            <div class="fake-input">当前灯效：${escapeHtml(effect?.name || '常亮')}</div>
            <div class="fake-input">颜色：${escapeHtml(effect?.effect_ui?.colors?.[0] || '#FFD24D')} → ${escapeHtml(effect?.effect_ui?.colors?.[1] || '#34B3FF')}</div>
            <div class="fake-input">速度：${escapeHtml(effect?.effect_ui?.period || 700)} ms / 周期</div>
            <div class="fake-input">LED 路数：3 路 · 间隔 1 个</div>
            <div class="chip-row">
              ${makeChip(state.previewPlaying ? '播放中' : '已暂停', true)}
              ${makeChip('暂停')}
              ${makeChip('重置')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderTemplateCards() {
    const templates = state.localState.templates || [];
    return templates.map((template) => {
      const selected = template.id === state.selectedTemplateId;
      const status = selected ? '当前选中' : '可复用';
      const hasConfig = !!template.config;
      return `
        <button class="${[
          'group relative w-full overflow-hidden rounded-[18px] border text-left transition',
          'px-4 py-3.5',
          selected
            ? 'border-[rgba(120,184,255,0.82)] bg-[linear-gradient(180deg,rgba(28,44,69,0.98),rgba(18,28,42,0.98))] shadow-[0_0_0_1px_rgba(120,184,255,0.18),0_16px_34px_rgba(0,0,0,0.24)] ring-1 ring-[rgba(120,184,255,0.18)]'
            : 'border-[rgba(88,116,154,0.24)] bg-[rgba(14,20,31,0.92)] hover:border-[rgba(120,184,255,0.38)] hover:bg-[rgba(16,24,36,0.96)]'
        ].join(' ')}" type="button" aria-pressed="${selected ? 'true' : 'false'}" data-action="select-template" data-template-id="${escapeHtml(template.id)}">
          <span class="absolute inset-y-0 left-0 w-1.5 ${selected ? 'bg-[#64b3ff]' : 'bg-transparent'}"></span>
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 pr-1">
              <div class="flex items-center gap-2">
                <div class="${selected ? 'text-[14px]' : 'text-[13px]'} font-extrabold leading-[1.12] text-[#f4f8ff]">${escapeHtml(template.name)}</div>
                <span class="${[
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap',
                  selected
                    ? 'border-transparent bg-[#4d8ddb] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)]'
                    : 'border-[rgba(88,116,154,0.24)] bg-[rgba(21,30,43,0.86)] text-[#c7d5eb]'
                ].join(' ')}">${escapeHtml(status)}</span>
              </div>
              <div class="mt-1.5 text-[11px] leading-[1.45] text-[#9fb2c8]">${escapeHtml(template.note || '无备注')}</div>
            </div>
            <span class="${[
              'shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold whitespace-nowrap',
              selected
                ? 'border-[rgba(99,172,255,0.42)] bg-[rgba(75,169,255,0.16)] text-[#dbeaff]'
                : 'border-[rgba(88,116,154,0.24)] bg-[rgba(21,30,43,0.86)] text-[#c7d5eb]'
            ].join(' ')}">${selected ? '当前选中' : '可复用'}</span>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <span class="${[
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold whitespace-nowrap',
              selected
                ? 'border-transparent bg-[rgba(88,167,255,0.18)] text-[#dbeaff]'
                : 'border-[rgba(88,116,154,0.24)] bg-[rgba(21,30,43,0.86)] text-[#c7d5eb]'
            ].join(' ')}">
              ${selected ? svgIcon('check') : svgIcon('copy')}
              ${selected ? '已选中' : '点选切换'}
            </span>
            <span class="${[
              'inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold whitespace-nowrap',
              hasConfig ? 'border-transparent bg-[rgba(91,225,143,0.16)] text-[#82e8a9]' : 'border-[rgba(88,116,154,0.24)] bg-[rgba(21,30,43,0.86)] text-[#c7d5eb]'
            ].join(' ')}">${hasConfig ? '含完整配置' : '仅模板说明'}</span>
            <span class="inline-flex items-center rounded-full border border-[rgba(88,116,154,0.24)] bg-[rgba(21,30,43,0.86)] px-2.5 py-1 text-[10px] font-bold whitespace-nowrap text-[#c7d5eb]">${escapeHtml(formatTime(template.updated_at))}</span>
          </div>
        `;
    }).join('');
  }

  function renderRoomPanel() {
    const rooms = roomList();
    const room = currentRoom();
    const validation = validateRoomReady(room);
    const canStart = validation.issues.length === 0;
    const roomStatusClass = room?.status === 'running'
      ? 'border-[rgba(91,225,143,0.42)] bg-[rgba(19,31,27,0.96)] text-[#8ff0b0]'
      : room?.status === 'ended'
        ? 'border-[rgba(255,124,124,0.34)] bg-[rgba(34,18,20,0.96)] text-[#ffb0b0]'
        : 'border-[rgba(88,116,154,0.24)] bg-[rgba(14,20,31,0.9)] text-[#d6e5f4]';
    const roomCards = rooms.length
      ? rooms.map((item) => {
          const active = item.id === activeRoomId();
          const itemValidation = validateRoomReady(item);
          const canItemStart = item.status === 'running' || itemValidation.issues.length === 0;
          const statusText = item.status === 'running' ? '进行中' : item.status === 'ended' ? '已结束' : '草稿';
          const statusClass = item.status === 'running'
            ? 'border-[rgba(91,225,143,0.34)] bg-[rgba(18,34,23,0.96)] text-[#8ff0b0]'
            : item.status === 'ended'
              ? 'border-[rgba(255,124,124,0.3)] bg-[rgba(34,18,20,0.94)] text-[#ffb0b0]'
              : 'border-[rgba(88,116,154,0.24)] bg-[rgba(14,20,31,0.9)] text-[#d6e5f4]';
          return `
            <article class="${[
              'rounded-[18px] border p-4 transition',
              active
                ? 'border-[rgba(120,184,255,0.72)] bg-[linear-gradient(180deg,rgba(20,33,51,0.98),rgba(16,24,36,0.96))] shadow-[0_0_0_1px_rgba(120,184,255,0.12),0_12px_28px_rgba(0,0,0,0.18)]'
                : 'border-[rgba(88,116,154,0.24)] bg-[rgba(14,20,31,0.9)] hover:border-[rgba(120,184,255,0.32)]'
            ].join(' ')}">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <div class="truncate text-[14px] font-extrabold leading-none text-white">${escapeHtml(item.name || '未命名房间')}</div>
                    <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold whitespace-nowrap ${statusClass}">${escapeHtml(statusText)}</span>
                  </div>
                  <div class="mt-1 text-[11px] leading-[1.5] text-[#9fb2c8]">模板：${escapeHtml(item.template_name || '未选择模板')} · 更新时间：${escapeHtml(formatTime(item.updated_at || item.created_at))}</div>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold whitespace-nowrap text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px" type="button" data-action="select-room" data-room-id="${escapeHtml(item.id)}">${svgIcon('check')}设为当前</button>
                  <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold whitespace-nowrap text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px" type="button" data-action="room-open-wizard" data-room-id="${escapeHtml(item.id)}">${svgIcon('edit')}${item.status === 'draft' ? '继续编辑' : '查看'}</button>
                  <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border-0 bg-gradient-to-b from-[#4caeff] to-[#428fe0] px-3.5 text-[11px] font-extrabold whitespace-nowrap text-white transition hover:brightness-105 active:translate-y-px ${canItemStart ? '' : 'opacity-45 pointer-events-none'}" type="button" data-action="room-start" data-room-id="${escapeHtml(item.id)}">${svgIcon('play')}开始</button>
                  <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border-0 bg-gradient-to-b from-[#62d89a] to-[#48bb7c] px-3.5 text-[11px] font-extrabold whitespace-nowrap text-white transition hover:brightness-105 active:translate-y-px ${item.status === 'ended' ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="room-end" data-room-id="${escapeHtml(item.id)}">${svgIcon('pause')}结束</button>
                </div>
              </div>

              <div class="mt-3 grid gap-2 lg:grid-cols-2">
                <div class="rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2">
                  <div class="text-[10px] font-bold text-[#8ea3bf]">源组</div>
                  <div class="mt-1 text-[12px] font-semibold text-white">${escapeHtml((item.source_group_ids || []).map((gid) => groupNameById(gid)).join(' / ') || '未选择')}</div>
                </div>
                <div class="rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2">
                  <div class="text-[10px] font-bold text-[#8ea3bf]">目标组</div>
                  <div class="mt-1 text-[12px] font-semibold text-white">${escapeHtml((item.target_group_ids || []).map((gid) => groupNameById(gid)).join(' / ') || '未选择')}</div>
                </div>
              </div>

              <div class="mt-3 flex flex-wrap items-center gap-2">
                ${makeChip(`状态 ${escapeHtml(statusText)}`, true)}
                ${makeChip(`源组 ${normalizeNumber(item.source_group_ids?.length, 0)}`)}
                ${makeChip(`目标组 ${normalizeNumber(item.target_group_ids?.length, 0)}`)}
                ${makeChip(`分组 ${normalizeNumber(item.group_ids?.length, 0)}`)}
              </div>

              <div class="mt-3 rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.55] text-[#9fb2c8]">
                ${escapeHtml(item.notes || '这里记录本局的开始、结束和房间摘要。')}
              </div>
            </article>
          `;
        }).join('')
      : '<div class="rounded-[18px] border border-dashed border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.86)] px-4 py-6 text-[12px] leading-[1.6] text-[#9fb2c8]">当前还没有房间。点击“新建房间”或在向导里创建一个新局。</div>';
    return `
      <div class="grid gap-3 xl:grid-cols-[minmax(0,1.28fr)_minmax(320px,0.72fr)]">
        <section class="rounded-[20px] border border-[rgba(88,116,154,0.26)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[17px] font-extrabold leading-none text-white">房间列表</div>
              <div class="mt-1.5 text-[12px] leading-[1.5] text-[#aabbd1]">同一种模板可以同时开多个房间，只是设备组不同。这里显示的是本地所有草稿、进行中和已结束房间。</div>
            </div>
            <div class="flex flex-wrap justify-end gap-2">
              <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold whitespace-nowrap text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px" type="button" data-action="create-room">${svgIcon('plus')}新建房间</button>
              <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border-0 bg-gradient-to-b from-[#4caeff] to-[#428fe0] px-3.5 text-[11px] font-extrabold whitespace-nowrap text-white transition hover:brightness-105 active:translate-y-px" type="button" data-action="open-wizard">${svgIcon('arrow')}向导开局</button>
            </div>
          </div>
          <div class="mt-4 grid gap-3">
            ${roomCards}
          </div>
        </section>
        <aside class="rounded-[20px] border border-[rgba(88,116,154,0.26)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[17px] font-extrabold leading-none text-white">当前房间</div>
              <div class="mt-1.5 text-[12px] leading-[1.5] text-[#aabbd1]">这是当前选中的房间实例。开始前请确认模板、源组和目标组。</div>
            </div>
            ${makePill(`步骤 ${wizardState().step + 1}/4`, true)}
          </div>
          <div class="mt-3 grid gap-2.5">
            <div class="rounded-[16px] border ${roomStatusClass} p-3">
              <div class="text-[11px] font-bold text-[#c7d5eb]">名称</div>
              <div class="mt-1 text-[14px] font-extrabold text-white">${escapeHtml(room?.name || '当前房间未创建')}</div>
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
              <div class="text-[11px] font-bold text-[#c7d5eb]">模板</div>
              <div class="mt-1 text-[13px] font-extrabold text-white">${escapeHtml(room?.template_name || selectedTemplateName())}</div>
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
              <div class="text-[11px] font-bold text-[#c7d5eb]">状态</div>
              <div class="mt-1 text-[13px] font-extrabold ${room?.status === 'running' ? 'text-[#8ff0b0]' : room?.status === 'ended' ? 'text-[#ffb0b0]' : 'text-white'}">${escapeHtml(currentRoomStatusLabel())}</div>
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
              <div class="text-[11px] font-bold text-[#c7d5eb]">时长</div>
              <div class="mt-1 text-[13px] font-extrabold text-white">${escapeHtml(currentRoomDuration())}</div>
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
              <div class="text-[11px] font-bold text-[#c7d5eb]">摘要</div>
              <div class="mt-1 text-[11px] leading-[1.6] text-[#aabbd1]">${escapeHtml(room?.notes || '这里记录本局的开始、结束和房间摘要。')}</div>
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
              <div class="text-[11px] font-bold text-[#c7d5eb]">本局统计</div>
              <div class="mt-2 flex flex-wrap gap-2">
                ${makeChip(`记录 ${state.roomRecords.length}`, true)}
                ${makeChip(`设备 ${controllerDevices().length}`)}
                ${makeChip(`分组 ${activeGroupsCount()}`)}
              </div>
            </div>
            <div class="flex flex-wrap gap-2 pt-1">
              <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold whitespace-nowrap text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px" type="button" data-action="start-room">${svgIcon('play')}开始游戏</button>
              <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold whitespace-nowrap text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px" type="button" data-action="end-room">${svgIcon('pause')}结束游戏</button>
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.55] text-[#99acc5]">
              房间开始后，本局记录会写入本地 JSONL 文件，便于后面统计和回放。
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.55] text-[#99acc5]">
              ${validation.issues.length ? escapeHtml(validation.issues[0]) : '当前房间配置已满足开始条件。'}
            </div>
          </div>
        </aside>
      </div>
    `;
  }

  function renderRoomPage() {
    return `
      <div class="page-section-head">
        <div>
          <h3>游戏房间</h3>
          <p>房间是一次实际开局的运行实例。先选模板，再绑定设备组和目标组，然后开始、结束和统计本局。同一种模板可以同时存在多个房间实例。</p>
        </div>
        <div class="pill-actions">
          ${makePill('先选模板', true)}
          ${makePill('再建房间')}
          ${makePill('开始 / 结束')}
        </div>
      </div>
      <div class="page-section-body stack-col">
        ${renderRoomPanel()}
        <div class="room-panel">
          <div class="room-toolbar">
            <div>
              <div class="room-title">房间历史</div>
              <div class="room-meta">结束房间时会写入本地 JSONL，便于统计和回放。</div>
            </div>
            <button class="ghost-btn" type="button" data-action="refresh-records">${svgIcon('refresh')}刷新记录</button>
          </div>
          <div class="group-mini-list">
            ${state.roomRecords.slice(0, 6).map((record) => `
              <div class="group-mini-item">
                <div>
                  <div class="title">${escapeHtml(record.room_name || record.name || '未命名房间')}</div>
                  <div class="desc">${escapeHtml(record.template_name || '')} · ${escapeHtml(record.status || 'ended')} · ${escapeHtml(record.duration || formatDuration(record.started_at, record.ended_at))}</div>
                </div>
                <span class="pill">${escapeHtml(formatTime(record.updated_at || record.ended_at || record.started_at))}</span>
              </div>
            `).join('') || '<div class="notice">暂无房间历史，先创建一个房间再开始游戏。</div>'}
          </div>
        </div>
      </div>
    `;
  }

  function renderTemplatesPage() {
    return `
      <div class="page-section-head">
        <div>
          <h3>游戏模板</h3>
          <p>模板是已经创建好的完整游戏包。NPC 先选模板，再绑定设备组、目标组和灯效，然后到“游戏房间”里开局。</p>
        </div>
        <div class="pill-actions">
          ${makePill('先选模板', true)}
          ${makePill('保存模板')}
          ${makePill('复制模板')}
        </div>
      </div>
      <div class="page-section-body stack-col">
        <div class="room-panel">
          <div class="template-toolbar">
            <div class="template-actions">
              <button class="ghost-btn" type="button" data-action="create-template">${svgIcon('plus')}从当前配置创建</button>
              <button class="ghost-btn" type="button" data-action="clone-template">${svgIcon('copy')}复制当前模板</button>
              <button class="ghost-btn" type="button" data-action="load-template">${svgIcon('refresh')}载入模板</button>
              <button class="ghost-btn" type="button" data-action="delete-template">${svgIcon('trash')}删除模板</button>
            </div>
            <div class="template-note">模板会存在本地电脑，不写进控制端运行包里。</div>
          </div>
          <div class="preset-grid">
            ${renderTemplateCards()}
          </div>
        </div>
      </div>
    `;
  }

  function renderDebugPage() {
    const serverLines = (state.serverLogText || '')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-40)
      .reverse();
    return `
      <div class="page-section-head">
        <div>
          <h3>调试</h3>
          <p>把原始日志单独放这里，方便看请求、响应、错误和发布状态，不影响主页面操作。</p>
        </div>
        <div class="pill-actions">
          ${makePill('读取 serve 日志', true)}
          ${makePill('复制调试文本')}
          ${makePill('清空页面调试')}
        </div>
      </div>
      <div class="page-section-body debug-grid">
        <div class="mini-panel">
          <h4>调试选项</h4>
          <div class="stack-col">
            <div class="fake-input">控制端地址：${escapeHtml(state.controllerBase || '/api/controller')}</div>
            <div class="fake-input">本地端口：${escapeHtml(portFromBase(state.apiBase, '8777'))}</div>
            <div class="fake-input">页面状态：${escapeHtml(state.controllerOnline ? '已联机' : '离线编辑')}</div>
            <div class="chip-row">
              ${makeChip('显示原始错误', true)}
              ${makeChip('轮询间隔 5s')}
              ${makeChip('代理路径 /api/controller')}
            </div>
          </div>
        </div>
        <div class="raw-log">${escapeHtml((state.debugLines.join('\n') + '\n' + serverLines.join('\n')).trim() || '暂无调试日志。').replace(/\n/g, '<br>')}</div>
      </div>
    `;
  }

  function renderEffectPreviewPanel() {
    const effect = controllerEffects().find((item) => item.id === state.selectedEffectId) || controllerEffects()[0];
    return `
      <div class="mini-panel">
        <h4>灯效概览</h4>
        <div class="stack-col">
          <div class="fake-input">当前灯效：${escapeHtml(effect?.name || '常亮')}</div>
          <div class="fake-input">模式：${escapeHtml(effect?.effect_ui?.mode || 'solid')}</div>
          <div class="fake-input">颜色：${escapeHtml((effect?.effect_ui?.colors || []).join(' / ') || '#FFD24D')}</div>
          <div class="fake-input">说明：${escapeHtml(effect?.note || '')}</div>
        </div>
      </div>
    `;
  }

  function renderWizardPage() {
    const room = currentRoom() || ensureRoomDraft(state.selectedTemplateId || activeTemplate()?.id || builtinTemplates[0].id);
    const template = state.localState.templates.find((item) => item.id === room.template_id)
      || activeTemplate()
      || state.localState.templates[0]
      || builtinTemplates[0];
    const groups = controllerGroups();
    const sourceIds = new Set(Array.isArray(room.source_group_ids) ? room.source_group_ids : []);
    const targetIds = new Set(Array.isArray(room.target_group_ids) ? room.target_group_ids : []);
    const step = wizardState().step;
    const steps = [
      {
        key: 'room',
        label: '房间信息',
        desc: '先给这一局起一个名字，方便后面统计和回放。',
        icon: 'room',
      },
      {
        key: 'template',
        label: '选择模板',
        desc: '从已经准备好的游戏模板里挑一个作为本局起点。',
        icon: 'copy',
      },
      {
        key: 'groups',
        label: '设备分配',
        desc: '只绑定本局参与的源组和目标组，不改底层规则。',
        icon: 'group',
      },
      {
        key: 'confirm',
        label: '确认开始',
        desc: '最后检查一次摘要，确认后正式开局。',
        icon: 'play',
      }
    ];
    const summaryGroups = (ids) => {
      const names = ids.map((gid) => groupNameById(gid));
      return names.length ? names.join(' / ') : '未选择';
    };
    const roomNameMissing = !String(room.name || '').trim();
    const selectedTemplateSelected = template.id === state.selectedTemplateId;
    const roomValidation = validateRoomReady(room);
    const canStart = roomValidation.issues.length === 0;
    const footerBtnBase = 'inline-flex h-8 w-max flex-none min-w-[122px] items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold leading-none whitespace-nowrap transition hover:brightness-105 active:translate-y-px';
    const footerBtnPrimary = 'inline-flex h-8 w-max flex-none min-w-[128px] items-center justify-center gap-1.5 rounded-full border-0 px-3.5 py-1.5 text-[11px] font-extrabold leading-none whitespace-nowrap text-white transition hover:brightness-105 active:translate-y-px';
    const footerBtnLabel = (icon, text) => `<span class="inline-flex items-center gap-1.5 whitespace-nowrap leading-none">${svgIcon(icon)}<span>${escapeHtml(text)}</span></span>`;

    const renderStepBadge = (idx, item) => {
      const active = idx === step;
      const done = idx < step;
      return `
        <div class="${[
          'rounded-[16px] border px-3 py-2.5 text-left transition',
          active
            ? 'border-transparent bg-[linear-gradient(180deg,rgba(64,119,208,0.92),rgba(45,89,163,0.96))] shadow-[0_12px_24px_rgba(0,0,0,0.18)]'
            : done
              ? 'border-[rgba(104,183,255,0.42)] bg-[rgba(18,28,42,0.94)]'
              : 'border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)]'
        ].join(' ')}">
          <div class="flex items-center gap-2">
            <span class="inline-flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-extrabold ${active ? 'border-white/20 bg-white/12 text-white' : 'border-[rgba(88,116,154,0.24)] bg-[rgba(21,30,43,0.86)] text-[#c7d5eb]'}">${idx + 1}</span>
            <div class="min-w-0">
              <div class="truncate text-[12px] font-extrabold leading-none ${active ? 'text-white' : 'text-[#dce7f5]'}">${escapeHtml(item.label)}</div>
              <div class="mt-1 text-[10.5px] leading-[1.4] ${active ? 'text-[#ecf4ff]/88' : 'text-[#92a6c3]'}">${escapeHtml(item.desc)}</div>
            </div>
          </div>
        </div>
      `;
    };

    const renderGroupPick = (group, kind) => {
      const checked = kind === 'source' ? sourceIds.has(group.id) : targetIds.has(group.id);
      const action = kind === 'source' ? 'wizard-toggle-source-group' : 'wizard-toggle-target-group';
      const selectedBorder = kind === 'source'
        ? 'peer-checked:border-[#4ba9ff] peer-checked:bg-[linear-gradient(180deg,rgba(18,34,52,0.98),rgba(12,20,30,0.96))] peer-checked:shadow-[0_0_0_1px_rgba(75,169,255,0.22),0_14px_28px_rgba(0,0,0,0.22)] peer-checked:ring-1 peer-checked:ring-inset peer-checked:ring-[rgba(75,169,255,0.18)]'
        : 'peer-checked:border-[#6be29d] peer-checked:bg-[linear-gradient(180deg,rgba(16,34,25,0.98),rgba(11,19,16,0.96))] peer-checked:shadow-[0_0_0_1px_rgba(107,226,157,0.2),0_14px_28px_rgba(0,0,0,0.22)] peer-checked:ring-1 peer-checked:ring-inset peer-checked:ring-[rgba(107,226,157,0.18)]';
      const accentText = kind === 'source' ? 'peer-checked:text-[#e4f2ff]' : 'peer-checked:text-[#e4ffef]';
      const accentDot = kind === 'source' ? 'peer-checked:bg-[#4ba9ff] peer-checked:shadow-[0_0_0_4px_rgba(75,169,255,0.18)]' : 'peer-checked:bg-[#6be29d] peer-checked:shadow-[0_0_0_4px_rgba(107,226,157,0.18)]';
      const badgeBase = 'inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[9px] font-extrabold whitespace-nowrap transition';
      const badgeClass = checked
        ? (kind === 'source'
          ? 'border-[#4ba9ff]/40 bg-[#4ba9ff]/18 text-[#d8ebff]'
          : 'border-[#6be29d]/40 bg-[#6be29d]/18 text-[#dcffe8]')
        : 'border-[rgba(88,116,154,0.26)] bg-[rgba(21,30,43,0.86)] text-[#9fb2c8]';
      return `
        <label class="${[
          'group relative flex cursor-pointer flex-col gap-2 rounded-[16px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] px-3 py-2.75 text-[12px] text-[#d9e4f3] transition hover:border-[rgba(120,167,224,0.34)]',
          selectedBorder
        ].join(' ')}">
          <input class="peer sr-only" type="checkbox" data-action="${action}" data-gid="${group.id}" ${checked ? 'checked' : ''}>
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-2.5">
              <span class="${['mt-0.5 inline-flex h-4 w-4 shrink-0 rounded-[4px] border border-[rgba(88,116,154,0.45)] bg-[rgba(21,30,43,0.9)] transition', accentDot].join(' ')}"></span>
              <span class="min-w-0">
                <span class="${['block truncate font-bold text-[#f3f7ff] transition', accentText].join(' ')}">${escapeHtml(group.name)}</span>
                <span class="mt-0.5 block text-[10.5px] leading-[1.35] text-[#9fb2c8]">${escapeHtml(group.note || '无备注')} · ${escapeHtml(groupTargetName(group))}</span>
              </span>
            </div>
            <span class="${[badgeBase, badgeClass].join(' ')}">${checked ? '已选中' : '点击选择'}</span>
          </div>
        </label>
      `;
    };

    return `
      <div class="fixed inset-0 z-[80] overflow-auto bg-[rgba(8,13,20,0.94)] px-3 py-3 backdrop-blur-[4px]">
        <div class="mx-auto flex min-h-[calc(100vh-1.5rem)] w-[min(1900px,100%)] flex-col gap-3">
          <section class="rounded-[20px] border border-[rgba(88,116,154,0.26)] bg-[linear-gradient(180deg,rgba(21,30,43,0.98),rgba(16,22,33,0.96))] px-4 py-3.5 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-[19px] leading-none text-[#7ec6ff]">${svgIcon('room')}</span>
                  <div>
                    <h2 class="m-0 text-[19px] font-extrabold leading-[1.08]">向导开局</h2>
                    <p class="mt-1 max-w-[920px] text-[11.5px] leading-[1.5] text-[#c4d1e3]">一步一步创建房间：先填名字，再选模板，接着选本局参与的设备组和目标组，最后确认并开始。复杂规则留在模板和游戏功能页，这里只负责开局。</p>
                  </div>
                </div>
              </div>
              <div class="flex shrink-0 flex-nowrap items-center justify-end gap-2 overflow-x-auto pb-1">
                <button class="${footerBtnBase} border-[rgba(88,116,154,0.3)] bg-[rgba(24,33,47,0.96)] px-3 text-[#dce8f7]" type="button" data-action="load-controller">${svgIcon('refresh')}读取控制端</button>
                <button class="${footerBtnBase} border-[rgba(88,116,154,0.3)] bg-[rgba(24,33,47,0.96)] px-3 text-[#dce8f7]" type="button" data-action="wizard-close">${svgIcon('pause')}退出向导</button>
              </div>
            </div>
            <div class="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              ${steps.map((item, idx) => renderStepBadge(idx, item)).join('')}
            </div>
          </section>

          <section class="grid gap-3 xl:grid-cols-[minmax(0,1.62fr)_minmax(340px,380px)]">
            <div class="rounded-[20px] border border-[rgba(88,116,154,0.26)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <h3 class="m-0 text-[17px] font-extrabold leading-none">${escapeHtml(steps[step]?.label || '向导')}</h3>
                  <p class="mt-1.5 max-w-[860px] text-[12px] leading-[1.45] text-[#aabbd1]">${escapeHtml(steps[step]?.desc || '')}</p>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  ${makePill(`步骤 ${step + 1}/4`, true)}
                  ${makePill(`房间 ${escapeHtml(currentRoomStatusLabel())}`)}
                  ${makePill(`模板 ${escapeHtml(selectedTemplateName())}`)}
                </div>
              </div>

              <div class="mt-4 grid gap-3">
                <section class="${step === 0 ? '' : 'hidden'} grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                    <div class="text-[11px] font-bold text-[#c7d5eb]">房间名称</div>
                    <input class="mt-2 w-full rounded-[14px] border border-[rgba(88,116,154,0.28)] bg-[rgba(12,18,28,0.92)] px-3 py-2.5 text-[13px] font-semibold text-[#f5f8ff] outline-none transition placeholder:text-[#7184a1] focus:border-[rgba(103,174,254,0.5)]" type="text" data-role="wizard-room-name" value="${escapeHtml(room.name || '')}" placeholder="例如：多人寻宝混战-第一局">
                  </div>
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                    <div class="text-[11px] font-bold text-[#c7d5eb]">房间备注</div>
                    <textarea class="mt-2 min-h-[132px] w-full resize-y rounded-[14px] border border-[rgba(88,116,154,0.28)] bg-[rgba(12,18,28,0.92)] px-3 py-2.5 text-[12px] leading-[1.55] text-[#f5f8ff] outline-none transition placeholder:text-[#7184a1] focus:border-[rgba(103,174,254,0.5)]" data-role="wizard-room-notes" placeholder="记录本局说明、临时备注、NPC 提示等。">${escapeHtml(room.notes || '')}</textarea>
                  </div>
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3.5 xl:col-span-2">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div class="text-[11px] font-bold text-[#c7d5eb]">当前房间草稿</div>
                        <div class="mt-1 text-[12px] leading-[1.5] text-[#aabbd1]">这里会保存到本地草稿，方便中途返回修改，不会影响控制端。</div>
                      </div>
                      <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px" type="button" data-action="wizard-save-draft">${svgIcon('save')}保存草稿</button>
                    </div>
                  </div>
                </section>

                <section class="${step === 1 ? '' : 'hidden'} grid gap-3">
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-[11px] font-bold text-[#c7d5eb]">当前选中模板</div>
                        <div class="mt-1 text-[15px] font-extrabold leading-[1.1] text-white">${escapeHtml(template.name || '未选择模板')}</div>
                        <div class="mt-1.5 max-w-[860px] text-[12px] leading-[1.5] text-[#aabbd1]">${escapeHtml(template.note || '无备注')}</div>
                      </div>
                      <div class="flex flex-wrap justify-end gap-2">
                        ${makePill(selectedTemplateSelected ? '已选中' : '当前默认', true)}
                        ${makePill(selectedTemplateSelected ? '可直接开局' : '可点击切换')}
                      </div>
                    </div>
                  </div>
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div class="text-[11px] font-bold text-[#c7d5eb]">可选模板</div>
                        <div class="mt-1 text-[12px] leading-[1.5] text-[#aabbd1]">点击模板卡即可切换本局模板，右侧摘要会同步更新。</div>
                      </div>
                      ${makePill(`共 ${state.localState.templates.length || 0} 个模板`, true)}
                    </div>
                    <div class="mt-3 grid gap-2 lg:grid-cols-2">
                      ${renderTemplateCards() || '<div class="text-[#93a6c2]">暂无模板。</div>'}
                    </div>
                    <div class="mt-3 rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.5] text-[#99acc5]">
                      选中后会直接作为这次房间的默认模板，后续还能在“游戏模板”里继续编辑和新增。
                    </div>
                  </div>
                </section>

                <section class="${step === 2 ? '' : 'hidden'} grid gap-3 xl:grid-cols-2">
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                    <div class="flex items-center justify-between gap-2">
                      <div>
                        <div class="text-[11px] font-bold text-[#c7d5eb]">源组</div>
                        <div class="mt-1 text-[12px] leading-[1.5] text-[#aabbd1]">负责发起感应的一方。</div>
                      </div>
                      ${makePill(`已选 ${room.source_group_ids?.length || 0}`, true)}
                    </div>
                    <div class="mt-3 grid gap-2">
                      ${groups.length ? groups.map((group) => renderGroupPick(group, 'source')).join('') : '<div class="rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.5] text-[#93a6c2]">暂无分组可选。</div>'}
                    </div>
                  </div>
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                    <div class="flex items-center justify-between gap-2">
                      <div>
                        <div class="text-[11px] font-bold text-[#c7d5eb]">目标组</div>
                        <div class="mt-1 text-[12px] leading-[1.5] text-[#aabbd1]">负责接收反馈的一方。</div>
                      </div>
                      ${makePill(`已选 ${room.target_group_ids?.length || 0}`, true)}
                    </div>
                    <div class="mt-3 grid gap-2">
                      ${groups.length ? groups.map((group) => renderGroupPick(group, 'target')).join('') : '<div class="rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.5] text-[#93a6c2]">暂无分组可选。</div>'}
                    </div>
                  </div>
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.5] text-[#b7c7db] xl:col-span-2">
                    源组负责发起感应，目标组负责被感应反馈。这里仅绑定本局参与范围，不改底层感应规则。
                  </div>
                </section>

                <section class="${step === 3 ? '' : 'hidden'} grid gap-3 xl:grid-cols-2">
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                    <div class="text-[11px] font-bold text-[#c7d5eb]">本局摘要</div>
                    <div class="mt-2 space-y-2 text-[12px] leading-[1.5] text-[#dbe5f6]">
                      <div>房间：<span class="font-bold text-white">${escapeHtml(room.name || '未命名房间')}</span></div>
                      <div>模板：<span class="font-bold text-white">${escapeHtml(template.name || '未选择模板')}</span></div>
                      <div>源组：<span class="font-bold text-white">${escapeHtml(summaryGroups(room.source_group_ids || []))}</span></div>
                      <div>目标组：<span class="font-bold text-white">${escapeHtml(summaryGroups(room.target_group_ids || []))}</span></div>
                      <div>备注：<span class="font-bold text-white">${escapeHtml(room.notes || '无')}</span></div>
                    </div>
                  </div>
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                    <div class="text-[11px] font-bold text-[#c7d5eb]">开始前检查</div>
                    <div class="mt-2 space-y-2 text-[12px] leading-[1.5] text-[#dbe5f6]">
                      <div>房间名称：${roomNameMissing ? '<span class="font-bold text-[#f5c95f]">未填写</span>' : '<span class="font-bold text-[#68d792]">已填写</span>'}</div>
                      <div>模板：<span class="font-bold text-white">${escapeHtml(template.name || '未选择')}</span></div>
                      <div>设备数量：<span class="font-bold text-white">${controllerDevices().length} 台</span></div>
                      <div>分组数量：<span class="font-bold text-white">${groups.length} 个</span></div>
                    </div>
                    <div class="mt-3 rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.5] text-[#99acc5]">
                      点击“开始游戏”后会把当前草稿切成运行中，并保留到本地房间历史里。
                    </div>
                  </div>
                </section>
              </div>

              <div class="mt-4 flex flex-nowrap items-center justify-between gap-2 overflow-x-auto border-t border-[rgba(88,116,154,0.16)] pt-3">
                <div class="flex flex-nowrap gap-2">
                  <button class="${footerBtnBase} border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] text-[#dbe5f4] ${step === 0 ? 'opacity-40 pointer-events-none' : ''}" type="button" data-action="wizard-prev">${footerBtnLabel('refresh', '上一步')}</button>
                  <button class="${footerBtnBase} border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] text-[#dbe5f4]" type="button" data-action="wizard-save-draft">${footerBtnLabel('save', '保存草稿')}</button>
                </div>
                <div class="flex flex-nowrap gap-2">
                  ${step < 3 ? `<button class="${footerBtnPrimary} bg-gradient-to-b from-[#4caeff] to-[#428fe0]" type="button" data-action="wizard-next">${footerBtnLabel('arrow', '下一步')}</button>` : ''}
                  <button class="${footerBtnPrimary} bg-gradient-to-b from-[#62d89a] to-[#48bb7c] ${canStart ? '' : 'opacity-45 pointer-events-none'}" type="button" data-action="wizard-start" ${canStart ? '' : 'disabled'}>${footerBtnLabel('play', '开始游戏')}</button>
                </div>
              </div>
            </div>

            <aside class="flex flex-col gap-3 rounded-[20px] border border-[rgba(88,116,154,0.26)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="m-0 text-[17px] font-extrabold leading-none">向导摘要</h3>
                  <p class="mt-1.5 text-[12px] leading-[1.45] text-[#aabbd1]">这里展示当前选择，方便 NPC 快速确认本局配置。</p>
                </div>
                ${makePill(`步骤 ${step + 1}/4`, true)}
              </div>
              <div class="grid gap-2.5">
                <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
                  <div class="text-[11px] font-bold text-[#c7d5eb]">房间名称</div>
                  <div class="mt-1 text-[13px] font-extrabold text-white">${escapeHtml(room.name || '未命名房间')}</div>
                </div>
                <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
                  <div class="text-[11px] font-bold text-[#c7d5eb]">模板</div>
                  <div class="mt-1 text-[13px] font-extrabold text-white">${escapeHtml(template.name || '未选择模板')}</div>
                </div>
                <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
                  <div class="text-[11px] font-bold text-[#c7d5eb]">源组</div>
                  <div class="mt-1 text-[12px] leading-[1.5] text-white">${escapeHtml(summaryGroups(room.source_group_ids || []))}</div>
                </div>
                <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
                  <div class="text-[11px] font-bold text-[#c7d5eb]">目标组</div>
                  <div class="mt-1 text-[12px] leading-[1.5] text-white">${escapeHtml(summaryGroups(room.target_group_ids || []))}</div>
                </div>
                <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
                  <div class="text-[11px] font-bold text-[#c7d5eb]">状态</div>
                  <div class="mt-1 text-[12px] leading-[1.5] text-white">${escapeHtml(currentRoomStatusLabel())}</div>
                </div>
                <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
                  <div class="text-[11px] font-bold text-[#c7d5eb]">说明</div>
                  <div class="mt-1 text-[11px] leading-[1.6] text-[#aabbd1]">向导只负责开局，不会把复杂规则重新堆一遍。模板和游戏功能页仍然是高级编辑入口。</div>
                </div>
              </div>
            </aside>
          </section>
        </div>
      </div>
    `;
  }  function renderApp() {
    if (wizardState().open) return renderWizardPage();
    const loadHint = state.controllerOnline
      ? `页面当前已联机，可以继续扫描和点名。`
      : `先连接到控制端所在网络，再点“从控制端读取”。如果暂时连不上，也可以继续离线编辑。`;
    const tagText = `UI v0.8.3`;
    return `
      <div id="mw-app" class="mx-auto my-3 w-[min(1860px,calc(100vw-40px))] text-[12px] leading-[1.4]">
        <section class="grid items-start gap-3 [grid-template-columns:minmax(0,0.88fr)_minmax(0,1.42fr)] max-[1680px]:grid-cols-1">
          <div class="min-w-0 pt-1">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <div class="text-[22px] leading-none drop-shadow-[0_0_10px_rgba(255,214,117,0.24)]">✦</div>
                <h1 class="m-0 text-[24px] font-extrabold leading-[1.08] tracking-[0]">Magic Wand 局域网配置页</h1>
              </div>
              <p class="max-w-[720px] text-[12px] leading-[1.45] text-[#c4d1e3]">为电脑灯效控制系统提供局域网配置、分组管理与效果预览（桌面端操作）。</p>
            </div>
            <div class="mt-2.5 flex flex-wrap gap-2">
              <span class="inline-flex h-8 items-center justify-center rounded-full border border-[rgba(103,130,169,0.42)] bg-[rgba(10,17,27,0.66)] px-3.5 text-[12px] font-medium text-[#dbe6f8]">${escapeHtml(tagText)}</span>
              <span class="inline-flex h-8 items-center justify-center rounded-full border border-[rgba(103,130,169,0.42)] bg-[rgba(10,17,27,0.66)] px-3.5 text-[12px] font-medium text-[#dbe6f8]">本地保存已启用</span>
              <span class="inline-flex h-8 items-center justify-center rounded-full border border-[rgba(103,130,169,0.42)] bg-[rgba(10,17,27,0.66)] px-3.5 text-[12px] font-medium text-[#dbe6f8]">${state.controllerOnline ? '在线可编辑' : '离线可编辑'}</span>
            </div>
          </div>
          ${renderTopActions()}
        </section>

        <section class="mt-3 rounded-[16px] border border-[rgba(88,116,154,0.34)] bg-[rgba(18,27,41,0.92)] px-3.5 py-2.5 text-[12px] text-[#eef4ff] shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">${escapeHtml(loadHint)}</section>

        ${renderTabs()}
      </div>
    `;
  }

  function render() {
    const root = document.getElementById('mw-app-root');
    if (!root) return;
    root.innerHTML = renderApp();
    bindMediaQueryFixes();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function bindMediaQueryFixes() {
    // no-op placeholder for future responsive tweaks
  }

  async function loadInitialState() {
    state.apiBase = await discoverApiBase();
    state.controllerBase = '/api/controller';
    try {
      const [status, local, records, controller, logText] = await Promise.allSettled([
        fetchStatus(),
        fetchLocalState(),
        fetchRecords(),
        fetchControllerState(),
        fetchServerLog()
      ]);

      if (status.status === 'fulfilled') {
        state.serverStatus = status.value;
      } else {
        state.serverStatus = { ok: false, error: status.reason?.message || 'status failed' };
      }

      state.localState = normalizeLocalState(local.status === 'fulfilled' ? local.value : loadLocalBackupOrDefault());
      state.roomRecords = normalizeRoomRecords(records.status === 'fulfilled' ? records.value?.records : loadRoomBackupOrDefault());
      state.controllerState = normalizeControllerState(controller.status === 'fulfilled' ? controller.value : null, state.controllerState || buildDefaultControllerState());
      state.controllerState = mergeDraftsIntoController(state.controllerState, state.localState);
      state.controllerOnline = controller.status === 'fulfilled';
      state.serverLogText = logText.status === 'fulfilled' ? logText.value : 'serve 日志暂时不可用。';
      state.activeTab = state.localState.ui.active_tab || 'overview';
      state.deviceFilterMode = state.localState.ui.device_filter_mode || 'ungrouped';
      state.deviceFilterGroupId = normalizeNumber(state.localState.ui.device_filter_group_id, -1);
      state.selectedTemplateId = state.localState.ui.selected_template_id || state.localState.templates[0]?.id || builtinTemplates[0].id;
      state.currentRoomId = state.localState.active_room_id || state.localState.current_room?.id || state.localState.rooms?.[0]?.id || '';
      syncActiveRoomAlias(roomById(state.currentRoomId) || state.localState.current_room || state.localState.rooms?.[0] || null);
      if (!state.controllerOnline && !state.controllerState) {
        state.controllerState = mergeDraftsIntoController(buildDefaultControllerState(), state.localState);
      }
      if (!state.roomRecords.length) {
        state.roomRecords = state.localState.room_history || [];
      }
      state.debugLines.unshift(`page init | ui=v0.8.3 launcher=${window.location.protocol !== 'file:'} controllerBase=${state.controllerBase}`);
      state.debugLines = state.debugLines.slice(0, MAX_VISIBLE_LOG_LINES);
      persistLocalCache();
      persistRecordsCache();
    } catch (err) {
      state.localState = normalizeLocalState(loadLocalBackupOrDefault());
      state.roomRecords = normalizeRoomRecords(loadRoomBackupOrDefault());
      state.controllerState = mergeDraftsIntoController(buildDefaultControllerState(), state.localState);
      state.controllerOnline = false;
      state.serverLogText = `初始化失败：${err.message}`;
      state.debugLines.unshift(`init failed | ${err.message}`);
      state.debugLines = state.debugLines.slice(0, MAX_VISIBLE_LOG_LINES);
    }
  }

  function normalizeRoomRecords(raw) {
    if (!raw) return [];
    const source = Array.isArray(raw) ? raw : Array.isArray(raw.records) ? raw.records : [];
    return source.map((item) => clone(item)).filter(Boolean);
  }

  function loadLocalBackupOrDefault() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.localState);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return buildDefaultLocalState();
  }

  function loadRoomBackupOrDefault() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.roomRecords);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return [];
  }

  async function refreshRecords() {
    try {
      setBusy('records', true);
      const response = await fetchRecords();
      state.roomRecords = normalizeRoomRecords(response);
      persistRecordsCache();
      render();
      logDebug('刷新房间记录成功');
    } catch (err) {
      logDebug(`刷新房间记录失败 | ${err.message}`);
    } finally {
      setBusy('records', false);
    }
  }

  async function copyDebugText() {
    const text = [
      `controllerOnline=${state.controllerOnline}`,
      `controllerBase=${state.controllerBase}`,
      `activeTab=${state.activeTab}`,
      `selectedTemplate=${selectedTemplateName()}`,
      ...state.debugLines.slice(0, 20),
      '',
      state.serverLogText ? state.serverLogText.split(/\r?\n/).slice(-20).join('\n') : ''
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      logDebug('调试文本已复制');
    } catch (err) {
      alert('复制失败，浏览器可能禁止了剪贴板权限。');
    }
  }

  function handleClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const mac = target.dataset.mac;
    const idx = normalizeNumber(target.dataset.idx, -1);
    const gid = normalizeNumber(target.dataset.gid, -1);
    const tab = target.dataset.tab;
    const templateId = target.dataset.templateId;
    const effectId = target.dataset.effectId;
    const roomId = target.dataset.roomId;

    switch (action) {
      case 'tab':
        selectTab(tab);
        break;
      case 'open-debug':
        selectTab('debug');
        break;
      case 'open-groups':
        selectTab('groups');
        break;
      case 'open-templates':
        selectTab('templates');
        break;
      case 'open-wizard':
        openWizard(state.selectedTemplateId || activeTemplate()?.id || builtinTemplates[0].id, { forceNew: true });
        break;
      case 'load-controller':
        loadFromController();
        break;
      case 'publish':
        publishConfig();
        break;
      case 'scan-devices':
        scanDevices();
        break;
      case 'identify-all':
        identifyAllDevices();
        break;
      case 'identify-selected':
        identifySelectedDevices();
        break;
      case 'restore-draft':
        restoreDraft();
        break;
      case 'save-local':
        saveLocalConfig();
        break;
      case 'load-serve-log':
        reloadServerLog();
        break;
      case 'clear-serve-log':
        clearServerLog();
        break;
      case 'copy-debug':
        copyDebugText();
        break;
      case 'clear-debug':
        state.debugLines = [];
        render();
        break;
      case 'edit-device-name':
        beginEditDevice(mac);
        break;
      case 'cancel-device-name':
        cancelEditDevice();
        break;
      case 'save-device-name':
        saveDeviceName(mac);
        break;
      case 'save-device-row':
        saveDeviceRow(mac);
        break;
      case 'identify-device':
        identifyDevice(idx);
        break;
      case 'toggle-device-select': {
        const input = event.target;
        toggleDeviceSelect(mac, input.checked);
        break;
      }
      case 'select-all-visible': {
        const input = event.target;
        toggleSelectAllVisible(input.checked);
        break;
      }
      case 'clear-selection':
        state.selectedDeviceIds.clear();
        render();
        break;
      case 'clear-selected-groups':
        clearSelectedGroups();
        break;
      case 'toggle-device-group': {
        const input = event.target;
        toggleGroupMembership(mac, gid, input.checked);
        break;
      }
      case 'device-filter-mode-all':
        state.deviceFilterMode = 'all';
        state.localState.ui.device_filter_mode = 'all';
        persistStateToServer();
        render();
        break;
      case 'device-filter-mode-ungrouped':
        state.deviceFilterMode = 'ungrouped';
        state.localState.ui.device_filter_mode = 'ungrouped';
        persistStateToServer();
        render();
        break;
      case 'device-filter-mode-group':
        state.deviceFilterMode = 'group';
        state.localState.ui.device_filter_mode = 'group';
        persistStateToServer();
        render();
        break;
      case 'select-group':
        state.activeTab = 'groups';
        render();
        break;
      case 'device-filter-group':
        state.deviceFilterGroupId = normalizeNumber(target.value, -1);
        state.localState.ui.device_filter_group_id = state.deviceFilterGroupId;
        persistStateToServer();
        render();
        break;
      case 'create-template':
        createTemplateFromCurrent();
        break;
      case 'clone-template':
        cloneTemplate(state.selectedTemplateId || activeTemplate()?.id);
        break;
      case 'load-template':
        loadTemplateIntoCurrent(state.selectedTemplateId || activeTemplate()?.id);
        break;
      case 'delete-template':
        deleteTemplate(state.selectedTemplateId || activeTemplate()?.id);
        break;
      case 'create-room':
        createRoomFromTemplate();
        break;
      case 'start-room':
        if (roomId) setActiveRoom(roomId);
        startRoom();
        break;
      case 'end-room':
        if (roomId) setActiveRoom(roomId);
        endRoom();
        break;
      case 'select-room':
        if (roomId) {
          setActiveRoom(roomId);
          state.currentRoomId = roomId;
          render();
        }
        break;
      case 'room-open-wizard':
        if (roomId) {
          const room = roomById(roomId);
          if (room) {
            if (room.status === 'running') {
              alert('进行中的房间不能直接编辑，请先结束后再修改。');
              break;
            }
            setActiveRoom(room);
            state.selectedTemplateId = room.template_id || state.selectedTemplateId;
            state.localState.ui.selected_template_id = state.selectedTemplateId;
          }
        }
        openWizard(roomById(roomId)?.template_id || state.selectedTemplateId || activeTemplate()?.id || builtinTemplates[0].id);
        break;
      case 'refresh-records':
        refreshRecords();
        break;
      case 'select-template':
        if (wizardState().open) {
          setWizardTemplate(templateId);
        } else {
          selectTemplate(templateId);
        }
        break;
      case 'select-effect':
        state.selectedEffectId = effectId;
        render();
        break;
      case 'wizard-close':
        closeWizard();
        break;
      case 'wizard-next':
        wizardNext();
        break;
      case 'wizard-prev':
        wizardPrev();
        break;
      case 'wizard-save-draft':
        saveWizardDraft();
        break;
      case 'wizard-start':
        startWizardRoom();
        break;
      case 'wizard-toggle-source-group':
      case 'wizard-toggle-target-group': {
        const input = event.target;
        toggleWizardGroup(action === 'wizard-toggle-target-group' ? 'target' : 'source', gid, input.checked);
        break;
      }
      default:
        break;
    }
  }

  function handleInput(event) {
    const target = event.target;
    if (target.matches('[data-role="device-name-input"]')) {
      state.editingDraft = target.value;
      return;
    }
    if (target.matches('[data-role="wizard-room-name"]')) {
      const room = ensureRoomDraft();
      room.name = target.value;
      room.updated_at = nowIso();
      persistLocalCache();
      return;
    }
    if (target.matches('[data-role="wizard-room-notes"]')) {
      const room = ensureRoomDraft();
      room.notes = target.value;
      room.updated_at = nowIso();
      persistLocalCache();
    }
  }

  function handleChange(event) {
    const target = event.target;
    if (target.matches('[data-action="device-filter-group"]')) {
      state.deviceFilterMode = 'group';
      state.deviceFilterGroupId = normalizeNumber(target.value, -1);
      state.localState.ui.device_filter_mode = 'group';
      state.localState.ui.device_filter_group_id = state.deviceFilterGroupId;
      persistStateToServer();
      render();
      return;
    }
  }

  function setupBody() {
    document.body.innerHTML = '<div id="mw-app-root"></div>';
    const root = document.getElementById('mw-app-root');
    root.addEventListener('click', handleClick);
    root.addEventListener('change', handleChange);
    root.addEventListener('input', handleInput);
  }

  function installKeyboardShortcuts() {
    window.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveLocalConfig();
      }
      if (event.key === 'Escape' && state.editingMac) {
        cancelEditDevice();
      }
    });
  }

  async function init() {
    document.title = 'Magic Wand 局域网配置页';
    setupBody();
    installKeyboardShortcuts();
    state.localState = normalizeLocalState(loadLocalBackupOrDefault());
    state.roomRecords = normalizeRoomRecords(loadRoomBackupOrDefault());
    state.controllerState = mergeDraftsIntoController(buildDefaultControllerState(), state.localState);
    state.selectedTemplateId = state.localState.ui.selected_template_id || builtinTemplates[0].id;
    state.activeTab = state.localState.ui.active_tab || 'overview';
    state.deviceFilterMode = state.localState.ui.device_filter_mode || 'ungrouped';
    state.deviceFilterGroupId = normalizeNumber(state.localState.ui.device_filter_group_id, -1);
    render();
    await loadInitialState();
    render();
    setInterval(() => {
      if (!state.previewPlaying) return;
      state.previewTick++;
      if (state.activeTab === 'preview') render();
    }, 900);
  }

  window.__mwRebuild = {
    state,
    render,
    loadFromController,
    publishConfig,
    saveLocalConfig,
    restoreDraft,
    createTemplateFromCurrent,
    startRoom,
    endRoom
  };

  init().catch((err) => {
    console.error(err);
      document.body.innerHTML = `<pre style="color:#fff;background:#111;padding:20px">初始化失败：${escapeHtml(err.message)}</pre>`;
  });
})();



