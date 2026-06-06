// ESP32-C6 controller - group center edition
// Keeps the AP web UI, ESP-NOW broadcast commands, device discovery,
// multi-group assignment, and source->target discovery records.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <ctype.h>
#include <errno.h>

#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_now.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"

static const char *TAG = "MAGIC_CTRL";

#define WIFI_AP_SSID "MagicWand-v017"
#define WIFI_AP_CHANNEL 1
#define WIFI_AP_MAX_CONN 4
#define BTN_BOOT ((gpio_num_t)9)

#define MAX_DEVICES 32
#define MAX_GROUPS 16
#define MAX_DISCOVERY_RECORDS 64
#define MAX_RUNTIME_EVENTS 64
#define MAX_RUNTIME_STATS MAX_DEVICES
#define MAX_PAIR_BINDINGS 64
#define CONFIG_IMPORT_MAX_BODY (32 * 1024)
#define SIGNAL_TEST_ROOM_HASH 65001

#define DEVICE_NAME_LEN 32
#define FW_TEXT_LEN 24
#define GROUP_TEXT_LEN 384
#define WEB_UI_VERSION "v0.2.7"
#define MAGICWAND_RELEASE_VERSION "v1.0.3"
#define MAGICWAND_CONTROLLER_BUILD "2026.06.06.1215"
#define MAGICWAND_EXPECTED_RECEIVER_BUILD "2026.06.06.1215"
#define CONFIG_SCHEMA_VERSION 3

typedef enum {
    GROUP_MODE_SHARED = 0,
    GROUP_MODE_INDEPENDENT = 1,
} group_mode_t;

typedef struct {
    uint8_t mac[6];
    char name[DEVICE_NAME_LEN];
    int rssi;
    int64_t last_seen_ms;
} receiver_device_v1_t;

typedef struct {
    uint8_t mac[6];
    char name[DEVICE_NAME_LEN];
    uint32_t group_mask;
    int rssi;
    int64_t last_seen_ms;
} receiver_device_v2_t;

typedef struct {
    uint8_t mac[6];
    char name[DEVICE_NAME_LEN];
    uint32_t group_mask;
    int rssi;
    int64_t last_seen_ms;
    char release_version[FW_TEXT_LEN];
    char firmware_version[FW_TEXT_LEN];
} receiver_device_t;

typedef struct {
    uint8_t valid;
    char name[DEVICE_NAME_LEN];
    char note[GROUP_TEXT_LEN];
    char effect_note[GROUP_TEXT_LEN];
    char silence_note[GROUP_TEXT_LEN];
    char trigger_effect_note[GROUP_TEXT_LEN];
    uint32_t peer_mask;
    uint16_t room_hash;
    uint8_t target_group;      // 0xFF = none
    uint8_t mode;              // GROUP_MODE_*
    int16_t rssi_threshold;    // placeholder for future proximity logic
    uint16_t hold_ms;          // placeholder for future proximity logic
    uint8_t trigger_compare;   // 0 = gte, 1 = lte
    uint8_t rule_id;
    uint8_t rule_base;         // 1 instant, 2 sustain, 3 competition
    uint8_t rule_judge;        // 0 none, 1 source, 2 target
    uint8_t rule_signal;       // v3 signal code
    int16_t rule_rssi_min;
    int16_t rule_rssi_max;     // -127 = unused
    uint16_t rule_missing_ms;
    uint8_t rule_smooth_samples;
    uint8_t rule_trigger;      // v3 trigger code
    uint32_t rule_target_ms;
    uint16_t rule_target_count;
    uint32_t rule_period_ms;
    uint8_t rule_score_target;
    int16_t rule_points;
    uint8_t rule_repeat;
    uint32_t rule_cooldown_ms;
    uint8_t rule_after;
    uint8_t meter_enabled;
    uint8_t meter_port;
    uint16_t meter_led_count;
    int16_t meter_weak_rssi;
    int16_t meter_strong_rssi;
    uint16_t meter_compression_x100;
} group_config_t;

typedef struct {
    uint8_t source_group;
    uint8_t target_group;
    int16_t source_device_index; // -1 = group-level record
    int16_t target_device_index; // -1 = unspecified
    uint8_t source_mac[6];
    uint8_t target_mac[6];
    int64_t first_seen_ms;
    int64_t last_seen_ms;
} discovery_record_t;

typedef struct {
    uint16_t room_hash;
    uint8_t self_mac[6];
    uint8_t peer_mac[6];
    int16_t self_device_index;
    int16_t peer_device_index;
    uint32_t self_group_mask;
    uint32_t peer_group_mask;
    int16_t rssi;
    uint8_t kind;
    int16_t points;
    uint32_t seq;
    int64_t event_ms;
} runtime_event_t;

typedef struct {
    uint8_t valid;
    uint16_t room_hash;
    uint8_t self_mac[6];
    uint16_t seen_count;
    uint16_t found_count;
    int16_t best_rssi;
    uint8_t best_peer_mac[6];
    uint32_t active_ms;
    uint32_t seq;
    int64_t last_seen_ms;
} runtime_stat_t;

typedef struct {
    uint8_t valid;
    uint8_t rule_id;
    uint8_t source_mac[6];
    uint8_t target_mac[6];
    uint8_t source_group_id;
    uint8_t target_group_id;
} pair_binding_t;

typedef struct {
    char *buf;
    size_t len;
    size_t cap;
} strbuf_t;

static const uint8_t broadcast_mac[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static bool next_button_stop = true;

static receiver_device_t devices[MAX_DEVICES];
static receiver_device_v1_t legacy_devices[MAX_DEVICES];
static receiver_device_v2_t legacy_devices_v2[MAX_DEVICES];
static group_config_t groups[MAX_GROUPS];
static discovery_record_t records[MAX_DISCOVERY_RECORDS];
static runtime_event_t runtime_events[MAX_RUNTIME_EVENTS];
static runtime_stat_t runtime_stats[MAX_RUNTIME_STATS];
static pair_binding_t pair_bindings[MAX_PAIR_BINDINGS];

static int device_count = 0;
static int record_count = 0;
static int runtime_event_count = 0;
static int pair_binding_count = 0;
static volatile bool runtime_running = false;
static int64_t runtime_started_ms = 0;
static portMUX_TYPE state_mux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool registry_dirty = false;

static void mac_to_string(const uint8_t *mac, char *out, size_t out_size);
static bool group_bit_valid(int gid);
static void make_default_device_name(int index, char *out, size_t out_size)
{
    snprintf(out, out_size, "Fragment%d", index + 1);
}

static void make_default_group_name(int index, char *out, size_t out_size)
{
    snprintf(out, out_size, "Group%d", index + 1);
}

static bool normalize_device_name_for_index(int index, char *name, size_t name_size)
{
    if (!name || name_size == 0 || name[0] != '\0') {
        return false;
    }
    make_default_device_name(index, name, name_size);
    return true;
}


static const char INDEX_HTML[] = R"HTML(<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Magic Wand Controller</title>
<style>
body{margin:0;background:#101820;color:#eef4ff;font-family:Arial,sans-serif;padding:22px}h1{font-size:28px;margin:0 0 6px}.muted{color:#9fb1c7}.row{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}button{border:0;border-radius:10px;padding:14px 18px;font-weight:700;font-size:17px}.start{background:#70d394}.stop{background:#f57373}.blue{background:#76c7ff}.yellow{background:#f4d56b}.red{background:#ff7979}.card{border:1px solid #2c4058;background:#17212d;border-radius:10px;padding:14px;margin:12px 0}input{box-sizing:border-box;width:100%;border:1px solid #38506b;border-radius:8px;background:#0b1118;color:#eef4ff;padding:10px;font-size:16px}.chips{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.chip{border:1px solid #38506b;border-radius:999px;padding:8px 10px}.top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.actions{display:flex;gap:8px;flex-wrap:wrap}.small{font-size:14px;padding:10px 12px}pre{white-space:pre-wrap;color:#9fb1c7}</style>
</head><body>
<div class="top"><div><h1>Magic Wand Controller</h1><div class="muted">UI v0.2.5 / field panel</div></div><div id="status" class="muted">Loading...</div></div>
<div class="row"><button class="start" onclick="cmd('START')">START</button><button class="stop" onclick="cmd('STOP')">STOP</button><button class="blue" onclick="cmd('IDENTIFY')">IDENTIFY ALL</button><button class="yellow" onclick="scan()">SCAN</button></div>
<h2>Devices</h2><div id="devices"></div><h2>Valid Groups</h2><div id="groups"></div>
<script>
let state={devices:[],groups:[]};
function qs(id){return document.getElementById(id)}
function enc(v){return encodeURIComponent(v||'')}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
async function get(path){const r=await fetch(path+(path.includes('?')?'&':'?')+'t='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error(await r.text());return r}
async function cmd(name){try{await get('/cmd?name='+enc(name));qs('status').textContent=name+' sent';}catch(e){qs('status').textContent='Command failed: '+e.message}}
async function scan(){try{await get('/scan');qs('status').textContent='Scan sent';setTimeout(load,900)}catch(e){qs('status').textContent='Scan failed: '+e.message}}
async function identify(i){try{await get('/identify?idx='+i);qs('status').textContent='Identify sent'}catch(e){qs('status').textContent='Identify failed: '+e.message}}
async function saveDev(i){const d=state.devices[i];const name=qs('name_'+i).value;let mask=0;state.groups.forEach(g=>{if(g.valid&&qs('g_'+i+'_'+g.id)?.checked)mask|=(1<<g.id)});try{await get('/device_save?idx='+i+'&name='+enc(name)+'&groups='+mask);qs('status').textContent='Device saved';await load()}catch(e){qs('status').textContent='Save failed: '+e.message}}
async function delDev(i){if(!confirm('Delete this device from controller?'))return;try{await get('/device_delete?idx='+i);qs('status').textContent='Device deleted';await load()}catch(e){qs('status').textContent='Delete failed: '+e.message}}
function render(){const groups=state.groups||[];qs('groups').innerHTML=groups.filter(g=>g.valid).map(g=>`<div class="chip">#${g.id} ${esc(g.name||('Group'+(g.id+1)))}</div>`).join('')||'<div class="muted">No valid group.</div>';qs('devices').innerHTML=(state.devices||[]).map((d,i)=>`<div class="card"><div class="top"><div><b>#${i} ${esc(d.name||('Fragment'+(i+1)))}</b><div class="muted">MAC ${esc(d.mac)} / RSSI ${d.rssi} dBm / seen ${d.seen_ms} ms ago</div></div><div class="actions"><button class="blue small" onclick="identify(${i})">Identify</button><button class="yellow small" onclick="saveDev(${i})">Save</button><button class="red small" onclick="delDev(${i})">Delete</button></div></div><label>Name</label><input id="name_${i}" value="${esc(d.name||('Fragment'+(i+1)))}"><div class="chips">${groups.filter(g=>g.valid).map(g=>`<label class="chip"><input id="g_${i}_${g.id}" type="checkbox" ${((d.group_mask||0)&(1<<g.id))?'checked':''}> #${g.id} ${esc(g.name||('Group'+(g.id+1)))}</label>`).join('')||'<span class="muted">No group.</span>'}</div></div>`).join('')||'<div class="muted">No receiver found yet.</div>'}
async function load(){try{const r=await get('/state');state=await r.json();render();qs('status').textContent='Online'}catch(e){qs('status').textContent='Load failed: '+e.message}}
load();setInterval(load,5000);
</script></body></html>)HTML";

static void mac_to_string(const uint8_t *mac, char *out, size_t out_size)
{
    if (!out || out_size == 0) return;
    if (!mac) {
        snprintf(out, out_size, "00:00:00:00:00:00");
        return;
    }
    snprintf(out, out_size, "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

static int hex_value(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static void url_decode_component(const char *input, char *output, size_t output_size)
{
    size_t out = 0;
    for (size_t in = 0; input[in] != '\0' && out < output_size - 1; in++) {
        if (input[in] == '%' && input[in + 1] != '\0' && input[in + 2] != '\0') {
            int hi = hex_value(input[in + 1]);
            int lo = hex_value(input[in + 2]);
            if (hi >= 0 && lo >= 0) {
                output[out++] = (char)((hi << 4) | lo);
                in += 2;
                continue;
            }
        }
        output[out++] = (input[in] == '+') ? ' ' : input[in];
    }
    output[out] = '\0';
}

static bool parse_mac_string(const char *text, uint8_t *mac)
{
    char decoded[64];
    char hex_only[13] = {0};
    int hex_count = 0;

    url_decode_component(text, decoded, sizeof(decoded));
    for (int i = 0; decoded[i] != '\0' && hex_count < 12; i++) {
        if ((decoded[i] >= '0' && decoded[i] <= '9') ||
            (decoded[i] >= 'a' && decoded[i] <= 'f') ||
            (decoded[i] >= 'A' && decoded[i] <= 'F')) {
            hex_only[hex_count++] = decoded[i];
        }
    }

    if (hex_count != 12) return false;

    for (int i = 0; i < 6; i++) {
        char byte_text[3] = {hex_only[i * 2], hex_only[i * 2 + 1], '\0'};
        unsigned int value = 0;
        if (sscanf(byte_text, "%02x", &value) != 1 || value > 0xFF) {
            return false;
        }
        mac[i] = (uint8_t)value;
    }
    return true;
}

typedef struct {
    const char *p;
} json_reader_t;

static void jr_skip_ws(json_reader_t *jr)
{
    while (jr->p && *jr->p != '\0' && isspace((unsigned char)*jr->p)) {
        jr->p++;
    }
}

static bool jr_consume(json_reader_t *jr, char c)
{
    jr_skip_ws(jr);
    if (*jr->p != c) return false;
    jr->p++;
    return true;
}

static bool jr_read_string(json_reader_t *jr, char *out, size_t out_size)
{
    jr_skip_ws(jr);
    if (*jr->p != '"') return false;
    jr->p++;

    size_t out_pos = 0;
    while (*jr->p && *jr->p != '"') {
        char c = *jr->p++;
        if (c == '\\') {
            c = *jr->p++;
            if (c == '\0') return false;
            switch (c) {
                case '"':
                case '\\':
                case '/':
                    break;
                case 'b': c = '\b'; break;
                case 'f': c = '\f'; break;
                case 'n': c = '\n'; break;
                case 'r': c = '\r'; break;
                case 't': c = '\t'; break;
                case 'u':
                    if (hex_value(jr->p[0]) < 0 || hex_value(jr->p[1]) < 0 ||
                        hex_value(jr->p[2]) < 0 || hex_value(jr->p[3]) < 0) {
                        return false;
                    }
                    jr->p += 4;
                    c = '?';
                    break;
                default:
                    return false;
            }
        }

        if (out && out_size > 0 && out_pos + 1 < out_size) {
            out[out_pos++] = c;
        }
    }

    if (*jr->p != '"') return false;
    jr->p++;
    if (out && out_size > 0) {
        out[out_pos] = '\0';
    }
    return true;
}

static bool jr_parse_int64(json_reader_t *jr, int64_t *out)
{
    jr_skip_ws(jr);
    errno = 0;
    char *end = NULL;
    long long value = strtoll(jr->p, &end, 10);
    if (end == jr->p || errno == ERANGE) return false;
    jr->p = end;
    *out = (int64_t)value;
    return true;
}

static bool jr_parse_bool(json_reader_t *jr, bool *out)
{
    jr_skip_ws(jr);
    if (strncmp(jr->p, "true", 4) == 0) {
        jr->p += 4;
        *out = true;
        return true;
    }
    if (strncmp(jr->p, "false", 5) == 0) {
        jr->p += 5;
        *out = false;
        return true;
    }
    return false;
}

static bool jr_skip_value(json_reader_t *jr)
{
    jr_skip_ws(jr);
    if (*jr->p == '"') {
        return jr_read_string(jr, NULL, 0);
    }
    if (*jr->p == '{') {
        jr->p++;
        jr_skip_ws(jr);
        if (*jr->p == '}') {
            jr->p++;
            return true;
        }
        while (1) {
            char key[32];
            if (!jr_read_string(jr, key, sizeof(key))) return false;
            if (!jr_consume(jr, ':')) return false;
            if (!jr_skip_value(jr)) return false;
            jr_skip_ws(jr);
            if (jr_consume(jr, ',')) continue;
            if (jr_consume(jr, '}')) return true;
            return false;
        }
    }
    if (*jr->p == '[') {
        jr->p++;
        jr_skip_ws(jr);
        if (*jr->p == ']') {
            jr->p++;
            return true;
        }
        while (1) {
            if (!jr_skip_value(jr)) return false;
            jr_skip_ws(jr);
            if (jr_consume(jr, ',')) continue;
            if (jr_consume(jr, ']')) return true;
            return false;
        }
    }
    if (strncmp(jr->p, "true", 4) == 0) {
        jr->p += 4;
        return true;
    }
    if (strncmp(jr->p, "false", 5) == 0) {
        jr->p += 5;
        return true;
    }
    if (strncmp(jr->p, "null", 4) == 0) {
        jr->p += 4;
        return true;
    }
    if (*jr->p == '-' || isdigit((unsigned char)*jr->p)) {
        char *end = NULL;
        (void)strtoll(jr->p, &end, 10);
        if (end == jr->p) return false;
        jr->p = end;
        return true;
    }
    return false;
}

static bool parse_import_device_object(json_reader_t *jr, receiver_device_t *dst, int64_t now_ms)
{
    memset(dst, 0, sizeof(*dst));
    bool have_mac = false;
    bool have_name = false;
    int64_t seen_age_ms = -1;

    if (!jr_consume(jr, '{')) return false;
    while (1) {
        jr_skip_ws(jr);
        if (jr_consume(jr, '}')) break;

        char key[32];
        if (!jr_read_string(jr, key, sizeof(key))) return false;
        if (!jr_consume(jr, ':')) return false;

        if (strcmp(key, "mac") == 0) {
            char mac_text[64];
            if (!jr_read_string(jr, mac_text, sizeof(mac_text)) || !parse_mac_string(mac_text, dst->mac)) {
                return false;
            }
            have_mac = true;
        } else if (strcmp(key, "name") == 0) {
            if (!jr_read_string(jr, dst->name, sizeof(dst->name))) return false;
            have_name = true;
        } else if (strcmp(key, "group_mask") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > (int64_t)UINT32_MAX) return false;
            dst->group_mask = (uint32_t)value;
        } else if (strcmp(key, "rssi") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value)) return false;
            dst->rssi = (int)value;
        } else if (strcmp(key, "seen_ms") == 0) {
            if (!jr_parse_int64(jr, &seen_age_ms) || seen_age_ms < 0) return false;
        } else if (strcmp(key, "release_version") == 0) {
            if (!jr_read_string(jr, dst->release_version, sizeof(dst->release_version))) return false;
        } else if (strcmp(key, "firmware_version") == 0 || strcmp(key, "fw_version") == 0) {
            if (!jr_read_string(jr, dst->firmware_version, sizeof(dst->firmware_version))) return false;
        } else {
            if (!jr_skip_value(jr)) return false;
        }

        jr_skip_ws(jr);
        if (jr_consume(jr, ',')) continue;
        if (jr_consume(jr, '}')) break;
        return false;
    }

    if (!have_mac) return false;
    if (!have_name) {
        dst->name[0] = '\0';
    }
    dst->last_seen_ms = (seen_age_ms >= 0) ? ((now_ms - seen_age_ms) >= 0 ? (now_ms - seen_age_ms) : 0) : now_ms;
    return true;
}

static bool parse_import_group_object(json_reader_t *jr, group_config_t *dst, int *group_id_out)
{
    memset(dst, 0, sizeof(*dst));
    dst->target_group = 0xFF;
    dst->mode = GROUP_MODE_SHARED;

    bool have_id = false;
    int group_id = -1;

    if (!jr_consume(jr, '{')) return false;
    while (1) {
        jr_skip_ws(jr);
        if (jr_consume(jr, '}')) break;

        char key[32];
        if (!jr_read_string(jr, key, sizeof(key))) return false;
        if (!jr_consume(jr, ':')) return false;

        if (strcmp(key, "id") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value >= MAX_GROUPS) return false;
            group_id = (int)value;
            have_id = true;
        } else if (strcmp(key, "valid") == 0) {
            bool value = false;
            if (!jr_parse_bool(jr, &value)) return false;
            dst->valid = value ? 1 : 0;
        } else if (strcmp(key, "name") == 0) {
            if (!jr_read_string(jr, dst->name, sizeof(dst->name))) return false;
        } else if (strcmp(key, "note") == 0) {
            if (!jr_read_string(jr, dst->note, sizeof(dst->note))) return false;
        } else if (strcmp(key, "effect") == 0) {
            if (!jr_read_string(jr, dst->effect_note, sizeof(dst->effect_note))) return false;
        } else if (strcmp(key, "trigger_effect") == 0) {
            if (!jr_read_string(jr, dst->trigger_effect_note, sizeof(dst->trigger_effect_note))) return false;
        } else if (strcmp(key, "silence") == 0) {
            if (!jr_read_string(jr, dst->silence_note, sizeof(dst->silence_note))) return false;
        } else if (strcmp(key, "peer_mask") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > (int64_t)UINT32_MAX) return false;
            dst->peer_mask = (uint32_t)value;
        } else if (strcmp(key, "room_hash") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > UINT16_MAX) return false;
            dst->room_hash = (uint16_t)value;
        } else if (strcmp(key, "target") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < -1 || value > 255) return false;
            dst->target_group = (value < 0) ? 0xFF : (uint8_t)value;
        } else if (strcmp(key, "mode") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > 255) return false;
            dst->mode = (uint8_t)value;
        } else if (strcmp(key, "trigger_compare") == 0) {
            char value[8] = {0};
            if (!jr_read_string(jr, value, sizeof(value))) return false;
            dst->trigger_compare = (strcmp(value, "lte") == 0) ? 1 : 0;
        } else if (strcmp(key, "rssi") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < INT16_MIN || value > INT16_MAX) return false;
            dst->rssi_threshold = (int16_t)value;
        } else if (strcmp(key, "hold") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > UINT16_MAX) return false;
            dst->hold_ms = (uint16_t)value;
        } else if (strcmp(key, "rule_id") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > 255) return false;
            dst->rule_id = (uint8_t)value;
        } else if (strcmp(key, "rule_base") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > 255) return false;
            dst->rule_base = (uint8_t)value;
        } else if (strcmp(key, "rule_judge") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > 255) return false;
            dst->rule_judge = (uint8_t)value;
        } else if (strcmp(key, "rule_signal") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > 255) return false;
            dst->rule_signal = (uint8_t)value;
        } else if (strcmp(key, "rule_rssi_min") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < INT16_MIN || value > INT16_MAX) return false;
            dst->rule_rssi_min = (int16_t)value;
        } else if (strcmp(key, "rule_rssi_max") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < INT16_MIN || value > INT16_MAX) return false;
            dst->rule_rssi_max = (int16_t)value;
        } else if (strcmp(key, "rule_missing_ms") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > UINT16_MAX) return false;
            dst->rule_missing_ms = (uint16_t)value;
        } else if (strcmp(key, "rule_smooth_samples") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 1 || value > 10) return false;
            dst->rule_smooth_samples = (uint8_t)value;
        } else if (strcmp(key, "rule_trigger") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > 255) return false;
            dst->rule_trigger = (uint8_t)value;
        } else if (strcmp(key, "rule_target_ms") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > INT32_MAX) return false;
            dst->rule_target_ms = (uint32_t)value;
        } else if (strcmp(key, "rule_target_count") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > UINT16_MAX) return false;
            dst->rule_target_count = (uint16_t)value;
        } else if (strcmp(key, "rule_period_ms") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > INT32_MAX) return false;
            dst->rule_period_ms = (uint32_t)value;
        } else if (strcmp(key, "rule_score_target") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > 255) return false;
            dst->rule_score_target = (uint8_t)value;
        } else if (strcmp(key, "rule_points") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < INT16_MIN || value > INT16_MAX) return false;
            dst->rule_points = (int16_t)value;
        } else if (strcmp(key, "rule_repeat") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > 255) return false;
            dst->rule_repeat = (uint8_t)value;
        } else if (strcmp(key, "rule_cooldown_ms") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > INT32_MAX) return false;
            dst->rule_cooldown_ms = (uint32_t)value;
        } else if (strcmp(key, "rule_after") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > 255) return false;
            dst->rule_after = (uint8_t)value;
        } else if (strcmp(key, "meter_enabled") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > 1) return false;
            dst->meter_enabled = (uint8_t)value;
        } else if (strcmp(key, "meter_port") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 1 || value > 3) return false;
            dst->meter_port = (uint8_t)value;
        } else if (strcmp(key, "meter_led_count") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 1 || value > 200) return false;
            dst->meter_led_count = (uint16_t)value;
        } else if (strcmp(key, "meter_weak_rssi") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < INT16_MIN || value > INT16_MAX) return false;
            dst->meter_weak_rssi = (int16_t)value;
        } else if (strcmp(key, "meter_strong_rssi") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < INT16_MIN || value > INT16_MAX) return false;
            dst->meter_strong_rssi = (int16_t)value;
        } else if (strcmp(key, "meter_compression_x100") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 20 || value > 500) return false;
            dst->meter_compression_x100 = (uint16_t)value;
        } else {
            if (!jr_skip_value(jr)) return false;
        }

        jr_skip_ws(jr);
        if (jr_consume(jr, ',')) continue;
        if (jr_consume(jr, '}')) break;
        return false;
    }

    if (!have_id) return false;
    *group_id_out = group_id;
    return true;
}

