(() => {
  const APP_RELEASE_VERSION = 'v1.0.4';
  const LOCAL_SERVICE_VERSION = '1.0.4';
  const CONTROLLER_FIRMWARE_VERSION = '2026.06.06.1500';
  const RECEIVER_FIRMWARE_VERSION = '2026.06.06.1215';
  const MAX_VISIBLE_LOG_LINES = 120;
  const MAX_MCU_GROUPS = 16;
  const DEFAULT_TRIGGER_RSSI = -25;
  const OLD_DEFAULT_TRIGGER_RSSI = -10;
  const DEFAULT_TRIGGER_HOLD_MS = 2000;
  const RSSI_DEFAULTS_VERSION = 2;
  const LOCAL_SCHEMA_VERSION = 3;
  const DEVICE_ONLINE_MS = 5 * 60 * 1000;
  const DEVICE_SCAN_RETAIN_MS = 24 * 60 * 60 * 1000;
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
    editingDraftName: '',
    editingDraftNote: '',
    editingGroupId: -1,
    editingGroupName: '',
    editingGroupNote: '',
    editingGroupValid: true,
    groupFormModal: null,
    groupDeleteModal: null,
    playPresetFormModal: null,
    playPresetDeleteModal: null,
    effectFormModal: null,
    effectDeleteModal: null,
    templateFormModal: null,
    selectedTemplateId: '',
    selectedPlayPresetId: '',
    currentRoomId: '',
    selectedEffectId: '',
    effectPreviewTemplateId: '',
    previewPlaying: true,
    previewTick: 0,
    roomEffectPreviewId: '',
    roomEffectPreviewKey: '',
    roomPrepareModal: null,
    roomFinalizeModal: null,
    preparingRoomId: '',
    roomStartCountdown: null,
    roomCountdownTimer: null,
    wizardRoomDraft: null,
    roomPresentationMode: false,
    signalTest: {
      running: false,
      sourceMac: '',
      targetMac: '',
      port: 1,
      ledCount: 10,
      weakRssi: -90,
      strongRssi: -35,
      compressionX100: 160,
      smoothSamples: 5,
      roomHash: 65001
    },
    busy: {
      status: false,
      controller: false,
      local: false,
      records: false,
      log: false,
      scan: false,
      identify: false,
      publish: false,
      testEffect: false,
      stopEffect: false,
      signalTest: false,
      save: false,
      restore: false
    }
  };

  const builtinEffectCatalog = [
    { id: 'builtin-selftest', name: '自检', note: '点名式状态汇报，适合 NPC 人工检查设备响应。', mode: 'selftest', kind: 'effect', colorA: '#FFD24D', colorB: '#34B3FF', colorC: '#61E09A' },
    { id: 'builtin-silent', name: '静默', note: '不发光，只保留状态。', mode: 'silent', kind: 'effect', colorA: '#7487a7', colorB: '#7487a7', colorC: '#7487a7' },
    { id: 'builtin-solid', name: '常亮', note: '固定颜色常亮。', mode: 'solid', kind: 'effect', colorA: '#FFD24D', colorB: '#34B3FF', colorC: '#61E09A' },
    { id: 'builtin-gradient', name: '渐变常亮', note: '颜色平滑渐变，不发生熄灭。', mode: 'gradient', kind: 'effect', colorA: '#FFD24D', colorB: '#34B3FF', colorC: '#FFD24D' },
    { id: 'builtin-breath', name: '呼吸', note: '亮度起伏，适合常驻提示。', mode: 'breath', kind: 'effect', colorA: '#FFD24D', colorB: '#34B3FF', colorC: '#61E09A' },
    { id: 'builtin-blink', name: '闪烁', note: '按周期亮灭。', mode: 'blink', kind: 'effect', colorA: '#FFD24D', colorB: '#34B3FF', colorC: '#FFFFFF' },
    { id: 'builtin-cycle', name: '多色循环', note: '三色轮换。', mode: 'cycle', kind: 'effect', colorA: '#FFD24D', colorB: '#34B3FF', colorC: '#61E09A' },
    { id: 'builtin-chase', name: '跑马灯', note: '单灯位移动。', mode: 'chase', kind: 'effect', colorA: '#FFD24D', colorB: '#34B3FF', colorC: '#61E09A' },
    { id: 'builtin-pulse', name: '脉冲跑马', note: '渐变、起止速度、结束停留。', mode: 'pulse_chase', kind: 'effect', colorA: '#FFD24D', colorB: '#FFFBF0', colorC: '#FFFFFF' }
  ];
  const builtinEffects = builtinEffectCatalog.filter((effect) => effect.kind !== 'utility');
  const MCU_EFFECT_TEXT_LIMIT = 360;

  const builtinTemplates = [
    {
      id: 'tpl-treasure-duo',
      name: '多人寻宝混战',
      note: '一组魔杖寻找一组宝箱，支持并行开局和本地历史记录。',
      builtIn: true,
      feature_preset_id: 'fp-treasure',
      effect_preset_id: 'builtin-breath',
      source_group_mode: 'multi',
      target_group_mode: 'single',
      sense_mode: 'ring',
      idle_effect_id: 'builtin-breath',
      trigger_effect_id: 'builtin-pulse',
      scoring: { mode: 'count_find', max_find: 0 }
    },
    {
      id: 'tpl-solo',
      name: '魔杖寻宝-单人轮巡',
      note: '每支魔杖独立记录目标，适合一个人带多个组。',
      builtIn: true,
      feature_preset_id: 'fp-treasure',
      effect_preset_id: 'builtin-blink',
      source_group_mode: 'single',
      target_group_mode: 'single',
      sense_mode: 'ring',
      idle_effect_id: 'builtin-breath',
      trigger_effect_id: 'builtin-blink',
      scoring: { mode: 'count_find', max_find: 1 }
    },
    {
      id: 'tpl-team',
      name: '魔杖寻宝-双人组共享',
      note: '同组共享找到记录，适合双人协作。',
      builtIn: true,
      feature_preset_id: 'fp-treasure',
      effect_preset_id: 'builtin-chase',
      source_group_mode: 'multi',
      target_group_mode: 'single',
      sense_mode: 'shared',
      idle_effect_id: 'builtin-solid',
      trigger_effect_id: 'builtin-chase',
      scoring: { mode: 'shared_count', max_find: 0 }
    },
    {
      id: 'tpl-rssi',
      name: '距离提示测试',
      note: '只看 RSSI 强弱变化，用于阈值和映射测试。',
      builtIn: true,
      feature_preset_id: 'fp-rssi',
      effect_preset_id: 'builtin-blink',
      source_group_mode: 'single',
      target_group_mode: 'single',
      sense_mode: 'response',
      idle_effect_id: 'builtin-breath',
      trigger_effect_id: 'builtin-blink',
      scoring: { mode: 'rssi_probe', max_find: 0 }
    },
    {
      id: 'tpl-effect',
      name: '灯效演示',
      note: '展示常亮、呼吸、闪烁、跑马灯与脉冲跑马。',
      builtIn: true,
      feature_preset_id: 'fp-rssi',
      effect_preset_id: 'builtin-cycle',
      source_group_mode: 'multi',
      target_group_mode: 'multi',
      sense_mode: 'response',
      idle_effect_id: 'builtin-silent',
      trigger_effect_id: 'builtin-cycle',
      scoring: { mode: 'demo', max_find: 0 }
    }
  ];

  const groupPalette = ['blue', 'green', 'yellow', 'purple'];
  const EFFECT_TRACK_LIMIT = 3;
  const EFFECT_TEMPLATE_LIMIT = 9999;
  const PREVIEW_FRAME_MS = 80;
  const WIZARD_STEP_MAX = 6;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function releaseInfo() {
    return state.serverStatus?.release && typeof state.serverStatus.release === 'object' ? state.serverStatus.release : null;
  }

  function appReleaseVersion() {
    return String(releaseInfo()?.release_version || APP_RELEASE_VERSION);
  }

  function expectedFirmwareVersion(role) {
    const releaseFirmware = releaseInfo()?.firmware || {};
    const fallback = role === 'controller' ? CONTROLLER_FIRMWARE_VERSION : RECEIVER_FIRMWARE_VERSION;
    return String(releaseFirmware?.[role]?.version || fallback);
  }

  function deviceFirmwareLabel(device) {
    const release = String(device?.release_version || '').trim();
    const firmware = String(device?.firmware_version || device?.fw_version || '').trim();
    const expectedRelease = appReleaseVersion();
    const expectedFirmware = expectedFirmwareVersion('receiver');
    if (!release && !firmware) return { text: '固件未知，重新扫描后仍未知请重烧接收端', tone: 'warn' };
    if (firmware && firmware !== expectedFirmware) return { text: `接收端 ${firmware}，应为 ${expectedFirmware}`, tone: 'bad' };
    if (release && release !== expectedRelease) return { text: `发布 ${release}，应为 ${expectedRelease}`, tone: 'bad' };
    return { text: `接收端 ${firmware || '未知'} · ${release || expectedRelease}`, tone: 'ok' };
  }

  function normalizeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function triggerCompareValue(value) {
    return String(value || '').trim() === 'lte' ? 'lte' : 'gte';
  }

  function triggerCompareLabel(value) {
    return triggerCompareValue(value) === 'lte' ? '小于等于' : '大于等于';
  }

  function triggerConditionText(compare, rssi, hold) {
    return `${triggerCompareLabel(compare)} ${normalizeNumber(rssi, DEFAULT_TRIGGER_RSSI)} dBm / ${normalizeNumber(hold, DEFAULT_TRIGGER_HOLD_MS)} ms`;
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

  function formatClockTime(ms) {
    const value = Math.max(0, normalizeNumber(ms, 0));
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '未记录';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}点${pad(date.getMinutes())}分${pad(date.getSeconds())}秒`;
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

  function effectModeLabel(mode) {
    const value = String(mode || '').trim();
    if (value === 'silent') return '静默';
    if (value === 'solid') return '常亮';
    if (value === 'gradient') return '渐变常亮';
    if (value === 'breath') return '呼吸';
    if (value === 'blink') return '闪烁';
    if (value === 'cycle') return '多色循环';
    if (value === 'chase') return '跑马灯';
    if (value === 'pulse' || value === 'pulse_chase') return '脉冲跑马';
    if (value === 'selftest') return '自检';
    return value || '未设置';
  }

  function roleModeValue(mode, fallback = 'single') {
    const value = String(mode || '').trim().toLowerCase();
    if (['multi', 'multiple', 'many', 'group', 'groups'].includes(value)) return 'multi';
    if (['single', 'one', 'solo'].includes(value)) return 'single';
    return fallback === 'multi' ? 'multi' : 'single';
  }

  function roleModeLabel(mode) {
    return roleModeValue(mode) === 'multi' ? '多个' : '单个';
  }

  function effectTemplateIdForMode(mode) {
    const value = String(mode || '').trim();
    if (value === 'silent') return 'builtin-silent';
    if (value === 'solid') return 'builtin-solid';
    if (value === 'gradient') return 'builtin-gradient';
    if (value === 'breath') return 'builtin-breath';
    if (value === 'blink') return 'builtin-blink';
    if (value === 'cycle') return 'builtin-cycle';
    if (value === 'chase') return 'builtin-chase';
    if (value === 'pulse' || value === 'pulse_chase') return 'builtin-pulse';
    if (value === 'selftest') return 'builtin-selftest';
    return 'builtin-breath';
  }

  function effectModeOptionsHtml(selectedMode = 'solid') {
    const options = ['silent', 'solid', 'gradient', 'breath', 'blink', 'cycle', 'chase', 'pulse_chase', 'selftest'];
    return options.map((mode) => `<option value="${escapeHtml(mode)}" ${String(selectedMode || 'solid') === mode ? 'selected' : ''}>${escapeHtml(effectModeLabel(mode))}</option>`).join('');
  }

  function effectTrackPalette(index = 0) {
    const palettes = [
      ['#FFD24D', '#34B3FF', '#61E09A'],
      ['#FF8CC3', '#8A7CFF', '#41C7FF'],
      ['#F7A24A', '#F5E16A', '#74E5B0']
    ];
    return palettes[index % palettes.length].slice();
  }

  function buildDefaultEffectTrack(mode = 'solid', index = 0, overrides = {}) {
    const colors = Array.isArray(overrides.colors) && overrides.colors.length
      ? overrides.colors.slice(0, 3)
      : effectTrackPalette(index);
    const trackMode = String(overrides.mode || mode || 'solid');
    const templateId = String(overrides.template_id || effectTemplateIdForMode(trackMode));
    const ledCount = clamp(normalizeNumber(overrides.led_count, 35), 1, 9999);
    const ledStart = clamp(normalizeNumber(overrides.led_start, 1), 1, ledCount);
    const ledEnd = clamp(normalizeNumber(overrides.led_end, ledCount), ledStart, ledCount);
    return {
      id: String(overrides.id || uid('trk')),
      enabled: overrides.enabled !== undefined ? !!overrides.enabled : true,
      port: clamp(normalizeNumber(overrides.port, index + 1), 1, 3),
      template_id: templateId,
      mode: trackMode,
      led_count: ledCount,
      led_start: ledStart,
      led_end: ledEnd,
      gap: Math.max(0, normalizeNumber(overrides.gap, 0)),
      brightness: clamp(normalizeNumber(overrides.brightness, trackMode === 'silent' ? 0 : trackMode === 'selftest' ? 90 : 80), 0, 100),
      colors,
      repeat: Math.max(0, normalizeNumber(overrides.repeat, trackMode === 'pulse_chase' ? 15 : 0)),
      frequency_hz: Math.max(0, normalizeNumber(overrides.frequency_hz, trackMode === 'breath' ? 0.3 : 0)),
      period_ms: Math.max(0, normalizeNumber(overrides.period_ms, trackMode === 'cycle' ? 420 : trackMode === 'gradient' ? 1800 : trackMode === 'selftest' ? 1200 : 700)),
      duty: clamp(normalizeNumber(overrides.duty, 50), 0, 100),
      accel: Math.max(0, normalizeNumber(overrides.accel, 0)),
      pulse_speed_start: clamp(normalizeNumber(overrides.pulse_speed_start, trackMode === 'pulse_chase' ? 0 : 0), 0, 100),
      pulse_speed_end: clamp(normalizeNumber(overrides.pulse_speed_end, trackMode === 'pulse_chase' ? 100 : 100), 0, 100),
      pulse_duration_ms: Math.max(0, normalizeNumber(overrides.pulse_duration_ms, 0)),
      end_hold_ms: Math.max(0, normalizeNumber(overrides.end_hold_ms, 0)),
      end_behavior: String(overrides.end_behavior || 'off')
    };
  }

  function normalizeEffectTrack(raw, fallback = null, index = 0) {
    const base = fallback && typeof fallback === 'object'
      ? fallback
      : buildDefaultEffectTrack('solid', index);
    const source = raw && typeof raw === 'object' ? raw : {};
    const colors = Array.isArray(source.colors) && source.colors.length
      ? source.colors.slice(0, 3)
      : Array.isArray(base.colors) && base.colors.length
        ? base.colors.slice(0, 3)
        : effectTrackPalette(index);
    return buildDefaultEffectTrack(source.mode || base.mode || 'solid', index, {
      id: source.id || base.id || uid('trk'),
      enabled: source.enabled !== undefined ? !!source.enabled : base.enabled !== undefined ? !!base.enabled : true,
      port: source.port ?? base.port ?? (index + 1),
      template_id: source.template_id || source.base_template_id || base.template_id || effectTemplateIdForMode(source.mode || base.mode || 'solid'),
      led_count: source.led_count ?? base.led_count ?? 35,
      led_start: source.led_start ?? base.led_start ?? 1,
      led_end: source.led_end ?? base.led_end ?? (source.led_count ?? base.led_count ?? 35),
      gap: source.gap ?? base.gap ?? 0,
      brightness: source.brightness ?? base.brightness ?? 80,
      colors,
      repeat: source.repeat ?? base.repeat ?? 0,
      frequency_hz: source.frequency_hz ?? base.frequency_hz ?? 0,
      period_ms: source.period_ms ?? base.period_ms ?? 700,
      duty: source.duty ?? base.duty ?? 50,
      accel: source.accel ?? base.accel ?? 0,
      pulse_speed_start: source.pulse_speed_start ?? base.pulse_speed_start ?? 0,
      pulse_speed_end: source.pulse_speed_end ?? base.pulse_speed_end ?? Math.max(0, Math.min(100, normalizeNumber(source.accel ?? base.accel, 0) * 10 || 100)),
      pulse_duration_ms: source.pulse_duration_ms ?? base.pulse_duration_ms ?? 0,
      end_hold_ms: source.end_hold_ms ?? source.endHold ?? base.end_hold_ms ?? 0,
      end_behavior: source.end_behavior || base.end_behavior || 'off'
    });
  }

  function normalizeEffectUI(raw, fallback = null) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const base = fallback && typeof fallback === 'object' ? fallback : {};
    const legacyMode = String(source.mode || base.mode || 'solid');
    const legacyColors = Array.isArray(source.colors) && source.colors.length
      ? source.colors.slice(0, 3)
      : Array.isArray(base.colors) && base.colors.length
        ? base.colors.slice(0, 3)
        : effectTrackPalette(0);
    const sourceTracks = Array.isArray(source.tracks) ? source.tracks : [];
    const baseTracks = Array.isArray(base.tracks) ? base.tracks : [];
    const legacyPorts = Array.isArray(source.ports) ? source.ports : Array.isArray(base.ports) ? base.ports : [];
    const tracks = [];
    for (let i = 0; i < EFFECT_TRACK_LIMIT; i++) {
      const rawTrack = sourceTracks[i];
      const fallbackTrack = baseTracks[i] || buildDefaultEffectTrack(legacyMode, i, {
        enabled: legacyPorts[i] !== false && (i === 0 ? true : !!legacyPorts[i]),
        port: i + 1,
        template_id: effectTemplateIdForMode(legacyMode),
        mode: legacyMode,
        led_count: normalizeNumber(source.led_count ?? base.led_count, 35),
        led_start: normalizeNumber(source.led_start ?? base.led_start, 1),
        led_end: normalizeNumber(source.led_end ?? base.led_end, normalizeNumber(source.led_count ?? base.led_count, 35)),
        gap: normalizeNumber(source.gap ?? base.gap, 0),
        brightness: normalizeNumber(source.brightness ?? base.brightness, legacyMode === 'silent' ? 0 : 80),
        colors: legacyColors,
        repeat: normalizeNumber(source.count ?? base.count, 0),
        frequency_hz: normalizeNumber(source.frequency_hz ?? base.frequency_hz, legacyMode === 'breath' ? 0.3 : 0),
        period_ms: normalizeNumber(source.period_ms ?? source.period ?? base.period_ms ?? base.period, legacyMode === 'cycle' ? 420 : 700),
        duty: normalizeNumber(source.duty ?? base.duty, 50),
        accel: normalizeNumber(source.accel ?? base.accel, 0),
        pulse_speed_start: clamp(normalizeNumber(source.pulse_speed_start ?? base.pulse_speed_start, 0), 0, 100),
        pulse_speed_end: clamp(normalizeNumber(source.pulse_speed_end ?? base.pulse_speed_end, Math.max(0, Math.min(100, normalizeNumber(source.accel ?? base.accel, 0) * 10 || 100))), 0, 100),
        pulse_duration_ms: Math.max(0, normalizeNumber(source.pulse_duration_ms ?? base.pulse_duration_ms, 0)),
        end_hold_ms: normalizeNumber(source.end_hold_ms ?? source.endHold ?? base.end_hold_ms ?? base.endHold, 0),
        end_behavior: String(source.end_behavior || base.end_behavior || 'off')
      });
      tracks.push(normalizeEffectTrack(rawTrack || (legacyPorts.length ? { enabled: legacyPorts[i] !== false } : i === 0 ? {
        enabled: true,
        port: 1,
        template_id: effectTemplateIdForMode(legacyMode),
        mode: legacyMode,
        led_count: normalizeNumber(source.led_count ?? base.led_count, 35),
        led_start: normalizeNumber(source.led_start ?? base.led_start, 1),
        led_end: normalizeNumber(source.led_end ?? base.led_end, normalizeNumber(source.led_count ?? base.led_count, 35)),
        gap: normalizeNumber(source.gap ?? base.gap, 0),
        brightness: normalizeNumber(source.brightness ?? base.brightness, legacyMode === 'silent' ? 0 : 80),
        colors: legacyColors,
        repeat: normalizeNumber(source.count ?? base.count, 0),
        frequency_hz: normalizeNumber(source.frequency_hz ?? base.frequency_hz, legacyMode === 'breath' ? 0.3 : 0),
        period_ms: normalizeNumber(source.period_ms ?? source.period ?? base.period_ms ?? base.period, legacyMode === 'cycle' ? 420 : 700),
        duty: normalizeNumber(source.duty ?? base.duty, 50),
        accel: normalizeNumber(source.accel ?? base.accel, 0),
        pulse_speed_start: clamp(normalizeNumber(source.pulse_speed_start ?? base.pulse_speed_start, 0), 0, 100),
        pulse_speed_end: clamp(normalizeNumber(source.pulse_speed_end ?? base.pulse_speed_end, Math.max(0, Math.min(100, normalizeNumber(source.accel ?? base.accel, 0) * 10 || 100))), 0, 100),
        pulse_duration_ms: Math.max(0, normalizeNumber(source.pulse_duration_ms ?? base.pulse_duration_ms, 0)),
        end_hold_ms: normalizeNumber(source.end_hold_ms ?? source.endHold ?? base.end_hold_ms ?? base.endHold, 0),
        end_behavior: String(source.end_behavior || base.end_behavior || 'off')
      } : null), fallbackTrack, i));
    }
    const primary = tracks.find((track) => track.enabled !== false) || tracks[0] || buildDefaultEffectTrack(legacyMode, 0);
    return {
      schema: 2,
      mode: primary.mode || legacyMode || 'solid',
      ports: tracks.map((track) => track.enabled !== false),
      tracks,
      colors: Array.isArray(primary.colors) ? primary.colors.slice(0, 3) : legacyColors.slice(0, 3),
      brightness: normalizeNumber(primary.brightness, 80),
      speed: normalizeNumber(primary.frequency_hz, 0),
      period: normalizeNumber(primary.period_ms, 700),
      duty: normalizeNumber(primary.duty, 50),
      count: normalizeNumber(primary.repeat, 0),
      accel: primary.mode === 'pulse_chase'
        ? Math.round(clamp(normalizeNumber(primary.pulse_speed_end, 100), 0, 100) / 10)
        : normalizeNumber(primary.accel, 0),
      pulse_speed_start: clamp(normalizeNumber(primary.pulse_speed_start, 0), 0, 100),
      pulse_speed_end: clamp(normalizeNumber(primary.pulse_speed_end, 100), 0, 100),
      pulse_duration_ms: Math.max(0, normalizeNumber(primary.pulse_duration_ms, 0)),
      endHold: normalizeNumber(primary.end_hold_ms, 0),
      endColor: String(primary.colors?.[2] || '#FFFFFF')
    };
  }

  function buildEffectTemplateFromDefinition(def, index = 0) {
    const mode = String(def?.mode || 'solid');
    const tracks = [];
    tracks.push(buildDefaultEffectTrack(mode, index, {
      port: 1,
      led_count: mode === 'chase' ? 35 : 35,
      led_start: 1,
      led_end: 35,
      gap: mode === 'chase' ? 0 : 0,
      brightness: mode === 'silent' ? 0 : mode === 'blink' ? 100 : mode === 'breath' ? 60 : mode === 'selftest' ? 90 : 80,
      colors: [def?.colorA || '#FFD24D', def?.colorB || '#34B3FF', def?.colorC || '#61E09A'],
      repeat: mode === 'pulse_chase' ? 15 : 0,
      frequency_hz: mode === 'breath' ? 0.3 : 0,
      period_ms: mode === 'cycle' ? 420 : mode === 'blink' ? 700 : mode === 'chase' ? 420 : mode === 'gradient' ? 1800 : mode === 'selftest' ? 1200 : 700,
      duty: 50,
      accel: mode === 'pulse_chase' ? 10 : 0,
      pulse_speed_start: mode === 'pulse_chase' ? 0 : 0,
      pulse_speed_end: mode === 'pulse_chase' ? 100 : 100,
      pulse_duration_ms: 0,
      end_hold_ms: 0,
      end_behavior: 'off'
    }));
    while (tracks.length < EFFECT_TRACK_LIMIT) {
      tracks.push(buildDefaultEffectTrack('solid', tracks.length, { enabled: false, port: tracks.length + 1 }));
    }
    return {
      id: String(def?.id || uid('ep')),
      name: String(def?.name || '未命名灯效'),
      note: String(def?.note || ''),
      builtIn: true,
      effect_ui: normalizeEffectUI({
        schema: 2,
        mode,
        tracks
      }),
      created_at: '1970-01-01T00:00:00',
      updated_at: '1970-01-01T00:00:00'
    };
  }

  function buildDefaultEffectTemplates() {
    return builtinEffects.map((effect, index) => buildEffectTemplateFromDefinition(effect, index));
  }

  function buildDefaultCustomEffects() {
    return [];
  }

  function effectPrimaryTrack(effect) {
    const tracks = Array.isArray(effect?.effect_ui?.tracks) ? effect.effect_ui.tracks : [];
    return tracks.find((track) => track.enabled !== false) || tracks[0] || null;
  }

  function effectTrackEnabledCount(effect) {
    return Array.isArray(effect?.effect_ui?.tracks) ? effect.effect_ui.tracks.filter((track) => track && track.enabled !== false).length : 0;
  }

  function previewCellShape() {
    const value = String(state.localState?.ui?.preview_cell_shape || 'square');
    return value === 'circle' ? 'circle' : 'square';
  }

  function setPreviewCellShape(shape) {
    state.localState.ui.preview_cell_shape = String(shape) === 'circle' ? 'circle' : 'square';
    persistStateToServer();
    render();
  }

  function previewFrameMs() {
    return state.previewTick * PREVIEW_FRAME_MS;
  }

  function hexToRgb(hex) {
    const value = String(hex || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(value)) {
      const r = parseInt(value[0] + value[0], 16);
      const g = parseInt(value[1] + value[1], 16);
      const b = parseInt(value[2] + value[2], 16);
      return { r, g, b };
    }
    if (/^[0-9a-f]{6}$/i.test(value)) {
      const r = parseInt(value.slice(0, 2), 16);
      const g = parseInt(value.slice(2, 4), 16);
      const b = parseInt(value.slice(4, 6), 16);
      return { r, g, b };
    }
    return null;
  }

  function rgbaFromHex(hex, alpha = 1) {
    const rgb = hexToRgb(hex) || { r: 255, g: 255, b: 255 };
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  function mixHexColor(a, b, t = 0.5) {
    const rgbA = hexToRgb(a) || { r: 255, g: 255, b: 255 };
    const rgbB = hexToRgb(b) || rgbA;
    const ratio = clamp(normalizeNumber(t, 0.5), 0, 1);
    const mix = (start, end) => Math.round(start + ((end - start) * ratio));
    const toHex = (value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
    return `#${toHex(mix(rgbA.r, rgbB.r))}${toHex(mix(rgbA.g, rgbB.g))}${toHex(mix(rgbA.b, rgbB.b))}`;
  }

  function circularDistance(index, head, total) {
    if (total <= 0) return 0;
    const diff = Math.abs(index - head);
    return Math.min(diff, total - diff);
  }

  function pulseSpeedScale(speed) {
    const normalized = clamp(normalizeNumber(speed, 0), 0, 100) / 100;
    return 10 - (9 * Math.pow(normalized, 0.8));
  }

  function pulseChasePulsePlan(track, pulseCount, fallbackSpanMs) {
    const count = Math.max(1, Math.round(normalizeNumber(pulseCount, 1) || 1));
    const startSpeed = clamp(normalizeNumber(track?.pulse_speed_start ?? track?.accel, 0), 0, 100);
    const endSpeed = clamp(normalizeNumber(track?.pulse_speed_end ?? ((track?.accel ?? 0) * 10), 100), 0, 100);
    const totalDurationMs = Math.max(0, normalizeNumber(track?.pulse_duration_ms, 0));
    const weights = Array.from({ length: count }, (_, index) => {
      const t = count === 1 ? 1 : index / (count - 1);
      const speed = startSpeed + ((endSpeed - startSpeed) * t);
      return pulseSpeedScale(speed);
    });
    const totalWeight = weights.reduce((sum, item) => sum + item, 0) || 1;
    const baseSpan = Math.max(140, normalizeNumber(fallbackSpanMs, 700));
    const spans = weights.map((weight) => {
      if (totalDurationMs > 0) return (totalDurationMs * weight) / totalWeight;
      return baseSpan * weight;
    });
    const totalSpan = spans.reduce((sum, item) => sum + item, 0);
    return {
      count,
      spans,
      totalSpan,
      startSpeed,
      endSpeed,
      totalDurationMs
    };
  }

  function previewScaleMarks(total) {
    const count = clamp(normalizeNumber(total, 0), 1, 9999);
    const marks = new Set([1, count]);
    for (let mark = 10; mark < count; mark += 10) marks.add(mark);
    return Array.from(marks)
      .sort((a, b) => a - b)
      .map((mark) => `<span class="inline-flex min-w-[22px] justify-center">${escapeHtml(mark)}</span>`)
      .join('');
  }

  function previewCellStyle(track, cellIndex, activeIndex, tickMs, paletteIndex = 0) {
    const mode = String(track?.mode || 'solid');
    const ledCount = clamp(normalizeNumber(track?.led_count, 35), 1, 9999);
    const start = clamp(normalizeNumber(track?.led_start, 1), 1, ledCount);
    const end = clamp(normalizeNumber(track?.led_end, ledCount), start, ledCount);
    const gap = Math.max(0, normalizeNumber(track?.gap, 0));
    const step = gap + 1;
    const included = cellIndex >= start && cellIndex <= end && ((cellIndex - start) % step === 0);
    const palette = Array.isArray(track?.colors) && track.colors.length ? track.colors.slice(0, 3) : effectTrackPalette(paletteIndex);
    const brightness = clamp(normalizeNumber(track?.brightness, 80), 0, 100) / 100;
    const periodMs = Math.max(120, normalizeNumber(track?.period_ms, 700));
    const duty = clamp(normalizeNumber(track?.duty, 50), 0, 100) / 100;
    const freq = Math.max(0, normalizeNumber(track?.frequency_hz, 0));
    const repeat = Math.max(0, normalizeNumber(track?.repeat, 0));
    const endHoldMs = Math.max(0, normalizeNumber(track?.end_hold_ms, 0));

    let color = rgbaFromHex('#2B3950', 0.9);
    let opacity = included ? 0.16 : 0.08;
    let shadow = 'none';

    if (!track || track.enabled === false) {
      return { color, opacity: 0.06, shadow: 'none' };
    }

    const paletteColor = palette[(Math.max(0, activeIndex) + paletteIndex) % palette.length] || palette[0];
    const baseAlpha = Math.max(0.08, Math.min(1, brightness));

    if (!included) {
      color = rgbaFromHex('#263248', 0.92);
      opacity = 0.08;
      return { color, opacity, shadow: 'none' };
    }

    if (mode === 'silent') {
      color = rgbaFromHex('#253145', 0.92);
      opacity = 0.04;
      return { color, opacity, shadow: 'none' };
    }

    if (mode === 'solid') {
      color = rgbaFromHex(paletteColor, 0.95);
      opacity = 0.9 * baseAlpha;
      shadow = `0 0 10px ${rgbaFromHex(paletteColor, 0.45 * baseAlpha)}`;
      return { color, opacity, shadow };
    }

    if (mode === 'gradient') {
      const phase = (tickMs % periodMs) / periodMs;
      const gradientColor = phase < 0.5
        ? mixHexColor(palette[0], palette[1] || palette[0], phase * 2)
        : mixHexColor(palette[1] || palette[0], palette[2] || palette[0], (phase - 0.5) * 2);
      color = rgbaFromHex(gradientColor, 0.96);
      opacity = Math.max(0.18, 0.88 * baseAlpha);
      shadow = `0 0 12px ${rgbaFromHex(gradientColor, 0.46 * opacity)}`;
      return { color, opacity, shadow };
    }

    if (mode === 'breath') {
      const sweep = 0.5 + 0.5 * Math.sin((tickMs / 1000) * (freq || 0.35) * Math.PI * 2 + paletteIndex * 0.45);
      const wave = sweep;
      const breathColor = palette.length >= 3
        ? (sweep < 0.5
          ? mixHexColor(palette[0], palette[1], sweep * 2)
          : mixHexColor(palette[1], palette[2], (sweep - 0.5) * 2))
        : mixHexColor(palette[0], palette[1] || palette[0], sweep);
      color = rgbaFromHex(breathColor, 0.96);
      opacity = wave * baseAlpha;
      shadow = opacity > 0.03 ? `0 0 14px ${rgbaFromHex(breathColor, 0.58 * opacity)}` : 'none';
      return { color, opacity, shadow };
    }

    if (mode === 'blink') {
      const phase = (tickMs % periodMs) / periodMs;
      const on = phase < duty;
      color = rgbaFromHex(paletteColor, on ? 0.98 : 0.85);
      opacity = on ? Math.max(0.12, baseAlpha) : 0.06;
      shadow = on ? `0 0 10px ${rgbaFromHex(paletteColor, 0.42 * opacity)}` : 'none';
      return { color, opacity, shadow };
    }

    if (mode === 'cycle') {
      const shift = Math.floor(tickMs / Math.max(120, periodMs / Math.max(1, palette.length)));
      const cycleColor = palette[(activeIndex + shift) % palette.length] || palette[0];
      color = rgbaFromHex(cycleColor, 0.95);
      opacity = Math.max(0.12, baseAlpha);
      shadow = `0 0 10px ${rgbaFromHex(cycleColor, 0.42 * opacity)}`;
      return { color, opacity, shadow };
    }

    if (mode === 'selftest') {
      const activeCount = Math.max(1, Math.floor((end - start) / step) + 1);
      const sweepPeriod = Math.max(360, periodMs);
      const head = Math.floor(((tickMs % sweepPeriod) / sweepPeriod) * activeCount);
      const dist = circularDistance(activeIndex, head, activeCount);
      const colorTick = Math.floor(tickMs / Math.max(180, sweepPeriod / 4));
      const reportColor = palette[(colorTick + activeIndex) % palette.length] || palette[0];
      const statusWave = 0.5 + 0.5 * Math.sin((tickMs / Math.max(360, sweepPeriod)) * Math.PI * 2 + activeIndex * 0.72);
      const ambient = 0.36 + 0.28 * statusWave;
      const trail = Math.max(ambient, dist === 0 ? 1 : dist === 1 ? 0.76 : dist === 2 ? 0.5 : 0.28);
      color = rgbaFromHex(reportColor, 0.98);
      opacity = Math.max(0.34, trail * baseAlpha);
      shadow = dist <= 1 ? `0 0 16px ${rgbaFromHex(reportColor, 0.58 * opacity)}` : `0 0 8px ${rgbaFromHex(reportColor, 0.26 * opacity)}`;
      return { color, opacity, shadow };
    }

    if (mode === 'chase') {
      const activeCount = Math.max(1, Math.floor((end - start) / step) + 1);
      const headPeriod = Math.max(180, periodMs / Math.max(1, activeCount));
      const head = Math.floor((tickMs / headPeriod) % activeCount);
      const dist = circularDistance(activeIndex, head, activeCount);
      const trail = dist === 0 ? 1 : 0;
      color = rgbaFromHex(paletteColor, 0.95);
      opacity = trail * baseAlpha;
      shadow = dist === 0 ? `0 0 12px ${rgbaFromHex(paletteColor, 0.5 * opacity)}` : 'none';
      return { color, opacity, shadow };
    }

    if (mode === 'pulse_chase') {
      const pulseCount = Math.max(1, Math.round(repeat || 15));
      const pulsePlan = pulseChasePulsePlan(track, pulseCount, periodMs / Math.max(1, pulseCount));
      const loopMs = pulsePlan.totalSpan + endHoldMs;
      const loopTime = loopMs > 0 ? tickMs % loopMs : tickMs;
      const activeCount = Math.max(1, Math.floor((end - start) / step) + 1);
      if (loopTime >= pulsePlan.totalSpan) {
        color = rgbaFromHex(paletteColor, 0.98);
        opacity = 0.95 * baseAlpha;
        shadow = `0 0 14px ${rgbaFromHex(paletteColor, 0.5 * opacity)}`;
        return { color, opacity, shadow };
      }
      let cursor = 0;
      let pulseIndex = 0;
      while (pulseIndex < pulsePlan.spans.length) {
        const span = Math.max(1, pulsePlan.spans[pulseIndex] || 1);
        if (loopTime < cursor + span) break;
        cursor += span;
        pulseIndex++;
      }
      const pulseSpanMs = Math.max(1, pulsePlan.spans[pulseIndex] || pulsePlan.spans[pulsePlan.spans.length - 1] || 1);
      const pulsePhase = clamp((loopTime - cursor) / pulseSpanMs, 0, 1);
      const head = Math.min(activeCount - 1, Math.floor(pulsePhase * activeCount));
      const dist = circularDistance(activeIndex, head, activeCount);
      const trail = dist === 0 ? 1 : dist === 1 ? 0.35 : 0;
      const pulseColor = palette[(pulseIndex + activeIndex) % palette.length] || palette[0];
      color = rgbaFromHex(pulseColor, 0.98);
      opacity = trail * baseAlpha;
      shadow = dist <= 1 ? `0 0 14px ${rgbaFromHex(pulseColor, 0.52 * opacity)}` : 'none';
      return { color, opacity, shadow };
    }

    color = rgbaFromHex(paletteColor, 0.95);
    opacity = Math.max(0.1, baseAlpha);
    shadow = `0 0 10px ${rgbaFromHex(paletteColor, 0.4 * opacity)}`;
    return { color, opacity, shadow };
  }

  function renderEffectMiniPreview(effectOrId, options = {}) {
    const effect = effectOrId && typeof effectOrId === 'object'
      ? effectOrId
      : effectDefinitionById(effectOrId) || (effectOrId ? null : (selectedEffectPreset() || state.localState.effect_presets?.[0] || null));
    const primary = effectPrimaryTrack(effect);
    if (!effect || !primary) {
      return '<div class="notice">暂无预览。</div>';
    }
    const shape = previewCellShape();
    const tickMs = previewFrameMs();
    const ledCount = clamp(normalizeNumber(options.ledCount, primary.led_count || 12), 8, 24);
    const start = clamp(normalizeNumber(primary?.led_start, 1), 1, ledCount);
    const end = clamp(normalizeNumber(primary?.led_end, ledCount), start, ledCount);
    const gap = Math.max(0, normalizeNumber(primary?.gap, 0));
    const step = gap + 1;
    const activeIndices = [];
    for (let led = start; led <= end; led += step) activeIndices.push(led);
    const activeMap = new Map(activeIndices.map((led, activeIndex) => [led, activeIndex]));
    const cellSize = clamp(normalizeNumber(options.cellSize, 8), 6, 12);
    const cellGap = clamp(normalizeNumber(options.cellGap, 2), 1, 4);
    const showLabel = options.label !== false;
    return `
      <div class="rounded-[12px] border border-[rgba(60,70,84,0.26)] bg-[rgba(10,17,27,0.74)] px-2.5 py-2">
        ${showLabel ? `
          <div class="flex items-center justify-between gap-2 text-[10px] leading-[1.35] text-[#8ea3bf]">
            <span>${escapeHtml(effectModeLabel(primary?.mode || 'solid'))}</span>
            <span>${escapeHtml(start)}-${escapeHtml(end)} · 间隔 ${escapeHtml(normalizeNumber(primary?.gap, 0))}</span>
          </div>
        ` : ''}
        <div class="${showLabel ? 'mt-2' : ''} flex min-w-0 overflow-x-auto pb-0.5" style="gap:${cellGap}px;scrollbar-width:thin;">
          ${Array.from({ length: ledCount }, (_, ledIdx) => {
            const ledNo = ledIdx + 1;
            const activeIndex = activeMap.has(ledNo) ? activeMap.get(ledNo) : -1;
            const visual = previewCellStyle(primary, ledNo, activeIndex, tickMs, 0);
            const borderRadius = shape === 'circle' ? '999px' : '4px';
            return `<span aria-hidden="true" style="flex:0 0 auto;width:${cellSize}px;height:${cellSize}px;border-radius:${borderRadius};background:${visual.color};opacity:${visual.opacity};box-shadow:${visual.shadow};border:1px solid rgba(16,20,28,0.88);transition:background .18s linear,opacity .18s linear,box-shadow .18s linear;"></span>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  function syncEffectPresetSummary(preset) {
    if (!preset || typeof preset !== 'object') return preset;
    preset.effect_ui = normalizeEffectUI(preset.effect_ui || {}, preset.effect_ui || {});
    const primary = effectPrimaryTrack(preset) || buildDefaultEffectTrack('solid', 0);
    preset.effect_ui.mode = primary.mode || 'solid';
    preset.effect_ui.ports = preset.effect_ui.tracks.map((track) => track.enabled !== false);
    preset.effect_ui.colors = Array.isArray(primary.colors) ? primary.colors.slice(0, 3) : effectTrackPalette(0);
    preset.effect_ui.brightness = normalizeNumber(primary.brightness, 80);
    preset.effect_ui.speed = normalizeNumber(primary.frequency_hz, 0);
    preset.effect_ui.period = normalizeNumber(primary.period_ms, 700);
    preset.effect_ui.duty = normalizeNumber(primary.duty, 50);
    preset.effect_ui.count = normalizeNumber(primary.repeat, 0);
    preset.effect_ui.accel = primary.mode === 'pulse_chase'
      ? Math.round(clamp(normalizeNumber(primary.pulse_speed_end, 100), 0, 100) / 10)
      : normalizeNumber(primary.accel, 0);
    preset.effect_ui.pulse_speed_start = clamp(normalizeNumber(primary.pulse_speed_start, 0), 0, 100);
    preset.effect_ui.pulse_speed_end = clamp(normalizeNumber(primary.pulse_speed_end, 100), 0, 100);
    preset.effect_ui.pulse_duration_ms = Math.max(0, normalizeNumber(primary.pulse_duration_ms, 0));
    preset.effect_ui.endHold = normalizeNumber(primary.end_hold_ms, 0);
    preset.effect_ui.endColor = String(primary.colors?.[2] || primary.colors?.[0] || '#FFFFFF');
    return preset;
  }

  function effectReferenceStats(effectId) {
    const id = String(effectId || '').trim();
    if (!id) return { templates: 0, rooms: 0 };
    let templates = 0;
    for (const template of state.localState?.templates || []) {
      const fields = [template?.effect_preset_id, template?.idle_effect_id, template?.trigger_effect_id, template?.preview_effect_id];
      if (fields.some((field) => String(field || '') === id)) templates++;
    }
    let rooms = 0;
    for (const room of roomList()) {
      const fields = [room?.effect_preset_id, room?.idle_effect_id, room?.trigger_effect_id, room?.preview_effect_id];
      if (fields.some((field) => String(field || '') === id)) rooms++;
    }
    return { templates, rooms };
  }

  function cleanupEffectReferences(deletedId, replacementId = 'builtin-breath') {
    const from = String(deletedId || '').trim();
    if (!from) return;
    const defaultEffect = String(replacementId || 'builtin-breath');
    const defaultIdle = 'builtin-silent';
    for (const template of state.localState?.templates || []) {
      if (String(template.effect_preset_id || '') === from) template.effect_preset_id = defaultEffect;
      if (String(template.preview_effect_id || '') === from) template.preview_effect_id = defaultEffect;
      if (String(template.idle_effect_id || '') === from) template.idle_effect_id = defaultIdle;
      if (String(template.trigger_effect_id || '') === from) template.trigger_effect_id = defaultEffect;
      template.updated_at = nowIso();
    }
    for (const room of roomList()) {
      if (String(room.effect_preset_id || '') === from) room.effect_preset_id = defaultEffect;
      if (String(room.preview_effect_id || '') === from) room.preview_effect_id = defaultEffect;
      if (String(room.idle_effect_id || '') === from) room.idle_effect_id = defaultIdle;
      if (String(room.trigger_effect_id || '') === from) room.trigger_effect_id = defaultEffect;
      room.updated_at = nowIso();
      updateRoomDraftSummary(room);
    }
  }

  function effectTemplateOptionsHtml(selectedTemplateId = '') {
    const templates = state.localState?.effect_templates || buildDefaultEffectTemplates();
    return templates.map((item) => `<option value="${escapeHtml(item.id)}" ${String(selectedTemplateId || '') === String(item.id) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  }

  function effectTrackFromTemplate(templateId, index = 0, overrides = {}) {
    const template = effectTemplateById(templateId) || buildDefaultEffectTemplates()[0] || null;
    const sourceTrack = effectPrimaryTrack(template) || buildDefaultEffectTrack('solid', index);
    const templateMode = String(sourceTrack?.mode || template?.effect_ui?.mode || 'solid');
    const templateColors = Array.isArray(sourceTrack?.colors) && sourceTrack.colors.length ? sourceTrack.colors : effectTrackPalette(index);
    return normalizeEffectTrack({
      id: overrides.id || uid('trk'),
      enabled: overrides.enabled !== undefined ? !!overrides.enabled : true,
      port: clamp(normalizeNumber(overrides.port, index + 1), 1, 3),
      template_id: templateId,
      mode: overrides.mode || templateMode,
      led_count: overrides.led_count ?? sourceTrack?.led_count ?? 35,
      led_start: overrides.led_start ?? sourceTrack?.led_start ?? 1,
      led_end: overrides.led_end ?? sourceTrack?.led_end ?? sourceTrack?.led_count ?? 35,
      gap: overrides.gap ?? sourceTrack?.gap ?? 0,
      brightness: overrides.brightness ?? sourceTrack?.brightness ?? 80,
      colors: Array.isArray(overrides.colors) && overrides.colors.length ? overrides.colors.slice(0, 3) : templateColors.slice(0, 3),
      repeat: overrides.repeat ?? sourceTrack?.repeat ?? 0,
      frequency_hz: overrides.frequency_hz ?? sourceTrack?.frequency_hz ?? 0,
      period_ms: overrides.period_ms ?? sourceTrack?.period_ms ?? 700,
      duty: overrides.duty ?? sourceTrack?.duty ?? 50,
      accel: overrides.accel ?? sourceTrack?.accel ?? 0,
      pulse_speed_start: overrides.pulse_speed_start ?? sourceTrack?.pulse_speed_start ?? 0,
      pulse_speed_end: overrides.pulse_speed_end ?? sourceTrack?.pulse_speed_end ?? Math.max(0, Math.min(100, normalizeNumber(sourceTrack?.accel ?? 0, 0) * 10 || 100)),
      pulse_duration_ms: overrides.pulse_duration_ms ?? sourceTrack?.pulse_duration_ms ?? 0,
      end_hold_ms: overrides.end_hold_ms ?? sourceTrack?.end_hold_ms ?? 0,
      end_behavior: overrides.end_behavior ?? sourceTrack?.end_behavior ?? 'off'
    }, null, index);
  }

  function buildEffectModalTracks(sourceTemplateId = 'builtin-breath', sourceEffect = null) {
    const source = sourceEffect && typeof sourceEffect === 'object' ? sourceEffect : null;
    const sourceTracks = Array.isArray(source?.effect_ui?.tracks) ? source.effect_ui.tracks : [];
    const tracks = [];
    for (let i = 0; i < EFFECT_TRACK_LIMIT; i++) {
      const sourceTrack = sourceTracks[i];
      if (sourceTrack) {
        tracks.push(normalizeEffectTrack(sourceTrack, null, i));
      } else {
        const templateId = source ? 'builtin-silent' : (i === 0 ? sourceTemplateId : 'builtin-silent');
        const silentFallback = String(templateId || '') === 'builtin-silent';
        tracks.push(effectTrackFromTemplate(templateId, i, {
          port: i + 1,
          enabled: source ? false : i === 0,
          ...(silentFallback ? {
            brightness: 0,
            repeat: 0,
            frequency_hz: 0,
            period_ms: 700,
            duty: 50,
            accel: 0,
            pulse_speed_start: 0,
            pulse_speed_end: 100,
            pulse_duration_ms: 0,
            end_hold_ms: 0,
            end_behavior: 'off'
          } : {})
        }));
      }
    }
    return tracks;
  }

  function openEffectFormModal(effectOrTemplateId = null, { mode = 'create' } = {}) {
    const custom = effectOrTemplateId && typeof effectOrTemplateId === 'object' ? effectOrTemplateId : effectPresetById(effectOrTemplateId);
    const templateId = custom?.source_template_id
      || (typeof effectOrTemplateId === 'string' && effectTemplateById(effectOrTemplateId) ? effectOrTemplateId : '')
      || custom?.effect_ui?.tracks?.find((track) => track && track.enabled !== false)?.template_id
      || 'builtin-breath';
    const sourceEffect = custom || null;
    const sourceTemplate = effectTemplateById(templateId) || buildDefaultEffectTemplates()[0] || null;
    const isEdit = !!sourceEffect;
    const draft = {
      open: true,
      mode: isEdit ? 'edit' : mode === 'create' ? 'create' : 'create',
      effectId: sourceEffect?.id || '',
      name: String(sourceEffect?.name || '我的灯效'),
      note: String(sourceEffect?.note || ''),
      source_template_id: String(templateId || sourceTemplate?.id || ''),
      tracks: buildEffectModalTracks(templateId || sourceTemplate?.id || 'builtin-silent', sourceEffect),
      step: 1,
      activeTrackIndex: 0
    };
    state.effectFormModal = draft;
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector('[data-role="effect-form-input"][data-effect-form-field="name"]');
      if (input) {
        input.focus();
        input.select?.();
      }
    });
  }

  function closeEffectFormModal() {
    state.effectFormModal = null;
    render();
  }

  function openEffectDeleteModal(effectOrId) {
    const effect = typeof effectOrId === 'object' ? effectOrId : effectPresetById(effectOrId);
    if (!effect) return;
    state.effectDeleteModal = {
      open: true,
      effectId: effect.id,
      name: String(effect.name || '未命名灯效'),
      refs: effectReferenceStats(effect.id)
    };
    render();
  }

  function closeEffectDeleteModal() {
    state.effectDeleteModal = null;
    render();
  }

  function buildTemplateFormDraft(source = null, { mode = 'create', name, note } = {}) {
    const raw = source && typeof source === 'object' ? source : {};
    const sourceMode = roleModeValue(raw.source_group_mode || ((Array.isArray(raw.default_source_group_ids) && raw.default_source_group_ids.length > 1) ? 'multi' : 'single'));
    const targetMode = roleModeValue(raw.target_group_mode || ((Array.isArray(raw.default_target_group_ids) && raw.default_target_group_ids.length > 1) ? 'multi' : 'single'));
    const scoring = raw.scoring && typeof raw.scoring === 'object' ? raw.scoring : {};
    const choices = effectChoiceList();
    const defaultIdleEffectId = choices.find((item) => String(item.id) === 'builtin-silent')?.id || choices[0]?.id || '';
    const defaultTriggerEffectId = choices.find((item) => String(item.id) === 'builtin-blink')?.id || choices.find((item) => String(item.id) === 'builtin-pulse')?.id || choices[0]?.id || defaultIdleEffectId;
    const isUserTemplate = raw.builtIn === false && String(raw.id || '').trim();
    return {
      open: true,
      mode: isUserTemplate && mode !== 'create' ? 'edit' : 'create',
      templateId: isUserTemplate && mode !== 'create' ? String(raw.id || '') : '',
      sourceId: String(raw.id || ''),
      step: 1,
      name: String(name ?? (isUserTemplate && mode !== 'create' ? raw.name : '我的模板')),
      note: String(note ?? (raw.note || '从当前配置创建')),
      feature_preset_id: String(raw.feature_preset_id || state.localState?.feature_presets?.[0]?.id || ''),
      effect_preset_id: String(raw.effect_preset_id || state.localState?.effect_presets?.[0]?.id || ''),
      source_group_mode: sourceMode,
      target_group_mode: targetMode,
      sense_mode: String(raw.sense_mode || 'ring'),
      idle_effect_id: String(raw.idle_effect_id || defaultIdleEffectId),
      trigger_effect_id: String(raw.trigger_effect_id || defaultTriggerEffectId),
      scoring_mode: String(scoring.mode || 'count_find'),
      scoring_max_find: normalizeNumber(scoring.max_find, 0)
    };
  }

  function openTemplateFormModal(source = null, { mode = 'create', name, note } = {}) {
    state.templateFormModal = buildTemplateFormDraft(source, { mode, name, note });
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector('[data-role="template-form-input"][data-template-form-field="name"]');
      if (input) {
        input.focus();
        input.select?.();
      }
    });
  }

  function closeTemplateFormModal() {
    state.templateFormModal = null;
    render();
  }

  function ensureTemplateFormModal() {
    if (!state.templateFormModal) return null;
    state.templateFormModal.step = clamp(normalizeNumber(state.templateFormModal.step, 1), 1, 2);
    return state.templateFormModal;
  }

  function saveTemplateFormModal() {
    const modal = ensureTemplateFormModal();
    if (!modal) return;
    const name = String(modal.name || '').trim();
    if (!name) {
      alert('模板名称不能为空。');
      return;
    }
    const duplicate = (state.localState.templates || []).find((item) => String(item.id || '') !== String(modal.templateId || '') && String(item.name || '').trim() === name);
    if (duplicate) {
      alert(`已有同名模板「${duplicate.name}」，请换一个不重名的名称。`);
      return;
    }
    const isEdit = String(modal.templateId || '').trim();
    const prev = isEdit ? state.localState.templates.find((item) => String(item.id) === String(modal.templateId)) : null;
    const template = {
      id: isEdit ? String(modal.templateId) : uid('tpl'),
      name,
      note: String(modal.note || ''),
      builtIn: false,
      feature_preset_id: String(modal.feature_preset_id || ''),
      effect_preset_id: String(modal.effect_preset_id || ''),
      source_group_mode: roleModeValue(modal.source_group_mode),
      target_group_mode: roleModeValue(modal.target_group_mode),
      default_source_group_ids: [],
      default_target_group_ids: [],
      sense_mode: String(modal.sense_mode || 'ring'),
      idle_effect_id: String(modal.idle_effect_id || 'builtin-silent'),
      trigger_effect_id: String(modal.trigger_effect_id || 'builtin-blink'),
      scoring: { mode: String(modal.scoring_mode || 'count_find'), max_find: normalizeNumber(modal.scoring_max_find, 0) },
      created_at: prev?.created_at || nowIso(),
      updated_at: nowIso(),
      config: prev?.config ? clone(prev.config) : buildControllerPayload()
    };
    if (template.id === state.selectedTemplateId) {
      state.selectedTemplateId = template.id;
      state.localState.ui.selected_template_id = template.id;
    }
    const list = Array.isArray(state.localState.templates) ? state.localState.templates.slice() : [];
    const idx = list.findIndex((item) => String(item.id) === String(template.id));
    if (idx >= 0) list[idx] = template;
    else list.unshift(template);
    state.localState.templates = list;
    state.selectedTemplateId = template.id;
    state.localState.ui.selected_template_id = template.id;
    state.templateFormModal = null;
    persistStateToServer();
    logDebug(`${isEdit ? '更新' : '新建'}模板 | ${template.name}`);
    render();
  }

  function ensureEffectFormModal() {
    if (!state.effectFormModal) return null;
    state.effectFormModal.tracks = Array.isArray(state.effectFormModal.tracks) ? state.effectFormModal.tracks : buildEffectModalTracks(state.effectFormModal.source_template_id || 'builtin-breath');
    return state.effectFormModal;
  }

  function saveEffectFormModal() {
    const modal = ensureEffectFormModal();
    if (!modal) return;
    const name = String(modal.name || '').trim();
    const normalizedName = name.replace(/\s+/g, '');
    if (!name || normalizedName === '我的灯效') {
      alert('灯效名称不能是默认名“我的灯效”，请先改成一个唯一名称。');
      return;
    }
    const duplicate = (state.localState.effect_presets || []).find((item) => String(item.id || '') !== String(modal.effectId || '') && String(item.name || '').trim() === name);
    if (duplicate) {
      alert(`已有同名灯效「${duplicate.name}」，请换一个不重名的名称。`);
      return;
    }
    const tracks = (modal.tracks || []).slice(0, EFFECT_TRACK_LIMIT).map((track, index) => normalizeEffectTrack(track, null, index));
    tracks.forEach((track, index) => {
      if (track && typeof track === 'object') track.port = index + 1;
    });
    const sourceTemplateId = String(tracks.find((item) => item?.enabled !== false && item?.template_id && item.template_id !== 'builtin-silent')?.template_id || modal.source_template_id || 'builtin-breath');
    const isCreate = !String(modal.effectId || '').trim();
    const effect = {
      id: modal.effectId || uid('ep'),
      name,
      note: String(modal.note || ''),
      builtIn: false,
      source_template_id: sourceTemplateId,
      created_at: isCreate ? nowIso() : String(effectPresetById(modal.effectId)?.created_at || nowIso()),
      updated_at: nowIso(),
      effect_ui: normalizeEffectUI({
        schema: 3,
        source_template_id: sourceTemplateId,
        mode: effectModeLabel(effectPrimaryTrack({ effect_ui: { tracks } })?.mode || 'solid'),
        tracks
      })
    };
    syncEffectPresetSummary(effect);
    const list = Array.isArray(state.localState.effect_presets) ? state.localState.effect_presets.slice() : [];
    const idx = list.findIndex((item) => String(item.id) === String(effect.id));
    if (idx >= 0) list[idx] = effect;
    else list.unshift(effect);
    state.localState.effect_presets = list;
    state.localState.ui.selected_effect_preset_id = effect.id;
    state.selectedEffectId = effect.id;
    state.effectFormModal = null;
    persistStateToServer();
    logDebug(`${isCreate ? '新建' : '更新'}灯效 | ${effect.name}`);
    render();
  }

  function confirmDeleteEffectModal() {
    const modal = state.effectDeleteModal;
    if (!modal) return;
    const preset = effectPresetById(modal.effectId);
    if (!preset) {
      closeEffectDeleteModal();
      return;
    }
    const refs = effectReferenceStats(preset.id);
    cleanupEffectReferences(preset.id, effectTemplateIdForMode(effectPrimaryTrack(preset)?.mode || 'breath'));
    state.localState.effect_presets = (state.localState.effect_presets || []).filter((item) => String(item.id) !== String(preset.id));
    const next = state.localState.effect_presets[0] || null;
    state.localState.ui.selected_effect_preset_id = next?.id || '';
    state.selectedEffectId = state.localState.ui.selected_effect_preset_id;
    state.effectDeleteModal = null;
    persistStateToServer();
    logDebug(`删除灯效 | ${modal.name} | templates=${refs.templates} rooms=${refs.rooms}`);
    render();
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
      case 'target':
        return shell('<circle cx="12" cy="12" r="7.5"></circle><circle cx="12" cy="12" r="3"></circle><path d="M12 2.75v3"></path><path d="M12 18.25v3"></path><path d="M2.75 12h3"></path><path d="M18.25 12h3"></path>');
      case 'zap':
        return shell('<path d="M13.5 2.75 5.25 13.5h6L10.5 21.25l8.25-10.75h-6l.75-7.75Z"></path>');
      case 'trophy':
        return shell('<path d="M8.25 21h7.5"></path><path d="M12 17.25V21"></path><path d="M7.5 4.5h9v4.75a4.5 4.5 0 0 1-9 0V4.5Z"></path><path d="M7.5 6H4.25v2.25A3.25 3.25 0 0 0 7.5 11.5"></path><path d="M16.5 6h3.25v2.25a3.25 3.25 0 0 1-3.25 3.25"></path>');
      case 'sliders':
        return shell('<path d="M4.5 6h4.25"></path><path d="M13.25 6H19.5"></path><path d="M10 3.75v4.5"></path><path d="M4.5 12h8.25"></path><path d="M17.25 12h2.25"></path><path d="M14 9.75v4.5"></path><path d="M4.5 18h2.25"></path><path d="M11.25 18h8.25"></path><path d="M8 15.75v4.5"></path>');
      case 'wifi':
        return shell('<path d="M5.25 9.75a10.5 10.5 0 0 1 13.5 0"></path><path d="M8.25 13.25a6.25 6.25 0 0 1 7.5 0"></path><path d="M11.25 16.75a2 2 0 0 1 1.5 0"></path>');
      case 'eye':
        return shell('<path d="M3.75 12s3-5.25 8.25-5.25S20.25 12 20.25 12 17.25 17.25 12 17.25 3.75 12 3.75 12Z"></path><circle cx="12" cy="12" r="2.25"></circle>');
      case 'user':
        return shell('<circle cx="12" cy="8" r="3.25"></circle><path d="M5.25 20.25a6.75 6.75 0 0 1 13.5 0"></path>');
      case 'users':
        return shell('<circle cx="9" cy="8.25" r="3"></circle><path d="M3.75 20.25a6 6 0 0 1 12 0"></path><path d="M15.75 5.5a3 3 0 0 1 0 5.5"></path><path d="M17.25 14.25a5.5 5.5 0 0 1 3.25 5"></path>');
      case 'clock':
        return shell('<circle cx="12" cy="12" r="8.25"></circle><path d="M12 7.5V12l3 2"></path>');
      case 'calendar':
        return shell('<rect x="4.5" y="5.25" width="15" height="15" rx="2"></rect><path d="M8.25 3.75v3"></path><path d="M15.75 3.75v3"></path><path d="M4.5 9h15"></path>');
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

  function makeGroupActionButton(label, action, gid, active = false, compact = false, extra = '') {
    const classes = [
      'inline-flex items-center justify-center gap-1 rounded-full border px-2 text-[10px] leading-none whitespace-nowrap cursor-pointer transition active:translate-y-px hover:brightness-105',
      'border-[rgba(88,113,145,0.28)] bg-[rgba(24,33,47,0.92)] text-[#dbe5f4]',
      active ? 'bg-gradient-to-b from-[#396ecc] to-[#315ea7] text-white border-transparent' : '',
      extra
    ].filter(Boolean).join(' ');
    const style = compact ? ' style="height:20px;min-width:40px;padding:0 6px;font-size:9px;line-height:1"' : '';
    return `<button class="${classes}"${style} type="button" data-action="${escapeHtml(action)}" data-gid="${escapeHtml(gid)}">${escapeHtml(label)}</button>`;
  }

  function buildDefaultDevices() {
    return [];
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
        effect_ui: { mode: 'breath', ports: [true, false, false], colors: ['#FFD24D', '#34B3FF', '#61E09A'], brightness: 60, speed: 45, period: 700, duty: 50, count: 0, accel: 0, pulse_speed_start: 0, pulse_speed_end: 100, pulse_duration_ms: 0, endHold: 0, endColor: '#FFFFFF' },
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
        effect_ui: { mode: 'chase', ports: [true, true, true], colors: ['#61E09A', '#F3C44D', '#4BA9FF'], brightness: 80, speed: 420, period: 420, duty: 50, count: 0, accel: 0, pulse_speed_start: 0, pulse_speed_end: 100, pulse_duration_ms: 0, endHold: 0, endColor: '#FFFFFF' },
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
        effect_ui: { mode: 'blink', ports: [true, true, true], colors: ['#F3C44D', '#34B3FF', '#61E09A'], brightness: 100, speed: 0, period: 700, duty: 50, count: 0, accel: 0, pulse_speed_start: 0, pulse_speed_end: 100, pulse_duration_ms: 0, endHold: 0, endColor: '#FFFFFF' },
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
        effect_template_id: 'builtin-breath',
        effect: 'builtin-breath',
        effect_ui: { mode: 'breath', ports: [true, true, true], colors: ['#FFD24D', '#34B3FF', '#61E09A'], brightness: 60, speed: 0.3, period: 3333, duty: 50, count: 0, accel: 0, pulse_speed_start: 0, pulse_speed_end: 100, pulse_duration_ms: 0, endHold: 0, endColor: '#FFFFFF' },
        idle_effect: 'builtin-silent',
        silence: '',
        signal_ui: { reverse: false, weak_rssi: -90, strong_rssi: -20, weak_output: '静默', strong_output: '提示', hold_ms: 2500 },
        score: { enabled: false, led_count: 0, color_mode: 'none', max_score: 0 }
      }
    ];
  }

  function buildDefaultControllerState() {
    return {
      schema_version: 3,
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
      effects: builtinEffectCatalog.map((item) => ({
        id: item.id,
        name: item.name,
        note: item.note,
        builtIn: true,
        effect_ui: normalizeEffectUI({
          mode: item.mode,
          tracks: item.kind === 'utility'
            ? [buildDefaultEffectTrack(item.mode, 0, { port: 1, led_count: 35, led_start: 1, led_end: 35, brightness: 90, colors: [item.colorA, item.colorB, item.colorC], period_ms: 1200 })]
            : [buildDefaultEffectTrack(item.mode, 0, {
              port: 1,
              led_count: 35,
              led_start: 1,
              led_end: 35,
              brightness: item.mode === 'silent' ? 0 : item.mode === 'blink' ? 100 : item.mode === 'breath' ? 60 : item.mode === 'selftest' ? 90 : 80,
              colors: [item.colorA, item.colorB, item.colorC],
              repeat: item.mode === 'pulse_chase' ? 15 : 0,
              frequency_hz: item.mode === 'breath' ? 0.3 : 0,
              period_ms: item.mode === 'cycle' ? 420 : item.mode === 'chase' ? 420 : item.mode === 'blink' ? 700 : item.mode === 'gradient' ? 1800 : item.mode === 'selftest' ? 1200 : 700,
              duty: 50,
              accel: item.mode === 'pulse_chase' ? 2 : 0,
              pulse_speed_start: item.mode === 'pulse_chase' ? 0 : 0,
              pulse_speed_end: item.mode === 'pulse_chase' ? 100 : 100,
              pulse_duration_ms: 0,
              end_hold_ms: 0,
              end_behavior: 'off'
            })]
        }),
        updated_at: '1970-01-01T00:00:00'
      })),
      active_preset: '魔杖寻宝-单人轮巡'
    };
  }

  function buildOfflineControllerState() {
    const base = buildDefaultControllerState();
    return {
      ...base,
      devices: base.devices.map((device, idx) => ({
        ...device,
        idx: normalizeNumber(device.idx, idx),
        seen_ms: 999999,
        rssi: -999
      })),
      records: [],
      rules: []
    };
  }

  function buildDefaultFeaturePresets() {
    return buildDefaultPlayPresets().map(playPresetToFeaturePreset);
  }

  function buildDefaultPlayPresets() {
    return [
      {
        id: 'play-treasure-ffa',
        name: '多人寻宝混战',
        note: '玩家设备靠近目标设备，发现者个人得分；每个玩家对每个目标只计一次。',
        builtIn: true,
        baseTemplate: 'instant_score',
        relation: { mode: 'many_to_many', match: 'source_to_target', sourceRole: 'player_device', targetRole: 'target_device' },
        signal: { type: 'enter_range', rssiMin: -35, rssiMax: null, holdMs: 2000, missingMs: 3000, smoothSamples: 5 },
        trigger: { mode: 'instant', targetMs: 0, targetCount: 1, periodMs: 0 },
        score: { target: 'source_player', points: 1, type: 'add' },
        repeat: { mode: 'once_per_pair', cooldownMs: 5000 },
        afterTrigger: { targetState: 'none', timerAction: 'none' },
        feedback: { onEnter: 'builtin-breath', onSuccess: 'builtin-pulse', onFail: 'builtin-silent' },
        created_at: '1970-01-01T00:00:00',
        updated_at: '1970-01-01T00:00:00'
      },
      {
        id: 'play-treasure-solo',
        name: '单人寻宝',
        note: '单个玩家设备寻找目标设备，每对设备只计一次。',
        builtIn: true,
        baseTemplate: 'instant_score',
        relation: { mode: 'one_to_many', match: 'source_to_target', sourceRole: 'player_device', targetRole: 'target_device' },
        signal: { type: 'enter_range', rssiMin: -35, rssiMax: null, holdMs: 2000, missingMs: 3000, smoothSamples: 5 },
        trigger: { mode: 'instant', targetMs: 0, targetCount: 1, periodMs: 0 },
        score: { target: 'source_player', points: 1, type: 'add' },
        repeat: { mode: 'once_per_pair', cooldownMs: 5000 },
        afterTrigger: { targetState: 'none', timerAction: 'none' },
        feedback: { onEnter: 'builtin-breath', onSuccess: 'builtin-blink', onFail: 'builtin-silent' },
        created_at: '1970-01-01T00:00:00',
        updated_at: '1970-01-01T00:00:00'
      },
      {
        id: 'play-resonance-duo',
        name: '双人魔杖共鸣',
        note: '两名玩家保持在指定 RSSI 范围内，连续达标后双方得分。',
        builtIn: true,
        baseTemplate: 'sustain_score',
        relation: { mode: 'one_to_one', match: 'specified_pair', sourceRole: 'player_device', targetRole: 'player_device' },
        signal: { type: 'stay_in_range', rssiMin: -40, rssiMax: -20, holdMs: 0, missingMs: 2000, smoothSamples: 5 },
        trigger: { mode: 'continuous', targetMs: 60000, targetCount: 1, periodMs: 0 },
        score: { target: 'both_players', points: 1, type: 'add' },
        repeat: { mode: 'cooldown', cooldownMs: 10000 },
        afterTrigger: { targetState: 'none', timerAction: 'reset' },
        feedback: { onEnter: 'builtin-breath', onSuccess: 'builtin-pulse', onFail: 'builtin-blink' },
        created_at: '1970-01-01T00:00:00',
        updated_at: '1970-01-01T00:00:00'
      },
      {
        id: 'play-control-point',
        name: '小组占点',
        note: '多个玩家或小组竞争同一个目标，目标设备选择占领者。',
        builtIn: true,
        baseTemplate: 'competition_score',
        relation: { mode: 'many_to_one', match: 'source_to_target', sourceRole: 'player_device', targetRole: 'target_device' },
        signal: { type: 'enter_range', rssiMin: -45, rssiMax: null, holdMs: 0, missingMs: 3000, smoothSamples: 5 },
        trigger: { mode: 'accumulate', targetMs: 30000, targetCount: 1, periodMs: 0 },
        score: { target: 'source_group', points: 1, type: 'add' },
        repeat: { mode: 'cooldown', cooldownMs: 10000 },
        afterTrigger: { targetState: 'cooldown', timerAction: 'reset' },
        feedback: { onEnter: 'builtin-gradient', onSuccess: 'builtin-chase', onFail: 'builtin-silent' },
        created_at: '1970-01-01T00:00:00',
        updated_at: '1970-01-01T00:00:00'
      },
      {
        id: 'play-distance-keep',
        name: '距离保持',
        note: '设备保持在指定 RSSI 范围内，周期或累计计分。',
        builtIn: true,
        baseTemplate: 'sustain_score',
        relation: { mode: 'many_to_many', match: 'any', sourceRole: 'player_device', targetRole: 'player_device' },
        signal: { type: 'stay_in_range', rssiMin: -55, rssiMax: -25, holdMs: 0, missingMs: 2000, smoothSamples: 5 },
        trigger: { mode: 'periodic', targetMs: 0, targetCount: 1, periodMs: 10000 },
        score: { target: 'source_player', points: 1, type: 'add' },
        repeat: { mode: 'allow_repeat', cooldownMs: 0 },
        afterTrigger: { targetState: 'none', timerAction: 'none' },
        feedback: { onEnter: 'builtin-breath', onSuccess: 'builtin-cycle', onFail: 'builtin-blink' },
        created_at: '1970-01-01T00:00:00',
        updated_at: '1970-01-01T00:00:00'
      },
      {
        id: 'play-effect-test',
        name: '灯效测试',
        note: '不计分，只按 RSSI 或人工预备流程触发灯效。',
        builtIn: true,
        baseTemplate: 'instant_score',
        relation: { mode: 'many_to_many', match: 'any', sourceRole: 'device', targetRole: 'device' },
        signal: { type: 'enter_range', rssiMin: DEFAULT_TRIGGER_RSSI, rssiMax: null, holdMs: DEFAULT_TRIGGER_HOLD_MS, missingMs: 3000, smoothSamples: 3 },
        trigger: { mode: 'instant', targetMs: 0, targetCount: 1, periodMs: 0 },
        score: { target: 'none', points: 0, type: 'none' },
        repeat: { mode: 'allow_repeat', cooldownMs: 0 },
        afterTrigger: { targetState: 'none', timerAction: 'none' },
        feedback: { onEnter: 'builtin-silent', onSuccess: 'builtin-cycle', onFail: 'builtin-silent' },
        created_at: '1970-01-01T00:00:00',
        updated_at: '1970-01-01T00:00:00'
      }
    ];
  }

  function playPresetToFeaturePreset(preset) {
    const signal = preset?.signal || {};
    const feedback = preset?.feedback || {};
    const score = preset?.score || {};
    return {
      id: String(preset?.id || uid('play')),
      name: String(preset?.name || '未命名玩法'),
      note: String(preset?.note || ''),
      builtIn: preset?.builtIn === true,
      baseTemplate: String(preset?.baseTemplate || 'instant_score'),
      relation: clone(preset?.relation || {}),
      signal: clone(signal),
      trigger: clone(preset?.trigger || {}),
      score: clone(score),
      repeat: clone(preset?.repeat || {}),
      afterTrigger: clone(preset?.afterTrigger || {}),
      feedback: clone(feedback),
      feature_ui: {
        sense_mode: preset?.baseTemplate === 'competition_score' ? 'shared' : preset?.baseTemplate === 'sustain_score' ? 'response' : 'ring',
        signal_ui: {
          trigger_compare: signal.rssiMax !== null && signal.rssiMax !== undefined ? 'range' : 'gte',
          trigger_rssi_threshold: normalizeNumber(signal.rssiMin, DEFAULT_TRIGGER_RSSI),
          trigger_hold_ms: normalizeNumber(signal.holdMs, DEFAULT_TRIGGER_HOLD_MS)
        },
        scoring: {
          mode: String(score.target || 'source_player'),
          max_find: normalizeNumber(preset?.trigger?.targetCount, 0)
        },
        timer: {
          mode: String(preset?.trigger?.mode || 'instant'),
          duration_ms: normalizeNumber(preset?.trigger?.targetMs || preset?.trigger?.periodMs, 0)
        },
        idle_effect_id: String(feedback.onEnter || 'builtin-breath'),
        trigger_effect_id: String(feedback.onSuccess || 'builtin-pulse')
      },
      created_at: String(preset?.created_at || nowIso()),
      updated_at: String(preset?.updated_at || nowIso())
    };
  }

  function playPresetToTemplate(preset) {
    const feature = playPresetToFeaturePreset(preset);
    const relation = preset?.relation || {};
    return {
      id: feature.id,
      name: feature.name,
      note: feature.note,
      builtIn: preset?.builtIn === true,
      play_preset_id: feature.id,
      feature_preset_id: feature.id,
      effect_preset_id: String(preset?.feedback?.onSuccess || ''),
      source_group_mode: relation.mode === 'one_to_one' || relation.mode === 'one_to_many' ? 'single' : 'multi',
      target_group_mode: relation.mode === 'one_to_one' || relation.mode === 'many_to_one' ? 'single' : 'multi',
      default_source_group_ids: [],
      default_target_group_ids: [],
      sense_mode: feature.feature_ui.sense_mode,
      idle_effect_id: feature.feature_ui.idle_effect_id,
      trigger_effect_id: feature.feature_ui.trigger_effect_id,
      scoring: clone(feature.score || {}),
      created_at: String(preset?.created_at || nowIso()),
      updated_at: String(preset?.updated_at || nowIso()),
      config: null
    };
  }

  function buildDefaultEffectPresets() {
    return builtinEffects.map((effect, index) => buildEffectPresetFromDefinition(effect, index));
  }

  function buildDefaultLocalState() {
    const defaultPlayPresets = buildDefaultPlayPresets();
    return {
      schema: LOCAL_SCHEMA_VERSION,
      gameplay_reset_version: LOCAL_SCHEMA_VERSION,
      updated_at: nowIso(),
      rssi_defaults_version: RSSI_DEFAULTS_VERSION,
      device_drafts: {},
      controller_groups: buildDefaultGroups(),
      hidden_devices: [],
      system_play_presets: defaultPlayPresets.map((preset) => clone({ ...preset, builtIn: true })),
      user_play_presets: [],
      play_presets: defaultPlayPresets.map((preset) => clone(preset)),
      templates: defaultPlayPresets.map(playPresetToTemplate),
      rooms: [],
      active_room_id: '',
      current_room: null,
      room_history: [],
      feature_presets: defaultPlayPresets.map(playPresetToFeaturePreset),
      effect_templates: buildDefaultEffectTemplates(),
      effect_presets: buildDefaultCustomEffects(),
      ui: {
        active_tab: 'overview',
        show_unassigned: true,
        device_filter_mode: 'ungrouped',
        device_filter_group_id: -1,
        room_sort_order: 'desc',
        show_offline_devices: false,
        device_preview_collapsed: false,
        preview_cell_shape: 'square',
        selected_group_id: 0,
        expanded_group_id: -1,
        selected_template_id: defaultPlayPresets[0].id,
        selected_feature_preset_id: defaultPlayPresets[0].id,
        selected_play_preset_id: defaultPlayPresets[0].id,
        selected_effect_preset_id: '',
        play_preset_filter: 'all',
        play_preset_query: '',
        play_preset_advanced: false,
        play_preset_list_collapsed: false,
        system_play_presets_collapsed: true,
        wizard: {
          open: false,
          step: 0,
          return_tab: 'overview'
        }
      }
    };
  }

  function templateDefaults(templateId) {
    return builtinTemplates.find((tpl) => tpl.id === templateId) || null;
  }

  function templateMetaFromSource(raw = {}) {
    return {
      feature_preset_id: String(raw.feature_preset_id || ''),
      effect_preset_id: String(raw.effect_preset_id || ''),
      source_group_mode: roleModeValue(raw.source_group_mode || ((Array.isArray(raw.default_source_group_ids) && raw.default_source_group_ids.length > 1) ? 'multi' : 'single')),
      target_group_mode: roleModeValue(raw.target_group_mode || ((Array.isArray(raw.default_target_group_ids) && raw.default_target_group_ids.length > 1) ? 'multi' : 'single')),
      default_source_group_ids: [],
      default_target_group_ids: [],
      sense_mode: String(raw.sense_mode || ''),
      idle_effect_id: String(raw.idle_effect_id || ''),
      trigger_effect_id: String(raw.trigger_effect_id || ''),
      scoring: raw.scoring && typeof raw.scoring === 'object' ? clone(raw.scoring) : {}
    };
  }

  function normalizeFeaturePresets(raw) {
    const source = Array.isArray(raw) ? raw : [];
    const byId = new Map(buildDefaultFeaturePresets().map((item) => [item.id, clone(item)]));
    for (const item of source) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '').trim() || uid('fp');
      const featureUi = item.feature_ui && typeof item.feature_ui === 'object' ? clone(item.feature_ui) : clone(item.feature_ui || {});
      featureUi.signal_ui = {
        trigger_compare: triggerCompareValue(featureUi?.signal_ui?.trigger_compare),
        trigger_rssi_threshold: normalizeNumber(featureUi?.signal_ui?.trigger_rssi_threshold, DEFAULT_TRIGGER_RSSI),
        trigger_hold_ms: normalizeNumber(featureUi?.signal_ui?.trigger_hold_ms, DEFAULT_TRIGGER_HOLD_MS)
      };
      byId.set(id, {
        id,
        name: String(item.name || '未命名功能包'),
        note: String(item.note || ''),
        builtIn: item.builtIn === true,
        feature_ui: featureUi,
        created_at: String(item.created_at || nowIso()),
        updated_at: String(item.updated_at || nowIso())
      });
    }
    return Array.from(byId.values());
  }

  function normalizePlayPreset(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const id = String(source.id || uid('play'));
    const signal = source.signal && typeof source.signal === 'object' ? source.signal : {};
    const trigger = source.trigger && typeof source.trigger === 'object' ? source.trigger : {};
    const score = source.score && typeof source.score === 'object' ? source.score : {};
    const repeat = source.repeat && typeof source.repeat === 'object' ? source.repeat : {};
    const feedback = source.feedback && typeof source.feedback === 'object' ? source.feedback : {};
    const meter = feedback.signalMeter && typeof feedback.signalMeter === 'object' ? feedback.signalMeter : {};
    return {
      id,
      name: String(source.name || '未命名玩法'),
      note: String(source.note || ''),
      builtIn: source.builtIn === true,
      baseTemplate: ['instant_score', 'sustain_score', 'competition_score'].includes(String(source.baseTemplate || ''))
        ? String(source.baseTemplate)
        : 'instant_score',
      relation: {
        mode: String(source.relation?.mode || 'many_to_many'),
        match: String(source.relation?.match || 'source_to_target'),
        sourceRole: String(source.relation?.sourceRole || 'player_device'),
        targetRole: String(source.relation?.targetRole || 'target_device')
      },
      signal: {
        type: String(signal.type || 'enter_range'),
        rssiMin: normalizeNumber(signal.rssiMin ?? signal.trigger_rssi_threshold, DEFAULT_TRIGGER_RSSI),
        rssiMax: signal.rssiMax === null || signal.rssiMax === undefined || signal.rssiMax === '' ? null : normalizeNumber(signal.rssiMax, -20),
        holdMs: normalizeNumber(signal.holdMs ?? signal.trigger_hold_ms, DEFAULT_TRIGGER_HOLD_MS),
        missingMs: normalizeNumber(signal.missingMs, 3000),
        smoothSamples: clamp(normalizeNumber(signal.smoothSamples, 5), 1, 10)
      },
      trigger: {
        mode: String(trigger.mode || 'instant'),
        targetMs: normalizeNumber(trigger.targetMs, 0),
        targetCount: normalizeNumber(trigger.targetCount, 1),
        periodMs: normalizeNumber(trigger.periodMs, 0)
      },
      score: {
        target: String(score.target || 'source_player'),
        points: normalizeNumber(score.points, 1),
        type: String(score.type || (normalizeNumber(score.points, 1) === 0 ? 'none' : 'add'))
      },
      repeat: {
        mode: String(repeat.mode || 'once_per_pair'),
        cooldownMs: normalizeNumber(repeat.cooldownMs, 5000)
      },
      afterTrigger: {
        targetState: String(source.afterTrigger?.targetState || 'none'),
        timerAction: String(source.afterTrigger?.timerAction || 'none')
      },
      feedback: {
        onEnter: String(feedback.onEnter || 'builtin-breath'),
        onSuccess: String(feedback.onSuccess || 'builtin-pulse'),
        onFail: String(feedback.onFail || 'builtin-silent'),
        signalMeter: {
          enabled: meter.enabled === true,
          port: clamp(normalizeNumber(meter.port, 1), 1, 3),
          ledCount: clamp(normalizeNumber(meter.ledCount, 10), 1, 200),
          weakRssi: normalizeNumber(meter.weakRssi, -90),
          strongRssi: normalizeNumber(meter.strongRssi, normalizeNumber(signal.rssiMin ?? signal.trigger_rssi_threshold, DEFAULT_TRIGGER_RSSI)),
          compressionX100: clamp(normalizeNumber(meter.compressionX100 ?? meter.compression_x100, 100), 20, 500)
        }
      },
      created_at: String(source.created_at || nowIso()),
      updated_at: String(source.updated_at || nowIso())
    };
  }

  function normalizePlayPresets(raw) {
    const source = Array.isArray(raw) ? raw : [];
    const byId = new Map(buildDefaultPlayPresets().map((item) => [item.id, normalizePlayPreset(item)]));
    for (const item of source) {
      if (!item || typeof item !== 'object') continue;
      const preset = normalizePlayPreset(item);
      byId.set(preset.id, preset);
    }
    return Array.from(byId.values());
  }

  function builtInPlayPresetIds() {
    return new Set(buildDefaultPlayPresets().map((item) => String(item.id || '')));
  }

  function normalizeUserPlayPresets(raw) {
    const source = Array.isArray(raw) ? raw : [];
    const builtInIds = builtInPlayPresetIds();
    const byId = new Map();
    for (const item of source) {
      if (!item || typeof item !== 'object') continue;
      const preset = normalizePlayPreset({ ...item, builtIn: false });
      if (builtInIds.has(String(preset.id || ''))) continue;
      preset.builtIn = false;
      byId.set(preset.id, preset);
    }
    return Array.from(byId.values()).sort((a, b) => {
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      return bTime - aTime || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    });
  }

  function rebuildPresetDerivedState(localState) {
    if (!localState || typeof localState !== 'object') return localState;
    localState.system_play_presets = buildDefaultPlayPresets().map((item) => normalizePlayPreset(item));
    localState.user_play_presets = normalizeUserPlayPresets(localState.user_play_presets || []);
    localState.play_presets = [
      ...localState.system_play_presets.map((item) => clone(item)),
      ...localState.user_play_presets.map((item) => clone(item))
    ];
    localState.feature_presets = localState.play_presets.map(playPresetToFeaturePreset);
    localState.templates = localState.play_presets.map(playPresetToTemplate);
    return localState;
  }

  function allPlayPresets(localState = state.localState) {
    const source = localState && typeof localState === 'object' ? localState : buildDefaultLocalState();
    if (Array.isArray(source.play_presets) && source.play_presets.length) return source.play_presets;
    rebuildPresetDerivedState(source);
    return source.play_presets || [];
  }

  function systemPlayPresets(localState = state.localState) {
    const source = localState && typeof localState === 'object' ? localState : buildDefaultLocalState();
    if (Array.isArray(source.system_play_presets) && source.system_play_presets.length) return source.system_play_presets;
    rebuildPresetDerivedState(source);
    return source.system_play_presets || [];
  }

  function userPlayPresets(localState = state.localState) {
    const source = localState && typeof localState === 'object' ? localState : buildDefaultLocalState();
    if (Array.isArray(source.user_play_presets)) return source.user_play_presets;
    rebuildPresetDerivedState(source);
    return source.user_play_presets || [];
  }

  function playPresetById(id, localState = state.localState) {
    const key = String(id || '');
    return allPlayPresets(localState).find((item) => String(item.id) === key) || null;
  }

  function normalizeEffectTemplates(raw) {
    const source = Array.isArray(raw) ? raw : [];
    const byId = new Map(buildDefaultEffectTemplates().map((item) => [item.id, clone(item)]));
    for (const item of source) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '').trim() || uid('ep');
      const normalizedUi = normalizeEffectUI(item.effect_ui || item, byId.get(id)?.effect_ui || null);
      byId.set(id, {
        id,
        name: String(item.name || '未命名灯效'),
        note: String(item.note || ''),
        builtIn: item.builtIn === true,
        effect_ui: normalizedUi,
        created_at: String(item.created_at || nowIso()),
        updated_at: String(item.updated_at || nowIso())
      });
    }
    return Array.from(byId.values());
  }

  function normalizeEffectPresets(raw) {
    const source = Array.isArray(raw) ? raw : [];
    const byId = new Map();
    for (const item of source) {
      if (!item || typeof item !== 'object') continue;
      if (item.builtIn === true) continue;
      const id = String(item.id || '').trim() || uid('ep');
      const normalizedUi = normalizeEffectUI(item.effect_ui || item, null);
      byId.set(id, {
        id,
        name: String(item.name || '未命名灯效'),
        note: String(item.note || ''),
        builtIn: false,
        source_template_id: String(item.source_template_id || item.template_id || ''),
        effect_ui: normalizedUi,
        created_at: String(item.created_at || nowIso()),
        updated_at: String(item.updated_at || nowIso())
      });
    }
    return Array.from(byId.values());
  }

  function featurePresetById(id) {
    const presetId = String(id || '');
    return (state.localState?.feature_presets || buildDefaultFeaturePresets()).find((item) => String(item.id) === presetId) || null;
  }

  function effectTemplateById(id) {
    const presetId = String(id || '');
    return (state.localState?.effect_templates || buildDefaultEffectTemplates()).find((item) => String(item.id) === presetId) || null;
  }

  function effectPresetById(id) {
    const presetId = String(id || '');
    return (state.localState?.effect_presets || buildDefaultCustomEffects()).find((item) => String(item.id) === presetId) || null;
  }

  function synthesizePreviewEffectDefinition(effect) {
    if (!effect || typeof effect !== 'object') return null;
    if (effect.effect_ui && Array.isArray(effect.effect_ui.tracks)) return effect;
    const mode = String(effect.mode || 'solid');
    const track = buildDefaultEffectTrack(mode, 0, {
      template_id: effectTemplateIdForMode(mode),
      colors: [
        String(effect.colorA || '#FFFFFF'),
        String(effect.colorB || effect.colorA || '#FFFFFF'),
        String(effect.colorC || effect.colorA || '#FFFFFF')
      ],
      brightness: mode === 'silent' ? 0 : 80,
      repeat: mode === 'pulse_chase' ? 15 : 0,
      frequency_hz: mode === 'breath' ? 0.3 : 0,
      period_ms: mode === 'cycle' ? 420 : mode === 'gradient' ? 1800 : mode === 'selftest' ? 1200 : 700,
      duty: 50,
      accel: 0,
      pulse_speed_start: mode === 'pulse_chase' ? 0 : 0,
      pulse_speed_end: mode === 'pulse_chase' ? 100 : 100,
      pulse_duration_ms: 0,
      end_hold_ms: 0,
      end_behavior: 'off'
    });
    return {
      ...effect,
      effect_ui: {
        tracks: [track]
      }
    };
  }

  function effectDefinitionById(id) {
    const presetId = String(id || '');
    const localMatch = effectPresetById(presetId) || effectTemplateById(presetId);
    if (localMatch) return localMatch;
    const controllerMatch = controllerEffects().find((item) => String(item.id) === presetId);
    if (controllerMatch) return synthesizePreviewEffectDefinition(controllerMatch);
    const builtinMatch = builtinEffectCatalog.find((item) => String(item.id) === presetId);
    if (builtinMatch) return synthesizePreviewEffectDefinition(builtinMatch);
    return null;
  }

  function effectChoiceList() {
    const seen = new Set();
    const merged = [
      ...(state.localState?.effect_templates || buildDefaultEffectTemplates()),
      ...controllerEffects(),
      ...(state.localState?.effect_presets || [])
    ];
    return merged
      .filter((item) => item && item.kind !== 'utility')
      .filter((item) => {
        const id = String(item.id || '').trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }

  function effectChoiceOptions(selectedId) {
    const current = String(selectedId || '');
    return effectChoiceList().map((preset) => `<option value="${escapeHtml(preset.id)}" title="${escapeHtml(preset.note || '')}" ${current === String(preset.id) ? 'selected' : ''}>${escapeHtml(preset.name)}</option>`).join('');
  }

  function roomEffectRuleKey(sourceGroupId, targetGroupId) {
    return `${normalizeNumber(sourceGroupId, -1)}:${normalizeNumber(targetGroupId, -1)}`;
  }

  function roomEffectDefaultIds(room = {}) {
    const idle = String(room?.idle_effect_id || 'builtin-silent');
    const trigger = String(room?.trigger_effect_id || idle || 'builtin-silent');
    return {
      source_idle_effect_id: idle || 'builtin-silent',
      source_trigger_effect_id: trigger || 'builtin-silent',
      target_idle_effect_id: 'builtin-silent',
      target_trigger_effect_id: trigger || 'builtin-silent'
    };
  }

  function normalizeRoomEffectRule(rule, room = {}) {
    if (!rule || typeof rule !== 'object') return null;
    const sourceId = normalizeNumber(rule.source_group_id, -1);
    const targetId = normalizeNumber(rule.target_group_id, -1);
    if (sourceId < 0 || targetId < 0) return null;
    const defaults = roomEffectDefaultIds(room);
    return {
      source_group_id: sourceId,
      target_group_id: targetId,
      source_idle_effect_id: String(rule.source_idle_effect_id || defaults.source_idle_effect_id),
      source_trigger_effect_id: String(rule.source_trigger_effect_id || defaults.source_trigger_effect_id),
      target_idle_effect_id: String(rule.target_idle_effect_id || defaults.target_idle_effect_id),
      target_trigger_effect_id: String(rule.target_trigger_effect_id || defaults.target_trigger_effect_id)
    };
  }

  function syncRoomEffectRules(room, sourceRules = null) {
    if (!room || typeof room !== 'object') return [];
    const sourceIds = Array.isArray(room.source_group_ids)
      ? room.source_group_ids.map((id) => normalizeNumber(id, -1)).filter((id) => id >= 0)
      : [];
    const targetIds = Array.isArray(room.target_group_ids)
      ? room.target_group_ids.map((id) => normalizeNumber(id, -1)).filter((id) => id >= 0)
      : [];
    const existingRules = Array.isArray(sourceRules) ? sourceRules : Array.isArray(room.effect_rules) ? room.effect_rules : [];
    const existing = new Map();
    for (const item of existingRules) {
      const normalized = normalizeRoomEffectRule(item, room);
      if (normalized) existing.set(roomEffectRuleKey(normalized.source_group_id, normalized.target_group_id), normalized);
    }
    const defaults = roomEffectDefaultIds(room);
    const next = [];
    for (const targetId of targetIds) {
      for (const sourceId of sourceIds) {
        const key = roomEffectRuleKey(sourceId, targetId);
        const prev = existing.get(key) || {};
        next.push({
          source_group_id: sourceId,
          target_group_id: targetId,
          source_idle_effect_id: String(prev.source_idle_effect_id || defaults.source_idle_effect_id),
          source_trigger_effect_id: String(prev.source_trigger_effect_id || defaults.source_trigger_effect_id),
          target_idle_effect_id: String(prev.target_idle_effect_id || defaults.target_idle_effect_id),
          target_trigger_effect_id: String(prev.target_trigger_effect_id || defaults.target_trigger_effect_id)
        });
      }
    }
    room.effect_rules = next;
    return next;
  }

  function roomEffectRuleByPair(room, sourceGroupId, targetGroupId) {
    const key = roomEffectRuleKey(sourceGroupId, targetGroupId);
    return (Array.isArray(room?.effect_rules) ? room.effect_rules : []).find((item) => roomEffectRuleKey(item.source_group_id, item.target_group_id) === key) || null;
  }

  function applyTemplateDefaultsToRoom(room, template, { overwrite = false } = {}) {
    if (!room || !template) return room;
    room.template_id = template.id || room.template_id || builtinTemplates[0].id;
    room.template_name = template.name || room.template_name || builtinTemplates[0].name;
    room.play_preset_id = String(template.play_preset_id || template.id || room.play_preset_id || '');
    room.feature_preset_id = String(template.feature_preset_id || room.feature_preset_id || '');
    room.effect_preset_id = String(template.effect_preset_id || room.effect_preset_id || '');
    const featurePreset = featurePresetById(room.feature_preset_id);
    const effectPreset = effectPresetById(room.effect_preset_id);
    const featureUi = featurePreset?.feature_ui || {};
    if (overwrite || !String(room.sense_mode || '').trim()) {
      room.sense_mode = String(template.sense_mode || featureUi.sense_mode || '');
    }
    if (overwrite || !String(room.idle_effect_id || '').trim()) {
      room.idle_effect_id = String(template.idle_effect_id || featureUi.idle_effect_id || '');
    }
    if (overwrite || !String(room.trigger_effect_id || '').trim()) {
      room.trigger_effect_id = String(template.trigger_effect_id || featureUi.trigger_effect_id || '');
    }
    if (overwrite || normalizeNumber(room.trigger_signal_rssi, NaN) !== normalizeNumber(room.trigger_signal_rssi, NaN) || !String(room.trigger_signal_rssi ?? '').trim()) {
      room.trigger_signal_rssi = normalizeNumber(featureUi?.signal_ui?.trigger_rssi_threshold, DEFAULT_TRIGGER_RSSI);
    }
    if (overwrite || !String(room.trigger_compare || '').trim()) {
      room.trigger_compare = triggerCompareValue(featureUi?.signal_ui?.trigger_compare);
    }
    if (overwrite || normalizeNumber(room.trigger_hold_ms, NaN) !== normalizeNumber(room.trigger_hold_ms, NaN) || !String(room.trigger_hold_ms ?? '').trim()) {
      room.trigger_hold_ms = normalizeNumber(featureUi?.signal_ui?.trigger_hold_ms, DEFAULT_TRIGGER_HOLD_MS);
    }
    if (overwrite || !(room.scoring && typeof room.scoring === 'object' && Object.keys(room.scoring).length)) {
      room.scoring = template.scoring && typeof template.scoring === 'object'
        ? clone(template.scoring)
        : featureUi.scoring && typeof featureUi.scoring === 'object'
          ? clone(featureUi.scoring)
          : {};
    }
    if (overwrite || !(room.timer && typeof room.timer === 'object' && Object.keys(room.timer).length)) {
      room.timer = featureUi.timer && typeof featureUi.timer === 'object' ? clone(featureUi.timer) : {};
    }
    if (overwrite || !String(room.preview_effect_id || '').trim()) {
      room.preview_effect_id = String(effectPreset?.id || room.preview_effect_id || '');
    }
    syncRoomEffectRules(room);
    return room;
  }

  function normalizeRoomDraft(raw, fallbackTemplate = null) {
    if (!raw || typeof raw !== 'object') return null;
    const templateId = String(raw.template_id || fallbackTemplate?.id || builtinTemplates[0].id || '');
    const templateName = String(raw.template_name || fallbackTemplate?.name || '');
    const preset = playPresetById(raw.play_preset_id || raw.feature_preset_id || fallbackTemplate?.play_preset_id || fallbackTemplate?.feature_preset_id || fallbackTemplate?.id || '') || normalizePlayPreset(buildDefaultPlayPresets()[0]);
    const signalDefaults = clone(preset?.signal || {});
    const triggerDefaults = clone(preset?.trigger || {});
    const scoreDefaults = clone(preset?.score || {});
    const repeatDefaults = clone(preset?.repeat || {});
    const afterDefaults = clone(preset?.afterTrigger || {});
    const feedbackDefaults = clone(preset?.feedback || {});
    const rawOverrides = raw.rule_overrides && typeof raw.rule_overrides === 'object' ? raw.rule_overrides : {};
    const rawSignal = rawOverrides.signal && typeof rawOverrides.signal === 'object' ? rawOverrides.signal : {};
    const rawTrigger = rawOverrides.trigger && typeof rawOverrides.trigger === 'object' ? rawOverrides.trigger : {};
    const rawScore = rawOverrides.score && typeof rawOverrides.score === 'object' ? rawOverrides.score : {};
    const rawRepeat = rawOverrides.repeat && typeof rawOverrides.repeat === 'object' ? rawOverrides.repeat : {};
    const rawAfter = rawOverrides.afterTrigger && typeof rawOverrides.afterTrigger === 'object' ? rawOverrides.afterTrigger : {};
    const rawFeedback = rawOverrides.feedback && typeof rawOverrides.feedback === 'object' ? rawOverrides.feedback : {};
    const rawMeter = rawFeedback.signalMeter && typeof rawFeedback.signalMeter === 'object' ? rawFeedback.signalMeter : {};
    const defaultMeter = feedbackDefaults.signalMeter && typeof feedbackDefaults.signalMeter === 'object' ? feedbackDefaults.signalMeter : {};
    const hasRawMeterEnabled = Object.prototype.hasOwnProperty.call(rawMeter, 'enabled');
    const sourceGroupIds = Array.isArray(raw.source_group_ids)
      ? raw.source_group_ids
      : Array.isArray(raw.group_ids)
        ? raw.group_ids
        : [];
    const targetGroupIds = Array.isArray(raw.target_group_ids) ? raw.target_group_ids : [];
    const combined = Array.isArray(raw.group_ids)
      ? raw.group_ids
      : Array.from(new Set([...sourceGroupIds, ...targetGroupIds]));
    const room = {
      id: String(raw.id || uid('room')),
      name: String(raw.name || ''),
      template_id: templateId,
      template_name: templateName,
      status: String(raw.status || 'draft'),
      started_at: String(raw.started_at || ''),
      ended_at: String(raw.ended_at || ''),
      published_at: String(raw.published_at || ''),
      publish_result: raw.publish_result && typeof raw.publish_result === 'object' ? clone(raw.publish_result) : null,
      created_at: String(raw.created_at || nowIso()),
      updated_at: String(raw.updated_at || nowIso()),
      feature_preset_id: String(raw.feature_preset_id || fallbackTemplate?.feature_preset_id || ''),
      play_preset_id: String(raw.play_preset_id || fallbackTemplate?.play_preset_id || raw.feature_preset_id || fallbackTemplate?.feature_preset_id || ''),
      effect_preset_id: String(raw.effect_preset_id || fallbackTemplate?.effect_preset_id || ''),
      sense_mode: String(raw.sense_mode || fallbackTemplate?.sense_mode || ''),
      idle_effect_id: String(raw.idle_effect_id || fallbackTemplate?.idle_effect_id || ''),
      trigger_effect_id: String(raw.trigger_effect_id || fallbackTemplate?.trigger_effect_id || ''),
      trigger_compare: 'gte',
      trigger_signal_rssi: DEFAULT_TRIGGER_RSSI,
      trigger_hold_ms: DEFAULT_TRIGGER_HOLD_MS,
      rule_signal_type: String(raw.rule_signal_type || ''),
      rule_rssi_min: raw.rule_rssi_min === null || raw.rule_rssi_min === undefined || raw.rule_rssi_min === '' ? null : normalizeNumber(raw.rule_rssi_min, DEFAULT_TRIGGER_RSSI),
      rule_rssi_max: raw.rule_rssi_max === null || raw.rule_rssi_max === undefined || raw.rule_rssi_max === '' ? null : normalizeNumber(raw.rule_rssi_max, -20),
      rule_hold_ms: raw.rule_hold_ms === null || raw.rule_hold_ms === undefined || raw.rule_hold_ms === '' ? null : normalizeNumber(raw.rule_hold_ms, DEFAULT_TRIGGER_HOLD_MS),
      rule_overrides: {
        signal: {
          type: String(rawSignal.type || raw.rule_signal_type || signalDefaults.type || 'enter_range'),
          rssiMin: normalizeNumber(rawSignal.rssiMin ?? raw.rule_rssi_min ?? raw.trigger_signal_rssi, normalizeNumber(signalDefaults.rssiMin, DEFAULT_TRIGGER_RSSI)),
          rssiMax: rawSignal.rssiMax === null || rawSignal.rssiMax === undefined
            ? (raw.rule_rssi_max === null || raw.rule_rssi_max === undefined || raw.rule_rssi_max === '' ? (signalDefaults.rssiMax ?? null) : normalizeNumber(raw.rule_rssi_max, -20))
            : (rawSignal.rssiMax === '' ? null : normalizeNumber(rawSignal.rssiMax, -20)),
          holdMs: normalizeNumber(rawSignal.holdMs ?? raw.rule_hold_ms ?? raw.trigger_hold_ms, normalizeNumber(signalDefaults.holdMs, DEFAULT_TRIGGER_HOLD_MS)),
          missingMs: normalizeNumber(rawSignal.missingMs, normalizeNumber(signalDefaults.missingMs, 3000)),
          smoothSamples: clamp(normalizeNumber(rawSignal.smoothSamples, normalizeNumber(signalDefaults.smoothSamples, 5)), 1, 10)
        },
        trigger: {
          mode: String(rawTrigger.mode || triggerDefaults.mode || 'instant'),
          targetMs: normalizeNumber(rawTrigger.targetMs, normalizeNumber(triggerDefaults.targetMs, 0)),
          targetCount: normalizeNumber(rawTrigger.targetCount, normalizeNumber(triggerDefaults.targetCount, 1)),
          periodMs: normalizeNumber(rawTrigger.periodMs, normalizeNumber(triggerDefaults.periodMs, 0))
        },
        score: {
          target: String(rawScore.target || scoreDefaults.target || 'source_player'),
          points: normalizeNumber(rawScore.points, normalizeNumber(scoreDefaults.points, 1)),
          type: String(rawScore.type || scoreDefaults.type || 'add')
        },
        repeat: {
          mode: String(rawRepeat.mode || repeatDefaults.mode || 'once_per_pair'),
          cooldownMs: normalizeNumber(rawRepeat.cooldownMs, normalizeNumber(repeatDefaults.cooldownMs, 5000))
        },
        afterTrigger: {
          targetState: String(rawAfter.targetState || afterDefaults.targetState || 'none'),
          timerAction: String(rawAfter.timerAction || afterDefaults.timerAction || 'none')
        },
        feedback: {
          signalMeter: {
            enabled: hasRawMeterEnabled ? rawMeter.enabled === true : defaultMeter.enabled === true,
            port: clamp(normalizeNumber(rawMeter.port, normalizeNumber(defaultMeter.port, 1)), 1, 3),
            ledCount: clamp(normalizeNumber(rawMeter.ledCount, normalizeNumber(defaultMeter.ledCount, 10)), 1, 200),
            weakRssi: normalizeNumber(rawMeter.weakRssi, normalizeNumber(defaultMeter.weakRssi, -90)),
            strongRssi: normalizeNumber(rawMeter.strongRssi, normalizeNumber(defaultMeter.strongRssi, normalizeNumber(signalDefaults.rssiMin, DEFAULT_TRIGGER_RSSI))),
            compressionX100: clamp(normalizeNumber(rawMeter.compressionX100 ?? rawMeter.compression_x100, normalizeNumber(defaultMeter.compressionX100, 100)), 20, 500)
          }
        }
      },
      match_bindings: Array.isArray(raw.match_bindings)
        ? raw.match_bindings.map((item) => ({
            source_mac: String(item?.source_mac || '').trim().toUpperCase(),
            target_mac: String(item?.target_mac || '').trim().toUpperCase(),
            source_group_id: normalizeNumber(item?.source_group_id, -1),
            target_group_id: normalizeNumber(item?.target_group_id, -1)
          })).filter((item) => item.source_mac && item.target_mac)
        : [],
      preview_effect_id: String(raw.preview_effect_id || fallbackTemplate?.effect_preset_id || ''),
      timer: raw.timer && typeof raw.timer === 'object'
        ? clone(raw.timer)
        : (fallbackTemplate?.feature_preset_id ? clone(featurePresetById(fallbackTemplate.feature_preset_id)?.feature_ui?.timer || {}) : {}),
      scoring: raw.scoring && typeof raw.scoring === 'object'
        ? clone(raw.scoring)
        : fallbackTemplate?.scoring && typeof fallbackTemplate.scoring === 'object'
          ? clone(fallbackTemplate.scoring)
          : {},
      source_group_ids: sourceGroupIds
        .map((v) => normalizeNumber(v, -1))
        .filter((v) => v >= 0),
      target_group_ids: targetGroupIds
        .map((v) => normalizeNumber(v, -1))
        .filter((v) => v >= 0),
      group_ids: combined
        .map((v) => normalizeNumber(v, -1))
        .filter((v) => v >= 0),
      effect_rules: [],
      notes: String(raw.notes || ''),
      summary: raw.summary && typeof raw.summary === 'object' ? clone(raw.summary) : {}
    };
    const roomSignal = room.rule_overrides.signal || {};
    room.rule_signal_type = String(roomSignal.type || 'enter_range');
    room.rule_rssi_min = normalizeNumber(roomSignal.rssiMin, DEFAULT_TRIGGER_RSSI);
    room.rule_rssi_max = roomSignal.rssiMax === null || roomSignal.rssiMax === undefined || roomSignal.rssiMax === '' ? null : normalizeNumber(roomSignal.rssiMax, -20);
    room.rule_hold_ms = normalizeNumber(roomSignal.holdMs, DEFAULT_TRIGGER_HOLD_MS);
    room.trigger_signal_rssi = room.rule_rssi_min;
    room.trigger_hold_ms = room.rule_hold_ms;
    room.trigger_compare = room.rule_signal_type === 'leave_range' || room.rule_signal_type === 'weaker' ? 'lte' : (room.rule_rssi_max !== null ? 'range' : 'gte');
    syncRoomEffectRules(room, raw.effect_rules);
    return room;
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
    const source = Array.isArray(raw) ? raw : builtinEffectCatalog;
    return source.map((item) => ({
      id: String(item?.id || ''),
      name: String(item?.name || '未命名'),
      note: String(item?.note || ''),
      builtIn: item?.builtIn === true,
      effect_ui: normalizeEffectUI(item?.effect_ui || item, null),
      updated_at: String(item?.updated_at || nowIso())
    })).filter((item) => item.id);
  }

  function migrateLegacyEffectReferences(localState) {
    if (!localState || typeof localState !== 'object') return localState;
    const safeEffectId = (localState.effect_presets || []).find((item) => item && item.id)?.id
      || (localState.effect_templates || []).find((item) => item && item.id)?.id
      || 'builtin-breath';
    const safeIdleId = 'builtin-silent';
    const replace = (value, fallback = safeEffectId) => {
      const id = String(value || '').trim();
      if (!id || id === 'builtin-selftest' || id === 'selftest') return fallback;
      return id;
    };
    for (const template of localState.templates || []) {
      template.effect_preset_id = replace(template.effect_preset_id, safeEffectId);
      template.preview_effect_id = replace(template.preview_effect_id, safeEffectId);
      template.trigger_effect_id = replace(template.trigger_effect_id, safeEffectId);
      template.idle_effect_id = replace(template.idle_effect_id, safeIdleId);
    }
    for (const room of localState.rooms || []) {
      room.effect_preset_id = replace(room.effect_preset_id, safeEffectId);
      room.preview_effect_id = replace(room.preview_effect_id, safeEffectId);
      room.trigger_effect_id = replace(room.trigger_effect_id, safeEffectId);
      room.idle_effect_id = replace(room.idle_effect_id, safeIdleId);
      for (const rule of room.effect_rules || []) {
        rule.source_idle_effect_id = replace(rule.source_idle_effect_id, safeIdleId);
        rule.source_trigger_effect_id = replace(rule.source_trigger_effect_id, safeEffectId);
        rule.target_idle_effect_id = replace(rule.target_idle_effect_id, safeIdleId);
        rule.target_trigger_effect_id = replace(rule.target_trigger_effect_id, safeEffectId);
      }
    }
    if (localState.current_room && typeof localState.current_room === 'object') {
      localState.current_room.effect_preset_id = replace(localState.current_room.effect_preset_id, safeEffectId);
      localState.current_room.preview_effect_id = replace(localState.current_room.preview_effect_id, safeEffectId);
      localState.current_room.trigger_effect_id = replace(localState.current_room.trigger_effect_id, safeEffectId);
      localState.current_room.idle_effect_id = replace(localState.current_room.idle_effect_id, safeIdleId);
      for (const rule of localState.current_room.effect_rules || []) {
        rule.source_idle_effect_id = replace(rule.source_idle_effect_id, safeIdleId);
        rule.source_trigger_effect_id = replace(rule.source_trigger_effect_id, safeEffectId);
        rule.target_idle_effect_id = replace(rule.target_idle_effect_id, safeIdleId);
        rule.target_trigger_effect_id = replace(rule.target_trigger_effect_id, safeEffectId);
      }
    }
    if (localState.ui) {
      if (Array.isArray(localState.effect_presets) && localState.effect_presets.length) {
        if (!localState.effect_presets.some((item) => String(item.id) === String(localState.ui.selected_effect_preset_id))) {
          localState.ui.selected_effect_preset_id = safeEffectId;
        }
      } else {
        localState.ui.selected_effect_preset_id = '';
      }
    }
    return localState;
  }

  function normalizeTemplates(raw) {
    const source = Array.isArray(raw) ? raw : [];
    const byId = new Map();
    for (const tpl of builtinTemplates) {
      byId.set(tpl.id, {
        id: tpl.id,
        name: tpl.name,
        note: tpl.note,
        builtIn: true,
        ...templateMetaFromSource(tpl),
        created_at: nowIso(),
        updated_at: nowIso(),
        config: null
      });
    }
    for (const item of source) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '').trim() || uid('tpl');
      const base = byId.get(id) || null;
      const meta = templateMetaFromSource(item);
      byId.set(id, {
        id,
        name: String(item.name || base?.name || '未命名模板'),
        note: String(item.note || base?.note || ''),
        builtIn: base?.builtIn === true ? true : item.builtIn === true,
        feature_preset_id: meta.feature_preset_id || base?.feature_preset_id || '',
        effect_preset_id: meta.effect_preset_id || base?.effect_preset_id || '',
        source_group_mode: roleModeValue(meta.source_group_mode || base?.source_group_mode || 'single'),
        target_group_mode: roleModeValue(meta.target_group_mode || base?.target_group_mode || 'single'),
        default_source_group_ids: [],
        default_target_group_ids: [],
        sense_mode: meta.sense_mode || base?.sense_mode || '',
        idle_effect_id: meta.idle_effect_id || base?.idle_effect_id || '',
        trigger_effect_id: meta.trigger_effect_id || base?.trigger_effect_id || '',
        scoring: meta.scoring && Object.keys(meta.scoring).length ? meta.scoring : (base?.scoring || {}),
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
    const seed = Array.isArray(existing) && existing.length ? existing : buildDefaultGroups();
    const byId = new Map();
    for (const item of seed) {
      if (!item || typeof item !== 'object') continue;
      const id = normalizeNumber(item.id, -1);
      if (id < 0) continue;
      byId.set(id, clone(item));
    }
    if (Array.isArray(raw)) {
      for (const g of raw) {
        if (!g || typeof g !== 'object') continue;
        const id = normalizeNumber(g.id, -1);
        if (id < 0) continue;
        const prev = byId.get(id) || emptyGroup(id);
        byId.set(id, {
          ...prev,
          id,
          valid: g.valid === true || Number(g.valid) === 1,
          name: String(g.name || `分组${id + 1}`),
          note: String(g.note || ''),
          target: 255,
          mode: normalizeNumber(g.mode, 1),
          sense_mode: String(g.sense_mode || prev.sense_mode || 'ring'),
          rssi: normalizeNumber(g.rssi, -70),
          hold: normalizeNumber(g.hold, 2000),
          peer_mask: normalizeNumber(g.peer_mask ?? prev.peer_mask, 0),
          room_hash: normalizeNumber(g.room_hash ?? prev.room_hash, 0),
          rule_id: normalizeNumber(g.rule_id ?? prev.rule_id, 1),
          rule_base: normalizeNumber(g.rule_base ?? prev.rule_base, 1),
          rule_judge: normalizeNumber(g.rule_judge ?? prev.rule_judge, 1),
          rule_signal: normalizeNumber(g.rule_signal ?? prev.rule_signal, 1),
          rule_rssi_min: normalizeNumber(g.rule_rssi_min ?? prev.rule_rssi_min, normalizeNumber(g.rssi, -70)),
          rule_rssi_max: normalizeNumber(g.rule_rssi_max ?? prev.rule_rssi_max, -127),
          rule_missing_ms: normalizeNumber(g.rule_missing_ms ?? prev.rule_missing_ms, 3000),
          rule_smooth_samples: normalizeNumber(g.rule_smooth_samples ?? prev.rule_smooth_samples, 5),
          rule_trigger: normalizeNumber(g.rule_trigger ?? prev.rule_trigger, 1),
          rule_target_ms: normalizeNumber(g.rule_target_ms ?? prev.rule_target_ms, 0),
          rule_target_count: normalizeNumber(g.rule_target_count ?? prev.rule_target_count, 1),
          rule_period_ms: normalizeNumber(g.rule_period_ms ?? prev.rule_period_ms, 0),
          rule_score_target: normalizeNumber(g.rule_score_target ?? prev.rule_score_target, 1),
          rule_points: normalizeNumber(g.rule_points ?? prev.rule_points, 1),
          rule_repeat: normalizeNumber(g.rule_repeat ?? prev.rule_repeat, 2),
          rule_cooldown_ms: normalizeNumber(g.rule_cooldown_ms ?? prev.rule_cooldown_ms, 5000),
          rule_after: normalizeNumber(g.rule_after ?? prev.rule_after, 0),
          meter_enabled: normalizeNumber(g.meter_enabled ?? prev.meter_enabled, 0),
          meter_port: clamp(normalizeNumber(g.meter_port ?? prev.meter_port, 1), 1, 3),
          meter_led_count: clamp(normalizeNumber(g.meter_led_count ?? prev.meter_led_count, 10), 1, 200),
          meter_weak_rssi: normalizeNumber(g.meter_weak_rssi ?? prev.meter_weak_rssi, -90),
          meter_strong_rssi: normalizeNumber(g.meter_strong_rssi ?? prev.meter_strong_rssi, normalizeNumber(g.rule_rssi_min, -35)),
          meter_compression_x100: clamp(normalizeNumber(g.meter_compression_x100 ?? prev.meter_compression_x100, 100), 20, 500),
          template: String(g.template || ''),
          effect_template_id: String(g.effect_template_id || prev.effect_template_id || ''),
          effect: String(g.effect || prev.effect || 'builtin-breath'),
          effect_ui: g.effect_ui && typeof g.effect_ui === 'object' ? clone(g.effect_ui) : clone(prev.effect_ui || {}),
          idle_effect: String(g.idle_effect || prev.idle_effect || 'builtin-silent'),
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
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) => normalizeNumber(a?.id, 0) - normalizeNumber(b?.id, 0));
  }

  function normalizeControllerState(raw, existing = null) {
    const fallback = buildDefaultControllerState();
    const schemaVersion = clamp(normalizeNumber(raw?.schema_version ?? raw?.schema ?? existing?.schema_version ?? fallback.schema_version, 3), 1, 3);
    const out = {
      schema_version: schemaVersion,
      devices: clone(fallback.devices),
      groups: clone(fallback.groups),
      records: [],
      runtime: { running: false, started_ms: 0, events: [], receiver_stats: [] },
      rules: [],
      presets: clone(fallback.presets),
      effects: clone(fallback.effects),
        active_preset: fallback.active_preset
      };

    if (existing && Array.isArray(existing.devices)) out.devices = clone(existing.devices);
    if (existing && Array.isArray(existing.groups)) out.groups = clone(existing.groups);
    if (existing && Array.isArray(existing.records)) out.records = clone(existing.records);
    if (existing && existing.runtime && typeof existing.runtime === 'object') out.runtime = clone(existing.runtime);
    if (existing && Array.isArray(existing.rules)) out.rules = clone(existing.rules);
    if (existing && Array.isArray(existing.presets)) out.presets = clone(existing.presets);
    if (existing && Array.isArray(existing.effects)) out.effects = clone(existing.effects);
    if (existing && existing.active_preset) out.active_preset = String(existing.active_preset);

    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.devices)) {
        const incomingDevices = raw.devices.map((d, idx) => ({
          idx: normalizeNumber(d?.idx, idx),
          mac: String(d?.mac || '').trim(),
          name: normalizeDeviceName(d?.name, idx, d?.mac),
          group_mask: normalizeNumber(d?.group_mask, 0) >>> 0,
          rssi: normalizeNumber(d?.rssi, 0),
          seen_ms: Math.max(0, normalizeNumber(d?.seen_ms, 0)),
          release_version: String(d?.release_version || '').trim(),
          firmware_version: String(d?.firmware_version || d?.fw_version || '').trim()
        }));
        out.devices = mergeDeviceSnapshots(incomingDevices, out.devices);
      }
      if (Array.isArray(raw.groups)) {
        out.groups = normalizeGroups(raw.groups, out.groups);
      }
      if (Array.isArray(raw.records)) out.records = normalizeRecords(raw.records);
      if (raw.runtime && typeof raw.runtime === 'object') {
        out.runtime = {
          running: raw.runtime.running === true,
          started_ms: normalizeNumber(raw.runtime.started_ms, 0),
          events: Array.isArray(raw.runtime.events) ? raw.runtime.events.map((event) => ({
            room: normalizeNumber(event?.room, 0),
            self_idx: normalizeNumber(event?.self_idx, -1),
            peer_idx: normalizeNumber(event?.peer_idx, -1),
            self_mac: String(event?.self_mac || '').trim(),
            peer_mac: String(event?.peer_mac || '').trim(),
            self_group_mask: normalizeNumber(event?.self_group_mask, 0) >>> 0,
            peer_group_mask: normalizeNumber(event?.peer_group_mask, 0) >>> 0,
            rssi: normalizeNumber(event?.rssi, 0),
            kind: normalizeNumber(event?.kind, 1),
            points: normalizeNumber(event?.points, 1),
            seq: normalizeNumber(event?.seq, 0),
            event_ms: normalizeNumber(event?.event_ms, 0)
          })).filter((event) => event.self_mac || event.peer_mac) : [],
          receiver_stats: Array.isArray(raw.runtime.receiver_stats) ? raw.runtime.receiver_stats.map((stat) => ({
            room: normalizeNumber(stat?.room, 0),
            self_mac: String(stat?.self_mac || '').trim(),
            seen_count: normalizeNumber(stat?.seen_count, 0),
            found_count: normalizeNumber(stat?.found_count, 0),
            best_peer: String(stat?.best_peer || '').trim(),
            best_rssi: normalizeNumber(stat?.best_rssi, -127),
            active_ms: normalizeNumber(stat?.active_ms, 0),
            seq: normalizeNumber(stat?.seq, 0),
            seen_ms: normalizeNumber(stat?.seen_ms, 0)
          })).filter((stat) => stat.self_mac) : []
        };
      }
      if (Array.isArray(raw.rules)) out.rules = raw.rules.map((r, i) => ({ id: normalizeNumber(r?.id, i), ...clone(r) }));
      if (Array.isArray(raw.presets)) out.presets = normalizeTemplates(raw.presets);
      if (Array.isArray(raw.effects)) out.effects = normalizeEffectEffects(raw.effects);
      if (raw.active_preset !== undefined) out.active_preset = String(raw.active_preset || '自定义');
    }
    out.groups = normalizeGroups(out.groups, out.groups);
    return out;
  }

  function normalizeLocalState(raw) {
    const fallback = buildDefaultLocalState();
    if (!raw || typeof raw !== 'object') return clone(fallback);
    const out = clone(fallback);
    const rawSchema = normalizeNumber(raw.schema, 1);
    const resetGameplay = rawSchema < LOCAL_SCHEMA_VERSION || normalizeNumber(raw.gameplay_reset_version, 0) < LOCAL_SCHEMA_VERSION;
    out.schema = LOCAL_SCHEMA_VERSION;
    out.gameplay_reset_version = LOCAL_SCHEMA_VERSION;
    out.updated_at = String(raw.updated_at || nowIso());
    out.rssi_defaults_version = normalizeNumber(raw.rssi_defaults_version, 1);
    out.device_drafts = raw.device_drafts && typeof raw.device_drafts === 'object' ? clone(raw.device_drafts) : {};
    out.controller_groups = normalizeGroups(raw.controller_groups || raw.groups || fallback.controller_groups, fallback.controller_groups);
    out.hidden_devices = Array.isArray(raw.hidden_devices) ? raw.hidden_devices.map((item) => String(item || '').trim()).filter(Boolean) : [];
    if (resetGameplay) {
      out.system_play_presets = buildDefaultPlayPresets().map((item) => normalizePlayPreset(item));
      out.user_play_presets = [];
    } else {
      const legacyCombined = Array.isArray(raw.play_presets)
        ? raw.play_presets
        : (Array.isArray(raw.feature_presets) ? raw.feature_presets : []);
      const builtInIds = builtInPlayPresetIds();
      const legacyUser = legacyCombined.filter((item) => {
        const id = String(item?.id || '');
        return item && typeof item === 'object' && !builtInIds.has(id);
      });
      out.system_play_presets = buildDefaultPlayPresets().map((item) => normalizePlayPreset(item));
      out.user_play_presets = normalizeUserPlayPresets(raw.user_play_presets || legacyUser);
    }
    rebuildPresetDerivedState(out);
    out.effect_templates = normalizeEffectTemplates(raw.effect_templates || fallback.effect_templates);
    out.effect_presets = normalizeEffectPresets(raw.effect_presets || fallback.effect_presets);
    const templateForRoom = (roomRaw) => out.templates.find((tpl) => tpl.id === roomRaw?.template_id) || out.templates.find((tpl) => tpl.id === raw?.ui?.selected_template_id) || out.templates[0] || null;
    const roomMap = new Map();
    if (!resetGameplay && Array.isArray(raw.rooms)) {
      for (const item of raw.rooms) {
        const room = normalizeRoomDraft(item, templateForRoom(item));
        if (room) roomMap.set(room.id, room);
      }
    }
    if (!resetGameplay && raw.current_room) {
      const current = normalizeRoomDraft(raw.current_room, templateForRoom(raw.current_room));
      if (current && !roomMap.has(current.id)) roomMap.set(current.id, current);
    }
    out.rooms = Array.from(roomMap.values());
    out.active_room_id = String(raw.active_room_id || raw?.ui?.active_room_id || raw?.current_room?.id || out.rooms[0]?.id || '');
    out.current_room = out.rooms.find((room) => room.id === out.active_room_id) ? clone(out.rooms.find((room) => room.id === out.active_room_id)) : (out.rooms[0] ? clone(out.rooms[0]) : null);
    out.room_history = resetGameplay ? [] : (Array.isArray(raw.room_history) ? raw.room_history.map((item) => clone(item)) : []);
    out.ui = {
      active_tab: String(raw?.ui?.active_tab || fallback.ui.active_tab || 'overview'),
      show_unassigned: raw?.ui?.show_unassigned !== false,
      device_filter_mode: String(raw?.ui?.device_filter_mode || fallback.ui.device_filter_mode || 'ungrouped'),
      device_filter_group_id: normalizeNumber(raw?.ui?.device_filter_group_id, -1),
      room_sort_order: String(raw?.ui?.room_sort_order || fallback.ui.room_sort_order || 'desc') === 'asc' ? 'asc' : 'desc',
      show_offline_devices: raw?.ui?.show_offline_devices === true,
      device_preview_collapsed: raw?.ui?.device_preview_collapsed === true,
      preview_cell_shape: String(raw?.ui?.preview_cell_shape || fallback.ui.preview_cell_shape || 'square') === 'circle' ? 'circle' : 'square',
      selected_group_id: normalizeNumber(raw?.ui?.selected_group_id, fallback.ui.selected_group_id ?? 0),
      expanded_group_id: normalizeNumber(raw?.ui?.expanded_group_id, fallback.ui.expanded_group_id ?? -1),
      selected_template_id: String(resetGameplay ? allPlayPresets(out)[0]?.id : (raw?.ui?.selected_template_id || out.current_room?.template_id || fallback.ui.selected_template_id || allPlayPresets(out)[0]?.id)),
      selected_feature_preset_id: String(resetGameplay ? allPlayPresets(out)[0]?.id : (raw?.ui?.selected_feature_preset_id || raw?.ui?.selected_play_preset_id || fallback.ui.selected_feature_preset_id || allPlayPresets(out)[0]?.id)),
      selected_play_preset_id: String(resetGameplay ? allPlayPresets(out)[0]?.id : (raw?.ui?.selected_play_preset_id || raw?.ui?.selected_feature_preset_id || fallback.ui.selected_play_preset_id || allPlayPresets(out)[0]?.id)),
      selected_effect_preset_id: String(raw?.ui?.selected_effect_preset_id || fallback.ui.selected_effect_preset_id || ''),
      play_preset_filter: ['all', 'user', 'system'].includes(String(raw?.ui?.play_preset_filter || '')) ? String(raw.ui.play_preset_filter) : 'all',
      play_preset_query: String(raw?.ui?.play_preset_query || ''),
      play_preset_advanced: raw?.ui?.play_preset_advanced === true,
      play_preset_list_collapsed: raw?.ui?.play_preset_list_collapsed === true,
      system_play_presets_collapsed: raw?.ui?.system_play_presets_collapsed !== false,
      wizard: {
        open: raw?.ui?.wizard?.open === true,
        step: clamp(normalizeNumber(raw?.ui?.wizard?.step, 0), 0, WIZARD_STEP_MAX),
        return_tab: String(raw?.ui?.wizard?.return_tab || fallback.ui?.wizard?.return_tab || 'overview')
      }
    };
    if (!out.ui.selected_effect_preset_id || !out.effect_presets.some((item) => String(item.id) === String(out.ui.selected_effect_preset_id))) {
      out.ui.selected_effect_preset_id = out.effect_presets[0]?.id || '';
    }
    if (!allPlayPresets(out).some((item) => String(item.id) === String(out.ui.selected_play_preset_id))) {
      out.ui.selected_play_preset_id = allPlayPresets(out)[0]?.id || '';
    }
    out.ui.selected_feature_preset_id = out.ui.selected_play_preset_id;
    out.ui.selected_template_id = out.current_room?.template_id || out.ui.selected_play_preset_id || out.templates[0]?.id || '';
    migrateRssiDefaults(out, raw);
    migrateLegacyEffectReferences(out);
    return out;
  }

  function migrateRssiDefaults(localState, raw = {}) {
    if (!localState || typeof localState !== 'object') return;
    const version = normalizeNumber(raw?.rssi_defaults_version, 1);
    if (version >= RSSI_DEFAULTS_VERSION) {
      localState.rssi_defaults_version = RSSI_DEFAULTS_VERSION;
      return;
    }
    const migrateSignal = (signalUi) => {
      if (!signalUi || typeof signalUi !== 'object') return;
      signalUi.trigger_compare = triggerCompareValue(signalUi.trigger_compare);
      if (normalizeNumber(signalUi.trigger_rssi_threshold, OLD_DEFAULT_TRIGGER_RSSI) === OLD_DEFAULT_TRIGGER_RSSI) {
        signalUi.trigger_rssi_threshold = DEFAULT_TRIGGER_RSSI;
      }
    };
    for (const preset of Array.isArray(localState.feature_presets) ? localState.feature_presets : []) {
      migrateSignal(preset?.feature_ui?.signal_ui);
    }
    const migrateRoom = (room) => {
      if (!room || typeof room !== 'object') return;
      if (normalizeNumber(room.trigger_signal_rssi, OLD_DEFAULT_TRIGGER_RSSI) === OLD_DEFAULT_TRIGGER_RSSI) {
        room.trigger_signal_rssi = DEFAULT_TRIGGER_RSSI;
      }
      room.trigger_compare = triggerCompareValue(room.trigger_compare);
    };
    for (const room of Array.isArray(localState.rooms) ? localState.rooms : []) migrateRoom(room);
    migrateRoom(localState.current_room);
    localState.rssi_defaults_version = RSSI_DEFAULTS_VERSION;
  }

  function firstFreeGroupId(usedIds = new Set()) {
    for (let id = 0; id < MAX_MCU_GROUPS; id++) {
      if (!usedIds.has(id)) return id;
    }
    return -1;
  }

  function remapGroupArray(values, idMap) {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map((id) => {
      const gid = normalizeNumber(id, -1);
      return idMap.has(gid) ? idMap.get(gid) : gid;
    }).filter((gid) => gid >= 0 && gid < MAX_MCU_GROUPS))).sort((a, b) => a - b);
  }

  function remapGroupMask(mask, idMap) {
    const source = normalizeNumber(mask, 0) >>> 0;
    let next = 0;
    for (let gid = 0; gid < 32; gid++) {
      if ((source & (1 << gid)) === 0) continue;
      const mapped = idMap.has(gid) ? idMap.get(gid) : gid;
      if (mapped >= 0 && mapped < MAX_MCU_GROUPS) next |= (1 << mapped);
    }
    return next >>> 0;
  }

  function migrateOversizedGroupIds(localState) {
    if (!localState || typeof localState !== 'object') return;
    const groups = Array.isArray(localState.controller_groups) ? localState.controller_groups : [];
    const validGroups = groups.filter((group) => group && group.valid !== false);
    const used = new Set(validGroups.map((group) => normalizeNumber(group.id, -1)).filter((id) => id >= 0 && id < MAX_MCU_GROUPS));
    const oversized = validGroups.map((group) => normalizeNumber(group.id, -1)).filter((id) => id >= MAX_MCU_GROUPS);
    if (!oversized.length) return;
    const idMap = new Map();
    for (const oldId of oversized) {
      const nextId = firstFreeGroupId(used);
      if (nextId < 0) break;
      used.add(nextId);
      idMap.set(oldId, nextId);
    }
    if (!idMap.size) return;
    localState.controller_groups = groups
      .map((group) => {
        const oldId = normalizeNumber(group?.id, -1);
        if (idMap.has(oldId)) return { ...group, id: idMap.get(oldId), updated_at: nowIso() };
        return group;
      })
      .filter((group) => normalizeNumber(group?.id, -1) >= 0 && normalizeNumber(group?.id, -1) < MAX_MCU_GROUPS);
    if (localState.device_drafts && typeof localState.device_drafts === 'object') {
      for (const draft of Object.values(localState.device_drafts)) {
        if (draft && typeof draft === 'object') draft.group_mask = remapGroupMask(draft.group_mask, idMap);
      }
    }
    for (const room of Array.isArray(localState.rooms) ? localState.rooms : []) {
      room.source_group_ids = remapGroupArray(room.source_group_ids, idMap);
      room.target_group_ids = remapGroupArray(room.target_group_ids, idMap);
      room.group_ids = remapGroupArray(room.group_ids, idMap);
      if (Array.isArray(room.effect_rules)) {
        for (const rule of room.effect_rules) {
          const source = normalizeNumber(rule?.source_group_id, -1);
          const target = normalizeNumber(rule?.target_group_id, -1);
          if (idMap.has(source)) rule.source_group_id = idMap.get(source);
          if (idMap.has(target)) rule.target_group_id = idMap.get(target);
        }
      }
      syncRoomEffectRules(room);
    }
    if (localState.current_room) {
      localState.current_room.source_group_ids = remapGroupArray(localState.current_room.source_group_ids, idMap);
      localState.current_room.target_group_ids = remapGroupArray(localState.current_room.target_group_ids, idMap);
      localState.current_room.group_ids = remapGroupArray(localState.current_room.group_ids, idMap);
    }
    if (localState.ui) {
      for (const key of ['selected_group_id', 'expanded_group_id', 'device_filter_group_id']) {
        const value = normalizeNumber(localState.ui[key], -1);
        if (idMap.has(value)) localState.ui[key] = idMap.get(value);
      }
    }
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
      effect: 'builtin-breath',
      effect_ui: {
        mode: 'breath',
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
      idle_effect: 'builtin-silent',
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
    if (!device) return '';
    const draft = state.localState?.device_drafts?.[device.mac];
    if (draft && typeof draft === 'object' && String(draft.name || '').trim()) return String(draft.name).trim();
    return String(device.name || '');
  }

  function deviceDraftNote(device) {
    if (!device) return '';
    const draft = state.localState?.device_drafts?.[device.mac];
    if (draft && typeof draft === 'object' && String(draft.note || '').trim()) return String(draft.note).trim();
    return String(device.note || '');
  }

  function deviceDraftGroupMask(device) {
    if (!device) return 0;
    const draft = state.localState?.device_drafts?.[device.mac];
    if (draft && typeof draft === 'object' && draft.group_mask !== undefined) {
      return normalizeNumber(draft.group_mask, normalizeNumber(device?.group_mask, 0)) >>> 0;
    }
    return normalizeNumber(device?.group_mask, 0) >>> 0;
  }

  function saveDeviceDraft(device, overrides = {}) {
    if (!device?.mac) return;
    if (!state.localState.device_drafts || typeof state.localState.device_drafts !== 'object') {
      state.localState.device_drafts = {};
    }
    const existing = state.localState.device_drafts[device.mac];
    const prev = existing && typeof existing === 'object' ? existing : {};
    const name = String(overrides.name ?? prev.name ?? device.name ?? '').trim();
    const note = String(overrides.note ?? prev.note ?? device.note ?? '').trim();
    const groupMask = normalizeNumber(overrides.group_mask ?? prev.group_mask ?? device.group_mask, 0) >>> 0;
    state.localState.device_drafts[device.mac] = { name, note, group_mask: groupMask };
  }

  function selectedGroupId() {
    const raw = normalizeNumber(state.localState?.ui?.selected_group_id, -1);
    if (raw >= 0) return raw;
    const first = controllerGroups()[0];
    return first ? first.id : 0;
  }

  function selectedGroup() {
    return groupById(selectedGroupId()) || controllerGroups()[0] || null;
  }

  function expandedGroupId() {
    return normalizeNumber(state.localState?.ui?.expanded_group_id, -1);
  }

  function setExpandedGroupId(groupId) {
    state.localState.ui.expanded_group_id = normalizeNumber(groupId, -1);
  }

  function syncGroupEditorDraft(group = selectedGroup()) {
    const next = group || null;
    state.editingGroupId = normalizeNumber(next?.id, -1);
    state.editingGroupName = String(next?.name || '');
    state.editingGroupNote = String(next?.note || '');
    state.editingGroupValid = next ? next.valid !== false : true;
    if (state.localState?.ui) {
      state.localState.ui.selected_group_id = state.editingGroupId >= 0 ? state.editingGroupId : 0;
    }
    return next;
  }

  function groupReferenceStats(groupId) {
    const gid = normalizeNumber(groupId, -1);
    if (gid < 0) return { devices: 0, rooms: 0, templates: 0 };
    let devices = 0;
    for (const device of visibleControllerDevices()) {
      if (normalizeNumber(device?.group_mask, 0) & (1 << gid)) devices++;
    }
    let rooms = 0;
    for (const room of roomList()) {
      const source = Array.isArray(room.source_group_ids) ? room.source_group_ids : [];
      const target = Array.isArray(room.target_group_ids) ? room.target_group_ids : [];
      if (source.includes(gid) || target.includes(gid)) rooms++;
    }
    let templates = 0;
    for (const template of state.localState?.templates || []) {
      const source = Array.isArray(template.default_source_group_ids) ? template.default_source_group_ids : [];
      const target = Array.isArray(template.default_target_group_ids) ? template.default_target_group_ids : [];
      if (source.includes(gid) || target.includes(gid)) templates++;
    }
    return { devices, rooms, templates };
  }

  function openGroupFormModal(groupOrId = null) {
    const group = typeof groupOrId === 'number'
      ? groupSlotById(groupOrId)
      : typeof groupOrId === 'string'
        ? groupSlotById(normalizeNumber(groupOrId, -1))
        : groupOrId || null;
    const editing = !!group;
    state.groupFormModal = {
      open: true,
      mode: editing ? 'edit' : 'create',
      groupId: editing ? group.id : -1,
      name: String(group?.name || ''),
      note: String(group?.note || '')
    };
    if (editing) syncGroupEditorDraft(group);
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector('[data-role="group-form-input"][data-group-form-field="name"]');
      if (input) {
        input.focus();
        input.select?.();
      }
    });
  }

  function closeGroupFormModal() {
    state.groupFormModal = null;
    render();
  }

  function openGroupDeleteModal(groupOrId) {
    const gid = typeof groupOrId === 'number'
      ? groupOrId
      : typeof groupOrId === 'string'
        ? normalizeNumber(groupOrId, -1)
        : normalizeNumber(groupOrId?.id, -1);
    const group = groupSlotById(gid);
    if (!group) return;
    state.groupDeleteModal = {
      open: true,
      groupId: gid,
      name: String(group.name || `分组${gid + 1}`),
      refs: groupReferenceStats(gid)
    };
    render();
  }

  function closeGroupDeleteModal() {
    state.groupDeleteModal = null;
    render();
  }

  function selectGroup(groupOrId) {
    const group = typeof groupOrId === 'number'
      ? groupSlotById(groupOrId)
      : typeof groupOrId === 'string'
        ? groupSlotById(normalizeNumber(groupOrId, -1))
        : groupOrId || null;
    const next = group || selectedGroup();
    syncGroupEditorDraft(next);
    return next;
  }

  function mergeDraftsIntoController(controllerState, localState) {
    const out = clone(controllerState);
    const drafts = localState?.device_drafts || {};
    if (Array.isArray(localState?.controller_groups) && localState.controller_groups.length) {
      out.groups = normalizeGroups(localState.controller_groups, out.groups || []);
    }
    out.devices = (out.devices || []).map((device) => {
      const draft = drafts[device.mac];
      const name = draft && typeof draft === 'object' && String(draft.name || '').trim();
      const note = draft && typeof draft === 'object' && String(draft.note || '').trim();
      const groupMask = draft && typeof draft === 'object' && draft.group_mask !== undefined
        ? normalizeNumber(draft.group_mask, normalizeNumber(device.group_mask, 0)) >>> 0
        : normalizeNumber(device.group_mask, 0) >>> 0;
      return {
        ...device,
        name: name || device.name,
        note: note || device.note || '',
        group_mask: groupMask
      };
    });
    const existingMacs = new Set(out.devices.map((device) => String(device?.mac || '').trim().toUpperCase()).filter(Boolean));
    Object.entries(drafts)
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .forEach(([mac, draft]) => {
        const normalizedMac = String(mac || '').trim().toUpperCase();
        if (!normalizedMac || existingMacs.has(normalizedMac)) return;
        const data = draft && typeof draft === 'object' ? draft : {};
        out.devices.push({
          idx: out.devices.length,
          mac: normalizedMac,
          name: String(data.name || normalizedMac),
          note: String(data.note || ''),
          group_mask: normalizeNumber(data.group_mask, 0) >>> 0,
          rssi: -999,
          seen_ms: 999999,
          local_only: true
        });
        existingMacs.add(normalizedMac);
      });
    return out;
  }

  function controllerDevices() {
    return Array.isArray(state.controllerState?.devices) ? state.controllerState.devices : [];
  }

  function visibleControllerDevices() {
    return controllerDevices();
  }

  function deviceNameByMac(mac) {
    const value = String(mac || '').trim().toUpperCase();
    const device = controllerDevices().find((item) => String(item.mac || '').trim().toUpperCase() === value);
    return device ? deviceDraftName(device) : (value || '未知设备');
  }

  function deviceLabelByIndex(index) {
    const idx = normalizeNumber(index, -1);
    if (idx < 0) return '未知设备';
    const device = controllerDevices().find((item) => normalizeNumber(item?.idx, -1) === idx) || null;
    if (device) return deviceDraftName(device);
    return `设备${idx + 1}`;
  }

  function deviceLabelFromRuntime(event, key = 'self') {
    const idxKey = key === 'peer' ? 'peer_idx' : 'self_idx';
    const macKey = key === 'peer' ? 'peer_mac' : 'self_mac';
    const idx = normalizeNumber(event?.[idxKey], -1);
    if (idx >= 0) return deviceLabelByIndex(idx);
    return deviceNameByMac(event?.[macKey]);
  }

  function controllerGroups() {
    return Array.isArray(state.controllerState?.groups) ? state.controllerState.groups.filter((g) => g && g.valid) : [];
  }

  function controllerGroupSlots() {
    return Array.isArray(state.controllerState?.groups) ? state.controllerState.groups : [];
  }

  function mergeDeviceSnapshots(incomingDevices, previousDevices = []) {
    const previousByMac = new Map();
    for (const device of Array.isArray(previousDevices) ? previousDevices : []) {
      const mac = String(device?.mac || '').trim().toUpperCase();
      if (mac) previousByMac.set(mac, clone(device));
    }
    const merged = [];
    const seen = new Set();
    for (const device of Array.isArray(incomingDevices) ? incomingDevices : []) {
      const mac = String(device?.mac || '').trim().toUpperCase();
      if (!mac) continue;
      const prev = previousByMac.get(mac) || {};
      merged.push({
        ...prev,
        ...device,
        mac,
        idx: normalizeNumber(device?.idx, normalizeNumber(prev?.idx, merged.length)),
        rssi: normalizeNumber(device?.rssi, normalizeNumber(prev?.rssi, 0)),
        seen_ms: Math.max(0, normalizeNumber(device?.seen_ms, 0)),
        stale_missing: false
      });
      seen.add(mac);
    }
    for (const [mac, prev] of previousByMac.entries()) {
      if (seen.has(mac)) continue;
      if (!String(prev?.mac || '').trim()) continue;
      merged.push({
        ...prev,
        mac,
        idx: normalizeNumber(prev?.idx, merged.length),
        seen_ms: Math.max(normalizeNumber(prev?.seen_ms, DEVICE_ONLINE_MS + 1000), DEVICE_ONLINE_MS + 1000),
        stale_missing: true
      });
    }
    return merged.sort((a, b) => normalizeNumber(a?.idx, 0) - normalizeNumber(b?.idx, 0));
  }

  function controllerEffects() {
    if (Array.isArray(state.controllerState?.effects) && state.controllerState.effects.length) {
      return state.controllerState.effects;
    }
    return [
      ...(state.localState?.effect_templates || buildDefaultEffectTemplates()),
      ...(state.localState?.effect_presets || buildDefaultCustomEffects())
    ];
  }

  function activeTemplate() {
    return state.localState?.templates?.find((tpl) => tpl.id === state.selectedTemplateId) || state.localState?.templates?.[0] || null;
  }

  function roomList() {
    return Array.isArray(state.localState?.rooms) ? state.localState.rooms : [];
  }

  function roomSortOrder() {
    return String(state.localState?.ui?.room_sort_order || 'desc') === 'asc' ? 'asc' : 'desc';
  }

  function setRoomSortOrder(order) {
    if (!state.localState?.ui) return;
    state.localState.ui.room_sort_order = String(order) === 'asc' ? 'asc' : 'desc';
    persistStateToServer();
    render();
  }

  function sortedRoomList() {
    const rooms = roomList().slice();
    const direction = roomSortOrder() === 'asc' ? 1 : -1;
    return rooms.sort((a, b) => {
      const aTime = Date.parse(a?.updated_at || a?.created_at || '') || 0;
      const bTime = Date.parse(b?.updated_at || b?.created_at || '') || 0;
      if (aTime !== bTime) return direction * (aTime - bTime);
      const aName = String(a?.name || '');
      const bName = String(b?.name || '');
      if (aName !== bName) return direction * aName.localeCompare(bName, 'zh-Hans-CN');
      return direction * String(a?.id || '').localeCompare(String(b?.id || ''));
    });
  }

  function roomById(id) {
    const roomId = String(id || '');
    if (!roomId) return null;
    return roomList().find((room) => room.id === roomId) || null;
  }

  function activeRoomId() {
    return String(state.localState?.active_room_id || state.currentRoomId || sortedRoomList()[0]?.id || '');
  }

  function activeRoom() {
    return roomById(activeRoomId()) || state.localState?.current_room || null;
  }

  function roomCountdownActive(roomId = activeRoomId()) {
    return !!state.roomStartCountdown && String(state.roomStartCountdown.roomId || '') === String(roomId || '');
  }

  function roomCountdownRemaining(roomId = activeRoomId()) {
    if (!roomCountdownActive(roomId)) return 0;
    return clamp(normalizeNumber(state.roomStartCountdown?.remaining, 0), 0, 10);
  }

  function isDeviceOnline(device) {
    return state.controllerOnline && normalizeNumber(device?.seen_ms, Number.POSITIVE_INFINITY) < DEVICE_ONLINE_MS;
  }

  function isDeviceScanRetained(device) {
    if (!state.controllerOnline) return false;
    const seen = normalizeNumber(device?.seen_ms, Number.POSITIVE_INFINITY);
    return !!String(device?.mac || '').trim() && (seen < DEVICE_SCAN_RETAIN_MS || normalizeNumber(device?.online, 0) === 1);
  }

  function deviceScanStatusLabel(device) {
    if (isDeviceOnline(device)) return '在线';
    if (isDeviceScanRetained(device)) return '需扫描确认';
    if (!state.controllerOnline) return '未连接控制端';
    return '离线';
  }

  function roomSelectedGroupIds(room = currentRoom()) {
    const source = Array.isArray(room?.source_group_ids) ? room.source_group_ids : [];
    const target = Array.isArray(room?.target_group_ids) ? room.target_group_ids : [];
    return Array.from(new Set([...source, ...target].map((gid) => normalizeNumber(gid, -1)).filter((gid) => gid >= 0))).sort((a, b) => a - b);
  }

  function roomSelectedDevices(room = currentRoom()) {
    const groupIds = roomSelectedGroupIds(room);
    const map = new Map();
    for (const gid of groupIds) {
      const groupName = groupNameById(gid);
      for (const device of groupDevices(gid)) {
        const mac = String(device?.mac || '').trim();
        if (!mac) continue;
        const current = map.get(mac) || {
          device: clone(device),
          groups: new Set()
        };
        current.groups.add(groupName);
        map.set(mac, current);
      }
    }
    return Array.from(map.values()).map((item) => ({
      device: item.device,
      groups: Array.from(item.groups)
    }));
  }

  function roomPreparationAudit(room = currentRoom()) {
    const selectedDevices = roomSelectedDevices(room);
    const offlineDevices = selectedDevices.filter((item) => !isDeviceScanRetained(item.device));
    return {
      groupIds: roomSelectedGroupIds(room),
      devices: selectedDevices,
      offlineDevices
    };
  }

  function devicePrepareViewItem(item) {
    return {
      mac: String(item.device?.mac || ''),
      idx: normalizeNumber(item.device?.idx, -1),
      name: String(item.device?.name || ''),
      groups: Array.isArray(item.groups) ? item.groups.slice() : [],
      rssi: normalizeNumber(item.device?.rssi, 0),
      seen_ms: normalizeNumber(item.device?.seen_ms, 999999),
      online: isDeviceOnline(item.device),
      retained: isDeviceScanRetained(item.device),
      status: deviceScanStatusLabel(item.device)
    };
  }

  function openRoomPrepareModal(room = currentRoom()) {
    if (!room) return false;
    const { issues } = validateRoomReady(room);
    if (issues.length) {
      alert(issues[0]);
      if (state.activeTab !== 'room') {
        state.activeTab = 'room';
        state.localState.ui.active_tab = 'room';
      }
      render();
      return false;
    }
    const audit = roomPreparationAudit(room);
    const devices = audit.devices.map(devicePrepareViewItem);
    state.roomPrepareModal = {
      roomId: room.id,
      roomName: room.name || '未命名房间',
      groupIds: audit.groupIds.slice(),
      devices,
      offlineDevices: devices.filter((item) => !item.online),
      scrollTop: 0,
      autoScanIssued: false
    };
    renderDialogs();
    if (state.controllerOnline && !state.busy.scan && !state.roomPrepareModal.autoScanIssued) {
      state.roomPrepareModal.autoScanIssued = true;
      scanDevices();
    }
    return true;
  }

  function roomFinalizeAudit(room = currentRoom()) {
    const selectedDevices = roomSelectedDevices(room);
    const runtime = state.controllerState?.runtime || {};
    const roomHash = runtimeRoomHash(room);
    const stats = Array.isArray(runtime.receiver_stats)
      ? runtime.receiver_stats.filter((stat) => normalizeNumber(stat?.room, -1) === roomHash)
      : [];
    const statMacs = new Set(stats.map((stat) => String(stat.self_mac || '').trim().toUpperCase()).filter(Boolean));
    const missingDevices = selectedDevices.filter((item) => !statMacs.has(String(item.device?.mac || '').trim().toUpperCase()));
    return {
      room,
      roomHash,
      stats,
      missingDevices,
      scoreTotal: roomRuntimeSummary(room).score_total,
      latestLine: roomRuntimeSummary(room).discoveries[0]?.line || ''
    };
  }

  function openRoomFinalizeModal(room = currentRoom()) {
    if (!room) return false;
    state.roomFinalizeModal = roomFinalizeAudit(room);
    renderDialogs();
    return true;
  }

  function isSoftStopDisconnectError(err) {
    const message = String(err?.message || err || '');
    return /HTTP 502/.test(message)
      && /controller_proxy_failed/.test(message)
      && /Remote end closed connection without response/i.test(message);
  }

  function clearRoomCountdown({ silent = false } = {}) {
    if (state.roomCountdownTimer) {
      clearInterval(state.roomCountdownTimer);
      state.roomCountdownTimer = null;
    }
    state.roomStartCountdown = null;
    if (!silent) {
      logDebug('已取消开始倒计时');
      render();
    }
  }

  function wizardDraftTemplateId() {
    return String(state.wizardRoomDraft?.template_id || state.selectedTemplateId || activeTemplate()?.id || builtinTemplates[0].id);
  }

  function buildWizardRoomDraft(templateId, sourceRoom = null) {
    const template = state.localState?.templates?.find((tpl) => tpl.id === templateId)
      || state.localState?.templates?.[0]
      || builtinTemplates[0];
    const preset = playPresetById(template?.play_preset_id || template?.feature_preset_id || template?.id || '') || activePlayPresetForRoom(template);
    const presetSignal = ruleSignalDefaultsForRoom(null, preset);
    const presetCompare = ruleSignalCompareForUi(presetSignal);
    const base = sourceRoom ? clone(sourceRoom) : {
      id: uid('room'),
      name: '',
      template_id: template?.id || builtinTemplates[0].id,
      template_name: template?.name || builtinTemplates[0].name,
      status: 'draft',
      started_at: '',
      ended_at: '',
      published_at: '',
      publish_result: null,
      created_at: nowIso(),
      updated_at: nowIso(),
      feature_preset_id: String(template?.feature_preset_id || ''),
      play_preset_id: String(template?.play_preset_id || template?.id || ''),
      effect_preset_id: String(template?.effect_preset_id || ''),
      sense_mode: String(template?.sense_mode || ''),
      idle_effect_id: String(template?.idle_effect_id || ''),
      trigger_effect_id: String(template?.trigger_effect_id || ''),
      trigger_compare: presetCompare,
      trigger_signal_rssi: normalizeNumber(presetSignal.rssiMin, DEFAULT_TRIGGER_RSSI),
      trigger_hold_ms: normalizeNumber(presetSignal.holdMs, DEFAULT_TRIGGER_HOLD_MS),
      rule_signal_type: String(presetSignal.type || 'enter_range'),
      rule_rssi_min: normalizeNumber(presetSignal.rssiMin, DEFAULT_TRIGGER_RSSI),
      rule_rssi_max: presetSignal.rssiMax === null || presetSignal.rssiMax === undefined ? null : normalizeNumber(presetSignal.rssiMax, -20),
      rule_hold_ms: normalizeNumber(presetSignal.holdMs, DEFAULT_TRIGGER_HOLD_MS),
      rule_overrides: {
        signal: clone(preset.signal || {}),
        trigger: clone(preset.trigger || {}),
        score: clone(preset.score || {}),
        repeat: clone(preset.repeat || {}),
        afterTrigger: clone(preset.afterTrigger || {}),
        feedback: clone(preset.feedback || {})
      },
      match_bindings: [],
      preview_effect_id: String(template?.effect_preset_id || ''),
      timer: template?.feature_preset_id ? clone(featurePresetById(template.feature_preset_id)?.feature_ui?.timer || {}) : {},
      scoring: template?.scoring && typeof template.scoring === 'object' ? clone(template.scoring) : {},
      source_group_ids: [],
      target_group_ids: [],
      group_ids: [],
      effect_rules: [],
      notes: '',
      summary: {}
    };
    const room = normalizeRoomDraft(base, template);
    room.template_id = template?.id || builtinTemplates[0].id;
    room.template_name = template?.name || builtinTemplates[0].name;
    room.status = 'draft';
    room.started_at = '';
    room.ended_at = '';
    room.published_at = '';
    room.publish_result = null;
    room.updated_at = nowIso();
    syncRoomEffectRules(room);
    updateRoomDraftSummary(room);
    return room;
  }

  function syncActiveRoomAlias(room = activeRoom()) {
    if (!state.localState) return null;
    const next = room ? normalizeRoomDraft(room, state.localState.templates.find((tpl) => tpl.id === room.template_id) || state.localState.templates[0] || builtinTemplates[0]) : null;
    state.localState.active_room_id = next?.id || '';
    state.localState.current_room = next ? clone(next) : null;
    state.currentRoomId = next?.id || '';
    if (next?.template_id) {
      state.selectedTemplateId = next.template_id;
      if (state.localState.ui) state.localState.ui.selected_template_id = next.template_id;
    }
    return next;
  }

  function setActiveRoom(roomOrId) {
    const room = typeof roomOrId === 'string' ? roomById(roomOrId) : roomOrId || null;
    return syncActiveRoomAlias(room);
  }

  function currentRoom() {
    if (wizardState().open && state.wizardRoomDraft) return state.wizardRoomDraft;
    return activeRoom();
  }

  function selectedVisibleDevices() {
    return filteredDevices().filter((device) => state.selectedDeviceIds.has(device.mac));
  }

  function visibleGroupIdsForDevice(device) {
    const mask = normalizeNumber(device?.group_mask, 0) >>> 0;
    return controllerGroups()
      .map((group) => normalizeNumber(group?.id, -1))
      .filter((gid) => gid >= 0 && (mask & (1 << gid)) !== 0);
  }

  function groupById(id) {
    return controllerGroups().find((g) => g.id === id) || null;
  }

  function groupSlotById(id) {
    return controllerGroupSlots().find((g) => normalizeNumber(g?.id, -1) === normalizeNumber(id, -1)) || null;
  }

  function groupDevices(groupId) {
    const bit = 1 << normalizeNumber(groupId, -1);
    if (bit <= 0) return [];
    return visibleControllerDevices().filter((device) => ((normalizeNumber(device.group_mask, 0) >>> 0) & bit) !== 0);
  }

  function groupNameById(id) {
    const group = groupById(id);
    return group ? group.name : `分组${id + 1}`;
  }

  function groupLabelFromMask(mask) {
    const ids = controllerGroups()
      .map((group) => normalizeNumber(group?.id, -1))
      .filter((gid) => gid >= 0 && ((normalizeNumber(mask, 0) >>> 0) & (1 << gid)) !== 0);
    if (!ids.length) return '未分组';
    return ids.map((gid) => groupNameById(gid)).join(' / ');
  }

  function groupMaskFromIds(ids) {
    return (Array.isArray(ids) ? ids : []).reduce((mask, gid) => {
      const id = normalizeNumber(gid, -1);
      if (id >= 0) return mask | (1 << id);
      return mask;
    }, 0) >>> 0;
  }

  function runtimeEventMatchesRoomDirection(event, room) {
    const sourceMask = groupMaskFromIds(room?.source_group_ids);
    const targetMask = groupMaskFromIds(room?.target_group_ids);
    if (!sourceMask || !targetMask) return true;
    const selfMask = normalizeNumber(event?.self_group_mask, 0) >>> 0;
    const peerMask = normalizeNumber(event?.peer_group_mask, 0) >>> 0;
    return (selfMask & sourceMask) !== 0 && (peerMask & targetMask) !== 0;
  }

  function deviceByMac(mac) {
    const value = String(mac || '').trim().toUpperCase();
    return controllerDevices().find((item) => String(item.mac || '').trim().toUpperCase() === value) || null;
  }

  function devicePrimaryGroupIds(device) {
    const mask = normalizeNumber(device?.group_mask, 0) >>> 0;
    return controllerGroups()
      .map((group) => normalizeNumber(group?.id, -1))
      .filter((gid) => gid >= 0 && (mask & (1 << gid)) !== 0);
  }

  function devicePrimaryGroupLabel(device) {
    const ids = devicePrimaryGroupIds(device);
    if (!ids.length) return '未分组';
    return ids.map((gid) => groupNameById(gid)).join(' / ');
  }

  function roomSourceGroupLabel(room, device) {
    const sourceIds = new Set((room?.source_group_ids || []).map((gid) => normalizeNumber(gid, -1)).filter((gid) => gid >= 0));
    const ids = devicePrimaryGroupIds(device).filter((gid) => sourceIds.size === 0 || sourceIds.has(gid));
    if (!ids.length) return devicePrimaryGroupLabel(device);
    return ids.map((gid) => groupNameById(gid)).join(' / ');
  }

  function runtimeVerbForRoom(room = currentRoom()) {
    const preset = activePlayPresetForRoom(room);
    if (String(preset?.baseTemplate || '') === 'competition_score') return '占领';
    const scoreTarget = String(roomEffectiveRuleConfig(room, preset)?.score?.target || preset?.score?.target || '');
    const relationMatch = String(preset?.relation?.match || '');
    const signalType = String(roomEffectiveRuleConfig(room, preset)?.signal?.type || preset?.signal?.type || '');
    if (String(preset?.baseTemplate || '') === 'sustain_score' && (scoreTarget.startsWith('both_') || relationMatch === 'specified_pair')) return '共鸣成功';
    if (signalType === 'stay_in_range') return '完成保持';
    if (String(preset?.baseTemplate || '') === 'sustain_score') return '达标计分';
    return '发现';
  }

  function formatRuntimeDiscovery(event, room = currentRoom()) {
    if (!event) return '';
    const verb = runtimeVerbForRoom(room);
    const source = `${deviceLabelFromRuntime(event, 'self')}（${groupLabelFromMask(event.self_group_mask)}）`;
    const target = `${deviceLabelFromRuntime(event, 'peer')}（${groupLabelFromMask(event.peer_group_mask)}）`;
    if (verb === '共鸣成功') return `${formatClockTime(event.event_ms)} ${source} 与 ${target} 共鸣成功`;
    if (verb === '占领') return `${formatClockTime(event.event_ms)} ${source} 占领 ${target}`;
    if (verb === '完成保持') return `${formatClockTime(event.event_ms)} ${source} 完成一次保持计分`;
    if (verb === '达标计分') return `${formatClockTime(event.event_ms)} ${source} 对 ${target} 达标计分`;
    return `${formatClockTime(event.event_ms)} ${source} 发现 ${target}`;
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

  function scoringLabel(mode) {
    const value = String(mode || 'count_find');
    if (value === 'shared_count') return '组共享计分';
    if (value === 'rssi_probe') return '距离测试';
    if (value === 'demo') return '灯效演示';
    if (value === 'count_find') return '寻宝计分';
    return value || '未设置';
  }

  function effectNameById(effectId) {
    const id = String(effectId || '');
    const localMatch = effectDefinitionById(id);
    if (localMatch) return localMatch.name;
    const match = controllerEffects().find((item) => String(item.id) === id);
    if (match) return match.name;
    if (id === 'builtin-selftest' || id === 'selftest') return '自检';
    return id || '未设置';
  }

  function featurePresetNameById(presetId) {
    const match = featurePresetById(presetId);
    return match ? match.name : String(presetId || '') || '未设置';
  }

  function effectPresetNameById(presetId) {
    const match = effectDefinitionById(presetId);
    return match ? match.name : String(presetId || '') || '未设置';
  }

  function effectTemplateNameById(templateId) {
    const match = effectTemplateById(templateId);
    return match ? match.name : String(templateId || '') || '未设置';
  }

  function colorForMcu(value, fallback = 'FFFFFF') {
    const hex = String(value || '').replace('#', '').trim();
    return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : fallback;
  }

  function portMaskForMcu(track) {
    const port = clamp(normalizeNumber(track?.port, 1), 1, 3);
    return 1 << (port - 1);
  }

  function breathSpeedForMcu(track) {
    const freq = normalizeNumber(track?.frequency_hz, 0);
    const effectiveFreq = freq > 0 ? freq : 0.35;
    return clamp(Math.round(effectiveFreq * 188), 20, 5000);
  }

  function enabledMcuTracks(effect) {
    const tracks = Array.isArray(effect?.effect_ui?.tracks) ? effect.effect_ui.tracks : [];
    return tracks.filter((track) => track && track.enabled !== false && normalizeNumber(track?.port, 1) >= 1 && normalizeNumber(track?.port, 1) <= 3);
  }

  function mcuModeForTrack(track, fallback = 'silent') {
    const mode = String(track?.mode || fallback || 'silent');
    if (mode === 'pulse_chase') return 'pulse';
    return mode;
  }

  function mcuComparableKeyForTrack(track, fallback = 'silent') {
    const mode = mcuModeForTrack(track, fallback);
    if (mode === 'selftest' || mode === 'silent') return mode;
    const start = Math.max(0, normalizeNumber(track?.led_start, 1) - 1);
    const end = Math.max(start + 1, normalizeNumber(track?.led_end, track?.led_count || 25));
    const length = clamp(end - start, 1, 200);
    const gap = clamp(normalizeNumber(track?.gap, 0), 0, 20);
    const colors = Array.isArray(track?.colors) ? track.colors : [];
    const c1 = colorForMcu(colors[0], 'FFFFFF');
    const c2 = colorForMcu(colors[1], c1);
    const c3 = colorForMcu(colors[2], c1);
    const brightness = clamp(normalizeNumber(track?.brightness, mode === 'silent' ? 0 : 80), 0, 100);
    const period = clamp(normalizeNumber(track?.period_ms, mode === 'cycle' ? 420 : 700), 50, 20000);
    const duty = clamp(normalizeNumber(track?.duty, 50), 1, 99);
    const repeat = clamp(normalizeNumber(track?.repeat, 0), 0, 9999);
    const accel = clamp(normalizeNumber(track?.accel, 0), 0, 100);
    const hold = clamp(normalizeNumber(track?.end_hold_ms, 0), 0, 30000);
    if (mode === 'solid' || mode === 'gradient') return JSON.stringify([mode, start, length, gap, c1, c2, c3, period, brightness, repeat, accel, hold]);
    if (mode === 'breath') {
      const speed = breathSpeedForMcu(track);
      return JSON.stringify([mode, start, length, gap, c1, c2, c3, speed, brightness, repeat, accel, hold]);
    }
    if (mode === 'blink') return JSON.stringify([mode, start, length, gap, c1, c2, c3, period, duty, brightness, repeat, accel, hold]);
    if (mode === 'cycle') return JSON.stringify([mode, start, length, gap, c1, c2, c3, period, brightness, repeat, accel, hold]);
    if (mode === 'chase') return JSON.stringify([mode, start, length, gap, c1, c2, c3, period, brightness, repeat, accel, hold]);
    if (mode === 'pulse') {
      const startBrightness = clamp(normalizeNumber(track?.pulse_speed_start, 10), 0, 100);
      const endBrightness = clamp(normalizeNumber(track?.pulse_speed_end, 100), 0, 100);
      const duration = clamp(normalizeNumber(track?.pulse_duration_ms, 0), 0, 30000);
      return JSON.stringify([mode, start, length, gap, c1, c2, c3, period, startBrightness, endBrightness, repeat || 15, accel, hold, duration]);
    }
    return mode;
  }

  function combinedPortMaskForMcu(effect, primary, fallback = 'silent') {
    const primaryKey = mcuComparableKeyForTrack(primary, fallback);
    let mask = 0;
    for (const track of enabledMcuTracks(effect)) {
      if (mcuComparableKeyForTrack(track, fallback) === primaryKey) {
        mask |= portMaskForMcu(track);
      }
    }
    return mask || portMaskForMcu(primary);
  }

  function effectTrackSpecForMcu(track, portMask, fallback = 'silent') {
    const mode = String(track?.mode || fallback || 'silent');
    if (mode === 'selftest') return 'selftest';
    if (mode === 'silent') return 'silent';
    const start = Math.max(0, normalizeNumber(track?.led_start, 1) - 1);
    const end = Math.max(start + 1, normalizeNumber(track?.led_end, track?.led_count || 25));
    const length = clamp(end - start, 1, 200);
    const gap = clamp(normalizeNumber(track?.gap, 0), 0, 20);
    const colors = Array.isArray(track?.colors) ? track.colors : [];
    const c1 = colorForMcu(colors[0], 'FFFFFF');
    const c2 = colorForMcu(colors[1], c1);
    const c3 = colorForMcu(colors[2], c1);
    const brightness = clamp(normalizeNumber(track?.brightness, mode === 'silent' ? 0 : 80), 0, 100);
    const period = clamp(normalizeNumber(track?.period_ms, mode === 'cycle' ? 420 : 700), 50, 20000);
    const duty = clamp(normalizeNumber(track?.duty, 50), 1, 99);
    const repeat = clamp(normalizeNumber(track?.repeat, 0), 0, 9999);
    const accel = clamp(normalizeNumber(track?.accel, 0), 0, 100);
    const hold = clamp(normalizeNumber(track?.end_hold_ms, 0), 0, 30000);
    if (mode === 'solid') return `solid3|${portMask}|${start}|${length}|${gap}|${c1}|${c2}|${c3}|${brightness}`;
    if (mode === 'gradient') return `gradient3|${portMask}|${start}|${length}|${gap}|${c1}|${c2}|${c3}|${period}|${brightness}|${repeat}|${accel}|${hold}`;
    if (mode === 'breath') {
      const speed = breathSpeedForMcu(track);
      return `breath3|${portMask}|${start}|${length}|${gap}|${c1}|${c2}|${c3}|${speed}|${brightness}|${repeat}|${accel}|${hold}`;
    }
    if (mode === 'blink') return `blink3|${portMask}|${start}|${length}|${gap}|${c1}|${c2}|${c3}|${period}|${duty}|${brightness}|${repeat}|${accel}|${hold}`;
    if (mode === 'cycle') return `cycle2|${portMask}|${start}|${length}|${gap}|${c1}|${c2}|${c3}|${period}|${brightness}|${repeat}|${accel}|${hold}`;
    if (mode === 'chase') return `chase3|${portMask}|${start}|${length}|${gap}|${c1}|${c2}|${c3}|${period}|${brightness}|${repeat}|${accel}|${hold}`;
    if (mode === 'pulse' || mode === 'pulse_chase') {
      const startBrightness = clamp(normalizeNumber(track?.pulse_speed_start, 10), 0, 100);
      const endBrightness = clamp(normalizeNumber(track?.pulse_speed_end, 100), 0, 100);
      const duration = clamp(normalizeNumber(track?.pulse_duration_ms, 0), 0, 30000);
      return `pulse3|${portMask}|${start}|${length}|${gap}|${c1}|${c2}|${c3}|${period}|${startBrightness}|${endBrightness}|${repeat || 15}|${accel}|${hold}|${duration}`;
    }
    return fallback === 'selftest' ? 'selftest' : 'silent';
  }

  function effectSpecForMcu(effectId, fallback = 'silent') {
    const effect = effectDefinitionById(effectId);
    const primary = effectPrimaryTrack(effect) || buildDefaultEffectTrack(fallback, 0);
    const tracks = enabledMcuTracks(effect);
    if (tracks.length > 1) {
      const specs = tracks.slice(0, 3).map((track) => effectTrackSpecForMcu(track, portMaskForMcu(track), fallback)).filter((spec) => spec && spec !== 'silent');
      if (specs.length > 1) {
        const multi = `multi2;${specs.join(';')}`;
        if (multi.length <= MCU_EFFECT_TEXT_LIMIT) return multi;
      }
    }
    const portMask = combinedPortMaskForMcu(effect, primary, fallback);
    return effectTrackSpecForMcu(primary, portMask, fallback);
  }

  function effectMcuDiagnostic(effectId, fallback = 'silent') {
    const effect = effectDefinitionById(effectId);
    const primary = effectPrimaryTrack(effect) || buildDefaultEffectTrack(fallback, 0);
    const tracks = enabledMcuTracks(effect);
    const primaryKey = mcuComparableKeyForTrack(primary, fallback);
    const applied = tracks.filter((track) => mcuComparableKeyForTrack(track, fallback) === primaryKey);
    const ignored = tracks.filter((track) => mcuComparableKeyForTrack(track, fallback) !== primaryKey);
    const spec = effectSpecForMcu(effectId, fallback);
    const warnings = [];
    if (ignored.length && !spec.startsWith('multi2;')) {
      warnings.push(`固件本次只执行 ${applied.map((track) => `LED${normalizeNumber(track.port, 1)}`).join(' / ')}；${ignored.map((track) => `LED${normalizeNumber(track.port, 1)} ${effectModeLabel(track.mode)}`).join('、')} 暂未下发。`);
    }
    if (tracks.length > 1 && !spec.startsWith('multi2;') && effectSpecForMcu(effectId, fallback).length > MCU_EFFECT_TEXT_LIMIT) {
      warnings.push('多轨灯效超过 ESP-NOW 安全长度，已退回单轨下发。');
    }
    if (spec.startsWith('multi2;')) {
      warnings.push(`已启用 3 路多轨下发：${tracks.slice(0, 3).map((track) => `LED${normalizeNumber(track.port, 1)} ${effectModeLabel(track.mode)}`).join('、')}。`);
    }
    if (!effect && effectId && effectId !== 'builtin-silent') {
      warnings.push('没有找到这个灯效定义，已使用回退灯效。');
    }
    return {
      effect_id: String(effectId || ''),
      name: effectNameById(effectId),
      spec,
      applied_ports: applied.map((track) => normalizeNumber(track.port, 1)),
      ignored_count: ignored.length,
      warnings
    };
  }

  function roomRuleForGroup(room, gid) {
    const rules = Array.isArray(room?.effect_rules) ? room.effect_rules : [];
    return rules.find((rule) => normalizeNumber(rule.source_group_id, -1) === gid)
      || rules.find((rule) => normalizeNumber(rule.target_group_id, -1) === gid)
      || null;
  }

  function activePlayPresetForRoom(room) {
    const id = String(room?.play_preset_id || room?.feature_preset_id || room?.template_id || '');
    return playPresetById(id)
      || allPlayPresets()[0]
      || normalizePlayPreset(buildDefaultPlayPresets()[0]);
  }

  function ruleSignalDefaultsForRoom(room, preset = activePlayPresetForRoom(room)) {
    const signal = preset?.signal && typeof preset.signal === 'object' ? clone(preset.signal) : {};
    const overrideSignal = room?.rule_overrides?.signal && typeof room.rule_overrides.signal === 'object' ? room.rule_overrides.signal : {};
    const type = String(overrideSignal.type || room?.rule_signal_type || signal.type || 'enter_range');
    const hasRoomMin = overrideSignal.rssiMin !== null && overrideSignal.rssiMin !== undefined && overrideSignal.rssiMin !== ''
      || (room && room.rule_rssi_min !== null && room.rule_rssi_min !== undefined && room.rule_rssi_min !== '');
    const hasRoomHold = overrideSignal.holdMs !== null && overrideSignal.holdMs !== undefined && overrideSignal.holdMs !== ''
      || (room && room.rule_hold_ms !== null && room.rule_hold_ms !== undefined && room.rule_hold_ms !== '');
    const rssiMin = hasRoomMin ? normalizeNumber(overrideSignal.rssiMin ?? room?.rule_rssi_min, DEFAULT_TRIGGER_RSSI) : normalizeNumber(signal.rssiMin, DEFAULT_TRIGGER_RSSI);
    const hasRoomMax = overrideSignal.rssiMax !== undefined
      || (room && Object.prototype.hasOwnProperty.call(room, 'rule_rssi_max'));
    const rawMax = hasRoomMax ? (overrideSignal.rssiMax ?? room?.rule_rssi_max) : signal.rssiMax;
    return {
      ...signal,
      type,
      rssiMin,
      rssiMax: rawMax === null || rawMax === undefined || rawMax === '' ? null : normalizeNumber(rawMax, -20),
      holdMs: hasRoomHold ? normalizeNumber(overrideSignal.holdMs ?? room?.rule_hold_ms, DEFAULT_TRIGGER_HOLD_MS) : normalizeNumber(signal.holdMs, DEFAULT_TRIGGER_HOLD_MS)
    };
  }

  function roomEffectiveRuleConfig(room, preset = activePlayPresetForRoom(room)) {
    const overrides = room?.rule_overrides && typeof room.rule_overrides === 'object' ? room.rule_overrides : {};
    return {
      signal: { ...(preset?.signal || {}), ...(overrides.signal || {}) },
      trigger: { ...(preset?.trigger || {}), ...(overrides.trigger || {}) },
      score: { ...(preset?.score || {}), ...(overrides.score || {}) },
      repeat: { ...(preset?.repeat || {}), ...(overrides.repeat || {}) },
      afterTrigger: { ...(preset?.afterTrigger || {}), ...(overrides.afterTrigger || {}) },
      feedback: {
        ...(preset?.feedback || {}),
        ...(overrides.feedback || {}),
        signalMeter: {
          ...(preset?.feedback?.signalMeter || {}),
          ...(overrides.feedback?.signalMeter || {})
        }
      }
    };
  }

  function ruleSignalCompareForUi(signal) {
    const type = String(signal?.type || 'enter_range');
    return (type === 'weaker' || type === 'lost' || type === 'leave_range') ? 'lte' : 'gte';
  }

  function v3SignalTypeCode(value) {
    const key = String(value || 'enter_range');
    if (key === 'leave_range') return 2;
    if (key === 'stay_in_range') return 3;
    if (key === 'appeared') return 4;
    if (key === 'lost') return 5;
    if (key === 'stronger') return 6;
    if (key === 'weaker') return 7;
    return 1;
  }

  function v3TriggerModeCode(value) {
    const key = String(value || 'instant');
    if (key === 'continuous') return 2;
    if (key === 'accumulate') return 3;
    if (key === 'count') return 4;
    if (key === 'periodic') return 5;
    return 1;
  }

  function v3ScoreTargetCode(value) {
    const key = String(value || 'source_player');
    if (key === 'source_group') return 2;
    if (key === 'target_player') return 3;
    if (key === 'target_group') return 4;
    if (key === 'both_players') return 5;
    if (key === 'both_groups') return 6;
    if (key === 'none') return 0;
    return 1;
  }

  function v3RepeatModeCode(value) {
    const key = String(value || 'once_per_pair');
    if (key === 'allow_repeat') return 1;
    if (key === 'once_per_target') return 3;
    if (key === 'once_per_source') return 4;
    if (key === 'cooldown') return 5;
    return 2;
  }

  function v3AfterCode(targetState, timerAction = 'none') {
    const targetKey = String(targetState || 'none');
    const timerKey = String(timerAction || 'none');
    let targetCode = 0;
    let timerCode = 0;
    if (targetKey === 'cooldown') targetCode = 1;
    else if (targetKey === 'disabled') targetCode = 2;
    else if (targetKey === 'locked') targetCode = 3;
    if (timerKey === 'reset') timerCode = 1;
    else if (timerKey === 'pause') timerCode = 2;
    return ((timerCode & 0x0f) << 4) | (targetCode & 0x0f);
  }

  function v3BaseCode(value) {
    const key = String(value || 'instant_score');
    if (key === 'sustain_score') return 2;
    if (key === 'competition_score') return 3;
    return 1;
  }

  function v3JudgeCode(preset, asSource) {
    if (String(preset?.baseTemplate || '') === 'competition_score') return asSource ? 0 : 2; // only target devices judge ownership.
    return asSource ? 1 : 0;
  }

  function signalMeterEnabledForRuntimeGroup(signalMeter, playPreset, asSource) {
    if (signalMeter?.enabled !== true) return false;
    const relation = playPreset?.relation || {};
    const targetRole = String(relation.targetRole || '').trim();
    const matchMode = String(relation.match || '').trim();
    const scoreTarget = String(playPreset?.score?.target || '').trim();
    const baseTemplate = String(playPreset?.baseTemplate || '').trim();
    const targetIsHiddenObject = targetRole === 'target_device';
    const sourceOnlyScore = scoreTarget === 'source_player' || scoreTarget === 'source_group';
    if (!asSource && matchMode === 'source_to_target' && (targetIsHiddenObject || sourceOnlyScore || baseTemplate === 'competition_score')) {
      return false;
    }
    return true;
  }

  function buildMcuRuntimePayload(payload) {
    const room = currentRoom() ? clone(normalizeRoomDraft(currentRoom(), state.localState?.templates?.find((tpl) => tpl.id === currentRoom().template_id) || state.localState?.templates?.[0] || builtinTemplates[0])) : null;
    const runtime = {
      schema: 3,
      room_id: room?.id || '',
      room_name: room?.name || '',
      active: !!room,
      led_ports_supported: 3,
      warnings: [],
      rules: [],
      pair_bindings: []
    };
    if (!room) return runtime;
    syncRoomEffectRules(room);
    const playPreset = activePlayPresetForRoom(room);
    const effectiveRule = roomEffectiveRuleConfig(room, playPreset);
    const signal = ruleSignalDefaultsForRoom(room, playPreset);
    const trigger = effectiveRule.trigger || {};
    const score = effectiveRule.score || {};
    const repeat = effectiveRule.repeat || {};
    const afterTrigger = effectiveRule.afterTrigger || {};
    const signalMeter = effectiveRule.feedback?.signalMeter || {};
    const sourceIds = new Set((room.source_group_ids || []).map((id) => normalizeNumber(id, -1)).filter((id) => id >= 0));
    const targetIds = new Set((room.target_group_ids || []).map((id) => normalizeNumber(id, -1)).filter((id) => id >= 0));
    const allRuntimeGroups = new Set([...sourceIds, ...targetIds]);
    const groupById = new Map((payload.groups || []).map((group) => [normalizeNumber(group.id, -1), group]));
    const usedEffectIds = new Set();
    for (const gid of allRuntimeGroups) {
      const group = groupById.get(gid);
      if (!group) continue;
      const asSource = sourceIds.has(gid);
      const peerIds = asSource ? targetIds : sourceIds;
      const peerMask = Array.from(peerIds).reduce((mask, id) => mask | (1 << id), 0) >>> 0;
      const rule = roomRuleForGroup(room, gid);
      const idleId = asSource
        ? (rule?.source_idle_effect_id || room.idle_effect_id || 'builtin-silent')
        : (rule?.target_idle_effect_id || 'builtin-silent');
      const triggerId = asSource
        ? (rule?.source_trigger_effect_id || room.trigger_effect_id || idleId)
        : (rule?.target_trigger_effect_id || room.trigger_effect_id || idleId);
      usedEffectIds.add(idleId);
      usedEffectIds.add(triggerId);
      const idleSpec = effectSpecForMcu(idleId, 'silent');
      const triggerSpec = effectSpecForMcu(triggerId, 'silent');
      const meterEnabledForGroup = signalMeterEnabledForRuntimeGroup(signalMeter, playPreset, asSource);
      Object.assign(group, {
        effect: idleSpec,
        trigger_effect: triggerSpec,
        peer_mask: peerMask,
        room_hash: Math.abs(hashCode(String(room.id || 'room'))) % 65535,
        trigger_compare: triggerCompareValue(room.trigger_compare || group.trigger_compare),
        rssi: normalizeNumber(signal.rssiMin, normalizeNumber(room.trigger_signal_rssi ?? group.rssi, normalizeNumber(group.rssi, -70))),
        hold: normalizeNumber(signal.holdMs, normalizeNumber(room.trigger_hold_ms ?? group.hold, normalizeNumber(group.hold, 2000))),
        rule_id: 1,
        rule_base: v3BaseCode(playPreset.baseTemplate),
        rule_judge: v3JudgeCode(playPreset, asSource),
        rule_signal: v3SignalTypeCode(signal.type),
        rule_rssi_min: normalizeNumber(signal.rssiMin, normalizeNumber(room.trigger_signal_rssi, DEFAULT_TRIGGER_RSSI)),
        rule_rssi_max: signal.rssiMax === null || signal.rssiMax === undefined ? -127 : normalizeNumber(signal.rssiMax, -20),
        rule_missing_ms: normalizeNumber(signal.missingMs, 3000),
        rule_smooth_samples: clamp(normalizeNumber(signal.smoothSamples, 5), 1, 10),
        rule_trigger: v3TriggerModeCode(trigger.mode),
        rule_target_ms: normalizeNumber(trigger.targetMs, normalizeNumber(signal.holdMs, 0)),
        rule_target_count: normalizeNumber(trigger.targetCount, 1),
        rule_period_ms: normalizeNumber(trigger.periodMs, 0),
        rule_score_target: v3ScoreTargetCode(score.target),
        rule_points: normalizeNumber(score.points, 1),
        rule_repeat: v3RepeatModeCode(repeat.mode),
        rule_cooldown_ms: normalizeNumber(repeat.cooldownMs, 5000),
        rule_after: v3AfterCode(afterTrigger.targetState, afterTrigger.timerAction),
        meter_enabled: meterEnabledForGroup ? 1 : 0,
        meter_port: clamp(normalizeNumber(signalMeter.port, 1), 1, 3),
        meter_led_count: clamp(normalizeNumber(signalMeter.ledCount, 10), 1, 200),
        meter_weak_rssi: normalizeNumber(signalMeter.weakRssi, -90),
        meter_strong_rssi: normalizeNumber(signalMeter.strongRssi, normalizeNumber(signal.rssiMin, DEFAULT_TRIGGER_RSSI)),
        meter_compression_x100: clamp(normalizeNumber(signalMeter.compressionX100, 100), 20, 500)
      });
      runtime.rules.push({
        rule_id: 1,
        group_id: gid,
        role: asSource ? 'source' : 'target',
        base_template: String(playPreset.baseTemplate || 'instant_score'),
        relation_match: String(playPreset?.relation?.match || 'source_to_target'),
        judge: group.rule_judge === 2 ? 'target' : group.rule_judge === 1 ? 'source' : 'none',
        peer_mask: peerMask,
        signal_type: String(signal.type || 'enter_range'),
        rssi_min: group.rule_rssi_min,
        rssi_max: group.rule_rssi_max,
        hold: group.hold,
        missing_ms: group.rule_missing_ms,
        smooth_samples: group.rule_smooth_samples,
        trigger_mode: String(trigger.mode || 'instant'),
        target_ms: group.rule_target_ms,
        target_count: group.rule_target_count,
        period_ms: group.rule_period_ms,
        score_target: String(score.target || 'source_player'),
        points: group.rule_points,
        repeat: String(repeat.mode || 'once_per_pair'),
        cooldown_ms: group.rule_cooldown_ms,
        after: String(afterTrigger.targetState || 'none'),
        timer_action: String(afterTrigger.timerAction || 'none'),
        signal_meter: {
          enabled: group.meter_enabled === 1,
          port: group.meter_port,
          led_count: group.meter_led_count,
          weak_rssi: group.meter_weak_rssi,
          strong_rssi: group.meter_strong_rssi,
          compression_x100: group.meter_compression_x100
        },
        idle_effect: idleSpec,
        trigger_effect: triggerSpec
      });
    }
    if (String(playPreset?.relation?.match || '') === 'specified_pair') {
      syncRoomMatchBindings(room);
      runtime.pair_bindings = (room.match_bindings || []).map((item, index) => ({
        rule_id: 1,
        binding_id: index + 1,
        source_mac: String(item.source_mac || '').trim().toUpperCase(),
        target_mac: String(item.target_mac || '').trim().toUpperCase(),
        source_group_id: normalizeNumber(item.source_group_id, -1),
        target_group_id: normalizeNumber(item.target_group_id, -1)
      })).filter((item) => item.source_mac && item.target_mac);
      if (!runtime.pair_bindings.length) {
        runtime.warnings.push('当前玩法要求指定配对，但本局还没有可下发的设备配对。');
      }
    }
    const usesLed4 = Array.from(usedEffectIds).some((effectId) => {
      const effect = effectDefinitionById(effectId);
      const tracks = Array.isArray(effect?.effect_ui?.tracks) ? effect.effect_ui.tracks : [];
      return tracks.some((track) => track?.enabled !== false && normalizeNumber(track?.port, 1) > 3);
    });
    if (usesLed4) runtime.warnings.push('当前接收端固件只发布 LED1-LED3，LED4 灯效会被忽略。');
    const warningSet = new Set(runtime.warnings);
    for (const effectId of usedEffectIds) {
      const diag = effectMcuDiagnostic(effectId, 'silent');
      for (const warning of diag.warnings) {
        if (warning.startsWith('已启用')) continue;
        warningSet.add(`${diag.name}：${warning}`);
      }
    }
    runtime.warnings = Array.from(warningSet);
    return runtime;
  }

  function roomRuntimeEffectDiagnostics(room = currentRoom()) {
    if (!room) return [];
    const template = state.localState?.templates?.find((tpl) => tpl.id === room.template_id) || state.localState?.templates?.[0] || builtinTemplates[0];
    const draft = clone(normalizeRoomDraft(room, template));
    syncRoomEffectRules(draft);
    const sourceIds = new Set((draft.source_group_ids || []).map((gid) => normalizeNumber(gid, -1)).filter((gid) => gid >= 0));
    const targetIds = new Set((draft.target_group_ids || []).map((gid) => normalizeNumber(gid, -1)).filter((gid) => gid >= 0));
    const groupIds = Array.from(new Set([...sourceIds, ...targetIds])).sort((a, b) => a - b);
    return groupIds.map((gid) => {
      const asSource = sourceIds.has(gid);
      const rule = roomRuleForGroup(draft, gid);
      const idleId = asSource
        ? (rule?.source_idle_effect_id || draft.idle_effect_id || 'builtin-silent')
        : (rule?.target_idle_effect_id || 'builtin-silent');
      const triggerId = asSource
        ? (rule?.source_trigger_effect_id || draft.trigger_effect_id || idleId)
        : (rule?.target_trigger_effect_id || draft.trigger_effect_id || idleId);
      const devices = groupDevices(gid).map((device) => deviceDraftName(device) || device.mac || '未知设备');
      const idle = effectMcuDiagnostic(idleId, 'silent');
      const trigger = effectMcuDiagnostic(triggerId, 'silent');
      return {
        group_id: gid,
        group_name: groupNameById(gid),
        role: asSource ? 'source' : 'target',
        role_label: asSource ? '源组' : '目标组',
        devices,
        idle,
        trigger,
        warnings: [...idle.warnings, ...trigger.warnings]
      };
    });
  }

  function hashCode(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return hash;
  }

  function runtimeRoomHash(room) {
    return Math.abs(hashCode(String(room?.id || 'room'))) % 65535;
  }

  function roomRuntimeSummary(room) {
    const runtime = state.controllerState?.runtime || {};
    const roomHash = runtimeRoomHash(room);
    const preset = activePlayPresetForRoom(room);
    const effective = roomEffectiveRuleConfig(room, preset);
    const scoreTarget = String(effective?.score?.target || 'source_player');
    const events = Array.isArray(runtime.events)
      ? runtime.events.filter((event) => normalizeNumber(event?.room, -1) === roomHash && runtimeEventMatchesRoomDirection(event, room))
      : [];
    const bySource = new Map();
    const byTarget = new Map();
    const byBothPlayers = new Map();
    const bySourceGroup = new Map();
    const byTargetGroup = new Map();
    const byBothGroups = new Map();
    const addPlayer = (map, key, label, idx, points) => {
      if (!key || !label) return;
      map.set(key, {
        label,
        count: (map.get(key)?.count || 0) + points,
        idx
      });
    };
    const addGroup = (map, key, label, points) => {
      if (!key || !label) return;
      map.set(key, {
        label,
        count: (map.get(key)?.count || 0) + points
      });
    };
    for (const event of events) {
      const points = normalizeNumber(event?.points, 1);
      const selfIdx = normalizeNumber(event?.self_idx, -1);
      const peerIdx = normalizeNumber(event?.peer_idx, -1);
      const selfMac = String(event.self_mac || '').trim();
      const peerMac = String(event.peer_mac || '').trim();
      const sourceKey = selfIdx >= 0 ? `idx:${selfIdx}` : `mac:${selfMac}`;
      const targetKey = peerIdx >= 0 ? `idx:${peerIdx}` : `mac:${peerMac}`;
      const sourceLabel = selfIdx >= 0 ? deviceLabelByIndex(selfIdx) : deviceNameByMac(selfMac);
      const targetLabel = peerIdx >= 0 ? deviceLabelByIndex(peerIdx) : deviceNameByMac(peerMac);
      const sourceDevice = selfIdx >= 0
        ? controllerDevices().find((device) => normalizeNumber(device?.idx, -1) === selfIdx)
        : deviceByMac(selfMac);
      const targetDevice = peerIdx >= 0
        ? controllerDevices().find((device) => normalizeNumber(device?.idx, -1) === peerIdx)
        : deviceByMac(peerMac);
      const groupLabel = roomSourceGroupLabel(room, sourceDevice);
      const targetGroupLabel = groupLabelFromMask(event.peer_group_mask);
      if (scoreTarget === 'source_player' || scoreTarget === 'source_group' || scoreTarget === 'none') {
        addPlayer(bySource, sourceKey, sourceLabel, selfIdx, points);
        addGroup(bySourceGroup, groupLabel, groupLabel, points);
      }
      if (scoreTarget === 'target_player' || scoreTarget === 'target_group') {
        addPlayer(byTarget, targetKey, targetLabel, peerIdx, points);
        addGroup(byTargetGroup, targetGroupLabel, targetGroupLabel, points);
      }
      if (scoreTarget === 'both_players') {
        addPlayer(byBothPlayers, sourceKey, sourceLabel, selfIdx, points);
        addPlayer(byBothPlayers, targetKey, targetLabel, peerIdx, points);
      }
      if (scoreTarget === 'both_groups') {
        addGroup(byBothGroups, groupLabel, groupLabel, points);
        addGroup(byBothGroups, targetGroupLabel, targetGroupLabel, points);
      }
    }
    const discoveries = events.slice().reverse().map((event) => ({
      ...event,
      line: formatRuntimeDiscovery(event, room)
    }));
    const scoreboard = {
      source_players: Array.from(bySource.values()),
      source_groups: Array.from(bySourceGroup.values()),
      target_players: Array.from(byTarget.values()),
      target_groups: Array.from(byTargetGroup.values()),
      both_players: Array.from(byBothPlayers.values()),
      both_groups: Array.from(byBothGroups.values())
    };
    const primaryPlayers = scoreTarget === 'target_player'
      ? scoreboard.target_players
      : scoreTarget === 'both_players'
        ? scoreboard.both_players
        : scoreboard.source_players;
    const primaryGroups = scoreTarget === 'target_group'
      ? scoreboard.target_groups
      : scoreTarget === 'both_groups'
        ? scoreboard.both_groups
        : scoreboard.source_groups;
    return {
      roomHash,
      running: runtime.running === true && events.length > 0,
      events,
      score_total: events.reduce((sum, event) => sum + normalizeNumber(event?.points, 1), 0),
      by_source: scoreboard.source_players.map((item) => ({ label: item.label, count: item.count, idx: item.idx })),
      by_source_group: scoreboard.source_groups.map((item) => ({ label: item.label, count: item.count })),
      scoreboard,
      score_target: scoreTarget,
      primary_players: primaryPlayers,
      primary_groups: primaryGroups,
      discoveries,
      latest: events.length ? events[events.length - 1] : null
    };
  }

  function historySessionRecords() {
    return normalizeRoomRecords(state.roomRecords)
      .filter((record) => String(record?.type || 'room_session') === 'room_session')
      .sort((a, b) => new Date(b.ended_at || b.updated_at || b.started_at || 0).getTime() - new Date(a.ended_at || a.updated_at || a.started_at || 0).getTime());
  }

  function historyPlayerSummary(records = historySessionRecords()) {
    const map = new Map();
    for (const record of records) {
      const roomName = String(record?.room_name || '未命名房间');
      const endedAt = record?.ended_at || record?.updated_at || '';
      const playerRows = [
        ...(Array.isArray(record?.runtime_scoreboard?.source) ? record.runtime_scoreboard.source : []),
        ...(Array.isArray(record?.runtime_scoreboard?.source_players) ? record.runtime_scoreboard.source_players : []),
        ...(Array.isArray(record?.runtime_scoreboard?.target_players) ? record.runtime_scoreboard.target_players : []),
        ...(Array.isArray(record?.runtime_scoreboard?.both_players) ? record.runtime_scoreboard.both_players : [])
      ];
      if (playerRows.length) {
        for (const row of playerRows) {
          const label = String(row?.label || '').trim();
          if (!label) continue;
          const current = map.get(label) || { label, score: 0, sessions: 0, last_room: '', last_time: '' };
          current.score += normalizeNumber(row?.count, 0);
          current.sessions += 1;
          if (!current.last_time || new Date(endedAt).getTime() > new Date(current.last_time).getTime()) {
            current.last_room = roomName;
            current.last_time = endedAt;
          }
          map.set(label, current);
        }
        continue;
      }
      const discoveries = Array.isArray(record?.runtime_discoveries) ? record.runtime_discoveries : [];
      for (const event of discoveries) {
        const label = String(event?.self_name || event?.source_name || '').trim()
          || String(event?.line || '').split('发现')[0].replace(/^\d+点\d+分\d+秒\s*/, '').replace(/（.*$/, '').trim()
          || String(event?.self_mac || '未知玩家');
        const current = map.get(label) || { label, score: 0, sessions: 0, last_room: '', last_time: '' };
        current.score += 1;
        current.sessions += 1;
        current.last_room = roomName;
        current.last_time = endedAt;
        map.set(label, current);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.score - a.score || b.sessions - a.sessions || a.label.localeCompare(b.label, 'zh-CN'));
  }

  function historyGroupSummary(records = historySessionRecords()) {
    const map = new Map();
    for (const record of records) {
      const rows = [
        ...(Array.isArray(record?.runtime_scoreboard?.source_groups) ? record.runtime_scoreboard.source_groups : []),
        ...(Array.isArray(record?.runtime_scoreboard?.target_groups) ? record.runtime_scoreboard.target_groups : []),
        ...(Array.isArray(record?.runtime_scoreboard?.both_groups) ? record.runtime_scoreboard.both_groups : [])
      ];
      for (const row of rows) {
        const label = String(row?.label || '').trim();
        if (!label) continue;
        const current = map.get(label) || { label, score: 0, sessions: 0 };
        current.score += normalizeNumber(row?.count, 0);
        current.sessions += 1;
        map.set(label, current);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.score - a.score || b.sessions - a.sessions || a.label.localeCompare(b.label, 'zh-CN'));
  }

  function historyDiscoveryRows(records = historySessionRecords()) {
    const rows = [];
    for (const record of records) {
      const roomName = String(record?.room_name || '未命名房间');
      const discoveries = Array.isArray(record?.runtime_discoveries) ? record.runtime_discoveries : [];
      for (const event of discoveries) {
        rows.push({
          room_name: roomName,
          line: String(event?.line || ''),
          rssi: normalizeNumber(event?.rssi, 0),
          event_ms: normalizeNumber(event?.event_ms, 0),
          ended_at: record?.ended_at || record?.updated_at || ''
        });
      }
    }
    return rows.sort((a, b) => normalizeNumber(b.event_ms, 0) - normalizeNumber(a.event_ms, 0));
  }

  function filteredDevices() {
    const devices = visibleControllerDevices();
    const mode = state.deviceFilterMode;
    const gid = normalizeNumber(state.deviceFilterGroupId, -1);
    const hidden = new Set((state.localState?.hidden_devices || []).map((item) => String(item || '').trim()).filter(Boolean));
    let filtered = devices;
    if (mode === 'group' && gid >= 0) {
      const bit = 1 << gid;
      filtered = devices.filter((device) => ((normalizeNumber(device.group_mask, 0) >>> 0) & bit) !== 0);
    } else if (mode !== 'all') {
      filtered = devices.filter((device) => (normalizeNumber(device.group_mask, 0) >>> 0) === 0);
    }
    filtered = filtered.filter((device) => !hidden.has(String(device.mac || '').trim()));
    if (!state.localState?.ui?.show_offline_devices) {
      filtered = filtered.filter((device) => isDeviceScanRetained(device));
    }
    return filtered.slice().sort((a, b) => {
      const aOnline = isDeviceOnline(a) ? 1 : 0;
      const bOnline = isDeviceOnline(b) ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      const aRssi = normalizeNumber(a?.rssi, -999);
      const bRssi = normalizeNumber(b?.rssi, -999);
      if (aOnline && bOnline && aRssi !== bRssi) return bRssi - aRssi;
      if (aOnline !== bOnline) return bOnline - aOnline;
      const aSeen = normalizeNumber(a?.seen_ms, 999999);
      const bSeen = normalizeNumber(b?.seen_ms, 999999);
      if (aSeen !== bSeen) return aSeen - bSeen;
      return normalizeNumber(a?.idx, 0) - normalizeNumber(b?.idx, 0);
    });
  }

  function onlineCount() {
    return visibleControllerDevices().filter((device) => isDeviceOnline(device)).length;
  }

  function retainedDeviceCount() {
    return visibleControllerDevices().filter((device) => isDeviceScanRetained(device)).length;
  }

  function ungroupedCount() {
    return visibleControllerDevices().filter((device) => (normalizeNumber(device.group_mask, 0) >>> 0) === 0).length;
  }

  function activeGroupsCount() {
    return controllerGroups().length;
  }

  function effectTemplatesCount() {
    return controllerEffects().filter((item) => String(item?.id || '') !== 'builtin-selftest' && String(item?.id || '') !== 'selftest').length;
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
    if (roomCountdownActive(room.id)) return `倒计时 ${roomCountdownRemaining(room.id)} 秒`;
    if (room.status === 'draft') return '草稿';
    if (room.status === 'published') return '已预备';
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
      step: clamp(normalizeNumber(wizard.step, 0), 0, WIZARD_STEP_MAX),
      returnTab: String(wizard.return_tab || 'overview')
    };
  }

  function syncWizardState(patch = {}) {
    if (!state.localState.ui) state.localState.ui = {};
    if (!state.localState.ui.wizard) state.localState.ui.wizard = { open: false, step: 0, return_tab: 'overview' };
    state.localState.ui.wizard = {
      open: patch.open !== undefined ? !!patch.open : state.localState.ui.wizard.open === true,
      step: patch.step !== undefined ? clamp(normalizeNumber(patch.step, 0), 0, WIZARD_STEP_MAX) : clamp(normalizeNumber(state.localState.ui.wizard.step, 0), 0, WIZARD_STEP_MAX),
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
    const preset = activePlayPresetForRoom(room);
    if (!String(room?.name || '').trim()) issues.push('请先填写房间名称。');
    if (!template?.id) issues.push('请先选择一个玩法预设。');
    if (!(Array.isArray(room?.source_group_ids) && room.source_group_ids.length)) issues.push('请至少选择一个源组。');
    if (!(Array.isArray(room?.target_group_ids) && room.target_group_ids.length)) issues.push('请至少选择一个目标组。');
    if (String(preset?.relation?.match || '') === 'specified_pair') {
      const sourceDevices = roomBindingCandidates(room, 'source');
      const targetDevices = roomBindingCandidates(room, 'target');
      if (!sourceDevices.length || !targetDevices.length) {
        issues.push('当前玩法要求指定配对，请先连接控制端、扫描设备，并确保源组和目标组都有在线设备。');
      }
      const bindings = syncRoomMatchBindings(room);
      if (sourceDevices.length && bindings.length < sourceDevices.length) {
        issues.push('当前玩法要求每台源设备都有明确目标，请补齐配对关系。');
      }
      const invalid = bindings.find((item) => !String(item?.target_mac || '').trim());
      if (invalid) issues.push('当前玩法要求指定配对，请先为每台源设备选择目标设备。');
    }
    return { issues, template };
  }

  function ensureRoomDraft(templateId = state.selectedTemplateId || activeTemplate()?.id || builtinTemplates[0].id, options = {}) {
    const template = state.localState?.templates?.find((tpl) => tpl.id === templateId)
      || state.localState?.templates?.[0]
      || builtinTemplates[0];
    const forceNew = options.forceNew === true || !state.wizardRoomDraft;
    const sourceRoom = options.room || null;
    if (forceNew || !state.wizardRoomDraft) {
      state.wizardRoomDraft = buildWizardRoomDraft(template?.id || builtinTemplates[0].id, sourceRoom);
    } else {
      state.wizardRoomDraft.template_id = template?.id || builtinTemplates[0].id;
      state.wizardRoomDraft.template_name = template?.name || builtinTemplates[0].name;
      applyTemplateDefaultsToRoom(state.wizardRoomDraft, template, { overwrite: options.overwrite === true });
      state.wizardRoomDraft.status = 'draft';
      state.wizardRoomDraft.started_at = '';
      state.wizardRoomDraft.ended_at = '';
      state.wizardRoomDraft.published_at = '';
      state.wizardRoomDraft.publish_result = null;
      state.wizardRoomDraft.updated_at = nowIso();
      syncRoomEffectRules(state.wizardRoomDraft);
      updateRoomDraftSummary(state.wizardRoomDraft);
    }
    const draft = state.wizardRoomDraft;
    if (!Array.isArray(draft.source_group_ids)) draft.source_group_ids = [];
    if (!Array.isArray(draft.target_group_ids)) draft.target_group_ids = [];
    if (!Array.isArray(draft.group_ids)) {
      draft.group_ids = Array.from(new Set([...(draft.source_group_ids || []), ...(draft.target_group_ids || [])]));
    }
    state.selectedTemplateId = draft.template_id;
    state.localState.ui.selected_template_id = draft.template_id;
    return draft;
  }

  function updateRoomDraftSummary(room = currentRoom()) {
    if (!room) return;
    room.group_ids = Array.from(new Set([
      ...(Array.isArray(room.source_group_ids) ? room.source_group_ids : []),
      ...(Array.isArray(room.target_group_ids) ? room.target_group_ids : [])
    ])).sort((a, b) => a - b);
    syncRoomEffectRules(room);
    room.summary = {
      source_group_names: (room.source_group_ids || []).map((gid) => groupNameById(gid)),
      target_group_names: (room.target_group_ids || []).map((gid) => groupNameById(gid)),
      source_count: (room.source_group_ids || []).length,
      target_count: (room.target_group_ids || []).length,
      feature_preset_name: featurePresetById(room.feature_preset_id)?.name || '',
      effect_preset_name: effectPresetById(room.effect_preset_id)?.name || '',
      sense_mode: String(room.sense_mode || ''),
      idle_effect_name: effectNameById(room.idle_effect_id || ''),
      trigger_effect_name: effectNameById(room.trigger_effect_id || ''),
      effect_rule_count: Array.isArray(room.effect_rules) ? room.effect_rules.length : 0,
      scoring: room.scoring && typeof room.scoring === 'object' ? clone(room.scoring) : {},
      timer: room.timer && typeof room.timer === 'object' ? clone(room.timer) : {}
    };
    room.updated_at = nowIso();
    syncActiveRoomAlias(room);
  }

  function openWizard(templateId = state.selectedTemplateId || activeTemplate()?.id || builtinTemplates[0].id, options = {}) {
    const returnTab = state.activeTab || state.localState?.ui?.active_tab || 'overview';
    state.selectedTemplateId = templateId || builtinTemplates[0].id;
    state.localState.ui.selected_template_id = state.selectedTemplateId;
    state.roomEffectPreviewKey = '';
    state.roomEffectPreviewId = '';
    const current = activeRoom();
    const sourceRoom = options.room || (!options.forceNew && current && current.status !== 'running' ? current : null);
    state.wizardRoomDraft = buildWizardRoomDraft(state.selectedTemplateId, sourceRoom);
    syncWizardState({ open: true, step: 0, returnTab });
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
    state.wizardRoomDraft = null;
    state.roomEffectPreviewKey = '';
    state.roomEffectPreviewId = '';
    state.activeTab = returnTab;
    state.localState.ui.active_tab = returnTab;
    persistStateToServer();
    render();
  }

  function wizardNext() {
    syncWizardState({ step: clamp(wizardState().step + 1, 0, WIZARD_STEP_MAX) });
    persistStateToServer();
    render();
  }

  function wizardPrev() {
    syncWizardState({ step: clamp(wizardState().step - 1, 0, WIZARD_STEP_MAX) });
    persistStateToServer();
    render();
  }

  function setWizardRoomName(value) {
    const room = ensureRoomDraft();
    room.name = String(value || '').trim();
    room.updated_at = nowIso();
    updateRoomDraftSummary(room);
    persistLocalCache();
    render();
  }

  function setWizardRoomNotes(value) {
    const room = ensureRoomDraft();
    room.notes = String(value || '');
    room.updated_at = nowIso();
    updateRoomDraftSummary(room);
    persistLocalCache();
  }

  function setWizardTemplate(templateId) {
    const template = state.localState.templates.find((item) => item.id === templateId) || activeTemplate() || state.localState.templates[0] || builtinTemplates[0];
    state.selectedTemplateId = template.id;
    state.localState.ui.selected_template_id = template.id;
    const room = ensureRoomDraft(template.id);
    room.effect_rules = [];
    applyTemplateDefaultsToRoom(room, template, { overwrite: true });
    const signal = ruleSignalDefaultsForRoom(null, activePlayPresetForRoom(room));
    room.rule_signal_type = String(signal.type || 'enter_range');
    room.rule_rssi_min = normalizeNumber(signal.rssiMin, DEFAULT_TRIGGER_RSSI);
    room.rule_rssi_max = signal.rssiMax === null || signal.rssiMax === undefined ? null : normalizeNumber(signal.rssiMax, -20);
    room.rule_hold_ms = normalizeNumber(signal.holdMs, DEFAULT_TRIGGER_HOLD_MS);
    room.rule_overrides = {
      signal: clone(playPresetById(room.play_preset_id)?.signal || {}),
      trigger: clone(playPresetById(room.play_preset_id)?.trigger || {}),
      score: clone(playPresetById(room.play_preset_id)?.score || {}),
      repeat: clone(playPresetById(room.play_preset_id)?.repeat || {}),
      afterTrigger: clone(playPresetById(room.play_preset_id)?.afterTrigger || {}),
      feedback: clone(playPresetById(room.play_preset_id)?.feedback || {})
    };
    room.match_bindings = [];
    room.trigger_compare = ruleSignalCompareForUi(signal);
    room.trigger_signal_rssi = room.rule_rssi_min;
    room.trigger_hold_ms = room.rule_hold_ms;
    updateRoomDraftSummary(room);
    persistLocalCache();
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
    persistLocalCache();
    render();
  }

  function roomBindingCandidates(room, kind = 'source') {
    const ids = kind === 'target' ? (room?.target_group_ids || []) : (room?.source_group_ids || []);
    const seen = new Set();
    const rows = [];
    for (const gid of ids) {
      for (const device of groupDevices(gid)) {
        const mac = String(device?.mac || '').trim().toUpperCase();
        if (!mac || seen.has(mac)) continue;
        seen.add(mac);
        rows.push({
          mac,
          idx: normalizeNumber(device?.idx, -1),
          name: deviceDraftName(device) || deviceNameByMac(mac) || mac,
          group_id: normalizeNumber(gid, -1),
          group_name: groupNameById(gid)
        });
      }
    }
    return rows;
  }

  function roomUsesSpecifiedPair(room = currentRoom()) {
    const preset = activePlayPresetForRoom(room);
    return String(preset?.relation?.match || '') === 'specified_pair';
  }

  function syncRoomMatchBindings(room = currentRoom()) {
    if (!room) return [];
    if (!Array.isArray(room.match_bindings)) room.match_bindings = [];
    const sourceDevices = roomBindingCandidates(room, 'source');
    const targetDevices = roomBindingCandidates(room, 'target');
    const targetByMac = new Set(targetDevices.map((item) => item.mac));
    const existing = new Map((room.match_bindings || []).map((item) => [String(item.source_mac || '').trim().toUpperCase(), item]));
    room.match_bindings = sourceDevices.map((source, index) => {
      const prev = existing.get(source.mac) || {};
      const fallbackTarget = targetDevices[index] || targetDevices[0] || null;
      const targetMac = targetByMac.has(String(prev.target_mac || '').trim().toUpperCase())
        ? String(prev.target_mac || '').trim().toUpperCase()
        : String(fallbackTarget?.mac || '');
      return {
        source_mac: source.mac,
        source_group_id: source.group_id,
        target_mac: targetMac,
        target_group_id: normalizeNumber(targetDevices.find((item) => item.mac === targetMac)?.group_id, -1)
      };
    }).filter((item) => item.source_mac);
    return room.match_bindings;
  }

  function updateWizardMatchBinding(sourceMac, targetMac) {
    const room = ensureRoomDraft();
    syncRoomMatchBindings(room);
    room.match_bindings = room.match_bindings.map((item) => {
      if (String(item.source_mac || '').trim().toUpperCase() !== String(sourceMac || '').trim().toUpperCase()) return item;
      const target = roomBindingCandidates(room, 'target').find((candidate) => candidate.mac === String(targetMac || '').trim().toUpperCase()) || null;
      return {
        source_mac: item.source_mac,
        source_group_id: item.source_group_id,
        target_mac: String(target?.mac || ''),
        target_group_id: normalizeNumber(target?.group_id, -1)
      };
    });
    room.updated_at = nowIso();
    updateRoomDraftSummary(room);
    persistLocalCache();
    render();
  }

  function updateWizardEffectRule(sourceGroupId, targetGroupId, field, value) {
    const room = ensureRoomDraft();
    syncRoomEffectRules(room);
    const rule = roomEffectRuleByPair(room, sourceGroupId, targetGroupId);
    if (!rule) return;
    const allowed = new Set(['source_idle_effect_id', 'source_trigger_effect_id', 'target_idle_effect_id', 'target_trigger_effect_id']);
    if (!allowed.has(field)) return;
    rule[field] = String(value || 'builtin-silent');
    room.updated_at = nowIso();
    updateRoomDraftSummary(room);
    persistLocalCache();
  }

  function applyWizardEffectRuleBatch(field, value) {
    const room = ensureRoomDraft();
    syncRoomEffectRules(room);
    const allowed = new Set(['source_idle_effect_id', 'source_trigger_effect_id', 'target_idle_effect_id', 'target_trigger_effect_id']);
    if (!allowed.has(field)) return;
    for (const rule of room.effect_rules || []) {
      rule[field] = String(value || 'builtin-silent');
    }
    if (field === 'source_idle_effect_id') room.idle_effect_id = String(value || 'builtin-silent');
    if (field === 'source_trigger_effect_id' || field === 'target_trigger_effect_id') room.trigger_effect_id = String(value || 'builtin-silent');
    room.updated_at = nowIso();
    updateRoomDraftSummary(room);
    persistLocalCache();
    render();
  }

  async function saveWizardDraft() {
    const room = ensureRoomDraft();
    if (!String(room.name || '').trim()) {
      alert('请先输入房间名称。');
      return;
    }
    const template = state.localState?.templates?.find((item) => item.id === room.template_id) || activeTemplate() || state.localState?.templates?.[0] || builtinTemplates[0];
    const savedRoom = normalizeRoomDraft({
      ...clone(room),
      status: 'draft',
      started_at: '',
      ended_at: '',
      published_at: '',
      publish_result: null,
      template_id: template?.id || builtinTemplates[0].id,
      template_name: template?.name || builtinTemplates[0].name,
      updated_at: nowIso()
    }, template);
    updateRoomDraftSummary(savedRoom);
    upsertRoom(savedRoom, { activate: true });
    state.wizardRoomDraft = null;
    syncWizardState({ open: false });
    state.activeTab = 'room';
    state.localState.ui.active_tab = 'room';
    await persistStateToServer();
    logDebug(`向导设置已保存 | ${savedRoom.name}`);
    render();
  }

  async function startWizardRoom() {
    const room = currentRoom();
    if (!room) return;
    logDebug(`向导里不再直接开始 | ${room.name} / ${room.template_name}`);
  }

  function buildControllerPayload() {
    const payload = mergeDraftsIntoController(state.controllerState || buildDefaultControllerState(), state.localState || buildDefaultLocalState());
    payload.schema_version = 3;
    payload.active_preset = selectedTemplateName();
    payload.presets = normalizeTemplates(state.localState?.templates || []);
    payload.effect_templates = normalizeEffectTemplates(state.localState?.effect_templates || []);
    payload.effect_presets = normalizeEffectPresets(state.localState?.effect_presets || []);
    payload.effects = normalizeEffectEffects([
      ...payload.effect_templates,
      ...payload.effect_presets
    ]);
    payload.rooms = roomList().map((room) => {
      const next = normalizeRoomDraft(room, state.localState?.templates?.find((tpl) => tpl.id === room.template_id) || state.localState?.templates?.[0] || builtinTemplates[0]);
      return clone(next);
    });
    payload.active_room_id = activeRoomId();
    payload.current_room = currentRoom() ? clone(normalizeRoomDraft(currentRoom(), state.localState?.templates?.find((tpl) => tpl.id === currentRoom().template_id) || state.localState?.templates?.[0] || builtinTemplates[0])) : null;
    payload.records = Array.isArray(payload.records) ? payload.records : [];
    payload.rules = Array.isArray(payload.rules) ? payload.rules : [];
    payload.mcu_runtime = buildMcuRuntimePayload(payload);
    return payload;
  }

  function buildControllerPublishPayload(sourcePayload = buildControllerPayload()) {
    const payload = clone(sourcePayload);
    if (!payload.mcu_runtime) payload.mcu_runtime = buildMcuRuntimePayload(payload);
    const runtimeGroupIds = [];
    const addRuntimeGroupId = (gid) => {
      const id = normalizeNumber(gid, -1);
      if (id >= 0 && !runtimeGroupIds.includes(id)) runtimeGroupIds.push(id);
    };
    const runtimeRules = Array.isArray(payload.mcu_runtime?.rules) ? payload.mcu_runtime.rules : [];
    for (const rule of runtimeRules) {
      addRuntimeGroupId(rule?.group_id);
    }
    if (!runtimeGroupIds.length) {
      for (const gid of roomSelectedGroupIds(currentRoom())) addRuntimeGroupId(gid);
    }
    if (runtimeGroupIds.length > MAX_MCU_GROUPS) {
      throw new Error(`本局参与分组 ${runtimeGroupIds.length} 个，超过固件运行态最多 ${MAX_MCU_GROUPS} 个。`);
    }
    const groupIdMap = new Map(runtimeGroupIds.map((oldId, index) => [oldId, index]));
    const remapRuntimeMask = (mask) => {
      const source = normalizeNumber(mask, 0) >>> 0;
      let next = 0;
      for (const [oldId, runtimeId] of groupIdMap.entries()) {
        if ((source & (1 << oldId)) !== 0) next |= (1 << runtimeId);
      }
      return next >>> 0;
    };
    const groupById = new Map((Array.isArray(payload.groups) ? payload.groups : []).map((group) => [normalizeNumber(group?.id, -1), group]));
    const compactGroups = runtimeGroupIds.map((oldId) => {
      const group = groupById.get(oldId) || { id: oldId, valid: true, name: groupNameById(oldId) };
      const mappedTarget = groupIdMap.has(normalizeNumber(group.target, -1)) ? groupIdMap.get(normalizeNumber(group.target, -1)) : 255;
      return {
        id: groupIdMap.get(oldId),
        valid: group.valid !== false,
        name: String(group.name || `分组${normalizeNumber(group.id, 0) + 1}`),
        note: String(group.note || ''),
        target: mappedTarget,
        mode: normalizeNumber(group.mode, 1),
        trigger_compare: triggerCompareValue(group.trigger_compare),
        rssi: normalizeNumber(group.rssi, -70),
        hold: normalizeNumber(group.hold, 2000),
        rule_id: normalizeNumber(group.rule_id, 1),
        rule_base: normalizeNumber(group.rule_base, 1),
        rule_judge: normalizeNumber(group.rule_judge, 1),
        rule_signal: normalizeNumber(group.rule_signal, 1),
        rule_rssi_min: normalizeNumber(group.rule_rssi_min, normalizeNumber(group.rssi, -70)),
        rule_rssi_max: normalizeNumber(group.rule_rssi_max, -127),
        rule_missing_ms: normalizeNumber(group.rule_missing_ms, 3000),
        rule_smooth_samples: normalizeNumber(group.rule_smooth_samples, 5),
        rule_trigger: normalizeNumber(group.rule_trigger, 1),
        rule_target_ms: normalizeNumber(group.rule_target_ms, 0),
        rule_target_count: normalizeNumber(group.rule_target_count, 1),
        rule_period_ms: normalizeNumber(group.rule_period_ms, 0),
        rule_score_target: normalizeNumber(group.rule_score_target, 1),
        rule_points: normalizeNumber(group.rule_points, 1),
        rule_repeat: normalizeNumber(group.rule_repeat, 2),
        rule_cooldown_ms: normalizeNumber(group.rule_cooldown_ms, 5000),
        rule_after: normalizeNumber(group.rule_after, 0),
        meter_enabled: normalizeNumber(group.meter_enabled, 0),
        meter_port: clamp(normalizeNumber(group.meter_port, 1), 1, 3),
        meter_led_count: clamp(normalizeNumber(group.meter_led_count, 10), 1, 200),
        meter_weak_rssi: normalizeNumber(group.meter_weak_rssi, -90),
        meter_strong_rssi: normalizeNumber(group.meter_strong_rssi, normalizeNumber(group.rule_rssi_min, DEFAULT_TRIGGER_RSSI)),
        meter_compression_x100: clamp(normalizeNumber(group.meter_compression_x100, 100), 20, 500),
        effect: String(group.effect || 'silent').slice(0, MCU_EFFECT_TEXT_LIMIT),
        trigger_effect: String(group.trigger_effect || group.effect || 'silent').slice(0, MCU_EFFECT_TEXT_LIMIT),
        silence: String(group.silence || '').slice(0, 63),
        peer_mask: remapRuntimeMask(group.peer_mask),
        room_hash: normalizeNumber(group.room_hash, 1)
      };
    });
    return {
      schema_version: 3,
      rssi_defaults_version: RSSI_DEFAULTS_VERSION,
      runtime_schema: 3,
      play_preset_id: String(currentRoom()?.play_preset_id || currentRoom()?.feature_preset_id || ''),
      pair_bindings: Array.isArray(payload.mcu_runtime?.pair_bindings) ? payload.mcu_runtime.pair_bindings.map((item) => clone(item)) : [],
      devices: (Array.isArray(payload.devices) ? payload.devices : []).map((device, idx) => ({
        idx: normalizeNumber(device.idx, idx),
        mac: String(device.mac || '').trim(),
        name: String(device.name || `Fragment${idx + 1}`).slice(0, 31),
        group_mask: remapRuntimeMask(device.group_mask),
        rssi: normalizeNumber(device.rssi, 0),
        seen_ms: Math.max(0, normalizeNumber(device.seen_ms, 0))
      })).filter((device) => device.mac),
      groups: compactGroups,
      records: []
    };
  }

  function buildLocalStatePayload() {
    const payload = clone(state.localState || buildDefaultLocalState());
    payload.schema = LOCAL_SCHEMA_VERSION;
    payload.gameplay_reset_version = LOCAL_SCHEMA_VERSION;
    payload.updated_at = nowIso();
    payload.rssi_defaults_version = RSSI_DEFAULTS_VERSION;
    payload.ui = {
      active_tab: state.activeTab,
      show_unassigned: payload.ui?.show_unassigned !== false,
      device_filter_mode: state.deviceFilterMode,
      device_filter_group_id: state.deviceFilterGroupId,
      room_sort_order: roomSortOrder(),
      show_offline_devices: state.localState?.ui?.show_offline_devices === true,
      device_preview_collapsed: state.localState?.ui?.device_preview_collapsed === true,
      preview_cell_shape: String(state.localState?.ui?.preview_cell_shape || 'square') === 'circle' ? 'circle' : 'square',
      selected_group_id: normalizeNumber(state.localState?.ui?.selected_group_id, 0),
      expanded_group_id: normalizeNumber(state.localState?.ui?.expanded_group_id, -1),
      selected_template_id: state.selectedTemplateId,
      selected_feature_preset_id: String(state.localState?.ui?.selected_feature_preset_id || allPlayPresets(state.localState)?.[0]?.id || ''),
      selected_play_preset_id: String(state.localState?.ui?.selected_play_preset_id || state.localState?.ui?.selected_feature_preset_id || allPlayPresets(state.localState)?.[0]?.id || ''),
      selected_effect_preset_id: String(state.localState?.ui?.selected_effect_preset_id || ''),
      play_preset_filter: ['all', 'user', 'system'].includes(String(state.localState?.ui?.play_preset_filter || '')) ? String(state.localState.ui.play_preset_filter) : 'all',
      play_preset_query: String(state.localState?.ui?.play_preset_query || ''),
      play_preset_advanced: state.localState?.ui?.play_preset_advanced === true,
      play_preset_list_collapsed: state.localState?.ui?.play_preset_list_collapsed === true,
      system_play_presets_collapsed: state.localState?.ui?.system_play_presets_collapsed !== false,
      wizard: {
        open: !!state.localState?.ui?.wizard?.open,
        step: clamp(normalizeNumber(state.localState?.ui?.wizard?.step, 0), 0, WIZARD_STEP_MAX),
        return_tab: String(state.localState?.ui?.wizard?.return_tab || 'overview')
      }
    };
    payload.rooms = roomList().map((room) => clone(room));
    payload.active_room_id = activeRoomId();
    payload.current_room = currentRoom() ? clone(currentRoom()) : null;
    payload.room_history = Array.isArray(payload.room_history) ? payload.room_history : [];
    payload.system_play_presets = buildDefaultPlayPresets().map((item) => normalizePlayPreset(item));
    payload.user_play_presets = normalizeUserPlayPresets(payload.user_play_presets || payload.play_presets || payload.feature_presets || []);
    rebuildPresetDerivedState(payload);
    payload.effect_templates = Array.isArray(payload.effect_templates) ? payload.effect_templates : [];
    payload.effect_presets = Array.isArray(payload.effect_presets) ? payload.effect_presets : [];
    payload.hidden_devices = Array.isArray(payload.hidden_devices) ? payload.hidden_devices : [];
    payload.controller_groups = normalizeGroups(controllerGroupSlots(), payload.controller_groups || buildDefaultGroups());
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

  function showRuntimeWarnings(payload) {
    const warnings = Array.isArray(payload?.mcu_runtime?.warnings) ? payload.mcu_runtime.warnings : [];
    if (!warnings.length) return;
    const text = warnings.join('\n');
    logDebug(`运行配置提示 | ${warnings.join(' | ')}`);
    alert(text);
  }

  function setBusy(key, value) {
    state.busy[key] = !!value;
    render();
  }

  function requestTimeoutError(controller, fallback) {
    if (controller?.signal?.aborted) return new Error('timeout');
    const message = String(fallback?.message || fallback || '');
    if (/aborted|abort/i.test(message)) return new Error('timeout');
    return fallback instanceof Error ? fallback : new Error(message || 'request failed');
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
    } catch (err) {
      throw requestTimeoutError(controller, err);
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
    } catch (err) {
      throw requestTimeoutError(controller, err);
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
    } catch (err) {
      throw requestTimeoutError(controller, err);
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
    return requestJson('/api/local/records?tail=5000', { timeoutMs: 5000, headers: { 'Content-Type': 'application/json' } });
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
      const payload = buildControllerPayload();
      await requestJson('/api/save', {
        method: 'POST',
        body: JSON.stringify(buildControllerPublishPayload(payload)),
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
    state.editingDraftName = deviceDisplayName(device);
    state.editingDraftNote = deviceDraftNote(device);
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
    state.editingDraftName = '';
    state.editingDraftNote = '';
    render();
  }

  function updateEditDraft(field, value) {
    if (field === 'note') state.editingDraftNote = value;
    else state.editingDraftName = value;
  }

  async function saveDeviceName(mac) {
    const device = controllerDevices().find((item) => item.mac === mac);
    if (!device) return;
    const name = String(state.editingDraftName || '').trim();
    if (!name) {
      alert('设备名称不能为空。');
      return;
    }
    device.name = name;
    const note = String(state.editingDraftNote || '').trim();
    device.note = note;
    saveDeviceDraft(device, { name, note, group_mask: device.group_mask });
    state.editingMac = '';
    state.editingDraftName = '';
    state.editingDraftNote = '';
    await persistStateToServer();
    render();
    logDebug(`设备信息已保存 | ${device.mac} -> ${name}${note ? ` / ${note}` : ''}`);
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
    saveDeviceDraft(device, { group_mask: device.group_mask });
    render();
    persistStateToServer();
  }

  function clearSelectedGroups() {
    const selected = selectedVisibleDevices();
    if (!selected.length) return;
    for (const device of selected) {
      device.group_mask = 0;
      saveDeviceDraft(device, { group_mask: 0 });
    }
    render();
    persistStateToServer();
    logDebug(`取消分组 | 已清除 ${selected.length} 台设备的分组`);
  }

  async function saveDeviceRow(mac) {
    const device = controllerDevices().find((item) => item.mac === mac);
    if (!device) return;
    const input = document.querySelector(`[data-role="device-name-input"][data-mac="${cssEscape(mac)}"]`);
    const noteInput = document.querySelector(`[data-role="device-note-input"][data-mac="${cssEscape(mac)}"]`);
    const name = String(input?.value ?? deviceDisplayName(device)).trim();
    const note = String(noteInput?.value ?? deviceDraftNote(device)).trim();
    if (!name) {
      alert('设备名称不能为空。');
      return;
    }
    device.name = name;
    device.note = note;
    saveDeviceDraft(device, { name, note, group_mask: device.group_mask });
    await persistStateToServer();
    render();
    logDebug(`保存设备 | ${mac} = ${name}${note ? ` / ${note}` : ''}`);
  }

  function nextGroupId() {
    const slots = controllerGroupSlots();
    const maxId = slots.reduce((max, group) => Math.max(max, normalizeNumber(group?.id, -1)), -1);
    return maxId + 1;
  }

  function createGroupContainer(groupId) {
    const slots = controllerGroupSlots();
    let group = slots.find((item) => normalizeNumber(item?.id, -1) === normalizeNumber(groupId, -1));
    if (!group) {
      group = {
        id: normalizeNumber(groupId, 0),
        valid: true,
        name: `分组${normalizeNumber(groupId, 0) + 1}`,
        note: '',
        target: 255,
        mode: 1,
        sense_mode: 'ring',
        rssi: -70,
        hold: 2000,
        template: '',
        effect_template_id: '',
        effect: 'builtin-breath',
        effect_ui: clone(buildDefaultGroups()[0].effect_ui),
        idle_effect: 'builtin-silent',
        silence: '',
        signal_ui: clone(buildDefaultGroups()[0].signal_ui),
        score: clone(buildDefaultGroups()[0].score)
      };
      slots.push(group);
      slots.sort((a, b) => normalizeNumber(a?.id, 0) - normalizeNumber(b?.id, 0));
    }
    return group;
  }

  async function persistGroupState() {
    state.localState.controller_groups = normalizeGroups(controllerGroupSlots(), state.localState.controller_groups || buildDefaultGroups());
    await persistStateToServer();
    const ok = await persistDraftToServer();
    return ok;
  }

  function groupMemberCount(groupId) {
    return groupDevices(groupId).length;
  }

  function removeGroupReferences(groupId) {
    const gid = normalizeNumber(groupId, -1);
    if (gid < 0) return { devices: 0, rooms: 0, templates: 0 };
    const bit = 1 << gid;
    let deviceCount = 0;
    for (const device of controllerDevices()) {
      const mask = normalizeNumber(device.group_mask, 0) >>> 0;
      if ((mask & bit) !== 0) {
        device.group_mask = (mask & ~bit) >>> 0;
        saveDeviceDraft(device, { group_mask: device.group_mask });
        deviceCount++;
      }
    }
    let roomCount = 0;
    for (const room of roomList()) {
      const before = `${room.source_group_ids || []}|${room.target_group_ids || []}`;
      room.source_group_ids = Array.isArray(room.source_group_ids) ? room.source_group_ids.filter((id) => normalizeNumber(id, -1) !== gid) : [];
      room.target_group_ids = Array.isArray(room.target_group_ids) ? room.target_group_ids.filter((id) => normalizeNumber(id, -1) !== gid) : [];
      room.group_ids = Array.from(new Set([...(room.source_group_ids || []), ...(room.target_group_ids || [])])).sort((a, b) => a - b);
      syncRoomEffectRules(room);
      room.updated_at = nowIso();
      const after = `${room.source_group_ids || []}|${room.target_group_ids || []}`;
      if (before !== after) roomCount++;
    }
    let templateCount = 0;
    for (const template of state.localState?.templates || []) {
      const before = `${template.default_source_group_ids || []}|${template.default_target_group_ids || []}`;
      template.default_source_group_ids = Array.isArray(template.default_source_group_ids) ? template.default_source_group_ids.filter((id) => normalizeNumber(id, -1) !== gid) : [];
      template.default_target_group_ids = Array.isArray(template.default_target_group_ids) ? template.default_target_group_ids.filter((id) => normalizeNumber(id, -1) !== gid) : [];
      template.updated_at = nowIso();
      const after = `${template.default_source_group_ids || []}|${template.default_target_group_ids || []}`;
      if (before !== after) templateCount++;
    }
    if (state.localState?.ui?.selected_group_id === gid) {
      state.localState.ui.selected_group_id = controllerGroups().find((group) => group.id !== gid)?.id ?? 0;
    }
    syncActiveRoomAlias(activeRoom());
    return { devices: deviceCount, rooms: roomCount, templates: templateCount };
  }

  async function saveGroupFromModal() {
    const modal = state.groupFormModal;
    if (!modal) return;
    const name = String(modal.name || '').trim();
    if (!name) {
      alert('分组名称不能为空。');
      return;
    }
    let group = null;
    let mode = modal.mode;
    if (mode === 'edit') {
      group = groupSlotById(modal.groupId);
      if (!group) {
        alert('要编辑的分组不存在。');
        return;
      }
    } else {
      const groupId = nextGroupId();
      group = createGroupContainer(groupId);
      mode = 'create';
    }
    group.valid = true;
    group.name = name;
    group.note = String(modal.note || '').trim();
    group.target = 255;
    group.mode = 1;
    group.sense_mode = 'ring';
    if (mode === 'create') {
      group.rssi = -70;
      group.hold = 2000;
      group.template = '';
      group.effect_template_id = '';
      group.effect = 'builtin-breath';
      group.effect_ui = clone(buildDefaultGroups()[0].effect_ui);
      group.idle_effect = 'builtin-silent';
      group.silence = '';
      group.signal_ui = clone(buildDefaultGroups()[0].signal_ui);
      group.score = clone(buildDefaultGroups()[0].score);
    }
    group.updated_at = nowIso();
    state.localState.ui.selected_group_id = group.id;
    setExpandedGroupId(group.id);
    syncGroupEditorDraft(group);
    state.groupFormModal = null;
    const ok = await persistGroupState();
    if (!ok) {
      alert(mode === 'create' ? '分组已创建，但保存到控制端草稿失败。请检查连接后重试。' : '分组已更新，但保存到控制端草稿失败。请检查连接后重试。');
    }
    logDebug(`${mode === 'create' ? '新建' : '更新'}分组 | ${group.name}`);
    render();
  }

  function createGroupDraft() {
    openGroupFormModal(null);
  }

  function editGroupDraft(groupId) {
    const group = groupSlotById(normalizeNumber(groupId, -1));
    if (!group) return;
    state.localState.ui.selected_group_id = group.id;
    setExpandedGroupId(group.id);
    syncGroupEditorDraft(group);
    openGroupFormModal(group);
  }

  async function deleteGroupDraft(groupId) {
    const gid = normalizeNumber(groupId, -1);
    const group = groupSlotById(gid);
    if (!group) return;
    state.groupDeleteModal = {
      open: true,
      groupId: gid,
      name: String(group.name || `分组${gid + 1}`),
      refs: groupReferenceStats(gid)
    };
    render();
  }

  async function confirmDeleteGroupDraft() {
    const modal = state.groupDeleteModal;
    if (!modal) return;
    const gid = normalizeNumber(modal.groupId, -1);
    const group = groupSlotById(gid);
    if (!group) {
      state.groupDeleteModal = null;
      render();
      return;
    }
    const refs = removeGroupReferences(gid);
    const nextSelection = controllerGroups().find((item) => item.id !== gid) || null;
    group.valid = false;
    group.name = '';
    group.note = '';
    group.target = 255;
    group.mode = 1;
    group.sense_mode = 'ring';
    group.rssi = -70;
    group.hold = 2000;
    group.template = '';
    group.effect_template_id = '';
    group.effect = 'builtin-breath';
    group.effect_ui = clone(buildDefaultGroups()[0].effect_ui);
    group.idle_effect = 'builtin-silent';
    group.silence = '';
    group.signal_ui = clone(buildDefaultGroups()[0].signal_ui);
    group.score = clone(buildDefaultGroups()[0].score);
    group.updated_at = nowIso();
    state.localState.ui.selected_group_id = nextSelection?.id ?? 0;
    setExpandedGroupId(nextSelection?.id ?? -1);
    syncGroupEditorDraft(nextSelection);
    state.groupDeleteModal = null;
    const ok = await persistGroupState();
    if (!ok) {
      alert('分组已删除，但保存到控制端草稿失败。请检查连接后重试。');
    }
    logDebug(`删除分组 | ${gid} | devices=${refs.devices} rooms=${refs.rooms} templates=${refs.templates}`);
    render();
  }

  function deleteDevice(mac) {
    const value = String(mac || '').trim();
    if (!value) return;
    const device = controllerDevices().find((item) => item.mac === value);
    if (!device) return;
    if (!confirm(`确认删除设备 ${device.name || value}？`)) return;
    const hidden = new Set(Array.isArray(state.localState?.hidden_devices) ? state.localState.hidden_devices : []);
    hidden.add(value);
    state.localState.hidden_devices = Array.from(hidden);
    state.selectedDeviceIds.delete(value);
    if (state.editingMac === value) cancelEditDevice();
    persistStateToServer();
    render();
    logDebug(`设备已删除（本地隐藏） | ${value}`);
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

  async function identifyDevicesByIdx(devices, label = '设备') {
    const list = (Array.isArray(devices) ? devices : [])
      .map((device) => {
        const source = device?.device || device;
        return {
          idx: normalizeNumber(source?.idx, -1),
          name: deviceDraftName(source) || String(source?.name || source?.mac || '')
        };
      })
      .filter((item, index, arr) => item.idx >= 0 && arr.findIndex((other) => other.idx === item.idx) === index);
    if (!list.length) {
      logDebug(`${label}点名失败 | 没有可点名设备`);
      return;
    }
    if (!state.controllerOnline) {
      logDebug(`${label}点名失败 | 控制端未连接`);
      return;
    }
    try {
      setBusy('identify', true);
      for (const item of list) {
        await requestJson(`/api/controller/identify?idx=${encodeURIComponent(item.idx)}&t=${Date.now()}`, {
          method: 'GET',
          timeoutMs: 6000
        });
        await sleep(120);
      }
      logDebug(`${label}点名 | ${list.length} 台 | ${list.map((item) => item.name || `idx${item.idx}`).join(' / ')}`);
    } catch (err) {
      logDebug(`${label}点名失败 | ${err.message}`);
    } finally {
      setBusy('identify', false);
    }
  }

  async function identifyGroupDevices(groupId) {
    const gid = normalizeNumber(groupId, -1);
    const group = groupSlotById(gid);
    const devices = groupDevices(gid);
    await identifyDevicesByIdx(devices, `分组「${group?.name || `分组${gid + 1}`}」`);
  }

  async function identifyRoomDevices(roomId = activeRoomId()) {
    const room = roomById(roomId) || currentRoom();
    const devices = roomSelectedDevices(room).map((item) => item.device);
    await identifyDevicesByIdx(devices, `房间「${room?.name || '当前房间'}」参与设备`);
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
      await loadFromController();
      if (!state.controllerOnline) {
        logDebug('扫描设备失败 | 控制端未连接');
        return;
      }
    }
    try {
      setBusy('scan', true);
      await requestJson(`/api/controller/scan?t=${Date.now()}`, {
        method: 'GET',
        timeoutMs: 8000
      });
      logDebug('扫描设备 | 已发送 DISCOVER');
      await sleep(900);
      await loadFromController();
      await sleep(1800);
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
    const room = currentRoom() || ensureRoomDraft();
    const sourceTemplate = activeTemplate() || state.localState.templates[0] || builtinTemplates[0];
    const draftSource = {
      name: '我的模板',
      note: '从当前房间配置创建',
      feature_preset_id: String(room.feature_preset_id || sourceTemplate?.feature_preset_id || ''),
      effect_preset_id: String(room.effect_preset_id || sourceTemplate?.effect_preset_id || ''),
      source_group_mode: (Array.isArray(room.source_group_ids) ? room.source_group_ids.length : 0) > 1 ? 'multi' : 'single',
      target_group_mode: (Array.isArray(room.target_group_ids) ? room.target_group_ids.length : 0) > 1 ? 'multi' : 'single',
      sense_mode: String(room.sense_mode || sourceTemplate?.sense_mode || ''),
      idle_effect_id: String(room.idle_effect_id || sourceTemplate?.idle_effect_id || ''),
      trigger_effect_id: String(room.trigger_effect_id || sourceTemplate?.trigger_effect_id || ''),
      scoring: room.scoring && typeof room.scoring === 'object' ? clone(room.scoring) : clone(sourceTemplate?.scoring || {})
    };
    openTemplateFormModal(draftSource, { mode: 'create', name: '我的模板', note: '从当前房间配置创建' });
  }

  function cloneTemplate(templateId) {
    const source = state.localState.templates.find((item) => item.id === templateId);
    if (!source) return;
    openTemplateFormModal(source, { mode: 'create', name: `${source.name} 副本`, note: `复制自 ${source.name}` });
  }

  function deleteTemplate(templateId) {
    const template = state.localState.templates.find((item) => item.id === templateId);
    if (!template) return;
    if (template.builtIn) {
      alert('内置模板不能删除，可以复制一份再编辑。');
      return;
    }
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
    if (!template) return;
    if (template.config) {
      const next = normalizeControllerState(template.config, state.controllerState);
      state.controllerState = mergeDraftsIntoController(next, state.localState);
    } else {
      const room = ensureRoomDraft(template.id);
      applyTemplateDefaultsToRoom(room, template, { overwrite: true });
      updateRoomDraftSummary(room);
      upsertRoom(room, { activate: true });
    }
    state.selectedTemplateId = template.id;
    state.localState.ui.selected_template_id = template.id;
    persistStateToServer();
    logDebug(`应用模板 | ${template.name}`);
    render();
  }

  function parseGroupList(value) {
    return String(value || '')
      .split(/[\s,，;；]+/)
      .map((part) => normalizeNumber(part, -1))
      .filter((gid) => gid >= 0)
      .filter((gid, idx, arr) => arr.indexOf(gid) === idx)
      .sort((a, b) => a - b);
  }

  function selectedTemplate() {
    return state.localState?.templates?.find((item) => item.id === state.selectedTemplateId) || state.localState?.templates?.[0] || null;
  }

  function selectedFeaturePreset() {
    const id = state.localState?.ui?.selected_play_preset_id || state.localState?.ui?.selected_feature_preset_id;
    return playPresetById(id) || featurePresetById(id);
  }

  function clonePlayPreset(presetId) {
    const source = playPresetById(presetId);
    if (!source) return;
    const next = normalizePlayPreset({
      ...clone(source),
      id: uid('play'),
      name: `${source.name || '玩法'} 副本`,
      builtIn: false,
      created_at: nowIso(),
      updated_at: nowIso()
    });
    state.localState.user_play_presets = normalizeUserPlayPresets([...(state.localState.user_play_presets || []), next]);
    rebuildPresetDerivedState(state.localState);
    state.localState.ui.selected_play_preset_id = next.id;
    state.localState.ui.selected_feature_preset_id = next.id;
    state.localState.ui.selected_template_id = next.id;
    state.selectedTemplateId = next.id;
    persistStateToServer();
    render();
  }

  function deletePlayPreset(presetId) {
    const preset = playPresetById(presetId);
    if (!preset || preset.builtIn === true) {
      alert('系统默认玩法预设不能删除。');
      return;
    }
    const blockingRooms = roomList().filter((room) => String(room?.play_preset_id || room?.feature_preset_id || room?.template_id || '') === String(preset.id)
      && ['draft', 'published', 'running'].includes(String(room?.status || 'draft')));
    if (blockingRooms.length) {
      alert(`玩法预设「${preset.name}」正在被 ${blockingRooms[0].name || '某个房间'} 使用，请先改房间玩法或删除房间。`);
      return;
    }
    if (!confirm(`确认删除玩法预设「${preset.name}」？已结束房间和历史记录会保留冻结快照。`)) return;
    state.localState.user_play_presets = normalizeUserPlayPresets((state.localState.user_play_presets || []).filter((item) => String(item.id) !== String(preset.id)));
    rebuildPresetDerivedState(state.localState);
    if (String(state.localState.ui.selected_play_preset_id || '') === String(preset.id)) {
      const nextId = allPlayPresets()[0]?.id || '';
      state.localState.ui.selected_play_preset_id = nextId;
      state.localState.ui.selected_feature_preset_id = nextId;
      state.localState.ui.selected_template_id = nextId;
      state.selectedTemplateId = nextId;
    }
    persistStateToServer();
    render();
  }

  function openPlayPresetDeleteModal(presetId) {
    const preset = playPresetById(presetId);
    if (!preset || preset.builtIn === true) {
      alert('系统默认玩法预设不能删除。');
      return;
    }
    const blockingRooms = roomList().filter((room) => String(room?.play_preset_id || room?.feature_preset_id || room?.template_id || '') === String(preset.id)
      && ['draft', 'published', 'running'].includes(String(room?.status || 'draft')));
    if (blockingRooms.length) {
      alert(`玩法预设「${preset.name}」正在被 ${blockingRooms[0].name || '某个房间'} 使用，请先改房间玩法或删除房间。`);
      return;
    }
    state.playPresetDeleteModal = {
      open: true,
      presetId: String(preset.id),
      name: String(preset.name || '未命名玩法'),
      note: String(preset.note || ''),
      historyOnly: true
    };
    render();
  }

  function closePlayPresetDeleteModal() {
    state.playPresetDeleteModal = null;
    render();
  }

  function confirmDeletePlayPresetModal() {
    const modal = state.playPresetDeleteModal;
    if (!modal?.presetId) return;
    const presetId = String(modal.presetId);
    state.localState.user_play_presets = normalizeUserPlayPresets((state.localState.user_play_presets || []).filter((item) => String(item.id) !== presetId));
    rebuildPresetDerivedState(state.localState);
    if (String(state.localState.ui.selected_play_preset_id || '') === presetId) {
      const nextId = allPlayPresets()[0]?.id || '';
      state.localState.ui.selected_play_preset_id = nextId;
      state.localState.ui.selected_feature_preset_id = nextId;
      state.localState.ui.selected_template_id = nextId;
      state.selectedTemplateId = nextId;
    }
    state.playPresetDeleteModal = null;
    persistStateToServer();
    render();
  }

  function playPresetFormSource(presetOrId = null) {
    if (!presetOrId) return null;
    if (typeof presetOrId === 'string') return playPresetById(presetOrId);
    if (presetOrId && typeof presetOrId === 'object') return normalizePlayPreset(presetOrId);
    return null;
  }

  function openPlayPresetFormModal(presetOrId = null, options = {}) {
    const source = playPresetFormSource(presetOrId) || normalizePlayPreset(buildDefaultPlayPresets()[0]);
    const editing = String(options.mode || '') === 'edit' && source.builtIn !== true;
    const signal = source.signal || {};
    const trigger = source.trigger || {};
    const score = source.score || {};
    const repeat = source.repeat || {};
    const after = source.afterTrigger || {};
    const feedback = source.feedback || {};
    const meter = feedback.signalMeter || {};
    state.playPresetFormModal = {
      open: true,
      mode: editing ? 'edit' : 'create',
      sourceId: String(source.id || ''),
      presetId: editing ? String(source.id || '') : '',
      name: editing ? String(source.name || '') : String(options.name || (source.builtIn ? `${source.name || '玩法'} 自定义版` : '新玩法预设')),
      note: editing ? String(source.note || '') : String(options.note || (source.builtIn ? `基于系统玩法「${source.name || '玩法'}」新建。` : '')),
      baseTemplate: String(source.baseTemplate || 'instant_score'),
      relation_mode: String(source.relation?.mode || 'many_to_many'),
      relation_match: String(source.relation?.match || 'source_to_target'),
      signal_type: String(signal.type || 'enter_range'),
      signal_rssi_min: normalizeNumber(signal.rssiMin, DEFAULT_TRIGGER_RSSI),
      signal_rssi_max: signal.rssiMax === null || signal.rssiMax === undefined ? '' : normalizeNumber(signal.rssiMax, -20),
      signal_hold_ms: normalizeNumber(signal.holdMs, DEFAULT_TRIGGER_HOLD_MS),
      signal_missing_ms: normalizeNumber(signal.missingMs, 3000),
      signal_smooth_samples: clamp(normalizeNumber(signal.smoothSamples, 5), 1, 10),
      trigger_mode: String(trigger.mode || 'instant'),
      trigger_target_ms: normalizeNumber(trigger.targetMs, 0),
      trigger_target_count: normalizeNumber(trigger.targetCount, 1),
      trigger_period_ms: normalizeNumber(trigger.periodMs, 0),
      score_target: String(score.target || 'source_player'),
      score_points: normalizeNumber(score.points, 1),
      repeat_mode: String(repeat.mode || 'once_per_pair'),
      repeat_cooldown_ms: normalizeNumber(repeat.cooldownMs, 5000),
      after_target_state: String(after.targetState || 'none'),
      after_timer_action: String(after.timerAction || 'none'),
      feedback_enter: String(feedback.onEnter || 'builtin-breath'),
      feedback_success: String(feedback.onSuccess || 'builtin-pulse'),
      feedback_fail: String(feedback.onFail || 'builtin-silent'),
      meter_enabled: meter.enabled === true,
      meter_port: clamp(normalizeNumber(meter.port, 1), 1, 3),
      meter_led_count: clamp(normalizeNumber(meter.ledCount, 10), 1, 200),
      meter_weak_rssi: normalizeNumber(meter.weakRssi, -90),
      meter_strong_rssi: normalizeNumber(meter.strongRssi, normalizeNumber(signal.rssiMin, DEFAULT_TRIGGER_RSSI)),
      meter_compression: clamp(normalizeNumber(meter.compressionX100, 100), 20, 500)
    };
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector('[data-role="play-preset-form-input"][data-play-preset-form-field="name"]');
      if (input) {
        input.focus();
        input.select?.();
      }
    });
  }

  function closePlayPresetFormModal() {
    state.playPresetFormModal = null;
    render();
  }

  function updatePlayPresetFormModalField(field, value, target = null) {
    const form = state.playPresetFormModal;
    if (!form) return;
    if (field === 'meter_enabled') {
      form[field] = target ? !!target.checked : value === true || String(value) === 'true' || String(value) === 'on';
      return;
    }
    const numericFields = new Set([
      'signal_rssi_min',
      'signal_hold_ms',
      'signal_missing_ms',
      'signal_smooth_samples',
      'trigger_target_ms',
      'trigger_target_count',
      'trigger_period_ms',
      'score_points',
      'repeat_cooldown_ms',
      'meter_port',
      'meter_led_count',
      'meter_weak_rssi',
      'meter_strong_rssi',
      'meter_compression'
    ]);
    if (field === 'signal_rssi_max') {
      form[field] = String(value ?? '').trim() === '' ? '' : normalizeNumber(value, -20);
    } else if (numericFields.has(field)) {
      form[field] = normalizeNumber(value, form[field]);
    } else {
      form[field] = String(value ?? '');
    }
  }

  function savePlayPresetFormModal() {
    const form = state.playPresetFormModal;
    if (!form) return;
    const name = String(form.name || '').trim();
    if (!name) {
      alert('请填写玩法名称。');
      return;
    }
    const now = nowIso();
    const source = playPresetById(form.sourceId) || normalizePlayPreset(buildDefaultPlayPresets()[0]);
    const editing = String(form.mode || '') === 'edit' && String(form.presetId || '').trim();
    const id = editing ? String(form.presetId) : uid('play');
    const points = normalizeNumber(form.score_points, 1);
    const next = normalizePlayPreset({
      ...clone(source),
      id,
      name,
      note: String(form.note || '').trim(),
      builtIn: false,
      baseTemplate: ['instant_score', 'sustain_score', 'competition_score'].includes(String(form.baseTemplate)) ? String(form.baseTemplate) : 'instant_score',
      relation: {
        ...(source.relation || {}),
        mode: String(form.relation_mode || 'many_to_many'),
        match: String(form.relation_match || 'source_to_target')
      },
      signal: {
        ...(source.signal || {}),
        type: String(form.signal_type || 'enter_range'),
        rssiMin: normalizeNumber(form.signal_rssi_min, DEFAULT_TRIGGER_RSSI),
        rssiMax: String(form.signal_rssi_max ?? '').trim() === '' ? null : normalizeNumber(form.signal_rssi_max, -20),
        holdMs: normalizeNumber(form.signal_hold_ms, DEFAULT_TRIGGER_HOLD_MS),
        missingMs: normalizeNumber(form.signal_missing_ms, 3000),
        smoothSamples: clamp(normalizeNumber(form.signal_smooth_samples, 5), 1, 10)
      },
      trigger: {
        ...(source.trigger || {}),
        mode: String(form.trigger_mode || 'instant'),
        targetMs: normalizeNumber(form.trigger_target_ms, 0),
        targetCount: normalizeNumber(form.trigger_target_count, 1),
        periodMs: normalizeNumber(form.trigger_period_ms, 0)
      },
      score: {
        ...(source.score || {}),
        target: String(form.score_target || 'source_player'),
        points,
        type: points === 0 ? 'none' : points < 0 ? 'subtract' : 'add'
      },
      repeat: {
        ...(source.repeat || {}),
        mode: String(form.repeat_mode || 'once_per_pair'),
        cooldownMs: normalizeNumber(form.repeat_cooldown_ms, 5000)
      },
      afterTrigger: {
        ...(source.afterTrigger || {}),
        targetState: String(form.after_target_state || 'none'),
        timerAction: String(form.after_timer_action || 'none')
      },
      feedback: {
        ...(source.feedback || {}),
        onEnter: String(form.feedback_enter || 'builtin-breath'),
        onSuccess: String(form.feedback_success || 'builtin-pulse'),
        onFail: String(form.feedback_fail || 'builtin-silent'),
        signalMeter: {
          enabled: form.meter_enabled === true,
          port: clamp(normalizeNumber(form.meter_port, 1), 1, 3),
          ledCount: clamp(normalizeNumber(form.meter_led_count, 10), 1, 200),
          weakRssi: normalizeNumber(form.meter_weak_rssi, -90),
          strongRssi: normalizeNumber(form.meter_strong_rssi, normalizeNumber(form.signal_rssi_min, DEFAULT_TRIGGER_RSSI)),
          compressionX100: clamp(normalizeNumber(form.meter_compression, 100), 20, 500)
        }
      },
      created_at: editing ? String(source.created_at || now) : now,
      updated_at: now
    });
    const existing = Array.isArray(state.localState.user_play_presets) ? state.localState.user_play_presets : [];
    const nextList = editing
      ? existing.map((item) => String(item.id) === id ? next : item)
      : [next, ...existing];
    state.localState.user_play_presets = normalizeUserPlayPresets(nextList);
    rebuildPresetDerivedState(state.localState);
    state.localState.ui.selected_play_preset_id = next.id;
    state.localState.ui.selected_feature_preset_id = next.id;
    state.localState.ui.selected_template_id = next.id;
    state.selectedTemplateId = next.id;
    state.playPresetFormModal = null;
    persistStateToServer();
    render();
  }

  function selectedEffectPreset() {
    return effectPresetById(state.localState?.ui?.selected_effect_preset_id);
  }

  function updateSelectedTemplateField(field, value) {
    const template = selectedTemplate();
    if (!template) return;
    switch (field) {
      case 'name':
      case 'note':
      case 'feature_preset_id':
      case 'effect_preset_id':
      case 'source_group_mode':
      case 'target_group_mode':
      case 'sense_mode':
      case 'idle_effect_id':
      case 'trigger_effect_id':
        template[field] = String(value || '');
        break;
      case 'scoring_mode':
        template.scoring = { ...(template.scoring || {}), mode: String(value || '') };
        break;
      case 'scoring_max_find':
        template.scoring = { ...(template.scoring || {}), max_find: normalizeNumber(value, 0) };
        break;
      default:
        break;
    }
    template.updated_at = nowIso();
    persistStateToServer();
    render();
  }

  function updateSelectedFeaturePresetField(field, value, options = {}) {
    let preset = selectedFeaturePreset();
    if (!preset) return;
    if (preset.builtIn === true) {
      clonePlayPreset(preset.id);
      preset = selectedFeaturePreset();
      if (!preset) return;
    }
    preset.relation = preset.relation && typeof preset.relation === 'object' ? preset.relation : {};
    preset.signal = preset.signal && typeof preset.signal === 'object' ? preset.signal : {};
    preset.trigger = preset.trigger && typeof preset.trigger === 'object' ? preset.trigger : {};
    preset.score = preset.score && typeof preset.score === 'object' ? preset.score : {};
    preset.repeat = preset.repeat && typeof preset.repeat === 'object' ? preset.repeat : {};
    preset.afterTrigger = preset.afterTrigger && typeof preset.afterTrigger === 'object' ? preset.afterTrigger : {};
    preset.feedback = preset.feedback && typeof preset.feedback === 'object' ? preset.feedback : {};
    preset.feedback.signalMeter = preset.feedback.signalMeter && typeof preset.feedback.signalMeter === 'object'
      ? preset.feedback.signalMeter
      : { enabled: false, port: 1, ledCount: 10, weakRssi: -90, strongRssi: normalizeNumber(preset.signal?.rssiMin, DEFAULT_TRIGGER_RSSI) };
    switch (field) {
      case 'name':
      case 'note':
        preset[field] = String(value || '');
        break;
      case 'baseTemplate':
        preset.baseTemplate = ['instant_score', 'sustain_score', 'competition_score'].includes(String(value)) ? String(value) : 'instant_score';
        break;
      case 'relation_mode':
        preset.relation.mode = String(value || 'many_to_many');
        break;
      case 'relation_match':
        preset.relation.match = String(value || 'source_to_target');
        break;
      case 'signal_type':
        preset.signal.type = String(value || 'enter_range');
        break;
      case 'signal_rssi_min':
        preset.signal.rssiMin = normalizeNumber(value, DEFAULT_TRIGGER_RSSI);
        break;
      case 'signal_rssi_max':
        preset.signal.rssiMax = String(value ?? '').trim() === '' ? null : normalizeNumber(value, -20);
        break;
      case 'signal_hold_ms':
        preset.signal.holdMs = normalizeNumber(value, DEFAULT_TRIGGER_HOLD_MS);
        break;
      case 'signal_missing_ms':
        preset.signal.missingMs = normalizeNumber(value, 3000);
        break;
      case 'signal_smooth_samples':
        preset.signal.smoothSamples = clamp(normalizeNumber(value, 5), 1, 10);
        break;
      case 'trigger_mode':
        preset.trigger.mode = String(value || 'instant');
        break;
      case 'trigger_target_ms':
        preset.trigger.targetMs = normalizeNumber(value, 0);
        break;
      case 'trigger_target_count':
        preset.trigger.targetCount = normalizeNumber(value, 1);
        break;
      case 'trigger_period_ms':
        preset.trigger.periodMs = normalizeNumber(value, 0);
        break;
      case 'score_target':
        preset.score.target = String(value || 'source_player');
        break;
      case 'score_points':
        preset.score.points = normalizeNumber(value, 1);
        preset.score.type = preset.score.points === 0 ? 'none' : preset.score.points < 0 ? 'subtract' : 'add';
        break;
      case 'repeat_mode':
        preset.repeat.mode = String(value || 'once_per_pair');
        break;
      case 'repeat_cooldown_ms':
        preset.repeat.cooldownMs = normalizeNumber(value, 5000);
        break;
      case 'after_target_state':
        preset.afterTrigger.targetState = String(value || 'none');
        break;
      case 'after_timer_action':
        preset.afterTrigger.timerAction = String(value || 'none');
        break;
      case 'feedback_success':
        preset.feedback.onSuccess = String(value || 'builtin-pulse');
        break;
      case 'feedback_enter':
        preset.feedback.onEnter = String(value || 'builtin-breath');
        break;
      case 'meter_enabled':
        preset.feedback.signalMeter.enabled = value === true || String(value) === 'true' || String(value) === 'on';
        break;
      case 'meter_port':
        preset.feedback.signalMeter.port = clamp(normalizeNumber(value, 1), 1, 3);
        break;
      case 'meter_led_count':
        preset.feedback.signalMeter.ledCount = clamp(normalizeNumber(value, 10), 1, 200);
        break;
      case 'meter_weak_rssi':
        preset.feedback.signalMeter.weakRssi = normalizeNumber(value, -90);
        break;
      case 'meter_strong_rssi':
        preset.feedback.signalMeter.strongRssi = normalizeNumber(value, normalizeNumber(preset.signal?.rssiMin, DEFAULT_TRIGGER_RSSI));
        break;
      case 'meter_compression':
        preset.feedback.signalMeter.compressionX100 = clamp(normalizeNumber(value, 100), 20, 500);
        break;
      case 'sense_mode':
      case 'idle_effect_id':
      case 'trigger_effect_id':
        preset.feature_ui = preset.feature_ui && typeof preset.feature_ui === 'object' ? preset.feature_ui : {};
        preset.feature_ui[field] = String(value || '');
        break;
      case 'signal_rssi_threshold':
        preset.feature_ui = preset.feature_ui && typeof preset.feature_ui === 'object' ? preset.feature_ui : {};
        preset.feature_ui.signal_ui = preset.feature_ui.signal_ui && typeof preset.feature_ui.signal_ui === 'object' ? preset.feature_ui.signal_ui : {};
        preset.feature_ui.signal_ui.trigger_rssi_threshold = normalizeNumber(value, DEFAULT_TRIGGER_RSSI);
        break;
      case 'signal_compare':
        preset.feature_ui = preset.feature_ui && typeof preset.feature_ui === 'object' ? preset.feature_ui : {};
        preset.feature_ui.signal_ui = preset.feature_ui.signal_ui && typeof preset.feature_ui.signal_ui === 'object' ? preset.feature_ui.signal_ui : {};
        preset.feature_ui.signal_ui.trigger_compare = triggerCompareValue(value);
        break;
      case 'signal_hold_ms':
        preset.feature_ui = preset.feature_ui && typeof preset.feature_ui === 'object' ? preset.feature_ui : {};
        preset.feature_ui.signal_ui = preset.feature_ui.signal_ui && typeof preset.feature_ui.signal_ui === 'object' ? preset.feature_ui.signal_ui : {};
        preset.feature_ui.signal_ui.trigger_hold_ms = normalizeNumber(value, 2000);
        break;
      case 'timer_mode':
        preset.feature_ui = preset.feature_ui && typeof preset.feature_ui === 'object' ? preset.feature_ui : {};
        preset.feature_ui.timer = preset.feature_ui.timer && typeof preset.feature_ui.timer === 'object' ? preset.feature_ui.timer : {};
        preset.feature_ui.timer.mode = String(value || '');
        break;
      case 'timer_duration_ms':
        preset.feature_ui = preset.feature_ui && typeof preset.feature_ui === 'object' ? preset.feature_ui : {};
        preset.feature_ui.timer = preset.feature_ui.timer && typeof preset.feature_ui.timer === 'object' ? preset.feature_ui.timer : {};
        preset.feature_ui.timer.duration_ms = normalizeNumber(value, 0);
        break;
      case 'scoring_mode':
        preset.feature_ui = preset.feature_ui && typeof preset.feature_ui === 'object' ? preset.feature_ui : {};
        preset.feature_ui.scoring = preset.feature_ui.scoring && typeof preset.feature_ui.scoring === 'object' ? preset.feature_ui.scoring : {};
        preset.feature_ui.scoring.mode = String(value || '');
        break;
      case 'scoring_max_find':
        preset.feature_ui = preset.feature_ui && typeof preset.feature_ui === 'object' ? preset.feature_ui : {};
        preset.feature_ui.scoring = preset.feature_ui.scoring && typeof preset.feature_ui.scoring === 'object' ? preset.feature_ui.scoring : {};
        preset.feature_ui.scoring.max_find = normalizeNumber(value, 0);
        break;
      default:
        break;
    }
    preset.updated_at = nowIso();
    state.localState.user_play_presets = normalizeUserPlayPresets((state.localState.user_play_presets || []).map((item) => String(item.id) === String(preset.id) ? normalizePlayPreset({ ...preset, builtIn: false }) : item));
    rebuildPresetDerivedState(state.localState);
    persistStateToServer();
    if (options.render !== false) render();
  }

  function updateSelectedEffectPresetField(field, value) {
    const preset = selectedEffectPreset();
    if (!preset) return;
    switch (field) {
      case 'name':
      case 'note':
        preset[field] = String(value || '');
        break;
      default:
        break;
    }
    preset.effect_ui = normalizeEffectUI(preset.effect_ui || {}, preset.effect_ui || {});
    preset.updated_at = nowIso();
    syncEffectPresetSummary(preset);
    persistStateToServer();
    render();
  }

  function updateSelectedEffectTrackField(trackIndex, field, value) {
    const preset = selectedEffectPreset();
    if (!preset) return;
    preset.effect_ui = normalizeEffectUI(preset.effect_ui || {}, preset.effect_ui || {});
    const tracks = Array.isArray(preset.effect_ui.tracks) ? preset.effect_ui.tracks : [];
    const idx = clamp(normalizeNumber(trackIndex, 0), 0, EFFECT_TRACK_LIMIT - 1);
    const track = tracks[idx] || buildDefaultEffectTrack('solid', idx);
    switch (field) {
      case 'enabled':
        track.enabled = value === true || value === 'true' || value === 'on' || value === '1';
        break;
      case 'template_id': {
        const templateId = String(value || '').trim() || effectTemplateIdForMode(track.mode || 'solid');
        const nextTrack = effectTrackFromTemplate(templateId, idx, {
          id: track.id,
          enabled: track.enabled,
          port: track.port,
          led_count: track.led_count,
          led_start: track.led_start,
          led_end: track.led_end,
          gap: track.gap
        });
        nextTrack.enabled = track.enabled !== false;
        nextTrack.port = clamp(normalizeNumber(track.port, idx + 1), 1, 3);
        tracks[idx] = nextTrack;
        preset.effect_ui.tracks = tracks.slice(0, EFFECT_TRACK_LIMIT).map((item, i) => normalizeEffectTrack(item, null, i));
        syncEffectPresetSummary(preset);
        preset.updated_at = nowIso();
        persistStateToServer();
        render();
        return;
      }
      case 'port':
        track[field] = clamp(normalizeNumber(value, track[field]), 1, 3);
        break;
      case 'led_count':
        track[field] = clamp(normalizeNumber(value, track[field]), 1, 9999);
        break;
      case 'led_start':
      case 'led_end':
        track[field] = clamp(normalizeNumber(value, track[field]), 1, 9999);
        if (field === 'led_start' && track.led_end < track.led_start) track.led_end = track.led_start;
        if (field === 'led_end' && track.led_end < track.led_start) track.led_start = track.led_end;
        break;
      case 'gap':
      case 'repeat':
      case 'accel':
      case 'pulse_speed_start':
      case 'pulse_speed_end':
      case 'pulse_duration_ms':
      case 'end_hold_ms':
        track[field] = Math.max(0, normalizeNumber(value, track[field]));
        break;
      case 'brightness':
      case 'duty':
        track[field] = clamp(normalizeNumber(value, track[field]), 0, 100);
        break;
      case 'frequency_hz':
        track[field] = Math.max(0, normalizeNumber(value, track[field]));
        break;
      case 'period_ms':
        track[field] = Math.max(0, normalizeNumber(value, track[field]));
        break;
      case 'mode':
      case 'end_behavior':
        track[field] = String(value || '');
        break;
      case 'colorA':
      case 'colorB':
      case 'colorC': {
        const colorIndex = field === 'colorA' ? 0 : field === 'colorB' ? 1 : 2;
        track.colors = Array.isArray(track.colors) ? track.colors.slice(0, 3) : [];
        while (track.colors.length < 3) track.colors.push('#FFFFFF');
        track.colors[colorIndex] = String(value || '#FFFFFF');
        break;
      }
      default:
        break;
    }
    tracks[idx] = track;
    preset.effect_ui.tracks = tracks.slice(0, EFFECT_TRACK_LIMIT).map((item, i) => normalizeEffectTrack(item, null, i));
    syncEffectPresetSummary(preset);
    preset.updated_at = nowIso();
    persistStateToServer();
    render();
  }

  function createRoomFromTemplate(templateId = state.selectedTemplateId || activeTemplate()?.id || builtinTemplates[0].id) {
    state.activeTab = 'room';
    state.localState.ui.active_tab = 'room';
    openWizard(templateId || builtinTemplates[0].id, { forceNew: true });
  }

  async function prepareRoom(room = currentRoom(), { force = false } = {}) {
    if (state.busy.publish || state.preparingRoomId) {
      logDebug('设备预备正在进行，已忽略重复点击');
      return false;
    }
    if (!room) return false;
    if (room.status === 'running') {
      alert('请先停止进行中的游戏，再进行设备预备。');
      return false;
    }
    if (!force) {
      return openRoomPrepareModal(room);
    }
    const { issues } = validateRoomReady(room);
    if (issues.length) {
      alert(issues[0]);
      if (state.activeTab !== 'room') {
        state.activeTab = 'room';
        state.localState.ui.active_tab = 'room';
      }
      render();
      return false;
    }
    try {
      state.preparingRoomId = room.id;
      setBusy('publish', true);
      await stopEffectsBeforeRuntimeTransition(room, '设备预备');
      const saved = await persistDraftToServer();
      if (!saved) return false;
      showRuntimeWarnings(buildControllerPayload());
      await requestJson('/api/publish', {
        method: 'POST',
        timeoutMs: 60000,
        body: JSON.stringify({ source: 'ui_rebuild_room_prepare', room_id: room.id })
      });
      const now = nowIso();
      room.status = 'published';
      room.published_at = now;
      room.publish_result = { ok: true, published_at: now, controller: state.controllerBase || '/api/controller' };
      room.started_at = '';
      room.ended_at = '';
      room.updated_at = now;
      updateRoomDraftSummary(room);
      upsertRoom(room, { activate: true });
      state.roomPrepareModal = null;
      await persistStateToServer();
      try {
        await loadFromController();
      } catch (refreshErr) {
        logDebug(`设备预备后刷新控制端状态失败 | ${refreshErr.message}`);
      }
      logDebug(`设备预备完成 | ${room.name}`);
      render();
      return true;
    } catch (err) {
      room.publish_result = { ok: false, error: String(err.message || err) };
      room.updated_at = nowIso();
      updateRoomDraftSummary(room);
      upsertRoom(room, { activate: true });
      await persistStateToServer();
      logDebug(`设备预备失败 | ${err.message}`);
      alert(`设备预备失败：${err.message}`);
      render();
      return false;
    } finally {
      state.preparingRoomId = '';
      setBusy('publish', false);
    }
  }

  async function publishRoom(room = currentRoom()) {
    return prepareRoom(room, { force: true });
  }

  async function stopEffectsBeforeRuntimeTransition(room = currentRoom(), label = '运行切换') {
    try {
      await requestJson(`/api/controller/cmd?name=STOP&t=${Date.now()}`, {
        method: 'GET',
        timeoutMs: 12000
      });
      logDebug(`${label}前已自动停止测试灯效/熄灭设备 | ${room?.name || '当前房间'}`);
      return true;
    } catch (err) {
      if (isSoftStopDisconnectError(err)) {
        logDebug(`${label}前停止测试灯效收到代理断连响应，按成功处理 | ${room?.name || '当前房间'}`);
        return true;
      }
      logDebug(`${label}前停止测试灯效失败 | ${err.message}`);
      throw err;
    }
  }

  async function testRoomTriggerEffects(room = currentRoom()) {
    if (state.busy.publish || state.busy.testEffect || state.preparingRoomId) {
      logDebug('测试效果正在进行，已忽略重复点击');
      return false;
    }
    if (!room) return false;
    const { issues } = validateRoomReady(room);
    if (issues.length) {
      alert(issues[0]);
      return false;
    }
    try {
      state.preparingRoomId = room.id;
      setBusy('testEffect', true);
      const saved = await persistDraftToServer();
      if (!saved) return false;
      showRuntimeWarnings(buildControllerPayload());
      await requestJson('/api/publish', {
        method: 'POST',
        timeoutMs: 60000,
        body: JSON.stringify({ source: 'ui_rebuild_room_test_effect', room_id: room.id })
      });
      const now = nowIso();
      room.status = 'published';
      room.published_at = now;
      room.publish_result = { ok: true, published_at: now, controller: state.controllerBase || '/api/controller', test_effect: true };
      room.started_at = '';
      room.ended_at = '';
      room.updated_at = now;
      updateRoomDraftSummary(room);
      upsertRoom(room, { activate: true });
      await persistStateToServer();
      await requestJson(`/api/controller/cmd?name=TEST_EFFECT&t=${Date.now()}`, {
        method: 'GET',
        timeoutMs: 15000
      });
      try {
        await loadFromController();
      } catch (refreshErr) {
        logDebug(`测试效果后刷新控制端状态失败 | ${refreshErr.message}`);
      }
      logDebug(`测试效果已发送 | ${room.name}`);
      renderDialogs();
      render();
      return true;
    } catch (err) {
      logDebug(`测试效果失败 | ${err.message}`);
      alert(`测试效果失败：${err.message}`);
      renderDialogs();
      render();
      return false;
    } finally {
      state.preparingRoomId = '';
      setBusy('testEffect', false);
    }
  }

  async function stopRoomTestEffects(room = currentRoom()) {
    if (state.busy.stopEffect) {
      logDebug('停止测试正在进行，已忽略重复点击');
      return false;
    }
    try {
      setBusy('stopEffect', true);
      await requestJson(`/api/controller/cmd?name=STOP&t=${Date.now()}`, {
        method: 'GET',
        timeoutMs: 12000
      });
      if (room) {
        room.updated_at = nowIso();
        updateRoomDraftSummary(room);
        upsertRoom(room, { activate: true });
        await persistStateToServer();
      }
      try {
        await loadFromController();
      } catch (refreshErr) {
        logDebug(`停止测试后刷新控制端状态失败 | ${refreshErr.message}`);
      }
      logDebug(`停止测试/熄灭已发送 | ${room?.name || '当前房间'}`);
      renderDialogs();
      render();
      return true;
    } catch (err) {
      logDebug(`停止测试失败 | ${err.message}`);
      alert(`停止测试失败：${err.message}`);
      renderDialogs();
      render();
      return false;
    } finally {
      setBusy('stopEffect', false);
    }
  }

  async function beginRoomStartCountdown(room = currentRoom()) {
    if (!room) return false;
    if (room.status !== 'published') {
      alert('请先完成设备预备，再开始游戏。');
      return false;
    }
    if (roomCountdownActive(room.id)) return true;
    try {
      setBusy('controller', true);
      await stopEffectsBeforeRuntimeTransition(room, '开始倒计时');
    } catch (err) {
      alert(`开始前停止测试灯效失败：${err.message}`);
      return false;
    } finally {
      setBusy('controller', false);
    }
    clearRoomCountdown({ silent: true });
    state.roomStartCountdown = {
      roomId: room.id,
      remaining: 10,
      started_at: nowIso()
    };
    render();
    state.roomCountdownTimer = window.setInterval(() => {
      if (!state.roomStartCountdown || String(state.roomStartCountdown.roomId || '') !== String(room.id)) {
        clearRoomCountdown({ silent: true });
        return;
      }
      const next = normalizeNumber(state.roomStartCountdown.remaining, 0) - 1;
      if (next <= 0) {
        clearRoomCountdown({ silent: true });
        executeRoomStart(room.id);
        return;
      }
      state.roomStartCountdown.remaining = next;
      render();
    }, 1000);
    logDebug(`开始倒计时 | ${room.name}`);
    return true;
  }

  async function executeRoomStart(roomId = activeRoomId()) {
    const room = roomById(roomId) || currentRoom();
    if (!room) return false;
    if (room.status !== 'published') {
      alert('请先完成设备预备，再开始游戏。');
      return false;
    }
    const { issues } = validateRoomReady(room);
    if (issues.length) {
      alert(issues[0]);
      if (state.activeTab !== 'room') {
        state.activeTab = 'room';
        state.localState.ui.active_tab = 'room';
      }
      render();
      return false;
    }
    try {
      setBusy('controller', true);
      await stopEffectsBeforeRuntimeTransition(room, '开始游戏');
      await requestJson(`/api/controller/cmd?name=START_GAME&t=${Date.now()}`, {
        method: 'GET',
        timeoutMs: 8000
      });
      room.status = 'running';
      room.started_at = room.started_at || nowIso();
      room.ended_at = '';
      room.updated_at = nowIso();
      upsertRoom(room, { activate: true });
      await persistStateToServer();
      logDebug(`开始游戏 | ${room.name}`);
      render();
      return true;
    } catch (err) {
      logDebug(`开始游戏失败 | ${room.name} | ${err.message}`);
      alert(`开始游戏失败：${err.message}`);
      return false;
    } finally {
      setBusy('controller', false);
    }
  }

  async function startRoom() {
    const room = currentRoom();
    if (!room) {
      createRoomFromTemplate();
      return;
    }
    await beginRoomStartCountdown(room);
  }

  async function endRoom() {
    const room = currentRoom();
    if (!room) return;
    if (room.status !== 'running') {
      alert('请先开始游戏，再停止。');
      return;
    }
    try {
      setBusy('controller', true);
      try {
        await requestJson(`/api/controller/cmd?name=STOP_GAME&t=${Date.now()}`, {
          method: 'GET',
          timeoutMs: 8000
        });
      } catch (err) {
        if (!isSoftStopDisconnectError(err)) throw err;
        logDebug(`停止游戏收到代理断连响应，按成功处理 | ${room.name}`);
      }
      try {
        await loadFromController();
      } catch (refreshErr) {
        logDebug(`停止后刷新控制端状态失败 | ${refreshErr.message}`);
      }
      room.status = 'ended';
      room.ended_at = nowIso();
      room.updated_at = nowIso();
      upsertRoom(room, { activate: true });
      const runtimeSummary = roomRuntimeSummary(room);
      const record = {
        schema: 1,
        type: 'room_session',
        room_id: room.id,
        room_name: room.name,
        template_id: room.template_id,
        template_name: room.template_name,
        status: room.status,
        started_at: room.started_at,
        ended_at: room.ended_at,
        duration: formatDuration(room.started_at, room.ended_at),
        device_count: controllerDevices().length,
        source_group_ids: Array.isArray(room.source_group_ids) ? room.source_group_ids.slice() : [],
        target_group_ids: Array.isArray(room.target_group_ids) ? room.target_group_ids.slice() : [],
        group_ids: Array.isArray(room.group_ids) && room.group_ids.length
          ? room.group_ids.slice()
          : Array.from(new Set([...(room.source_group_ids || []), ...(room.target_group_ids || [])])),
        sense_mode: String(room.sense_mode || ''),
        idle_effect_id: String(room.idle_effect_id || ''),
        trigger_effect_id: String(room.trigger_effect_id || ''),
        effect_rules: Array.isArray(room.effect_rules) ? clone(room.effect_rules) : [],
        scoring: room.scoring && typeof room.scoring === 'object' ? clone(room.scoring) : {},
        rule_overrides: room.rule_overrides && typeof room.rule_overrides === 'object' ? clone(room.rule_overrides) : {},
        match_bindings: Array.isArray(room.match_bindings) ? clone(room.match_bindings) : [],
        score_total: runtimeSummary.score_total,
        runtime_room_hash: runtimeSummary.roomHash,
        runtime_discoveries: runtimeSummary.discoveries.map((event) => ({
          room: event.room,
          self_idx: event.self_idx,
          peer_idx: event.peer_idx,
          self_mac: event.self_mac,
          peer_mac: event.peer_mac,
          self_group_mask: event.self_group_mask,
          peer_group_mask: event.peer_group_mask,
          rssi: event.rssi,
          event_ms: event.event_ms,
          line: event.line
        })),
        runtime_events: runtimeSummary.events.map((event) => ({
          room: event.room,
          self_idx: event.self_idx,
          peer_idx: event.peer_idx,
          self_mac: event.self_mac,
          peer_mac: event.peer_mac,
          self_group_mask: event.self_group_mask,
          peer_group_mask: event.peer_group_mask,
          rssi: event.rssi,
          event_ms: event.event_ms
        })),
        runtime_scoreboard: {
          source: runtimeSummary.by_source.map((item) => ({ idx: item.idx, label: item.label, count: item.count })),
          source_groups: runtimeSummary.by_source_group.map((item) => ({ label: item.label, count: item.count })),
          source_players: (runtimeSummary.scoreboard?.source_players || []).map((item) => ({ idx: item.idx, label: item.label, count: item.count })),
          target_players: (runtimeSummary.scoreboard?.target_players || []).map((item) => ({ idx: item.idx, label: item.label, count: item.count })),
          both_players: (runtimeSummary.scoreboard?.both_players || []).map((item) => ({ idx: item.idx, label: item.label, count: item.count })),
          target_groups: (runtimeSummary.scoreboard?.target_groups || []).map((item) => ({ label: item.label, count: item.count })),
          both_groups: (runtimeSummary.scoreboard?.both_groups || []).map((item) => ({ label: item.label, count: item.count })),
          score_target: runtimeSummary.score_target || 'source_player'
        },
        notes: room.notes || '',
        updated_at: nowIso()
      };
      const saved = await appendRoomRecord(record);
      state.roomRecords.unshift(saved);
      state.roomRecords = state.roomRecords.slice(0, 200);
      state.localState.room_history.unshift(saved);
      state.localState.room_history = state.localState.room_history.slice(0, 200);
      await persistStateToServer();
      persistRecordsCache();
      logDebug(`结束游戏 | ${room.name} / ${record.duration}`);
      state.roomFinalizeModal = roomFinalizeAudit(room);
      renderDialogs();
      render();
    } catch (err) {
      logDebug(`停止游戏失败 | ${room.name} | ${err.message}`);
      alert(`停止游戏失败：${err.message}`);
    } finally {
      setBusy('controller', false);
    }
  }

  async function deleteRoom(roomId = activeRoomId()) {
    const target = roomById(roomId);
    if (!target) return;
    if (target.status === 'running') {
      alert('请先停止正在进行的游戏，再删除房间。');
      return;
    }
    if (!confirm(`确认删除房间「${target.name || '未命名房间'}」？此操作会同时删除这个房间的历史记录。`)) return;
    const rooms = ensureRoomCollection();
    state.localState.rooms = rooms.filter((room) => room.id !== target.id);
    state.roomRecords = state.roomRecords.filter((record) => String(record.room_id || '') !== String(target.id));
    state.localState.room_history = Array.isArray(state.localState.room_history)
      ? state.localState.room_history.filter((record) => String(record.room_id || '') !== String(target.id))
      : [];
    const nextActive = state.localState.rooms.find((room) => room.id !== target.id) || state.localState.rooms[0] || null;
    syncActiveRoomAlias(nextActive);
    if (!state.localState.rooms.length) {
      state.selectedTemplateId = state.localState.ui.selected_template_id || builtinTemplates[0].id;
    }
    try {
      await requestJson(`/api/local/records?room_id=${encodeURIComponent(String(target.id || ''))}`, {
        method: 'DELETE',
        timeoutMs: 8000
      });
    } catch (err) {
      logDebug(`删除历史记录失败 | ${err.message}`);
    }
    await persistStateToServer();
    persistRecordsCache();
    logDebug(`删除房间 | ${target.name || target.id}`);
    render();
  }

  async function saveLocalConfig() {
    try {
      setBusy('save', true);
      await persistStateToServer();
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
    if (state.busy.publish || state.preparingRoomId) {
      logDebug('发布正在进行，已忽略重复点击');
      return;
    }
    const payload = buildControllerPayload();
    const limitError = validateDeviceGroupLimit(payload);
    if (limitError) {
      alert(limitError);
      return;
    }
    try {
      setBusy('publish', true);
      showRuntimeWarnings(payload);
      const saved = await persistDraftToServer();
      if (!saved) return;
      await requestJson('/api/publish', {
        method: 'POST',
        timeoutMs: 60000,
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
      state.localState.ui.expanded_group_id = -1;
      state.activeTab = state.localState.ui.active_tab || 'overview';
      state.deviceFilterMode = state.localState.ui.device_filter_mode || 'ungrouped';
      state.deviceFilterGroupId = normalizeNumber(state.localState.ui.device_filter_group_id, -1);
      state.selectedTemplateId = state.localState.ui.selected_template_id || builtinTemplates[0].id;
      state.currentRoomId = state.localState.active_room_id || state.localState.current_room?.id || state.localState.rooms?.[0]?.id || '';
      syncGroupEditorDraft(selectedGroup());
      syncActiveRoomAlias(roomById(state.currentRoomId) || state.localState.current_room || state.localState.rooms?.[0] || null);
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
    return `<button class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] border border-[rgba(91,118,152,0.28)] bg-[rgba(14,22,34,0.92)] text-[#dfe9f7] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-[rgba(128,170,222,0.44)] hover:bg-[rgba(24,35,52,0.96)] active:translate-y-px" type="button" title="${escapeHtml(tooltip)}" data-action="${action}">${svgIcon(iconName)}</button>`;
  }

  function renderTopActions() {
    const buttonBase = 'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[11px] border px-3 text-[11px] font-extrabold leading-none whitespace-nowrap shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:brightness-105 active:translate-y-px';
    const tone = {
      blue: 'border-[rgba(82,155,236,0.36)] bg-[linear-gradient(180deg,rgba(59,133,221,0.96),rgba(42,91,162,0.96))] text-[#f7fbff]',
      green: 'border-[rgba(77,209,134,0.34)] bg-[linear-gradient(180deg,rgba(66,190,118,0.96),rgba(45,143,92,0.96))] text-[#f8fffb]',
      yellow: 'border-[rgba(232,190,79,0.36)] bg-[linear-gradient(180deg,rgba(232,190,79,0.96),rgba(181,139,45,0.96))] text-[#16120a]',
      slate: 'border-[rgba(113,139,174,0.3)] bg-[rgba(19,29,44,0.94)] text-[#dbe7f8]',
      violet: 'border-[rgba(82,155,236,0.36)] bg-[linear-gradient(180deg,rgba(59,133,221,0.96),rgba(42,91,162,0.96))] text-[#f7fbff]'
    };
    const actionButton = (label, action, icon, color = 'slate') => (
      `<button class="${buttonBase} ${tone[color] || tone.slate}" type="button" data-action="${action}">${svgIcon(icon)}${escapeHtml(label)}</button>`
    );
    return `
      <div class="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto rounded-[16px] border border-[rgba(88,116,154,0.24)] bg-[linear-gradient(180deg,rgba(15,24,38,0.96),rgba(10,17,28,0.94))] px-2.5 py-2 shadow-[0_12px_30px_rgba(0,0,0,0.22)]">
        <div class="flex h-8 shrink-0 items-center gap-2 rounded-[12px] border border-[rgba(91,118,152,0.24)] bg-[rgba(9,15,24,0.72)] px-2.5">
          <span class="inline-flex h-2 w-2 rounded-full ${state.controllerOnline ? 'bg-[#5de18f] shadow-[0_0_0_4px_rgba(93,225,143,0.12)]' : 'bg-[#f0c955] shadow-[0_0_0_4px_rgba(240,201,85,0.1)]'}"></span>
          <div class="text-[10px] font-extrabold text-[#dce8f8]">控制端 ${state.controllerOnline ? '已连接' : '未连接'}</div>
          <div class="max-w-[210px] truncate text-[10px] font-medium text-[#8fa3bf]">${escapeHtml(state.controllerBase || '/api/controller')}</div>
          ${renderIconButton('设置 / 调试', 'open-debug', 'gear')}
        </div>
        <div class="h-5 w-px shrink-0 bg-[rgba(103,130,169,0.2)]"></div>
        <div class="flex shrink-0 items-center gap-1.5 rounded-[12px] bg-[rgba(255,255,255,0.025)] px-1.5 py-1">
          <span class="px-1.5 text-[10px] font-bold text-[#9fb1c8]">控制包</span>
          ${actionButton('读取', 'load-controller', 'refresh', 'blue')}
          ${actionButton('发布', 'publish', 'arrow', 'green')}
        </div>
        <div class="flex shrink-0 items-center gap-1.5 rounded-[12px] bg-[rgba(255,255,255,0.025)] px-1.5 py-1">
          <span class="px-1.5 text-[10px] font-bold text-[#9fb1c8]">设备</span>
          ${actionButton('扫描', 'scan-devices', 'search', 'yellow')}
          ${actionButton('全点名', 'identify-all', 'plus', 'blue')}
          ${actionButton('点名选中', 'identify-selected', 'plus', 'blue')}
        </div>
        <div class="flex shrink-0 items-center gap-1.5 rounded-[12px] bg-[rgba(255,255,255,0.025)] px-1.5 py-1">
          <span class="px-1.5 text-[10px] font-bold text-[#9fb1c8]">本地</span>
          ${actionButton('恢复', 'restore-draft', 'refresh', 'slate')}
          ${actionButton('保存', 'save-local', 'save', 'green')}
          ${actionButton('模板', 'open-templates', 'list', 'slate')}
          ${actionButton('向导', 'open-wizard', 'room', 'blue')}
        </div>
      </div>
    `;
  }

  function renderOverview() {
    const runtime = state.controllerState?.runtime || { running: false, events: [], receiver_stats: [] };
    const runtimeEvents = Array.isArray(runtime.events)
      ? runtime.events.filter((event) => runtimeEventMatchesRoomDirection(event, currentRoom()) && normalizeNumber(event?.room, -1) === runtimeRoomHash(currentRoom())).slice(-6).reverse()
      : [];
    const runtimeStats = Array.isArray(runtime.receiver_stats) ? runtime.receiver_stats.slice().sort((a, b) => normalizeNumber(a.seen_ms, 999999) - normalizeNumber(b.seen_ms, 999999)).slice(0, 6) : [];
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
            <div class="text-[23px] font-extrabold leading-none">${onlineCount()} <span class="text-[13px] font-normal text-[#9fb2c8]">/ ${retainedDeviceCount()}</span></div>
            <div class="mt-2.5 text-[11px] leading-[1.35] text-[#aabbd1]">在线 / 已扫描保留设备，状态旧了请再次扫描</div>
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
      <section class="mt-3 rounded-[16px] border border-[rgba(88,116,154,0.34)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] p-3.5 shadow-[0_16px_44px_rgba\(0,0,0,0\.34\)]">
        <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="m-0 text-[16px] font-extrabold leading-none">运行统计</h3>
            <div class="mt-1 text-[11px] leading-[1.45] text-[#aabbd1]">开始后接收端自主判断，这里只显示控制端收到的事件和摘要。</div>
          </div>
          <div class="flex flex-wrap justify-end gap-2">
            ${makePill(runtime.running ? '运行中' : '未运行', runtime.running)}
            ${makePill(`事件 ${runtimeEvents.length}`)}
            ${makePill(`摘要 ${runtimeStats.length}`)}
          </div>
        </div>
        <div class="grid gap-2 lg:grid-cols-2">
          <div class="rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] p-3">
            <div class="mb-2 text-[11px] font-bold text-[#c7d5eb]">最近找到记录</div>
            <div class="grid gap-1.5 text-[12px] leading-[1.45] text-[#dbe5f6]">
              ${runtimeEvents.length ? runtimeEvents.map((event) => `
                <div class="flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-[rgba(18,25,36,0.82)] px-2.5 py-2">
                  <span><b>${escapeHtml(deviceLabelFromRuntime(event, 'self'))}</b> 找到了 <b>${escapeHtml(deviceLabelFromRuntime(event, 'peer'))}</b></span>
                  <span class="text-[10.5px] text-[#94a9c4]">${escapeHtml(event.rssi)} dBm · ${escapeHtml(formatClockTime(event.event_ms))}</span>
                </div>
              `).join('') : '<div class="text-[#8fa4bf]">暂无触发事件。</div>'}
            </div>
          </div>
          <div class="rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] p-3">
            <div class="mb-2 text-[11px] font-bold text-[#c7d5eb]">接收端摘要</div>
            <div class="grid gap-1.5 text-[12px] leading-[1.45] text-[#dbe5f6]">
              ${runtimeStats.length ? runtimeStats.map((stat) => `
                <div class="flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-[rgba(18,25,36,0.82)] px-2.5 py-2">
                  <span><b>${escapeHtml(deviceLabelByIndex(stat.self_idx ?? deviceByMac(stat.self_mac)?.idx ?? -1))}</b> 已见 ${escapeHtml(stat.seen_count)} / 已找到 ${escapeHtml(stat.found_count)}</span>
                  <span class="text-[10.5px] text-[#94a9c4]">${escapeHtml(formatAgo(stat.seen_ms))}</span>
                </div>
              `).join('') : '<div class="text-[#8fa4bf]">暂无摘要。接收端运行后每 2 分钟补发一次。</div>'}
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function signalTestConfig() {
    const cfg = state.signalTest || {};
    return {
      running: cfg.running === true,
      sourceMac: String(cfg.sourceMac || ''),
      targetMac: String(cfg.targetMac || ''),
      port: clamp(normalizeNumber(cfg.port, 1), 1, 3),
      ledCount: clamp(normalizeNumber(cfg.ledCount, 10), 1, 200),
      weakRssi: normalizeNumber(cfg.weakRssi, -90),
      strongRssi: normalizeNumber(cfg.strongRssi, -35),
      compressionX100: clamp(normalizeNumber(cfg.compressionX100, 160), 20, 500),
      smoothSamples: clamp(normalizeNumber(cfg.smoothSamples, 5), 1, 10),
      roomHash: normalizeNumber(cfg.roomHash, 65001)
    };
  }

  function signalLevelFromRssi(rssi, cfg = signalTestConfig()) {
    const value = normalizeNumber(rssi, -127);
    if (value <= -126) return { raw: 0, ratio: 0, level: 0 };
    let low = normalizeNumber(cfg.weakRssi, -90);
    let high = normalizeNumber(cfg.strongRssi, -35);
    if (high < low) {
      const tmp = low;
      low = high;
      high = tmp;
    }
    const raw = high === low ? 1 : clamp((value - low) / (high - low), 0, 1);
    const curve = clamp(normalizeNumber(cfg.compressionX100, 100), 20, 500) / 100;
    const ratio = Math.pow(raw, curve);
    const ledCount = clamp(normalizeNumber(cfg.ledCount, 10), 1, 200);
    return {
      raw,
      ratio,
      level: clamp(Math.ceil(ratio * ledCount), 0, ledCount)
    };
  }

  function renderSignalLevelBars(rssi, cfg = signalTestConfig()) {
    const mapped = signalLevelFromRssi(rssi, cfg);
    const total = Math.min(clamp(normalizeNumber(cfg.ledCount, 10), 1, 200), 40);
    const lit = Math.min(mapped.level, total);
    return `
      <div class="mt-2 flex flex-wrap gap-1">
        ${Array.from({ length: total }, (_, idx) => `<span class="h-5 w-3 rounded-[4px] ${idx < lit ? 'bg-[linear-gradient(180deg,#76f0a1,#2dcb76)] shadow-[0_0_14px_rgba(75,220,130,0.34)]' : 'bg-[rgba(68,88,118,0.32)]'}"></span>`).join('')}
      </div>
      <div class="mt-1 text-[11px] text-[#9fb2c8]">映射 ${mapped.level}/${clamp(normalizeNumber(cfg.ledCount, 10), 1, 200)} · 原始比例 ${(mapped.raw * 100).toFixed(0)}% · 压缩后 ${(mapped.ratio * 100).toFixed(0)}%</div>
    `;
  }

  function signalStatForMac(mac, cfg = signalTestConfig()) {
    const targetMac = String(mac || '').trim().toUpperCase();
    const stats = Array.isArray(state.controllerState?.runtime?.receiver_stats) ? state.controllerState.runtime.receiver_stats : [];
    return stats.find((stat) => String(stat?.self_mac || '').trim().toUpperCase() === targetMac && normalizeNumber(stat?.room, -1) === normalizeNumber(cfg.roomHash, 65001)) || null;
  }

  function signalTestDevices() {
    return visibleControllerDevices()
      .filter((device) => String(device?.mac || '').trim())
      .map((device) => ({
        ...device,
        mac: String(device.mac || '').trim().toUpperCase(),
        signal_online: isDeviceOnline(device),
        signal_retained: isDeviceScanRetained(device)
      }))
      .sort((a, b) => {
        const aRank = a.signal_online ? 0 : a.signal_retained ? 1 : 2;
        const bRank = b.signal_online ? 0 : b.signal_retained ? 1 : 2;
        if (aRank !== bRank) return aRank - bRank;
        return normalizeNumber(a?.seen_ms, 999999) - normalizeNumber(b?.seen_ms, 999999);
      });
  }

  function signalTestDeviceStatus(device) {
    if (!state.controllerOnline) return '控制端未连接';
    if (!device) return '未选择';
    if (device.signal_online || isDeviceOnline(device)) return `在线 · ${formatAgo(device.seen_ms)}`;
    if (device.signal_retained || isDeviceScanRetained(device)) return `上次扫描 · ${formatAgo(device.seen_ms)}`;
    return '太久未扫描';
  }

  function ensureSignalTestSelection(devices = signalTestDevices()) {
    if (!state.signalTest || typeof state.signalTest !== 'object') state.signalTest = signalTestConfig();
    const macs = devices.map((device) => String(device.mac || '').trim().toUpperCase()).filter(Boolean);
    const source = String(state.signalTest.sourceMac || '').trim().toUpperCase();
    const target = String(state.signalTest.targetMac || '').trim().toUpperCase();
    if (!source || !macs.includes(source)) state.signalTest.sourceMac = macs[0] || '';
    const nextSource = String(state.signalTest.sourceMac || '').trim().toUpperCase();
    if (!target || !macs.includes(target) || target === nextSource) {
      state.signalTest.targetMac = macs.find((mac) => mac !== nextSource) || '';
    }
    return signalTestConfig();
  }

  function signalTestReading(mac, peerMac, cfg = signalTestConfig()) {
    const stat = signalStatForMac(mac, cfg);
    const bestPeer = String(stat?.best_peer || '').trim().toUpperCase();
    const peer = String(peerMac || '').trim().toUpperCase();
    const peerMatches = !!stat && (!bestPeer || bestPeer === peer);
    return {
      stat,
      bestPeer,
      peerMatches,
      rssi: stat && peerMatches ? normalizeNumber(stat.best_rssi, -127) : -127
    };
  }

  function signalTestBestReading(cfg = signalTestConfig()) {
    const a = signalTestReading(cfg.sourceMac, cfg.targetMac, cfg).rssi;
    const b = signalTestReading(cfg.targetMac, cfg.sourceMac, cfg).rssi;
    return Math.max(a, b);
  }

  function renderSignalDeviceCard(title, mac, peerMac, cfg = signalTestConfig()) {
    const device = deviceByMac(mac);
    const peer = deviceByMac(peerMac);
    const idx = normalizeNumber(device?.idx, -1);
    const reading = signalTestReading(mac, peerMac, cfg);
    const stat = reading.stat;
    const rssi = reading.rssi;
    const scanRssi = normalizeNumber(device?.rssi, -999);
    const statusText = stat
      ? (reading.peerMatches ? `收到摘要 · ${formatAgo(stat.seen_ms)}` : `看到 ${deviceNameByMac(reading.bestPeer)}`)
      : (cfg.running ? '等待设备间摘要' : '测试未开始');
    return `
      <div class="rounded-[18px] border border-[rgba(88,116,154,0.24)] bg-[rgba(13,20,31,0.86)] p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="text-[11px] font-bold text-[#8fa3bf]">${escapeHtml(title)}</div>
            <div class="mt-1 text-[18px] font-extrabold leading-none text-white">${escapeHtml(deviceDraftName(device) || device?.name || mac || '未选择')}</div>
            <div class="mt-1 text-[11px] text-[#9fb2c8]">目标：${escapeHtml(deviceDraftName(peer) || peer?.name || peerMac || '未选择')}</div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <div class="inline-flex rounded-full border border-[rgba(100,155,220,0.24)] bg-[rgba(29,58,92,0.28)] px-2.5 py-1 text-[10.5px] font-bold text-[#b8d7ff]">${escapeHtml(statusText)}</div>
              ${idx >= 0 ? `<button class="table-btn" type="button" data-action="identify-device" data-idx="${escapeHtml(idx)}">${svgIcon('device')}点名</button>` : ''}
            </div>
          </div>
          <div class="rounded-[14px] border border-[rgba(75,169,255,0.24)] bg-[rgba(11,18,29,0.8)] px-3 py-2 text-right">
            <div class="text-[10px] font-bold text-[#8fa3bf]">设备间 RSSI</div>
            <div class="mt-1 text-[26px] font-black leading-none ${rssi > -126 ? 'text-[#76f0a1]' : 'text-[#6f819c]'}">${rssi > -126 ? `${escapeHtml(rssi)} dBm` : '无信号'}</div>
          </div>
        </div>
        ${renderSignalLevelBars(rssi, cfg)}
        <div class="mt-3 grid gap-2 text-[11px] text-[#aabbd1] sm:grid-cols-3">
          <div class="rounded-[12px] bg-[rgba(255,255,255,0.035)] px-3 py-2">控制端扫描 RSSI：<b class="text-white">${scanRssi > -998 ? `${escapeHtml(scanRssi)} dBm` : '暂无'}</b></div>
          <div class="rounded-[12px] bg-[rgba(255,255,255,0.035)] px-3 py-2">摘要：<b class="text-white">${stat ? `${escapeHtml(stat.seen_count)} 次可见` : '暂无'}</b></div>
          <div class="rounded-[12px] bg-[rgba(255,255,255,0.035)] px-3 py-2">刷新：<b class="text-white">${stat ? escapeHtml(formatAgo(stat.seen_ms)) : '未收到'}</b></div>
        </div>
      </div>
    `;
  }

  function renderSignalCalibrationPage() {
    const devices = signalTestDevices();
    const activeCfg = ensureSignalTestSelection(devices);
    const selectedSource = devices.find((device) => String(device.mac || '').toUpperCase() === String(activeCfg.sourceMac || '').toUpperCase()) || null;
    const selectedTarget = devices.find((device) => String(device.mac || '').toUpperCase() === String(activeCfg.targetMac || '').toUpperCase()) || null;
    const optionFor = (device, selectedMac) => {
      const selected = String(selectedMac || '').toUpperCase() === String(device.mac || '').toUpperCase();
      return `<option value="${escapeHtml(device.mac)}" ${selected ? 'selected' : ''}>${escapeHtml(deviceDraftName(device) || device.name || device.mac)} · ${escapeHtml(signalTestDeviceStatus(device))}</option>`;
    };
    const sourceOptions = devices.map((device) => optionFor(device, activeCfg.sourceMac)).join('');
    const targetOptions = devices.map((device) => optionFor(device, activeCfg.targetMac)).join('');
    const sameDevice = activeCfg.sourceMac && activeCfg.targetMac && String(activeCfg.sourceMac).toUpperCase() === String(activeCfg.targetMac).toUpperCase();
    const canStart = state.controllerOnline && devices.length >= 2 && activeCfg.sourceMac && activeCfg.targetMac && !sameDevice;
    const applyRoom = currentRoom();
    const canApplyToRoom = !!applyRoom && applyRoom.status !== 'running';
    const bestReading = signalTestBestReading(activeCfg);
    const bestLevel = signalLevelFromRssi(bestReading, activeCfg);
    const noSignalText = activeCfg.running
      ? '已下发测试，等待两台设备互相收到 BEACON。若 5 秒后仍无信号，请再次扫描并确认两台接收端都已烧录新版固件。'
      : '选择两台设备后点击“开始信号测试”。设备会进入临时测试房间，用所选 LED 路显示彼此 RSSI。';
    const readiness = !state.controllerOnline
      ? { tone: 'danger', text: '控制端未连接。请先连接控制端热点，再扫描设备。' }
      : devices.length < 2
        ? { tone: 'warn', text: '至少需要两台接收端。请先扫描设备；如果列表仍为空，说明页面没有拿到控制端设备状态。' }
        : sameDevice
          ? { tone: 'warn', text: '源设备和目标设备不能是同一台。' }
          : { tone: 'ok', text: '可以开始测试。开始后两台设备会互相测 RSSI，控制端只负责转发和汇总。' };
    const readinessClass = readiness.tone === 'ok'
      ? 'border-[rgba(74,222,128,0.24)] bg-[rgba(24,74,52,0.24)] text-[#bbf7d0]'
      : readiness.tone === 'danger'
        ? 'border-[rgba(248,113,113,0.28)] bg-[rgba(95,28,36,0.28)] text-[#fecaca]'
        : 'border-[rgba(245,158,11,0.28)] bg-[rgba(92,62,18,0.28)] text-[#fde68a]';
    return `
      <div class="page-section-head">
        <div>
          <h3>信号校准</h3>
          <p>测试两台接收端之间的 ESP-NOW RSSI，并把 RSSI 压缩映射到 LED 灯珠数量。这里显示的是设备彼此看到的信号，不是控制端扫描信号。</p>
        </div>
        <div class="pill-actions">
          <button class="ghost-btn ${state.busy.scan ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="scan-devices" ${state.busy.scan ? 'disabled' : ''}>${svgIcon('search')}${state.busy.scan ? '扫描中...' : '扫描设备'}</button>
          <button class="ghost-btn ${state.busy.signalTest || !canStart ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="start-signal-test" ${state.busy.signalTest || !canStart ? 'disabled' : ''}>${svgIcon('play')}${state.busy.signalTest ? '下发中...' : activeCfg.running ? '重新开始测试' : '开始测试'}</button>
          <button class="ghost-btn ${state.busy.signalTest ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="stop-signal-test" ${state.busy.signalTest ? 'disabled' : ''}>${svgIcon('pause')}停止/熄灭</button>
          <button class="ghost-btn ${!canApplyToRoom ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="apply-signal-calibration" ${!canApplyToRoom ? 'disabled' : ''}>${svgIcon('save')}应用到当前房间</button>
          ${makePill(activeCfg.running ? '校准运行中' : '未运行', activeCfg.running)}
          ${makePill(`房间 ${activeCfg.roomHash}`)}
        </div>
      </div>
      <div class="page-section-body stack-col">
        <div class="rounded-[16px] border px-4 py-3 text-[12px] font-bold leading-[1.6] ${readinessClass}">
          ${escapeHtml(readiness.text)}
        </div>
        <section class="mini-panel">
          <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.72fr)]">
            <div class="grid gap-3 md:grid-cols-2">
              <div class="field"><label>源设备</label><select class="fake-select" data-role="signal-test-field" data-field="sourceMac">${sourceOptions || '<option value="">暂无设备，请先扫描</option>'}</select></div>
              <div class="field"><label>目标设备</label><select class="fake-select" data-role="signal-test-field" data-field="targetMac">${targetOptions || '<option value="">暂无设备，请先扫描</option>'}</select></div>
              <div class="field"><label>LED 路</label><select class="fake-select" data-role="signal-test-field" data-field="port"><option value="1" ${activeCfg.port === 1 ? 'selected' : ''}>LED1</option><option value="2" ${activeCfg.port === 2 ? 'selected' : ''}>LED2</option><option value="3" ${activeCfg.port === 3 ? 'selected' : ''}>LED3</option></select></div>
              <div class="field"><label>灯珠级别数</label><input class="fake-input" type="number" min="1" max="200" step="1" data-role="signal-test-field" data-field="ledCount" value="${escapeHtml(activeCfg.ledCount)}"></div>
              <div class="field"><label>弱信号 dBm（0 格）</label><input class="fake-input" type="number" step="1" data-role="signal-test-field" data-field="weakRssi" value="${escapeHtml(activeCfg.weakRssi)}"></div>
              <div class="field"><label>满格信号 dBm（满格）</label><input class="fake-input" type="number" step="1" data-role="signal-test-field" data-field="strongRssi" value="${escapeHtml(activeCfg.strongRssi)}"></div>
              <div class="field"><label>压缩比例</label><input class="fake-input" type="number" min="20" max="500" step="10" data-role="signal-test-field" data-field="compressionX100" value="${escapeHtml(activeCfg.compressionX100)}"><div class="mt-1 text-[10.5px] leading-[1.35] text-[#8fa3c1]">100=线性；160/200 适合强信号容易满格时使用。</div></div>
              <div class="field"><label>平滑样本</label><input class="fake-input" type="number" min="1" max="10" step="1" data-role="signal-test-field" data-field="smoothSamples" value="${escapeHtml(activeCfg.smoothSamples)}"></div>
            </div>
            <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(9,14,22,0.68)] p-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="text-[12px] font-extrabold text-white">当前映射</div>
                  <div class="mt-1 text-[11px] text-[#91a7c4]">LED${escapeHtml(activeCfg.port)} · ${escapeHtml(activeCfg.ledCount)} 格 · 弱 ${escapeHtml(activeCfg.weakRssi)} / 满格 ${escapeHtml(activeCfg.strongRssi)} dBm</div>
                </div>
                <div class="rounded-[14px] border border-[rgba(118,240,161,0.22)] bg-[rgba(20,70,48,0.22)] px-3 py-2 text-right">
                  <div class="text-[10px] font-bold text-[#9bcbb0]">当前最高</div>
                  <div class="mt-1 text-[22px] font-black leading-none text-[#bbf7d0]">${bestReading > -126 ? `${escapeHtml(bestReading)} dBm` : '无'}</div>
                </div>
              </div>
              <div class="mt-3 text-[12px] leading-[1.6] text-[#aabbd1]">
                ${bestReading > -126 ? `当前会点亮 <b class="text-white">${escapeHtml(bestLevel.level)}</b> / ${escapeHtml(activeCfg.ledCount)} 格。` : escapeHtml(noSignalText)}
                <br>原始比例 = (RSSI - 弱信号) / (满格信号 - 弱信号)，压缩 = 原始比例<sup>${(activeCfg.compressionX100 / 100).toFixed(2)}</sup>。
              </div>
              <div class="mt-3 grid gap-2 text-[11px] text-[#dbe7f8]">
                ${[-90, -70, -55, -45, -35, -25, -15].map((value) => {
                  const level = signalLevelFromRssi(value, activeCfg).level;
                  return `<div class="flex items-center justify-between rounded-[12px] bg-[rgba(255,255,255,0.035)] px-3 py-2"><span>${value} dBm</span><b>${level}/${activeCfg.ledCount}</b></div>`;
                }).join('')}
              </div>
            </div>
          </div>
          <div class="mt-4 grid gap-2 text-[11px] text-[#9fb2c8] md:grid-cols-2">
            <div class="rounded-[14px] border border-[rgba(88,116,154,0.2)] bg-[rgba(255,255,255,0.03)] px-3 py-2">源设备：<b class="text-white">${escapeHtml(deviceDraftName(selectedSource) || selectedSource?.name || activeCfg.sourceMac || '未选择')}</b> · ${escapeHtml(signalTestDeviceStatus(selectedSource))}</div>
            <div class="rounded-[14px] border border-[rgba(88,116,154,0.2)] bg-[rgba(255,255,255,0.03)] px-3 py-2">目标设备：<b class="text-white">${escapeHtml(deviceDraftName(selectedTarget) || selectedTarget?.name || activeCfg.targetMac || '未选择')}</b> · ${escapeHtml(signalTestDeviceStatus(selectedTarget))}</div>
          </div>
        </section>
        <section class="grid gap-3 xl:grid-cols-2">
          ${renderSignalDeviceCard('源设备看到目标', activeCfg.sourceMac, activeCfg.targetMac, activeCfg)}
          ${renderSignalDeviceCard('目标设备看到源', activeCfg.targetMac, activeCfg.sourceMac, activeCfg)}
        </section>
      </div>
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
      ['history', '历史数据库'],
      ['devices', '设备'],
      ['groups', '分组'],
      ['signal', '信号校准'],
      ['effects', '灯效库'],
      ['preview', '预览台'],
      ['game', '玩法预设'],
      ['room', '游戏房间'],
      ['debug', '调试']
    ];
    return `
      <div class="rounded-[18px] border border-[rgba(88,116,154,0.28)] bg-[linear-gradient(180deg,rgba(17,27,42,0.96),rgba(11,18,29,0.95))] shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
        <div class="flex flex-wrap gap-1.5 border-b border-[rgba(88,116,154,0.16)] px-3 pt-3">
          ${tabs.map(([key, label]) => `<button class="inline-flex h-8 items-center rounded-t-[12px] border border-b-0 border-transparent px-3.5 text-[11px] font-extrabold text-[#91a4bd] transition hover:bg-[rgba(23,34,50,0.72)] hover:text-white ${state.activeTab === key ? 'border-[rgba(106,151,210,0.34)] bg-[linear-gradient(180deg,rgba(35,52,77,0.98),rgba(20,32,50,0.98))] text-white shadow-[inset_0_2px_0_rgba(74,168,255,0.72)]' : 'bg-transparent'}" type="button" data-action="tab" data-tab="${key}">${escapeHtml(label)}</button>`).join('')}
        </div>
        <div class="grid gap-0">
          <section class="p-3.5" data-page="overview" style="display:${state.activeTab === 'overview' ? 'block' : 'none'}">
            ${renderOverview()}
          </section>
          <section class="p-3.5" data-page="history" style="display:${state.activeTab === 'history' ? 'block' : 'none'}">
            ${renderHistoryPage()}
          </section>
          <section class="p-3.5" data-page="devices" style="display:${state.activeTab === 'devices' ? 'block' : 'none'}">
            ${renderDevicesPage()}
          </section>
          <section class="p-3.5" data-page="groups" style="display:${state.activeTab === 'groups' ? 'block' : 'none'}">
            ${renderGroupsPage()}
          </section>
          <section class="p-3.5" data-page="signal" style="display:${state.activeTab === 'signal' ? 'block' : 'none'}">
            ${renderSignalCalibrationPage()}
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
    const fieldCount = visibleControllerDevices().length;
    const checked = visible.length > 0 && visible.every((device) => state.selectedDeviceIds.has(device.mac));
    const groupOptions = controllerGroups()
      .map((group) => `<option value="${group.id}" ${normalizeNumber(state.deviceFilterGroupId, -1) === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`)
      .join('');
    return `
      <div class="sticky top-0 z-30 -mx-0 rounded-[16px] border border-[rgba(88,116,154,0.26)] bg-[rgba(13,19,29,0.94)] px-3 py-2 shadow-[0_16px_32px_rgba(0,0,0,0.28)] backdrop-blur-md">
        <div class="sub-row">
          <div class="pill-actions">
            ${makePillButton(`全部 ${fieldCount}`, 'device-filter-mode-all', state.deviceFilterMode === 'all')}
            ${makePillButton(`未分组 ${ungroupedCount()}`, 'device-filter-mode-ungrouped', state.deviceFilterMode === 'ungrouped')}
            ${makePillButton('按分组筛选', 'device-filter-mode-group', state.deviceFilterMode === 'group')}
            <select class="page-select" data-action="device-filter-group" ${state.deviceFilterMode === 'group' ? '' : 'disabled'}>
              <option value="-1">全部分组</option>
              ${groupOptions}
            </select>
          </div>
          <div class="pill-actions">
            ${makePill(`现场 ${fieldCount}`)}
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
            <label class="checkbox-line">
              <input type="checkbox" data-action="toggle-show-offline" ${state.localState?.ui?.show_offline_devices ? 'checked' : ''}>
              显示需扫描确认设备
            </label>
            <button class="ghost-btn" type="button" data-action="clear-selected-groups">${svgIcon('trash')}取消所选设备分组</button>
            <button class="ghost-btn" type="button" data-action="clear-selection">${svgIcon('refresh')}清空选择</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderDeviceRow(device) {
    const idx = normalizeNumber(device.idx, 0);
    const mac = String(device.mac || '');
    const online = isDeviceOnline(device);
    const retained = isDeviceScanRetained(device);
    const statusLabel = deviceScanStatusLabel(device);
    const editing = state.editingMac === mac;
    const name = deviceDisplayName(device);
    const note = deviceDraftNote(device);
    const selected = state.selectedDeviceIds.has(mac);
    const groupIds = visibleGroupIdsForDevice(device);
    const draftName = editing ? state.editingDraftName : name;
    const draftNote = editing ? state.editingDraftNote : note;
    const rowClass = [selected ? 'is-selected' : '', online ? 'is-online' : retained ? 'is-stale' : 'is-offline'].filter(Boolean).join(' ');
    const firmwareLabel = deviceFirmwareLabel(device);
    const firmwareColor = firmwareLabel.tone === 'ok' ? '#8ff0b0' : firmwareLabel.tone === 'bad' ? '#ff9a9a' : '#ffd88a';
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
      <tr class="${rowClass}" data-device-row="${escapeHtml(mac)}">
        <td>
          <label class="checkbox-line">
            <input type="checkbox" data-action="toggle-device-select" data-mac="${escapeHtml(mac)}" ${selected ? 'checked' : ''}>
          </label>
        </td>
        <td class="name-cell">
          <div class="device-name-wrap">
            <div class="device-name-top">
              <div class="device-name-main">
                ${editing
                  ? `<input class="name-editor" data-role="device-name-input" data-mac="${escapeHtml(mac)}" value="${escapeHtml(draftName)}">`
                  : `<div>${escapeHtml(name)}</div>`}
                <div class="status-line" style="margin-top:4px"><span class="tiny-dot" style="background:${online ? '#42d96f' : retained ? '#f0c955' : '#7c8798'}"></span>${escapeHtml(statusLabel)} · ${normalizeNumber(device.group_mask, 0) ? `${groupIds.length} 组` : '未分组'}</div>
                <div class="status-line" style="margin-top:3px;color:${firmwareColor};font-size:11px">${escapeHtml(firmwareLabel.text)}</div>
                ${editing
                  ? `<textarea class="name-editor" data-role="device-note-input" data-mac="${escapeHtml(mac)}" style="min-height:56px;resize:vertical;margin-top:6px" placeholder="备注">${escapeHtml(draftNote)}</textarea>`
                  : `<div class="device-note" style="margin-top:4px;color:#8ea1bc;font-size:12px;line-height:1.35">${escapeHtml(note || '无备注')}</div>`}
              </div>
              <div class="device-name-actions">
                ${editing
                  ? `<button class="table-btn save" type="button" data-action="save-device-name" data-mac="${escapeHtml(mac)}">保存</button>
                     <button class="table-btn cancel" type="button" data-action="cancel-device-name" data-mac="${escapeHtml(mac)}">取消</button>`
                  : `<button class="table-btn" type="button" data-action="edit-device-name" data-mac="${escapeHtml(mac)}">编辑</button>`}
                <button class="table-btn" type="button" data-action="delete-device" data-mac="${escapeHtml(mac)}">删除</button>
              </div>
            </div>
          </div>
        </td>
        <td>${escapeHtml(mac)}</td>
        <td>${retained ? `<span class="rssi">${normalizeNumber(device.rssi, 0)} dBm</span><span class="signal-icon" style="color:${online && normalizeNumber(device.rssi, 0) > -50 ? '#57da78' : '#f0c955'}"><span></span><span></span><span></span><span></span></span>${online ? '' : '<span style="display:block;margin-top:3px;color:#8ea1bc;font-size:11px">上次 RSSI</span>'}` : '<span style="color:#8ea1bc">离线</span>'}</td>
        <td>${escapeHtml(formatAgo(device.seen_ms))}</td>
        <td>
          <div class="device-name-actions">
            ${idx >= 0 ? `<button class="table-btn" type="button" data-action="identify-device" data-idx="${idx}">点名</button>` : ''}
            ${retained ? `<button class="table-btn save" type="button" data-action="save-device-row" data-mac="${escapeHtml(mac)}">保存设备</button>` : ''}
          </div>
        </td>
        <td><div class="group-cell">${groupCells || '<span style="color:#8ea1bc">无可选分组</span>'}</div></td>
      </tr>
    `;
  }

  function renderHistoryPage() {
    const records = historySessionRecords();
    const players = historyPlayerSummary(records);
    const groups = historyGroupSummary(records);
    const discoveries = historyDiscoveryRows(records);
    const totalScore = records.reduce((sum, record) => sum + normalizeNumber(record?.score_total, Array.isArray(record?.runtime_discoveries) ? record.runtime_discoveries.length : 0), 0);
    const latestSession = records[0] || null;
    const playerRows = players.slice(0, 12).map((item, index) => `
      <tr>
        <td>${escapeHtml(index + 1)}</td>
        <td><b>${escapeHtml(item.label)}</b><div style="margin-top:3px;color:#8ea3bf;font-size:11px">最近：${escapeHtml(item.last_room || '无')}</div></td>
        <td>${escapeHtml(item.score)}</td>
        <td>${escapeHtml(item.sessions)}</td>
        <td>${escapeHtml(formatTime(item.last_time))}</td>
      </tr>
    `).join('');
    const sessionRows = records.slice(0, 16).map((record) => `
      <tr>
        <td><b>${escapeHtml(record.room_name || '未命名房间')}</b><div style="margin-top:3px;color:#8ea3bf;font-size:11px">${escapeHtml(record.template_name || record.sense_mode || '未设置')}</div></td>
        <td>${escapeHtml(formatTime(record.started_at))}</td>
        <td>${escapeHtml(formatTime(record.ended_at || record.updated_at))}</td>
        <td>${escapeHtml(record.duration || formatDuration(record.started_at, record.ended_at))}</td>
        <td>${escapeHtml(normalizeNumber(record.score_total, Array.isArray(record.runtime_discoveries) ? record.runtime_discoveries.length : 0))}</td>
      </tr>
    `).join('');
    const groupRows = groups.slice(0, 8).map((item, index) => `
      <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(13,21,34,0.78)] px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-[11px] font-black tracking-[0.16em] text-[#8ea3bf]">GROUP #${escapeHtml(index + 1)}</div>
            <div class="mt-1 text-[15px] font-extrabold text-white">${escapeHtml(item.label)}</div>
            <div class="mt-1 text-[11px] text-[#8ea3bf]">参与场次 ${escapeHtml(item.sessions)}</div>
          </div>
          <div class="text-right text-[28px] font-black text-[#ffd166]">${escapeHtml(item.score)}</div>
        </div>
      </div>
    `).join('');
    const discoveryRows = discoveries.slice(0, 12).map((item) => `
      <div class="rounded-[14px] border border-[rgba(88,116,154,0.16)] bg-[rgba(8,13,22,0.72)] px-3 py-2.5">
        <div class="text-[12px] font-extrabold text-white">${escapeHtml(item.line || '发现记录')}</div>
        <div class="mt-1 text-[10.5px] leading-[1.45] text-[#8ea3bf]">${escapeHtml(item.room_name)} · ${escapeHtml(formatClockTime(item.event_ms))} · RSSI ${escapeHtml(item.rssi)} dBm</div>
      </div>
    `).join('');
    return `
      <div class="page-section-head">
        <div>
          <h3>历史数据库</h3>
          <p>这里读取本地 JSONL 场次库，当前场次和历史场次分开统计，用来评估玩家长期表现。</p>
        </div>
        <div class="page-actions">
          <button class="ghost-btn ${state.busy.records ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="refresh-records" ${state.busy.records ? 'disabled' : ''}>${svgIcon('refresh')}${state.busy.records ? '刷新中...' : '刷新历史'}</button>
        </div>
      </div>
      <div class="grid gap-3 md:grid-cols-4">
        <div class="rounded-[18px] border border-[rgba(75,169,255,0.28)] bg-[rgba(15,24,38,0.88)] p-4">
          <div class="text-[11px] font-bold text-[#9fb2c8]">历史场次</div>
          <div class="mt-2 text-[30px] font-black text-white">${escapeHtml(records.length)}</div>
        </div>
        <div class="rounded-[18px] border border-[rgba(93,225,143,0.28)] bg-[rgba(15,24,38,0.88)] p-4">
          <div class="text-[11px] font-bold text-[#9fb2c8]">累计发现</div>
          <div class="mt-2 text-[30px] font-black text-[#75eda4]">${escapeHtml(totalScore)}</div>
        </div>
        <div class="rounded-[18px] border border-[rgba(240,201,85,0.28)] bg-[rgba(15,24,38,0.88)] p-4">
          <div class="text-[11px] font-bold text-[#9fb2c8]">有积分玩家</div>
          <div class="mt-2 text-[30px] font-black text-[#ffd166]">${escapeHtml(players.length)}</div>
        </div>
        <div class="rounded-[18px] border border-[rgba(160,111,255,0.28)] bg-[rgba(15,24,38,0.88)] p-4">
          <div class="text-[11px] font-bold text-[#9fb2c8]">最近场次</div>
          <div class="mt-2 truncate text-[18px] font-black text-white">${escapeHtml(latestSession?.room_name || '暂无')}</div>
          <div class="mt-1 text-[11px] text-[#8ea3bf]">${escapeHtml(formatTime(latestSession?.ended_at || latestSession?.updated_at))}</div>
        </div>
      </div>
      <div class="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <section class="table-panel">
          <div class="table-title"><div><h3>玩家长期排行</h3><p>按历史场次累计发现次数排序。</p></div></div>
          <table>
            <thead><tr><th>排名</th><th>玩家</th><th>累计积分</th><th>有效场次</th><th>最近时间</th></tr></thead>
            <tbody>${playerRows || '<tr><td colspan="5" style="color:#8ea3bf">暂无玩家积分记录。结束一局游戏后这里会自动出现。</td></tr>'}</tbody>
          </table>
        </section>
        <section class="table-panel">
          <div class="table-title"><div><h3>房间场次</h3><p>每次开始/结束会形成一条独立场次。</p></div></div>
          <table>
            <thead><tr><th>房间</th><th>开始</th><th>结束</th><th>时长</th><th>积分</th></tr></thead>
            <tbody>${sessionRows || '<tr><td colspan="5" style="color:#8ea3bf">暂无历史场次。</td></tr>'}</tbody>
          </table>
        </section>
      </div>
      <div class="mt-3 grid gap-3 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <section class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(13,21,34,0.82)] p-4">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 class="m-0 text-[15px] font-extrabold text-white">小组累计</h3>
              <p class="mt-1 text-[11px] text-[#9fb2c8]">用于双人组/共享组的长期统计。</p>
            </div>
          </div>
          <div class="grid gap-2">${groupRows || '<div class="notice">暂无小组积分。</div>'}</div>
        </section>
        <section class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(13,21,34,0.82)] p-4">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 class="m-0 text-[15px] font-extrabold text-white">最近发现明细</h3>
              <p class="mt-1 text-[11px] text-[#9fb2c8]">保留“谁发现了谁”的原始播报。</p>
            </div>
          </div>
          <div class="grid gap-2">${discoveryRows || '<div class="notice">暂无发现明细。</div>'}</div>
        </section>
      </div>
    `;
  }

  function renderDevicesPage() {
    const devices = filteredDevices();
    const fieldCount = visibleControllerDevices().length;
    const collapsed = state.localState?.ui?.device_preview_collapsed === true;
    const offlineNotice = state.controllerOnline ? '' : `
      <div class="notice" style="margin-bottom:12px">未连接控制端。这里不会显示现场设备；连接控制端热点并点击“从控制端读取”或“扫描”后，才会显示本次现场设备。</div>
    `;
    const emptyDeviceText = state.controllerOnline
      ? '当前筛选下没有设备。请扫描控制端，或切换筛选条件。'
      : '未连接控制端，暂无现场设备。';
    return `
      <div class="page-section-head">
        <div>
          <h3>设备</h3>
          <p>这里显示本次控制端能看到的现场设备，用来命名、备注、分组和点名。离线时不展示旧扫描残影。</p>
        </div>
        <div class="pill-actions">
          ${makePill(`现场 ${fieldCount}`)}
          ${makePill(`可见 ${devices.length}`)}
          ${makePill(`已选 ${state.selectedDeviceIds.size}`)}
        </div>
      </div>
      <div class="page-section-body" style="display:grid;grid-template-columns:minmax(0,1.7fr) ${collapsed ? '58px' : '360px'};gap:14px;align-items:start">
        <div class="table-panel" style="padding:14px 14px 16px">
          <h4 style="margin:0 0 8px;font-size:17px;">设备列表</h4>
          <div style="color:#9db0c8;font-size:14px;margin-bottom:10px">设备以控制端最新扫描为准；名称、备注和分组会保存为本地草稿，下次连接同一 MAC 时自动套用。</div>
          ${offlineNotice}
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
                ${devices.length ? devices.map((device) => renderDeviceRow(device)).join('') : `<tr><td colspan="7" style="color:#91a5c3;text-align:center;padding:28px">${escapeHtml(emptyDeviceText)}</td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="pager">
            <div>现场 ${fieldCount} 条 · 当前显示 ${devices.length} 条</div>
            <div class="pager-center">
              <button class="page-btn active" type="button">1</button>
              <button class="page-btn" type="button">2</button>
            </div>
            <div class="page-select">10 条 / 页</div>
          </div>
        </div>
        <aside class="groups-panel" style="${collapsed ? 'width:58px;min-width:58px;padding:10px 8px;overflow:hidden' : 'width:360px;min-width:360px'}">
          <div class="groups-head" style="${collapsed ? 'align-items:center;justify-content:center;flex-direction:column;gap:8px' : ''}">
            <div style="${collapsed ? 'display:flex;flex-direction:column;align-items:center;gap:4px' : ''}">
              <h3 style="${collapsed ? 'writing-mode:vertical-rl;transform:rotate(180deg);margin:0;font-size:15px;line-height:1' : ''}">分组（预览）</h3>
              ${collapsed ? `<div style="font-size:11px;color:#9db0c8">${controllerGroups().length} 组</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;${collapsed ? 'width:100%' : ''}">
              <button class="mini-btn" type="button" data-action="toggle-device-groups-panel">${collapsed ? '展开' : '收起'}</button>
              ${collapsed ? `<button class="mini-btn" type="button" data-action="open-groups">管理</button>` : `<button class="mini-btn" type="button" data-action="open-groups">管理分组</button>`}
            </div>
          </div>
          <div class="group-list" style="${collapsed ? 'display:none' : ''}">
            ${controllerGroups().map((group) => renderGroupCard(group, { compactActions: true })).join('') || '<div class="notice">暂无分组。先创建分组后再分配设备。</div>'}
          </div>
        </aside>
      </div>
    `;
  }

  function renderGroupCard(group, options = {}) {
    const {
      compactActions = false,
      showDelete = false
    } = options || {};
    const colorClass = groupPalette[group.id % groupPalette.length];
    const memberCount = groupMemberCount(group.id);
    const expanded = expandedGroupId() === group.id;
    const allMembers = groupDevices(group.id);
    const members = allMembers.slice(0, 8);
    const canIdentifyGroup = state.controllerOnline && allMembers.some((device) => normalizeNumber(device?.idx, -1) >= 0);
    const memberHint = state.controllerOnline ? `${memberCount} 台设备` : '未连接时不显示现场成员';
    return `
      <div class="group-card ${colorClass} ${expanded ? 'ring-1 ring-[#63adff]/50' : ''}">
        <div class="group-top">
          <div class="group-name"><span class="bullet"></span>${escapeHtml(group.name)} <span class="group-id">ID: ${group.id + 1001}</span></div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
            ${canIdentifyGroup ? makeGroupActionButton('点名全组', 'identify-group', group.id, false, compactActions) : ''}
            ${makeGroupActionButton('编辑', 'edit-group', group.id, selectedGroupId() === group.id, compactActions)}
            ${makeGroupActionButton(expanded ? '收起' : '展开', 'select-group', group.id, expanded, compactActions)}
            ${showDelete ? makeGroupActionButton('删除', 'delete-group', group.id, false, compactActions, 'text-[#ffd5d5] border-[rgba(255,122,122,0.24)] bg-[rgba(52,18,24,0.72)]') : ''}
          </div>
        </div>
        <div class="group-desc">${escapeHtml(group.note || '未填写备注')}</div>
        <div class="group-meta">
          <div class="meta-left"><span>👥</span><span>${escapeHtml(memberHint)}</span></div>
          <div class="target">成员容器</div>
        </div>
        ${expanded ? `
          <div class="mt-3 rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] p-3">
            <div class="text-[10px] font-bold text-[#8ea3bf]">成员设备</div>
            <div class="mt-2 space-y-1.5 text-[11px] leading-[1.45] text-[#dbe5f6]">
              ${members.length
                ? members.map((device) => `
                  <div class="flex items-center justify-between gap-2 rounded-[12px] border border-[rgba(88,116,154,0.16)] bg-[rgba(14,20,31,0.72)] px-2.5 py-1.5">
                      <div class="min-w-0">
                        <div class="truncate font-bold text-white">${escapeHtml(deviceDraftName(device))}</div>
                        <div class="truncate text-[10px] text-[#9fb2c8]">${escapeHtml(device.mac || '')}</div>
                      </div>
                    <div class="flex shrink-0 items-center gap-1.5">
                      <span class="text-[10px] text-[#9fb2c8]">${normalizeNumber(device.seen_ms, 999999) < 10000 ? '在线' : '离线'}</span>
                      ${normalizeNumber(device.idx, -1) >= 0 ? `<button class="table-btn" type="button" data-action="identify-device" data-idx="${escapeHtml(device.idx)}">点名</button>` : ''}
                    </div>
                  </div>
                `).join('')
                : `<div class="text-[11px] text-[#9fb2c8]">${state.controllerOnline ? '这个分组还没有成员。' : '未连接控制端，暂不显示现场成员。'}</div>`}
              ${allMembers.length > members.length ? `<div class="text-[10px] text-[#8ea3bf]">还有 ${allMembers.length - members.length} 台设备未展开显示。</div>` : ''}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderGroupsPage() {
    const groups = controllerGroups();
    const fieldCount = visibleControllerDevices().length;
    const offlineNotice = state.controllerOnline ? '' : '<div class="notice">未连接控制端。分组会作为本地容器保留，但现场成员需要连接控制端并扫描后确认。</div>';
    return `
      <div class="page-section-head">
        <div>
          <h3>分组</h3>
          <p>分组只负责承载设备与备注。角色、源组、目标组这些关系都在“游戏房间”里设置。</p>
        </div>
        <div class="pill-actions">
          ${makePill(`有效分组 ${controllerGroups().length}`, true)}
          ${makePill(`现场设备 ${fieldCount}`)}
        </div>
      </div>
      <div class="page-section-body stack-col">
        ${offlineNotice}
        <section class="mini-panel">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h4>分组列表</h4>
              <div class="text-[12px] leading-[1.5] text-[#9db0c8]">点击“编辑”打开表单卡片；点击“展开”看成员。</div>
            </div>
            <button class="ghost-btn" type="button" data-action="create-group">${svgIcon('plus')}新建分组</button>
          </div>
          <div class="mt-3 grid gap-2.5">
            ${groups.map((group) => renderGroupCard(group, { compactActions: false, showDelete: true })).join('') || '<div class="notice">暂无分组。先新建一个分组。</div>'}
          </div>
        </section>
        <div class="notice">分组是设备容器。真正的角色关系请到“游戏房间”里配置。</div>
      </div>
    `;
  }

  function renderGroupDialogs() {
    const form = state.groupFormModal;
    const del = state.groupDeleteModal;
    if (!form && !del) return '';
    const modal = form || del;
    const isDelete = !!del && !form;
    return `
      <div class="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(3,6,12,0.88)] px-4 py-8 backdrop-blur-[3px]">
        <div class="w-full overflow-auto rounded-[20px] border border-[rgba(103,130,169,0.42)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.72)]" style="width:min(800px,calc(100vw - 48px));max-height:calc(100vh - 64px);background:#0d1520;">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="m-0 text-[18px] font-extrabold leading-none text-white">${isDelete ? '确认删除分组' : (form.mode === 'edit' ? '编辑分组' : '新建分组')}</h3>
              <p class="mt-1.5 text-[12px] leading-[1.55] text-[#aabbd1]">${isDelete ? '这不是错误提示，而是删除前的确认卡片。删掉后会同步清理引用。' : '先填名称和备注，再保存成分组。'}</p>
            </div>
            <button class="ghost-btn" type="button" data-action="${isDelete ? 'cancel-delete-group' : 'cancel-group-form'}">关闭</button>
          </div>
          ${isDelete ? `
            <div class="mt-4 rounded-[16px] border border-[rgba(255,138,138,0.22)] bg-[rgba(46,18,24,0.68)] p-3.5">
              <div class="text-[13px] font-bold text-[#ffd5d5]">${escapeHtml(modal.name || '未命名分组')}</div>
              <div class="mt-2 grid gap-2 text-[12px] leading-[1.55] text-[#ffdede]">
                <div>会清理：设备 ${modal.refs?.devices ?? 0} 台、房间 ${modal.refs?.rooms ?? 0} 个、模板 ${modal.refs?.templates ?? 0} 个引用。</div>
                <div>删除后该分组会从列表移除，历史记录不会被删。</div>
              </div>
            </div>
            <div class="mt-4 flex flex-wrap justify-end gap-2">
              <button class="ghost-btn" type="button" data-action="cancel-delete-group">取消</button>
              <button class="ghost-btn" type="button" data-action="confirm-delete-group">${svgIcon('trash')}确认删除</button>
            </div>
          ` : `
            <div class="mt-4 grid gap-3">
              <div class="field">
                <label>分组名称</label>
                <input class="fake-input" data-role="group-form-input" data-group-form-field="name" value="${escapeHtml(form.name || '')}" placeholder="例如：魔杖组、宝箱组">
              </div>
              <div class="field">
                <label>备注</label>
                <textarea class="fake-input" data-role="group-form-input" data-group-form-field="note" style="min-height:96px;resize:vertical" placeholder="写一点用途说明，方便后面快速识别">${escapeHtml(form.note || '')}</textarea>
              </div>
              <div class="chip-row">
                ${makeChip(form.mode === 'edit' ? '编辑中' : '新建中', true)}
                ${makeChip('分组是容器')}
                ${makeChip('角色放到房间里')}
              </div>
            </div>
            <div class="mt-4 flex flex-wrap justify-end gap-2">
              <button class="ghost-btn" type="button" data-action="cancel-group-form">取消</button>
              <button class="ghost-btn" type="button" data-action="save-group-form">${svgIcon('save')}保存</button>
            </div>
          `}
        </div>
      </div>
    `;
  }

  function renderPlayPresetDialogs() {
    const form = state.playPresetFormModal;
    const del = state.playPresetDeleteModal;
    if (!form && !del) return '';
    if (del && !form) {
      return `
        <div class="fixed inset-0 z-[130] flex items-center justify-center bg-[rgba(3,6,12,0.88)] px-4 py-8 backdrop-blur-[3px]">
          <div class="w-full overflow-auto rounded-[20px] border border-[rgba(255,138,138,0.28)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.72)]" style="width:min(560px,calc(100vw - 48px));max-height:calc(100vh - 64px);background:#0d1520;">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3 class="m-0 text-[18px] font-extrabold leading-none text-white">删除我的玩法预设</h3>
                <p class="mt-1.5 text-[12px] leading-[1.55] text-[#aabbd1]">系统默认玩法不能删除；我的玩法删除后，已结束历史记录会保留冻结快照。</p>
              </div>
              <button class="ghost-btn" type="button" data-action="cancel-delete-play-preset">关闭</button>
            </div>
            <div class="mt-4 rounded-[16px] border border-[rgba(255,138,138,0.22)] bg-[rgba(46,18,24,0.68)] p-3.5">
              <div class="text-[13px] font-bold text-[#ffd5d5]">${escapeHtml(del.name || '未命名玩法')}</div>
              <div class="mt-2 text-[12px] leading-[1.55] text-[#ffdede]">${escapeHtml(del.note || '无备注')}</div>
              <div class="mt-3 text-[12px] leading-[1.55] text-[#ffdede]">确认删除后，它会从“我的玩法预设”移除；不会删除设备、分组、灯效库和历史场次。</div>
            </div>
            <div class="mt-4 flex flex-wrap justify-end gap-2">
              <button class="ghost-btn" type="button" data-action="cancel-delete-play-preset">取消</button>
              <button class="ghost-btn" type="button" data-action="confirm-delete-play-preset">${svgIcon('trash')}确认删除</button>
            </div>
          </div>
        </div>
      `;
    }
    const option = (value, label, current) => `<option value="${escapeHtml(value)}" ${String(current ?? '') === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    const field = (label, control, hint = '') => `
      <div class="field">
        <label>${escapeHtml(label)}</label>
        ${control}
        ${hint ? `<div class="mt-1 text-[10.5px] leading-[1.45] text-[#8fa3c1]">${escapeHtml(hint)}</div>` : ''}
      </div>
    `;
    const input = (name, attrs = '') => `<input class="fake-input" data-role="play-preset-form-input" data-play-preset-form-field="${escapeHtml(name)}" value="${escapeHtml(form[name] ?? '')}" ${attrs}>`;
    const textarea = (name, attrs = '') => `<textarea class="fake-input" data-role="play-preset-form-input" data-play-preset-form-field="${escapeHtml(name)}" style="min-height:96px;resize:vertical" ${attrs}>${escapeHtml(form[name] ?? '')}</textarea>`;
    const select = (name, optionsHtml, attrs = '') => `<select class="fake-select" data-role="play-preset-form-input" data-play-preset-form-field="${escapeHtml(name)}" ${attrs}>${optionsHtml}</select>`;
    const title = form.mode === 'edit' ? '编辑我的玩法预设' : '新建玩法预设';
    const source = playPresetById(form.sourceId);
    return `
      <div class="fixed inset-0 z-[130] flex items-center justify-center bg-[rgba(3,6,12,0.88)] px-4 py-8 backdrop-blur-[3px]">
        <div class="w-full overflow-auto rounded-[20px] border border-[rgba(103,130,169,0.42)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.72)]" style="width:min(1040px,calc(100vw - 48px));max-height:calc(100vh - 64px);background:#0d1520;">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="m-0 text-[18px] font-extrabold leading-none text-white">${escapeHtml(title)}</h3>
              <p class="mt-1.5 text-[12px] leading-[1.55] text-[#aabbd1]">${form.mode === 'edit' ? '修改会保存到“我的玩法预设”。房间里已经保存的本局覆盖参数不会被自动改写。' : `基于${source?.builtIn ? '系统默认玩法' : '现有玩法'}新建一个我的预设，后续可以编辑、删除和复用。`}</p>
            </div>
            <button class="ghost-btn" type="button" data-action="cancel-play-preset-form">关闭</button>
          </div>

          <div class="mt-4 grid gap-3">
            <section class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
              <div class="mb-3 text-[13px] font-extrabold text-white">基础规则</div>
              <div class="grid gap-3 md:grid-cols-2">
                ${field('玩法名称', input('name', 'placeholder="例如：我的多人寻宝"'))}
                ${field('底层类型', select('baseTemplate', [
                  option('instant_score', '一次触发计分', form.baseTemplate),
                  option('sustain_score', '持续达标计分', form.baseTemplate),
                  option('competition_score', '竞争归属计分', form.baseTemplate)
                ].join('')))}
                <div class="md:col-span-2">${field('备注', textarea('note', 'placeholder="写给 NPC 或玩家看的用途说明"'))}</div>
                ${field('对象关系', select('relation_mode', [
                  option('one_to_one', '1对1', form.relation_mode),
                  option('one_to_many', '1对多', form.relation_mode),
                  option('many_to_one', '多对1', form.relation_mode),
                  option('many_to_many', '多对多', form.relation_mode)
                ].join('')))}
                ${field('匹配方式', select('relation_match', [
                  option('any', '任意匹配', form.relation_match),
                  option('specified_pair', '指定配对', form.relation_match),
                  option('same_group', '同组匹配', form.relation_match),
                  option('enemy_group', '敌对组匹配', form.relation_match),
                  option('source_to_target', '源组 → 目标组', form.relation_match)
                ].join('')))}
              </div>
            </section>

            <section class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
              <div class="mb-3 text-[13px] font-extrabold text-white">发现条件 / RSSI</div>
              <div class="grid gap-3 md:grid-cols-3">
                ${field('RSSI 条件', select('signal_type', [
                  option('enter_range', '进入范围', form.signal_type),
                  option('leave_range', '离开范围', form.signal_type),
                  option('stay_in_range', '保持在范围内', form.signal_type),
                  option('appeared', '从无到有', form.signal_type),
                  option('lost', '从有到无', form.signal_type),
                  option('stronger', '信号变强', form.signal_type),
                  option('weaker', '信号变弱', form.signal_type)
                ].join('')), 'RSSI 是负数，-20 dBm 比 -40 dBm 信号更强。')}
                ${field('RSSI 下限 dBm', input('signal_rssi_min', 'type="number" step="1"'))}
                ${field('RSSI 上限 dBm', input('signal_rssi_max', 'type="number" step="1" placeholder="可空"'))}
                ${field('持续时间 ms', input('signal_hold_ms', 'type="number" step="50"'))}
                ${field('丢失宽限 ms', input('signal_missing_ms', 'type="number" step="50"'))}
                ${field('平滑样本', input('signal_smooth_samples', 'type="number" min="1" max="10" step="1"'))}
              </div>
            </section>

            <section class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
              <div class="mb-3 text-[13px] font-extrabold text-white">计分与重复</div>
              <div class="grid gap-3 md:grid-cols-3">
                ${field('触发模式', select('trigger_mode', [
                  option('instant', '立即触发', form.trigger_mode),
                  option('continuous', '连续达标', form.trigger_mode),
                  option('accumulate', '累计达标', form.trigger_mode),
                  option('count', '次数达标', form.trigger_mode),
                  option('periodic', '周期计分', form.trigger_mode)
                ].join('')))}
                ${field('目标时间 ms', input('trigger_target_ms', 'type="number" step="50"'))}
                ${field('周期 ms', input('trigger_period_ms', 'type="number" step="50"'))}
                ${field('目标次数', input('trigger_target_count', 'type="number" min="1" step="1"'))}
                ${field('计分对象', select('score_target', [
                  option('source_player', '源玩家', form.score_target),
                  option('source_group', '源小组', form.score_target),
                  option('target_player', '目标玩家', form.score_target),
                  option('target_group', '目标小组', form.score_target),
                  option('both_players', '双方玩家', form.score_target),
                  option('both_groups', '双方小组', form.score_target),
                  option('none', '不计分，只触发灯效', form.score_target)
                ].join('')))}
                ${field('分数', input('score_points', 'type="number" step="1"'))}
                ${field('重复规则', select('repeat_mode', [
                  option('allow_repeat', '允许重复', form.repeat_mode),
                  option('once_per_pair', '每对设备只算一次', form.repeat_mode),
                  option('once_per_target', '每个目标只算一次（实验）', form.repeat_mode),
                  option('once_per_source', '每个源设备只算一次', form.repeat_mode),
                  option('cooldown', '冷却后可重复', form.repeat_mode)
                ].join('')))}
                ${field('冷却 ms', input('repeat_cooldown_ms', 'type="number" step="50"'))}
                ${field('触发后目标', select('after_target_state', [
                  option('none', '无处理', form.after_target_state),
                  option('cooldown', '冷却', form.after_target_state),
                  option('disabled', '目标失效（实验）', form.after_target_state),
                  option('locked', '目标锁定', form.after_target_state)
                ].join('')))}
                ${field('计时处理', select('after_timer_action', [
                  option('none', '无处理', form.after_timer_action),
                  option('reset', '计时清零', form.after_timer_action),
                  option('pause', '计时暂停', form.after_timer_action)
                ].join('')))}
              </div>
            </section>

            <section class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
              <div class="mb-3 text-[13px] font-extrabold text-white">灯效反馈</div>
              <div class="grid gap-3 md:grid-cols-3">
                ${field('空闲 / 靠近灯效', select('feedback_enter', effectChoiceOptions(form.feedback_enter)))}
                ${field('成功灯效', select('feedback_success', effectChoiceOptions(form.feedback_success)))}
                ${field('失败灯效', select('feedback_fail', effectChoiceOptions(form.feedback_fail)))}
              </div>
              <div class="mt-3 rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] p-3">
                <label class="inline-flex h-8 items-center gap-2 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold text-[#dbe5f4]">
                  <input type="checkbox" class="h-4 w-4 accent-blue-500" data-role="play-preset-form-input" data-play-preset-form-field="meter_enabled" ${form.meter_enabled ? 'checked' : ''}>
                  启用信号强度指示灯
                </label>
                <div class="mt-3 grid gap-3 md:grid-cols-5">
                  ${field('LED 路', select('meter_port', [
                    option('1', 'LED1', form.meter_port),
                    option('2', 'LED2', form.meter_port),
                    option('3', 'LED3', form.meter_port)
                  ].join('')))}
                  ${field('灯珠级别数', input('meter_led_count', 'type="number" min="1" max="200" step="1"'))}
                  ${field('弱信号 dBm', input('meter_weak_rssi', 'type="number" step="1"'))}
                  ${field('满格信号 dBm', input('meter_strong_rssi', 'type="number" step="1"'))}
                  ${field('压缩比例', input('meter_compression', 'type="number" min="20" max="500" step="10"'))}
                </div>
              </div>
            </section>
          </div>

          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <button class="ghost-btn" type="button" data-action="cancel-play-preset-form">取消</button>
            <button class="ghost-btn" type="button" data-action="save-play-preset-form">${svgIcon('save')}保存玩法</button>
          </div>
        </div>
      </div>
    `;
  }

  function ruleTypeLabel(value) {
    const key = String(value || 'instant_score');
    if (key === 'sustain_score') return '持续达标计分';
    if (key === 'competition_score') return '竞争归属计分';
    return '一次触发计分';
  }

  function relationModeLabel(value) {
    const key = String(value || 'many_to_many');
    if (key === 'one_to_one') return '1对1';
    if (key === 'one_to_many') return '1对多';
    if (key === 'many_to_one') return '多对1';
    return '多对多';
  }

  function matchModeLabel(value) {
    const key = String(value || 'source_to_target');
    if (key === 'any') return '任意匹配';
    if (key === 'specified_pair') return '指定配对';
    if (key === 'same_group') return '同组匹配';
    if (key === 'enemy_group') return '敌对组匹配';
    return '源组 → 目标组';
  }

  function signalTypeLabel(value) {
    const key = String(value || 'enter_range');
    if (key === 'leave_range') return '离开范围';
    if (key === 'lost') return '从有到无';
    if (key === 'appeared') return '从无到有';
    if (key === 'stronger') return '信号变强';
    if (key === 'weaker') return '信号变弱';
    if (key === 'stay_in_range') return '保持在范围内';
    return '进入范围';
  }

  function triggerModeLabel(value) {
    const key = String(value || 'instant');
    if (key === 'continuous') return '连续达标';
    if (key === 'accumulate') return '累计达标';
    if (key === 'count') return '次数达标';
    if (key === 'periodic') return '周期计分';
    return '立即触发';
  }

  function scoreTargetLabel(value) {
    const key = String(value || 'source_player');
    if (key === 'source_group') return '源小组';
    if (key === 'target_player') return '目标玩家';
    if (key === 'target_group') return '目标小组';
    if (key === 'both_players') return '双方玩家';
    if (key === 'both_groups') return '双方小组';
    if (key === 'none') return '不计分，只触发灯效';
    return '源玩家';
  }

  function repeatModeLabel(value) {
    const key = String(value || 'once_per_pair');
    if (key === 'allow_repeat') return '允许重复';
    if (key === 'once_per_target') return '每个目标只算一次（实验）';
    if (key === 'once_per_source') return '每个源设备只算一次';
    if (key === 'cooldown') return '冷却后可重复';
    return '每对设备只算一次';
  }

  function scoreSummaryText(score = {}) {
    const target = String(score?.target || 'source_player');
    const points = normalizeNumber(score?.points, target === 'none' ? 0 : 1);
    if (target === 'none' || points === 0) return '不计分，只触发灯效';
    return `${scoreTargetLabel(target)} ${points > 0 ? '+' : ''}${points} 分`;
  }

  function roomEffectFieldSummary(room, field, fallbackEffectId = 'builtin-silent') {
    const ids = Array.from(new Set((Array.isArray(room?.effect_rules) ? room.effect_rules : [])
      .map((rule) => String(rule?.[field] || '').trim())
      .filter(Boolean)));
    if (ids.length === 1) return effectNameById(ids[0]);
    if (ids.length > 1) return `${ids.length} 种灯效`;
    return effectNameById(fallbackEffectId);
  }

  function signalSummaryText(preset) {
    const signal = preset?.signal || {};
    const type = signalTypeLabel(signal.type);
    const min = normalizeNumber(signal.rssiMin, DEFAULT_TRIGGER_RSSI);
    const max = signal.rssiMax === null || signal.rssiMax === undefined ? null : normalizeNumber(signal.rssiMax, -20);
    const hold = normalizeNumber(signal.holdMs, DEFAULT_TRIGGER_HOLD_MS);
    const range = max === null ? `RSSI >= ${min} dBm` : `${min} <= RSSI <= ${max} dBm`;
    const holdText = hold > 0 ? `，持续 ${(hold / 1000).toFixed(hold % 1000 ? 1 : 0)} 秒` : '';
    return `${type}：${range}${holdText}`;
  }

  function triggerSummaryText(preset) {
    const trigger = preset?.trigger || {};
    const mode = triggerModeLabel(trigger.mode);
    const targetMs = normalizeNumber(trigger.targetMs, 0);
    const periodMs = normalizeNumber(trigger.periodMs, 0);
    const count = normalizeNumber(trigger.targetCount, 1);
    if (String(trigger.mode || '') === 'continuous' && targetMs > 0) return `${mode} ${(targetMs / 1000).toFixed(targetMs % 1000 ? 1 : 0)} 秒`;
    if (String(trigger.mode || '') === 'accumulate' && targetMs > 0) return `${mode} ${(targetMs / 1000).toFixed(targetMs % 1000 ? 1 : 0)} 秒`;
    if (String(trigger.mode || '') === 'periodic' && periodMs > 0) return `${mode}：每 ${(periodMs / 1000).toFixed(periodMs % 1000 ? 1 : 0)} 秒`;
    if (String(trigger.mode || '') === 'count') return `${mode} ${count} 次`;
    return mode;
  }

  function renderGamePage() {
    const presets = allPlayPresets();
    const selected = selectedFeaturePreset() || presets[0] || null;
    const query = String(state.localState?.ui?.play_preset_query || '').trim().toLowerCase();
    const filter = String(state.localState?.ui?.play_preset_filter || 'all');
    const showAdvanced = state.localState?.ui?.play_preset_advanced === true;
    const systemCollapsed = state.localState?.ui?.system_play_presets_collapsed !== false;
    const listCollapsed = state.localState?.ui?.play_preset_list_collapsed === true;
    const editable = selected && selected.builtIn !== true;
    const ui = {
      shell: 'rounded-[20px] border border-[#2b3f68] bg-[#081120] p-4 text-slate-100 sm:p-6',
      panel: 'rounded-[20px] border border-[#2b3f68] bg-[#111827]/80 shadow-lg shadow-black/20',
      card: 'rounded-2xl border border-[#2b3f68] bg-[#13203a]/70 p-4',
      input: 'h-10 w-full rounded-xl border border-[#2b3f68] bg-[#081120]/70 px-3 text-[12px] font-semibold text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[rgba(103,174,254,0.5)] focus:ring-2 focus:ring-blue-500/20',
      textarea: 'min-h-[86px] w-full rounded-xl border border-[#2b3f68] bg-[#081120]/70 px-3 py-2 text-[12px] font-semibold leading-[1.55] text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[rgba(103,174,254,0.5)] focus:ring-2 focus:ring-blue-500/20',
      label: 'text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400',
      hint: 'mt-1 text-[10.5px] leading-[1.45] text-slate-400',
      button: 'inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-[12px] font-bold leading-none whitespace-nowrap transition hover:brightness-110 active:translate-y-px',
      badge: 'inline-flex h-6 items-center justify-center rounded-full border px-2.5 text-[10.5px] font-bold leading-none whitespace-nowrap'
    };
    const option = (value, label, current) => `<option value="${escapeHtml(value)}" ${String(current ?? '') === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    const button = (label, action, { icon = '', variant = 'secondary', attrs = '' } = {}) => {
      const variants = {
        primary: 'border-blue-500/60 bg-blue-500/90 text-white shadow-lg shadow-blue-950/25',
        secondary: 'border-[#2b3f68] bg-[#13203a]/80 text-slate-100',
        success: 'border-emerald-500/50 bg-emerald-500/20 text-emerald-100',
        warning: 'border-amber-500/50 bg-amber-500/20 text-amber-100',
        danger: 'border-red-500/50 bg-red-500/18 text-red-100',
        ghost: 'border-[#2b3f68] bg-[#081120]/45 text-slate-300'
      };
      return `<button class="${ui.button} ${variants[variant] || variants.secondary}" type="button" data-action="${escapeHtml(action)}" ${attrs}>${icon ? svgIcon(icon) : ''}${escapeHtml(label)}</button>`;
    };
    const badge = (label, tone = 'slate') => {
      const tones = {
        violet: 'border-blue-500/45 bg-blue-500/15 text-blue-200',
        blue: 'border-blue-500/45 bg-blue-500/15 text-blue-200',
        emerald: 'border-emerald-500/45 bg-emerald-500/15 text-emerald-200',
        amber: 'border-amber-500/45 bg-amber-500/15 text-amber-200',
        red: 'border-red-500/45 bg-red-500/15 text-red-200',
        slate: 'border-[#2b3f68] bg-[#081120]/55 text-slate-300'
      };
      return `<span class="${ui.badge} ${tones[tone] || tones.slate}">${escapeHtml(label)}</span>`;
    };
    const filterButton = (label, action, active) => button(label, action, {
      variant: active ? 'primary' : 'ghost',
      attrs: `aria-pressed="${active ? 'true' : 'false'}"`
    });
    const field = (label, control, hint = '') => `
      <div class="space-y-1.5">
        <div class="${ui.label}">${escapeHtml(label)}</div>
        ${control}
        ${hint ? `<div class="${ui.hint}">${escapeHtml(hint)}</div>` : ''}
      </div>
    `;
    const input = (presetField, value, attrs = '') => `<input class="${ui.input}" data-role="feature-preset-field" data-preset-field="${escapeHtml(presetField)}" value="${escapeHtml(value ?? '')}" ${attrs}>`;
    const textarea = (presetField, value, attrs = '') => `<textarea class="${ui.textarea}" data-role="feature-preset-field" data-preset-field="${escapeHtml(presetField)}" ${attrs}>${escapeHtml(value ?? '')}</textarea>`;
    const select = (presetField, value, optionsHtml, attrs = '') => `<select class="${ui.input}" data-role="feature-preset-field" data-preset-field="${escapeHtml(presetField)}" ${attrs}>${optionsHtml}</select>`;
    const section = (icon, title, desc, content) => `
      <section class="${ui.card}">
        <div class="mb-4 flex items-start gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-500/45 bg-blue-500/15 text-blue-200">${svgIcon(icon)}</div>
          <div class="min-w-0">
            <h4 class="text-[14px] font-black text-slate-100">${escapeHtml(title)}</h4>
            <p class="mt-1 text-[11.5px] leading-[1.5] text-slate-400">${escapeHtml(desc)}</p>
          </div>
        </div>
        ${content}
      </section>
    `;
    const summaryRow = (label, value, icon = 'check') => `
      <div class="flex items-start gap-3 rounded-xl border border-[#2b3f68]/70 bg-[#081120]/45 px-3 py-2.5">
        <div class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-200">${svgIcon(icon)}</div>
        <div class="min-w-0">
          <div class="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">${escapeHtml(label)}</div>
          <div class="mt-0.5 break-words text-[12px] font-bold leading-[1.45] text-slate-100">${escapeHtml(value || '未设置')}</div>
        </div>
      </div>
    `;
    const ruleTone = (preset) => {
      const key = String(preset?.baseTemplate || 'instant_score');
      if (key === 'sustain_score') return { icon: 'clock', badge: 'blue', bar: 'bg-blue-500', border: 'border-blue-500/55', bg: 'bg-blue-500/10' };
      if (key === 'competition_score') return { icon: 'trophy', badge: 'amber', bar: 'bg-amber-500', border: 'border-amber-500/55', bg: 'bg-amber-500/10' };
      return { icon: 'target', badge: 'blue', bar: 'bg-blue-500', border: 'border-blue-500/55', bg: 'bg-blue-500/10' };
    };
    const matchesPreset = (preset) => {
      if (!preset) return false;
      if (filter === 'system' && preset.builtIn !== true) return false;
      if (filter === 'user' && preset.builtIn === true) return false;
      if (!query) return true;
      return [preset.name, preset.note, ruleTypeLabel(preset.baseTemplate), relationModeLabel(preset.relation?.mode)]
        .some((part) => String(part || '').toLowerCase().includes(query));
    };
    const systemPresets = systemPlayPresets().filter(matchesPreset);
    const customPresets = userPlayPresets().filter(matchesPreset);
    const renderPresetCard = (preset, mode = 'system') => {
      const tone = ruleTone(preset);
      const isSelected = selected?.id === preset.id;
      return `
        <article class="relative cursor-pointer overflow-hidden rounded-2xl border ${isSelected ? `${tone.border} ${tone.bg}` : 'border-[#2b3f68] bg-[#13203a]/70'} p-4 transition hover:border-blue-500/55 hover:bg-[#182644]/80" role="button" tabindex="0" data-action="select-feature-preset" data-preset-id="${escapeHtml(preset.id)}">
          <div class="absolute inset-y-4 left-0 w-1 rounded-r-full ${isSelected ? tone.bar : 'bg-[#2b3f68]'}"></div>
          <div class="flex items-start gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${tone.border} ${tone.bg} text-slate-100">${svgIcon(tone.icon)}</div>
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <h4 class="truncate text-[14px] font-black text-slate-100">${escapeHtml(preset.name)}</h4>
                ${badge(preset.builtIn ? '系统' : '我的', preset.builtIn ? 'slate' : 'emerald')}
              </div>
              <p class="mt-1 line-clamp-2 min-h-[34px] text-[11.5px] leading-[1.45] text-slate-400">${escapeHtml(preset.note || '暂无备注')}</p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-1.5">
            ${badge(ruleTypeLabel(preset.baseTemplate), tone.badge)}
            ${badge(relationModeLabel(preset.relation?.mode), 'blue')}
            ${badge(triggerModeLabel(preset.trigger?.mode), 'slate')}
          </div>
          <div class="mt-3 grid gap-2 text-[11px] leading-[1.45] text-slate-300">
            <div class="flex gap-2"><span class="w-10 shrink-0 text-slate-500">RSSI</span><span class="min-w-0">${escapeHtml(signalSummaryText(preset))}</span></div>
            <div class="flex gap-2"><span class="w-10 shrink-0 text-slate-500">计分</span><span>${escapeHtml(scoreTargetLabel(preset.score?.target))} ${normalizeNumber(preset.score?.points, 1) >= 0 ? '+' : ''}${escapeHtml(normalizeNumber(preset.score?.points, 1))}</span></div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            ${button('创建房间', 'create-room-from-template', { icon: 'arrow', variant: 'primary', attrs: `data-template-id="${escapeHtml(preset.id)}"` })}
            ${mode === 'system'
              ? button('基于此新建', 'create-play-preset-from', { icon: 'plus', variant: 'secondary', attrs: `data-preset-id="${escapeHtml(preset.id)}"` })
              : `${button('编辑', 'edit-play-preset', { icon: 'sliders', variant: 'secondary', attrs: `data-preset-id="${escapeHtml(preset.id)}"` })}
                 ${button('新建副本', 'clone-play-preset', { icon: 'plus', variant: 'ghost', attrs: `data-preset-id="${escapeHtml(preset.id)}"` })}
                 ${button('删除', 'delete-play-preset', { icon: 'trash', variant: 'danger', attrs: `data-preset-id="${escapeHtml(preset.id)}"` })}`}
          </div>
        </article>
      `;
    };
    const renderPresetList = (items, mode) => items.length
      ? items.map((preset) => renderPresetCard(preset, mode)).join('')
      : `<div class="rounded-2xl border border-dashed border-[#2b3f68] bg-[#081120]/40 p-4 text-[12px] leading-[1.6] text-slate-400">${mode === 'user' ? '还没有我的玩法预设。点“新建玩法”，或从系统默认玩法里点“基于此新建”。' : '没有符合筛选条件的系统默认玩法预设。'}</div>`;
    const meter = selected?.feedback?.signalMeter || {};
    const scoreText = selected ? `${scoreTargetLabel(selected.score?.target)} ${normalizeNumber(selected.score?.points, 1) >= 0 ? '+' : ''}${normalizeNumber(selected.score?.points, 1)} 分` : '';
    const repeatText = selected ? `${repeatModeLabel(selected.repeat?.mode)}${normalizeNumber(selected.repeat?.cooldownMs, 0) > 0 ? ` / 冷却 ${normalizeNumber(selected.repeat?.cooldownMs, 0)} ms` : ''}` : '';
    const meterText = selected ? (meter.enabled === true
      ? `LED${normalizeNumber(meter.port, 1)} · ${normalizeNumber(meter.ledCount, 10)} 格 · ${normalizeNumber(meter.weakRssi, -90)} 到 ${normalizeNumber(meter.strongRssi, DEFAULT_TRIGGER_RSSI)} dBm · 压缩 ${normalizeNumber(meter.compressionX100, 100)}`
      : '关闭') : '';
    const renderReadOnlyPanel = () => `
      <div class="${ui.card}">
        <div class="flex items-start gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/15 text-amber-200">${svgIcon('eye')}</div>
          <div class="min-w-0">
            <h4 class="text-[14px] font-black text-slate-100">系统默认预设不可直接编辑</h4>
            <p class="mt-1 text-[12px] leading-[1.55] text-slate-400">它作为可靠起点保留。需要改参数时，基于它新建一个“我的玩法预设”。</p>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          ${button('基于此新建', 'create-play-preset-from', { icon: 'plus', variant: 'primary', attrs: `data-preset-id="${escapeHtml(selected?.id || '')}"` })}
          ${button('创建房间', 'create-room-from-template', { icon: 'arrow', variant: 'secondary', attrs: `data-template-id="${escapeHtml(selected?.id || '')}"` })}
        </div>
      </div>
      ${section('sliders', '当前默认参数', '只读预览，不会保存为用户修改。', `
        <div class="grid gap-3 md:grid-cols-2">
          ${summaryRow('底层类型', ruleTypeLabel(selected?.baseTemplate), 'target')}
          ${summaryRow('对象关系', `${relationModeLabel(selected?.relation?.mode)} / ${matchModeLabel(selected?.relation?.match)}`, 'users')}
          ${summaryRow('RSSI 条件', signalSummaryText(selected), 'wifi')}
          ${summaryRow('触发模式', triggerSummaryText(selected), 'zap')}
          ${summaryRow('计分', scoreText, 'trophy')}
          ${summaryRow('重复', repeatText, 'refresh')}
        </div>
      `)}
    `;
    const renderEditablePreviewPanel = () => `
      <div class="${ui.card}">
        <div class="flex items-start gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-200">${svgIcon('sliders')}</div>
          <div class="min-w-0 flex-1">
            <h4 class="text-[14px] font-black text-slate-100">我的玩法预设</h4>
            <p class="mt-1 text-[12px] leading-[1.55] text-slate-400">当前区域只负责查看摘要；需要修改参数时打开编辑卡片，保存后再回到这里。</p>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          ${button('编辑参数', 'edit-play-preset', { icon: 'sliders', variant: 'primary', attrs: `data-preset-id="${escapeHtml(selected?.id || '')}"` })}
          ${button('创建房间', 'create-room-from-template', { icon: 'arrow', variant: 'secondary', attrs: `data-template-id="${escapeHtml(selected?.id || '')}"` })}
          ${button('新建副本', 'clone-play-preset', { icon: 'plus', variant: 'ghost', attrs: `data-preset-id="${escapeHtml(selected?.id || '')}"` })}
          ${button('删除', 'delete-play-preset', { icon: 'trash', variant: 'danger', attrs: `data-preset-id="${escapeHtml(selected?.id || '')}"` })}
        </div>
      </div>
      ${section('sliders', '当前参数摘要', '这是保存后的规则摘要，不是编辑表单。', `
        <div class="grid gap-3 md:grid-cols-2">
          ${summaryRow('底层类型', ruleTypeLabel(selected?.baseTemplate), 'target')}
          ${summaryRow('对象关系', `${relationModeLabel(selected?.relation?.mode)} / ${matchModeLabel(selected?.relation?.match)}`, 'users')}
          ${summaryRow('RSSI 条件', signalSummaryText(selected), 'wifi')}
          ${summaryRow('触发模式', triggerSummaryText(selected), 'zap')}
          ${summaryRow('计分', scoreText, 'trophy')}
          ${summaryRow('重复', repeatText, 'refresh')}
          ${summaryRow('灯效反馈', `空闲 ${effectNameById(selected?.feedback?.onEnter || '')} / 成功 ${effectNameById(selected?.feedback?.onSuccess || '')}`, 'effect')}
          ${summaryRow('信号指示灯', meterText, 'eye')}
        </div>
      `)}
    `;
    const renderEditorForm = () => {
      if (!selected) return '<div class="rounded-2xl border border-dashed border-[#2b3f68] bg-[#081120]/40 p-6 text-[12px] text-slate-400">暂无玩法预设。</div>';
      if (!editable) return renderReadOnlyPanel();
      return renderEditablePreviewPanel();
      return `
        ${section('sliders', '基础规则', '定义玩法名称、底层类型、设备关系和匹配方式。', `
          <div class="grid gap-4 md:grid-cols-2">
            ${field('名称', input('name', selected.name || ''))}
            ${field('底层类型', select('baseTemplate', selected.baseTemplate, [
              option('instant_score', '一次触发计分', selected.baseTemplate),
              option('sustain_score', '持续达标计分', selected.baseTemplate),
              option('competition_score', '竞争归属计分', selected.baseTemplate)
            ].join('')))}
            <div class="md:col-span-2">${field('备注', textarea('note', selected.note || ''))}</div>
            ${field('对象关系', select('relation_mode', selected.relation?.mode, [
              option('one_to_one', '1对1', selected.relation?.mode),
              option('one_to_many', '1对多', selected.relation?.mode),
              option('many_to_one', '多对1', selected.relation?.mode),
              option('many_to_many', '多对多', selected.relation?.mode || 'many_to_many')
            ].join('')))}
            ${field('匹配方式', select('relation_match', selected.relation?.match, [
              option('any', '任意匹配', selected.relation?.match),
              option('specified_pair', '指定配对', selected.relation?.match),
              option('same_group', '同组匹配', selected.relation?.match),
              option('enemy_group', '敌对组匹配', selected.relation?.match),
              option('source_to_target', '源组 → 目标组', selected.relation?.match || 'source_to_target')
            ].join('')))}
          </div>
        `)}
        ${section('wifi', '发现条件 / RSSI', 'RSSI 是负数，-20 dBm 比 -40 dBm 信号更强。', `
          <div class="grid gap-4 md:grid-cols-3">
            ${field('RSSI 条件', select('signal_type', selected.signal?.type, [
              option('enter_range', '进入范围', selected.signal?.type || 'enter_range'),
              option('leave_range', '离开范围', selected.signal?.type),
              option('stay_in_range', '保持在范围内', selected.signal?.type),
              option('appeared', '从无到有', selected.signal?.type),
              option('lost', '从有到无', selected.signal?.type),
              option('stronger', '信号变强', selected.signal?.type),
              option('weaker', '信号变弱', selected.signal?.type)
            ].join('')))}
            ${field('RSSI 下限 dBm', input('signal_rssi_min', selected.signal?.rssiMin ?? DEFAULT_TRIGGER_RSSI, 'type="number" step="1"'))}
            ${field('RSSI 上限 dBm', input('signal_rssi_max', selected.signal?.rssiMax ?? '', 'type="number" step="1" placeholder="可空"'))}
            ${field('持续时间 ms', input('signal_hold_ms', selected.signal?.holdMs ?? DEFAULT_TRIGGER_HOLD_MS, 'type="number" step="50"'))}
            ${showAdvanced ? field('丢失宽限 ms', input('signal_missing_ms', selected.signal?.missingMs ?? 3000, 'type="number" step="50"')) : ''}
            ${showAdvanced ? field('平滑样本', input('signal_smooth_samples', selected.signal?.smoothSamples ?? 5, 'type="number" min="1" max="10" step="1"')) : ''}
          </div>
        `)}
        ${section('trophy', '计分与重复规则', '设置触发模式、得分对象和同一关系是否可以重复计分。', `
          <div class="grid gap-4 md:grid-cols-3">
            ${field('触发模式', select('trigger_mode', selected.trigger?.mode, [
              option('instant', '立即触发', selected.trigger?.mode || 'instant'),
              option('continuous', '连续达标', selected.trigger?.mode),
              option('accumulate', '累计达标', selected.trigger?.mode),
              option('count', '次数达标', selected.trigger?.mode),
              option('periodic', '周期计分', selected.trigger?.mode)
            ].join('')))}
            ${field('目标时间 ms', input('trigger_target_ms', selected.trigger?.targetMs ?? 0, 'type="number" step="50"'))}
            ${field('计分对象', select('score_target', selected.score?.target, [
              option('source_player', '源玩家', selected.score?.target || 'source_player'),
              option('source_group', '源小组', selected.score?.target),
              option('target_player', '目标玩家', selected.score?.target),
              option('target_group', '目标小组', selected.score?.target),
              option('both_players', '双方玩家', selected.score?.target),
              option('both_groups', '双方小组', selected.score?.target),
              option('none', '不计分，只触发灯效', selected.score?.target)
            ].join('')))}
            ${field('分数', input('score_points', selected.score?.points ?? 1, 'type="number" step="1"'))}
            ${field('重复规则', select('repeat_mode', selected.repeat?.mode, [
              option('allow_repeat', '允许重复', selected.repeat?.mode),
              option('once_per_pair', '每对设备只算一次', selected.repeat?.mode || 'once_per_pair'),
              option('once_per_target', '每个目标只算一次（实验）', selected.repeat?.mode),
              option('once_per_source', '每个源设备只算一次', selected.repeat?.mode),
              option('cooldown', '冷却后可重复', selected.repeat?.mode)
            ].join('')))}
            ${showAdvanced ? field('冷却 ms', input('repeat_cooldown_ms', selected.repeat?.cooldownMs ?? 5000, 'type="number" step="50"')) : ''}
            ${showAdvanced ? field('周期 ms', input('trigger_period_ms', selected.trigger?.periodMs ?? 0, 'type="number" step="50"')) : ''}
            ${showAdvanced ? field('次数', input('trigger_target_count', selected.trigger?.targetCount ?? 1, 'type="number" step="1"')) : ''}
            ${showAdvanced ? field('触发后处理', select('after_target_state', selected.afterTrigger?.targetState, [
              option('none', '无处理', selected.afterTrigger?.targetState || 'none'),
              option('cooldown', '冷却', selected.afterTrigger?.targetState),
              option('disabled', '目标失效（实验）', selected.afterTrigger?.targetState),
              option('locked', '目标锁定', selected.afterTrigger?.targetState)
            ].join(''))) : ''}
            ${showAdvanced ? field('计时处理', select('after_timer_action', selected.afterTrigger?.timerAction, [
              option('none', '无处理', selected.afterTrigger?.timerAction || 'none'),
              option('reset', '计时清零', selected.afterTrigger?.timerAction),
              option('pause', '计时暂停', selected.afterTrigger?.timerAction)
            ].join(''))) : ''}
          </div>
        `)}
        ${section('zap', '灯效反馈', '选择成功、靠近/空闲灯效，并配置可选的信号强度指示灯。', `
          <div class="grid gap-4 md:grid-cols-2">
            ${field('成功灯效', select('feedback_success', selected.feedback?.onSuccess || 'builtin-pulse', effectChoiceOptions(selected.feedback?.onSuccess || 'builtin-pulse')))}
            ${field('靠近 / 空闲灯效', select('feedback_enter', selected.feedback?.onEnter || 'builtin-breath', effectChoiceOptions(selected.feedback?.onEnter || 'builtin-breath')))}
          </div>
          <div class="mt-4 rounded-2xl border border-[#2b3f68] bg-[#081120]/45 p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="text-[13px] font-black text-slate-100">信号强度指示灯</div>
                <div class="mt-1 max-w-[720px] text-[11.5px] leading-[1.5] text-slate-400">打开后，指定 LED 路会按最近目标信号强弱显示亮起灯珠数量；没有收到目标信号时不亮。</div>
              </div>
              <label class="inline-flex h-9 items-center gap-2 rounded-lg border border-[#2b3f68] bg-[#13203a]/80 px-3 text-[12px] font-bold text-slate-100">
                <input type="checkbox" class="h-4 w-4 accent-blue-500" data-role="feature-preset-field" data-preset-field="meter_enabled" ${selected.feedback?.signalMeter?.enabled === true ? 'checked' : ''}>
                启用
              </label>
            </div>
            <div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              ${field('LED 路径', select('meter_port', normalizeNumber(selected.feedback?.signalMeter?.port, 1), [
                option('1', 'LED1', normalizeNumber(selected.feedback?.signalMeter?.port, 1)),
                option('2', 'LED2', normalizeNumber(selected.feedback?.signalMeter?.port, 1)),
                option('3', 'LED3', normalizeNumber(selected.feedback?.signalMeter?.port, 1))
              ].join('')))}
              ${field('灯珠级别数', input('meter_led_count', normalizeNumber(selected.feedback?.signalMeter?.ledCount, 10), 'type="number" min="1" max="200" step="1"'))}
              ${field('弱信号 dBm', input('meter_weak_rssi', normalizeNumber(selected.feedback?.signalMeter?.weakRssi, -90), 'type="number" step="1"'))}
              ${field('满格信号 dBm', input('meter_strong_rssi', normalizeNumber(selected.feedback?.signalMeter?.strongRssi, normalizeNumber(selected.signal?.rssiMin, DEFAULT_TRIGGER_RSSI)), 'type="number" step="1"'))}
              ${field('压缩比例', input('meter_compression', normalizeNumber(selected.feedback?.signalMeter?.compressionX100, 100), 'type="number" min="20" max="500" step="10"'), '100=线性，160/200 适合强信号容易满格时使用。')}
            </div>
          </div>
        `)}
      `;
    };
    const renderSummary = () => selected ? `
      <aside class="${ui.panel} p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-[11px] font-black uppercase tracking-[0.14em] text-blue-200">Preset Summary</div>
            <h3 class="mt-2 break-words text-[20px] font-black leading-tight text-slate-100">${escapeHtml(selected.name)}</h3>
            <p class="mt-2 text-[12px] leading-[1.55] text-slate-400">${escapeHtml(selected.note || '暂无备注')}</p>
          </div>
          ${badge(selected.builtIn ? '系统默认' : '我的预设', selected.builtIn ? 'slate' : 'emerald')}
        </div>
        <div class="mt-4 grid grid-cols-2 gap-3">
          <div class="rounded-2xl border border-[#2b3f68] bg-[#13203a]/70 p-3">
            <div class="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">类型</div>
            <div class="mt-1 text-[13px] font-black text-slate-100">${escapeHtml(ruleTypeLabel(selected.baseTemplate))}</div>
          </div>
          <div class="rounded-2xl border border-[#2b3f68] bg-[#13203a]/70 p-3">
            <div class="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">更新</div>
            <div class="mt-1 text-[13px] font-black text-slate-100">${escapeHtml(formatTime(selected.updated_at))}</div>
          </div>
        </div>
        <div class="mt-4 space-y-2">
          ${summaryRow('关系', `${relationModeLabel(selected.relation?.mode)} / ${matchModeLabel(selected.relation?.match)}`, 'users')}
          ${summaryRow('RSSI', signalSummaryText(selected), 'wifi')}
          ${summaryRow('触发', triggerSummaryText(selected), 'zap')}
          ${summaryRow('计分', scoreText, 'trophy')}
          ${summaryRow('重复', repeatText, 'refresh')}
          ${summaryRow('指示灯', meterText, 'eye')}
        </div>
        <div class="mt-4 rounded-2xl border border-[#2b3f68] bg-[#081120]/45 p-3">
          <div class="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">操作</div>
          <div class="mt-3 flex flex-wrap gap-2">
            ${button('创建房间', 'create-room-from-template', { icon: 'arrow', variant: 'primary', attrs: `data-template-id="${escapeHtml(selected.id)}"` })}
            ${selected.builtIn
              ? button('基于此新建', 'create-play-preset-from', { icon: 'plus', variant: 'secondary', attrs: `data-preset-id="${escapeHtml(selected.id)}"` })
              : `${button('编辑参数', 'edit-play-preset', { icon: 'sliders', variant: 'secondary', attrs: `data-preset-id="${escapeHtml(selected.id)}"` })}
                 ${button('新建副本', 'clone-play-preset', { icon: 'plus', variant: 'ghost', attrs: `data-preset-id="${escapeHtml(selected.id)}"` })}`}
            ${editable ? button('删除', 'delete-play-preset', { icon: 'trash', variant: 'danger', attrs: `data-preset-id="${escapeHtml(selected.id)}"` }) : ''}
          </div>
        </div>
      </aside>
    ` : `<aside class="${ui.panel} p-4 text-[12px] text-slate-400">暂无选中的玩法预设。</aside>`;
    const showUserSection = filter !== 'system';
    const showSystemSection = filter !== 'user';
    return `
      <div class="${ui.shell}">
        <div class="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="text-[11px] font-black uppercase tracking-[0.16em] text-blue-200">Magic Wand Rules</div>
            <h3 class="mt-2 text-[24px] font-black leading-none text-slate-100">玩法预设</h3>
            <p class="mt-2 max-w-[920px] text-[12.5px] leading-[1.55] text-slate-400">系统默认玩法作为可靠起点；我的玩法预设用于新建、编辑、删除和复用。房间只负责本局设备和覆盖参数。</p>
          </div>
          <div class="flex flex-wrap gap-2">
            ${badge('3 类底层规则', 'blue')}
            ${badge('房间开局分离', 'blue')}
            ${badge('只改 UI', 'emerald')}
          </div>
        </div>
        <div class="grid gap-4" style="grid-template-columns:${listCollapsed ? '72px minmax(0,1fr)' : 'minmax(360px,min(38vw,680px)) minmax(0,1fr)'};align-items:start;">
          ${listCollapsed ? `
            <aside class="${ui.panel} sticky top-4 flex min-h-[520px] flex-col items-center gap-3 p-2">
              <button class="${ui.button} h-10 w-10 border-blue-500/60 bg-blue-500/90 p-0 text-white" type="button" title="展开玩法预设列表" data-action="toggle-play-preset-list">${svgIcon('list')}</button>
              <div class="mt-1 text-center text-[10px] font-black leading-[1.35] text-slate-400">玩法<br>预设</div>
              <div class="rounded-full border border-[#2b3f68] bg-[#081120]/55 px-2 py-1 text-[10px] font-bold text-slate-300">${customPresets.length + systemPresets.length}</div>
            </aside>
          ` : `
            <aside class="${ui.panel} sticky top-4 max-h-[calc(100vh-144px)] overflow-hidden p-4">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <h4 class="text-[15px] font-black text-slate-100">玩法预设列表</h4>
                  <div class="mt-1 text-[11px] text-slate-400">先选玩法，再编辑参数或创建房间。</div>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  ${badge(`${customPresets.length + systemPresets.length} 项`, 'slate')}
                  ${button('新建玩法', 'create-play-preset', { icon: 'plus', variant: 'primary' })}
                  ${button('收起', 'toggle-play-preset-list', { icon: 'pause', variant: 'ghost' })}
                </div>
              </div>
              <div class="mt-4 grid gap-3">
                <div class="flex flex-wrap gap-2">
                  ${filterButton('全部', 'play-preset-filter-all', filter === 'all')}
                  ${filterButton('我的', 'play-preset-filter-user', filter === 'user')}
                  ${filterButton('系统', 'play-preset-filter-system', filter === 'system')}
                  ${filterButton(showAdvanced ? '收起高级' : '高级参数', 'toggle-play-preset-advanced', showAdvanced)}
                </div>
                <div class="relative">
                  <div class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500">${svgIcon('search')}</div>
                  <input class="${ui.input} pl-9" data-role="play-preset-query" value="${escapeHtml(state.localState?.ui?.play_preset_query || '')}" placeholder="搜索名称、类型、关系">
                </div>
              </div>
              <div class="mt-4 space-y-4 overflow-auto pr-1" data-play-preset-list-scroll style="min-height:500px;max-height:calc(100vh - 320px);">
                ${showUserSection ? `
                  <section>
                    <div class="mb-2 flex items-center justify-between gap-2">
                      <div class="text-[12px] font-black text-slate-100">我的玩法预设</div>
                      ${badge(`共 ${customPresets.length} 个`, 'emerald')}
                    </div>
                    <div class="grid gap-3" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));">${renderPresetList(customPresets, 'user')}</div>
                  </section>
                ` : ''}
                ${showSystemSection ? `
                  <section>
                    <div class="mb-2 flex items-center justify-between gap-2">
                      <div class="text-[12px] font-black text-slate-100">系统默认玩法预设</div>
                      <div class="flex items-center gap-2">
                        ${badge(`共 ${systemPresets.length} 个`, 'slate')}
                        ${button(systemCollapsed ? '展开' : '收起', 'toggle-system-play-presets', { icon: systemCollapsed ? 'arrow' : 'pause', variant: 'ghost' })}
                      </div>
                    </div>
                    ${systemCollapsed
                      ? `<div class="rounded-2xl border border-[#2b3f68] bg-[#081120]/40 p-4 text-[12px] leading-[1.6] text-slate-400">系统默认玩法预设已折叠。它们不能删除，但可以直接创建房间或基于它们新建“我的玩法预设”。</div>`
                      : `<div class="grid gap-3" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));">${renderPresetList(systemPresets, 'system')}</div>`}
                  </section>
                ` : ''}
              </div>
            </aside>
          `}
          <div class="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
          <main class="${ui.panel} p-4">
            <div class="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[#2b3f68] pb-4">
              <div class="min-w-0">
                <div class="text-[11px] font-black uppercase tracking-[0.14em] text-blue-200">Rule Editor</div>
                <h4 class="mt-2 break-words text-[18px] font-black text-slate-100">${escapeHtml(selected?.name || '未选择玩法')}</h4>
                <p class="mt-1 text-[12px] leading-[1.5] text-slate-400">${editable ? '我的玩法预设可打开编辑卡片修改。' : '系统默认预设为只读起点，基于它新建后可以编辑。'}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                ${selected ? badge(ruleTypeLabel(selected.baseTemplate), ruleTone(selected).badge) : ''}
                ${selected ? badge(selected.builtIn ? '只读' : '可编辑', selected.builtIn ? 'amber' : 'emerald') : ''}
              </div>
            </div>
            <div class="space-y-4">${renderEditorForm()}</div>
          </main>
          ${renderSummary()}
          </div>
        </div>
      </div>
    `;
  }

  function renderEffectTrackEditor(track, index) {
    const enabled = track?.enabled !== false;
    const colors = Array.isArray(track?.colors) && track.colors.length ? track.colors : effectTrackPalette(index);
    const templateId = String(track?.template_id || effectTemplateIdForMode(track?.mode || 'solid'));
    const isPulse = String(track?.mode || 'solid') === 'pulse_chase';
    const isGradient = String(track?.mode || 'solid') === 'gradient';
    const isSelftest = String(track?.mode || 'solid') === 'selftest';
    return `
      <div class="rounded-[16px] border ${enabled ? 'border-[rgba(120,184,255,0.24)] bg-[rgba(15,22,34,0.94)]' : 'border-[rgba(88,116,154,0.18)] bg-[rgba(11,17,27,0.72)] opacity-85'} p-3.5">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-[13px] font-extrabold text-[#eef6ff]">第 ${index + 1} 路</div>
            <div class="mt-0.5 text-[11px] leading-[1.5] text-[#9fb2c8]">LED${index + 1} · ${escapeHtml(effectTemplateNameById(templateId))} · ${escapeHtml(effectModeLabel(track?.mode || 'solid'))}</div>
          </div>
          <label class="inline-flex items-center gap-2 text-[11px] font-bold text-[#dbe7f8]">
            <input type="checkbox" class="accent-[#63a6ff]" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="enabled" ${enabled ? 'checked' : ''}>
            启用
          </label>
        </div>
        <div class="mt-3 grid gap-2 md:grid-cols-3">
          <div class="field"><label>模板（基础灯效类型）</label><select class="fake-select" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="template_id">${effectTemplateOptionsHtml(templateId)}</select></div>
          <div class="field"><label>灯珠总数（每路总灯数）</label><input class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="led_count" value="${escapeHtml(track?.led_count ?? 35)}"></div>
          <div class="field"><label>起始灯号（从第几个开始）</label><input class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="led_start" value="${escapeHtml(track?.led_start ?? 1)}"></div>
          <div class="field"><label>结束灯号（到第几个结束）</label><input class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="led_end" value="${escapeHtml(track?.led_end ?? track?.led_count ?? 35)}"></div>
          <div class="field"><label>灯珠间隔（跳过几个灯）</label><input class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="gap" value="${escapeHtml(track?.gap ?? 0)}"></div>
          <div class="field"><label>亮度（0-100%）</label><input class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="brightness" value="${escapeHtml(track?.brightness ?? 80)}"></div>
          ${isPulse ? `
            <div class="field"><label>运行次数（脉冲次数）</label><input type="number" min="1" step="1" class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="repeat" value="${escapeHtml(track?.repeat || 15)}"></div>
            <div class="field"><label>起始速度（0-100，0=最慢）</label><input type="number" min="0" max="100" step="1" class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="pulse_speed_start" value="${escapeHtml(track?.pulse_speed_start ?? 0)}"></div>
            <div class="field"><label>结束速度（0-100，100=当前基准）</label><input type="number" min="0" max="100" step="1" class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="pulse_speed_end" value="${escapeHtml(track?.pulse_speed_end ?? 100)}"></div>
            <div class="field"><label>总时长(ms，可选，留空按速度自动算)</label><input type="number" min="0" step="50" class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="pulse_duration_ms" value="${escapeHtml(track?.pulse_duration_ms ?? 0)}"></div>
            <div class="field"><label>结束停留（最后保持多久 ms）</label><input type="number" min="0" step="50" class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="end_hold_ms" value="${escapeHtml(track?.end_hold_ms ?? 0)}"></div>
            <div class="field"><label>结束动作（结束后怎么处理）</label><select class="fake-select" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="end_behavior"><option value="off" ${String(track?.end_behavior || 'off') === 'off' ? 'selected' : ''}>熄灭</option><option value="hold" ${String(track?.end_behavior || 'off') === 'hold' ? 'selected' : ''}>停留</option><option value="loop" ${String(track?.end_behavior || 'off') === 'loop' ? 'selected' : ''}>循环</option></select></div>
          ` : `
            <div class="field"><label>呼吸频率（每秒变化次数，例如 0.5 次/秒）</label><input class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="frequency_hz" value="${escapeHtml(track?.frequency_hz ?? 0)}"></div>
            <div class="field"><label>周期（每轮持续时间 ms）</label><input class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="period_ms" value="${escapeHtml(track?.period_ms ?? 700)}"></div>
            <div class="field"><label>占空比（亮的时间比例）</label><input class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="duty" value="${escapeHtml(track?.duty ?? 50)}"></div>
            <div class="field"><label>重复次数（循环次数）</label><input class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="repeat" value="${escapeHtml(track?.repeat ?? 0)}"></div>
            <div class="field"><label>结束停留（最后保持多久 ms）</label><input class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="end_hold_ms" value="${escapeHtml(track?.end_hold_ms ?? 0)}"></div>
            <div class="field"><label>结束动作（结束后怎么处理）</label><select class="fake-select" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="end_behavior"><option value="off" ${String(track?.end_behavior || 'off') === 'off' ? 'selected' : ''}>熄灭</option><option value="hold" ${String(track?.end_behavior || 'off') === 'hold' ? 'selected' : ''}>停留</option><option value="loop" ${String(track?.end_behavior || 'off') === 'loop' ? 'selected' : ''}>循环</option></select></div>
          `}
          <div class="field"><label>颜色 A（起始色）</label><input type="color" class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="colorA" value="${escapeHtml(colors[0] || '#FFD24D')}"></div>
          <div class="field"><label>颜色 B（过渡色）</label><input type="color" class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="colorB" value="${escapeHtml(colors[1] || '#34B3FF')}"></div>
          <div class="field"><label>颜色 C（结束色）</label><input type="color" class="fake-input" data-role="effect-form-track-field" data-track-index="${index}" data-track-field="colorC" value="${escapeHtml(colors[2] || '#61E09A')}"></div>
          ${isPulse ? `
            <div class="md:col-span-3 text-[11px] leading-[1.55] text-[#8ea3bf]">脉冲跑马已经改成「运行次数 + 起始速度 + 结束速度 + 可选总时长」的模型。速度是 0 - 100 的相对档位，0 最慢，100 代表当前基准速度；如果总时长留空，系统会按这两个速度自动估算每一轮脉冲的耗时。</div>
            <div class="md:col-span-3 text-[11px] leading-[1.5] text-[#8ea3bf]">例如：运行 10 次，起始速度 0，结束速度 5，系统会把前几次慢一些、后几次快一些；如果再填总时长 3000ms，系统会把这 10 次整体压进 3 秒里完成。</div>
          ` : `
            <div class="md:col-span-3 text-[11px] leading-[1.5] text-[#8ea3bf]">${
              isGradient
                ? '渐变常亮不会熄灭，会在颜色 A -> 颜色 B -> 颜色 C 之间平滑循环；如果只想两色来回，把颜色 C 设成和颜色 A 一样即可。'
                : isSelftest
                  ? '自检用于人工检查设备响应，预览会模拟点名式状态汇报：颜色按 A/B/C 轮换，亮点沿灯条扫描。可以调灯珠范围、亮度、周期和颜色。'
                  : '颜色 A/B/C 是三段配色：A 通常是起始色，B 是过渡色，C 是结束色。呼吸、多色循环、脉冲跑马和渐变常亮会按这三种颜色做渐变或轮转。'
            }</div>
          `}
        </div>
      </div>
    `;
  }

  function renderEffectsPage() {
    const templates = state.localState.effect_templates || buildDefaultEffectTemplates();
    const effects = state.localState.effect_presets || [];
    const selected = selectedEffectPreset() || effects[0] || null;
    return `
      <div class="page-section-head">
        <div>
          <h3>灯效库</h3>
          <p>默认模板库只读；“我的灯效”才是用户可保存、可复用、可预览的对象。</p>
        </div>
        <div class="pill-actions">
          ${makePill('默认只读', true)}
          ${makePill('我的灯效可保存')}
          ${makePill('先创建再预览')}
        </div>
      </div>
      <div class="page-section-body stack-col">
        <section class="mini-panel">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h4>默认灯效模板库</h4>
              <div class="mt-1 text-[11px] leading-[1.5] text-[#9db0c8]">这些模板固定不变，只能拿来创建“我的灯效”。</div>
            </div>
          </div>
          <div class="mt-3 grid gap-2 overflow-x-auto pb-1" style="grid-template-columns:repeat(5,minmax(164px,1fr)) !important;gap:8px !important;align-items:start;">
            ${templates.map((template) => {
              const primary = effectPrimaryTrack(template) || buildDefaultEffectTrack('solid', 0);
              return `
                <div class="effect-card rounded-[14px] border border-[rgba(36,44,54,0.34)] bg-[rgba(14,20,31,0.92)]" style="min-height:108px !important;padding:8px !important;gap:6px !important;min-width:0;">
                  <div class="title">${escapeHtml(template.name)}</div>
                  <div class="mt-2">${renderPreviewBars(template, { showControls: false, compact: true, rows: 1, previewKind: 'template' })}</div>
                  <div class="meta">${escapeHtml(template.note || '无说明')}</div>
                  <div class="mt-3 flex flex-wrap justify-between gap-2">
                    <button class="ghost-btn" type="button" data-action="toggle-template-preview" data-template-id="${escapeHtml(template.id)}">${state.effectPreviewTemplateId === template.id ? svgIcon('pause') + '停止预览' : svgIcon('play') + '预览'}</button>
                    <button class="ghost-btn" type="button" data-action="create-effect-from-template" data-template-id="${escapeHtml(template.id)}">${svgIcon('plus')}基于此创建</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </section>

        <section class="mini-panel">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h4>我的灯效</h4>
              <div class="mt-1 text-[11px] leading-[1.5] text-[#9db0c8]">这里是用户真正保存和复用的灯效。默认模板不会混进来。</div>
            </div>
            <div class="pill-actions">
              <button class="ghost-btn" type="button" data-action="create-custom-effect">${svgIcon('plus')}新建我的灯效</button>
            </div>
          </div>
          <div class="mt-3 grid gap-2 overflow-x-auto pb-1" style="grid-template-columns:repeat(5,minmax(164px,1fr)) !important;gap:8px !important;align-items:start;">
            ${effects.map((effect) => {
              const primary = effectPrimaryTrack(effect);
              const routes = effectTrackEnabledCount(effect);
              return `
                  <div class="effect-card ${selected?.id === effect.id ? 'selected' : ''} rounded-[14px] border border-[rgba(36,44,54,0.34)] bg-[rgba(14,20,31,0.92)]" data-action="select-custom-effect" data-preset-id="${escapeHtml(effect.id)}" style="min-height:108px !important;padding:8px !important;gap:6px !important;min-width:0;">
                    <div class="title">${escapeHtml(effect.name)}</div>
                    <div class="mt-2">${renderPreviewBars(effect, { showControls: false, compact: true, rows: 3, previewKind: 'effect' })}</div>
                    <div class="meta">${escapeHtml(effect.note || '无说明')}</div>
                    <div class="mt-2 text-[10.5px] leading-[1.45] text-[#8ea3bf]">来源 ${escapeHtml(effectTemplateNameById(effect.source_template_id || primary?.template_id || 'builtin-silent'))} · 启用 ${escapeHtml(routes)} 路</div>
                    <div class="mt-3 flex flex-wrap justify-end gap-2">
                      <button class="ghost-btn" type="button" data-action="edit-custom-effect" data-preset-id="${escapeHtml(effect.id)}">${svgIcon('edit')}编辑</button>
                      <button class="ghost-btn" type="button" data-action="delete-custom-effect" data-preset-id="${escapeHtml(effect.id)}">${svgIcon('trash')}删除</button>
                    </div>
                  </div>
              `;
            }).join('') || '<div class="notice">还没有我的灯效。先从默认模板创建一个。</div>'}
          </div>
        </section>
      </div>
    `;
  }

  function renderPreviewBars(effectOrId, options = {}) {
    const effect = effectOrId && typeof effectOrId === 'object'
      ? effectOrId
      : effectDefinitionById(effectOrId) || (effectOrId ? null : (selectedEffectPreset() || state.localState.effect_presets?.[0] || null));
    const allTracks = Array.isArray(effect?.effect_ui?.tracks) ? effect.effect_ui.tracks : [];
    const rowCount = clamp(normalizeNumber(options.rows, allTracks.length || 1), 1, 3);
    const tracks = allTracks.slice(0, rowCount);
    const showControls = options.showControls !== false;
    const compact = options.compact === true;
    const displayLedCount = Math.max(0, normalizeNumber(options.ledCount, compact ? 10 : 0));
    const tickMs = previewFrameMs();
    const shape = previewCellShape();
    const cellSize = compact ? 10 : 12;
    const cellGap = compact ? 3 : 4;
    const previewKind = String(options.previewKind || (showControls ? 'preview' : 'effect'));
    const previewPaused = previewKind === 'template' && String(state.effectPreviewTemplateId || '') !== String(effect?.id || '');
    const clipOverflow = options.clipOverflow === true || compact;
    const previewLedCount = Math.max(
      1,
      ...tracks.map((track) => clamp(normalizeNumber(track?.led_count, compact ? 10 : 35), 1, 9999)),
      displayLedCount > 0 ? displayLedCount : 1
    );
    return `
      <div class="${compact ? 'space-y-2.5' : 'space-y-3.5'}" data-effect-preview-root data-effect-preview-kind="${escapeHtml(previewKind)}" data-effect-preview-id="${escapeHtml(effect?.id || '')}" data-effect-preview-rows="${escapeHtml(rowCount)}" data-effect-preview-led-count="${escapeHtml(previewLedCount)}" data-effect-preview-paused="${previewPaused ? '1' : '0'}">
        ${showControls ? `
          <div class="flex flex-wrap items-end justify-between gap-3 rounded-[16px] border border-[rgba(28,36,46,0.2)] bg-[rgba(8,11,16,0.86)] px-3 py-2.5">
            <div class="grid gap-2 sm:grid-cols-[minmax(220px,320px)_auto]">
              <div class="field">
                <label>当前灯效</label>
                <select class="fake-select" data-role="preview-effect-select">${(state.localState.effect_presets || []).length ? (state.localState.effect_presets || []).map((item) => `<option value="${escapeHtml(item.id)}" ${String(effect?.id || '') === String(item.id) ? 'selected' : ''}>${escapeHtml(item.name || '未命名灯效')}</option>`).join('') : '<option value="">暂无我的灯效</option>'}</select>
              </div>
              <div class="field">
                <label>播放控制</label>
                <div class="pill-actions">
                  <button class="ghost-btn" type="button" data-action="toggle-preview-play">${svgIcon(state.previewPlaying ? 'pause' : 'play')}${state.previewPlaying ? '暂停播放' : '开始播放'}</button>
                  <button class="ghost-btn" type="button" data-action="reset-preview">${svgIcon('refresh')}重置</button>
                  <button class="ghost-btn" type="button" data-action="toggle-preview-shape">${shape === 'square' ? '圆点显示' : '方块显示'}</button>
                </div>
              </div>
            </div>
            <div class="chip-row">
              ${makeChip(effect?.name || '未选择', true)}
              ${makeChip(`轨道 ${tracks.length}`)}
              ${makeChip(`样式 ${shape === 'square' ? '方块' : '圆点'}`)}
            </div>
          </div>
        ` : ''}
        ${tracks.length ? tracks.map((track, index) => {
          const enabled = track?.enabled !== false;
          const actualLedCount = clamp(normalizeNumber(track?.led_count, 35), 1, 9999);
          const actualStart = clamp(normalizeNumber(track?.led_start, 1), 1, actualLedCount);
          const actualEnd = clamp(normalizeNumber(track?.led_end, actualLedCount), actualStart, actualLedCount);
          const ledCount = displayLedCount > 0 ? clamp(displayLedCount, 1, actualLedCount) : actualLedCount;
          const start = displayLedCount > 0 ? 1 : actualStart;
          const end = displayLedCount > 0 ? ledCount : actualEnd;
          const step = Math.max(1, Math.max(0, normalizeNumber(track?.gap, 0)) + 1);
          const activeIndices = [];
          for (let led = start; led <= end; led += step) activeIndices.push(led);
          const activeMap = new Map(activeIndices.map((led, activeIndex) => [led, activeIndex]));
          const markers = previewScaleMarks(ledCount);
          return `
            <div class="rounded-[16px] border ${enabled ? 'border-[rgba(14,18,24,0.72)] bg-[rgba(14,20,31,0.92)]' : 'border-[rgba(14,18,24,0.28)] bg-[rgba(11,17,27,0.72)] opacity-70'} p-3" data-effect-preview-row data-track-index="${index}" data-led-count="${escapeHtml(ledCount)}">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-[12px] font-extrabold leading-none text-[#eef6ff]">灯条 ${index + 1}</div>
                  <div class="mt-1 text-[11px] leading-[1.45] text-[#9db0c8]">LED${escapeHtml(normalizeNumber(track?.port, index + 1))} · ${escapeHtml(effectTemplateNameById(track?.template_id || effectTemplateIdForMode(track?.mode || 'solid')))} · ${escapeHtml(effectModeLabel(track?.mode || 'solid'))}</div>
                </div>
                <div class="text-[10px] leading-[1.45] text-[#8ea3bf]">${markers}</div>
              </div>
              <div class="mt-2 flex min-w-0 ${clipOverflow ? 'overflow-hidden' : 'overflow-x-auto pb-1'}" style="gap:${cellGap}px;scrollbar-width:thin;">
                ${Array.from({ length: ledCount }, (_, ledIdx) => {
                  const ledNo = ledIdx + 1;
                  const activeIndex = activeMap.has(ledNo) ? activeMap.get(ledNo) : -1;
                  const visual = previewCellStyle(track, ledNo, activeIndex, tickMs, index);
                  const borderRadius = shape === 'circle' ? '999px' : '4px';
                  return `<span aria-hidden="true" data-effect-preview-cell data-led-no="${ledNo}" style="flex:0 0 auto;width:${cellSize}px;height:${cellSize}px;border-radius:${borderRadius};background:${visual.color};opacity:${visual.opacity};box-shadow:${visual.shadow};border:1px solid rgba(16,20,28,0.88);transition:background .18s linear,opacity .18s linear,box-shadow .18s linear;"></span>`;
                }).join('')}
              </div>
              <div class="mt-1 text-[10.5px] leading-[1.4] text-[#8ea3bf]">范围 ${escapeHtml(actualStart)} - ${escapeHtml(actualEnd)} · 间隔 ${escapeHtml(normalizeNumber(track?.gap, 0))} · 亮度 ${escapeHtml(track?.brightness ?? 80)}%</div>
            </div>
          `;
        }).join('') : '<div class="notice">这个灯效还没有轨道，先在卡片里创建。</div>'}
      </div>
    `;
  }

  function updateEffectPreviewNodes() {
    const roots = document.querySelectorAll('[data-effect-preview-root]');
    if (!roots.length) return;
    const now = performance.now();
    roots.forEach((root) => {
      const kind = String(root.dataset.effectPreviewKind || 'effect');
      const effectId = String(root.dataset.effectPreviewId || '');
      const rowCount = clamp(normalizeNumber(root.dataset.effectPreviewRows, 1), 1, 3);
      const ledCount = clamp(normalizeNumber(root.dataset.effectPreviewLedCount, 10), 1, 9999);
      const paused = kind === 'template' && String(state.effectPreviewTemplateId || '') !== effectId;
      if (kind === 'template') {
        root.dataset.effectPreviewPaused = paused ? '1' : '0';
      }

      let tracks = [];
      if (kind === 'preview') {
        const effect = effectDefinitionById(effectId) || null;
        tracks = Array.isArray(effect?.effect_ui?.tracks) ? effect.effect_ui.tracks.slice(0, rowCount) : [];
      } else if (kind === 'template') {
        const effect = effectTemplateById(effectId);
        tracks = Array.isArray(effect?.effect_ui?.tracks) ? effect.effect_ui.tracks.slice(0, rowCount) : [];
      } else {
        const effect = effectPresetById(effectId) || effectDefinitionById(effectId) || null;
        tracks = Array.isArray(effect?.effect_ui?.tracks) ? effect.effect_ui.tracks.slice(0, rowCount) : [];
      }

      const tickMs = (kind === 'template' && paused) || (kind === 'preview' && !state.previewPlaying) ? 0 : now;
      const shape = previewCellShape();
      const rowEls = Array.from(root.querySelectorAll('[data-effect-preview-row]'));
      rowEls.forEach((rowEl, rowIndex) => {
        const track = tracks[rowIndex] || buildDefaultEffectTrack('silent', rowIndex, { enabled: false, port: rowIndex + 1 });
        const enabled = track?.enabled !== false;
        rowEl.style.opacity = enabled ? '' : '0.68';
        const cellEls = Array.from(rowEl.querySelectorAll('[data-effect-preview-cell]'));
        const count = clamp(normalizeNumber(rowEl.dataset.ledCount, ledCount), 1, 9999);
        const start = clamp(normalizeNumber(track?.led_start, 1), 1, count);
        const end = clamp(normalizeNumber(track?.led_end, count), start, count);
        const gap = Math.max(0, normalizeNumber(track?.gap, 0));
        const step = gap + 1;
        const activeIndices = [];
        for (let led = start; led <= end; led += step) activeIndices.push(led);
        const activeMap = new Map(activeIndices.map((led, activeIndex) => [led, activeIndex]));
        cellEls.forEach((cellEl, cellIndex) => {
          const ledNo = cellIndex + 1;
          const activeIndex = activeMap.has(ledNo) ? activeMap.get(ledNo) : -1;
          const visual = previewCellStyle(track, ledNo, activeIndex, tickMs, rowIndex);
          const radius = shape === 'circle' ? '999px' : '4px';
          cellEl.style.borderRadius = radius;
          cellEl.style.background = visual.color;
          cellEl.style.opacity = visual.opacity;
          cellEl.style.boxShadow = visual.shadow;
          cellEl.style.border = '1px solid rgba(16,20,28,0.88)';
        });
      });
    });

    document.querySelectorAll('[data-action="toggle-template-preview"]').forEach((button) => {
      const templateId = String(button.dataset.templateId || '');
      const active = String(state.effectPreviewTemplateId || '') === templateId;
      button.innerHTML = `${svgIcon(active ? 'pause' : 'play')}${active ? '停止预览' : '预览'}`;
    });
  }

  function renderEffectDialogs() {
    const form = state.effectFormModal ? ensureEffectFormModal() : null;
    const del = state.effectDeleteModal;
    if (!form && !del) return '';
    const modal = form || del;
    const isDelete = !!del && !form;
    const activeTrackIndex = clamp(normalizeNumber(form?.activeTrackIndex, 0), 0, EFFECT_TRACK_LIMIT - 1);
    const activeTrack = form?.tracks?.[activeTrackIndex] || form?.tracks?.[0] || buildDefaultEffectTrack('silent', activeTrackIndex);
    const sourceTemplateId = String(form?.source_template_id || activeTrack?.template_id || 'builtin-silent');
    const sourceTemplate = effectTemplateById(sourceTemplateId);
    const sourceTemplateName = sourceTemplate?.name || effectTemplateNameById(sourceTemplateId);
    return `
      <div class="fixed inset-0 z-[130] flex items-center justify-center bg-[rgba(3,6,12,0.88)] px-4 py-8 backdrop-blur-[3px]">
        <div class="w-full overflow-auto rounded-[20px] border border-[rgba(103,130,169,0.42)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.72)]" style="width:min(800px,calc(100vw - 48px));max-height:calc(100vh - 64px);background:#0d1520;">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="m-0 text-[18px] font-extrabold leading-none text-white">${isDelete ? '确认删除灯效' : (form.mode === 'edit' ? '编辑我的灯效' : '新建我的灯效')}</h3>
              <p class="mt-1.5 text-[12px] leading-[1.55] text-[#aabbd1]">${isDelete ? '这是删除前的确认卡片，不是报错。删掉后会同步清理引用。' : '分两步编辑：先写名称和备注，再切到 LED1-LED3 标签页分别配置灯效。'}</p>
            </div>
            <button class="ghost-btn" type="button" data-action="${isDelete ? 'cancel-effect-delete' : 'cancel-effect-form'}">关闭</button>
          </div>
          ${isDelete ? `
            <div class="mt-4 rounded-[16px] border border-[rgba(255,138,138,0.22)] bg-[rgba(46,18,24,0.68)] p-3.5">
              <div class="text-[13px] font-bold text-[#ffd5d5]">${escapeHtml(modal.name || '未命名灯效')}</div>
              <div class="mt-2 grid gap-2 text-[12px] leading-[1.55] text-[#ffdede]">
                <div>会清理：模板 ${modal.refs?.templates ?? 0} 个引用、房间 ${modal.refs?.rooms ?? 0} 个引用。</div>
                <div>删除后这条灯效会从“我的灯效”消失，默认模板库不会受到影响。</div>
              </div>
            </div>
            <div class="mt-4 flex flex-wrap justify-end gap-2">
              <button class="ghost-btn" type="button" data-action="cancel-effect-delete">取消</button>
              <button class="ghost-btn" type="button" data-action="confirm-effect-delete">${svgIcon('trash')}确认删除</button>
            </div>
          ` : `
            <div class="mt-4 grid gap-4">
              ${form.step === 1 ? `
                <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
                  <div class="stack-col">
                    <div class="field">
                      <label>灯效名称</label>
                      <input class="fake-input" data-role="effect-form-input" data-effect-form-field="name" value="${escapeHtml(form.name || '')}" placeholder="例如：宝箱呼吸蓝、寻宝脉冲灯">
                    </div>
                    <div class="field">
                      <label>备注</label>
                      <textarea class="fake-input" data-role="effect-form-input" data-effect-form-field="note" style="min-height:128px;resize:vertical" placeholder="写一点这个灯效的用途，方便后面复用">${escapeHtml(form.note || '')}</textarea>
                    </div>
                  </div>
                  <div class="mini-panel">
                    <h4>基础信息</h4>
                    <div class="fake-input">来源模板：${escapeHtml(sourceTemplateName)}</div>
                    <div class="mt-2 text-[11px] leading-[1.55] text-[#9db0c8]">下一步会进入 LED1-LED3 标签页，分别选择模板并设置参数。</div>
                    <div class="mt-3 chip-row">
                      ${makeChip(form.mode === 'edit' ? '编辑中' : '新建中', true)}
                      ${makeChip('默认模板只读')}
                      ${makeChip('我的灯效可保存')}
                    </div>
                  </div>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <button class="ghost-btn" type="button" data-action="cancel-effect-form">取消</button>
                  <button class="ghost-btn" type="button" data-action="effect-form-next-step">${svgIcon('arrow')}下一步</button>
                </div>
              ` : `
                <div class="stack-col">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="chip-row">
                      ${Array.from({ length: EFFECT_TRACK_LIMIT }, (_, index) => `
                        <button class="ghost-btn ${index === activeTrackIndex ? 'border-[rgba(120,184,255,0.72)] bg-[rgba(18,34,52,0.96)] text-[#eff6ff]' : ''}" type="button" data-action="effect-form-switch-track" data-track-index="${index}">LED${index + 1}</button>
                      `).join('')}
                    </div>
                    <div class="chip-row">
                      ${makeChip(`当前：LED${activeTrackIndex + 1}`, true)}
                      ${makeChip(`来源 ${escapeHtml(sourceTemplateName)}`)}
                    </div>
                  </div>
                  <div class="rounded-[16px] border border-[rgba(60,70,84,0.42)] bg-[rgba(11,17,27,0.74)] p-3">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div class="text-[13px] font-extrabold text-[#eef6ff]">LED${activeTrackIndex + 1}</div>
                        <div class="mt-0.5 text-[11px] leading-[1.45] text-[#9fb2c8]">选择模板后再调参数；未启用的灯条默认静默。</div>
                      </div>
                      <div class="text-[11px] text-[#8ea3bf]">三路效果都保存在本地，开始前再下发。</div>
                    </div>
                    <div class="mt-3">
                      ${renderEffectTrackEditor(activeTrack, activeTrackIndex)}
                    </div>
                  </div>
                </div>
                <div class="flex flex-wrap justify-between gap-2">
                  <button class="ghost-btn" type="button" data-action="effect-form-prev-step">${svgIcon('arrow')}上一步</button>
                  <div class="flex flex-wrap gap-2">
                    <button class="ghost-btn" type="button" data-action="cancel-effect-form">取消</button>
                    <button class="ghost-btn" type="button" data-action="save-effect-form">${svgIcon('save')}保存</button>
                  </div>
                </div>
              `}
            </div>
          `}
        </div>
      </div>
    `;
  }

  function renderPreviewPage() {
    const effects = state.localState.effect_presets || [];
    const effect = selectedEffectPreset() || effects[0] || null;
    const primaryTrack = effectPrimaryTrack(effect);
    const enabledCount = effectTrackEnabledCount(effect);
    const sourceName = effectTemplateNameById(effect?.source_template_id || primaryTrack?.template_id || 'builtin-breath');
    const listCollapsed = !!state.localState?.ui?.preview_effect_list_collapsed;
    return `
      <div class="page-section-head">
        <div>
          <h3>预览台</h3>
          <p>这里直接看灯珠在屏幕上的实际表现。右侧列表点一下就能切换灯效，不用下拉菜单。</p>
        </div>
        <div class="pill-actions">
          ${makePill(`当前 ${escapeHtml(effect?.name || '未选择')}`, true)}
          ${makePill(`来源 ${escapeHtml(sourceName)}`)}
          ${makePill(`轨道 ${enabledCount}`)}
        </div>
      </div>
      <div class="page-section-body">
        <div class="grid gap-3" style="display:grid;grid-template-columns:minmax(0,1fr) 320px;align-items:start;min-width:0;">
          <section class="mini-panel sticky top-4 self-start max-h-[calc(100vh-144px)] overflow-auto">
            <div class="flex flex-wrap items-end justify-between gap-3 rounded-[16px] border border-[rgba(28,36,46,0.2)] bg-[rgba(8,11,16,0.86)] px-3 py-2.5">
              <div class="grid gap-2 sm:grid-cols-[minmax(220px,320px)_auto]">
                <div class="field">
                  <label>当前灯效</label>
                  <div class="fake-input">${escapeHtml(effect?.name || '暂无我的灯效')}</div>
                </div>
                <div class="field">
                  <label>播放控制</label>
                  <div class="pill-actions">
                    <button class="ghost-btn" type="button" data-action="toggle-preview-play">${svgIcon(state.previewPlaying ? 'pause' : 'play')}${state.previewPlaying ? '暂停播放' : '开始播放'}</button>
                    <button class="ghost-btn" type="button" data-action="reset-preview">${svgIcon('refresh')}重置</button>
                    <button class="ghost-btn" type="button" data-action="toggle-preview-shape">${previewCellShape() === 'square' ? '圆点显示' : '方块显示'}</button>
                  </div>
                </div>
              </div>
              <div class="chip-row">
                ${makeChip(effect?.name || '未选择', true)}
                ${makeChip(`轨道 ${enabledCount}`)}
                ${makeChip(`样式 ${previewCellShape() === 'square' ? '方块' : '圆点'}`)}
              </div>
            </div>
            <div class="mt-3">
              ${effect ? renderPreviewBars(effect.id, { showControls: false, compact: false, previewKind: 'preview', clipOverflow: true }) : '<div class="notice">暂无我的灯效，请先创建一个。</div>'}
            </div>
            <div class="mt-3 grid gap-2 md:grid-cols-3">
              <div class="fake-input">主模式：${escapeHtml(effectModeLabel(primaryTrack?.mode || 'solid'))}</div>
              <div class="fake-input">范围：${escapeHtml(primaryTrack?.led_start ?? 1)} - ${escapeHtml(primaryTrack?.led_end ?? primaryTrack?.led_count ?? 35)}</div>
              <div class="fake-input">周期：${escapeHtml(primaryTrack?.period_ms ?? 700)} ms · 频率：${escapeHtml(primaryTrack?.frequency_hz ?? 0)} 次/秒</div>
            </div>
          </section>
          <aside class="mini-panel">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h4>我的灯效</h4>
                <div class="mt-1 text-[11px] leading-[1.5] text-[#9db0c8]">点一下就能切换预览，右侧可以收起来。</div>
              </div>
              <button class="ghost-btn" type="button" data-action="toggle-preview-effect-list">${listCollapsed ? svgIcon('chevron-right') + '展开' : svgIcon('chevron-left') + '收起'}</button>
            </div>
            ${listCollapsed ? `
              <div class="mt-3 notice">列表已收起，点击右上角按钮展开。</div>
            ` : `
              <div class="mt-3 grid gap-2 max-h-[calc(100vh-340px)] overflow-y-auto overscroll-contain pr-1">
                ${effects.map((item) => {
                  const active = String(effect?.id || '') === String(item.id || '');
                  const accent = active ? 'rgba(76, 140, 255, 0.24)' : 'rgba(17, 24, 34, 0.95)';
                  const rowBg = active
                    ? 'linear-gradient(180deg, rgba(43, 79, 146, 0.68), rgba(24, 39, 67, 0.96))'
                    : 'linear-gradient(180deg, rgba(17, 24, 36, 0.98), rgba(12, 17, 26, 0.98))';
                  return `
                    <button class="group-mini-item ${active ? 'selected' : ''} relative overflow-hidden" type="button" data-action="select-custom-effect" data-preset-id="${escapeHtml(item.id)}" style="align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 14px;border-color:transparent;background:${rowBg};box-shadow:inset 0 0 0 1px ${accent}, ${active ? '0 0 0 1px rgba(120,184,255,0.36)' : 'none'};outline:${active ? '1px solid rgba(120,184,255,0.38)' : '1px solid transparent'};">
                      <span class="absolute inset-y-0 left-0 w-1.5 ${active ? 'bg-[#64b3ff]' : 'bg-transparent'}"></span>
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <div class="title">${escapeHtml(item.name || '未命名灯效')}</div>
                          <span class="pill shrink-0 ${active ? 'bg-[rgba(88,167,255,0.18)] text-[#dbeaff]' : ''}">${active ? '当前选中' : '点击选择'}</span>
                        </div>
                        <div class="desc">${escapeHtml(item.note || '无说明')}</div>
                        <div class="mt-2 text-[10.5px] leading-[1.45] text-[#8ea3bf]">来源 ${escapeHtml(effectTemplateNameById(item.source_template_id || effectPrimaryTrack(item)?.template_id || 'builtin-silent'))}</div>
                      </div>
                      <span class="pill shrink-0">${escapeHtml(effectTrackEnabledCount(item))} 路</span>
                    </button>
                  `;
                }).join('') || '<div class="notice">还没有我的灯效，先去灯效库新建一个。</div>'}
              </div>
            `}
          </aside>
        </div>
      </div>
    `;
  }

  function renderTemplateCard(template, { mode = 'builtin', compact = false, showActions = true } = {}) {
    const selected = template.id === state.selectedTemplateId;
    const builtIn = template.builtIn === true;
    const playPreset = playPresetById(template.play_preset_id || template.feature_preset_id || template.id);
    const featureName = playPreset?.name || featurePresetNameById(template.feature_preset_id);
    const sourceMode = roleModeValue(template.source_group_mode || (Array.isArray(template.default_source_group_ids) && template.default_source_group_ids.length > 1 ? 'multi' : 'single'));
    const targetMode = roleModeValue(template.target_group_mode || (Array.isArray(template.default_target_group_ids) && template.default_target_group_ids.length > 1 ? 'multi' : 'single'));
    const featureSignal = featurePresetById(template.feature_preset_id)?.feature_ui?.signal_ui || {};
    const scoringText = template.scoring && typeof template.scoring === 'object' && template.scoring.mode
      ? scoringLabel(template.scoring.mode)
      : '未设置';
    const relationText = playPreset
      ? `${relationModeLabel(playPreset.relation?.mode)} / ${matchModeLabel(playPreset.relation?.match)}`
      : `${roleModeLabel(sourceMode)} / ${roleModeLabel(targetMode)}`;
    const triggerScoreText = playPreset
      ? `${triggerModeLabel(playPreset.trigger?.mode)} / ${scoreSummaryText(playPreset.score)}`
      : `${senseLabel(template.sense_mode || 'ring')} / ${scoringText}`;
    const ruleSignalText = playPreset
      ? signalSummaryText(playPreset)
      : triggerConditionText(featureSignal.trigger_compare, featureSignal.trigger_rssi_threshold, featureSignal.trigger_hold_ms);
    const selectedStyle = selected
      ? 'border-[rgba(120,184,255,0.86)] bg-[linear-gradient(180deg,rgba(28,44,69,0.98),rgba(18,28,42,0.98))] shadow-[0_0_0_1px_rgba(120,184,255,0.18),0_16px_34px_rgba(0,0,0,0.24)] ring-1 ring-[rgba(120,184,255,0.18)]'
      : 'border-[rgba(88,116,154,0.24)] bg-[rgba(14,20,31,0.92)] hover:border-[rgba(120,184,255,0.38)] hover:bg-[rgba(16,24,36,0.96)]';
    const statusClass = selected
      ? 'border-[rgba(99,172,255,0.42)] bg-[rgba(75,169,255,0.16)] text-[#dbeaff]'
      : 'border-[rgba(88,116,154,0.24)] bg-[rgba(21,30,43,0.86)] text-[#c7d5eb]';
    const statusText = selected ? '当前选中' : '点选切换';
    const defaultBadge = builtIn ? '默认模板' : '我的模板';
    const actionRow = showActions
      ? builtIn
        ? `
          <button class="ghost-btn" type="button" data-action="create-room-from-template" data-template-id="${escapeHtml(template.id)}">${svgIcon('arrow')}创建房间</button>
        `
        : `
          <button class="ghost-btn" type="button" data-action="edit-template" data-template-id="${escapeHtml(template.id)}">${svgIcon('edit')}编辑</button>
          <button class="ghost-btn" type="button" data-action="create-room-from-template" data-template-id="${escapeHtml(template.id)}">${svgIcon('arrow')}创建房间</button>
          <button class="ghost-btn" type="button" data-action="delete-template" data-template-id="${escapeHtml(template.id)}">${svgIcon('trash')}删除</button>
        `
      : '';
    const summaryGrid = compact
      ? `
        <div class="mt-2 space-y-1.5 text-[10.5px] leading-[1.42] text-[#c0d0e4]">
          <div><span class="text-[#8ea3bf]">玩法：</span><span class="font-semibold text-white">${escapeHtml(featureName)}</span></div>
          <div><span class="text-[#8ea3bf]">关系：</span><span class="font-semibold text-white">${escapeHtml(relationText)}</span></div>
          <div><span class="text-[#8ea3bf]">触发/计分：</span><span class="font-semibold text-white">${escapeHtml(triggerScoreText)}</span></div>
        </div>
      `
      : `
        <div class="mt-3 grid gap-2 md:grid-cols-2">
          <div class="rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2">
            <div class="text-[10px] font-bold text-[#8ea3bf]">玩法预设</div>
            <div class="mt-1 text-[12px] font-semibold text-white">${escapeHtml(featureName)}</div>
          </div>
          <div class="rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2">
            <div class="text-[10px] font-bold text-[#8ea3bf]">对象关系</div>
            <div class="mt-1 text-[12px] font-semibold text-white">${escapeHtml(relationText)}</div>
          </div>
          <div class="rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2">
            <div class="text-[10px] font-bold text-[#8ea3bf]">触发 / 计分</div>
            <div class="mt-1 text-[12px] font-semibold text-white">${escapeHtml(triggerScoreText)}</div>
          </div>
          <div class="rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2">
            <div class="text-[10px] font-bold text-[#8ea3bf]">空闲 / 触发</div>
            <div class="mt-1 text-[12px] font-semibold text-white">${escapeHtml(effectNameById(template.idle_effect_id || 'builtin-silent'))} / ${escapeHtml(effectNameById(template.trigger_effect_id || 'builtin-blink'))}</div>
          </div>
        </div>
      `;
    const metaRow = compact
      ? ''
      : `
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <span class="${[
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold whitespace-nowrap',
            selected
              ? 'border-transparent bg-[rgba(88,167,255,0.18)] text-[#dbeaff]'
              : 'border-[rgba(88,116,154,0.24)] bg-[rgba(21,30,43,0.86)] text-[#c7d5eb]'
          ].join(' ')}">
            ${selected ? svgIcon('check') : svgIcon('copy')}
            ${selected ? '已选中' : '点击选择'}
          </span>
          <span class="${[
            'inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold whitespace-nowrap',
            builtIn ? 'border-transparent bg-[rgba(91,225,143,0.16)] text-[#82e8a9]' : 'border-[rgba(88,116,154,0.24)] bg-[rgba(21,30,43,0.86)] text-[#c7d5eb]'
          ].join(' ')}">${builtIn ? '内置' : '可编辑'}</span>
          <span class="inline-flex items-center rounded-full border border-[rgba(88,116,154,0.24)] bg-[rgba(21,30,43,0.86)] px-2.5 py-1 text-[10px] font-bold whitespace-nowrap text-[#c7d5eb]">${escapeHtml(formatTime(template.updated_at))}</span>
        </div>
      `;

    return `
      <div class="${[
        'group relative cursor-pointer overflow-hidden rounded-[18px] border text-left transition',
        compact ? 'px-3 py-2.5' : 'px-4 py-3.5',
        selectedStyle
      ].join(' ')}" role="button" tabindex="0" aria-pressed="${selected ? 'true' : 'false'}" data-action="select-template" data-template-id="${escapeHtml(template.id)}">
        <span class="absolute inset-y-0 left-0 w-1.5 ${selected ? 'bg-[#64b3ff]' : 'bg-transparent'}"></span>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 pr-1">
            <div class="flex items-center gap-2">
              <div class="${selected ? 'text-[14px]' : 'text-[13px]'} font-extrabold leading-[1.12] text-[#f4f8ff]">${escapeHtml(template.name)}</div>
              <span class="${[
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap',
                builtIn ? 'border-[rgba(103,174,254,0.3)] bg-[rgba(75,169,255,0.14)] text-[#dbeaff]' : 'border-[rgba(88,116,154,0.24)] bg-[rgba(21,30,43,0.86)] text-[#c7d5eb]'
              ].join(' ')}">${escapeHtml(defaultBadge)}</span>
            </div>
            <div class="mt-1.5 text-[11px] leading-[1.45] text-[#9fb2c8]">${escapeHtml(template.note || '无备注')}</div>
          </div>
          <span class="${[
            'shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold whitespace-nowrap',
            statusClass
          ].join(' ')}">${escapeHtml(statusText)}</span>
        </div>
        ${metaRow}
        ${summaryGrid}
        ${compact ? '' : `<div class="mt-2 text-[10.5px] leading-[1.45] text-[#8ea3bf]">规则参数：${escapeHtml(ruleSignalText)}。</div>`}
        ${actionRow ? `<div class="mt-3 flex flex-wrap gap-2">${actionRow}</div>` : ''}
      </div>
    `;
  }

  function renderTemplateCards(options = {}) {
    return (state.localState.templates || [])
      .map((item) => renderTemplateCard(item, {
        mode: item?.builtIn ? 'builtin' : 'user',
        compact: options.compact === true,
        showActions: options.showActions !== false
      }))
      .join('');
  }

  function renderRoomPanel() {
    const rooms = sortedRoomList();
    const sortOrder = roomSortOrder();
    const room = currentRoom();
    const validation = validateRoomReady(room);
    const roomSourceText = Array.isArray(room?.source_group_ids) && room.source_group_ids.length
      ? room.source_group_ids.map((gid) => groupNameById(gid)).join(' / ')
      : '未选择';
    const roomTargetText = Array.isArray(room?.target_group_ids) && room.target_group_ids.length
      ? room.target_group_ids.map((gid) => groupNameById(gid)).join(' / ')
      : '未选择';
    const roomSenseText = room?.sense_mode || '未设置';
    const roomIdleEffectText = effectNameById(room?.idle_effect_id || '');
    const roomTriggerEffectText = effectNameById(room?.trigger_effect_id || '');
    const roomScoreText = room?.scoring && typeof room.scoring === 'object' && room.scoring.mode
      ? String(room.scoring.mode)
      : '未设置';
    const roomCountdown = roomCountdownActive(room?.id);
    const roomCountdownRemainingText = roomCountdownRemaining(room?.id);
    const prepareBusy = !!state.busy.publish || !!state.preparingRoomId;
    const runtimeSummary = roomRuntimeSummary(room);
    const roomStatusClass = roomCountdown
      ? 'border-[rgba(245,201,95,0.42)] bg-[rgba(42,32,12,0.96)] text-[#ffd88a]'
      : room?.status === 'running'
        ? 'border-[rgba(91,225,143,0.42)] bg-[rgba(19,31,27,0.96)] text-[#8ff0b0]'
        : room?.status === 'published'
          ? 'border-[rgba(99,172,255,0.42)] bg-[rgba(18,28,42,0.96)] text-[#cfe4ff]'
        : room?.status === 'ended'
          ? 'border-[rgba(255,124,124,0.34)] bg-[rgba(34,18,20,0.96)] text-[#ffb0b0]'
          : 'border-[rgba(88,116,154,0.24)] bg-[rgba(14,20,31,0.9)] text-[#d6e5f4]';
    const roomCards = rooms.length
      ? rooms.map((item) => {
          const active = item.id === activeRoomId();
          const itemValidation = validateRoomReady(item);
          const itemCountdown = roomCountdownActive(item.id);
          const itemCountdownRemaining = roomCountdownRemaining(item.id);
          const canItemPrepare = item.status !== 'running' && itemValidation.issues.length === 0 && !itemCountdown && !prepareBusy;
          const canItemStart = item.status === 'published' && !itemCountdown;
          const canItemStop = item.status === 'running';
          const canItemDelete = item.status !== 'running';
          const statusText = itemCountdown
            ? `倒计时 ${itemCountdownRemaining} 秒`
            : item.status === 'running'
              ? '进行中'
              : item.status === 'published'
                ? '已预备'
                : item.status === 'ended'
                  ? '已结束'
                  : '草稿';
          const statusClass = itemCountdown
            ? 'border-[rgba(245,201,95,0.34)] bg-[rgba(42,32,12,0.96)] text-[#ffd88a]'
            : item.status === 'running'
            ? 'border-[rgba(91,225,143,0.34)] bg-[rgba(18,34,23,0.96)] text-[#8ff0b0]'
            : item.status === 'published'
              ? 'border-[rgba(99,172,255,0.34)] bg-[rgba(18,28,42,0.96)] text-[#cfe4ff]'
            : item.status === 'ended'
              ? 'border-[rgba(255,124,124,0.3)] bg-[rgba(34,18,20,0.94)] text-[#ffb0b0]'
              : 'border-[rgba(88,116,154,0.24)] bg-[rgba(14,20,31,0.9)] text-[#d6e5f4]';
          const itemSourceText = Array.isArray(item.source_group_ids) && item.source_group_ids.length
            ? item.source_group_ids.map((gid) => groupNameById(gid)).join(' / ')
            : '未选择';
          const itemTargetText = Array.isArray(item.target_group_ids) && item.target_group_ids.length
            ? item.target_group_ids.map((gid) => groupNameById(gid)).join(' / ')
            : '未选择';
          const itemSenseText = item.sense_mode || '未设置';
          const itemIdleEffectText = effectNameById(item.idle_effect_id || '');
          const itemTriggerEffectText = effectNameById(item.trigger_effect_id || '');
          const itemScoreText = item.scoring && typeof item.scoring === 'object' && item.scoring.mode
            ? String(item.scoring.mode)
            : '未设置';
          const itemDiscoveryLine = Array.isArray(item.runtime_discoveries) && item.runtime_discoveries.length
            ? String(item.runtime_discoveries[0]?.line || '')
            : '';
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
                  <div class="mt-1 text-[11px] leading-[1.5] text-[#9fb2c8]">玩法：${escapeHtml(item.template_name || '未选择玩法')} · 更新时间：${escapeHtml(formatTime(item.updated_at || item.created_at))}</div>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold whitespace-nowrap text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px" type="button" data-action="select-room" data-room-id="${escapeHtml(item.id)}">${svgIcon('check')}设为当前</button>
                  <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold whitespace-nowrap text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px" type="button" data-action="room-open-wizard" data-room-id="${escapeHtml(item.id)}">${svgIcon('edit')}${item.status === 'draft' ? '继续编辑' : '查看'}</button>
                  <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border-0 bg-gradient-to-b from-[#4caeff] to-[#428fe0] px-3.5 text-[11px] font-extrabold whitespace-nowrap text-white transition hover:brightness-105 active:translate-y-px ${canItemPrepare ? '' : 'opacity-45 pointer-events-none'}" type="button" data-action="prepare-room" data-room-id="${escapeHtml(item.id)}" ${canItemPrepare ? '' : 'disabled'}>${svgIcon('save')}${prepareBusy && String(state.preparingRoomId || '') === String(item.id || '') ? '预备中...' : item.status === 'published' ? '重新预备' : '设备预备'}</button>
                  ${itemCountdown
                    ? `<button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(245,201,95,0.34)] bg-[rgba(42,32,12,0.96)] px-3 text-[11px] font-bold whitespace-nowrap text-[#ffd88a] transition hover:brightness-105 active:translate-y-px" type="button" data-action="cancel-room-countdown">${svgIcon('pause')}取消倒计时</button>`
                    : `<button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border-0 bg-gradient-to-b from-[#62d89a] to-[#48bb7c] px-3.5 text-[11px] font-extrabold whitespace-nowrap text-white transition hover:brightness-105 active:translate-y-px ${canItemStart ? '' : 'opacity-45 pointer-events-none'}" type="button" data-action="start-room" data-room-id="${escapeHtml(item.id)}" ${canItemStart ? '' : 'disabled'}>${svgIcon('play')}开始游戏</button>`}
                  <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border-0 bg-gradient-to-b from-[#62d89a] to-[#48bb7c] px-3.5 text-[11px] font-extrabold whitespace-nowrap text-white transition hover:brightness-105 active:translate-y-px ${canItemStop ? '' : 'opacity-45 pointer-events-none'}" type="button" data-action="stop-room" data-room-id="${escapeHtml(item.id)}" ${canItemStop ? '' : 'disabled'}>${svgIcon('pause')}停止</button>
                  <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(255,124,124,0.28)] bg-[rgba(44,22,24,0.96)] px-3 text-[11px] font-bold whitespace-nowrap text-[#ffb0b0] transition hover:brightness-105 active:translate-y-px ${canItemDelete ? '' : 'opacity-45 pointer-events-none'}" type="button" data-action="delete-room" data-room-id="${escapeHtml(item.id)}" ${canItemDelete ? '' : 'disabled'}>${svgIcon('trash')}删除</button>
                </div>
              </div>

              <div class="mt-3 grid gap-2 lg:grid-cols-2">
                <div class="rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2">
                  <div class="text-[10px] font-bold text-[#8ea3bf]">源组</div>
                  <div class="mt-1 text-[12px] font-semibold text-white">${escapeHtml(itemSourceText)}</div>
                </div>
                <div class="rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2">
                  <div class="text-[10px] font-bold text-[#8ea3bf]">目标组</div>
                  <div class="mt-1 text-[12px] font-semibold text-white">${escapeHtml(itemTargetText)}</div>
                </div>
              </div>

              <div class="mt-3 flex flex-wrap items-center gap-2">
                ${makeChip(`状态 ${escapeHtml(statusText)}`, true)}
                ${makeChip(`源组 ${normalizeNumber(item.source_group_ids?.length, 0)}`)}
                ${makeChip(`目标组 ${normalizeNumber(item.target_group_ids?.length, 0)}`)}
                ${makeChip(`矩阵 ${normalizeNumber(item.effect_rules?.length, 0)}`)}
                ${makeChip(`感应 ${escapeHtml(itemSenseText)}`)}
                ${makeChip(`计分 ${escapeHtml(itemScoreText)}`)}
              </div>

              <div class="mt-3 flex flex-wrap gap-2">
                ${makeChip(`空闲 ${escapeHtml(itemIdleEffectText)}`)}
                ${makeChip(`触发 ${escapeHtml(itemTriggerEffectText)}`)}
                ${makeChip(`分组 ${normalizeNumber(item.group_ids?.length, 0)}`)}
              </div>

              <div class="mt-3 rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.55] text-[#9fb2c8]">
                ${escapeHtml(item.notes || '这里记录本局的开始、结束和房间摘要。')}${itemDiscoveryLine ? `<div class="mt-1 text-[#cfe4ff]">${escapeHtml(itemDiscoveryLine)}</div>` : ''}
              </div>
            </article>
          `;
        }).join('')
      : '<div class="rounded-[18px] border border-dashed border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.86)] px-4 py-6 text-[12px] leading-[1.6] text-[#9fb2c8]">当前还没有房间。点击“向导开局”或在玩法预设页使用“创建房间”开始一个新局。</div>';
    return `
      <div class="grid gap-3 xl:grid-cols-[minmax(0,1.72fr)_minmax(300px,0.48fr)]">
        <section class="order-1 rounded-[20px] border border-[rgba(88,116,154,0.26)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[17px] font-extrabold leading-none text-white">房间列表</div>
              <div class="mt-1.5 text-[12px] leading-[1.5] text-[#aabbd1]">这里只显示摘要信息，方便快速切换房间。详细的实时积分和发现记录在左侧大屏。</div>
            </div>
            <div class="flex flex-wrap justify-end gap-2">
              <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold whitespace-nowrap text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px" type="button" data-action="toggle-room-sort">${svgIcon('arrow')}${sortOrder === 'asc' ? '正序' : '倒序'}</button>
              <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border-0 bg-gradient-to-b from-[#4caeff] to-[#428fe0] px-3.5 text-[11px] font-extrabold whitespace-nowrap text-white transition hover:brightness-105 active:translate-y-px" type="button" data-action="open-wizard">${svgIcon('arrow')}向导开局</button>
            </div>
          </div>
          <div class="mt-4 grid gap-3">
            ${roomCards}
          </div>
        </section>
        <aside class="order-2 rounded-[20px] border border-[rgba(88,116,154,0.26)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[17px] font-extrabold leading-none text-white">当前游戏大屏</div>
              <div class="mt-1.5 text-[12px] leading-[1.5] text-[#aabbd1]">这里显示本局实时积分、组排名和发现记录，触发后会自动刷新。</div>
            </div>
            ${makePill(`步骤 ${wizardState().step + 1}/5`, true)}
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
              <div class="mt-1 text-[13px] font-extrabold ${roomCountdown ? 'text-[#ffd88a]' : room?.status === 'running' ? 'text-[#8ff0b0]' : room?.status === 'published' ? 'text-[#cfe4ff]' : room?.status === 'ended' ? 'text-[#ffb0b0]' : 'text-white'}">${escapeHtml(currentRoomStatusLabel())}</div>
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
              <div class="text-[11px] font-bold text-[#c7d5eb]">源组 / 目标组</div>
              <div class="mt-1 text-[11px] leading-[1.6] text-[#aabbd1]">${escapeHtml(roomSourceText)} / ${escapeHtml(roomTargetText)}</div>
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
              <div class="text-[11px] font-bold text-[#c7d5eb]">感应 / 灯效</div>
              <div class="mt-1 text-[11px] leading-[1.6] text-[#aabbd1]">${escapeHtml(room?.sense_mode || '未设置')} · 空闲 ${escapeHtml(effectNameById(room?.idle_effect_id || ''))} · 触发 ${escapeHtml(effectNameById(room?.trigger_effect_id || ''))}</div>
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
              <div class="text-[11px] font-bold text-[#c7d5eb]">灯效矩阵</div>
              <div class="mt-1 text-[13px] font-extrabold text-white">${escapeHtml(Array.isArray(room?.effect_rules) ? room.effect_rules.length : 0)} 条规则</div>
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
                ${makeChip(`设备 ${visibleControllerDevices().length}`)}
                ${makeChip(`分组 ${activeGroupsCount()}`)}
              </div>
            </div>
            <div class="flex flex-wrap gap-2 pt-1">
              <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold whitespace-nowrap text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px ${room?.status !== 'running' && validation.issues.length === 0 && !roomCountdown && !prepareBusy ? '' : 'opacity-45 pointer-events-none'}" type="button" data-action="prepare-room" ${room?.status !== 'running' && validation.issues.length === 0 && !roomCountdown && !prepareBusy ? '' : 'disabled'}>${svgIcon('save')}${prepareBusy ? '预备中...' : room?.status === 'published' ? '重新预备' : '设备预备'}</button>
              ${roomCountdown
                ? `<button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(245,201,95,0.34)] bg-[rgba(42,32,12,0.96)] px-3 text-[11px] font-bold whitespace-nowrap text-[#ffd88a] transition hover:brightness-105 active:translate-y-px" type="button" data-action="cancel-room-countdown">${svgIcon('pause')}取消倒计时</button>`
                : `<button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold whitespace-nowrap text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px ${room?.status === 'published' ? '' : 'opacity-45 pointer-events-none'}" type="button" data-action="start-room" ${room?.status === 'published' ? '' : 'disabled'}>${svgIcon('play')}开始游戏</button>`}
              <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold whitespace-nowrap text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px ${room?.status === 'running' ? '' : 'opacity-45 pointer-events-none'}" type="button" data-action="stop-room" ${room?.status === 'running' ? '' : 'disabled'}>${svgIcon('pause')}停止游戏</button>
              <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[rgba(255,124,124,0.28)] bg-[rgba(44,22,24,0.96)] px-3 text-[11px] font-bold whitespace-nowrap text-[#ffb0b0] transition hover:brightness-105 active:translate-y-px ${room && room.status !== 'running' ? '' : 'opacity-45 pointer-events-none'}" type="button" data-action="delete-room" ${room && room.status !== 'running' ? '' : 'disabled'}>${svgIcon('trash')}删除房间</button>
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.55] text-[#99acc5]">
              设备预备会先下发本局配置并检查参与分组设备是否在线。开始游戏会先倒计时 10 秒，期间可以取消。
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.55] text-[#99acc5]">
              ${validation.issues.length ? escapeHtml(validation.issues[0]) : roomCountdown ? `正在倒计时 ${roomCountdownRemainingText} 秒，点击取消可回到已预备状态。` : '当前房间配置已满足设备预备和开始条件。'}
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.55] text-[#99acc5]">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span>实时得分：<b class="text-white">${escapeHtml(runtimeSummary.score_total)}</b> 次</span>
                <span>房间哈希：<code>${escapeHtml(runtimeSummary.roomHash)}</code></span>
              </div>
              <div class="mt-2 space-y-1">
                ${runtimeSummary.latest ? `
                  <div>最近：<b class="text-white">${escapeHtml(runtimeSummary.latest.line || formatRuntimeDiscovery(runtimeSummary.latest, room))}</b></div>
                  <div>分组：<b class="text-white">${escapeHtml(groupLabelFromMask(runtimeSummary.latest.self_group_mask))}</b> → <b class="text-white">${escapeHtml(groupLabelFromMask(runtimeSummary.latest.peer_group_mask))}</b></div>
                  <div>RSSI：<b class="text-white">${escapeHtml(runtimeSummary.latest.rssi)} dBm</b> · 时间：<b class="text-white">${escapeHtml(formatClockTime(runtimeSummary.latest.event_ms))}</b></div>
                ` : '<div>暂无触发事件，说明还没有收到满足条件的源/目标信号。</div>'}
              </div>
              ${(runtimeSummary.primary_players.length || runtimeSummary.primary_groups.length) ? `
                <div class="mt-2 grid gap-2 md:grid-cols-2">
                  <div class="rounded-[12px] border border-[rgba(88,116,154,0.14)] bg-[rgba(18,25,36,0.72)] px-2.5 py-2">
                    <div class="mb-1 text-[10px] font-bold text-[#c7d5eb]">个人积分</div>
                    ${runtimeSummary.primary_players.map((item) => `<div class="text-[10.5px] leading-[1.4] text-[#dbe5f6]"><b class="text-white">${escapeHtml(item.label)}</b>：${escapeHtml(item.count)} 分</div>`).join('')}
                  </div>
                  <div class="rounded-[12px] border border-[rgba(88,116,154,0.14)] bg-[rgba(18,25,36,0.72)] px-2.5 py-2">
                    <div class="mb-1 text-[10px] font-bold text-[#c7d5eb]">组排名</div>
                    ${runtimeSummary.primary_groups.map((item) => `<div class="text-[10.5px] leading-[1.4] text-[#dbe5f6]"><b class="text-white">${escapeHtml(item.label)}</b>：${escapeHtml(item.count)} 分</div>`).join('')}
                  </div>
                </div>
              ` : ''}
              <div class="mt-2 rounded-[12px] border border-[rgba(88,116,154,0.14)] bg-[rgba(18,25,36,0.72)] px-2.5 py-2">
                <div class="mb-1 text-[10px] font-bold text-[#c7d5eb]">事件记录</div>
                <div class="space-y-1">
                  ${runtimeSummary.discoveries.length ? runtimeSummary.discoveries.slice(0, 5).map((event) => `<div class="text-[10.5px] leading-[1.45] text-[#dbe5f6]">${escapeHtml(event.line || formatRuntimeDiscovery(event))}</div>`).join('') : '<div class="text-[10.5px] leading-[1.45] text-[#8ea3bf]">暂无发现记录。</div>'}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    `;
  }

  function renderBroadcastRoomPanel() {
    const rooms = sortedRoomList();
    const sortOrder = roomSortOrder();
    const room = currentRoom();
    const validation = validateRoomReady(room);
    const roomCountdown = roomCountdownActive(room?.id);
    const roomCountdownRemainingText = roomCountdownRemaining(room?.id);
    const prepareBusy = !!state.busy.publish || !!state.preparingRoomId;
    const runtimeSummary = roomRuntimeSummary(room);
    const leaderboard = runtimeSummary.primary_players.slice().sort((a, b) => b.count - a.count);
    const groupLeaderboard = runtimeSummary.primary_groups.slice().sort((a, b) => b.count - a.count);
    const leader = leaderboard[0] || null;
    const latest = runtimeSummary.latest || null;
    const runtimeVerb = runtimeVerbForRoom(room);
    const sourceText = Array.isArray(room?.source_group_ids) && room.source_group_ids.length
      ? room.source_group_ids.map((gid) => groupNameById(gid)).join(' / ')
      : '未选择';
    const targetText = Array.isArray(room?.target_group_ids) && room.target_group_ids.length
      ? room.target_group_ids.map((gid) => groupNameById(gid)).join(' / ')
      : '未选择';
    const statusText = currentRoomStatusLabel();
    const broadcastStateClass = room?.status === 'running'
      ? 'border-[rgba(83,229,147,0.48)] bg-[rgba(16,34,25,0.92)] text-[#9ff2bd]'
      : room?.status === 'published'
        ? 'border-[rgba(99,172,255,0.44)] bg-[rgba(18,31,49,0.92)] text-[#cfe4ff]'
        : roomCountdown
          ? 'border-[rgba(245,201,95,0.44)] bg-[rgba(42,32,12,0.94)] text-[#ffd88a]'
          : 'border-[rgba(111,136,170,0.32)] bg-[rgba(15,23,35,0.9)] text-[#d8e5f5]';
    const canPrepare = room?.status !== 'running' && validation.issues.length === 0 && !roomCountdown && !prepareBusy;
    const roomCards = rooms.length ? rooms.map((item) => {
      const active = item.id === activeRoomId();
      const itemCountdown = roomCountdownActive(item.id);
      const status = itemCountdown
        ? `倒计时 ${roomCountdownRemaining(item.id)} 秒`
        : item.status === 'running'
          ? '进行中'
          : item.status === 'published'
            ? '已预备'
            : item.status === 'ended'
              ? '已结束'
              : '草稿';
      return `
        <button class="${[
          'w-full rounded-[14px] border px-3 py-2.5 text-left transition',
          active
            ? 'border-[rgba(125,190,255,0.72)] bg-[rgba(34,54,83,0.98)] shadow-[0_0_0_1px_rgba(125,190,255,0.14)]'
            : 'border-[rgba(88,116,154,0.2)] bg-[rgba(13,20,31,0.86)] hover:border-[rgba(125,190,255,0.34)]'
        ].join(' ')}" type="button" data-action="select-room" data-room-id="${escapeHtml(item.id)}">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate text-[12px] font-extrabold text-white">${escapeHtml(item.name || '未命名房间')}</div>
              <div class="mt-1 truncate text-[10.5px] leading-[1.35] text-[#8fa3bf]">${escapeHtml(item.notes || item.template_name || '无备注')}</div>
            </div>
            <span class="shrink-0 rounded-full border border-[rgba(103,130,169,0.24)] bg-[rgba(8,13,21,0.58)] px-2 py-0.5 text-[10px] font-bold text-[#dbe6f8]">${escapeHtml(status)}</span>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            ${makeChip(`开始 ${escapeHtml(formatTime(item.started_at || item.created_at || item.updated_at))}`, true)}
            ${makeChip(`分 ${escapeHtml(roomRuntimeSummary(item).score_total)}`)}
          </div>
        </button>
      `;
    }).join('') : '<div class="rounded-[14px] border border-dashed border-[rgba(88,116,154,0.22)] bg-[rgba(13,20,31,0.8)] px-3 py-5 text-[12px] leading-[1.55] text-[#8fa3bf]">暂无房间。</div>';
    const scoreRows = leaderboard.length ? leaderboard.map((item, index) => {
      const medalClass = index === 0
        ? 'bg-[linear-gradient(180deg,#ffe58a,#f3a51f)] text-[#171007] shadow-[0_0_24px_rgba(255,194,67,0.24)]'
        : index === 1
          ? 'bg-[linear-gradient(180deg,#eef4ff,#9fb2c8)] text-[#101820]'
          : index === 2
            ? 'bg-[linear-gradient(180deg,#ffbe7b,#b96b38)] text-[#180e08]'
            : 'bg-[rgba(90,124,165,0.28)] text-[#e8f2ff]';
      return `
        <div class="mw-b-score-row grid min-h-[92px] grid-cols-[68px_minmax(0,1fr)_118px] items-center gap-4 rounded-[22px] border border-[rgba(182,205,232,0.18)] bg-[linear-gradient(90deg,rgba(17,26,38,0.98),rgba(9,14,23,0.94))] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div class="mw-b-rank flex h-16 w-16 items-center justify-center rounded-[20px] ${medalClass} text-[28px] font-black">${index + 1}</div>
          <div class="min-w-0">
            <div class="mw-b-player truncate text-[28px] font-black leading-none text-white">${escapeHtml(item.label)}</div>
            <div class="mt-2 inline-flex rounded-full border border-[rgba(88,222,164,0.22)] bg-[rgba(30,79,57,0.28)] px-3 py-1 text-[11px] font-black text-[#a8f0ca]">${escapeHtml(scoreTargetLabel(runtimeSummary.score_target || 'source_player'))}</div>
          </div>
          <div class="text-right">
            <div class="mw-b-score text-[52px] font-black leading-none text-[#fff3c1]">${escapeHtml(item.count)}</div>
            <div class="mt-1 text-[11px] font-black tracking-[0.18em] text-[#9fb4cf]">SCORE</div>
          </div>
        </div>
      `;
    }).join('') : `<div class="mw-b-empty-large flex min-h-[260px] flex-col items-center justify-center rounded-[26px] border border-[rgba(164,190,220,0.16)] bg-[linear-gradient(180deg,rgba(15,23,36,0.9),rgba(7,12,20,0.9))] text-center text-[28px] font-black leading-[1.25] text-[#d9e7f8]"><div>等待第一条事件</div><div style="margin-top:10px;font-size:14px;line-height:1.4;color:#8298b3;font-weight:800">${escapeHtml(runtimeVerb)} 发生后，这里会立刻进入排行榜</div></div>`;
    const groupRows = groupLeaderboard.length ? groupLeaderboard.map((item, index) => `
      <div class="flex items-center justify-between gap-3 rounded-[18px] border border-[rgba(182,205,232,0.14)] bg-[rgba(12,18,29,0.76)] px-4 py-3">
        <div class="min-w-0">
          <div class="truncate text-[18px] font-black text-white">${escapeHtml(item.label)}</div>
          <div class="mt-1 text-[10px] font-black tracking-[0.16em] text-[#88a4c4]">GROUP #${index + 1}</div>
        </div>
        <div class="text-[34px] font-black text-[#fff3c1]">${escapeHtml(item.count)}</div>
      </div>
    `).join('') : '<div class="rounded-[18px] border border-[rgba(164,190,220,0.14)] bg-[rgba(9,14,23,0.62)] px-4 py-6 text-[15px] font-black text-[#8298b3]">暂无组排名</div>';
    const discoveryRows = runtimeSummary.discoveries.length ? runtimeSummary.discoveries.slice(0, 7).map((event, index) => `
      <div class="rounded-[18px] border border-[rgba(182,205,232,0.14)] bg-[rgba(12,18,29,0.78)] px-4 py-3">
        <div class="flex items-start gap-3">
          <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-[rgba(72,181,255,0.16)] text-[13px] font-black text-[#8bd1ff]">${index + 1}</div>
          <div class="min-w-0">
            <div class="mw-b-discovery-line text-[17px] font-black leading-[1.32] text-white">${escapeHtml(event.line || formatRuntimeDiscovery(event))}</div>
            <div class="mt-1 text-[11px] font-black tracking-[0.14em] text-[#8fa8c7]">RSSI ${escapeHtml(event.rssi)} dBm</div>
          </div>
        </div>
      </div>
    `).join('') : '<div class="flex min-h-[160px] items-center justify-center rounded-[22px] border border-[rgba(164,190,220,0.14)] bg-[rgba(9,14,23,0.62)] text-[21px] font-black text-[#8298b3]">暂无事件播报</div>';
    return `
      <style>
        .mw-b-layout{display:grid;grid-template-columns:minmax(920px,1fr) 300px;gap:16px;align-items:start;overflow-x:auto}
        .mw-b-header-grid{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:20px;align-items:stretch}
        .mw-b-group-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
        .mw-b-title{font-size:56px;line-height:.95;font-weight:900}
        .mw-b-total-card{width:260px;text-align:right}
        .mw-b-total-number{font-size:104px;line-height:.82;font-weight:900}
        .mw-b-content-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(380px,.85fr);gap:20px}
        .mw-b-section-title{font-size:32px;line-height:1;font-weight:900}
        .mw-b-small-title{font-size:26px;line-height:1;font-weight:900}
        .mw-b-score-row{display:grid;grid-template-columns:68px minmax(0,1fr) 118px}
        .mw-b-rank{width:64px;height:64px;font-size:28px}
        .mw-b-player{font-size:28px;line-height:1}
        .mw-b-score{font-size:52px;line-height:1}
        .mw-b-latest-name{font-size:38px;line-height:1.02;font-weight:900}
        .mw-b-empty-large{min-height:260px;font-size:28px;line-height:1.25}
        .mw-b-empty-latest{min-height:230px;font-size:30px;line-height:1.2}
        .mw-b-discovery-line{font-size:17px;line-height:1.32}
      </style>
      <div data-room-broadcast="layout" class="mw-b-layout grid gap-4 overflow-x-auto" style="grid-template-columns:minmax(920px,1fr) 300px;align-items:start;">
        <section data-room-broadcast="main" class="min-h-[720px] overflow-hidden rounded-[30px] border border-[rgba(196,216,238,0.24)] bg-[#080d14] shadow-[0_28px_90px_rgba(0,0,0,0.5)]">
          <div class="border-b border-[rgba(196,216,238,0.16)] bg-[linear-gradient(180deg,#172235,#0a1019)] px-7 py-6">
            <div class="mw-b-header-grid grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="inline-flex h-8 items-center rounded-full border border-[rgba(120,191,255,0.28)] bg-[rgba(76,169,255,0.14)] px-3 text-[11px] font-black tracking-[0.18em] text-[#8fd0ff]">LIVE SCOREBOARD</span>
                  <span class="inline-flex h-8 items-center rounded-full border ${broadcastStateClass} px-3 text-[11px] font-black">${escapeHtml(statusText)}</span>
                </div>
                <div class="mw-b-title mt-4 truncate text-[56px] font-black leading-[0.95] text-white">${escapeHtml(room?.name || '当前房间未创建')}</div>
                <div class="mw-b-group-grid mt-4 grid gap-2 md:grid-cols-2">
                  <div class="rounded-[18px] border border-[rgba(88,222,164,0.18)] bg-[rgba(21,56,43,0.38)] px-4 py-3">
                    <div class="text-[11px] font-black tracking-[0.16em] text-[#92e9bd]">SOURCE</div>
                    <div class="mt-1 truncate text-[22px] font-black text-white">${escapeHtml(sourceText)}</div>
                  </div>
                  <div class="rounded-[18px] border border-[rgba(255,204,102,0.18)] bg-[rgba(78,51,21,0.34)] px-4 py-3">
                    <div class="text-[11px] font-black tracking-[0.16em] text-[#ffd78c]">TARGET</div>
                    <div class="mt-1 truncate text-[22px] font-black text-white">${escapeHtml(targetText)}</div>
                  </div>
                </div>
              </div>
              <div class="mw-b-total-card rounded-[28px] border border-[rgba(255,221,142,0.28)] bg-[linear-gradient(180deg,#2f2514,#100d09)] px-5 py-5 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <div class="text-[12px] font-black tracking-[0.22em] text-[#ffe7a6]">TOTAL SCORE</div>
                <div class="mw-b-total-number mt-2 text-[104px] font-black leading-[0.82] text-[#fff2bd]">${escapeHtml(runtimeSummary.score_total)}</div>
                <div class="mt-3 text-[14px] font-black text-[#d8c38b]">本局实时得分</div>
              </div>
            </div>
          </div>

          <div class="mw-b-content-grid grid gap-5 p-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
            <div class="grid gap-5">
              <div class="rounded-[28px] border border-[rgba(196,216,238,0.16)] bg-[linear-gradient(180deg,rgba(18,26,39,0.98),rgba(8,13,21,0.96))] p-5">
                <div class="flex items-end justify-between gap-3">
                  <div>
                    <div class="text-[12px] font-black tracking-[0.22em] text-[#8fd0ff]">PLAYER RANKING</div>
                    <div class="mw-b-section-title mt-1 text-[32px] font-black leading-none text-white">源组积分榜</div>
                  </div>
                  <div class="rounded-full border border-[rgba(196,216,238,0.18)] bg-[rgba(255,255,255,0.05)] px-4 py-2 text-[12px] font-black text-[#cfe0f5]">玩家 ${escapeHtml(leaderboard.length)}</div>
                </div>
                <div class="mt-5 grid gap-3">${scoreRows}</div>
              </div>

              <div class="rounded-[28px] border border-[rgba(196,216,238,0.14)] bg-[linear-gradient(180deg,rgba(15,23,36,0.94),rgba(8,13,21,0.92))] p-5">
                <div class="flex items-end justify-between gap-3">
                  <div>
                    <div class="text-[12px] font-black tracking-[0.22em] text-[#8fd0ff]">TEAM BOARD</div>
                    <div class="mw-b-small-title mt-1 text-[26px] font-black leading-none text-white">小组排名</div>
                  </div>
                  <div class="rounded-full border border-[rgba(196,216,238,0.18)] bg-[rgba(255,255,255,0.05)] px-4 py-2 text-[12px] font-black text-[#cfe0f5]">组 ${escapeHtml(groupLeaderboard.length)}</div>
                </div>
                <div class="mt-4 grid gap-2">${groupRows}</div>
              </div>
            </div>

            <div class="grid gap-5">
              <div class="rounded-[28px] border border-[rgba(196,216,238,0.16)] bg-[linear-gradient(180deg,rgba(20,31,48,0.98),rgba(8,13,21,0.96))] p-5">
                <div class="text-[12px] font-black tracking-[0.22em] text-[#8fd0ff]">LATEST DISCOVERY</div>
                <div class="mt-4 rounded-[26px] border border-[rgba(196,216,238,0.16)] bg-[rgba(4,8,14,0.72)] p-5">
                  ${latest ? `
                    <div class="mw-b-latest-name text-[38px] font-black leading-[1.02] text-white">${escapeHtml(deviceLabelFromRuntime(latest, 'self'))}</div>
                    <div class="my-4 inline-flex rounded-full bg-[#3c9cff] px-4 py-2 text-[13px] font-black tracking-[0.2em] text-white">发现</div>
                    <div class="mw-b-latest-name text-[38px] font-black leading-[1.02] text-[#fff2bd]">${escapeHtml(deviceLabelFromRuntime(latest, 'peer'))}</div>
                    <div class="mt-5 rounded-[18px] border border-[rgba(196,216,238,0.12)] bg-[rgba(255,255,255,0.04)] px-4 py-3 text-[14px] font-black leading-[1.5] text-[#b8cbe2]">${escapeHtml(groupLabelFromMask(latest.self_group_mask))} -> ${escapeHtml(groupLabelFromMask(latest.peer_group_mask))}</div>
                    <div class="mt-3 text-[13px] font-black tracking-[0.12em] text-[#8fa8c7]">${escapeHtml(formatClockTime(latest.event_ms))} · RSSI ${escapeHtml(latest.rssi)} dBm</div>
                  ` : `
                    <div class="mw-b-empty-latest flex min-h-[230px] flex-col items-center justify-center text-center text-[30px] font-black leading-[1.2] text-[#d9e7f8]">
                      <div>等待发现</div>
                      <div style="margin-top:12px;font-size:14px;line-height:1.45;color:#8298b3;font-weight:800">触发后显示“谁发现了谁”和信号强度</div>
                    </div>
                  `}
                </div>
              </div>

              <div class="rounded-[28px] border border-[rgba(196,216,238,0.14)] bg-[linear-gradient(180deg,rgba(15,23,36,0.94),rgba(8,13,21,0.92))] p-5">
                <div class="flex items-end justify-between gap-3">
                  <div>
                    <div class="text-[12px] font-black tracking-[0.22em] text-[#8fd0ff]">PLAY BY PLAY</div>
                    <div class="mw-b-small-title mt-1 text-[26px] font-black leading-none text-white">发现播报</div>
                  </div>
                  <div class="rounded-full border border-[rgba(196,216,238,0.18)] bg-[rgba(255,255,255,0.05)] px-4 py-2 text-[12px] font-black text-[#cfe0f5]">记录 ${escapeHtml(runtimeSummary.discoveries.length)}</div>
                </div>
                <div class="mt-4 grid gap-2">${discoveryRows}</div>
              </div>
            </div>
          </div>

          <div class="border-t border-[rgba(196,216,238,0.12)] bg-[rgba(5,9,15,0.72)] px-5 py-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex flex-wrap gap-2">
                <button class="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[rgba(196,216,238,0.18)] bg-[rgba(255,255,255,0.06)] px-5 text-[12px] font-black text-[#e6f0fb] ${canPrepare ? '' : 'opacity-45 pointer-events-none'}" type="button" data-action="prepare-room" ${canPrepare ? '' : 'disabled'}>${svgIcon('save')}${prepareBusy ? '预备中...' : room?.status === 'published' ? '重新预备' : '设备预备'}</button>
                ${roomCountdown
                  ? `<button class="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[rgba(255,221,142,0.34)] bg-[rgba(78,51,21,0.64)] px-5 text-[12px] font-black text-[#ffe2a4]" type="button" data-action="cancel-room-countdown">${svgIcon('pause')}取消倒计时</button>`
                  : `<button class="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[rgba(89,222,164,0.26)] bg-[rgba(34,124,83,0.54)] px-5 text-[12px] font-black text-[#c0f8d8] ${room?.status === 'published' ? '' : 'opacity-45 pointer-events-none'}" type="button" data-action="start-room" ${room?.status === 'published' ? '' : 'disabled'}>${svgIcon('play')}开始游戏</button>`}
                <button class="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[rgba(255,130,130,0.24)] bg-[rgba(117,44,44,0.42)] px-5 text-[12px] font-black text-[#ffd2d2] ${room?.status === 'running' ? '' : 'opacity-45 pointer-events-none'}" type="button" data-action="stop-room" ${room?.status === 'running' ? '' : 'disabled'}>${svgIcon('pause')}停止游戏</button>
              </div>
              <div class="rounded-full border border-[rgba(196,216,238,0.12)] bg-[rgba(255,255,255,0.04)] px-4 py-2 text-[12px] font-black text-[#a9bdd5]">${validation.issues.length ? escapeHtml(validation.issues[0]) : roomCountdown ? `正在倒计时 ${roomCountdownRemainingText} 秒` : `时长 ${escapeHtml(currentRoomDuration())}`}</div>
            </div>
          </div>
        </section>

        <aside data-room-broadcast="side" class="rounded-[24px] border border-[rgba(122,147,178,0.22)] bg-[linear-gradient(180deg,rgba(17,24,35,0.94),rgba(11,16,25,0.94))] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="text-[14px] font-black text-white">房间列表</div>
              <div class="mt-1 text-[10.5px] leading-[1.35] text-[#8fa3bf]">切换和管理房间</div>
            </div>
            <div class="flex gap-1.5">
              <button class="inline-flex h-8 items-center justify-center rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-2.5 text-[10.5px] font-bold text-[#dbe5f4]" type="button" data-action="toggle-room-sort">${sortOrder === 'asc' ? '正序' : '倒序'}</button>
              <button class="inline-flex h-8 items-center justify-center rounded-full border-0 bg-[#3f91df] px-2.5 text-[10.5px] font-black text-white" type="button" data-action="open-wizard">新局</button>
            </div>
          </div>
          <div class="mt-3 grid max-h-[760px] gap-2 overflow-auto pr-1">${roomCards}</div>
        </aside>
      </div>
    `;
  }

  function renderBroadcastRoomPanelV2() {
    const rooms = sortedRoomList();
    const sortOrder = roomSortOrder();
    const room = currentRoom();
    const validation = validateRoomReady(room);
    const roomCountdown = roomCountdownActive(room?.id);
    const roomCountdownRemainingText = roomCountdownRemaining(room?.id);
    const prepareBusy = !!state.busy.publish || !!state.preparingRoomId;
    const runtimeSummary = roomRuntimeSummary(room);
    const leaderboard = runtimeSummary.primary_players.slice().sort((a, b) => b.count - a.count);
    const groupLeaderboard = runtimeSummary.primary_groups.slice().sort((a, b) => b.count - a.count);
    const latest = runtimeSummary.latest || null;
    const runtimeVerb = runtimeVerbForRoom(room);
    const sourceIds = Array.isArray(room?.source_group_ids) ? room.source_group_ids : [];
    const targetIds = Array.isArray(room?.target_group_ids) ? room.target_group_ids : [];
    const sourceMask = groupMaskFromIds(sourceIds);
    const targetMask = groupMaskFromIds(targetIds);
    const sourceText = sourceIds.length ? sourceIds.map((gid) => groupNameById(gid)).join(' / ') : '未选择源组';
    const targetText = targetIds.length ? targetIds.map((gid) => groupNameById(gid)).join(' / ') : '未选择目标组';
    const sourceDevices = visibleControllerDevices().filter((device) => (normalizeNumber(device?.group_mask, 0) & sourceMask) !== 0);
    const targetDevices = visibleControllerDevices().filter((device) => (normalizeNumber(device?.group_mask, 0) & targetMask) !== 0);
    const participantCount = Math.max(sourceDevices.length, leaderboard.length);
    const onlineCount = visibleControllerDevices().filter((device) => isDeviceOnline(device)).length;
    const retainedCount = retainedDeviceCount();
    const statusText = currentRoomStatusLabel();
    const statusClass = room?.status === 'running'
      ? 'mw-tv-status--running'
      : room?.status === 'published'
        ? 'mw-tv-status--ready'
        : roomCountdown
          ? 'mw-tv-status--countdown'
          : room?.status === 'ended'
            ? 'mw-tv-status--ended'
            : 'mw-tv-status--draft';
    const canPrepare = room?.status !== 'running' && validation.issues.length === 0 && !roomCountdown && !prepareBusy;
    const timeText = roomCountdown ? `${roomCountdownRemainingText}s` : currentRoomDuration();
    const nowText = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).replace(/\//g, '-');
    const podiumOrder = [
      { item: leaderboard[1] || null, rank: 2, tone: 'silver' },
      { item: leaderboard[0] || null, rank: 1, tone: 'gold' },
      { item: leaderboard[2] || null, rank: 3, tone: 'bronze' }
    ];
    const scoreByGroup = new Map(groupLeaderboard.map((item) => [item.label, item.count]));
    const groupSeeds = groupLeaderboard.length
      ? groupLeaderboard.slice(0, 3)
      : (sourceIds.length ? sourceIds.map((gid) => ({ label: groupNameById(gid), count: 0 })) : [{ label: '源组A', count: 0 }, { label: '源组B', count: 0 }, { label: '源组C', count: 0 }]);
    const roomCards = rooms.length ? rooms.map((item) => {
      const active = item.id === activeRoomId();
      const summary = roomRuntimeSummary(item);
      const itemValidation = validateRoomReady(item);
      const itemCountdown = roomCountdownActive(item.id);
      const canItemPrepare = item.status !== 'running' && itemValidation.issues.length === 0 && !itemCountdown && !prepareBusy;
      const canItemStart = item.status === 'published' && !itemCountdown;
      const canItemStop = item.status === 'running';
      const canItemDelete = item.status !== 'running';
      const status = itemCountdown
        ? `倒计时 ${roomCountdownRemaining(item.id)}s`
        : item.status === 'running'
          ? '进行中'
          : item.status === 'published'
            ? '已预备'
            : item.status === 'ended'
              ? '已结束'
              : '等待中';
      const cardClass = active ? 'mw-tv-room-card is-active' : 'mw-tv-room-card';
      return `
        <article class="${cardClass}">
          <button class="mw-tv-room-select" type="button" data-action="select-room" data-room-id="${escapeHtml(item.id)}">
            <div class="mw-tv-room-line">
              <div class="mw-tv-room-name">${escapeHtml(item.name || '未命名房间')}</div>
              <span class="mw-tv-room-status">${escapeHtml(status)}</span>
            </div>
            <div class="mw-tv-room-note">${escapeHtml(item.notes || item.template_name || '无备注')}</div>
            <div class="mw-tv-room-meta">
              <span>${svgIcon('device')}${escapeHtml(participantCount || visibleControllerDevices().length || 0)}</span>
              <span>${svgIcon('record')}${escapeHtml(summary.score_total)} 分</span>
            </div>
          </button>
          <div class="mw-tv-room-controls">
            <button class="mw-tv-mini-btn" type="button" data-action="select-room" data-room-id="${escapeHtml(item.id)}">当前</button>
            <button class="mw-tv-mini-btn" type="button" data-action="room-open-wizard" data-room-id="${escapeHtml(item.id)}">${item.status === 'draft' ? '编辑' : '查看'}</button>
            <button class="mw-tv-mini-btn" type="button" data-action="prepare-room" data-room-id="${escapeHtml(item.id)}" ${canItemPrepare ? '' : 'disabled'}>${prepareBusy && String(state.preparingRoomId || '') === String(item.id || '') ? '预备中' : item.status === 'published' ? '重预备' : '预备'}</button>
            ${itemCountdown
              ? `<button class="mw-tv-mini-btn danger" type="button" data-action="cancel-room-countdown" data-room-id="${escapeHtml(item.id)}">取消</button>`
              : `<button class="mw-tv-mini-btn primary" type="button" data-action="start-room" data-room-id="${escapeHtml(item.id)}" ${canItemStart ? '' : 'disabled'}>开始</button>`}
            <button class="mw-tv-mini-btn danger" type="button" data-action="stop-room" data-room-id="${escapeHtml(item.id)}" ${canItemStop ? '' : 'disabled'}>停止</button>
            <button class="mw-tv-mini-btn danger" type="button" data-action="delete-room" data-room-id="${escapeHtml(item.id)}" ${canItemDelete ? '' : 'disabled'}>删除</button>
          </div>
        </article>
      `;
    }).join('') : '<div class="mw-tv-empty-side">暂无房间</div>';
    const podiumCards = podiumOrder.map(({ item, rank, tone }) => {
      const score = item ? item.count : 0;
      const name = item ? item.label : '等待上榜';
      const groupLabel = item?.idx !== undefined ? devicePrimaryGroupLabel(controllerDevices()[item.idx]) : sourceText;
      return `
        <div class="mw-tv-podium mw-tv-podium--${tone}">
          <div class="mw-tv-medal">${rank}</div>
          <div class="mw-tv-avatar">${svgIcon('device')}</div>
          <div class="mw-tv-player">${escapeHtml(name)}</div>
          <div class="mw-tv-player-group">${escapeHtml(groupLabel || '源组')}</div>
          <div class="mw-tv-points">${escapeHtml(score)} <span>分</span></div>
        </div>
      `;
    }).join('');
    const tableRows = (leaderboard.length ? leaderboard.slice(3, 8) : sourceDevices.slice(0, 5).map((device, index) => ({
      label: deviceDisplayName(device),
      count: 0,
      idx: controllerDevices().indexOf(device),
      rankOffset: index + 4
    }))).map((item, index) => {
      const rank = item.rankOffset || index + 4;
      const groupLabel = item?.idx !== undefined ? devicePrimaryGroupLabel(controllerDevices()[item.idx]) : sourceText;
      return `
        <div class="mw-tv-table-row">
          <span>${escapeHtml(rank)}</span>
          <b>${escapeHtml(item.label)}</b>
          <span>${escapeHtml(groupLabel || '源组')}</span>
          <span>${escapeHtml(item.count)}</span>
          <strong>${escapeHtml(item.count)}</strong>
        </div>
      `;
    }).join('') || '<div class="mw-tv-table-empty">等待玩家上榜</div>';
    const discoveryRows = runtimeSummary.discoveries.length ? runtimeSummary.discoveries.slice(0, 6).map((event) => `
      <div class="mw-tv-event">
        <div class="mw-tv-event-time">${escapeHtml(formatClockTime(event.event_ms))}</div>
        <div class="mw-tv-event-main">
          <b>${escapeHtml(deviceLabelFromRuntime(event, 'self'))}</b>
          <span>${escapeHtml(runtimeVerb)}</span>
          <strong>${escapeHtml(deviceLabelFromRuntime(event, 'peer'))}</strong>
        </div>
        <div class="mw-tv-event-sub">${escapeHtml(groupLabelFromMask(event.self_group_mask))} -> ${escapeHtml(groupLabelFromMask(event.peer_group_mask))} · RSSI ${escapeHtml(event.rssi)} dBm</div>
      </div>
    `).join('') : '<div class="mw-tv-event-empty">等待第一条事件</div>';
    const groupCards = groupSeeds.slice(0, 3).map((item, index) => {
      const tone = index === 0 ? 'gold' : index === 1 ? 'silver' : 'bronze';
      const memberCount = sourceIds.length
        ? sourceDevices.filter((device) => devicePrimaryGroupIds(device).some((gid) => groupNameById(gid) === item.label)).length
        : 0;
      const score = scoreByGroup.has(item.label) ? scoreByGroup.get(item.label) : item.count;
      return `
        <div class="mw-tv-group-card mw-tv-group-card--${tone}">
          <div class="mw-tv-group-medal">${index + 1}</div>
          <div>
            <div class="mw-tv-group-name">${escapeHtml(item.label)}</div>
            <div class="mw-tv-group-sub">成员：${escapeHtml(memberCount || '-')}</div>
          </div>
          <div class="mw-tv-group-score">${escapeHtml(score)} <span>分</span></div>
        </div>
      `;
    }).join('');
    return `
      <style>
        .mw-tv{min-width:1320px;padding:18px;background:radial-gradient(circle at 28% 4%,rgba(103,80,255,.22),transparent 34%),linear-gradient(180deg,#07102a,#08132c 42%,#071025);color:#f7fbff;border-radius:20px;box-shadow:0 28px 80px rgba(0,0,0,.42);font-family:Inter,"Segoe UI","Microsoft YaHei",sans-serif}
        .mw-tv:fullscreen{width:100vw;min-width:0;min-height:100vh;border-radius:0;overflow:auto}
        .mw-tv *{box-sizing:border-box}
        .mw-tv-top{display:grid;grid-template-columns:270px minmax(0,1fr);gap:22px;align-items:center;margin-bottom:16px}
        .mw-tv-brand{height:96px;display:flex;align-items:center;gap:14px}
        .mw-tv-brand-mark{width:58px;height:58px;color:#9a5cff}
        .mw-tv-brand-title{font-size:25px;font-weight:900;letter-spacing:.06em;line-height:1;background:linear-gradient(90deg,#be5cff,#4aa5ff);-webkit-background-clip:text;background-clip:text;color:transparent}
        .mw-tv-brand-sub{margin-top:10px;font-size:14px;letter-spacing:.42em;color:#b8c3e0;font-weight:800}
        .mw-tv-statusbar{height:96px;border:1px solid rgba(132,156,216,.18);border-radius:12px;background:linear-gradient(180deg,rgba(23,35,74,.72),rgba(13,24,58,.72));display:grid;grid-template-columns:minmax(0,1.3fr) 160px 160px 230px;align-items:center;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
        .mw-tv-status-cell{height:58px;padding:0 26px;display:flex;flex-direction:column;justify-content:center;border-left:1px solid rgba(132,156,216,.12)}
        .mw-tv-status-cell:first-child{border-left:0}
        .mw-tv-label{font-size:12px;color:#8d9abd;font-weight:800}
        .mw-tv-room-title{margin-top:6px;font-size:29px;line-height:1;font-weight:900}
        .mw-tv-room-desc{margin-top:8px;font-size:13px;color:#9da8c7;font-weight:700}
        .mw-tv-badge{align-self:flex-start;margin-top:7px;padding:9px 22px;border-radius:10px;font-size:17px;font-weight:900}
        .mw-tv-status--running{background:rgba(21,116,86,.46);color:#39f493}
        .mw-tv-status--ready{background:rgba(40,89,165,.5);color:#7dc0ff}
        .mw-tv-status--countdown{background:rgba(138,88,24,.52);color:#ffd178}
        .mw-tv-status--ended{background:rgba(101,113,139,.42);color:#d1daef}
        .mw-tv-status--draft{background:rgba(56,74,115,.46);color:#a9b9df}
        .mw-tv-timebox{align-self:flex-start;margin-top:7px;min-width:104px;text-align:center;padding:8px 14px;border-radius:10px;background:rgba(42,93,184,.42);color:#5ca7ff;font-size:19px;font-weight:900}
        .mw-tv-now{margin-top:8px;font-size:16px;color:#f1f5ff}
        .mw-tv-main{display:grid;grid-template-columns:minmax(0,1fr) 328px;gap:16px}
        .mw-tv-panel{border:1px solid rgba(132,156,216,.2);border-radius:9px;background:linear-gradient(180deg,rgba(19,34,78,.68),rgba(10,24,58,.78));overflow:hidden}
        .mw-tv-tabs{height:52px;display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid rgba(132,156,216,.16);background:rgba(18,28,67,.58)}
        .mw-tv-tab{position:relative;display:flex;align-items:center;justify-content:center;gap:10px;font-size:17px;font-weight:900;color:#a8b2d6}
        .mw-tv-tab svg{width:20px;height:20px}
        .mw-tv-tab.is-active{color:#fff;background:linear-gradient(90deg,rgba(174,77,255,.24),rgba(76,126,255,.08))}
        .mw-tv-tab.is-active:after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg,#a44cff,#5b8dff);box-shadow:0 0 18px rgba(164,76,255,.7)}
        .mw-tv-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(360px,.9fr);gap:12px;padding:12px}
        .mw-tv-card{border:1px solid rgba(132,156,216,.18);border-radius:8px;background:linear-gradient(180deg,rgba(22,42,92,.6),rgba(10,25,62,.72));box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
        .mw-tv-ranking{padding:18px 20px 16px;min-height:424px}
        .mw-tv-podiums{height:205px;display:grid;grid-template-columns:1fr 1.05fr 1fr;gap:14px;align-items:end;margin-bottom:14px}
        .mw-tv-podium{position:relative;min-height:150px;border:1px solid rgba(147,172,226,.34);border-radius:7px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding:24px 16px 18px;background:linear-gradient(180deg,rgba(57,78,139,.28),rgba(14,29,72,.7))}
        .mw-tv-podium--gold{min-height:184px;border-color:rgba(255,192,64,.58);background:linear-gradient(180deg,rgba(118,80,18,.48),rgba(22,29,63,.78))}
        .mw-tv-podium--silver{border-color:rgba(183,204,245,.45)}
        .mw-tv-podium--bronze{border-color:rgba(255,149,117,.42);background:linear-gradient(180deg,rgba(109,58,65,.36),rgba(22,29,63,.76))}
        .mw-tv-medal{position:absolute;top:-28px;left:50%;transform:translateX(-50%);width:62px;height:62px;display:flex;align-items:center;justify-content:center;clip-path:polygon(50% 0,92% 25%,92% 75%,50% 100%,8% 75%,8% 25%);font-size:26px;font-weight:900;color:#1f2030;background:linear-gradient(180deg,#ffe477,#f5a419);box-shadow:0 0 26px rgba(255,196,61,.36)}
        .mw-tv-podium--silver .mw-tv-medal{background:linear-gradient(180deg,#e6f0ff,#95a8c7)}
        .mw-tv-podium--bronze .mw-tv-medal{background:linear-gradient(180deg,#ffb390,#d06d56)}
        .mw-tv-avatar{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#dce7ff;background:radial-gradient(circle at 34% 26%,#fff,#9fb9ff 46%,#705cff);border:2px solid rgba(255,255,255,.62)}
        .mw-tv-avatar svg{width:26px;height:26px}
        .mw-tv-player{margin-top:10px;font-size:17px;font-weight:900}
        .mw-tv-player-group{margin-top:4px;font-size:12px;color:#9ca9cc;font-weight:800}
        .mw-tv-points{margin-top:8px;font-size:30px;font-weight:900;color:#7db2ff}
        .mw-tv-podium--gold .mw-tv-points{font-size:38px;color:#ff9f1f}
        .mw-tv-podium--bronze .mw-tv-points{color:#d96bff}
        .mw-tv-points span{font-size:16px}
        .mw-tv-table{border:1px solid rgba(132,156,216,.15);border-radius:8px;overflow:hidden;background:rgba(8,20,52,.5)}
        .mw-tv-table-head,.mw-tv-table-row{display:grid;grid-template-columns:70px minmax(0,1.2fr) minmax(0,.9fr) 100px 100px;align-items:center}
        .mw-tv-table-head{height:38px;padding:0 18px;background:rgba(39,61,119,.4);font-size:13px;color:#9eabd0;font-weight:800}
        .mw-tv-table-row{height:48px;padding:0 18px;border-top:1px solid rgba(132,156,216,.11);font-size:15px}
        .mw-tv-table-row b{font-weight:900}
        .mw-tv-table-row strong{color:#d86dff}
        .mw-tv-table-empty{height:96px;display:flex;align-items:center;justify-content:center;color:#8f9abd;font-weight:900}
        .mw-tv-participants{margin-top:16px;color:#9ca8c8;font-size:14px;font-weight:800}
        .mw-tv-events{padding:18px;min-height:424px}
        .mw-tv-card-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
        .mw-tv-card-title b{font-size:19px}
        .mw-tv-card-title span{font-size:12px;color:#9da8c7;border:1px solid rgba(132,156,216,.18);border-radius:999px;padding:6px 10px}
        .mw-tv-event{padding:13px 14px;border-radius:9px;background:rgba(13,29,68,.58);border:1px solid rgba(132,156,216,.11);margin-bottom:10px}
        .mw-tv-event-time{font-size:12px;color:#9eaad0}
        .mw-tv-event-main{margin-top:7px;font-size:15px}
        .mw-tv-event-main b{color:#d65dff}
        .mw-tv-event-main span{margin:0 8px;color:#fff}
        .mw-tv-event-main strong{color:#ff9f1f}
        .mw-tv-event-sub{margin-top:7px;color:#9da8c7;font-size:12px;font-weight:800}
        .mw-tv-event-empty{height:250px;display:flex;align-items:center;justify-content:center;color:#8f9abd;font-size:18px;font-weight:900}
        .mw-tv-groups{margin-top:12px}
        .mw-tv-section-title{height:46px;display:flex;align-items:center;gap:10px;padding:0 18px;border-bottom:1px solid rgba(132,156,216,.15);font-size:18px;font-weight:900}
        .mw-tv-section-title svg{width:22px;height:22px;color:#925eff}
        .mw-tv-group-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:12px}
        .mw-tv-group-card{min-height:126px;border:1px solid rgba(132,156,216,.18);border-radius:8px;padding:20px 22px;display:grid;grid-template-columns:76px minmax(0,1fr) 120px;align-items:center;background:linear-gradient(90deg,rgba(25,46,98,.68),rgba(12,27,68,.75))}
        .mw-tv-group-card--gold{background:linear-gradient(90deg,rgba(90,64,18,.56),rgba(12,27,68,.75))}
        .mw-tv-group-card--bronze{background:linear-gradient(90deg,rgba(91,43,52,.5),rgba(12,27,68,.75))}
        .mw-tv-group-medal{width:58px;height:58px;display:flex;align-items:center;justify-content:center;clip-path:polygon(50% 0,92% 25%,92% 75%,50% 100%,8% 75%,8% 25%);background:linear-gradient(180deg,#ffd66b,#f2a10e);color:#20180a;font-size:25px;font-weight:900}
        .mw-tv-group-card--silver .mw-tv-group-medal{background:linear-gradient(180deg,#e5efff,#91a7c8)}
        .mw-tv-group-card--bronze .mw-tv-group-medal{background:linear-gradient(180deg,#ffb08b,#d57057)}
        .mw-tv-group-name{font-size:20px;font-weight:900}
        .mw-tv-group-sub{margin-top:12px;color:#9ca8c8;font-size:13px;font-weight:800}
        .mw-tv-group-score{text-align:right;font-size:40px;font-weight:900;color:#ffc21d}
        .mw-tv-group-score span{font-size:18px}
        .mw-tv-side{min-height:782px;padding:16px;background:linear-gradient(180deg,rgba(22,34,80,.7),rgba(9,21,54,.82))}
        .mw-tv-side-title{display:flex;align-items:center;gap:10px;margin-bottom:16px;font-size:19px;font-weight:900}
        .mw-tv-side-title svg{width:22px;height:22px;color:#9864ff}
        .mw-tv-room-card{width:100%;border:1px solid rgba(132,156,216,.13);border-radius:9px;background:linear-gradient(180deg,rgba(28,45,91,.62),rgba(16,31,71,.68));padding:12px;margin-bottom:12px;text-align:left;color:#fff;transition:filter .15s,border-color .15s}
        .mw-tv-room-card:hover{filter:brightness(1.08)}
        .mw-tv-room-card.is-active{border-color:#b45bff;box-shadow:0 0 0 1px rgba(180,91,255,.35),0 0 28px rgba(110,63,255,.18)}
        .mw-tv-room-select{display:block;width:100%;border:0;background:transparent;color:inherit;text-align:left;padding:4px 4px 10px}
        .mw-tv-room-line{display:flex;align-items:center;justify-content:space-between;gap:10px}
        .mw-tv-room-name{font-size:18px;font-weight:900}
        .mw-tv-room-status{border-radius:999px;background:rgba(23,115,84,.34);color:#38ef91;padding:5px 10px;font-size:13px;font-weight:900}
        .mw-tv-room-note{margin-top:9px;color:#9ea9c8;font-size:14px;font-weight:700}
        .mw-tv-room-meta{margin-top:16px;display:flex;gap:16px;color:#9ea9c8;font-size:14px;font-weight:800}
        .mw-tv-room-meta span{display:flex;align-items:center;gap:7px}
        .mw-tv-room-meta svg{width:17px;height:17px}
        .mw-tv-room-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;border-top:1px solid rgba(132,156,216,.12);padding-top:10px}
        .mw-tv-mini-btn{height:30px;border:1px solid rgba(132,156,216,.18);border-radius:7px;background:rgba(17,31,70,.72);color:#d8e4ff;font-size:12px;font-weight:900}
        .mw-tv-mini-btn.primary{background:rgba(26,116,83,.54);color:#bdf7d4}
        .mw-tv-mini-btn.danger{background:rgba(112,44,55,.48);color:#ffd0d8}
        .mw-tv-mini-btn:disabled{opacity:.4}
        .mw-tv-side-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px}
        .mw-tv-create{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(132,156,216,.2);border-radius:8px;background:rgba(37,55,104,.5);color:#b9c8f5}
        .mw-tv-create svg{width:17px;height:17px}
        .mw-tv-side-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
        .mw-tv-action{height:40px;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid rgba(132,156,216,.18);border-radius:9px;background:rgba(17,31,70,.72);color:#d8e4ff;font-weight:900}
        .mw-tv-action svg{width:16px;height:16px}
        .mw-tv-action.primary{background:rgba(26,116,83,.54);color:#bdf7d4}
        .mw-tv-action.presentation{grid-column:1/-1;background:linear-gradient(180deg,rgba(56,130,214,.86),rgba(37,92,165,.92));border-color:rgba(106,171,255,.34);color:#eef7ff}
        .mw-tv-action.danger{background:rgba(112,44,55,.48);color:#ffd0d8}
        .mw-tv-action:disabled{opacity:.42}
        .mw-tv-footer{height:56px;margin-top:16px;border:1px solid rgba(132,156,216,.14);border-radius:9px;background:rgba(16,29,67,.68);display:flex;align-items:center;justify-content:space-between;padding:0 28px;color:#9ea9c8;font-size:14px;font-weight:800}
        .mw-tv-footer-left{display:flex;gap:36px;align-items:center}
        .mw-tv-dot{display:inline-block;width:12px;height:12px;border-radius:50%;background:#25df8f;margin-right:10px;box-shadow:0 0 16px rgba(37,223,143,.65)}
        .mw-tv-version{display:flex;align-items:center;gap:9px}
        .mw-tv-version:before{content:"";display:block;width:4px;height:14px;border-radius:999px;background:#9d5cff}
      </style>
      <div class="mw-tv" data-room-broadcast="layout">
        <div class="mw-tv-top">
          <div class="mw-tv-brand">
            <div class="mw-tv-brand-mark">${svgIcon('effect')}</div>
            <div>
              <div class="mw-tv-brand-title">MAGIC WAND</div>
              <div class="mw-tv-brand-sub">大屏游戏系统</div>
            </div>
          </div>
          <div class="mw-tv-statusbar">
            <div class="mw-tv-status-cell">
              <div class="mw-tv-label">当前房间</div>
              <div class="mw-tv-room-title">${escapeHtml(room?.name || '未命名房间')}</div>
              <div class="mw-tv-room-desc">${escapeHtml(room?.notes || room?.template_name || '多人寻宝混战')}</div>
            </div>
            <div class="mw-tv-status-cell">
              <div class="mw-tv-label">游戏状态</div>
              <div class="mw-tv-badge ${statusClass}">${escapeHtml(statusText)}</div>
            </div>
            <div class="mw-tv-status-cell">
              <div class="mw-tv-label">${roomCountdown ? '倒计时' : '当前时长'}</div>
              <div class="mw-tv-timebox">${escapeHtml(timeText)}</div>
            </div>
            <div class="mw-tv-status-cell">
              <div class="mw-tv-label">当前时间</div>
              <div class="mw-tv-now">${escapeHtml(nowText)}</div>
            </div>
          </div>
        </div>

        <div class="mw-tv-main">
          <div>
            <div class="mw-tv-panel">
              <div class="mw-tv-tabs">
                <div class="mw-tv-tab is-active">${svgIcon('device')}个人排行榜</div>
                <div class="mw-tv-tab">${svgIcon('group')}组排行榜</div>
              </div>
              <div class="mw-tv-grid">
                <div class="mw-tv-card mw-tv-ranking">
                  <div class="mw-tv-podiums">${podiumCards}</div>
                  <div class="mw-tv-table">
                    <div class="mw-tv-table-head"><span>排名</span><span>玩家</span><span>所属组</span><span>${escapeHtml(runtimeVerb)}次数</span><span>积分</span></div>
                    ${tableRows}
                  </div>
                  <div class="mw-tv-participants">共 ${escapeHtml(participantCount)} 名源组玩家参与 · 目标设备 ${escapeHtml(targetDevices.length)} 个</div>
                </div>
                <div class="mw-tv-card mw-tv-events">
                  <div class="mw-tv-card-title"><b>最新${escapeHtml(runtimeVerb)}</b><span>实时播报</span></div>
                  ${latest ? `
                    <div class="mw-tv-event">
                      <div class="mw-tv-event-time">${escapeHtml(formatClockTime(latest.event_ms))}</div>
                      <div class="mw-tv-event-main"><b>${escapeHtml(latest.line || formatRuntimeDiscovery(latest, room))}</b></div>
                      <div class="mw-tv-event-sub">${escapeHtml(groupLabelFromMask(latest.self_group_mask))} -> ${escapeHtml(groupLabelFromMask(latest.peer_group_mask))} · RSSI ${escapeHtml(latest.rssi)} dBm · +1 分</div>
                    </div>
                  ` : `<div class="mw-tv-event-empty">等待${escapeHtml(runtimeVerb)}事件</div>`}
                  <div class="mw-tv-card-title" style="margin-top:18px"><b>事件记录</b><span>${escapeHtml(runtimeSummary.discoveries.length)} 条</span></div>
                  ${discoveryRows}
                </div>
              </div>
            </div>

            <div class="mw-tv-panel mw-tv-groups">
              <div class="mw-tv-section-title">${svgIcon('group')}组排行榜</div>
              <div class="mw-tv-group-grid">${groupCards}</div>
            </div>
          </div>

          <aside class="mw-tv-panel mw-tv-side" data-room-broadcast="side">
            <div class="mw-tv-side-head">
              <div class="mw-tv-side-title">${svgIcon('room')}房间列表</div>
              <button class="mw-tv-create" type="button" title="创建新房间" data-action="open-wizard">${svgIcon('plus')}</button>
            </div>
            ${roomCards}
            <div class="mw-tv-side-actions">
              <button class="mw-tv-action presentation" type="button" data-action="toggle-room-presentation">${svgIcon('eye')} ${state.roomPresentationMode ? '退出大屏' : '展示大屏'}</button>
              <button class="mw-tv-action" type="button" data-action="load-controller">读取状态</button>
              <button class="mw-tv-action" type="button" data-action="scan-devices">扫描设备</button>
              <button class="mw-tv-action" type="button" data-action="room-open-wizard" data-room-id="${escapeHtml(room?.id || '')}" ${room ? '' : 'disabled'}>${room?.status === 'draft' ? '编辑房间' : '查看房间'}</button>
              <button class="mw-tv-action" type="button" data-action="refresh-records">刷新记录</button>
              <button class="mw-tv-action" type="button" data-action="prepare-room" ${canPrepare ? '' : 'disabled'}>${prepareBusy ? '预备中' : room?.status === 'published' ? '重新预备' : '设备预备'}</button>
              ${roomCountdown
                ? `<button class="mw-tv-action danger" type="button" data-action="cancel-room-countdown">取消倒计时</button>`
                : `<button class="mw-tv-action primary" type="button" data-action="start-room" ${room?.status === 'published' ? '' : 'disabled'}>开始游戏</button>`}
              <button class="mw-tv-action danger" type="button" data-action="stop-room" ${room?.status === 'running' ? '' : 'disabled'}>停止游戏</button>
              <button class="mw-tv-action danger" type="button" data-action="delete-room" data-room-id="${escapeHtml(room?.id || '')}" ${room && room.status !== 'running' ? '' : 'disabled'}>删除房间</button>
              <button class="mw-tv-action" type="button" data-action="toggle-room-sort">${sortOrder === 'asc' ? '正序' : '倒序'}</button>
            </div>
          </aside>
        </div>

        <div class="mw-tv-footer">
          <div class="mw-tv-footer-left">
            <span><i class="mw-tv-dot"></i>${state.controllerOnline ? '系统连接正常' : '控制端未连接'}</span>
            <span>设备在线：${escapeHtml(onlineCount)} / 已扫描 ${escapeHtml(retainedCount)}</span>
            <span>${validation.issues.length ? escapeHtml(validation.issues[0]) : '房间配置可用'}</span>
          </div>
          <div class="mw-tv-version">Magic Wand 游戏系统 ${escapeHtml(appReleaseVersion())}</div>
        </div>
      </div>
    `;
  }

 function renderRoomPage() {
   return renderBroadcastRoomPanelV2();
  }

  function renderTemplatesPage() {
    const templates = state.localState.templates || [];
    const builtinTemplatesList = templates.filter((item) => item.builtIn === true);
    const userTemplatesList = templates.filter((item) => !item.builtIn);
    return `
      <div class="page-section-head">
        <div>
          <h3>玩法预设</h3>
          <p>这里管理的是本局玩法模板。默认模板和用户模板分开显示；模板只决定玩法逻辑，具体的源组和目标组在游戏房间里选择。</p>
        </div>
        <div class="pill-actions">
          ${makePill('默认模板只读', true)}
          ${makePill('用户模板可编辑')}
          ${makePill('先选模板再开局')}
        </div>
      </div>
      <div class="page-section-body">
        <div class="stack-col">
          <div class="mini-panel">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4>默认模板</h4>
                <div class="mt-1 text-[11px] leading-[1.5] text-[#9db0c8]">这些是系统自带的关键玩法模板，只能创建房间，不能删除。</div>
              </div>
            </div>
            <div class="mt-3 grid gap-3 overflow-x-auto pb-1" style="grid-template-columns:repeat(4,minmax(240px,1fr));gap:10px;align-items:start;">
              ${builtinTemplatesList.map((item) => renderTemplateCard(item, { mode: 'builtin' })).join('')}
            </div>
          </div>

          <div class="mini-panel">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4>我的模板</h4>
                <div class="mt-1 text-[11px] leading-[1.5] text-[#9db0c8]">用户自己创建的模板可以编辑、创建房间和删除。</div>
              </div>
              <div class="pill-actions">
                <button class="ghost-btn" type="button" data-action="create-template">${svgIcon('plus')}新建我的模板</button>
              </div>
            </div>
            <div class="mt-3 grid gap-3 overflow-x-auto pb-1" style="grid-template-columns:repeat(4,minmax(240px,1fr));gap:10px;align-items:start;">
              ${userTemplatesList.length ? userTemplatesList.map((item) => renderTemplateCard(item, { mode: 'user' })).join('') : '<div class="notice">还没有我的模板。可以先点击右上角“新建我的模板”。</div>'}
            </div>
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
    const effect = selectedEffectPreset() || state.localState.effect_presets?.[0] || null;
    return `
      <div class="mini-panel">
        <h4>灯效概览</h4>
        ${effect ? renderPreviewBars(effect, { showControls: false, compact: true }) : '<div class="notice">暂无我的灯效。</div>'}
      </div>
    `;
  }

  function renderRoomPrepareModal() {
    const modal = state.roomPrepareModal;
    if (!modal) return '';
    const room = roomById(modal.roomId) || currentRoom();
    const audit = roomPreparationAudit(room);
    const devices = audit.devices.map(devicePrepareViewItem);
    const stale = devices.filter((item) => !item.online && item.retained);
    const offline = devices.filter((item) => !item.retained);
    const onlineCount = devices.filter((item) => item.online).length;
    const runtimeRows = roomRuntimeEffectDiagnostics(room);
    const busy = !!state.busy.publish || !!state.busy.testEffect || !!state.preparingRoomId;
    const stopBusy = !!state.busy.stopEffect;
    return `
      <div class="fixed inset-0 z-[150] flex items-center justify-center bg-[rgba(3,6,12,0.88)] px-4 py-8 backdrop-blur-[3px]">
        <div class="w-full overflow-auto rounded-[20px] border border-[rgba(103,130,169,0.42)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.72)]" data-room-prepare-scroll-root style="width:min(800px,calc(100vw - 48px));max-height:calc(100vh - 64px);background:#0d1520;">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="m-0 text-[18px] font-extrabold leading-none text-white">设备预备检查</h3>
              <p class="mt-1.5 text-[12px] leading-[1.55] text-[#aabbd1]">当前房间「${escapeHtml(modal.roomName || '未命名房间')}」参与设备 ${devices.length} 台，在线 ${onlineCount} 台，需扫描确认 ${stale.length} 台，离线 ${offline.length} 台。</p>
            </div>
            <div class="flex shrink-0 flex-wrap justify-end gap-2">
              <button class="ghost-btn bg-[linear-gradient(180deg,rgba(74,171,255,0.96),rgba(56,132,214,0.98))] text-white ${busy ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="confirm-room-prepare" ${busy ? 'disabled' : ''}>${busy ? '正在下发...' : '下发预备'}</button>
              <button class="ghost-btn" type="button" data-action="cancel-room-prepare">返回检查</button>
            </div>
          </div>
          <div class="mt-4 rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.55] text-[#99acc5]">
            设备预备会把本局配置下发到设备。扫描结果会保留，若设备显示“需扫描确认”，请点“再次扫描”确认现场状态。
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            ${makeChip(`参与设备 ${devices.length}`, true)}
            ${makeChip(`在线 ${onlineCount}`)}
            ${makeChip(`需扫描确认 ${stale.length}`)}
            ${makeChip(`离线 ${offline.length}`)}
            ${makeChip(`分组 ${(Array.isArray(audit.groupIds) ? audit.groupIds : []).length}`)}
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <button class="ghost-btn bg-[linear-gradient(180deg,rgba(74,171,255,0.96),rgba(56,132,214,0.98))] text-white ${busy ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="confirm-room-prepare" ${busy ? 'disabled' : ''}>${busy ? '正在下发...' : '下发预备'}</button>
            <button class="ghost-btn ${busy || state.busy.scan ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="scan-devices" ${busy || state.busy.scan ? 'disabled' : ''}>${state.busy.scan ? '扫描中...' : '再次扫描'}</button>
            <button class="ghost-btn ${state.busy.identify || !devices.length ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="identify-room-devices" data-room-id="${escapeHtml(modal.roomId || '')}" ${state.busy.identify || !devices.length ? 'disabled' : ''}>${svgIcon('device')}点名参与设备</button>
            <button class="ghost-btn bg-[linear-gradient(180deg,rgba(126,91,255,0.96),rgba(82,116,235,0.98))] text-white ${busy ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="test-room-effects" ${busy ? 'disabled' : ''}>${state.busy.testEffect ? '测试中...' : '测试效果'}</button>
            <button class="ghost-btn border-[rgba(255,142,142,0.34)] bg-[rgba(58,24,28,0.96)] text-[#ffd0d0] ${stopBusy ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="stop-room-test-effects" ${stopBusy ? 'disabled' : ''}>${stopBusy ? '停止中...' : '停止测试/熄灭'}</button>
          </div>
          <div class="mt-3 rounded-[16px] border border-[rgba(126,91,255,0.24)] bg-[rgba(14,20,34,0.9)] p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div class="text-[12px] font-extrabold text-white">本次下发灯效诊断</div>
                <div class="mt-1 text-[10.5px] leading-[1.45] text-[#91a6c2]">这里显示接收端实际收到的短指令。测试效果会播放“触发灯效”，不是待机灯效。</div>
              </div>
              ${makePill(`${escapeHtml(triggerCompareLabel(room?.trigger_compare))} ${escapeHtml(normalizeNumber(room?.trigger_signal_rssi, DEFAULT_TRIGGER_RSSI))} dBm / ${escapeHtml(normalizeNumber(room?.trigger_hold_ms, 2000))} ms`, true)}
            </div>
            <div class="mt-3 grid gap-2">
              ${runtimeRows.map((row) => `
                <div class="rounded-[14px] border border-[rgba(88,116,154,0.18)] bg-[rgba(8,13,22,0.72)] px-3 py-2.5">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="text-[12px] font-extrabold text-white">${escapeHtml(row.group_name)} <span class="text-[10.5px] text-[#9fb2c8]">/ ${escapeHtml(row.role_label)}</span></div>
                      <div class="mt-1 text-[10.5px] leading-[1.45] text-[#8ea3bf]">设备：${escapeHtml(row.devices.join(' / ') || '本组暂无设备')}</div>
                    </div>
                    ${makePill(`触发 ${row.trigger.name}`, true)}
                  </div>
                  <div class="mt-2 grid gap-2 md:grid-cols-2">
                    <div class="rounded-[12px] border border-[rgba(88,116,154,0.14)] bg-[rgba(18,25,36,0.66)] px-2.5 py-2">
                      <div class="text-[10.5px] font-bold text-[#b7c9df]">待机灯效：${escapeHtml(row.idle.name)}</div>
                      <code class="mt-1 block break-all text-[10px] leading-[1.45] text-[#7fb8ff]">${escapeHtml(row.idle.spec)}</code>
                    </div>
                    <div class="rounded-[12px] border border-[rgba(88,116,154,0.14)] bg-[rgba(18,25,36,0.66)] px-2.5 py-2">
                      <div class="text-[10.5px] font-bold text-[#b7c9df]">触发灯效：${escapeHtml(row.trigger.name)}</div>
                      <code class="mt-1 block break-all text-[10px] leading-[1.45] text-[#d8a1ff]">${escapeHtml(row.trigger.spec)}</code>
                    </div>
                  </div>
                  ${row.warnings.length ? `<div class="mt-2 rounded-[10px] border border-[rgba(255,193,87,0.22)] bg-[rgba(255,193,87,0.08)] px-2.5 py-2 text-[10.5px] leading-[1.5] text-[#ffd68a]">${row.warnings.map((warning) => escapeHtml(warning)).join('<br>')}</div>` : ''}
                </div>
              `).join('') || '<div class="notice">当前房间还没有可下发的运行分组。</div>'}
            </div>
          </div>
          <div class="mt-3 grid gap-2">
            ${devices.map((item) => `
              <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.9)] px-3 py-2.5">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-[12px] font-extrabold text-white">${escapeHtml(item.name || item.mac || '未知设备')}</div>
                    <div class="mt-1 text-[11px] leading-[1.45] text-[#9fb2c8]">${escapeHtml(item.mac || '')}</div>
                  </div>
                  <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    ${makePill(item.status || (item.online ? '在线' : item.retained ? '需扫描确认' : '离线'), item.online)}
                    ${normalizeNumber(item.idx, -1) >= 0 ? `<button class="table-btn" type="button" data-action="identify-device" data-idx="${escapeHtml(item.idx)}">${svgIcon('device')}点名</button>` : ''}
                  </div>
                </div>
                <div class="mt-2 text-[11px] leading-[1.5] text-[#b8c7da]">所属分组：${escapeHtml((Array.isArray(item.groups) ? item.groups : []).join(' / ') || '无')}</div>
                <div class="mt-1 text-[11px] leading-[1.5] text-[#8ea3bf]">RSSI ${escapeHtml(normalizeNumber(item.rssi, 0))} dBm · 上次扫描 ${escapeHtml(formatAgo(item.seen_ms))}</div>
              </div>
            `).join('') || '<div class="notice">当前房间选择了分组，但这些分组里还没有设备。请先到设备页给设备分组。</div>'}
          </div>
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <button class="ghost-btn ${busy ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="cancel-room-prepare" ${busy ? 'disabled' : ''}>取消预备</button>
            <button class="ghost-btn bg-[linear-gradient(180deg,rgba(74,171,255,0.96),rgba(56,132,214,0.98))] text-white ${busy ? 'opacity-45 pointer-events-none' : ''}" type="button" data-action="confirm-room-prepare" ${busy ? 'disabled' : ''}>${busy ? '正在下发...' : '下发预备'}</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderRoomCountdownOverlay() {
    const countdown = state.roomStartCountdown;
    if (!countdown) return '';
    const room = roomById(countdown.roomId) || currentRoom();
    const remaining = clamp(normalizeNumber(countdown.remaining, 0), 0, 10);
    return `
      <div class="fixed inset-0 z-[155] flex items-center justify-center bg-[rgba(3,6,12,0.9)] px-4 py-8 backdrop-blur-[4px]">
        <div class="w-full rounded-[24px] border border-[rgba(103,130,169,0.42)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.78)]" style="width:min(760px,calc(100vw - 40px));background:#0d1520;">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="m-0 text-[20px] font-extrabold leading-none text-white">开始游戏倒计时</h3>
              <p class="mt-1.5 text-[12px] leading-[1.55] text-[#aabbd1]">房间「${escapeHtml(room?.name || '未命名房间')}」即将在倒计时结束后开始。你可以随时取消。</p>
            </div>
            <button class="ghost-btn" type="button" data-action="cancel-room-countdown">取消开始</button>
          </div>
          <div class="mt-5 flex items-center justify-center rounded-[22px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.72)] py-8">
            <div class="text-center">
              <div class="text-[56px] font-black leading-none text-[#f7fbff]">${escapeHtml(remaining)}</div>
              <div class="mt-2 text-[13px] font-bold text-[#9db0c8]">秒后开始</div>
            </div>
          </div>
          <div class="mt-4 text-[11px] leading-[1.55] text-[#99acc5]">
            倒计时结束后，系统会向控制端发送开始命令。取消后会回到已预备、未开始状态。
          </div>
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <button class="ghost-btn" type="button" data-action="cancel-room-countdown">取消开始</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderRoomFinalizeModal() {
    const modal = state.roomFinalizeModal;
    if (!modal) return '';
    const room = modal.room || currentRoom();
    const missing = Array.isArray(modal.missingDevices) ? modal.missingDevices : [];
    const stats = Array.isArray(modal.stats) ? modal.stats : [];
    return `
      <div class="fixed inset-0 z-[156] flex items-center justify-center bg-[rgba(3,6,12,0.9)] px-4 py-8 backdrop-blur-[4px]">
        <div class="w-full rounded-[24px] border border-[rgba(103,130,169,0.42)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.78)]" style="width:min(820px,calc(100vw - 40px));background:#0d1520;">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="m-0 text-[20px] font-extrabold leading-none text-white">场次汇总</h3>
              <p class="mt-1.5 text-[12px] leading-[1.55] text-[#aabbd1]">房间「${escapeHtml(room?.name || '未命名房间')}」已结束。你可以先看汇总，再决定是否继续刷新控制端结果。</p>
            </div>
            <button class="ghost-btn" type="button" data-action="room-finalize-ignore">完成汇总</button>
          </div>
          <div class="mt-4 grid gap-3 md:grid-cols-3">
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] p-3">
              <div class="text-[11px] font-bold text-[#c7d5eb]">当前得分</div>
              <div class="mt-1 text-[26px] font-black leading-none text-white">${escapeHtml(modal.scoreTotal ?? 0)}</div>
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] p-3">
              <div class="text-[11px] font-bold text-[#c7d5eb]">已汇总设备</div>
              <div class="mt-1 text-[26px] font-black leading-none text-white">${escapeHtml(stats.length)}</div>
            </div>
            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] p-3">
              <div class="text-[11px] font-bold text-[#c7d5eb]">待汇总设备</div>
              <div class="mt-1 text-[26px] font-black leading-none text-white">${escapeHtml(missing.length)}</div>
            </div>
          </div>
          <div class="mt-4 rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] p-3">
            <div class="text-[11px] font-bold text-[#c7d5eb]">最新发现</div>
            <div class="mt-1 text-[12px] leading-[1.55] text-[#dbe5f6]">${escapeHtml(modal.latestLine || '暂无发现记录。')}</div>
          </div>
          <div class="mt-4 rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] p-3">
            <div class="text-[11px] font-bold text-[#c7d5eb]">待汇总设备</div>
            <div class="mt-2 grid gap-2">
              ${missing.length ? missing.map((item) => `
                <div class="rounded-[14px] border border-[rgba(88,116,154,0.16)] bg-[rgba(18,25,36,0.72)] px-3 py-2">
                  <div class="text-[12px] font-extrabold text-white">${escapeHtml(item.device?.name || item.device?.mac || '未知设备')}</div>
                  <div class="mt-1 text-[10.5px] leading-[1.45] text-[#95a8c2]">${escapeHtml(item.device?.mac || '')}</div>
                </div>
              `).join('') : '<div class="text-[11px] leading-[1.55] text-[#8ea3bf]">全部设备都已经汇总。</div>'}
            </div>
          </div>
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <button class="ghost-btn" type="button" data-action="room-finalize-refresh">重新汇总</button>
            <button class="ghost-btn bg-[linear-gradient(180deg,rgba(74,171,255,0.96),rgba(56,132,214,0.98))] text-white" type="button" data-action="room-finalize-ignore">忽略并完成</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderTemplateDialogs() {
    const form = state.templateFormModal ? ensureTemplateFormModal() : null;
    if (!form) return '';
    const featureOptions = (state.localState.feature_presets || []).map((preset) => `<option value="${escapeHtml(preset.id)}" ${String(form.feature_preset_id || '') === String(preset.id) ? 'selected' : ''}>${escapeHtml(preset.name)}</option>`).join('');
    const effectOptions = effectChoiceOptions(form.idle_effect_id);
    const triggerEffectOptions = effectChoiceOptions(form.trigger_effect_id);
    const scoringOptions = [
      { value: 'count_find', label: '寻宝计分' },
      { value: 'shared_count', label: '组共享计分' },
      { value: 'rssi_probe', label: '距离测试' },
      { value: 'demo', label: '灯效演示' }
    ].map((item) => `<option value="${escapeHtml(item.value)}" ${String(form.scoring_mode || 'count_find') === item.value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
    const step = clamp(normalizeNumber(form.step, 1), 1, 2);
    const isEdit = String(form.templateId || '').trim();
    return `
      <div class="fixed inset-0 z-[128] flex items-center justify-center bg-[rgba(3,6,12,0.88)] px-4 py-8 backdrop-blur-[3px]">
        <div class="w-full overflow-auto rounded-[20px] border border-[rgba(103,130,169,0.42)] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.72)]" style="width:min(800px,calc(100vw - 48px));max-height:calc(100vh - 64px);background:#0d1520;">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="m-0 text-[18px] font-extrabold leading-none text-white">${isEdit ? '编辑我的模板' : '新建我的模板'}</h3>
              <p class="mt-1.5 text-[12px] leading-[1.55] text-[#aabbd1]">两步填写：先写名称和备注，再设置玩法功能、灯效预设和单/多角色模式。保存后会自动关闭。</p>
            </div>
            <button class="ghost-btn" type="button" data-action="cancel-template-form">关闭</button>
          </div>

          <div class="mt-4 grid gap-2 sm:grid-cols-2">
            <div class="${['rounded-[16px] border px-3 py-2.5 text-left transition', step === 1 ? 'border-transparent bg-[linear-gradient(180deg,rgba(64,119,208,0.92),rgba(45,89,163,0.96))] shadow-[0_12px_24px_rgba(0,0,0,0.18)]' : 'border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)]'].join(' ')}">
              <div class="text-[11px] font-extrabold text-white">1. 名称与备注</div>
              <div class="mt-1 text-[10.5px] leading-[1.4] ${step === 1 ? 'text-[#ecf4ff]/88' : 'text-[#92a6c3]'}">先给模板起名，后面好找。</div>
            </div>
            <div class="${['rounded-[16px] border px-3 py-2.5 text-left transition', step === 2 ? 'border-transparent bg-[linear-gradient(180deg,rgba(64,119,208,0.92),rgba(45,89,163,0.96))] shadow-[0_12px_24px_rgba(0,0,0,0.18)]' : 'border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)]'].join(' ')}">
              <div class="text-[11px] font-extrabold text-white">2. 玩法参数</div>
              <div class="mt-1 text-[10.5px] leading-[1.4] ${step === 2 ? 'text-[#ecf4ff]/88' : 'text-[#92a6c3]'}">配置模板的通用玩法逻辑。</div>
            </div>
          </div>
          <div class="mt-3 rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.55] text-[#99acc5]">
            这里保存的是模板的通用玩法，不保存具体房间的成员名单；空闲灯效和触发灯效可以在游戏房间里单独覆盖。
          </div>

          ${step === 1 ? `
            <div class="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div class="field">
                <label>模板名称</label>
                <input class="fake-input" data-role="template-form-input" data-template-form-field="name" value="${escapeHtml(form.name || '')}" placeholder="例如：我的魔杖模式">
              </div>
              <div class="field">
                <label>模板备注</label>
                <textarea class="fake-input" data-role="template-form-input" data-template-form-field="note" style="min-height:112px;resize:vertical" placeholder="写一点用途说明，方便后面快速复用">${escapeHtml(form.note || '')}</textarea>
              </div>
            </div>
          ` : `
            <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div class="field"><label>玩法预设</label><select class="fake-select" data-role="template-form-input" data-template-form-field="feature_preset_id">${featureOptions}</select></div>
              <div class="field"><label>感应模式</label><select class="fake-select" data-role="template-form-input" data-template-form-field="sense_mode"><option value="ring" ${String(form.sense_mode || 'ring') === 'ring' ? 'selected' : ''}>轮巡</option><option value="shared" ${String(form.sense_mode || '') === 'shared' ? 'selected' : ''}>组共享</option><option value="response" ${String(form.sense_mode || '') === 'response' ? 'selected' : ''}>纯响应</option></select><div class="mt-1 text-[10.5px] leading-[1.45] text-[#8fa3c1]">轮巡：每个组里的人都可以依次找到，找到后先停留约 2 秒再触发灯效；触发后本人不能再次触发。组共享：每个组里只要有一个人找到，先停留约 2 秒再触发灯效；触发后本组所有人都不能再次触发。纯响应：任何人都可以找到，先停留约 2 秒再触发灯效；触发后仍然可以重复触发。</div></div>
              <div class="field"><label>源组（单个 / 多个）</label><select class="fake-select" data-role="template-form-input" data-template-form-field="source_group_mode"><option value="single" ${roleModeValue(form.source_group_mode) === 'single' ? 'selected' : ''}>单个</option><option value="multi" ${roleModeValue(form.source_group_mode) === 'multi' ? 'selected' : ''}>多个</option></select></div>
              <div class="field"><label>目标组（单个 / 多个）</label><select class="fake-select" data-role="template-form-input" data-template-form-field="target_group_mode"><option value="single" ${roleModeValue(form.target_group_mode) === 'single' ? 'selected' : ''}>单个</option><option value="multi" ${roleModeValue(form.target_group_mode) === 'multi' ? 'selected' : ''}>多个</option></select></div>
              <div class="field"><label>空闲灯效</label><select class="fake-select" data-role="template-form-input" data-template-form-field="idle_effect_id">${effectOptions}</select><div class="mt-1 text-[10.5px] leading-[1.45] text-[#8fa3c1]">这里选玩法默认待机时用的灯效，进房间后可以单独覆盖。</div></div>
              <div class="field"><label>触发灯效</label><select class="fake-select" data-role="template-form-input" data-template-form-field="trigger_effect_id">${triggerEffectOptions}</select><div class="mt-1 text-[10.5px] leading-[1.45] text-[#8fa3c1]">这里选玩法默认触发时用的灯效，进房间后可以单独覆盖。</div></div>
              <div class="field"><label>计分模式</label><select class="fake-select" data-role="template-form-input" data-template-form-field="scoring_mode">${scoringOptions}</select></div>
              <div class="field"><label>最大计数</label><input class="fake-input" data-role="template-form-input" data-template-form-field="scoring_max_find" value="${escapeHtml(form.scoring_max_find ?? 0)}"></div>
            </div>
          `}

          <div class="mt-4 flex flex-wrap justify-end gap-2">
            ${step > 1 ? `<button class="ghost-btn" type="button" data-action="template-form-prev-step">${svgIcon('arrow')}上一步</button>` : ''}
            <button class="ghost-btn" type="button" data-action="cancel-template-form">取消</button>
            ${step < 2 ? `<button class="ghost-btn" type="button" data-action="template-form-next-step">${svgIcon('arrow')}下一步</button>` : `<button class="ghost-btn" type="button" data-action="save-template-form">${svgIcon('save')}保存</button>`}
          </div>
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
    syncRoomEffectRules(room);
    const step = wizardState().step;
    const templateSourceMode = roleModeValue(template.source_group_mode || (Array.isArray(template.default_source_group_ids) && template.default_source_group_ids.length > 1 ? 'multi' : 'single'));
    const templateTargetMode = roleModeValue(template.target_group_mode || (Array.isArray(template.default_target_group_ids) && template.default_target_group_ids.length > 1 ? 'multi' : 'single'));
    const templateSenseText = template.sense_mode || '未设置';
    const templateIdleEffectText = effectNameById(template.idle_effect_id || 'builtin-silent');
    const templateTriggerEffectText = effectNameById(template.trigger_effect_id || 'builtin-blink');
    const playPreset = activePlayPresetForRoom(room);
    const effectiveRule = roomEffectiveRuleConfig(room, playPreset);
    const roomSignal = ruleSignalDefaultsForRoom(room, playPreset);
    const roomSignalCompare = ruleSignalCompareForUi(roomSignal);
    const roomTrigger = effectiveRule.trigger || {};
    const roomScore = effectiveRule.score || {};
    const roomRepeat = effectiveRule.repeat || {};
    const roomAfter = effectiveRule.afterTrigger || {};
    const roomMeter = effectiveRule.feedback?.signalMeter || {};
    const sourceDevicesForBinding = roomBindingCandidates(room, 'source');
    const targetDevicesForBinding = roomBindingCandidates(room, 'target');
    const needsPairBinding = roomUsesSpecifiedPair(room);
    if (needsPairBinding) syncRoomMatchBindings(room);
    const templateScoreText = template.scoring && typeof template.scoring === 'object' && template.scoring.mode
      ? String(template.scoring.mode)
      : '未设置';
    const playPresetRelationText = `${relationModeLabel(playPreset?.relation?.mode)} / ${matchModeLabel(playPreset?.relation?.match)}`;
    const ruleScoreText = scoreSummaryText(roomScore);
    const sourceIdleEffectText = roomEffectFieldSummary(room, 'source_idle_effect_id', room.idle_effect_id || template.idle_effect_id || 'builtin-silent');
    const sourceTriggerEffectText = roomEffectFieldSummary(room, 'source_trigger_effect_id', room.trigger_effect_id || template.trigger_effect_id || 'builtin-blink');
    const targetIdleEffectText = roomEffectFieldSummary(room, 'target_idle_effect_id', 'builtin-silent');
    const targetTriggerEffectText = roomEffectFieldSummary(room, 'target_trigger_effect_id', room.trigger_effect_id || template.trigger_effect_id || 'builtin-blink');
    const selectedDeviceCount = roomSelectedDevices(room).length;
    const steps = [
      {
        key: 'room',
        label: '房间信息',
        desc: '先给这一局起一个名字，方便后面统计和回放。',
        icon: 'room',
      },
      {
        key: 'template',
        label: '选择玩法',
        desc: '从玩法预设里挑一个作为本局规则起点；本局参数可以单独覆盖。',
        icon: 'copy',
      },
      {
        key: 'groups',
        label: '设备分配',
        desc: '只绑定本局参与的源组和目标组，不改底层规则。',
        icon: 'group',
      },
      {
        key: 'rules',
        label: '本局规则',
        desc: '本局可以覆盖 RSSI、触发模式、计分对象和重复规则，不会改掉玩法预设本身。',
        icon: 'gear',
      },
      {
        key: 'binding',
        label: '配对 / 归属',
        desc: '按玩法需要设置指定配对，或查看竞争归属的固定判定方式。',
        icon: 'device',
      },
      {
        key: 'effects',
        label: '灯效矩阵',
        desc: '为每个源组和目标组的组合设置空闲灯效与触发灯效，并可直接预览。',
        icon: 'effect',
          },
      {
        key: 'confirm',
        label: '确认保存',
        desc: '最后检查一次摘要，确认后保存为本地房间草稿。',
        icon: 'save',
      }
    ];
    const summaryGroups = (ids) => {
      const names = ids.map((gid) => groupNameById(gid));
      return names.length ? names.join(' / ') : '未选择';
    };
    const roomNameMissing = !String(room.name || '').trim();
    const selectedTemplateSelected = template.id === state.selectedTemplateId;
    const wizardSaveDisabled = step >= WIZARD_STEP_MAX && roomNameMissing;
    const wizardSaveDisabledClass = wizardSaveDisabled ? 'opacity-45 pointer-events-none' : '';
    const wizardSaveDisabledAttr = wizardSaveDisabled ? 'disabled' : '';
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
      const selectedClass = checked
        ? kind === 'source'
          ? 'border-[#4ba9ff] bg-[linear-gradient(180deg,rgba(26,52,77,0.99),rgba(14,24,36,0.98))] shadow-[0_0_0_1px_rgba(75,169,255,0.24),0_16px_32px_rgba(0,0,0,0.24)] ring-1 ring-inset ring-[rgba(75,169,255,0.18)]'
          : 'border-[#6be29d] bg-[linear-gradient(180deg,rgba(20,46,32,0.99),rgba(12,24,18,0.98))] shadow-[0_0_0_1px_rgba(107,226,157,0.22),0_16px_32px_rgba(0,0,0,0.24)] ring-1 ring-inset ring-[rgba(107,226,157,0.18)]'
        : 'border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] hover:border-[rgba(120,167,224,0.34)]';
      const accentText = checked
        ? (kind === 'source' ? 'text-[#e4f2ff]' : 'text-[#e4ffef]')
        : 'text-[#f3f7ff]';
      const badgeBase = 'inline-flex shrink-0 items-center rounded-full border px-2.5 py-1.25 text-[10px] font-extrabold whitespace-nowrap transition';
      const badgeClass = checked
        ? (kind === 'source'
          ? 'border-[#4ba9ff]/40 bg-[#4ba9ff]/22 text-[#d8ebff]'
          : 'border-[#6be29d]/40 bg-[#6be29d]/22 text-[#dcffe8]')
        : 'border-[rgba(88,116,154,0.26)] bg-[rgba(21,30,43,0.86)] text-[#9fb2c8]';
      return `
        <label class="${[
          'group relative flex cursor-pointer flex-col gap-2 rounded-[16px] border px-3 py-3 text-[12px] text-[#d9e4f3] transition',
          selectedClass
        ].join(' ')}" data-action="${action}" data-gid="${group.id}">
          <input class="peer sr-only" type="checkbox" data-gid="${group.id}" ${checked ? 'checked' : ''}>
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-2.5">
              <span class="min-w-0">
                <span class="${['block truncate font-bold text-[#f3f7ff] transition', accentText].join(' ')}">${escapeHtml(group.name)}</span>
                <span class="mt-0.5 block text-[10.5px] leading-[1.35] text-[#9fb2c8]">${escapeHtml(group.note || '无备注')} · ${groupMemberCount(group.id)} 台设备</span>
              </span>
            </div>
            <span class="${[badgeBase, badgeClass].join(' ')}">${checked ? '已选中' : '点击选择'}</span>
          </div>
        </label>
      `;
    };

    const renderEffectRuleSelect = (rule, field, label) => `
      <label class="min-w-0">
        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">${escapeHtml(label)}</span>
        ${(() => {
          const previewKey = `${roomEffectRuleKey(rule.source_group_id, rule.target_group_id)}:${field}`;
          const previewEffectId = String(rule[field] || '');
          const previewEffect = effectDefinitionById(previewEffectId);
          const previewRows = clamp(Array.isArray(previewEffect?.effect_ui?.tracks) ? previewEffect.effect_ui.tracks.length : 1, 1, EFFECT_TRACK_LIMIT);
          const previewOpen = String(state.roomEffectPreviewKey || '') === previewKey;
          return `
        <div class="flex items-center gap-2">
          <select class="fake-select h-8 min-w-0 flex-1 px-2 text-[11px]" data-role="wizard-effect-rule" data-source-gid="${escapeHtml(rule.source_group_id)}" data-target-gid="${escapeHtml(rule.target_group_id)}" data-rule-field="${escapeHtml(field)}">
            ${effectChoiceOptions(rule[field])}
          </select>
          <button class="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-full border border-[rgba(88,116,154,0.26)] bg-[rgba(18,25,36,0.96)] px-2.5 text-[10px] font-bold whitespace-nowrap text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px" type="button" data-action="preview-room-effect" data-source-gid="${escapeHtml(rule.source_group_id)}" data-target-gid="${escapeHtml(rule.target_group_id)}" data-rule-field="${escapeHtml(field)}" data-effect-id="${escapeHtml(previewEffectId)}">${svgIcon('play')}预览</button>
        </div>
        ${previewOpen ? `
          <div class="mt-1.5 rounded-[12px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.72)] p-2">
            ${renderPreviewBars(previewEffectId, { showControls: false, compact: true, rows: previewRows, previewKind: 'preview', clipOverflow: true })}
          </div>
        ` : ''}
      `;
        })()}
      </label>
    `;

    const batchEffectValue = (field, fallback) => {
      const rules = Array.isArray(room.effect_rules) ? room.effect_rules : [];
      const firstValue = rules.find((rule) => String(rule?.[field] || '').trim())?.[field];
      return String(firstValue || fallback || 'builtin-silent');
    };

    const renderEffectMatrix = () => {
      const rules = Array.isArray(room.effect_rules) ? room.effect_rules : [];
      if (!(Array.isArray(room.source_group_ids) && room.source_group_ids.length) || !(Array.isArray(room.target_group_ids) && room.target_group_ids.length)) {
        return '<div class="rounded-[16px] border border-dashed border-[rgba(88,116,154,0.28)] bg-[rgba(9,14,22,0.68)] px-3 py-5 text-[12px] leading-[1.6] text-[#9fb2c8]">先在上一步选择源组和目标组，然后这里会自动生成灯效矩阵。</div>';
      }
      return (room.target_group_ids || []).map((targetId) => {
        const targetRules = rules.filter((rule) => normalizeNumber(rule.target_group_id, -1) === normalizeNumber(targetId, -1));
        return `
          <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div class="text-[12px] font-extrabold text-white">目标组：${escapeHtml(groupNameById(targetId))}</div>
                <div class="mt-1 text-[11px] leading-[1.45] text-[#9fb2c8]">目标组空闲默认静默；每个源组到这个目标组都可以单独覆盖。若本局启用信号强度指示灯，所选 LED 路会优先显示信号条。</div>
              </div>
              ${makePill(`${targetRules.length} 条规则`, true)}
            </div>
            <div class="mt-3 grid gap-2">
              ${targetRules.map((rule) => `
                <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] p-3">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="text-[12px] font-extrabold text-[#eaf4ff]">${escapeHtml(groupNameById(rule.source_group_id))} <span class="text-[#7ba2cc]">-></span> ${escapeHtml(groupNameById(rule.target_group_id))}</div>
                    ${makeChip('本局规则', true)}
                  </div>
                  <div class="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    ${renderEffectRuleSelect(rule, 'source_idle_effect_id', '源组空闲')}
                    ${renderEffectRuleSelect(rule, 'source_trigger_effect_id', '源组触发')}
                    ${renderEffectRuleSelect(rule, 'target_idle_effect_id', '目标组空闲')}
                    ${renderEffectRuleSelect(rule, 'target_trigger_effect_id', '目标组触发')}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('');
    };

    return `
      <div class="fixed inset-0 z-[80] overflow-auto bg-[rgba(8,13,20,0.94)] px-3 py-3 backdrop-blur-[4px]" data-wizard-scroll-root>
        <div class="mx-auto flex min-h-[calc(100vh-1.5rem)] w-[min(1900px,100%)] flex-col gap-3">
          <section class="rounded-[20px] border border-[rgba(88,116,154,0.26)] bg-[linear-gradient(180deg,rgba(21,30,43,0.98),rgba(16,22,33,0.96))] px-4 py-3.5 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-[19px] leading-none text-[#7ec6ff]">${svgIcon('room')}</span>
                  <div>
                    <h2 class="m-0 text-[19px] font-extrabold leading-[1.08]">向导开局</h2>
                    <p class="mt-1 max-w-[920px] text-[11.5px] leading-[1.5] text-[#c4d1e3]">一步一步创建房间：先填名字，再选玩法预设，然后选设备组、覆盖本局规则、处理配对或归属，最后保存为草稿。玩法预设定义默认规则，房间只负责这一次开局。</p>
                  </div>
                </div>
              </div>
              <div class="flex shrink-0 flex-nowrap items-center justify-end gap-2 overflow-x-auto pb-1">
                <button class="${footerBtnBase} border-[rgba(88,116,154,0.3)] bg-[rgba(24,33,47,0.96)] px-3 text-[#dce8f7]" type="button" data-action="load-controller">${svgIcon('refresh')}读取控制端</button>
                <button class="${footerBtnBase} border-[rgba(88,116,154,0.3)] bg-[rgba(24,33,47,0.96)] px-3 text-[#dce8f7]" type="button" data-action="wizard-close">${svgIcon('pause')}退出向导</button>
              </div>
            </div>
            <div class="mt-4 grid gap-2 overflow-x-auto pb-1 sm:grid-cols-2" style="grid-template-columns:repeat(7,minmax(190px,1fr));">
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
                  ${makePill(`步骤 ${step + 1}/7`, true)}
                  ${makePill(`房间 ${escapeHtml(currentRoomStatusLabel())}`)}
                  ${makePill(`玩法 ${escapeHtml(selectedTemplateName())}`)}
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
                      <button class="inline-flex h-8 min-w-[96px] items-center justify-center gap-1.5 rounded-full border border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] px-3 text-[11px] font-bold leading-none whitespace-nowrap text-[#dbe5f4] transition hover:brightness-105 active:translate-y-px" type="button" data-action="wizard-save-draft">${svgIcon('save')}保存设置</button>
                    </div>
                  </div>
                </section>

                <section class="${step === 1 ? '' : 'hidden'} grid gap-3">
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-[11px] font-bold text-[#c7d5eb]">当前选中玩法</div>
                      <div class="mt-1 text-[15px] font-extrabold leading-[1.1] text-white">${escapeHtml(template.name || '未选择玩法')}</div>
                      <div class="mt-1.5 max-w-[860px] text-[12px] leading-[1.5] text-[#aabbd1]">${escapeHtml(template.note || '无备注')}</div>
                    </div>
                    <div class="flex flex-wrap justify-end gap-2">
                      ${makePill(selectedTemplateSelected ? '已选中' : '当前默认', true)}
                      ${makePill(selectedTemplateSelected ? '可直接开局' : '可点击切换')}
                    </div>
                  </div>
                    <div class="mt-3 flex flex-wrap gap-2">
                      ${makeChip(`关系 ${playPresetRelationText}`)}
                      ${makeChip(triggerSummaryText({ trigger: roomTrigger }))}
                      ${makeChip(ruleScoreText)}
                      ${makeChip(`感应 ${escapeHtml(templateSenseText)}`)}
                      ${makeChip(`空闲 ${escapeHtml(templateIdleEffectText)}`)}
                      ${makeChip(`触发 ${escapeHtml(templateTriggerEffectText)}`)}
                    </div>
                </div>
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div class="text-[11px] font-bold text-[#c7d5eb]">可选玩法预设</div>
                        <div class="mt-1 text-[12px] leading-[1.5] text-[#aabbd1]">点击玩法卡即可切换本局玩法。玩法预设定义规则，设备分组和本局参数在房间里单独设置。</div>
                      </div>
                      ${makePill(`共 ${state.localState.templates.length || 0} 个玩法`, true)}
                    </div>
                    <div class="mt-3 grid gap-2 lg:grid-cols-2">
                      ${renderTemplateCards({ compact: true, showActions: false }) || '<div class="text-[#93a6c2]">暂无玩法预设。</div>'}
                    </div>
                    <div class="mt-3 rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.5] text-[#99acc5]">
                      选中后只作为这次房间的玩法来源。需要改通用默认参数时，到“玩法预设”页基于系统预设新建，或编辑“我的玩法预设”。
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
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5 xl:col-span-2">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div class="text-[11px] font-bold text-[#c7d5eb]">本局规则覆盖</div>
                        <div class="mt-1 text-[12px] leading-[1.5] text-[#aabbd1]">默认继承玩法预设，但只对当前房间生效。同一个玩法可以开多个房间，各自用不同的 RSSI、持续时间和计分规则。</div>
                      </div>
                      ${makePill(triggerConditionText(roomSignalCompare, roomSignal.rssiMin, roomSignal.holdMs), true)}
                    </div>
                    <div class="mt-3 grid gap-2 md:grid-cols-3">
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">RSSI 条件</span>
                        <select class="fake-select h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="signal" data-rule-field="type">
                          <option value="enter_range" ${String(roomSignal.type || 'enter_range') === 'enter_range' ? 'selected' : ''}>进入范围</option>
                          <option value="leave_range" ${String(roomSignal.type || '') === 'leave_range' ? 'selected' : ''}>离开范围</option>
                          <option value="stay_in_range" ${String(roomSignal.type || '') === 'stay_in_range' ? 'selected' : ''}>保持在范围内</option>
                          <option value="appeared" ${String(roomSignal.type || '') === 'appeared' ? 'selected' : ''}>从无到有</option>
                          <option value="lost" ${String(roomSignal.type || '') === 'lost' ? 'selected' : ''}>从有到无</option>
                          <option value="stronger" ${String(roomSignal.type || '') === 'stronger' ? 'selected' : ''}>信号变强</option>
                          <option value="weaker" ${String(roomSignal.type || '') === 'weaker' ? 'selected' : ''}>信号变弱</option>
                        </select>
                      </label>
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">RSSI 下限（dBm）</span>
                        <input class="fake-input h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="signal" data-rule-field="rssiMin" type="number" step="1" value="${escapeHtml(normalizeNumber(roomSignal.rssiMin, DEFAULT_TRIGGER_RSSI))}">
                      </label>
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">RSSI 上限（可空）</span>
                        <input class="fake-input h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="signal" data-rule-field="rssiMax" type="number" step="1" value="${escapeHtml(roomSignal.rssiMax ?? '')}">
                      </label>
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">持续时间（ms）</span>
                        <input class="fake-input h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="signal" data-rule-field="holdMs" type="number" step="50" value="${escapeHtml(normalizeNumber(roomSignal.holdMs, DEFAULT_TRIGGER_HOLD_MS))}">
                      </label>
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">触发模式</span>
                        <select class="fake-select h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="trigger" data-rule-field="mode">
                          <option value="instant" ${String(roomTrigger.mode || 'instant') === 'instant' ? 'selected' : ''}>立即触发</option>
                          <option value="continuous" ${String(roomTrigger.mode || '') === 'continuous' ? 'selected' : ''}>连续达标</option>
                          <option value="accumulate" ${String(roomTrigger.mode || '') === 'accumulate' ? 'selected' : ''}>累计达标</option>
                          <option value="count" ${String(roomTrigger.mode || '') === 'count' ? 'selected' : ''}>次数达标</option>
                          <option value="periodic" ${String(roomTrigger.mode || '') === 'periodic' ? 'selected' : ''}>周期计分</option>
                        </select>
                      </label>
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">目标时间（ms）</span>
                        <input class="fake-input h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="trigger" data-rule-field="targetMs" type="number" step="50" value="${escapeHtml(normalizeNumber(roomTrigger.targetMs, 0))}">
                      </label>
                    </div>
                    <div class="mt-3 grid gap-2 md:grid-cols-3">
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">计分对象</span>
                        <select class="fake-select h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="score" data-rule-field="target">
                          <option value="source_player" ${String(roomScore.target || 'source_player') === 'source_player' ? 'selected' : ''}>源玩家</option>
                          <option value="source_group" ${String(roomScore.target || '') === 'source_group' ? 'selected' : ''}>源小组</option>
                          <option value="target_player" ${String(roomScore.target || '') === 'target_player' ? 'selected' : ''}>目标玩家</option>
                          <option value="target_group" ${String(roomScore.target || '') === 'target_group' ? 'selected' : ''}>目标小组</option>
                          <option value="both_players" ${String(roomScore.target || '') === 'both_players' ? 'selected' : ''}>双方玩家</option>
                          <option value="both_groups" ${String(roomScore.target || '') === 'both_groups' ? 'selected' : ''}>双方小组</option>
                          <option value="none" ${String(roomScore.target || '') === 'none' ? 'selected' : ''}>不计分，只触发灯效</option>
                        </select>
                      </label>
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">分数</span>
                        <input class="fake-input h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="score" data-rule-field="points" type="number" step="1" value="${escapeHtml(normalizeNumber(roomScore.points, 1))}">
                      </label>
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">重复规则</span>
                        <select class="fake-select h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="repeat" data-rule-field="mode">
                          <option value="allow_repeat" ${String(roomRepeat.mode || '') === 'allow_repeat' ? 'selected' : ''}>允许重复</option>
                          <option value="once_per_pair" ${String(roomRepeat.mode || 'once_per_pair') === 'once_per_pair' ? 'selected' : ''}>每对设备只算一次</option>
                          <option value="once_per_target" ${String(roomRepeat.mode || '') === 'once_per_target' ? 'selected' : ''}>每个目标只算一次（实验）</option>
                          <option value="once_per_source" ${String(roomRepeat.mode || '') === 'once_per_source' ? 'selected' : ''}>每个源设备只算一次</option>
                          <option value="cooldown" ${String(roomRepeat.mode || '') === 'cooldown' ? 'selected' : ''}>冷却后可重复</option>
                        </select>
                      </label>
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">冷却（ms）</span>
                        <input class="fake-input h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="repeat" data-rule-field="cooldownMs" type="number" step="50" value="${escapeHtml(normalizeNumber(roomRepeat.cooldownMs, 5000))}">
                      </label>
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">触发后处理</span>
                        <select class="fake-select h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="afterTrigger" data-rule-field="targetState">
                          <option value="none" ${String(roomAfter.targetState || 'none') === 'none' ? 'selected' : ''}>无处理</option>
                          <option value="cooldown" ${String(roomAfter.targetState || '') === 'cooldown' ? 'selected' : ''}>冷却</option>
                          <option value="disabled" ${String(roomAfter.targetState || '') === 'disabled' ? 'selected' : ''}>目标失效（实验）</option>
                          <option value="locked" ${String(roomAfter.targetState || '') === 'locked' ? 'selected' : ''}>目标锁定</option>
                        </select>
                      </label>
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">计时处理</span>
                        <select class="fake-select h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="afterTrigger" data-rule-field="timerAction">
                          <option value="none" ${String(roomAfter.timerAction || 'none') === 'none' ? 'selected' : ''}>无处理</option>
                          <option value="reset" ${String(roomAfter.timerAction || '') === 'reset' ? 'selected' : ''}>计时清零</option>
                          <option value="pause" ${String(roomAfter.timerAction || '') === 'pause' ? 'selected' : ''}>计时暂停</option>
                        </select>
                      </label>
                    </div>
                    <div class="mt-3 rounded-[16px] border border-[rgba(88,116,154,0.22)] bg-[rgba(9,14,22,0.68)] p-3">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div class="text-[12px] font-extrabold text-white">信号强度指示灯</div>
                          <div class="mt-1 text-[11px] leading-[1.5] text-[#9fb2c8]">可选一条 LED 路给寻找者显示最近目标信号强度。寻宝/占点类目标设备不会显示信号条；没有收到目标信号时不亮。</div>
                        </div>
                        <label class="inline-flex items-center gap-2 rounded-full border border-[rgba(88,116,154,0.26)] bg-[rgba(18,25,36,0.9)] px-3 py-2 text-[11px] font-bold text-[#dbe7f8]">
                          <input type="checkbox" class="accent-[#63a6ff]" data-role="wizard-rule-field" data-rule-section="feedback" data-rule-field="meterEnabled" ${roomMeter.enabled === true ? 'checked' : ''}>
                          启用
                        </label>
                      </div>
                      <div class="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                        <label class="min-w-0">
                          <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">LED 路</span>
                          <select class="fake-select h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="feedback" data-rule-field="meterPort">
                            <option value="1" ${normalizeNumber(roomMeter.port, 1) === 1 ? 'selected' : ''}>LED1</option>
                            <option value="2" ${normalizeNumber(roomMeter.port, 1) === 2 ? 'selected' : ''}>LED2</option>
                            <option value="3" ${normalizeNumber(roomMeter.port, 1) === 3 ? 'selected' : ''}>LED3</option>
                          </select>
                        </label>
                        <label class="min-w-0">
                          <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">显示灯珠数</span>
                          <input class="fake-input h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="feedback" data-rule-field="meterLedCount" type="number" min="1" max="200" step="1" value="${escapeHtml(normalizeNumber(roomMeter.ledCount, 10))}">
                        </label>
                        <label class="min-w-0">
                          <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">弱信号 dBm</span>
                          <input class="fake-input h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="feedback" data-rule-field="meterWeakRssi" type="number" step="1" value="${escapeHtml(normalizeNumber(roomMeter.weakRssi, -90))}">
                        </label>
                        <label class="min-w-0">
                          <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">满格信号 dBm</span>
                          <input class="fake-input h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="feedback" data-rule-field="meterStrongRssi" type="number" step="1" value="${escapeHtml(normalizeNumber(roomMeter.strongRssi, normalizeNumber(roomSignal.rssiMin, DEFAULT_TRIGGER_RSSI)))}">
                        </label>
                        <label class="min-w-0">
                          <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">压缩比例</span>
                          <input class="fake-input h-9 w-full px-2 text-[12px]" data-role="wizard-rule-field" data-rule-section="feedback" data-rule-field="meterCompression" type="number" min="20" max="500" step="10" value="${escapeHtml(normalizeNumber(roomMeter.compressionX100, 100))}">
                          <span class="mt-1 block text-[10px] leading-[1.35] text-[#8fa3c1]">100=线性，160=强信号压缩</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </section>

                <section class="${step === 4 ? '' : 'hidden'} grid gap-3">
                  ${needsPairBinding ? `
                    <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                      <div class="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div class="text-[11px] font-bold text-[#c7d5eb]">指定配对</div>
                          <div class="mt-1 text-[12px] leading-[1.5] text-[#aabbd1]">这个玩法要求明确“谁对谁”。每台源设备都需要指定一个目标设备，控制端和接收端会按这份配对表运行。</div>
                        </div>
                        ${makePill(`源设备 ${sourceDevicesForBinding.length} / 目标设备 ${targetDevicesForBinding.length}`, true)}
                      </div>
                      <div class="mt-3 grid gap-2">
                        ${sourceDevicesForBinding.length ? sourceDevicesForBinding.map((source) => {
                          const binding = (room.match_bindings || []).find((item) => String(item.source_mac || '').trim().toUpperCase() === source.mac) || {};
                          return `
                            <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] p-3">
                              <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.9fr)]">
                                <div>
                                  <div class="text-[12px] font-extrabold text-white">${escapeHtml(source.name)}</div>
                                  <div class="mt-1 text-[11px] leading-[1.5] text-[#9fb2c8]">${escapeHtml(source.group_name)} · ${escapeHtml(source.mac)}</div>
                                </div>
                                <label class="min-w-0">
                                  <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">目标设备</span>
                                  <select class="fake-select h-9 w-full px-2 text-[12px]" data-role="wizard-match-binding" data-source-mac="${escapeHtml(source.mac)}">
                                    ${targetDevicesForBinding.map((target) => `<option value="${escapeHtml(target.mac)}" ${String(binding.target_mac || '') === String(target.mac) ? 'selected' : ''}>${escapeHtml(target.name)} · ${escapeHtml(target.group_name)}</option>`).join('')}
                                  </select>
                                </label>
                              </div>
                            </div>
                          `;
                        }).join('') : '<div class="rounded-[16px] border border-dashed border-[rgba(88,116,154,0.24)] bg-[rgba(14,20,31,0.82)] px-4 py-5 text-[12px] leading-[1.6] text-[#9fb2c8]">先回上一步把源组和目标组选好，这里才会出现设备配对。</div>'}
                      </div>
                    </div>
                  ` : `
                    <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                      <div class="text-[11px] font-bold text-[#c7d5eb]">玩法归属说明</div>
                      <div class="mt-2 text-[12px] leading-[1.6] text-[#aabbd1]">
                        ${String(playPreset?.baseTemplate || '') === 'competition_score'
                          ? '当前竞争归属玩法固定采用“最强 RSSI 且仅当前最强者累计占领时间”的策略。目标设备负责判定归属，控制端只做汇总。'
                          : '这个玩法不需要额外配对。开始游戏后，接收端会按已选源组 / 目标组和本局规则自主运行。'}
                      </div>
                    </div>
                  `}
                </section>

                <section class="${step === 5 ? '' : 'hidden'} grid gap-3">
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div class="text-[11px] font-bold text-[#c7d5eb]">批量应用</div>
                        <div class="mt-1 text-[12px] leading-[1.5] text-[#aabbd1]">空闲灯效指游戏 START 后，设备已进入本局、尚未触发成功、且没有处于测试/点名/停止状态时显示的背景灯效；触发成功后播放触发灯效，停止游戏后熄灭。</div>
                      </div>
                      ${makePill(`${Array.isArray(room.effect_rules) ? room.effect_rules.length : 0} 条矩阵规则`, true)}
                    </div>
                    <div class="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">全部源组空闲</span>
                        <select class="fake-select h-8 w-full px-2 text-[11px]" data-role="wizard-effect-batch" data-rule-field="source_idle_effect_id">${effectChoiceOptions(batchEffectValue('source_idle_effect_id', room.idle_effect_id || 'builtin-silent'))}</select>
                      </label>
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">全部源组触发</span>
                        <select class="fake-select h-8 w-full px-2 text-[11px]" data-role="wizard-effect-batch" data-rule-field="source_trigger_effect_id">${effectChoiceOptions(batchEffectValue('source_trigger_effect_id', room.trigger_effect_id || 'builtin-blink'))}</select>
                      </label>
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">全部目标组空闲</span>
                        <select class="fake-select h-8 w-full px-2 text-[11px]" data-role="wizard-effect-batch" data-rule-field="target_idle_effect_id">${effectChoiceOptions(batchEffectValue('target_idle_effect_id', 'builtin-silent'))}</select>
                      </label>
                      <label class="min-w-0">
                        <span class="mb-1 block text-[10px] font-bold text-[#8ea3bf]">全部目标组触发</span>
                        <select class="fake-select h-8 w-full px-2 text-[11px]" data-role="wizard-effect-batch" data-rule-field="target_trigger_effect_id">${effectChoiceOptions(batchEffectValue('target_trigger_effect_id', room.trigger_effect_id || 'builtin-blink'))}</select>
                      </label>
                    </div>
                  </div>
                  ${renderEffectMatrix()}
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                    <div class="text-[11px] font-bold text-[#c7d5eb]">预览说明</div>
                    <div class="mt-1 text-[12px] leading-[1.5] text-[#aabbd1]">点击每个灯效右侧的“预览”按钮，会在当前规则下方展开一行小预览；如果不想看预览，直接忽略即可。</div>
                  </div>
                </section>

                <section class="${step === 6 ? '' : 'hidden'} grid gap-3 xl:grid-cols-2">
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                    <div class="text-[11px] font-bold text-[#c7d5eb]">本局摘要</div>
                    <div class="mt-2 space-y-2 text-[12px] leading-[1.5] text-[#dbe5f6]">
                      <div>房间：<span class="font-bold text-white">${escapeHtml(room.name || '未命名房间')}</span></div>
                      <div>玩法：<span class="font-bold text-white">${escapeHtml(template.name || '未选择玩法')}</span></div>
                      <div>源组：<span class="font-bold text-white">${escapeHtml(summaryGroups(room.source_group_ids || []))}</span></div>
                      <div>目标组：<span class="font-bold text-white">${escapeHtml(summaryGroups(room.target_group_ids || []))}</span></div>
                      <div>感应：<span class="font-bold text-white">${escapeHtml(room.sense_mode || templateSenseText || '未设置')}</span></div>
                      <div>本局规则：<span class="font-bold text-white">${escapeHtml(signalSummaryText({ signal: roomSignal }))}</span></div>
                      <div>触发模式：<span class="font-bold text-white">${escapeHtml(triggerModeLabel(roomTrigger.mode))}</span></div>
                      <div>计分：<span class="font-bold text-white">${escapeHtml(ruleScoreText)}</span></div>
                      <div>重复规则：<span class="font-bold text-white">${escapeHtml(repeatModeLabel(roomRepeat.mode))}</span></div>
                      <div>源组空闲：<span class="font-bold text-white">${escapeHtml(sourceIdleEffectText)}</span></div>
                      <div>源组触发：<span class="font-bold text-white">${escapeHtml(sourceTriggerEffectText)}</span></div>
                      <div>目标组空闲：<span class="font-bold text-white">${escapeHtml(targetIdleEffectText)}</span></div>
                      <div>目标组触发：<span class="font-bold text-white">${escapeHtml(targetTriggerEffectText)}</span></div>
                      <div>灯效矩阵：<span class="font-bold text-white">${escapeHtml(Array.isArray(room.effect_rules) ? room.effect_rules.length : 0)} 条</span></div>
                      <div>保存状态：<span class="font-bold text-white">${escapeHtml(room.status === 'draft' ? '未保存，仅本地草稿' : '已保存为草稿')}</span></div>
                      <div>备注：<span class="font-bold text-white">${escapeHtml(room.notes || '无')}</span></div>
                    </div>
                  </div>
                  <div class="rounded-[18px] border border-[rgba(88,116,154,0.22)] bg-[rgba(14,20,31,0.9)] p-3.5">
                    <div class="text-[11px] font-bold text-[#c7d5eb]">保存前检查</div>
                    <div class="mt-2 space-y-2 text-[12px] leading-[1.5] text-[#dbe5f6]">
                      <div>房间名称：${roomNameMissing ? '<span class="font-bold text-[#f5c95f]">未填写</span>' : '<span class="font-bold text-[#68d792]">已填写</span>'}</div>
                      <div>玩法：<span class="font-bold text-white">${escapeHtml(template.name || '未选择')}</span></div>
                      <div>本局设备：<span class="font-bold text-white">${selectedDeviceCount} 台</span></div>
                      <div>分组数量：<span class="font-bold text-white">${groups.length} 个</span></div>
                    </div>
                    <div class="mt-3 rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(9,14,22,0.68)] px-3 py-2 text-[11px] leading-[1.5] text-[#99acc5]">
                      先保存，再进行设备预备和开始。点击“保存设置”只会把当前配置写成本地草稿，不会下发到设备。
                    </div>
                  </div>
                </section>
              </div>

              <div class="mt-4 flex flex-nowrap items-center justify-between gap-2 overflow-x-auto border-t border-[rgba(88,116,154,0.16)] pt-3">
                <div class="flex flex-nowrap gap-2">
                  <button class="${footerBtnBase} border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] text-[#dbe5f4] ${step === 0 ? 'opacity-40 pointer-events-none' : ''}" type="button" data-action="wizard-prev">${footerBtnLabel('refresh', '上一步')}</button>
                  <button class="${footerBtnBase} border-[rgba(88,116,154,0.28)] bg-[rgba(24,33,47,0.92)] text-[#dbe5f4] ${wizardSaveDisabledClass}" type="button" data-action="wizard-save-draft" ${wizardSaveDisabledAttr}>${footerBtnLabel('save', '保存设置')}</button>
                </div>
                <div class="flex flex-nowrap gap-2">
                  ${step < WIZARD_STEP_MAX ? `<button class="${footerBtnPrimary} bg-gradient-to-b from-[#4caeff] to-[#428fe0]" type="button" data-action="wizard-next">${footerBtnLabel('arrow', '下一步')}</button>` : `<button class="${footerBtnPrimary} bg-gradient-to-b from-[#62d89a] to-[#48bb7c] ${wizardSaveDisabledClass}" type="button" data-action="wizard-save-draft" ${wizardSaveDisabledAttr}>${footerBtnLabel('save', '保存设置')}</button>`}
                </div>
              </div>
            </div>

            <aside class="flex flex-col gap-3 rounded-[20px] border border-[rgba(88,116,154,0.26)] bg-[linear-gradient(180deg,rgba(21,30,43,0.96),rgba(17,24,36,0.94))] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="m-0 text-[17px] font-extrabold leading-none">向导摘要</h3>
                  <p class="mt-1.5 text-[12px] leading-[1.45] text-[#aabbd1]">这里展示当前选择，方便 NPC 快速确认本局配置。</p>
                </div>
                ${makePill(`步骤 ${step + 1}/7`, true)}
              </div>
              <div class="grid gap-2.5">
                <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
                  <div class="text-[11px] font-bold text-[#c7d5eb]">房间名称</div>
                  <div class="mt-1 text-[13px] font-extrabold text-white">${escapeHtml(room.name || '未命名房间')}</div>
                </div>
                <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
                  <div class="text-[11px] font-bold text-[#c7d5eb]">玩法预设</div>
                  <div class="mt-1 text-[13px] font-extrabold text-white">${escapeHtml(template.name || '未选择玩法')}</div>
                </div>
                <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
                  <div class="text-[11px] font-bold text-[#c7d5eb]">玩法默认</div>
                  <div class="mt-1 text-[11px] leading-[1.6] text-[#aabbd1]">${escapeHtml(playPresetRelationText)}</div>
                </div>
                <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
                  <div class="text-[11px] font-bold text-[#c7d5eb]">本局规则</div>
                  <div class="mt-1 text-[11px] leading-[1.6] text-[#aabbd1]">${escapeHtml(signalSummaryText({ signal: roomSignal }))}<br>${escapeHtml(triggerSummaryText({ trigger: roomTrigger }))}<br>${escapeHtml(ruleScoreText)}</div>
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
                  <div class="text-[11px] font-bold text-[#c7d5eb]">感应 / 灯效</div>
                  <div class="mt-1 text-[12px] leading-[1.5] text-white">${escapeHtml(room.sense_mode || templateSenseText || '未设置')} / 空闲 ${escapeHtml(sourceIdleEffectText)} / 触发 ${escapeHtml(sourceTriggerEffectText)}</div>
                </div>
                <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
                  <div class="text-[11px] font-bold text-[#c7d5eb]">状态</div>
                  <div class="mt-1 text-[12px] leading-[1.5] text-white">${escapeHtml(currentRoomStatusLabel())}</div>
                </div>
                <div class="rounded-[16px] border border-[rgba(88,116,154,0.18)] bg-[rgba(14,20,31,0.82)] p-3">
                  <div class="text-[11px] font-bold text-[#c7d5eb]">说明</div>
                  <div class="mt-1 text-[11px] leading-[1.6] text-[#aabbd1]">${needsPairBinding ? '当前玩法要求指定配对，开始前请确认每个源设备都已经绑定目标。' : '向导只负责开局；复杂默认规则留在玩法预设里，本局覆盖只影响这一局。'}
                  </div>
                </div>
              </div>
            </aside>
          </section>
        </div>
      </div>
    `;
  }

  function renderApp() {
    if (wizardState().open) return renderWizardPage();
    if (state.roomPresentationMode) {
      return `
        <div id="mw-app" class="fixed inset-0 z-[90] overflow-auto bg-[#050914] p-3 text-[12px] leading-[1.4]">
          <div class="mx-auto w-[min(1920px,100%)]">
            <div class="sticky top-0 z-[2] mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[16px] border border-[rgba(110,151,196,0.24)] bg-[rgba(7,13,22,0.92)] px-3 py-2 shadow-[0_16px_36px_rgba(0,0,0,0.32)] backdrop-blur">
              <div class="text-[12px] font-black tracking-[0.18em] text-[#8fd0ff]">PRESENTATION MODE</div>
              <div class="flex flex-wrap items-center gap-2">
                <button class="mw-tv-mini-btn" type="button" data-action="load-controller">${svgIcon('refresh')}读取状态</button>
                <button class="mw-tv-mini-btn" type="button" data-action="scan-devices">${svgIcon('wifi')}扫描设备</button>
                <button class="mw-tv-mini-btn danger" type="button" data-action="exit-room-presentation">退出大屏</button>
              </div>
            </div>
            ${renderBroadcastRoomPanel()}
          </div>
        </div>
      `;
    }
    const loadHint = state.controllerOnline
      ? `页面当前已联机，可以继续扫描和点名。`
      : `先连接到控制端所在网络，再点“从控制端读取”。如果暂时连不上，也可以继续离线编辑。`;
    const tagText = `${appReleaseVersion()} · Local ${state.serverStatus?.version || LOCAL_SERVICE_VERSION}`;
    const firmwareTagText = `控制 ${expectedFirmwareVersion('controller')} / 接收 ${expectedFirmwareVersion('receiver')}`;
    return `
      <div id="mw-app" class="mx-auto my-3 w-[min(1860px,calc(100vw-40px))] text-[12px] leading-[1.4]">
        <section class="rounded-[18px] border border-[rgba(88,116,154,0.24)] bg-[linear-gradient(180deg,rgba(13,22,35,0.88),rgba(9,16,27,0.84))] px-3.5 py-3 shadow-[0_14px_36px_rgba(0,0,0,0.26)] backdrop-blur-sm">
          <div class="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap">
            <div class="flex shrink-0 items-center gap-2">
              <div class="text-[16px] leading-none text-[#86cbff] drop-shadow-[0_0_10px_rgba(134,203,255,0.22)]">✦</div>
              <h1 class="m-0 text-[19px] font-extrabold leading-none tracking-[0] text-[#f6fbff]">Magic Wand 局域网配置页</h1>
            </div>
            <p class="m-0 shrink-0 text-[11.5px] leading-none text-[#c4d1e3]">为电脑灯效控制系统提供局域网配置、分组管理与效果预览（桌面端操作）。</p>
            <span class="inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-[rgba(103,130,169,0.32)] bg-[rgba(10,17,27,0.58)] px-3 text-[11px] font-medium text-[#dbe6f8]">${escapeHtml(tagText)}</span>
            <span class="inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-[rgba(103,130,169,0.32)] bg-[rgba(10,17,27,0.58)] px-3 text-[11px] font-medium text-[#dbe6f8]">${escapeHtml(firmwareTagText)}</span>
            <span class="inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-[rgba(103,130,169,0.32)] bg-[rgba(10,17,27,0.58)] px-3 text-[11px] font-medium text-[#dbe6f8]">本地保存已启用</span>
            <span class="inline-flex h-7 shrink-0 items-center justify-center rounded-full border ${state.controllerOnline ? 'border-[rgba(93,225,143,0.34)] bg-[rgba(20,40,30,0.68)] text-[#bdf4cf]' : 'border-[rgba(240,201,85,0.28)] bg-[rgba(42,32,12,0.56)] text-[#ffe2a2]'} px-3 text-[11px] font-medium">${state.controllerOnline ? '在线可编辑' : '离线可编辑'}</span>
          </div>
          <div class="mt-2.5">
            ${renderTopActions()}
          </div>
        </section>

        <section class="mt-3 rounded-[16px] border border-[rgba(88,116,154,0.24)] bg-[rgba(13,22,35,0.78)] px-3.5 py-2.5 text-[12px] leading-[1.55] text-[#dce8f8] shadow-[0_12px_28px_rgba(0,0,0,0.2)]">${escapeHtml(loadHint)}</section>

        ${renderTabs()}
      </div>
    `;
  }

  function captureRoomPrepareScroll() {
    const root = document.querySelector('[data-room-prepare-scroll-root]');
    if (root && state.roomPrepareModal) {
      state.roomPrepareModal.scrollTop = root.scrollTop;
    }
  }

  function restoreRoomPrepareScroll() {
    const scrollTop = normalizeNumber(state.roomPrepareModal?.scrollTop, 0);
    requestAnimationFrame(() => {
      const root = document.querySelector('[data-room-prepare-scroll-root]');
      if (root) root.scrollTop = scrollTop;
      requestAnimationFrame(() => {
        const root2 = document.querySelector('[data-room-prepare-scroll-root]');
        if (root2) root2.scrollTop = scrollTop;
      });
    });
  }

  function renderDialogs() {
    captureRoomPrepareScroll();
    const root = document.getElementById('mw-dialog-root');
    if (!root) return;
    root.innerHTML = `${renderRoomPrepareModal()}${renderRoomCountdownOverlay()}${renderRoomFinalizeModal()}${renderGroupDialogs()}${renderPlayPresetDialogs()}${renderEffectDialogs()}${renderTemplateDialogs()}`;
    restoreRoomPrepareScroll();
  }

  function render() {
    const root = document.getElementById('mw-app-root');
    if (!root) return;
    const scrollTop = window.scrollY;
    const wizardScrollRoot = document.querySelector('[data-wizard-scroll-root]');
    const wizardScrollTop = wizardScrollRoot ? wizardScrollRoot.scrollTop : 0;
    const playPresetListScrollRoot = document.querySelector('[data-play-preset-list-scroll]');
    const playPresetListScrollTop = playPresetListScrollRoot ? playPresetListScrollRoot.scrollTop : 0;
    const roomPrepareScrollRoot = document.querySelector('[data-room-prepare-scroll-root]');
    const roomPrepareScrollTop = roomPrepareScrollRoot
      ? roomPrepareScrollRoot.scrollTop
      : normalizeNumber(state.roomPrepareModal?.scrollTop, 0);
    root.innerHTML = renderApp();
    renderDialogs();
    requestAnimationFrame(() => {
      const nextWizardScrollRoot = document.querySelector('[data-wizard-scroll-root]');
      if (nextWizardScrollRoot) nextWizardScrollRoot.scrollTop = wizardScrollTop;
      const nextPlayPresetListScrollRoot = document.querySelector('[data-play-preset-list-scroll]');
      if (nextPlayPresetListScrollRoot) nextPlayPresetListScrollRoot.scrollTop = playPresetListScrollTop;
      const nextRoomPrepareScrollRoot = document.querySelector('[data-room-prepare-scroll-root]');
      if (nextRoomPrepareScrollRoot) {
        nextRoomPrepareScrollRoot.scrollTop = roomPrepareScrollTop;
        if (state.roomPrepareModal) state.roomPrepareModal.scrollTop = roomPrepareScrollTop;
      }
      window.scrollTo(0, Math.min(scrollTop, Math.max(0, document.documentElement.scrollHeight - window.innerHeight)));
      requestAnimationFrame(() => {
        const nextWizardScrollRoot2 = document.querySelector('[data-wizard-scroll-root]');
        if (nextWizardScrollRoot2) nextWizardScrollRoot2.scrollTop = wizardScrollTop;
        const nextPlayPresetListScrollRoot2 = document.querySelector('[data-play-preset-list-scroll]');
        if (nextPlayPresetListScrollRoot2) nextPlayPresetListScrollRoot2.scrollTop = playPresetListScrollTop;
        const nextRoomPrepareScrollRoot2 = document.querySelector('[data-room-prepare-scroll-root]');
        if (nextRoomPrepareScrollRoot2) {
          nextRoomPrepareScrollRoot2.scrollTop = roomPrepareScrollTop;
          if (state.roomPrepareModal) state.roomPrepareModal.scrollTop = roomPrepareScrollTop;
        }
        window.scrollTo(0, Math.min(scrollTop, Math.max(0, document.documentElement.scrollHeight - window.innerHeight)));
      });
    });
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

  function isInteractiveEditorOpen() {
    if (wizardState().open) return true;
    if (state.templateFormModal || state.effectFormModal || state.groupFormModal || state.playPresetFormModal || state.playPresetDeleteModal) return true;
    return false;
  }

  function isEditingFocusableElement(el) {
    if (!el || typeof el.closest !== 'function') return false;
    if (el.matches('input, textarea, select')) return true;
    if (el.isContentEditable) return true;
    if (el.closest('[data-wizard-scroll-root]')) return true;
    if (el.closest('[data-role^="wizard-"]')) return true;
    if (el.closest('[data-role="template-form-input"]')) return true;
    if (el.closest('[data-role="effect-form-input"]')) return true;
    if (el.closest('[data-role="group-form-input"]')) return true;
    if (el.closest('[data-role="play-preset-form-input"]')) return true;
    if (el.closest('[data-role="feature-preset-field"]')) return true;
    if (el.closest('[data-role="play-preset-query"]')) return true;
    if (el.closest('[data-role="signal-test-field"]')) return true;
    return false;
  }

  function shouldPauseAutoRefresh() {
    if (state.roomPresentationMode || document.fullscreenElement) return true;
    if (isInteractiveEditorOpen()) return true;
    const active = document.activeElement;
    if (isEditingFocusableElement(active)) return true;
    return false;
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

      const rawLocalState = local.status === 'fulfilled' ? local.value : loadLocalBackupOrDefault();
      const shouldResetGameplayStore = normalizeNumber(rawLocalState?.schema, 1) < LOCAL_SCHEMA_VERSION || normalizeNumber(rawLocalState?.gameplay_reset_version, 0) < LOCAL_SCHEMA_VERSION;
      state.localState = normalizeLocalState(rawLocalState);
      state.localState.ui.expanded_group_id = -1;
      state.roomRecords = shouldResetGameplayStore ? [] : normalizeRoomRecords(records.status === 'fulfilled' ? records.value?.records : loadRoomBackupOrDefault());
      state.controllerState = normalizeControllerState(controller.status === 'fulfilled' ? controller.value : null, state.controllerState || buildOfflineControllerState());
      state.controllerState = mergeDraftsIntoController(state.controllerState, state.localState);
      state.controllerOnline = controller.status === 'fulfilled';
      state.serverLogText = logText.status === 'fulfilled' ? logText.value : 'serve 日志暂时不可用。';
      state.activeTab = state.localState.ui.active_tab || 'overview';
      state.deviceFilterMode = state.localState.ui.device_filter_mode || 'ungrouped';
      state.deviceFilterGroupId = normalizeNumber(state.localState.ui.device_filter_group_id, -1);
      state.selectedTemplateId = state.localState.ui.selected_template_id || state.localState.templates[0]?.id || builtinTemplates[0].id;
      state.currentRoomId = state.localState.active_room_id || state.localState.current_room?.id || sortedRoomList()[0]?.id || state.localState.rooms?.[0]?.id || '';
      syncGroupEditorDraft(selectedGroup());
      syncActiveRoomAlias(roomById(state.currentRoomId) || state.localState.current_room || state.localState.rooms?.[0] || null);
      if (!state.controllerOnline && !controller.value) {
        state.controllerState = mergeDraftsIntoController(buildOfflineControllerState(), state.localState);
      }
      if (!state.roomRecords.length && !shouldResetGameplayStore) {
        state.roomRecords = state.localState.room_history || [];
      }
      if (shouldResetGameplayStore) {
        state.localState.rooms = [];
        state.localState.current_room = null;
        state.localState.active_room_id = '';
        state.localState.room_history = [];
        try {
          await fetchJson(`${state.apiBase}/api/local/records`, { method: 'DELETE' });
        } catch (err) {
          logDebug(`历史记录清理失败 | ${err.message}`);
        }
        await persistStateToServer();
      }
      state.debugLines.unshift(`page init | ui=${appReleaseVersion()} launcher=${window.location.protocol !== 'file:'} controllerBase=${state.controllerBase}`);
      state.debugLines = state.debugLines.slice(0, MAX_VISIBLE_LOG_LINES);
      persistLocalCache();
      persistRecordsCache();
    } catch (err) {
      state.localState = normalizeLocalState(loadLocalBackupOrDefault());
      state.localState.ui.expanded_group_id = -1;
      state.roomRecords = normalizeRoomRecords(loadRoomBackupOrDefault());
      state.controllerState = mergeDraftsIntoController(buildOfflineControllerState(), state.localState);
      state.controllerOnline = false;
      state.serverLogText = `初始化失败：${err.message}`;
      state.debugLines.unshift(`init failed | ${err.message}`);
      state.debugLines = state.debugLines.slice(0, MAX_VISIBLE_LOG_LINES);
      state.currentRoomId = state.localState.active_room_id || state.localState.current_room?.id || sortedRoomList()[0]?.id || state.localState.rooms?.[0]?.id || '';
      syncGroupEditorDraft(selectedGroup());
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
      if (state.localState) state.localState.room_history = state.roomRecords.slice(0, 5000);
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

  function signalTestRuntimePayload(cfg = signalTestConfig()) {
    const devices = signalTestDevices();
    const sourceMac = String(cfg.sourceMac || '').trim().toUpperCase();
    const targetMac = String(cfg.targetMac || '').trim().toUpperCase();
    const sourceDevice = devices.find((device) => String(device.mac || '').toUpperCase() === sourceMac) || { mac: sourceMac, name: '信号源设备', rssi: 0, seen_ms: 0 };
    const targetDevice = devices.find((device) => String(device.mac || '').toUpperCase() === targetMac) || { mac: targetMac, name: '信号目标设备', rssi: 0, seen_ms: 0 };
    const roomHash = normalizeNumber(cfg.roomHash, 65001);
    const commonGroup = {
      valid: true,
      target: 255,
      mode: 1,
      trigger_compare: 'gte',
      rssi: 0,
      hold: 60000,
      rule_id: 1,
      rule_base: 1,
      rule_judge: 1,
      rule_signal: 6,
      rule_rssi_min: 0,
      rule_rssi_max: -127,
      rule_missing_ms: 3000,
      rule_smooth_samples: clamp(normalizeNumber(cfg.smoothSamples, 5), 1, 10),
      rule_trigger: 1,
      rule_target_ms: 0,
      rule_target_count: 1,
      rule_period_ms: 0,
      rule_score_target: 0,
      rule_points: 0,
      rule_repeat: 1,
      rule_cooldown_ms: 5000,
      rule_after: 0,
      meter_enabled: 1,
      meter_port: clamp(normalizeNumber(cfg.port, 1), 1, 3),
      meter_led_count: clamp(normalizeNumber(cfg.ledCount, 10), 1, 200),
      meter_weak_rssi: normalizeNumber(cfg.weakRssi, -90),
      meter_strong_rssi: normalizeNumber(cfg.strongRssi, -35),
      meter_compression_x100: clamp(normalizeNumber(cfg.compressionX100, 160), 20, 500),
      effect: 'silent',
      trigger_effect: 'silent',
      silence: '',
      room_hash: roomHash
    };
    return {
      schema_version: 3,
      rssi_defaults_version: RSSI_DEFAULTS_VERSION,
      runtime_schema: 3,
      play_preset_id: 'signal_calibration',
      pair_bindings: [],
      devices: [
        {
          idx: normalizeNumber(sourceDevice.idx, 0),
          mac: sourceMac,
          name: String(deviceDraftName(sourceDevice) || sourceDevice.name || '信号源设备').slice(0, 31),
          group_mask: 1,
          rssi: normalizeNumber(sourceDevice.rssi, 0),
          seen_ms: Math.max(0, normalizeNumber(sourceDevice.seen_ms, 0))
        },
        {
          idx: normalizeNumber(targetDevice.idx, 1),
          mac: targetMac,
          name: String(deviceDraftName(targetDevice) || targetDevice.name || '信号目标设备').slice(0, 31),
          group_mask: 2,
          rssi: normalizeNumber(targetDevice.rssi, 0),
          seen_ms: Math.max(0, normalizeNumber(targetDevice.seen_ms, 0))
        }
      ],
      groups: [
        {
          ...commonGroup,
          id: 0,
          name: '信号校准源',
          note: '临时信号测试：源设备',
          peer_mask: 2
        },
        {
          ...commonGroup,
          id: 1,
          name: '信号校准目标',
          note: '临时信号测试：目标设备',
          peer_mask: 1
        }
      ],
      records: []
    };
  }

  function shouldUseSignalTestFallback(err) {
    const message = String(err?.message || err || '');
    return /HTTP\s+404|not\s*found|未找到|signal\/test/i.test(message);
  }

  async function startSignalTestViaRuntimeImport(cfg = signalTestConfig()) {
    const payload = signalTestRuntimePayload(cfg);
    await requestJson('/api/controller/config/import', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 20000
    });
    await requestText(`/api/controller/cmd?name=START_GAME&t=${Date.now()}`, {
      method: 'GET',
      timeoutMs: 12000
    });
    return {
      ok: true,
      running: true,
      room: normalizeNumber(cfg.roomHash, 65001),
      compat: true
    };
  }

  async function startSignalTest() {
    let devices = signalTestDevices();
    let cfg = ensureSignalTestSelection(devices);
    const sourceFresh = devices.some((device) => String(device.mac || '').toUpperCase() === String(cfg.sourceMac || '').toUpperCase() && (device.signal_online || device.signal_retained));
    const targetFresh = devices.some((device) => String(device.mac || '').toUpperCase() === String(cfg.targetMac || '').toUpperCase() && (device.signal_online || device.signal_retained));
    if (!state.controllerOnline || devices.length < 2 || !sourceFresh || !targetFresh) {
      logDebug('信号测试 | 开始前自动扫描设备');
      await scanDevices();
      devices = signalTestDevices();
      cfg = ensureSignalTestSelection(devices);
    }
    if (!state.controllerOnline) {
      alert('控制端未连接。请先连接控制端热点，再开始信号测试。');
      return false;
    }
    if (devices.length < 2) {
      alert('信号测试至少需要两台真实接收端。请先扫描设备，确认两台设备都能点名。');
      return false;
    }
    if (!cfg.sourceMac || !cfg.targetMac || String(cfg.sourceMac).toUpperCase() === String(cfg.targetMac).toUpperCase()) {
      alert('请选择两台不同的设备。');
      return false;
    }
    try {
      setBusy('signalTest', true);
      const params = [
        `source=${String(cfg.sourceMac || '').toUpperCase()}`,
        `target=${String(cfg.targetMac || '').toUpperCase()}`,
        `port=${encodeURIComponent(String(cfg.port))}`,
        `count=${encodeURIComponent(String(cfg.ledCount))}`,
        `weak=${encodeURIComponent(String(cfg.weakRssi))}`,
        `strong=${encodeURIComponent(String(cfg.strongRssi))}`,
        `compression=${encodeURIComponent(String(cfg.compressionX100))}`,
        `smooth=${encodeURIComponent(String(cfg.smoothSamples))}`,
        `t=${Date.now()}`
      ].join('&');
      const res = await requestJson(`/api/controller/signal/test?${params}`, {
        method: 'GET',
        timeoutMs: 12000
      });
      state.signalTest.running = true;
      state.signalTest.roomHash = normalizeNumber(res?.room, cfg.roomHash);
      state.signalTest.startedAt = Date.now();
      logDebug(`信号测试开始 | ${cfg.sourceMac} -> ${cfg.targetMac} | weak=${cfg.weakRssi} strong=${cfg.strongRssi} compression=${cfg.compressionX100}`);
      await loadFromController();
      await sleep(1200);
      await loadFromController();
      render();
      return true;
    } catch (err) {
      if (shouldUseSignalTestFallback(err)) {
        try {
          logDebug('信号测试专用接口不可用，改用临时运行配置兼容模式');
          const res = await startSignalTestViaRuntimeImport(cfg);
          state.signalTest.running = true;
          state.signalTest.roomHash = normalizeNumber(res?.room, cfg.roomHash);
          state.signalTest.startedAt = Date.now();
          await loadFromController();
          await sleep(1400);
          await loadFromController();
          render();
          return true;
        } catch (fallbackErr) {
          logDebug(`信号测试兼容模式失败 | ${fallbackErr.message}`);
          alert(`信号测试失败：${fallbackErr.message}`);
          return false;
        }
      }
      logDebug(`信号测试失败 | ${err.message}`);
      alert(`信号测试失败：${err.message}`);
      return false;
    } finally {
      setBusy('signalTest', false);
    }
  }

  async function stopSignalTest() {
    const cfg = signalTestConfig();
    try {
      setBusy('signalTest', true);
      const params = [
        'action=stop',
        `source=${String(cfg.sourceMac || '').toUpperCase()}`,
        `target=${String(cfg.targetMac || '').toUpperCase()}`,
        `t=${Date.now()}`
      ].join('&');
      await requestJson(`/api/controller/signal/test?${params}`, {
        method: 'GET',
        timeoutMs: 8000
      });
      state.signalTest.running = false;
      logDebug('信号测试已停止');
      await loadFromController();
      render();
      return true;
    } catch (err) {
      if (shouldUseSignalTestFallback(err)) {
        try {
          await requestText(`/api/controller/cmd?name=STOP_GAME&t=${Date.now()}`, {
            method: 'GET',
            timeoutMs: 10000
          });
          state.signalTest.running = false;
          logDebug('信号测试已停止（兼容模式）');
          await loadFromController();
          render();
          return true;
        } catch (fallbackErr) {
          logDebug(`停止信号测试兼容模式失败 | ${fallbackErr.message}`);
          alert(`停止信号测试失败：${fallbackErr.message}`);
          return false;
        }
      }
      logDebug(`停止信号测试失败 | ${err.message}`);
      alert(`停止信号测试失败：${err.message}`);
      return false;
    } finally {
      setBusy('signalTest', false);
    }
  }

  async function applySignalCalibrationToCurrentRoom() {
    const cfg = signalTestConfig();
    const room = currentRoom();
    if (!room) {
      alert('当前没有可应用的房间。请先创建或选择一个游戏房间。');
      return false;
    }
    if (room.status === 'running') {
      alert('当前房间正在进行中。请先停止游戏，再把信号校准参数应用到房间。');
      return false;
    }

    room.rule_overrides = room.rule_overrides && typeof room.rule_overrides === 'object' ? room.rule_overrides : {};
    room.rule_overrides.signal = room.rule_overrides.signal && typeof room.rule_overrides.signal === 'object' ? room.rule_overrides.signal : {};
    room.rule_overrides.feedback = room.rule_overrides.feedback && typeof room.rule_overrides.feedback === 'object' ? room.rule_overrides.feedback : {};
    room.rule_overrides.feedback.signalMeter = room.rule_overrides.feedback.signalMeter && typeof room.rule_overrides.feedback.signalMeter === 'object'
      ? room.rule_overrides.feedback.signalMeter
      : {};

    room.rule_overrides.signal.smoothSamples = clamp(normalizeNumber(cfg.smoothSamples, 5), 1, 10);
    room.rule_overrides.feedback.signalMeter = {
      ...room.rule_overrides.feedback.signalMeter,
      enabled: true,
      port: clamp(normalizeNumber(cfg.port, 1), 1, 3),
      ledCount: clamp(normalizeNumber(cfg.ledCount, 10), 1, 200),
      weakRssi: normalizeNumber(cfg.weakRssi, -90),
      strongRssi: normalizeNumber(cfg.strongRssi, -35),
      compressionX100: clamp(normalizeNumber(cfg.compressionX100, 160), 20, 500)
    };
    room.updated_at = nowIso();
    if (room.status !== 'draft') {
      room.status = 'draft';
    }
    persistLocalCache();
    await persistStateToServer();
    logDebug(`信号校准已应用到房间 | ${room.name || room.id} | LED${cfg.port} ${cfg.ledCount}格 weak=${cfg.weakRssi} strong=${cfg.strongRssi} compression=${cfg.compressionX100}`);
    render();
    return true;
  }

  async function toggleRoomPresentation() {
    try {
      if (state.roomPresentationMode) {
        state.roomPresentationMode = false;
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
        render();
        return;
      }
      state.roomPresentationMode = true;
      render();
      if (document.fullscreenEnabled && !document.fullscreenElement) {
        try {
          await document.documentElement.requestFullscreen();
        } catch (fullscreenErr) {
          logDebug(`浏览器全屏不可用，已进入页面级大屏 | ${fullscreenErr?.message || 'fullscreen denied'}`);
        }
      }
    } catch (err) {
      state.roomPresentationMode = true;
      render();
      logDebug(`进入页面级大屏 | ${err?.message || 'fullscreen fallback'}`);
    }
  }

  async function handleClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const mac = target.dataset.mac;
    const idx = normalizeNumber(target.dataset.idx, -1);
    const gid = normalizeNumber(target.dataset.gid, -1);
    const tab = target.dataset.tab;
    const templateId = target.dataset.templateId;
    const effectId = target.dataset.effectId || target.dataset.presetId;
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
        selectTab('game');
        break;
      case 'open-wizard':
        openWizard(state.localState?.ui?.selected_play_preset_id || state.selectedTemplateId || builtinTemplates[0].id, { forceNew: true });
        break;
      case 'load-controller':
        loadFromController();
        break;
      case 'publish':
        if (state.busy.publish || state.preparingRoomId) break;
        publishConfig();
        break;
      case 'scan-devices':
        scanDevices();
        break;
      case 'start-signal-test':
        if (state.busy.signalTest) break;
        startSignalTest();
        break;
      case 'stop-signal-test':
        if (state.busy.signalTest) break;
        stopSignalTest();
        break;
      case 'apply-signal-calibration':
        applySignalCalibrationToCurrentRoom();
        break;
      case 'toggle-room-presentation':
        toggleRoomPresentation();
        break;
      case 'exit-room-presentation':
        state.roomPresentationMode = false;
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        render();
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
      case 'toggle-preview-play':
        state.previewPlaying = !state.previewPlaying;
        render();
        break;
      case 'reset-preview':
        state.previewTick = 0;
        render();
        break;
      case 'toggle-preview-shape':
        setPreviewCellShape(previewCellShape() === 'square' ? 'circle' : 'square');
        break;
      case 'toggle-preview-effect-list':
        state.localState.ui.preview_effect_list_collapsed = !state.localState.ui.preview_effect_list_collapsed;
        persistStateToServer();
        render();
        break;
      case 'toggle-template-preview': {
        const id = String(target.dataset.templateId || '');
        state.effectPreviewTemplateId = state.effectPreviewTemplateId === id ? '' : id;
        updateEffectPreviewNodes();
        break;
      }
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
      case 'identify-group':
        identifyGroupDevices(gid);
        break;
      case 'identify-room-devices':
        identifyRoomDevices(roomId || state.roomPrepareModal?.roomId || activeRoomId());
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
      case 'toggle-show-offline':
        state.localState.ui.show_offline_devices = !!event.target.checked;
        persistStateToServer();
        render();
        break;
      case 'toggle-device-groups-panel':
        state.localState.ui.device_preview_collapsed = !state.localState.ui.device_preview_collapsed;
        persistStateToServer();
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
        setExpandedGroupId(expandedGroupId() === gid ? -1 : gid);
        state.activeTab = 'groups';
        state.localState.ui.active_tab = 'groups';
        persistStateToServer();
        render();
        break;
      case 'edit-group':
        editGroupDraft(gid);
        state.activeTab = 'groups';
        state.localState.ui.active_tab = 'groups';
        persistStateToServer();
        break;
      case 'save-group':
        saveGroupFromModal();
        break;
      case 'create-group':
        createGroupDraft();
        break;
      case 'delete-group':
        deleteGroupDraft(gid);
        break;
      case 'cancel-group-form':
        closeGroupFormModal();
        break;
      case 'save-group-form':
        saveGroupFromModal();
        break;
      case 'open-delete-group':
        openGroupDeleteModal(gid);
        break;
      case 'confirm-delete-group':
        confirmDeleteGroupDraft();
        break;
      case 'cancel-delete-group':
        closeGroupDeleteModal();
        break;
      case 'device-filter-group':
        state.deviceFilterGroupId = normalizeNumber(target.value, -1);
        state.localState.ui.device_filter_group_id = state.deviceFilterGroupId;
        persistStateToServer();
        render();
        break;
      case 'delete-device':
        deleteDevice(mac);
        break;
      case 'create-template':
        createTemplateFromCurrent();
        break;
      case 'edit-template': {
        const source = state.localState.templates.find((item) => String(item.id) === String(templateId || ''));
        if (source) openTemplateFormModal(source, { mode: 'edit' });
        break;
      }
      case 'create-room-from-template':
        createRoomFromTemplate(templateId || state.selectedTemplateId || activeTemplate()?.id || builtinTemplates[0].id);
        break;
      case 'clone-template':
        cloneTemplate(templateId || state.selectedTemplateId || activeTemplate()?.id);
        break;
      case 'load-template':
        createRoomFromTemplate(templateId || state.selectedTemplateId || activeTemplate()?.id || builtinTemplates[0].id);
        break;
      case 'delete-template':
        deleteTemplate(templateId || state.selectedTemplateId || activeTemplate()?.id);
        break;
      case 'create-room':
        createRoomFromTemplate();
        break;
      case 'template-form-next-step':
        if (state.templateFormModal) {
          state.templateFormModal.step = 2;
          render();
        }
        break;
      case 'template-form-prev-step':
        if (state.templateFormModal) {
          state.templateFormModal.step = 1;
          render();
        }
        break;
      case 'cancel-template-form':
        closeTemplateFormModal();
        break;
      case 'save-template-form':
        saveTemplateFormModal();
        break;
      case 'start-room':
        if (roomId) setActiveRoom(roomId);
        startRoom();
        break;
      case 'end-room':
        if (roomId) setActiveRoom(roomId);
        endRoom();
        break;
      case 'stop-room':
        if (roomId) setActiveRoom(roomId);
        endRoom();
        break;
      case 'delete-room':
        deleteRoom(roomId || activeRoomId());
        break;
      case 'publish-room':
        if (state.busy.publish || state.preparingRoomId) break;
        if (roomId) setActiveRoom(roomId);
        prepareRoom(currentRoom());
        break;
      case 'prepare-room':
        if (state.busy.publish || state.preparingRoomId) break;
        if (roomId) setActiveRoom(roomId);
        prepareRoom(currentRoom());
        break;
      case 'confirm-room-prepare':
        if (state.busy.publish || state.preparingRoomId) break;
        if (state.roomPrepareModal?.roomId) setActiveRoom(state.roomPrepareModal.roomId);
        prepareRoom(roomById(state.roomPrepareModal?.roomId) || currentRoom(), { force: true });
        break;
      case 'test-room-effects':
        if (state.busy.publish || state.busy.testEffect || state.preparingRoomId) break;
        if (state.roomPrepareModal?.roomId) setActiveRoom(state.roomPrepareModal.roomId);
        testRoomTriggerEffects(roomById(state.roomPrepareModal?.roomId) || currentRoom());
        break;
      case 'stop-room-test-effects':
        if (state.busy.stopEffect) break;
        if (state.roomPrepareModal?.roomId) setActiveRoom(state.roomPrepareModal.roomId);
        stopRoomTestEffects(roomById(state.roomPrepareModal?.roomId) || currentRoom());
        break;
      case 'cancel-room-prepare':
        if (state.busy.publish || state.busy.testEffect || state.preparingRoomId) break;
        state.roomPrepareModal = null;
        renderDialogs();
        break;
      case 'cancel-room-countdown':
        clearRoomCountdown();
        break;
      case 'room-finalize-refresh':
        if (state.roomFinalizeModal?.room) {
          await loadFromController();
          state.roomFinalizeModal = roomFinalizeAudit(state.roomFinalizeModal.room);
          renderDialogs();
        }
        break;
      case 'room-finalize-ignore':
        state.roomFinalizeModal = null;
        renderDialogs();
        break;
      case 'toggle-room-sort':
        setRoomSortOrder(roomSortOrder() === 'asc' ? 'desc' : 'asc');
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
      case 'select-effect-preset':
      case 'select-custom-effect':
        state.localState.ui.selected_effect_preset_id = effectId || target.dataset.presetId || state.localState.ui.selected_effect_preset_id;
        state.selectedEffectId = state.localState.ui.selected_effect_preset_id;
        persistStateToServer();
        render();
        break;
      case 'preview-room-effect': {
        const select = target.closest('label')?.querySelector('select[data-role="wizard-effect-rule"]');
        const previewEffectId = String(select?.value || target.dataset.effectId || '').trim();
        const previewRuleKey = `${roomEffectRuleKey(target.dataset.sourceGid, target.dataset.targetGid)}:${String(target.dataset.ruleField || '')}`;
        if (previewEffectId) {
          state.roomEffectPreviewKey = previewRuleKey;
          state.roomEffectPreviewId = previewEffectId;
          state.selectedEffectId = previewEffectId;
          render();
        }
        break;
      }
      case 'create-effect-from-template':
        openEffectFormModal(templateId || 'builtin-breath', { mode: 'create' });
        break;
      case 'create-custom-effect':
        openEffectFormModal('builtin-breath', { mode: 'create' });
        break;
      case 'edit-custom-effect':
        openEffectFormModal(effectId, { mode: 'edit' });
        break;
      case 'delete-custom-effect':
        openEffectDeleteModal(effectId);
        break;
      case 'cancel-effect-form':
        closeEffectFormModal();
        break;
      case 'effect-form-next-step':
        if (state.effectFormModal) {
          state.effectFormModal.step = 2;
          renderDialogs();
        }
        break;
      case 'effect-form-prev-step':
        if (state.effectFormModal) {
          state.effectFormModal.step = 1;
          renderDialogs();
        }
        break;
      case 'effect-form-switch-track':
        if (state.effectFormModal) {
          state.effectFormModal.activeTrackIndex = clamp(normalizeNumber(target.dataset.trackIndex, 0), 0, EFFECT_TRACK_LIMIT - 1);
          renderDialogs();
        }
        break;
      case 'save-effect-form':
        saveEffectFormModal();
        break;
      case 'cancel-effect-delete':
        closeEffectDeleteModal();
        break;
      case 'confirm-effect-delete':
        confirmDeleteEffectModal();
        break;
      case 'select-feature-preset':
        state.localState.ui.selected_play_preset_id = target.dataset.presetId || state.localState.ui.selected_play_preset_id;
        state.localState.ui.selected_feature_preset_id = state.localState.ui.selected_play_preset_id;
        state.localState.ui.selected_template_id = state.localState.ui.selected_play_preset_id;
        state.selectedTemplateId = state.localState.ui.selected_template_id;
        persistStateToServer();
        render();
        break;
      case 'clone-play-preset':
        openPlayPresetFormModal(target.dataset.presetId || state.localState.ui.selected_play_preset_id, { mode: 'create' });
        break;
      case 'create-play-preset':
        openPlayPresetFormModal(null, { mode: 'create', name: '新玩法预设' });
        break;
      case 'create-play-preset-from':
        openPlayPresetFormModal(target.dataset.presetId || state.localState.ui.selected_play_preset_id, { mode: 'create' });
        break;
      case 'edit-play-preset':
        openPlayPresetFormModal(target.dataset.presetId || state.localState.ui.selected_play_preset_id, { mode: 'edit' });
        break;
      case 'delete-play-preset':
        openPlayPresetDeleteModal(target.dataset.presetId || state.localState.ui.selected_play_preset_id);
        break;
      case 'cancel-play-preset-form':
        closePlayPresetFormModal();
        break;
      case 'save-play-preset-form':
        savePlayPresetFormModal();
        break;
      case 'cancel-delete-play-preset':
        closePlayPresetDeleteModal();
        break;
      case 'confirm-delete-play-preset':
        confirmDeletePlayPresetModal();
        break;
      case 'play-preset-filter-all':
      case 'play-preset-filter-user':
      case 'play-preset-filter-system':
        state.localState.ui.play_preset_filter = action === 'play-preset-filter-user' ? 'user' : action === 'play-preset-filter-system' ? 'system' : 'all';
        persistStateToServer();
        render();
        break;
      case 'toggle-play-preset-advanced':
        state.localState.ui.play_preset_advanced = !(state.localState?.ui?.play_preset_advanced === true);
        persistStateToServer();
        render();
        break;
      case 'toggle-play-preset-list':
        state.localState.ui.play_preset_list_collapsed = !(state.localState?.ui?.play_preset_list_collapsed === true);
        persistStateToServer();
        render();
        break;
      case 'toggle-system-play-presets':
        state.localState.ui.system_play_presets_collapsed = !(state.localState?.ui?.system_play_presets_collapsed !== false);
        persistStateToServer();
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
      case 'wizard-publish':
        saveWizardDraft();
        break;
      case 'wizard-start':
        saveWizardDraft();
        break;
      case 'wizard-toggle-source-group':
      case 'wizard-toggle-target-group': {
        const room = currentRoom();
        const sourceSet = new Set(Array.isArray(room?.source_group_ids) ? room.source_group_ids.map((value) => String(value)) : []);
        const targetSet = new Set(Array.isArray(room?.target_group_ids) ? room.target_group_ids.map((value) => String(value)) : []);
        const nextChecked = action === 'wizard-toggle-target-group'
          ? !targetSet.has(String(gid))
          : !sourceSet.has(String(gid));
        toggleWizardGroup(action === 'wizard-toggle-target-group' ? 'target' : 'source', gid, nextChecked);
        break;
      }
      default:
        break;
    }
  }

  function handleInput(event) {
    const target = event.target;
    if (target.matches('[data-role="device-name-input"]')) {
      updateEditDraft('name', target.value);
      return;
    }
    if (target.matches('[data-role="device-note-input"]')) {
      updateEditDraft('note', target.value);
      return;
    }
    if (target.matches('[data-role="group-form-input"]')) {
      if (state.groupFormModal) {
        if (target.dataset.groupFormField === 'name') state.groupFormModal.name = target.value;
        if (target.dataset.groupFormField === 'note') state.groupFormModal.note = target.value;
      }
      return;
    }
    if (target.matches('[data-role="play-preset-form-input"]')) {
      updatePlayPresetFormModalField(target.dataset.playPresetFormField, target.type === 'checkbox' ? target.checked : target.value, target);
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
      return;
    }
    if (target.matches('[data-role="signal-test-field"]')) {
      const field = String(target.dataset.field || '');
      const shouldRender = event.type === 'change' || target.tagName === 'SELECT';
      if (!state.signalTest || typeof state.signalTest !== 'object') state.signalTest = signalTestConfig();
      if (field === 'sourceMac' || field === 'targetMac') {
        state.signalTest[field] = String(target.value || '');
      } else if (field === 'port') {
        state.signalTest.port = clamp(normalizeNumber(target.value, 1), 1, 3);
      } else if (field === 'ledCount') {
        state.signalTest.ledCount = clamp(normalizeNumber(target.value, 10), 1, 200);
      } else if (field === 'weakRssi') {
        state.signalTest.weakRssi = normalizeNumber(target.value, -90);
      } else if (field === 'strongRssi') {
        state.signalTest.strongRssi = normalizeNumber(target.value, -35);
      } else if (field === 'compressionX100') {
        state.signalTest.compressionX100 = clamp(normalizeNumber(target.value, 160), 20, 500);
      } else if (field === 'smoothSamples') {
        state.signalTest.smoothSamples = clamp(normalizeNumber(target.value, 5), 1, 10);
      }
      if (shouldRender) render();
      return;
    }
    if (target.matches('[data-role="wizard-trigger-compare"]')) {
      const room = ensureRoomDraft();
      room.trigger_compare = triggerCompareValue(target.value);
      room.rule_signal_type = room.trigger_compare === 'lte' ? 'weaker' : 'enter_range';
      room.rule_overrides = room.rule_overrides && typeof room.rule_overrides === 'object' ? room.rule_overrides : {};
      room.rule_overrides.signal = room.rule_overrides.signal && typeof room.rule_overrides.signal === 'object' ? room.rule_overrides.signal : {};
      room.rule_overrides.signal.type = room.rule_signal_type;
      room.updated_at = nowIso();
      persistLocalCache();
      render();
      return;
    }
    if (target.matches('[data-role="wizard-trigger-rssi"]')) {
      const room = ensureRoomDraft();
      room.trigger_signal_rssi = normalizeNumber(target.value, DEFAULT_TRIGGER_RSSI);
      room.rule_rssi_min = room.trigger_signal_rssi;
      room.rule_overrides = room.rule_overrides && typeof room.rule_overrides === 'object' ? room.rule_overrides : {};
      room.rule_overrides.signal = room.rule_overrides.signal && typeof room.rule_overrides.signal === 'object' ? room.rule_overrides.signal : {};
      room.rule_overrides.signal.rssiMin = room.rule_rssi_min;
      room.updated_at = nowIso();
      persistLocalCache();
      return;
    }
    if (target.matches('[data-role="wizard-trigger-hold"]')) {
      const room = ensureRoomDraft();
      room.trigger_hold_ms = normalizeNumber(target.value, DEFAULT_TRIGGER_HOLD_MS);
      room.rule_hold_ms = room.trigger_hold_ms;
      room.rule_overrides = room.rule_overrides && typeof room.rule_overrides === 'object' ? room.rule_overrides : {};
      room.rule_overrides.signal = room.rule_overrides.signal && typeof room.rule_overrides.signal === 'object' ? room.rule_overrides.signal : {};
      room.rule_overrides.signal.holdMs = room.rule_hold_ms;
      room.updated_at = nowIso();
      persistLocalCache();
      return;
    }
    if (target.matches('[data-role="wizard-rule-field"]')) {
      const room = ensureRoomDraft();
      const section = String(target.dataset.ruleSection || '');
      const field = String(target.dataset.ruleField || '');
      room.rule_overrides = room.rule_overrides && typeof room.rule_overrides === 'object' ? room.rule_overrides : {};
      room.rule_overrides[section] = room.rule_overrides[section] && typeof room.rule_overrides[section] === 'object' ? room.rule_overrides[section] : {};
      const nextValue = target.type === 'number' ? target.value : target.value;
      if (section === 'signal') {
        if (field === 'rssiMax') room.rule_overrides.signal[field] = String(nextValue).trim() === '' ? null : normalizeNumber(nextValue, -20);
        else if (field === 'rssiMin' || field === 'holdMs' || field === 'missingMs' || field === 'smoothSamples') room.rule_overrides.signal[field] = normalizeNumber(nextValue, field === 'rssiMin' ? DEFAULT_TRIGGER_RSSI : field === 'holdMs' ? DEFAULT_TRIGGER_HOLD_MS : 0);
        else room.rule_overrides.signal[field] = String(nextValue || '');
      } else if (section === 'trigger') {
        room.rule_overrides.trigger[field] = ['targetMs', 'targetCount', 'periodMs'].includes(field) ? normalizeNumber(nextValue, 0) : String(nextValue || '');
      } else if (section === 'score') {
        room.rule_overrides.score[field] = field === 'points' ? normalizeNumber(nextValue, 1) : String(nextValue || '');
      } else if (section === 'repeat') {
        room.rule_overrides.repeat[field] = field === 'cooldownMs' ? normalizeNumber(nextValue, 5000) : String(nextValue || '');
      } else if (section === 'afterTrigger') {
        room.rule_overrides.afterTrigger[field] = String(nextValue || 'none');
      } else if (section === 'feedback') {
        room.rule_overrides.feedback.signalMeter = room.rule_overrides.feedback.signalMeter && typeof room.rule_overrides.feedback.signalMeter === 'object'
          ? room.rule_overrides.feedback.signalMeter
          : {};
        if (field === 'meterEnabled') room.rule_overrides.feedback.signalMeter.enabled = !!target.checked;
        else if (field === 'meterPort') room.rule_overrides.feedback.signalMeter.port = clamp(normalizeNumber(nextValue, 1), 1, 3);
        else if (field === 'meterLedCount') room.rule_overrides.feedback.signalMeter.ledCount = clamp(normalizeNumber(nextValue, 10), 1, 200);
        else if (field === 'meterWeakRssi') room.rule_overrides.feedback.signalMeter.weakRssi = normalizeNumber(nextValue, -90);
        else if (field === 'meterStrongRssi') room.rule_overrides.feedback.signalMeter.strongRssi = normalizeNumber(nextValue, room.rule_rssi_min ?? DEFAULT_TRIGGER_RSSI);
        else if (field === 'meterCompression') room.rule_overrides.feedback.signalMeter.compressionX100 = clamp(normalizeNumber(nextValue, 100), 20, 500);
      }
      const signal = room.rule_overrides.signal || {};
      room.rule_signal_type = String(signal.type || room.rule_signal_type || 'enter_range');
      room.rule_rssi_min = normalizeNumber(signal.rssiMin ?? room.rule_rssi_min, DEFAULT_TRIGGER_RSSI);
      room.rule_rssi_max = signal.rssiMax === null || signal.rssiMax === undefined || signal.rssiMax === '' ? null : normalizeNumber(signal.rssiMax, -20);
      room.rule_hold_ms = normalizeNumber(signal.holdMs ?? room.rule_hold_ms, DEFAULT_TRIGGER_HOLD_MS);
      room.trigger_signal_rssi = room.rule_rssi_min;
      room.trigger_hold_ms = room.rule_hold_ms;
      room.trigger_compare = room.rule_signal_type === 'leave_range' || room.rule_signal_type === 'weaker' ? 'lte' : (room.rule_rssi_max !== null ? 'range' : 'gte');
      room.updated_at = nowIso();
      updateRoomDraftSummary(room);
      persistLocalCache();
      render();
      return;
    }
    if (target.matches('[data-role="wizard-match-binding"]')) {
      updateWizardMatchBinding(target.dataset.sourceMac, target.value);
      return;
    }
    if (target.matches('[data-role="wizard-effect-rule"]')) {
      updateWizardEffectRule(target.dataset.sourceGid, target.dataset.targetGid, target.dataset.ruleField, target.value);
      return;
    }
    if (target.matches('[data-role="wizard-effect-batch"]')) {
      applyWizardEffectRuleBatch(target.dataset.ruleField, target.value);
      return;
    }
    if (target.matches('[data-role="template-form-input"]')) {
      if (!state.templateFormModal) return;
      const field = target.dataset.templateFormField;
      if (field === 'name' || field === 'note' || field === 'feature_preset_id' || field === 'effect_preset_id' || field === 'source_group_mode' || field === 'target_group_mode' || field === 'sense_mode' || field === 'idle_effect_id' || field === 'trigger_effect_id' || field === 'scoring_mode' || field === 'scoring_max_find') {
        state.templateFormModal[field] = target.value;
      }
      return;
    }
    if (target.matches('[data-role="play-preset-form-input"]')) {
      updatePlayPresetFormModalField(target.dataset.playPresetFormField, target.type === 'checkbox' ? target.checked : target.value, target);
      return;
    }
    if (target.matches('[data-role="template-field"]')) {
      updateSelectedTemplateField(target.dataset.templateField, target.value);
      return;
    }
    if (target.matches('[data-role="play-preset-query"]')) {
      state.localState.ui.play_preset_query = target.value;
      persistLocalCache();
      render();
      return;
    }
    if (target.matches('[data-role="feature-preset-field"]')) {
      const shouldRender = event.type === 'change' || target.tagName === 'SELECT' || target.type === 'checkbox';
      updateSelectedFeaturePresetField(target.dataset.presetField, target.type === 'checkbox' ? target.checked : target.value, { render: shouldRender });
      return;
    }
    if (target.matches('[data-role="effect-form-input"]')) {
      if (!state.effectFormModal) return;
      const field = target.dataset.effectFormField;
      if (field === 'name' || field === 'note') {
        state.effectFormModal[field] = target.value;
      } else if (field === 'source_template_id') {
        state.effectFormModal.source_template_id = target.value;
      }
      return;
    }
    if (target.matches('[data-role="preview-effect-select"]')) {
      state.localState.ui.selected_effect_preset_id = String(target.value || '');
      state.selectedEffectId = state.localState.ui.selected_effect_preset_id;
      persistStateToServer();
      render();
      return;
    }
    if (target.matches('[data-role="effect-preset-field"]')) {
      updateSelectedEffectPresetField(target.dataset.presetField, target.value);
    }
    if (target.matches('[data-role="effect-form-track-field"]')) {
      const trackIndex = normalizeNumber(target.dataset.trackIndex, 0);
      const field = target.dataset.trackField;
      const modal = ensureEffectFormModal();
      if (!modal) return;
      const tracks = Array.isArray(modal.tracks) ? modal.tracks : [];
      const idx = clamp(normalizeNumber(trackIndex, 0), 0, EFFECT_TRACK_LIMIT - 1);
      const track = tracks[idx] || buildDefaultEffectTrack('solid', idx);
      if (field === 'enabled') {
        track.enabled = !!target.checked;
      } else if (field === 'port') {
        track.port = clamp(normalizeNumber(target.value, track.port), 1, 3);
      } else if (field === 'template_id') {
        const nextTrack = effectTrackFromTemplate(target.value, idx, {
          id: track.id,
          enabled: track.enabled,
          port: track.port,
          led_count: track.led_count,
          led_start: track.led_start,
          led_end: track.led_end,
          gap: track.gap,
          brightness: track.brightness,
          frequency_hz: track.frequency_hz,
          period_ms: track.period_ms,
          duty: track.duty,
          repeat: track.repeat,
          accel: track.accel,
          pulse_speed_start: track.pulse_speed_start,
          pulse_speed_end: track.pulse_speed_end,
          pulse_duration_ms: track.pulse_duration_ms,
          end_hold_ms: track.end_hold_ms,
          end_behavior: track.end_behavior
        });
        nextTrack.enabled = track.enabled !== false;
        nextTrack.port = clamp(normalizeNumber(track.port, idx + 1), 1, 3);
        tracks[idx] = nextTrack;
        modal.tracks = tracks.slice(0, EFFECT_TRACK_LIMIT);
        renderDialogs();
        return;
      } else if (field === 'colorA' || field === 'colorB' || field === 'colorC') {
        const colors = Array.isArray(track.colors) ? track.colors.slice(0, 3) : effectTrackPalette(idx);
        const colorIndex = field === 'colorA' ? 0 : field === 'colorB' ? 1 : 2;
        colors[colorIndex] = target.value;
        track.colors = colors;
      } else {
        track[field] = target.value;
      }
      tracks[idx] = track;
      modal.tracks = tracks.slice(0, EFFECT_TRACK_LIMIT);
      updateEffectPreviewNodes();
      return;
    }
    if (target.matches('[data-role="effect-track-field"]')) {
      const trackIndex = normalizeNumber(target.dataset.trackIndex, 0);
      const field = target.dataset.trackField;
      if (target.type === 'checkbox') {
        updateSelectedEffectTrackField(trackIndex, field, target.checked);
      } else {
        updateSelectedEffectTrackField(trackIndex, field, target.value);
      }
    }
  }

  function handleChange(event) {
    const target = event.target;
    if (target.matches('[data-role="signal-test-field"]')) {
      handleInput(event);
      return;
    }
    if (target.matches('[data-action="device-filter-group"]')) {
      state.deviceFilterMode = 'group';
      state.deviceFilterGroupId = normalizeNumber(target.value, -1);
      state.localState.ui.device_filter_mode = 'group';
      state.localState.ui.device_filter_group_id = state.deviceFilterGroupId;
      persistStateToServer();
      render();
      return;
    }
    if (target.matches('[data-role="template-field"]')) {
      updateSelectedTemplateField(target.dataset.templateField, target.value);
      return;
    }
    if (target.matches('[data-role="wizard-effect-rule"]')) {
      updateWizardEffectRule(target.dataset.sourceGid, target.dataset.targetGid, target.dataset.ruleField, target.value);
      return;
    }
    if (target.matches('[data-role="wizard-effect-batch"]')) {
      applyWizardEffectRuleBatch(target.dataset.ruleField, target.value);
      return;
    }
    if (target.matches('[data-role="template-form-input"]')) {
      if (!state.templateFormModal) return;
      const field = target.dataset.templateFormField;
      if (field === 'name' || field === 'note' || field === 'feature_preset_id' || field === 'effect_preset_id' || field === 'source_group_mode' || field === 'target_group_mode' || field === 'sense_mode' || field === 'idle_effect_id' || field === 'trigger_effect_id' || field === 'scoring_mode' || field === 'scoring_max_find') {
        state.templateFormModal[field] = target.value;
      }
      return;
    }
    if (target.matches('[data-role="feature-preset-field"]')) {
      updateSelectedFeaturePresetField(target.dataset.presetField, target.value);
      return;
    }
    if (target.matches('[data-role="effect-preset-field"]')) {
      updateSelectedEffectPresetField(target.dataset.presetField, target.value);
      return;
    }
    if (target.matches('[data-role="effect-form-input"]')) {
      if (!state.effectFormModal) return;
      const field = target.dataset.effectFormField;
      if (field === 'name' || field === 'note') {
        state.effectFormModal[field] = target.value;
      } else if (field === 'source_template_id') {
        state.effectFormModal.source_template_id = target.value;
      }
      return;
    }
    if (target.matches('[data-role="preview-effect-select"]')) {
      state.localState.ui.selected_effect_preset_id = String(target.value || '');
      state.selectedEffectId = state.localState.ui.selected_effect_preset_id;
      persistStateToServer();
      render();
      return;
    }
    if (target.matches('[data-role="effect-form-track-field"]')) {
      const trackIndex = normalizeNumber(target.dataset.trackIndex, 0);
      const field = target.dataset.trackField;
      const modal = ensureEffectFormModal();
      if (!modal) return;
      const tracks = Array.isArray(modal.tracks) ? modal.tracks : [];
      const idx = clamp(normalizeNumber(trackIndex, 0), 0, EFFECT_TRACK_LIMIT - 1);
      const track = tracks[idx] || buildDefaultEffectTrack('solid', idx);
      if (target.type === 'checkbox') {
        track[field] = target.checked;
      } else if (field === 'port') {
        track[field] = clamp(normalizeNumber(target.value, track[field]), 1, 3);
      } else if (field === 'template_id') {
        const nextTrack = effectTrackFromTemplate(target.value, idx, {
          id: track.id,
          enabled: track.enabled,
          port: track.port,
          led_count: track.led_count,
          led_start: track.led_start,
          led_end: track.led_end,
          gap: track.gap,
          brightness: track.brightness,
          frequency_hz: track.frequency_hz,
          period_ms: track.period_ms,
          duty: track.duty,
          repeat: track.repeat,
          accel: track.accel,
          pulse_speed_start: track.pulse_speed_start,
          pulse_speed_end: track.pulse_speed_end,
          pulse_duration_ms: track.pulse_duration_ms,
          end_hold_ms: track.end_hold_ms,
          end_behavior: track.end_behavior
        });
        nextTrack.enabled = track.enabled !== false;
        nextTrack.port = clamp(normalizeNumber(track.port, idx + 1), 1, 3);
        tracks[idx] = nextTrack;
        modal.tracks = tracks.slice(0, EFFECT_TRACK_LIMIT);
        renderDialogs();
        return;
      } else if (field === 'colorA' || field === 'colorB' || field === 'colorC') {
        const colors = Array.isArray(track.colors) ? track.colors.slice(0, 3) : effectTrackPalette(idx);
        const colorIndex = field === 'colorA' ? 0 : field === 'colorB' ? 1 : 2;
        colors[colorIndex] = target.value;
        track.colors = colors;
      } else {
        track[field] = target.value;
      }
      tracks[idx] = track;
      modal.tracks = tracks.slice(0, EFFECT_TRACK_LIMIT);
      updateEffectPreviewNodes();
      return;
    }
    if (target.matches('[data-role="effect-track-field"]')) {
      const trackIndex = normalizeNumber(target.dataset.trackIndex, 0);
      const field = target.dataset.trackField;
      if (target.type === 'checkbox') {
        updateSelectedEffectTrackField(trackIndex, field, target.checked);
      } else {
        updateSelectedEffectTrackField(trackIndex, field, target.value);
      }
      return;
    }
  }

  function setupBody() {
    document.body.innerHTML = '<div id="mw-app-root"></div><div id="mw-dialog-root"></div>';
    const appRoot = document.getElementById('mw-app-root');
    const dialogRoot = document.getElementById('mw-dialog-root');
    for (const root of [appRoot, dialogRoot]) {
      root.addEventListener('click', handleClick);
      root.addEventListener('change', handleChange);
      root.addEventListener('input', handleInput);
    }
    dialogRoot.addEventListener('scroll', (event) => {
      const target = event.target;
      if (target && target.matches && target.matches('[data-room-prepare-scroll-root]') && state.roomPrepareModal) {
        state.roomPrepareModal.scrollTop = target.scrollTop;
      }
    }, true);
  }

  function installKeyboardShortcuts() {
    window.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveLocalConfig();
      }
      if (event.key === 'Escape' && state.roomPresentationMode) {
        state.roomPresentationMode = false;
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        render();
        return;
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
    state.localState.ui.expanded_group_id = -1;
    state.roomRecords = normalizeRoomRecords(loadRoomBackupOrDefault());
    state.controllerState = mergeDraftsIntoController(buildOfflineControllerState(), state.localState);
    state.selectedTemplateId = state.localState.ui.selected_template_id || builtinTemplates[0].id;
    state.activeTab = state.localState.ui.active_tab || 'overview';
    state.deviceFilterMode = state.localState.ui.device_filter_mode || 'ungrouped';
    state.deviceFilterGroupId = normalizeNumber(state.localState.ui.device_filter_group_id, -1);
    render();
    await loadInitialState();
    render();
    setInterval(() => {
      if (state.previewPlaying) state.previewTick++;
      updateEffectPreviewNodes();
    }, PREVIEW_FRAME_MS);
    setInterval(() => {
      if (!state.controllerOnline) return;
      if (state.busy.controller || state.busy.publish || state.preparingRoomId) return;
      if (state.roomPrepareModal) return;
      if (shouldPauseAutoRefresh()) return;
      const room = currentRoom();
      const shouldRefresh = state.activeTab === 'room' || state.signalTest?.running === true || !!state.roomStartCountdown || (room && (room.status === 'running' || room.status === 'published'));
      if (shouldRefresh) {
        loadFromController();
      }
    }, 2500);
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