static bool parse_import_record_object(json_reader_t *jr, discovery_record_t *dst)
{
    memset(dst, 0, sizeof(*dst));
    dst->source_device_index = -1;
    dst->target_device_index = -1;

    bool have_src_group = false;
    bool have_target_group = false;
    bool have_first_seen = false;
    bool have_last_seen = false;
    int64_t src_idx = -1;
    int64_t dst_idx = -1;

    if (!jr_consume(jr, '{')) return false;
    while (1) {
        jr_skip_ws(jr);
        if (jr_consume(jr, '}')) break;

        char key[32];
        if (!jr_read_string(jr, key, sizeof(key))) return false;
        if (!jr_consume(jr, ':')) return false;

        if (strcmp(key, "src_group") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || !group_bit_valid((int)value)) return false;
            dst->source_group = (uint8_t)value;
            have_src_group = true;
        } else if (strcmp(key, "target_group") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || !group_bit_valid((int)value)) return false;
            dst->target_group = (uint8_t)value;
            have_target_group = true;
        } else if (strcmp(key, "src_idx") == 0) {
            if (!jr_parse_int64(jr, &src_idx) || src_idx < -1 || src_idx >= MAX_DEVICES) return false;
        } else if (strcmp(key, "dst_idx") == 0) {
            if (!jr_parse_int64(jr, &dst_idx) || dst_idx < -1 || dst_idx >= MAX_DEVICES) return false;
        } else if (strcmp(key, "first_seen_ms") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value)) return false;
            dst->first_seen_ms = value;
            have_first_seen = true;
        } else if (strcmp(key, "last_seen_ms") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value)) return false;
            dst->last_seen_ms = value;
            have_last_seen = true;
        } else if (strcmp(key, "source_mac") == 0) {
            char mac_text[64];
            if (!jr_read_string(jr, mac_text, sizeof(mac_text)) || !parse_mac_string(mac_text, dst->source_mac)) {
                return false;
            }
        } else if (strcmp(key, "target_mac") == 0) {
            char mac_text[64];
            if (!jr_read_string(jr, mac_text, sizeof(mac_text)) || !parse_mac_string(mac_text, dst->target_mac)) {
                return false;
            }
        } else {
            if (!jr_skip_value(jr)) return false;
        }

        jr_skip_ws(jr);
        if (jr_consume(jr, ',')) continue;
        if (jr_consume(jr, '}')) break;
        return false;
    }

    if (!have_src_group || !have_target_group || !have_first_seen || !have_last_seen) return false;
    dst->source_device_index = (int16_t)src_idx;
    dst->target_device_index = (int16_t)dst_idx;
    return true;
}

static bool parse_import_pair_binding_object(json_reader_t *jr, pair_binding_t *dst)
{
    memset(dst, 0, sizeof(*dst));
    dst->source_group_id = 0xFF;
    dst->target_group_id = 0xFF;
    bool have_source_mac = false;
    bool have_target_mac = false;

    if (!jr_consume(jr, '{')) return false;
    while (1) {
        jr_skip_ws(jr);
        if (jr_consume(jr, '}')) break;

        char key[32];
        if (!jr_read_string(jr, key, sizeof(key))) return false;
        if (!jr_consume(jr, ':')) return false;

        if (strcmp(key, "rule_id") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > 255) return false;
            dst->rule_id = (uint8_t)value;
        } else if (strcmp(key, "source_mac") == 0) {
            char mac_text[32];
            if (!jr_read_string(jr, mac_text, sizeof(mac_text)) || !parse_mac_string(mac_text, dst->source_mac)) return false;
            have_source_mac = true;
        } else if (strcmp(key, "target_mac") == 0) {
            char mac_text[32];
            if (!jr_read_string(jr, mac_text, sizeof(mac_text)) || !parse_mac_string(mac_text, dst->target_mac)) return false;
            have_target_mac = true;
        } else if (strcmp(key, "source_group_id") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < -1 || value >= MAX_GROUPS) return false;
            dst->source_group_id = value < 0 ? 0xFF : (uint8_t)value;
        } else if (strcmp(key, "target_group_id") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < -1 || value >= MAX_GROUPS) return false;
            dst->target_group_id = value < 0 ? 0xFF : (uint8_t)value;
        } else {
            if (!jr_skip_value(jr)) return false;
        }

        jr_skip_ws(jr);
        if (jr_consume(jr, ',')) continue;
        if (jr_consume(jr, '}')) break;
        return false;
    }

    dst->valid = (have_source_mac && have_target_mac) ? 1 : 0;
    if (dst->rule_id == 0) dst->rule_id = 1;
    return dst->valid == 1;
}

static bool parse_registry_import_json(const char *json,
                                       receiver_device_t *device_out,
                                       int *device_count_out,
                                       group_config_t *group_out,
                                       pair_binding_t *pair_binding_out,
                                       int *pair_binding_count_out,
                                       discovery_record_t *record_out,
                                       int *record_count_out,
                                       int *schema_version_out,
                                       char *error_text,
                                       size_t error_text_size)
{
    if (error_text && error_text_size > 0) error_text[0] = '\0';

    json_reader_t jr = {.p = json};
    int64_t schema_version = 0;
    bool have_schema = false;
    bool have_devices = false;
    bool have_groups = false;
    bool have_pair_bindings = false;
    bool have_records = false;
    bool group_seen[MAX_GROUPS] = {0};
    int device_count = 0;
    int pair_binding_count = 0;
    int record_count = 0;
    int64_t now_ms = esp_timer_get_time() / 1000;

    memset(device_out, 0, sizeof(receiver_device_t) * MAX_DEVICES);
    memset(group_out, 0, sizeof(group_config_t) * MAX_GROUPS);
    memset(pair_binding_out, 0, sizeof(pair_binding_t) * MAX_PAIR_BINDINGS);
    memset(record_out, 0, sizeof(discovery_record_t) * MAX_DISCOVERY_RECORDS);

    if (!jr_consume(&jr, '{')) {
        snprintf(error_text, error_text_size, "Root JSON object expected.");
        return false;
    }

    while (1) {
        jr_skip_ws(&jr);
        if (jr_consume(&jr, '}')) break;

        char key[32];
        if (!jr_read_string(&jr, key, sizeof(key))) {
            snprintf(error_text, error_text_size, "Invalid top-level key.");
            return false;
        }
        if (!jr_consume(&jr, ':')) {
            snprintf(error_text, error_text_size, "Missing ':' after key %s.", key);
            return false;
        }

        if (strcmp(key, "schema_version") == 0) {
            if (!jr_parse_int64(&jr, &schema_version) || schema_version < 0 || schema_version > 255) {
                snprintf(error_text, error_text_size, "Invalid schema_version.");
                return false;
            }
            have_schema = true;
        } else if (strcmp(key, "devices") == 0) {
            if (!jr_consume(&jr, '[')) {
                snprintf(error_text, error_text_size, "devices array expected.");
                return false;
            }
            jr_skip_ws(&jr);
            if (!jr_consume(&jr, ']')) {
                while (1) {
                    if (device_count >= MAX_DEVICES) {
                        snprintf(error_text, error_text_size, "Too many devices.");
                        return false;
                    }
                    if (!parse_import_device_object(&jr, &device_out[device_count], now_ms)) {
                        snprintf(error_text, error_text_size, "Invalid device entry.");
                        return false;
                    }
                    if (device_out[device_count].name[0] == '\0') {
                        make_default_device_name(device_count, device_out[device_count].name, sizeof(device_out[device_count].name));
                    }
                    device_count++;
                    jr_skip_ws(&jr);
                    if (jr_consume(&jr, ',')) continue;
                    if (jr_consume(&jr, ']')) break;
                    snprintf(error_text, error_text_size, "Invalid devices array syntax.");
                    return false;
                }
            }
            have_devices = true;
        } else if (strcmp(key, "groups") == 0) {
            if (!jr_consume(&jr, '[')) {
                snprintf(error_text, error_text_size, "groups array expected.");
                return false;
            }
            jr_skip_ws(&jr);
            if (!jr_consume(&jr, ']')) {
                while (1) {
                    int gid = -1;
                    group_config_t parsed = {};
                    if (!parse_import_group_object(&jr, &parsed, &gid)) {
                        snprintf(error_text, error_text_size, "Invalid group entry.");
                        return false;
                    }
                    if (group_seen[gid]) {
                        snprintf(error_text, error_text_size, "Duplicate group id %d.", gid);
                        return false;
                    }
                    group_seen[gid] = true;
                    group_out[gid] = parsed;
                    jr_skip_ws(&jr);
                    if (jr_consume(&jr, ',')) continue;
                    if (jr_consume(&jr, ']')) break;
                    snprintf(error_text, error_text_size, "Invalid groups array syntax.");
                    return false;
                }
            }
            have_groups = true;
        } else if (strcmp(key, "pair_bindings") == 0) {
            if (!jr_consume(&jr, '[')) {
                snprintf(error_text, error_text_size, "pair_bindings array expected.");
                return false;
            }
            jr_skip_ws(&jr);
            if (!jr_consume(&jr, ']')) {
                while (1) {
                    if (pair_binding_count >= MAX_PAIR_BINDINGS) {
                        snprintf(error_text, error_text_size, "Too many pair bindings.");
                        return false;
                    }
                    if (!parse_import_pair_binding_object(&jr, &pair_binding_out[pair_binding_count])) {
                        snprintf(error_text, error_text_size, "Invalid pair binding entry.");
                        return false;
                    }
                    pair_binding_count++;
                    jr_skip_ws(&jr);
                    if (jr_consume(&jr, ',')) continue;
                    if (jr_consume(&jr, ']')) break;
                    snprintf(error_text, error_text_size, "Invalid pair_bindings array syntax.");
                    return false;
                }
            }
            have_pair_bindings = true;
        } else if (strcmp(key, "records") == 0) {
            if (!jr_consume(&jr, '[')) {
                snprintf(error_text, error_text_size, "records array expected.");
                return false;
            }
            jr_skip_ws(&jr);
            if (!jr_consume(&jr, ']')) {
                while (1) {
                    if (record_count >= MAX_DISCOVERY_RECORDS) {
                        snprintf(error_text, error_text_size, "Too many records.");
                        return false;
                    }
                    if (!parse_import_record_object(&jr, &record_out[record_count])) {
                        snprintf(error_text, error_text_size, "Invalid record entry.");
                        return false;
                    }
                    record_count++;
                    jr_skip_ws(&jr);
                    if (jr_consume(&jr, ',')) continue;
                    if (jr_consume(&jr, ']')) break;
                    snprintf(error_text, error_text_size, "Invalid records array syntax.");
                    return false;
                }
            }
            have_records = true;
        } else {
            if (!jr_skip_value(&jr)) {
                snprintf(error_text, error_text_size, "Invalid value for key %s.", key);
                return false;
            }
        }

        jr_skip_ws(&jr);
        if (jr_consume(&jr, ',')) continue;
        if (jr_consume(&jr, '}')) break;
        snprintf(error_text, error_text_size, "Invalid top-level syntax.");
        return false;
    }

    for (int i = 0; i < record_count; i++) {
        if (!group_seen[record_out[i].source_group] || !group_seen[record_out[i].target_group] ||
            !group_out[record_out[i].source_group].valid || !group_out[record_out[i].target_group].valid) {
            snprintf(error_text, error_text_size, "Record references an unknown group.");
            return false;
        }
    }

    if (!have_schema || !have_devices || !have_groups || !have_records || !have_pair_bindings) {
        snprintf(error_text, error_text_size, "Missing required top-level fields.");
        return false;
    }
    if ((int)schema_version != 1 && (int)schema_version != CONFIG_SCHEMA_VERSION) {
        snprintf(error_text, error_text_size, "Unsupported schema_version %lld.", (long long)schema_version);
        return false;
    }

    *device_count_out = device_count;
    *pair_binding_count_out = pair_binding_count;
    *record_count_out = record_count;
    *schema_version_out = (int)schema_version;
    return true;
}

static bool get_device_index_from_query(const char *query, int *index_out)
{
    char idx_text[16] = {0};
    if (httpd_query_key_value(query, "idx", idx_text, sizeof(idx_text)) != ESP_OK &&
        httpd_query_key_value(query, "i", idx_text, sizeof(idx_text)) != ESP_OK) {
        return false;
    }

    char *end = NULL;
    long parsed = strtol(idx_text, &end, 10);
    if (end == idx_text || *end != '\0' || parsed < 0 || parsed >= MAX_DEVICES) {
        return false;
    }
    *index_out = (int)parsed;
    return true;
}

static bool get_group_index_from_query(const char *query, int *group_out)
{
    char gid_text[16] = {0};
    if (httpd_query_key_value(query, "gid", gid_text, sizeof(gid_text)) != ESP_OK &&
        httpd_query_key_value(query, "group", gid_text, sizeof(gid_text)) != ESP_OK &&
        httpd_query_key_value(query, "g", gid_text, sizeof(gid_text)) != ESP_OK) {
        return false;
    }

    char *end = NULL;
    long parsed = strtol(gid_text, &end, 10);
    if (end == gid_text || *end != '\0' || parsed < 0 || parsed >= MAX_GROUPS) {
        return false;
    }
    *group_out = (int)parsed;
    return true;
}

static void json_escape(const char *input, char *output, size_t output_size)
{
    size_t out = 0;
    for (size_t in = 0; input[in] != '\0' && out < output_size - 1; in++) {
        char c = input[in];
        if ((c == '"' || c == '\\') && out < output_size - 2) {
            output[out++] = '\\';
            output[out++] = c;
        } else if ((unsigned char)c >= 0x20) {
            output[out++] = c;
        }
    }
    output[out] = '\0';
}

static bool sb_init(strbuf_t *sb, size_t cap)
{
    sb->buf = (char *)malloc(cap);
    if (!sb->buf) return false;
    sb->buf[0] = '\0';
    sb->len = 0;
    sb->cap = cap;
    return true;
}

static void sb_free(strbuf_t *sb)
{
    if (sb->buf) free(sb->buf);
    sb->buf = NULL;
    sb->len = sb->cap = 0;
}

static bool sb_reserve(strbuf_t *sb, size_t extra)
{
    if (sb->len + extra + 1 <= sb->cap) return true;
    size_t new_cap = sb->cap ? sb->cap : 256;
    while (new_cap < sb->len + extra + 1) {
        new_cap *= 2;
    }
    char *new_buf = (char *)realloc(sb->buf, new_cap);
    if (!new_buf) return false;
    sb->buf = new_buf;
    sb->cap = new_cap;
    return true;
}

static bool sb_appendf(strbuf_t *sb, const char *fmt, ...)
{
    va_list ap;
    while (1) {
        if (!sb_reserve(sb, 128)) return false;
        va_start(ap, fmt);
        int written = vsnprintf(sb->buf + sb->len, sb->cap - sb->len, fmt, ap);
        va_end(ap);
        if (written < 0) return false;
        if ((size_t)written < sb->cap - sb->len) {
            sb->len += (size_t)written;
            return true;
        }
        if (!sb_reserve(sb, (size_t)written + 1)) return false;
    }
}

static bool group_bit_valid(int gid)
{
    return gid >= 0 && gid < MAX_GROUPS;
}

static uint32_t group_bit(int gid)
{
    return group_bit_valid(gid) ? (1u << gid) : 0;
}

static int count_group_members_locked(int gid)
{
    if (!group_bit_valid(gid)) return 0;
    int count = 0;
    uint32_t bit = group_bit(gid);
    for (int i = 0; i < device_count; i++) {
        if ((devices[i].group_mask & bit) != 0) count++;
    }
    return count;
}

static int first_device_in_group_locked(int gid, int start_index)
{
    if (!group_bit_valid(gid)) return -1;
    uint32_t bit = group_bit(gid);
    for (int i = start_index; i < device_count; i++) {
        if ((devices[i].group_mask & bit) != 0) return i;
    }
    return -1;
}

static bool record_exists_locked(uint8_t source_group, uint8_t target_group, int source_idx, int target_idx, bool shared_source)
{
    for (int i = 0; i < record_count; i++) {
        const discovery_record_t *r = &records[i];
        if (r->source_group != source_group || r->target_group != target_group) {
            continue;
        }
        if (shared_source) {
            if (r->source_device_index < 0 && r->target_device_index == target_idx) {
                return true;
            }
        } else {
            if (r->source_device_index == source_idx && r->target_device_index == target_idx) {
                return true;
            }
        }
    }
    return false;
}

static bool append_record_locked(uint8_t source_group, uint8_t target_group, int source_idx, int target_idx, bool shared_source)
{
    if (record_count >= MAX_DISCOVERY_RECORDS) return false;
    discovery_record_t *r = &records[record_count++];
    memset(r, 0, sizeof(*r));
    r->source_group = source_group;
    r->target_group = target_group;
    r->source_device_index = shared_source ? -1 : (int16_t)source_idx;
    r->target_device_index = (int16_t)target_idx;
    if (source_idx >= 0 && source_idx < device_count) {
        memcpy(r->source_mac, devices[source_idx].mac, sizeof(r->source_mac));
    }
    if (target_idx >= 0 && target_idx < device_count) {
        memcpy(r->target_mac, devices[target_idx].mac, sizeof(r->target_mac));
    }
    r->first_seen_ms = esp_timer_get_time() / 1000;
    r->last_seen_ms = r->first_seen_ms;
    registry_dirty = true;
    return true;
}

static void prune_invalid_group_refs_locked(void)
{
    for (int i = 0; i < device_count; i++) {
        uint32_t mask = 0;
        for (int g = 0; g < MAX_GROUPS; g++) {
            if (groups[g].valid) {
                if ((devices[i].group_mask & group_bit(g)) != 0) {
                    mask |= group_bit(g);
                }
            }
        }
        devices[i].group_mask = mask;
    }

    int write = 0;
    for (int i = 0; i < record_count; i++) {
        discovery_record_t *r = &records[i];
        if (r->source_group >= MAX_GROUPS || r->target_group >= MAX_GROUPS) continue;
        if (!groups[r->source_group].valid || !groups[r->target_group].valid) continue;
        if (r->source_device_index >= device_count || r->target_device_index >= device_count) continue;
        if (r->source_device_index >= 0) {
            if (memcmp(devices[r->source_device_index].mac, r->source_mac, 6) != 0) continue;
        }
        if (memcmp(devices[r->target_device_index].mac, r->target_mac, 6) != 0) continue;
        if (write != i) records[write] = *r;
        write++;
    }
    record_count = write;
}

static bool mac_equal(const uint8_t *a, const uint8_t *b)
{
    return memcmp(a, b, 6) == 0;
}

static void append_mac_csv(char *buf, size_t buf_size, const uint8_t *mac, int *count)
{
    if (!buf || buf_size == 0 || !mac || !count) return;
    char mac_text[18];
    mac_to_string(mac, mac_text, sizeof(mac_text));
    size_t len = strlen(buf);
    if (*count > 0 && len + 1 < buf_size) {
        buf[len++] = ',';
        buf[len] = '\0';
    }
    if (len + strlen(mac_text) + 1 >= buf_size) return;
    strncat(buf, mac_text, buf_size - strlen(buf) - 1);
    (*count)++;
}

static int find_device_index_by_mac_locked(const uint8_t *mac)
{
    for (int i = 0; i < device_count; i++) {
        if (mac_equal(devices[i].mac, mac)) return i;
    }
    return -1;
}

static void set_device_default_name_locked(int index)
{
    if (index < 0 || index >= device_count) return;
    if (devices[index].name[0] == '\0') {
        make_default_device_name(index, devices[index].name, sizeof(devices[index].name));
    }
}

static void ensure_group_default_fields_locked(int gid)
{
    if (!group_bit_valid(gid)) return;
    if (!groups[gid].valid) return;
    if (groups[gid].name[0] == '\0') {
        make_default_group_name(gid, groups[gid].name, sizeof(groups[gid].name));
    }
    if (groups[gid].effect_note[0] == '\0') {
        snprintf(groups[gid].effect_note, sizeof(groups[gid].effect_note), "silent");
    }
    if (groups[gid].trigger_effect_note[0] == '\0') {
        char effect_copy[GROUP_TEXT_LEN];
        snprintf(effect_copy, sizeof(effect_copy), "%s", groups[gid].effect_note);
        snprintf(groups[gid].trigger_effect_note, sizeof(groups[gid].trigger_effect_note), "%s", effect_copy);
    }
    if (groups[gid].target_group >= MAX_GROUPS) groups[gid].target_group = 0xFF;
    if (groups[gid].target_group == gid) groups[gid].target_group = 0xFF;
    if (groups[gid].peer_mask == 0 && group_bit_valid(groups[gid].target_group)) {
        groups[gid].peer_mask = group_bit(groups[gid].target_group);
    }
    if (groups[gid].room_hash == 0) groups[gid].room_hash = 1;
    if (groups[gid].rule_id == 0) groups[gid].rule_id = 1;
    if (groups[gid].rule_base == 0) groups[gid].rule_base = 1;
    // rule_judge=0 is a valid passive target role: beacon only, no local trigger judging.
    if (groups[gid].rule_signal == 0) groups[gid].rule_signal = 1;
    if (groups[gid].rule_rssi_min == 0) groups[gid].rule_rssi_min = groups[gid].rssi_threshold ? groups[gid].rssi_threshold : -70;
    if (groups[gid].rule_rssi_max == 0) groups[gid].rule_rssi_max = -127;
    if (groups[gid].rule_missing_ms == 0) groups[gid].rule_missing_ms = 3000;
    if (groups[gid].rule_smooth_samples == 0) groups[gid].rule_smooth_samples = 5;
    if (groups[gid].rule_trigger == 0) groups[gid].rule_trigger = 1;
    if (groups[gid].rule_target_count == 0) groups[gid].rule_target_count = 1;
    // rule_score_target=0 / rule_points=0 is valid for "effect only, no score".
    if (groups[gid].rule_repeat == 0) groups[gid].rule_repeat = 2;
    if (groups[gid].rule_cooldown_ms == 0) groups[gid].rule_cooldown_ms = 5000;
    if (groups[gid].meter_port == 0 || groups[gid].meter_port > 3) groups[gid].meter_port = 1;
    if (groups[gid].meter_led_count == 0) groups[gid].meter_led_count = 10;
    if (groups[gid].meter_weak_rssi == 0) groups[gid].meter_weak_rssi = -90;
    if (groups[gid].meter_strong_rssi == 0) groups[gid].meter_strong_rssi = groups[gid].rule_rssi_min ? groups[gid].rule_rssi_min : -35;
    if (groups[gid].meter_compression_x100 == 0) groups[gid].meter_compression_x100 = 100;
}

static void registry_save(void)
{
    ESP_LOGI(TAG, "Registry save begin.");
    receiver_device_t *device_snapshot = (receiver_device_t *)calloc(MAX_DEVICES, sizeof(receiver_device_t));
    group_config_t *group_snapshot = (group_config_t *)calloc(MAX_GROUPS, sizeof(group_config_t));
    discovery_record_t *record_snapshot = (discovery_record_t *)calloc(MAX_DISCOVERY_RECORDS, sizeof(discovery_record_t));
    int device_snapshot_count = 0;
    int record_snapshot_count = 0;
    esp_err_t ret = ESP_OK;

    if (device_snapshot == NULL || group_snapshot == NULL || record_snapshot == NULL) {
        ESP_LOGW(TAG, "Registry save skipped: snapshot allocation failed.");
        free(device_snapshot);
        free(group_snapshot);
        free(record_snapshot);
        return;
    }

    portENTER_CRITICAL(&state_mux);
    device_snapshot_count = device_count;
    if (device_snapshot_count < 0) device_snapshot_count = 0;
    if (device_snapshot_count > MAX_DEVICES) device_snapshot_count = MAX_DEVICES;
    record_snapshot_count = record_count;
    if (record_snapshot_count < 0) record_snapshot_count = 0;
    if (record_snapshot_count > MAX_DISCOVERY_RECORDS) record_snapshot_count = MAX_DISCOVERY_RECORDS;
    memcpy(device_snapshot, devices, sizeof(receiver_device_t) * device_snapshot_count);
    memcpy(group_snapshot, groups, sizeof(group_config_t) * MAX_GROUPS);
    memcpy(record_snapshot, records, sizeof(discovery_record_t) * record_snapshot_count);
    registry_dirty = false;
    portEXIT_CRITICAL(&state_mux);

    nvs_handle_t nvs = 0;
    ret = nvs_open("registry", NVS_READWRITE, &nvs);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "NVS open failed while saving registry: %s", esp_err_to_name(ret));
        goto restore_dirty;
    }

    ret = nvs_set_i32(nvs, "device_count", device_snapshot_count);
    if (ret == ESP_OK && device_snapshot_count > 0) {
        ret = nvs_set_blob(nvs, "devices", device_snapshot, sizeof(receiver_device_t) * device_snapshot_count);
    }
    if (ret == ESP_OK) {
        ret = nvs_set_blob(nvs, "groups", group_snapshot, sizeof(group_config_t) * MAX_GROUPS);
    }
    if (ret == ESP_OK) {
        ret = nvs_set_i32(nvs, "record_count", record_snapshot_count);
    }
    if (ret == ESP_OK && record_snapshot_count > 0) {
        ret = nvs_set_blob(nvs, "records", record_snapshot, sizeof(discovery_record_t) * record_snapshot_count);
    }
    if (ret == ESP_OK) {
        ret = nvs_commit(nvs);
    }
    nvs_close(nvs);

    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "Registry saved: %d devices, %d groups, %d records.", device_snapshot_count, MAX_GROUPS, record_snapshot_count);
    } else {
        ESP_LOGW(TAG, "Registry save failed: %s", esp_err_to_name(ret));
        goto restore_dirty;
    }

    free(device_snapshot);
    free(group_snapshot);
    free(record_snapshot);
    ESP_LOGI(TAG, "Registry save end.");
    return;

restore_dirty:
    portENTER_CRITICAL(&state_mux);
    registry_dirty = true;
    portEXIT_CRITICAL(&state_mux);
    free(device_snapshot);
    free(group_snapshot);
    free(record_snapshot);
}

static void registry_load(void)
{
    memset(legacy_devices, 0, sizeof(legacy_devices));
    memset(legacy_devices_v2, 0, sizeof(legacy_devices_v2));
    memset(devices, 0, sizeof(devices));
    memset(groups, 0, sizeof(groups));
    memset(records, 0, sizeof(records));

    int loaded_devices = 0;
    int loaded_records = 0;
    bool dirty = false;

    nvs_handle_t nvs = 0;
    esp_err_t ret = nvs_open("registry", NVS_READONLY, &nvs);
    if (ret != ESP_OK) {
        ESP_LOGI(TAG, "No saved registry yet.");
        return;
    }

    int32_t saved_device_count = 0;
    size_t blob_size = 0;
    ret = nvs_get_i32(nvs, "device_count", &saved_device_count);
    if (ret == ESP_OK) {
        ret = nvs_get_blob(nvs, "devices", NULL, &blob_size);
    }

    bool compatible_new = ret == ESP_OK &&
                          saved_device_count > 0 &&
                          saved_device_count <= MAX_DEVICES &&
                          blob_size == sizeof(receiver_device_t) * (size_t)saved_device_count;
    bool compatible_v2 = ret == ESP_OK &&
                          saved_device_count > 0 &&
                          saved_device_count <= MAX_DEVICES &&
                          blob_size == sizeof(receiver_device_v2_t) * (size_t)saved_device_count;
    bool compatible_old = ret == ESP_OK &&
                          saved_device_count > 0 &&
                          saved_device_count <= MAX_DEVICES &&
                          blob_size == sizeof(receiver_device_v1_t) * (size_t)saved_device_count;

    if (compatible_new) {
        size_t read_size = blob_size;
        ret = nvs_get_blob(nvs, "devices", devices, &read_size);
        if (ret == ESP_OK) {
            loaded_devices = saved_device_count;
        }
    } else if (compatible_v2) {
        size_t read_size = blob_size;
        ret = nvs_get_blob(nvs, "devices", legacy_devices_v2, &read_size);
        if (ret == ESP_OK) {
            loaded_devices = saved_device_count;
            for (int i = 0; i < loaded_devices; i++) {
                memcpy(devices[i].mac, legacy_devices_v2[i].mac, sizeof(devices[i].mac));
                snprintf(devices[i].name, sizeof(devices[i].name), "%s", legacy_devices_v2[i].name);
                devices[i].group_mask = legacy_devices_v2[i].group_mask;
                devices[i].rssi = legacy_devices_v2[i].rssi;
                devices[i].last_seen_ms = legacy_devices_v2[i].last_seen_ms;
            }
        }
    } else if (compatible_old) {
        size_t read_size = blob_size;
        ret = nvs_get_blob(nvs, "devices", legacy_devices, &read_size);
        if (ret == ESP_OK) {
            loaded_devices = saved_device_count;
            for (int i = 0; i < loaded_devices; i++) {
                memcpy(devices[i].mac, legacy_devices[i].mac, sizeof(devices[i].mac));
                snprintf(devices[i].name, sizeof(devices[i].name), "%s", legacy_devices[i].name);
                devices[i].group_mask = 0;
                devices[i].rssi = legacy_devices[i].rssi;
                devices[i].last_seen_ms = legacy_devices[i].last_seen_ms;
            }
            dirty = true;
        }
    }

    size_t group_blob = sizeof(groups);
    if (nvs_get_blob(nvs, "groups", NULL, &group_blob) == ESP_OK && group_blob == sizeof(groups)) {
        size_t read_size = group_blob;
        if (nvs_get_blob(nvs, "groups", groups, &read_size) != ESP_OK) {
            memset(groups, 0, sizeof(groups));
        }
    }

    int32_t saved_record_count = 0;
    if (nvs_get_i32(nvs, "record_count", &saved_record_count) == ESP_OK) {
        size_t record_blob = 0;
        if (nvs_get_blob(nvs, "records", NULL, &record_blob) == ESP_OK &&
            record_blob == sizeof(discovery_record_t) * (size_t)saved_record_count) {
            size_t read_size = record_blob;
            if (nvs_get_blob(nvs, "records", records, &read_size) == ESP_OK) {
                loaded_records = saved_record_count;
            }
        }
    }

    nvs_close(nvs);

    int64_t now_ms = esp_timer_get_time() / 1000;
    for (int i = 0; i < loaded_devices; i++) {
        if (normalize_device_name_for_index(i, devices[i].name, sizeof(devices[i].name))) {
            dirty = true;
        }
        devices[i].rssi = 0;
        devices[i].last_seen_ms = now_ms;
    }

    for (int g = 0; g < MAX_GROUPS; g++) {
        if (groups[g].valid) {
            ensure_group_default_fields_locked(g);
            dirty = true;
        }
    }

    portENTER_CRITICAL(&state_mux);
    device_count = loaded_devices;
    record_count = loaded_records;
    if (dirty) registry_dirty = true;
    prune_invalid_group_refs_locked();
    portEXIT_CRITICAL(&state_mux);

    ESP_LOGI(TAG, "Registry loaded: %d devices, %d group slots, %d records.", loaded_devices, MAX_GROUPS, loaded_records);
}

static void remember_device_info(const uint8_t *mac, int rssi, const char *release_version, const char *firmware_version)
{
    if (!mac) return;
    int64_t now_ms = esp_timer_get_time() / 1000;

    portENTER_CRITICAL(&state_mux);
    int idx = find_device_index_by_mac_locked(mac);
    if (idx >= 0) {
        devices[idx].rssi = rssi;
        devices[idx].last_seen_ms = now_ms;
        if (release_version && release_version[0]) {
            if (strncmp(devices[idx].release_version, release_version, sizeof(devices[idx].release_version)) != 0) registry_dirty = true;
            snprintf(devices[idx].release_version, sizeof(devices[idx].release_version), "%s", release_version);
        }
        if (firmware_version && firmware_version[0]) {
            if (strncmp(devices[idx].firmware_version, firmware_version, sizeof(devices[idx].firmware_version)) != 0) registry_dirty = true;
            snprintf(devices[idx].firmware_version, sizeof(devices[idx].firmware_version), "%s", firmware_version);
        }
        portEXIT_CRITICAL(&state_mux);
        return;
    }

    if (device_count < MAX_DEVICES) {
        idx = device_count++;
        memcpy(devices[idx].mac, mac, 6);
        make_default_device_name(idx, devices[idx].name, sizeof(devices[idx].name));
        devices[idx].group_mask = 0;
        devices[idx].rssi = rssi;
        devices[idx].last_seen_ms = now_ms;
        if (release_version && release_version[0]) {
            snprintf(devices[idx].release_version, sizeof(devices[idx].release_version), "%s", release_version);
        }
        if (firmware_version && firmware_version[0]) {
            snprintf(devices[idx].firmware_version, sizeof(devices[idx].firmware_version), "%s", firmware_version);
        }
        registry_dirty = true;
    }
    portEXIT_CRITICAL(&state_mux);
}

static void remember_device(const uint8_t *mac, int rssi)
{
    remember_device_info(mac, rssi, NULL, NULL);
}

static void ensure_peer_exists(const uint8_t *mac)
{
    if (!mac || esp_now_is_peer_exist(mac)) return;

    esp_now_peer_info_t peer;
    memset(&peer, 0, sizeof(peer));
    memcpy(peer.peer_addr, mac, 6);
    peer.channel = WIFI_AP_CHANNEL;
    peer.ifidx = WIFI_IF_AP;
    peer.encrypt = false;

    esp_err_t ret = esp_now_add_peer(&peer);
    if (ret != ESP_OK && ret != ESP_ERR_ESPNOW_EXIST) {
        ESP_LOGW(TAG, "Failed to add peer: %s", esp_err_to_name(ret));
    }
}

static esp_err_t send_espnow_command_to(const uint8_t *mac, const char *cmd)
{
    if (!mac || !cmd) return ESP_FAIL;
    if (memcmp(mac, broadcast_mac, 6) != 0) {
        ensure_peer_exists(mac);
    }

    esp_err_t ret = esp_now_send(mac, (const uint8_t *)cmd, strlen(cmd) + 1);
    if (ret == ESP_OK) {
        char mac_text[18];
        mac_to_string(mac, mac_text, sizeof(mac_text));
        ESP_LOGI(TAG, "ESP-NOW TX len=%u %s to %s", (unsigned int)strlen(cmd), cmd, mac_text);
    } else {
        ESP_LOGE(TAG, "ESP-NOW TX failed for %s: %s", cmd, esp_err_to_name(ret));
    }
    return ret;
}

static esp_err_t send_espnow_broadcast(const char *cmd)
{
    return send_espnow_command_to(broadcast_mac, cmd);
}

static void sync_effects_to_devices(void)
{
    ESP_LOGI(TAG, "Sync effects begin.");
    int snapshot_count = 0;

    portENTER_CRITICAL(&state_mux);
    snapshot_count = device_count;
    if (snapshot_count < 0) snapshot_count = 0;
    if (snapshot_count > MAX_DEVICES) snapshot_count = MAX_DEVICES;
    portEXIT_CRITICAL(&state_mux);

    int pushed = 0;
    for (int i = 0; i < snapshot_count; i++) {
        uint8_t mac[6] = {0};
        char spec[GROUP_TEXT_LEN] = {0};
        bool have_device = false;

        portENTER_CRITICAL(&state_mux);
        if (i < device_count) {
            memcpy(mac, devices[i].mac, sizeof(mac));
            const char *resolved_spec = "silent";
            for (int g = 0; g < MAX_GROUPS; g++) {
                if (!groups[g].valid) continue;
                if ((devices[i].group_mask & group_bit(g)) == 0) continue;
                if (groups[g].effect_note[0] != '\0') {
                    resolved_spec = groups[g].effect_note;
                }
                break;
            }
            snprintf(spec, sizeof(spec), "%s", resolved_spec);
            have_device = true;
        }
        portEXIT_CRITICAL(&state_mux);

        if (!have_device) {
            continue;
        }

        char cmd[GROUP_TEXT_LEN + 8];
        snprintf(cmd, sizeof(cmd), "FXSET|%s", spec[0] ? spec : "silent");
        esp_err_t ret = send_espnow_command_to(mac, cmd);
        if (ret != ESP_OK) {
            char mac_text[18];
            mac_to_string(mac, mac_text, sizeof(mac_text));
            ESP_LOGW(TAG, "Sync FX send failed: mac=%s err=%s", mac_text, esp_err_to_name(ret));
        }
        pushed++;
    }
    ESP_LOGI(TAG, "Sync effects end. devices=%d", pushed);
}

static int first_group_for_mask(uint32_t mask)
{
    for (int g = 0; g < MAX_GROUPS; g++) {
        if ((mask & group_bit(g)) != 0 && groups[g].valid) {
            return g;
        }
    }
    return -1;
}

static void runtime_reset_locked(void)
{
    memset(runtime_events, 0, sizeof(runtime_events));
    memset(runtime_stats, 0, sizeof(runtime_stats));
    runtime_event_count = 0;
    runtime_running = false;
    runtime_started_ms = 0;
}

static void append_runtime_event_locked(uint16_t room, const uint8_t *self_mac, const uint8_t *peer_mac,
                                        int16_t self_device_index, int16_t peer_device_index,
                                        uint32_t self_mask, uint32_t peer_mask, int rssi, int kind, int points, unsigned int seq, int64_t event_ms)
{
    int idx = runtime_event_count;
    if (idx >= MAX_RUNTIME_EVENTS) {
        memmove(&runtime_events[0], &runtime_events[1], sizeof(runtime_event_t) * (MAX_RUNTIME_EVENTS - 1));
        idx = MAX_RUNTIME_EVENTS - 1;
        runtime_event_count = MAX_RUNTIME_EVENTS - 1;
    }
    runtime_event_t *event = &runtime_events[idx];
    memset(event, 0, sizeof(*event));
    event->room_hash = room;
    memcpy(event->self_mac, self_mac, 6);
    memcpy(event->peer_mac, peer_mac, 6);
    event->self_device_index = self_device_index;
    event->peer_device_index = peer_device_index;
    event->self_group_mask = self_mask;
    event->peer_group_mask = peer_mask;
    event->rssi = (int16_t)rssi;
    event->kind = (uint8_t)kind;
    event->points = (int16_t)points;
    event->seq = seq;
    event->event_ms = event_ms;
    runtime_event_count++;
}

static void play_target_feedback_once(const uint8_t *target_mac, uint32_t target_mask)
{
    if (!target_mac || mac_equal(target_mac, broadcast_mac)) return;

    char trigger[GROUP_TEXT_LEN] = {0};
    int target_gid = -1;
    portENTER_CRITICAL(&state_mux);
    target_gid = first_group_for_mask(target_mask);
    if (target_gid >= 0 && target_gid < MAX_GROUPS && groups[target_gid].valid) {
        snprintf(trigger, sizeof(trigger), "%s",
                 groups[target_gid].trigger_effect_note[0] ? groups[target_gid].trigger_effect_note : groups[target_gid].effect_note);
    }
    portEXIT_CRITICAL(&state_mux);

    if (trigger[0] == '\0' || strcmp(trigger, "silent") == 0) return;

    char cmd[GROUP_TEXT_LEN + 8];
    snprintf(cmd, sizeof(cmd), "TRG|%s", trigger);
    esp_err_t ret = send_espnow_command_to(target_mac, cmd);
    if (ret == ESP_OK) {
        ret = send_espnow_command_to(target_mac, "PLAY_ONCE");
    }
    if (ret != ESP_OK) {
        char mac_text[18];
        mac_to_string(target_mac, mac_text, sizeof(mac_text));
        ESP_LOGW(TAG, "Target feedback failed: target=%s err=%s", mac_text, esp_err_to_name(ret));
    }
}

static void upsert_runtime_stat_locked(uint16_t room, const uint8_t *self_mac, unsigned int seen_count,
                                       unsigned int found_count, unsigned int seq, int64_t now_ms)
{
    int slot = -1;
    int empty = -1;
    for (int i = 0; i < MAX_RUNTIME_STATS; i++) {
        if (runtime_stats[i].valid && mac_equal(runtime_stats[i].self_mac, self_mac)) {
            slot = i;
            break;
        }
        if (!runtime_stats[i].valid && empty < 0) empty = i;
    }
    if (slot < 0) slot = empty >= 0 ? empty : 0;
    runtime_stat_t *stat = &runtime_stats[slot];
    memset(stat, 0, sizeof(*stat));
    stat->valid = 1;
    stat->room_hash = room;
    memcpy(stat->self_mac, self_mac, 6);
    stat->seen_count = (uint16_t)seen_count;
    stat->found_count = (uint16_t)found_count;
    stat->seq = seq;
    stat->last_seen_ms = now_ms;
}

static esp_err_t send_runtime_to_devices(bool start_after_config, bool test_after_config = false)
{
    int snapshot_count = 0;
    portENTER_CRITICAL(&state_mux);
    snapshot_count = device_count;
    if (snapshot_count < 0) snapshot_count = 0;
    if (snapshot_count > MAX_DEVICES) snapshot_count = MAX_DEVICES;
    portEXIT_CRITICAL(&state_mux);

    int pushed = 0;
    for (int i = 0; i < snapshot_count; i++) {
        uint8_t mac[6] = {0};
        uint32_t group_mask = 0;
        uint32_t peer_mask = 0;
        uint16_t room_hash = 1;
        int16_t rssi = -70;
        uint16_t hold = 2000;
        const char *compare = "gte";
        group_config_t rule_group;
        memset(&rule_group, 0, sizeof(rule_group));
        char idle[GROUP_TEXT_LEN] = {0};
        char trigger[GROUP_TEXT_LEN] = {0};

        portENTER_CRITICAL(&state_mux);
        if (i < device_count) {
            memcpy(mac, devices[i].mac, sizeof(mac));
            group_mask = devices[i].group_mask;
            int gid = first_group_for_mask(group_mask);
            if (gid >= 0) {
                group_config_t *g = &groups[gid];
                peer_mask = g->peer_mask;
                room_hash = g->room_hash ? g->room_hash : 1;
                rssi = g->rssi_threshold ? g->rssi_threshold : -70;
                hold = g->hold_ms ? g->hold_ms : 2000;
                compare = g->trigger_compare ? "lte" : "gte";
                rule_group = *g;
                snprintf(idle, sizeof(idle), "%s", g->effect_note[0] ? g->effect_note : "silent");
                snprintf(trigger, sizeof(trigger), "%s", g->trigger_effect_note[0] ? g->trigger_effect_note : idle);
            }
        }
        portEXIT_CRITICAL(&state_mux);

        if (group_mask == 0 || peer_mask == 0) {
            continue;
        }

        uint8_t rule_judge = rule_group.rule_judge;
        uint8_t rule_score_target = rule_group.rule_score_target;
        int16_t rule_points = rule_group.rule_points;

        char rule[256];
        snprintf(rule, sizeof(rule),
                 "RULE|2|%u|%u|%u|%u|%u|%u|%u|%d|%d|%u|%u|%u|%u|%u|%u|%u|%u|%d|%u|%u|%u",
                 (unsigned int)room_hash,
                 (unsigned int)(rule_group.rule_id ? rule_group.rule_id : 1),
                 (unsigned int)(rule_group.rule_base ? rule_group.rule_base : 1),
                 (unsigned int)rule_judge,
                 (unsigned int)group_mask,
                 (unsigned int)peer_mask,
                 (unsigned int)(rule_group.rule_signal ? rule_group.rule_signal : 1),
                 (int)(rule_group.rule_rssi_min ? rule_group.rule_rssi_min : rssi),
                 (int)(rule_group.rule_rssi_max ? rule_group.rule_rssi_max : -127),
                 (unsigned int)hold,
                 (unsigned int)(rule_group.rule_missing_ms ? rule_group.rule_missing_ms : 3000),
                 (unsigned int)(rule_group.rule_smooth_samples ? rule_group.rule_smooth_samples : 5),
                 (unsigned int)(rule_group.rule_trigger ? rule_group.rule_trigger : 1),
                 (unsigned int)rule_group.rule_target_ms,
                 (unsigned int)(rule_group.rule_target_count ? rule_group.rule_target_count : 1),
                 (unsigned int)rule_group.rule_period_ms,
                 (unsigned int)rule_score_target,
                 (int)rule_points,
                 (unsigned int)(rule_group.rule_repeat ? rule_group.rule_repeat : 2),
                 (unsigned int)(rule_group.rule_cooldown_ms ? rule_group.rule_cooldown_ms : 5000),
                 (unsigned int)rule_group.rule_after);
        esp_err_t ret = send_espnow_command_to(mac, rule);
        if (ret != ESP_OK) return ret;

        char meter[112];
        snprintf(meter, sizeof(meter), "METER|%u|%u|%u|%u|%u|%d|%d|%u",
                 (unsigned int)room_hash,
                 (unsigned int)(rule_group.rule_id ? rule_group.rule_id : 1),
                 (unsigned int)(rule_group.meter_enabled ? 1 : 0),
                 (unsigned int)(rule_group.meter_port ? rule_group.meter_port : 1),
                 (unsigned int)(rule_group.meter_led_count ? rule_group.meter_led_count : 10),
                 (int)(rule_group.meter_weak_rssi ? rule_group.meter_weak_rssi : -90),
                 (int)(rule_group.meter_strong_rssi ? rule_group.meter_strong_rssi : (rule_group.rule_rssi_min ? rule_group.rule_rssi_min : -35)),
                 (unsigned int)(rule_group.meter_compression_x100 ? rule_group.meter_compression_x100 : 100));
        ret = send_espnow_command_to(mac, meter);
        if (ret != ESP_OK) return ret;

        if (pair_binding_count > 0 && rule_judge != 0) {
            char pair_list[320] = {0};
            int allowed_count = 0;
            portENTER_CRITICAL(&state_mux);
            for (int p = 0; p < pair_binding_count; p++) {
                const pair_binding_t *binding = &pair_bindings[p];
                if (!binding->valid) continue;
                if (binding->rule_id != 0 && binding->rule_id != (rule_group.rule_id ? rule_group.rule_id : 1)) continue;
                if (rule_judge == 2) {
                    if (mac_equal(binding->target_mac, mac)) append_mac_csv(pair_list, sizeof(pair_list), binding->source_mac, &allowed_count);
                } else {
                    if (mac_equal(binding->source_mac, mac)) append_mac_csv(pair_list, sizeof(pair_list), binding->target_mac, &allowed_count);
                }
            }
            portEXIT_CRITICAL(&state_mux);
            char pair_msg[384];
            snprintf(pair_msg, sizeof(pair_msg), "PAIR|%u|%u|%d|%s",
                     (unsigned int)room_hash,
                     (unsigned int)(rule_group.rule_id ? rule_group.rule_id : 1),
                     allowed_count,
                     pair_list);
            ret = send_espnow_command_to(mac, pair_msg);
            if (ret != ESP_OK) return ret;
        }

        char cfg[512];
        snprintf(cfg, sizeof(cfg), "CFG|%u|%u|%u|%s|%d|%u|%s",
                 (unsigned int)room_hash,
                 (unsigned int)group_mask,
                 (unsigned int)peer_mask,
                 compare,
                 (int)rssi,
                 (unsigned int)hold,
                 idle[0] ? idle : "silent");
        ret = send_espnow_command_to(mac, cfg);
        if (ret != ESP_OK) return ret;

        // Re-send v3 rule after the legacy CFG. This prevents stale calibration
        // rules from surviving if one ESP-NOW packet is missed or reordered.
        ret = send_espnow_command_to(mac, rule);
        if (ret != ESP_OK) return ret;

        ret = send_espnow_command_to(mac, meter);
        if (ret != ESP_OK) return ret;

        if (pair_binding_count > 0 && rule_judge != 0) {
            char pair_list[320] = {0};
            int allowed_count = 0;
            portENTER_CRITICAL(&state_mux);
            for (int p = 0; p < pair_binding_count; p++) {
                const pair_binding_t *binding = &pair_bindings[p];
                if (!binding->valid) continue;
                if (binding->rule_id != 0 && binding->rule_id != (rule_group.rule_id ? rule_group.rule_id : 1)) continue;
                if (rule_judge == 2) {
                    if (mac_equal(binding->target_mac, mac)) append_mac_csv(pair_list, sizeof(pair_list), binding->source_mac, &allowed_count);
                } else {
                    if (mac_equal(binding->source_mac, mac)) append_mac_csv(pair_list, sizeof(pair_list), binding->target_mac, &allowed_count);
                }
            }
            portEXIT_CRITICAL(&state_mux);
            char pair_msg[384];
            snprintf(pair_msg, sizeof(pair_msg), "PAIR|%u|%u|%d|%s",
                     (unsigned int)room_hash,
                     (unsigned int)(rule_group.rule_id ? rule_group.rule_id : 1),
                     allowed_count,
                     pair_list);
            ret = send_espnow_command_to(mac, pair_msg);
            if (ret != ESP_OK) return ret;
        }

        char trg[512];
        snprintf(trg, sizeof(trg), "TRG|%s", trigger[0] ? trigger : idle);
        ret = send_espnow_command_to(mac, trg);
        if (ret != ESP_OK) return ret;

        if (start_after_config) {
            ret = send_espnow_command_to(mac, "START");
            if (ret != ESP_OK) return ret;
        }
        if (test_after_config) {
            ret = send_espnow_command_to(mac, "TEST_EFFECT");
            if (ret != ESP_OK) return ret;
        }
        pushed++;
    }
    ESP_LOGI(TAG, "Runtime pushed to %d device(s), start=%u test=%u.",
             pushed, start_after_config ? 1 : 0, test_after_config ? 1 : 0);
    return ESP_OK;
}

static bool update_device_name_by_index(int index, const char *name)
{
    bool updated = false;
    if (index < 0 || index >= device_count) return false;

    portENTER_CRITICAL(&state_mux);
    if (index >= 0 && index < device_count) {
        if (!name || name[0] == '\0') {
            make_default_device_name(index, devices[index].name, sizeof(devices[index].name));
        } else {
            snprintf(devices[index].name, sizeof(devices[index].name), "%s", name);
        }
        registry_dirty = true;
        updated = true;
    }
    portEXIT_CRITICAL(&state_mux);
    return updated;
}

static bool update_device_name_by_mac(const uint8_t *mac, const char *name)
{
    bool updated = false;
    if (!mac) return false;

    portENTER_CRITICAL(&state_mux);
    for (int i = 0; i < device_count; i++) {
        if (mac_equal(devices[i].mac, mac)) {
            if (!name || name[0] == '\0') {
                make_default_device_name(i, devices[i].name, sizeof(devices[i].name));
            } else {
                snprintf(devices[i].name, sizeof(devices[i].name), "%s", name);
            }
            registry_dirty = true;
            updated = true;
            break;
        }
    }
    portEXIT_CRITICAL(&state_mux);
    return updated;
}

static bool update_device_mask_by_index(int index, uint32_t mask)
{
    bool updated = false;
    if (index < 0 || index >= device_count) return false;

    portENTER_CRITICAL(&state_mux);
    if (index >= 0 && index < device_count) {
        devices[index].group_mask = mask;
        registry_dirty = true;
        updated = true;
    }
    portEXIT_CRITICAL(&state_mux);
    return updated;
}

static bool update_device_mask_by_mac(const uint8_t *mac, uint32_t mask)
{
    bool updated = false;
    if (!mac) return false;

    portENTER_CRITICAL(&state_mux);
    for (int i = 0; i < device_count; i++) {
        if (mac_equal(devices[i].mac, mac)) {
            devices[i].group_mask = mask;
            registry_dirty = true;
            updated = true;
            break;
        }
    }
    portEXIT_CRITICAL(&state_mux);
    return updated;
}

static bool parse_uint32_query(const char *query, const char *key, uint32_t *out)
{
    char text[32] = {0};
    if (httpd_query_key_value(query, key, text, sizeof(text)) != ESP_OK) return false;
    char *end = NULL;
    unsigned long value = strtoul(text, &end, 10);
    if (end == text || *end != '\0') return false;
    *out = (uint32_t)value;
    return true;
}

static void remove_group_records_locked(int gid)
{
    int write = 0;
    for (int i = 0; i < record_count; i++) {
        if (records[i].source_group == gid || records[i].target_group == gid) {
            continue;
        }
        if (write != i) records[write] = records[i];
        write++;
    }
    record_count = write;
}

static void remove_device_records_locked(int deleted_idx)
{
    int write = 0;
    for (int i = 0; i < record_count; i++) {
        discovery_record_t r = records[i];
        if (r.source_device_index == deleted_idx || r.target_device_index == deleted_idx) {
            continue;
        }
        if (r.source_device_index > deleted_idx) {
            r.source_device_index--;
        }
        if (r.target_device_index > deleted_idx) {
            r.target_device_index--;
        }
        if (write != i) {
            records[write] = r;
        } else {
            records[write] = r;
        }
        write++;
    }
    record_count = write;
}

static bool delete_device_locked(int index)
{
    if (index < 0 || index >= device_count) return false;

    for (int i = index; i < device_count - 1; i++) {
        devices[i] = devices[i + 1];
    }
    memset(&devices[device_count - 1], 0, sizeof(devices[device_count - 1]));
    device_count--;
    remove_device_records_locked(index);
    registry_dirty = true;
    return true;
}

static bool save_group_locked(int gid, const char *name, const char *note, const char *effect, const char *silence,
                              int target_group, int mode, int16_t rssi_threshold, uint16_t hold_ms, uint32_t members)
{
    if (!group_bit_valid(gid) || !name || name[0] == '\0') return false;

    group_config_t *g = &groups[gid];
    memset(g, 0, sizeof(*g));
    g->valid = 1;
    snprintf(g->name, sizeof(g->name), "%s", name);
    if (note && note[0] != '\0') snprintf(g->note, sizeof(g->note), "%s", note);
    if (effect && effect[0] != '\0') {
        snprintf(g->effect_note, sizeof(g->effect_note), "%s", effect);
    } else {
        snprintf(g->effect_note, sizeof(g->effect_note), "silent");
    }
    if (silence && silence[0] != '\0') snprintf(g->silence_note, sizeof(g->silence_note), "%s", silence);
    g->target_group = (target_group >= 0 && target_group < MAX_GROUPS && target_group != gid) ? (uint8_t)target_group : 0xFF;
    g->mode = (mode >= 0 && mode <= 2) ? (uint8_t)mode : GROUP_MODE_INDEPENDENT;
    g->rssi_threshold = rssi_threshold;
    g->hold_ms = hold_ms;

    for (int i = 0; i < device_count; i++) {
        if (members & (1u << i)) {
            devices[i].group_mask |= group_bit(gid);
        } else {
            devices[i].group_mask &= ~group_bit(gid);
        }
    }
    registry_dirty = true;
    return true;
}

static bool delete_group_locked(int gid)
{
    if (!group_bit_valid(gid) || !groups[gid].valid) return false;
    memset(&groups[gid], 0, sizeof(groups[gid]));
    for (int i = 0; i < device_count; i++) {
        devices[i].group_mask &= ~group_bit(gid);
    }
    for (int g = 0; g < MAX_GROUPS; g++) {
        if (groups[g].valid && groups[g].target_group == gid) {
            groups[g].target_group = 0xFF;
        }
    }
    remove_group_records_locked(gid);
    registry_dirty = true;
    return true;
}

static bool record_demo_for_group_locked(int gid)
{
    if (!group_bit_valid(gid) || !groups[gid].valid) return false;
    uint8_t target_gid = groups[gid].target_group;
    if (target_gid >= MAX_GROUPS || !groups[target_gid].valid) return false;

    bool shared_source = groups[gid].mode == GROUP_MODE_SHARED;
    if (device_count == 0) return false;

    if (shared_source) {
        for (int dst = 0; dst < device_count; dst++) {
            if ((devices[dst].group_mask & group_bit(target_gid)) == 0) continue;
            if (record_exists_locked((uint8_t)gid, target_gid, -1, dst, true)) continue;
            return append_record_locked((uint8_t)gid, target_gid, -1, dst, true);
        }
        return false;
    }

    for (int src = 0; src < device_count; src++) {
        if ((devices[src].group_mask & group_bit(gid)) == 0) continue;
        for (int dst = 0; dst < device_count; dst++) {
            if ((devices[dst].group_mask & group_bit(target_gid)) == 0) continue;
            if (record_exists_locked((uint8_t)gid, target_gid, src, dst, false)) continue;
            return append_record_locked((uint8_t)gid, target_gid, src, dst, false);
        }
    }
    return false;
}

static void espnow_recv_cb(const esp_now_recv_info_t *recv_info, const uint8_t *data, int data_len)
{
    if (!recv_info || !recv_info->src_addr || !data || data_len <= 0) return;

    char msg[256];
    int copy_len = data_len < (int)sizeof(msg) - 1 ? data_len : (int)sizeof(msg) - 1;
    memcpy(msg, data, copy_len);
    msg[copy_len] = '\0';

    if (strncmp(msg, "PRESENT", 7) == 0) {
        int rssi = recv_info->rx_ctrl ? recv_info->rx_ctrl->rssi : 0;
        char reported_mac[18] = {0};
        char release_version[FW_TEXT_LEN] = {0};
        char firmware_version[FW_TEXT_LEN] = {0};
        int fields = sscanf(msg, "PRESENT,%17[^,],%23[^,],%23s", reported_mac, release_version, firmware_version);
        ensure_peer_exists(recv_info->src_addr);
        remember_device_info(recv_info->src_addr, rssi,
                             fields >= 2 ? release_version : NULL,
                             fields >= 3 ? firmware_version : NULL);
        char mac_text[18];
        mac_to_string(recv_info->src_addr, mac_text, sizeof(mac_text));
        ESP_LOGI(TAG, "Receiver present: %s, RSSI=%d release=%s firmware=%s",
                 mac_text, rssi,
                 fields >= 2 ? release_version : "unknown",
                 fields >= 3 ? firmware_version : "unknown");
    } else if (strncmp(msg, "EVT2|", 5) == 0) {
        ensure_peer_exists(recv_info->src_addr);
        int64_t now_ms = esp_timer_get_time() / 1000;
        unsigned int room = 0;
        unsigned int rule_id = 0;
        unsigned int kind = 0;
        char judge_mac_text[18] = {0};
        char source_mac_text[18] = {0};
        char target_mac_text[18] = {0};
        unsigned int source_mask = 0;
        unsigned int target_mask = 0;
        int event_rssi = recv_info->rx_ctrl ? recv_info->rx_ctrl->rssi : 0;
        int points = 0;
        unsigned int seq = 0;
        long long event_ms = 0;
        uint8_t source_mac[6] = {0};
        uint8_t target_mac[6] = {0};
        if (sscanf(msg, "EVT2|%u|%u|%u|%17[^|]|%17[^|]|%17[^|]|%u|%u|%d|%d|%u|%lld",
                   &room, &rule_id, &kind, judge_mac_text, source_mac_text, target_mac_text,
                   &source_mask, &target_mask, &event_rssi, &points, &seq, &event_ms) == 12 &&
            parse_mac_string(source_mac_text, source_mac) &&
            parse_mac_string(target_mac_text, target_mac)) {
            portENTER_CRITICAL(&state_mux);
            int16_t source_idx = (int16_t)find_device_index_by_mac_locked(source_mac);
            int16_t target_idx = (int16_t)find_device_index_by_mac_locked(target_mac);
            append_runtime_event_locked((uint16_t)room, source_mac, target_mac, source_idx, target_idx,
                                        source_mask, target_mask, event_rssi, (int)kind, points, seq,
                                        event_ms > 0 ? (int64_t)event_ms : now_ms);
            if (record_count < MAX_DISCOVERY_RECORDS) {
                discovery_record_t *r = &records[record_count++];
                memset(r, 0, sizeof(*r));
                r->source_group = (uint8_t)first_group_for_mask(source_mask);
                r->target_group = (uint8_t)first_group_for_mask(target_mask);
                r->source_device_index = source_idx;
                r->target_device_index = target_idx;
                memcpy(r->source_mac, source_mac, sizeof(r->source_mac));
                memcpy(r->target_mac, target_mac, sizeof(r->target_mac));
                r->first_seen_ms = now_ms;
                r->last_seen_ms = now_ms;
                registry_dirty = true;
            }
            portEXIT_CRITICAL(&state_mux);
            play_target_feedback_once(target_mac, target_mask);
            ESP_LOGI(TAG, "EVT2 received: room=%u rule=%u source=%u target=%u rssi=%d points=%d seq=%u",
                     room, rule_id, source_mask, target_mask, event_rssi, points, seq);
        }
    } else if (strncmp(msg, "EVENT|", 6) == 0) {
        ensure_peer_exists(recv_info->src_addr);
        int64_t now_ms = esp_timer_get_time() / 1000;
        unsigned int room = 0;
        unsigned int self_mask = 0;
        unsigned int peer_mask = 0;
        int event_rssi = recv_info->rx_ctrl ? recv_info->rx_ctrl->rssi : 0;
        char self_mac_text[18] = {0};
        char peer_mac_text[18] = {0};
        uint8_t self_mac[6] = {0};
        uint8_t peer_mac[6] = {0};
        int16_t self_device_index = -1;
        int16_t peer_device_index = -1;
        long long event_ms = 0;
        bool new_event = sscanf(msg, "EVENT|%u|%17[^|]|%17[^|]|%u|%u|%d|%lld",
                                &room, self_mac_text, peer_mac_text, &self_mask, &peer_mask, &event_rssi, &event_ms) == 7 &&
                         parse_mac_string(self_mac_text, self_mac) &&
                         parse_mac_string(peer_mac_text, peer_mac);
        if (!new_event) {
            sscanf(msg, "EVENT|%u|%u|%u|%d", &room, &self_mask, &peer_mask, &event_rssi);
            memcpy(self_mac, recv_info->src_addr, 6);
        }
        portENTER_CRITICAL(&state_mux);
        if (new_event) {
            self_device_index = (int16_t)find_device_index_by_mac_locked(self_mac);
            peer_device_index = (int16_t)find_device_index_by_mac_locked(peer_mac);
            append_runtime_event_locked((uint16_t)room, self_mac, peer_mac, self_device_index, peer_device_index, self_mask, peer_mask,
                                        event_rssi, 1, 1, 0, event_ms > 0 ? (int64_t)event_ms : now_ms);
        }
        if (record_count < MAX_DISCOVERY_RECORDS) {
            discovery_record_t *r = &records[record_count++];
            memset(r, 0, sizeof(*r));
            r->source_group = (uint8_t)first_group_for_mask(self_mask);
            r->target_group = (uint8_t)first_group_for_mask(peer_mask);
            r->source_device_index = find_device_index_by_mac_locked(self_mac);
            r->target_device_index = new_event ? find_device_index_by_mac_locked(peer_mac) : -1;
            memcpy(r->source_mac, self_mac, sizeof(r->source_mac));
            if (new_event) memcpy(r->target_mac, peer_mac, sizeof(r->target_mac));
            r->first_seen_ms = now_ms;
            r->last_seen_ms = now_ms;
            registry_dirty = true;
        }
        portEXIT_CRITICAL(&state_mux);
        ESP_LOGI(TAG, "Runtime event received: room=%u self=%u peer=%u rssi=%d", room, self_mask, peer_mask, event_rssi);
    } else if (strncmp(msg, "STAT2|", 6) == 0) {
        ensure_peer_exists(recv_info->src_addr);
        int64_t now_ms = esp_timer_get_time() / 1000;
        unsigned int room = 0;
        char self_mac_text[18] = {0};
        unsigned int rule_id = 0;
        unsigned int seen_count = 0;
        unsigned int event_count = 0;
        char best_peer_text[18] = {0};
        int best_rssi = -127;
        unsigned int active_ms = 0;
        unsigned int seq = 0;
        uint8_t self_mac[6] = {0};
        uint8_t best_peer[6] = {0};
        if (sscanf(msg, "STAT2|%u|%17[^|]|%u|%u|%u|%17[^|]|%d|%u|%u",
                   &room, self_mac_text, &rule_id, &seen_count, &event_count, best_peer_text, &best_rssi, &active_ms, &seq) == 9 &&
            parse_mac_string(self_mac_text, self_mac)) {
            parse_mac_string(best_peer_text, best_peer);
            portENTER_CRITICAL(&state_mux);
            upsert_runtime_stat_locked((uint16_t)room, self_mac, seen_count, event_count, seq, now_ms);
            for (int i = 0; i < MAX_RUNTIME_STATS; i++) {
                if (runtime_stats[i].valid && mac_equal(runtime_stats[i].self_mac, self_mac)) {
                    memcpy(runtime_stats[i].best_peer_mac, best_peer, sizeof(best_peer));
                    runtime_stats[i].best_rssi = (int16_t)best_rssi;
                    runtime_stats[i].active_ms = active_ms;
                    break;
                }
            }
            portEXIT_CRITICAL(&state_mux);
            ESP_LOGI(TAG, "STAT2 received: room=%u seen=%u events=%u best=%d seq=%u", room, seen_count, event_count, best_rssi, seq);
        }
    } else if (strncmp(msg, "STAT|", 5) == 0) {
        ensure_peer_exists(recv_info->src_addr);
        int64_t now_ms = esp_timer_get_time() / 1000;
        unsigned int room = 0;
        char self_mac_text[18] = {0};
        unsigned int seen_count = 0;
        unsigned int found_count = 0;
        unsigned int seq = 0;
        uint8_t self_mac[6] = {0};
        if (sscanf(msg, "STAT|%u|%17[^|]|%u|%u|%u",
                   &room, self_mac_text, &seen_count, &found_count, &seq) == 5 &&
            parse_mac_string(self_mac_text, self_mac)) {
            portENTER_CRITICAL(&state_mux);
            upsert_runtime_stat_locked((uint16_t)room, self_mac, seen_count, found_count, seq, now_ms);
            portEXIT_CRITICAL(&state_mux);
            ESP_LOGI(TAG, "Runtime stat: room=%u seen=%u found=%u seq=%u", room, seen_count, found_count, seq);
        }
    }
}

static esp_err_t root_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET / -> UI %s", WEB_UI_VERSION);
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Private-Network", "true");
    return httpd_resp_send(req, INDEX_HTML, HTTPD_RESP_USE_STRLEN);
}

static void set_cors_headers(httpd_req_t *req)
{
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Private-Network", "true");
}

static bool handle_cors_options(httpd_req_t *req)
{
    if (req->method != HTTP_OPTIONS) {
        return false;
    }
    set_cors_headers(req);
    httpd_resp_set_status(req, "204 No Content");
    httpd_resp_send(req, NULL, 0);
    return true;
}

static esp_err_t command_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /cmd");
    if (handle_cors_options(req)) return ESP_OK;
    char query[64] = {0};
    char name[24] = {0};
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK ||
        httpd_query_key_value(query, "name", name, sizeof(name)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Missing command.");
    }

    if (strcmp(name, "START") != 0 && strcmp(name, "STOP") != 0 &&
        strcmp(name, "START_GAME") != 0 && strcmp(name, "STOP_GAME") != 0 &&
        strcmp(name, "IDENTIFY") != 0 && strcmp(name, "DISCOVER") != 0 &&
        strcmp(name, "TEST_EFFECT") != 0) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Unknown command.");
    }

    esp_err_t ret = ESP_OK;
    if (strcmp(name, "START_GAME") == 0) {
        portENTER_CRITICAL(&state_mux);
        runtime_reset_locked();
        runtime_running = true;
        runtime_started_ms = esp_timer_get_time() / 1000;
        portEXIT_CRITICAL(&state_mux);
        ret = send_runtime_to_devices(true);
    } else if (strcmp(name, "STOP_GAME") == 0) {
        portENTER_CRITICAL(&state_mux);
        runtime_running = false;
        portEXIT_CRITICAL(&state_mux);
        ret = send_espnow_broadcast("STOP");
    } else if (strcmp(name, "TEST_EFFECT") == 0) {
        ret = send_runtime_to_devices(false, true);
    } else {
        ret = send_espnow_broadcast(name);
    }
    if (ret != ESP_OK) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "ESP-NOW send failed.");
    }

    const char *reply = (strcmp(name, "DISCOVER") == 0) ? "Scan sent. Please wait and refresh the list." : "Command sent.";
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, reply);
}

static esp_err_t scan_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /scan");
    if (handle_cors_options(req)) return ESP_OK;
    set_cors_headers(req);
    esp_err_t ret = send_espnow_broadcast("DISCOVER");
    if (ret != ESP_OK) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "Scan failed.");
    }
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, "Scan sent. Please wait and refresh the list.");
}

static esp_err_t send_signal_test_to_device(const uint8_t *mac,
                                            uint32_t group_mask,
                                            uint32_t peer_mask,
                                            uint32_t port,
                                            uint32_t led_count,
                                            int weak_rssi,
                                            int strong_rssi,
                                            uint32_t compression_x100,
                                            uint32_t smooth_samples)
{
    if (!mac || group_mask == 0 || peer_mask == 0) return ESP_ERR_INVALID_ARG;
    ensure_peer_exists(mac);

    char rule[256];
    snprintf(rule, sizeof(rule),
             "RULE|2|%u|1|1|1|%u|%u|6|0|-127|60000|3000|%u|1|0|1|0|0|0|1|5000|0",
             (unsigned int)SIGNAL_TEST_ROOM_HASH,
             (unsigned int)group_mask,
             (unsigned int)peer_mask,
             (unsigned int)(smooth_samples ? smooth_samples : 5));
    esp_err_t ret = send_espnow_command_to(mac, rule);
    if (ret != ESP_OK) return ret;

    char meter[128];
    snprintf(meter, sizeof(meter), "METER|%u|1|1|%u|%u|%d|%d|%u",
             (unsigned int)SIGNAL_TEST_ROOM_HASH,
             (unsigned int)(port ? port : 1),
             (unsigned int)(led_count ? led_count : 10),
             weak_rssi,
             strong_rssi,
             (unsigned int)(compression_x100 ? compression_x100 : 100));
    ret = send_espnow_command_to(mac, meter);
    if (ret != ESP_OK) return ret;

    char cfg[128];
    snprintf(cfg, sizeof(cfg), "CFG|%u|%u|%u|gte|0|60000|silent",
             (unsigned int)SIGNAL_TEST_ROOM_HASH,
             (unsigned int)group_mask,
             (unsigned int)peer_mask);
    ret = send_espnow_command_to(mac, cfg);
    if (ret != ESP_OK) return ret;

    ret = send_espnow_command_to(mac, "TRG|silent");
    if (ret != ESP_OK) return ret;

    return send_espnow_command_to(mac, "START");
}

static int url_hex_value(char ch)
{
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'a' && ch <= 'f') return 10 + (ch - 'a');
    if (ch >= 'A' && ch <= 'F') return 10 + (ch - 'A');
    return -1;
}

static void url_decode_in_place(char *text)
{
    if (!text) return;
    char *read = text;
    char *write = text;
    while (*read) {
        if (*read == '%' && isxdigit((unsigned char)read[1]) && isxdigit((unsigned char)read[2])) {
            int hi = url_hex_value(read[1]);
            int lo = url_hex_value(read[2]);
            if (hi >= 0 && lo >= 0) {
                *write++ = (char)((hi << 4) | lo);
                read += 3;
                continue;
            }
        }
        *write++ = (*read == '+') ? ' ' : *read;
        read++;
    }
    *write = '\0';
}

static esp_err_t signal_test_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /signal/test");
    if (handle_cors_options(req)) return ESP_OK;
    set_cors_headers(req);

    char query[320] = {0};
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "{\"error\":\"missing_query\"}");
    }

    char action[16] = {0};
    char source_text[24] = {0};
    char target_text[24] = {0};
    char token[24] = {0};
    uint8_t source_mac[6] = {0};
    uint8_t target_mac[6] = {0};
    httpd_query_key_value(query, "action", action, sizeof(action));
    httpd_query_key_value(query, "source", source_text, sizeof(source_text));
    httpd_query_key_value(query, "target", target_text, sizeof(target_text));
    url_decode_in_place(action);
    url_decode_in_place(source_text);
    url_decode_in_place(target_text);

    bool have_source = parse_mac_string(source_text, source_mac);
    bool have_target = parse_mac_string(target_text, target_mac);

    if (strcmp(action, "stop") == 0) {
        esp_err_t ret = ESP_OK;
        if (have_source) ret = send_espnow_command_to(source_mac, "STOP");
        if (ret == ESP_OK && have_target) ret = send_espnow_command_to(target_mac, "STOP");
        if (!have_source && !have_target) ret = send_espnow_broadcast("STOP");
        portENTER_CRITICAL(&state_mux);
        runtime_running = false;
        portEXIT_CRITICAL(&state_mux);
        if (ret != ESP_OK) {
            httpd_resp_set_status(req, "500 Internal Server Error");
            return httpd_resp_sendstr(req, "{\"error\":\"stop_failed\"}");
        }
        return httpd_resp_sendstr(req, "{\"ok\":true,\"running\":false}");
    }

    if (!have_source || !have_target || mac_equal(source_mac, target_mac)) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "{\"error\":\"invalid_devices\"}");
    }

    uint32_t port = 1;
    uint32_t led_count = 10;
    uint32_t compression_x100 = 100;
    uint32_t smooth_samples = 5;
    int weak_rssi = -90;
    int strong_rssi = -35;

    if (httpd_query_key_value(query, "port", token, sizeof(token)) == ESP_OK) port = (uint32_t)strtoul(token, NULL, 10);
    if (httpd_query_key_value(query, "count", token, sizeof(token)) == ESP_OK) led_count = (uint32_t)strtoul(token, NULL, 10);
    if (httpd_query_key_value(query, "weak", token, sizeof(token)) == ESP_OK) weak_rssi = atoi(token);
    if (httpd_query_key_value(query, "strong", token, sizeof(token)) == ESP_OK) strong_rssi = atoi(token);
    if (httpd_query_key_value(query, "compression", token, sizeof(token)) == ESP_OK) compression_x100 = (uint32_t)strtoul(token, NULL, 10);
    if (httpd_query_key_value(query, "smooth", token, sizeof(token)) == ESP_OK) smooth_samples = (uint32_t)strtoul(token, NULL, 10);

    if (port < 1) port = 1;
    if (port > 3) port = 3;
    if (led_count < 1) led_count = 1;
    if (led_count > 200) led_count = 200;
    if (compression_x100 < 20) compression_x100 = 20;
    if (compression_x100 > 500) compression_x100 = 500;
    if (smooth_samples < 1) smooth_samples = 1;
    if (smooth_samples > 10) smooth_samples = 10;

    portENTER_CRITICAL(&state_mux);
    runtime_reset_locked();
    runtime_running = true;
    runtime_started_ms = esp_timer_get_time() / 1000;
    portEXIT_CRITICAL(&state_mux);

    esp_err_t ret = send_signal_test_to_device(source_mac, 1, 2, port, led_count, weak_rssi, strong_rssi, compression_x100, smooth_samples);
    if (ret == ESP_OK) {
        ret = send_signal_test_to_device(target_mac, 2, 1, port, led_count, weak_rssi, strong_rssi, compression_x100, smooth_samples);
    }
    if (ret != ESP_OK) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "{\"error\":\"signal_test_failed\"}");
    }

    char reply[256];
    snprintf(reply, sizeof(reply),
             "{\"ok\":true,\"running\":true,\"room\":%u,\"port\":%u,\"led_count\":%u,\"weak_rssi\":%d,\"strong_rssi\":%d,\"compression_x100\":%u,\"smooth_samples\":%u}",
             (unsigned int)SIGNAL_TEST_ROOM_HASH,
             (unsigned int)port,
             (unsigned int)led_count,
             weak_rssi,
             strong_rssi,
             (unsigned int)compression_x100,
             (unsigned int)smooth_samples);
    return httpd_resp_sendstr(req, reply);
}

static esp_err_t state_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /state");
    if (handle_cors_options(req)) return ESP_OK;
    set_cors_headers(req);

    receiver_device_t *device_snapshot = (receiver_device_t *)calloc(MAX_DEVICES, sizeof(receiver_device_t));
    group_config_t *group_snapshot = (group_config_t *)calloc(MAX_GROUPS, sizeof(group_config_t));
    pair_binding_t *pair_binding_snapshot = (pair_binding_t *)calloc(MAX_PAIR_BINDINGS, sizeof(pair_binding_t));
    discovery_record_t *record_snapshot = (discovery_record_t *)calloc(MAX_DISCOVERY_RECORDS, sizeof(discovery_record_t));
    runtime_event_t *runtime_event_snapshot = (runtime_event_t *)calloc(MAX_RUNTIME_EVENTS, sizeof(runtime_event_t));
    runtime_stat_t *runtime_stat_snapshot = (runtime_stat_t *)calloc(MAX_RUNTIME_STATS, sizeof(runtime_stat_t));
    int device_snapshot_count = 0;
    int pair_binding_snapshot_count = 0;
    int record_snapshot_count = 0;
    int runtime_event_snapshot_count = 0;
    bool runtime_running_snapshot = false;
    int64_t runtime_started_snapshot = 0;

    if (!device_snapshot || !group_snapshot || !pair_binding_snapshot || !record_snapshot || !runtime_event_snapshot || !runtime_stat_snapshot) {
        free(device_snapshot);
        free(group_snapshot);
        free(pair_binding_snapshot);
        free(record_snapshot);
        free(runtime_event_snapshot);
        free(runtime_stat_snapshot);
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "Out of memory.");
    }

    portENTER_CRITICAL(&state_mux);
    device_snapshot_count = device_count;
    pair_binding_snapshot_count = pair_binding_count;
    record_snapshot_count = record_count;
    runtime_event_snapshot_count = runtime_event_count;
    runtime_running_snapshot = runtime_running;
    runtime_started_snapshot = runtime_started_ms;
    memcpy(device_snapshot, devices, sizeof(receiver_device_t) * device_snapshot_count);
    memcpy(group_snapshot, groups, sizeof(group_config_t) * MAX_GROUPS);
    memcpy(pair_binding_snapshot, pair_bindings, sizeof(pair_binding_t) * pair_binding_snapshot_count);
    memcpy(record_snapshot, records, sizeof(discovery_record_t) * record_snapshot_count);
    memcpy(runtime_event_snapshot, runtime_events, sizeof(runtime_event_t) * runtime_event_snapshot_count);
    memcpy(runtime_stat_snapshot, runtime_stats, sizeof(runtime_stat_t) * MAX_RUNTIME_STATS);
    portEXIT_CRITICAL(&state_mux);

    strbuf_t sb = {};
    if (!sb_init(&sb, 8192)) {
        free(device_snapshot);
        free(group_snapshot);
        free(pair_binding_snapshot);
        free(record_snapshot);
        free(runtime_event_snapshot);
        free(runtime_stat_snapshot);
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "Out of memory.");
    }

    sb_appendf(&sb,
               "{\"release_version\":\"%s\",\"controller_firmware\":\"%s\",\"expected_receiver_firmware\":\"%s\",\"devices\":[",
               MAGICWAND_RELEASE_VERSION,
               MAGICWAND_CONTROLLER_BUILD,
               MAGICWAND_EXPECTED_RECEIVER_BUILD);
    int64_t now_ms = esp_timer_get_time() / 1000;
    for (int i = 0; i < device_snapshot_count; i++) {
        char mac_text[18];
        char display_name[DEVICE_NAME_LEN];
        char escaped_name[DEVICE_NAME_LEN * 2];
        char escaped_release[FW_TEXT_LEN * 2];
        char escaped_firmware[FW_TEXT_LEN * 2];
        snprintf(display_name, sizeof(display_name), "%s", device_snapshot[i].name);
        normalize_device_name_for_index(i, display_name, sizeof(display_name));
        mac_to_string(device_snapshot[i].mac, mac_text, sizeof(mac_text));
        json_escape(display_name, escaped_name, sizeof(escaped_name));
        json_escape(device_snapshot[i].release_version, escaped_release, sizeof(escaped_release));
        json_escape(device_snapshot[i].firmware_version, escaped_firmware, sizeof(escaped_firmware));
        sb_appendf(&sb,
                   "%s{\"idx\":%d,\"mac\":\"%s\",\"name\":\"%s\",\"group_mask\":%u,\"rssi\":%d,\"seen_ms\":%lld,\"release_version\":\"%s\",\"firmware_version\":\"%s\"}",
                   i == 0 ? "" : ",",
                   i, mac_text, escaped_name,
                   (unsigned int)device_snapshot[i].group_mask,
                   device_snapshot[i].rssi,
                   (long long)(now_ms - device_snapshot[i].last_seen_ms),
                   escaped_release,
                   escaped_firmware);
    }
    sb_appendf(&sb, "],\"groups\":[");
    for (int g = 0; g < MAX_GROUPS; g++) {
        char name[DEVICE_NAME_LEN * 2];
        char note[GROUP_TEXT_LEN * 2];
        char effect[GROUP_TEXT_LEN * 2];
        char silence[GROUP_TEXT_LEN * 2];
        char trigger[GROUP_TEXT_LEN * 2];
        json_escape(group_snapshot[g].name, name, sizeof(name));
        json_escape(group_snapshot[g].note, note, sizeof(note));
        json_escape(group_snapshot[g].effect_note, effect, sizeof(effect));
        json_escape(group_snapshot[g].silence_note, silence, sizeof(silence));
        json_escape(group_snapshot[g].trigger_effect_note, trigger, sizeof(trigger));
        sb_appendf(&sb,
                   "%s{\"id\":%d,\"valid\":%u,\"name\":\"%s\",\"note\":\"%s\",\"effect\":\"%s\",\"trigger_effect\":\"%s\",\"silence\":\"%s\",\"peer_mask\":%u,\"room_hash\":%u,\"target\":%u,\"mode\":%u,\"trigger_compare\":\"%s\",\"rssi\":%d,\"hold\":%u,\"rule_id\":%u,\"rule_base\":%u,\"rule_judge\":%u,\"rule_signal\":%u,\"rule_rssi_min\":%d,\"rule_rssi_max\":%d,\"rule_missing_ms\":%u,\"rule_smooth_samples\":%u,\"rule_trigger\":%u,\"rule_target_ms\":%u,\"rule_target_count\":%u,\"rule_period_ms\":%u,\"rule_score_target\":%u,\"rule_points\":%d,\"rule_repeat\":%u,\"rule_cooldown_ms\":%u,\"rule_after\":%u,\"meter_enabled\":%u,\"meter_port\":%u,\"meter_led_count\":%u,\"meter_weak_rssi\":%d,\"meter_strong_rssi\":%d,\"meter_compression_x100\":%u}",
                   g == 0 ? "" : ",",
                   g,
                   (unsigned int)group_snapshot[g].valid,
                   name, note, effect, trigger, silence,
                   (unsigned int)group_snapshot[g].peer_mask,
                   (unsigned int)group_snapshot[g].room_hash,
                   (unsigned int)group_snapshot[g].target_group,
                   (unsigned int)group_snapshot[g].mode,
                   group_snapshot[g].trigger_compare ? "lte" : "gte",
                   (int)group_snapshot[g].rssi_threshold,
                   (unsigned int)group_snapshot[g].hold_ms,
                   (unsigned int)group_snapshot[g].rule_id,
                   (unsigned int)group_snapshot[g].rule_base,
                   (unsigned int)group_snapshot[g].rule_judge,
                   (unsigned int)group_snapshot[g].rule_signal,
                   (int)group_snapshot[g].rule_rssi_min,
                   (int)group_snapshot[g].rule_rssi_max,
                   (unsigned int)group_snapshot[g].rule_missing_ms,
                   (unsigned int)group_snapshot[g].rule_smooth_samples,
                   (unsigned int)group_snapshot[g].rule_trigger,
                   (unsigned int)group_snapshot[g].rule_target_ms,
                   (unsigned int)group_snapshot[g].rule_target_count,
                   (unsigned int)group_snapshot[g].rule_period_ms,
                   (unsigned int)group_snapshot[g].rule_score_target,
                   (int)group_snapshot[g].rule_points,
                   (unsigned int)group_snapshot[g].rule_repeat,
                   (unsigned int)group_snapshot[g].rule_cooldown_ms,
                   (unsigned int)group_snapshot[g].rule_after,
                   (unsigned int)group_snapshot[g].meter_enabled,
                   (unsigned int)group_snapshot[g].meter_port,
                   (unsigned int)group_snapshot[g].meter_led_count,
                   (int)group_snapshot[g].meter_weak_rssi,
                   (int)group_snapshot[g].meter_strong_rssi,
                   (unsigned int)(group_snapshot[g].meter_compression_x100 ? group_snapshot[g].meter_compression_x100 : 100));
    }
    sb_appendf(&sb, "],\"pair_bindings\":[");
    for (int i = 0; i < pair_binding_snapshot_count; i++) {
        char source_mac[18];
        char target_mac[18];
        mac_to_string(pair_binding_snapshot[i].source_mac, source_mac, sizeof(source_mac));
        mac_to_string(pair_binding_snapshot[i].target_mac, target_mac, sizeof(target_mac));
        sb_appendf(&sb,
                   "%s{\"rule_id\":%u,\"source_mac\":\"%s\",\"target_mac\":\"%s\",\"source_group_id\":%u,\"target_group_id\":%u}",
                   i == 0 ? "" : ",",
                   (unsigned int)pair_binding_snapshot[i].rule_id,
                   source_mac,
                   target_mac,
                   (unsigned int)pair_binding_snapshot[i].source_group_id,
                   (unsigned int)pair_binding_snapshot[i].target_group_id);
    }
    sb_appendf(&sb, "],\"records\":[");
    for (int i = 0; i < record_snapshot_count; i++) {
        sb_appendf(&sb,
                   "%s{\"src_group\":%u,\"target_group\":%u,\"src_idx\":%d,\"dst_idx\":%d,\"first_seen_ms\":%lld,\"last_seen_ms\":%lld}",
                   i == 0 ? "" : ",",
                   (unsigned int)record_snapshot[i].source_group,
                   (unsigned int)record_snapshot[i].target_group,
                   (int)record_snapshot[i].source_device_index,
                   (int)record_snapshot[i].target_device_index,
                   (long long)record_snapshot[i].first_seen_ms,
                   (long long)record_snapshot[i].last_seen_ms);
    }
    sb_appendf(&sb, "],\"runtime\":{\"running\":%s,\"started_ms\":%lld,\"events\":[",
               runtime_running_snapshot ? "true" : "false",
               (long long)runtime_started_snapshot);
    for (int i = 0; i < runtime_event_snapshot_count; i++) {
        char self_mac[18];
        char peer_mac[18];
        mac_to_string(runtime_event_snapshot[i].self_mac, self_mac, sizeof(self_mac));
        mac_to_string(runtime_event_snapshot[i].peer_mac, peer_mac, sizeof(peer_mac));
        sb_appendf(&sb,
                   "%s{\"room\":%u,\"self_idx\":%d,\"peer_idx\":%d,\"self_mac\":\"%s\",\"peer_mac\":\"%s\",\"self_group_mask\":%u,\"peer_group_mask\":%u,\"rssi\":%d,\"kind\":%u,\"points\":%d,\"seq\":%u,\"event_ms\":%lld}",
                   i == 0 ? "" : ",",
                   (unsigned int)runtime_event_snapshot[i].room_hash,
                   (int)runtime_event_snapshot[i].self_device_index,
                   (int)runtime_event_snapshot[i].peer_device_index,
                   self_mac,
                   peer_mac,
                   (unsigned int)runtime_event_snapshot[i].self_group_mask,
                   (unsigned int)runtime_event_snapshot[i].peer_group_mask,
                   (int)runtime_event_snapshot[i].rssi,
                   (unsigned int)runtime_event_snapshot[i].kind,
                   (int)runtime_event_snapshot[i].points,
                   (unsigned int)runtime_event_snapshot[i].seq,
                   (long long)runtime_event_snapshot[i].event_ms);
    }
    sb_appendf(&sb, "],\"receiver_stats\":[");
    bool first_stat = true;
    for (int i = 0; i < MAX_RUNTIME_STATS; i++) {
        if (!runtime_stat_snapshot[i].valid) continue;
        char self_mac[18];
        char best_peer[18];
        mac_to_string(runtime_stat_snapshot[i].self_mac, self_mac, sizeof(self_mac));
        mac_to_string(runtime_stat_snapshot[i].best_peer_mac, best_peer, sizeof(best_peer));
        sb_appendf(&sb,
                   "%s{\"room\":%u,\"self_mac\":\"%s\",\"seen_count\":%u,\"found_count\":%u,\"best_peer\":\"%s\",\"best_rssi\":%d,\"active_ms\":%u,\"seq\":%u,\"seen_ms\":%lld}",
                   first_stat ? "" : ",",
                   (unsigned int)runtime_stat_snapshot[i].room_hash,
                   self_mac,
                   (unsigned int)runtime_stat_snapshot[i].seen_count,
                   (unsigned int)runtime_stat_snapshot[i].found_count,
                   best_peer,
                   (int)runtime_stat_snapshot[i].best_rssi,
                   (unsigned int)runtime_stat_snapshot[i].active_ms,
                   (unsigned int)runtime_stat_snapshot[i].seq,
                   (long long)(now_ms - runtime_stat_snapshot[i].last_seen_ms));
        first_stat = false;
    }
    sb_appendf(&sb, "]}}");

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

    esp_err_t ret = httpd_resp_send(req, sb.buf, sb.len);
    sb_free(&sb);
    free(device_snapshot);
    free(group_snapshot);
    free(pair_binding_snapshot);
    free(record_snapshot);
    free(runtime_event_snapshot);
    free(runtime_stat_snapshot);
    return ret;
}

static esp_err_t identify_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /identify");
    if (handle_cors_options(req)) return ESP_OK;
    set_cors_headers(req);
    char query[256] = {0};
    char mac_text[64] = {0};
    uint8_t mac[6] = {0};
    int index = -1;
    bool have_target = false;

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Invalid request.");
    }

    if (get_device_index_from_query(query, &index)) {
        portENTER_CRITICAL(&state_mux);
        if (index >= 0 && index < device_count) {
            memcpy(mac, devices[index].mac, sizeof(mac));
            have_target = true;
        }
        portEXIT_CRITICAL(&state_mux);
    }

    if (!have_target &&
        httpd_query_key_value(query, "mac", mac_text, sizeof(mac_text)) == ESP_OK &&
        parse_mac_string(mac_text, mac)) {
        have_target = true;
    }

    if (!have_target) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Invalid MAC.");
    }

    esp_err_t ret = send_espnow_command_to(mac, "IDENTIFY");
    if (ret != ESP_OK) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "Identify failed.");
    }

    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, "Identify sent.");
}

static esp_err_t device_save_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /device_save");
    if (handle_cors_options(req)) return ESP_OK;
    set_cors_headers(req);
    char query[256] = {0};
    char name_text[DEVICE_NAME_LEN * 2] = {0};
    char mac_text[64] = {0};
    char groups_text[32] = {0};
    uint8_t mac[6] = {0};
    char name[DEVICE_NAME_LEN] = {0};
    int index = -1;

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Invalid request.");
    }

    if (!get_device_index_from_query(query, &index) &&
        !(httpd_query_key_value(query, "mac", mac_text, sizeof(mac_text)) == ESP_OK && parse_mac_string(mac_text, mac))) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Invalid MAC.");
    }

    if (httpd_query_key_value(query, "name", name_text, sizeof(name_text)) == ESP_OK) {
        url_decode_component(name_text, name, sizeof(name));
    } else {
        name[0] = '\0';
    }

    bool has_groups = httpd_query_key_value(query, "groups", groups_text, sizeof(groups_text)) == ESP_OK;
    bool has_group = false;
    uint32_t group_mask = 0;
    int single_group = -1;
    if (has_groups) {
        char *end = NULL;
        unsigned long value = strtoul(groups_text, &end, 10);
        if (end != groups_text && *end == '\0') {
            group_mask = (uint32_t)value;
        } else {
            has_groups = false;
        }
    } else if (httpd_query_key_value(query, "group", groups_text, sizeof(groups_text)) == ESP_OK) {
        char *end = NULL;
        long value = strtol(groups_text, &end, 10);
        if (end != groups_text && *end == '\0' && value >= 0 && value < MAX_GROUPS) {
            single_group = (int)value;
            has_group = true;
        }
    }

    bool ok = false;
    portENTER_CRITICAL(&state_mux);
    if (index >= 0 && index < device_count) {
        if (name[0] == '\0') {
            make_default_device_name(index, devices[index].name, sizeof(devices[index].name));
        } else {
            snprintf(devices[index].name, sizeof(devices[index].name), "%s", name);
        }
        if (has_groups) {
            devices[index].group_mask = group_mask;
        } else if (has_group) {
            devices[index].group_mask = group_bit(single_group);
        }
        registry_dirty = true;
        ok = true;
    } else if (index < 0) {
        int found_idx = find_device_index_by_mac_locked(mac);
        if (found_idx >= 0) {
            if (name[0] == '\0') {
                make_default_device_name(found_idx, devices[found_idx].name, sizeof(devices[found_idx].name));
            } else {
                snprintf(devices[found_idx].name, sizeof(devices[found_idx].name), "%s", name);
            }
            if (has_groups) {
                devices[found_idx].group_mask = group_mask;
            } else if (has_group) {
                devices[found_idx].group_mask = group_bit(single_group);
            }
            registry_dirty = true;
            ok = true;
        }
    }
    portEXIT_CRITICAL(&state_mux);

    if (!ok) {
        httpd_resp_set_status(req, "404 Not Found");
        return httpd_resp_sendstr(req, "Receiver not found.");
    }

    sync_effects_to_devices();

    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, "Device saved.");
}

static esp_err_t device_delete_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /device_delete");
    if (handle_cors_options(req)) return ESP_OK;
    set_cors_headers(req);
    char query[256] = {0};
    char mac_text[64] = {0};
    uint8_t mac[6] = {0};
    int index = -1;
    bool ok = false;

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Invalid request.");
    }

    if (get_device_index_from_query(query, &index)) {
        portENTER_CRITICAL(&state_mux);
        ok = delete_device_locked(index);
        portEXIT_CRITICAL(&state_mux);
    } else if (httpd_query_key_value(query, "mac", mac_text, sizeof(mac_text)) == ESP_OK &&
               parse_mac_string(mac_text, mac)) {
        portENTER_CRITICAL(&state_mux);
        index = find_device_index_by_mac_locked(mac);
        if (index >= 0) {
            ok = delete_device_locked(index);
        }
        portEXIT_CRITICAL(&state_mux);
    }

    if (!ok) {
        httpd_resp_set_status(req, "404 Not Found");
        return httpd_resp_sendstr(req, "Device not found.");
    }

    registry_save();
    sync_effects_to_devices();

    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, "Device deleted.");
}

static esp_err_t group_save_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /group_save");
    if (handle_cors_options(req)) return ESP_OK;
    set_cors_headers(req);
    char query[512] = {0};
    char name_raw[DEVICE_NAME_LEN * 2] = {0};
    char note_raw[GROUP_TEXT_LEN * 2] = {0};
    char effect_raw[GROUP_TEXT_LEN * 2] = {0};
    char silence_raw[GROUP_TEXT_LEN * 2] = {0};
    char target_text[16] = {0};
    char mode_text[16] = {0};
    char rssi_text[16] = {0};
    char hold_text[16] = {0};
    char members_text[32] = {0};
    char name[DEVICE_NAME_LEN] = {0};
    char note[GROUP_TEXT_LEN] = {0};
    char effect[GROUP_TEXT_LEN] = {0};
    char silence[GROUP_TEXT_LEN] = {0};
    int gid = -1;
    int target_gid = -1;
    int mode = GROUP_MODE_INDEPENDENT;
    int16_t rssi_threshold = -70;
    uint16_t hold_ms = 2000;
    uint32_t members = 0;

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK ||
        !get_group_index_from_query(query, &gid)) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Invalid group request.");
    }

    if (httpd_query_key_value(query, "name", name_raw, sizeof(name_raw)) == ESP_OK) {
        url_decode_component(name_raw, name, sizeof(name));
    }
    if (httpd_query_key_value(query, "note", note_raw, sizeof(note_raw)) == ESP_OK) {
        url_decode_component(note_raw, note, sizeof(note));
    }
    if (httpd_query_key_value(query, "effect", effect_raw, sizeof(effect_raw)) == ESP_OK) {
        url_decode_component(effect_raw, effect, sizeof(effect));
    }
    if (httpd_query_key_value(query, "silence", silence_raw, sizeof(silence_raw)) == ESP_OK) {
        url_decode_component(silence_raw, silence, sizeof(silence));
    }
    if (httpd_query_key_value(query, "target", target_text, sizeof(target_text)) == ESP_OK) {
        char *end = NULL;
        long value = strtol(target_text, &end, 10);
        if (end != target_text && *end == '\0' && value >= 0 && value < MAX_GROUPS) {
            target_gid = (int)value;
        }
    }
    if (httpd_query_key_value(query, "mode", mode_text, sizeof(mode_text)) == ESP_OK) {
        mode = atoi(mode_text);
        if (mode < 0 || mode > 2) mode = GROUP_MODE_INDEPENDENT;
    }
    if (httpd_query_key_value(query, "rssi", rssi_text, sizeof(rssi_text)) == ESP_OK) {
        rssi_threshold = (int16_t)atoi(rssi_text);
    }
    if (httpd_query_key_value(query, "hold", hold_text, sizeof(hold_text)) == ESP_OK) {
        int value = atoi(hold_text);
        if (value < 0) value = 0;
        hold_ms = (uint16_t)value;
    }
    if (httpd_query_key_value(query, "members", members_text, sizeof(members_text)) == ESP_OK) {
        char *end = NULL;
        unsigned long value = strtoul(members_text, &end, 10);
        if (end != members_text && *end == '\0') {
            members = (uint32_t)value;
        }
    }

    bool ok = false;
    portENTER_CRITICAL(&state_mux);
    if (gid >= 0 && gid < MAX_GROUPS) {
        if (name[0] == '\0') {
            make_default_group_name(gid, name, sizeof(name));
        }
        ok = save_group_locked(gid, name, note, effect, silence, target_gid, mode, rssi_threshold, hold_ms, members);
    }
    portEXIT_CRITICAL(&state_mux);

    if (!ok) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Invalid group data.");
    }

    sync_effects_to_devices();

    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, "Group saved.");
}

static esp_err_t group_delete_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /group_delete");
    if (handle_cors_options(req)) return ESP_OK;
    set_cors_headers(req);
    char query[64] = {0};
    int gid = -1;

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK ||
        !get_group_index_from_query(query, &gid)) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Invalid group request.");
    }

    bool ok = false;
    portENTER_CRITICAL(&state_mux);
    ok = delete_group_locked(gid);
    portEXIT_CRITICAL(&state_mux);

    if (!ok) {
        httpd_resp_set_status(req, "404 Not Found");
        return httpd_resp_sendstr(req, "Group not found.");
    }

    sync_effects_to_devices();

    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, "Group deleted.");
}

static esp_err_t record_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /record");
    if (handle_cors_options(req)) return ESP_OK;
    set_cors_headers(req);
    char query[64] = {0};
    int gid = -1;

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK ||
        !get_group_index_from_query(query, &gid)) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Invalid group request.");
    }

    bool ok = false;
    portENTER_CRITICAL(&state_mux);
    ok = record_demo_for_group_locked(gid);
    portEXIT_CRITICAL(&state_mux);

    if (!ok) {
        httpd_resp_set_status(req, "404 Not Found");
        return httpd_resp_sendstr(req, "No new discovery record could be created.");
    }

    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, "Discovery record added.");
}

static esp_err_t config_import_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP POST /config/import content_len=%d", (int)req->content_len);
    if (req->method == HTTP_OPTIONS) {
        set_cors_headers(req);
        httpd_resp_set_status(req, "204 No Content");
        return httpd_resp_send(req, NULL, 0);
    }

    if (req->method == HTTP_GET) {
        set_cors_headers(req);
        httpd_resp_set_type(req, "text/plain");
        return httpd_resp_sendstr(req, "POST JSON to /config/import to replace the current registry.");
    }

    if (req->method != HTTP_POST) {
        httpd_resp_set_status(req, "405 Method Not Allowed");
        set_cors_headers(req);
        return httpd_resp_sendstr(req, "Method not allowed.");
    }

    if (req->content_len == 0 || req->content_len > CONFIG_IMPORT_MAX_BODY) {
        httpd_resp_set_status(req, "413 Payload Too Large");
        set_cors_headers(req);
        return httpd_resp_sendstr(req, "Invalid import payload size.");
    }

    char *body = (char *)malloc(req->content_len + 1);
    if (!body) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        set_cors_headers(req);
        return httpd_resp_sendstr(req, "Out of memory.");
    }

    int received = 0;
    while (received < (int)req->content_len) {
        int r = httpd_req_recv(req, body + received, req->content_len - received);
        if (r == HTTPD_SOCK_ERR_TIMEOUT) {
            continue;
        }
        if (r <= 0) {
            free(body);
            httpd_resp_set_status(req, "400 Bad Request");
            set_cors_headers(req);
            return httpd_resp_sendstr(req, "Failed to read request body.");
        }
        received += r;
    }
    body[received] = '\0';
    ESP_LOGI(TAG, "Import body received bytes=%d", received);

    receiver_device_t *imported_devices = (receiver_device_t *)calloc(MAX_DEVICES, sizeof(receiver_device_t));
    group_config_t *imported_groups = (group_config_t *)calloc(MAX_GROUPS, sizeof(group_config_t));
    pair_binding_t *imported_pair_bindings = (pair_binding_t *)calloc(MAX_PAIR_BINDINGS, sizeof(pair_binding_t));
    discovery_record_t *imported_records = (discovery_record_t *)calloc(MAX_DISCOVERY_RECORDS, sizeof(discovery_record_t));
    if (!imported_devices || !imported_groups || !imported_pair_bindings || !imported_records) {
        free(body);
        free(imported_devices);
        free(imported_groups);
        free(imported_pair_bindings);
        free(imported_records);
        httpd_resp_set_status(req, "500 Internal Server Error");
        set_cors_headers(req);
        return httpd_resp_sendstr(req, "Out of memory.");
    }
    int imported_device_count = 0;
    int imported_pair_binding_count = 0;
    int imported_record_count = 0;
    int schema_version = 0;
    char error_text[128];

    bool ok = parse_registry_import_json(body,
                                         imported_devices, &imported_device_count,
                                         imported_groups,
                                         imported_pair_bindings, &imported_pair_binding_count,
                                         imported_records, &imported_record_count,
                                         &schema_version,
                                         error_text, sizeof(error_text));
    free(body);

    if (!ok) {
        ESP_LOGW(TAG, "Import parse failed: %s", error_text[0] ? error_text : "Invalid config JSON.");
        free(imported_devices);
        free(imported_groups);
        free(imported_pair_bindings);
        free(imported_records);
        httpd_resp_set_status(req, "400 Bad Request");
        set_cors_headers(req);
        return httpd_resp_sendstr(req, error_text[0] ? error_text : "Invalid config JSON.");
    }
    ESP_LOGI(TAG, "Import parsed ok: schema=%d devices=%d groups=%d pair_bindings=%d records=%d", schema_version, imported_device_count, MAX_GROUPS, imported_pair_binding_count, imported_record_count);

    portENTER_CRITICAL(&state_mux);
    memset(devices, 0, sizeof(devices));
    memset(groups, 0, sizeof(groups));
    memset(pair_bindings, 0, sizeof(pair_bindings));
    memset(records, 0, sizeof(records));
    runtime_reset_locked();
    memcpy(devices, imported_devices, sizeof(receiver_device_t) * imported_device_count);
    memcpy(groups, imported_groups, sizeof(groups));
    memcpy(pair_bindings, imported_pair_bindings, sizeof(pair_binding_t) * imported_pair_binding_count);
    memcpy(records, imported_records, sizeof(discovery_record_t) * imported_record_count);
    device_count = imported_device_count;
    pair_binding_count = imported_pair_binding_count;
    record_count = imported_record_count;
    free(imported_devices);
    free(imported_groups);
    free(imported_pair_bindings);
    free(imported_records);
    for (int i = 0; i < device_count; i++) {
        normalize_device_name_for_index(i, devices[i].name, sizeof(devices[i].name));
    }
    for (int g = 0; g < MAX_GROUPS; g++) {
        if (groups[g].valid) {
            ensure_group_default_fields_locked(g);
        }
    }
    prune_invalid_group_refs_locked();
    registry_dirty = true;
    portEXIT_CRITICAL(&state_mux);

    char reply[160];
    snprintf(reply, sizeof(reply),
             "{\"ok\":true,\"schema_version\":%d,\"devices\":%d,\"groups\":%d,\"pair_bindings\":%d,\"records\":%d}",
             schema_version, imported_device_count, MAX_GROUPS, imported_pair_binding_count, imported_record_count);
    httpd_resp_set_type(req, "application/json");
    set_cors_headers(req);
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    esp_err_t send_ret = httpd_resp_sendstr(req, reply);
    if (send_ret != ESP_OK) {
        ESP_LOGW(TAG, "Import response send failed: %s", esp_err_to_name(send_ret));
        return send_ret;
    }
    ESP_LOGI(TAG, "Import response sent; continuing with save/sync in handler.");
    registry_save();
    sync_effects_to_devices();
    send_runtime_to_devices(false);
    ESP_LOGI(TAG, "Import handler finished.");
    return ESP_OK;
}

static void register_get_uri(httpd_handle_t server, const char *uri, esp_err_t (*handler)(httpd_req_t *req))
{
    httpd_uri_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.uri = uri;
    cfg.method = (httpd_method_t)HTTP_ANY;
    cfg.handler = handler;
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &cfg));
}

static void register_any_uri(httpd_handle_t server, const char *uri, esp_err_t (*handler)(httpd_req_t *req))
{
    httpd_uri_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.uri = uri;
    cfg.method = (httpd_method_t)HTTP_ANY;
    cfg.handler = handler;
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &cfg));
}

static void start_web_server(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.stack_size = 16384;
    config.max_uri_handlers = 16;
    config.lru_purge_enable = true;
    httpd_handle_t server = NULL;

    ESP_ERROR_CHECK(httpd_start(&server, &config));
    register_get_uri(server, "/", root_handler);
    register_get_uri(server, "/state", state_handler);
    register_get_uri(server, "/devices", state_handler);
    register_get_uri(server, "/cmd", command_handler);
    register_get_uri(server, "/scan", scan_handler);
    register_get_uri(server, "/signal/test", signal_test_handler);
    register_get_uri(server, "/identify", identify_handler);
    register_get_uri(server, "/device_save", device_save_handler);
    register_get_uri(server, "/device_delete", device_delete_handler);
    register_get_uri(server, "/rename", device_save_handler);
    register_get_uri(server, "/group_save", group_save_handler);
    register_get_uri(server, "/group_delete", group_delete_handler);
    register_get_uri(server, "/record", record_handler);
    register_any_uri(server, "/config/import", config_import_handler);

    ESP_LOGI(TAG, "Web server ready: connect SSID '%s' (open), open http://192.168.4.1, UI %s", WIFI_AP_SSID, WEB_UI_VERSION);
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    if (event_base != WIFI_EVENT) return;

    if (event_id == WIFI_EVENT_AP_STACONNECTED) {
        wifi_event_ap_staconnected_t *event = (wifi_event_ap_staconnected_t *)event_data;
        ESP_LOGI(TAG, "Phone connected: %02X:%02X:%02X:%02X:%02X:%02X, AID=%d",
                 event->mac[0], event->mac[1], event->mac[2], event->mac[3], event->mac[4], event->mac[5], event->aid);
    } else if (event_id == WIFI_EVENT_AP_STADISCONNECTED) {
        wifi_event_ap_stadisconnected_t *event = (wifi_event_ap_stadisconnected_t *)event_data;
        ESP_LOGW(TAG, "Phone disconnected: %02X:%02X:%02X:%02X:%02X:%02X, AID=%d",
                 event->mac[0], event->mac[1], event->mac[2], event->mac[3], event->mac[4], event->mac[5], event->aid);
    }
}

static void wifi_and_espnow_init(void)
{
    esp_log_level_set("wifi", ESP_LOG_ERROR);
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    } else {
        ESP_ERROR_CHECK(ret);
    }

    ESP_ERROR_CHECK(esp_netif_init());
    ret = esp_event_loop_create_default();
    if (ret != ESP_ERR_INVALID_STATE) {
        ESP_ERROR_CHECK(ret);
    }

    esp_netif_create_default_wifi_ap();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));

    wifi_config_t ap_config;
    memset(&ap_config, 0, sizeof(ap_config));
    memcpy(ap_config.ap.ssid, WIFI_AP_SSID, strlen(WIFI_AP_SSID));
    ap_config.ap.ssid_len = strlen(WIFI_AP_SSID);
    ap_config.ap.channel = WIFI_AP_CHANNEL;
    ap_config.ap.max_connection = WIFI_AP_MAX_CONN;
    ap_config.ap.authmode = WIFI_AUTH_OPEN;
    ap_config.ap.pmf_cfg.required = false;

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_ERROR_CHECK(esp_now_init());
    ESP_ERROR_CHECK(esp_now_register_recv_cb(espnow_recv_cb));

    esp_now_peer_info_t peer;
    memset(&peer, 0, sizeof(peer));
    memcpy(peer.peer_addr, broadcast_mac, sizeof(broadcast_mac));
    peer.channel = WIFI_AP_CHANNEL;
    peer.ifidx = WIFI_IF_AP;
    peer.encrypt = false;
    ret = esp_now_add_peer(&peer);
    if (ret != ESP_OK && ret != ESP_ERR_ESPNOW_EXIST) {
        ESP_ERROR_CHECK(ret);
    }

    uint8_t mac[6] = {0};
    ESP_ERROR_CHECK(esp_wifi_get_mac(WIFI_IF_AP, mac));
    ESP_LOGI(TAG, "ESP-NOW READY, AP MAC=%02X:%02X:%02X:%02X:%02X:%02X, channel=%d",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5], WIFI_AP_CHANNEL);
}

static void registry_task(void *pvParameter)
{
    while (1) {
        if (registry_dirty) {
            registry_save();
        }
        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}

static void button_task(void *pvParameter)
{
    gpio_config_t io;
    memset(&io, 0, sizeof(io));
    io.pin_bit_mask = (1ULL << BTN_BOOT);
    io.mode = GPIO_MODE_INPUT;
    io.pull_up_en = GPIO_PULLUP_ENABLE;
    gpio_config(&io);

    bool last = true;
    while (1) {
        bool now = gpio_get_level(BTN_BOOT) != 0;
        if (last && !now) {
            vTaskDelay(pdMS_TO_TICKS(30));
            if (gpio_get_level(BTN_BOOT) == 0) {
                const char *cmd = next_button_stop ? "STOP" : "START";
                next_button_stop = !next_button_stop;
                send_espnow_broadcast(cmd);
                while (gpio_get_level(BTN_BOOT) == 0) {
                    vTaskDelay(pdMS_TO_TICKS(10));
                }
            }
        }
        last = now;
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

extern "C" void app_main(void)
{
    ESP_LOGI(TAG, "Controller booting...");
    wifi_and_espnow_init();
    start_web_server();
    registry_load();
    xTaskCreate(registry_task, "registry", 8192, NULL, 4, NULL);
    xTaskCreate(button_task, "button", 4096, NULL, 5, NULL);
}



