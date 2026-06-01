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
#define CONFIG_IMPORT_MAX_BODY (32 * 1024)

#define DEVICE_NAME_LEN 32
#define GROUP_TEXT_LEN 192
#define WEB_UI_VERSION "v0.2.6"
#define CONFIG_SCHEMA_VERSION 2

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
} receiver_device_t;

typedef struct {
    uint8_t valid;
    char name[DEVICE_NAME_LEN];
    char note[GROUP_TEXT_LEN];
    char effect_note[GROUP_TEXT_LEN];
    char silence_note[GROUP_TEXT_LEN];
    uint8_t target_group;      // 0xFF = none
    uint8_t mode;              // GROUP_MODE_*
    int16_t rssi_threshold;    // placeholder for future proximity logic
    uint16_t hold_ms;          // placeholder for future proximity logic
    uint8_t reserved[2];
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
    char *buf;
    size_t len;
    size_t cap;
} strbuf_t;

static const uint8_t broadcast_mac[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static bool next_button_stop = true;

static receiver_device_t devices[MAX_DEVICES];
static receiver_device_v1_t legacy_devices[MAX_DEVICES];
static group_config_t groups[MAX_GROUPS];
static discovery_record_t records[MAX_DISCOVERY_RECORDS];

static int device_count = 0;
static int record_count = 0;
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
        } else if (strcmp(key, "silence") == 0) {
            if (!jr_read_string(jr, dst->silence_note, sizeof(dst->silence_note))) return false;
        } else if (strcmp(key, "target") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < -1 || value > 255) return false;
            dst->target_group = (value < 0) ? 0xFF : (uint8_t)value;
        } else if (strcmp(key, "mode") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > 255) return false;
            dst->mode = (uint8_t)value;
        } else if (strcmp(key, "rssi") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < INT16_MIN || value > INT16_MAX) return false;
            dst->rssi_threshold = (int16_t)value;
        } else if (strcmp(key, "hold") == 0) {
            int64_t value = 0;
            if (!jr_parse_int64(jr, &value) || value < 0 || value > UINT16_MAX) return false;
            dst->hold_ms = (uint16_t)value;
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

static bool parse_registry_import_json(const char *json,
                                       receiver_device_t *device_out,
                                       int *device_count_out,
                                       group_config_t *group_out,
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
    bool have_records = false;
    bool group_seen[MAX_GROUPS] = {0};
    int device_count = 0;
    int record_count = 0;
    int64_t now_ms = esp_timer_get_time() / 1000;

    memset(device_out, 0, sizeof(receiver_device_t) * MAX_DEVICES);
    memset(group_out, 0, sizeof(group_config_t) * MAX_GROUPS);
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

    if (!have_schema || !have_devices || !have_groups || !have_records) {
        snprintf(error_text, error_text_size, "Missing required top-level fields.");
        return false;
    }
    if ((int)schema_version != 1 && (int)schema_version != CONFIG_SCHEMA_VERSION) {
        snprintf(error_text, error_text_size, "Unsupported schema_version %lld.", (long long)schema_version);
        return false;
    }

    *device_count_out = device_count;
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
        snprintf(groups[gid].effect_note, sizeof(groups[gid].effect_note), "selftest");
    }
    if (groups[gid].target_group >= MAX_GROUPS) groups[gid].target_group = 0xFF;
    if (groups[gid].target_group == gid) groups[gid].target_group = 0xFF;
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

static void remember_device(const uint8_t *mac, int rssi)
{
    if (!mac) return;
    int64_t now_ms = esp_timer_get_time() / 1000;

    portENTER_CRITICAL(&state_mux);
    int idx = find_device_index_by_mac_locked(mac);
    if (idx >= 0) {
        devices[idx].rssi = rssi;
        devices[idx].last_seen_ms = now_ms;
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
        registry_dirty = true;
    }
    portEXIT_CRITICAL(&state_mux);
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
        ESP_LOGI(TAG, "ESP-NOW TX %s to %s", cmd, mac_text);
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
            const char *resolved_spec = "selftest";
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
        snprintf(cmd, sizeof(cmd), "FXSET|%s", spec[0] ? spec : "selftest");
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
        snprintf(g->effect_note, sizeof(g->effect_note), "selftest");
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

    char msg[64];
    int copy_len = data_len < (int)sizeof(msg) - 1 ? data_len : (int)sizeof(msg) - 1;
    memcpy(msg, data, copy_len);
    msg[copy_len] = '\0';

    if (strncmp(msg, "PRESENT", 7) == 0) {
        int rssi = recv_info->rx_ctrl ? recv_info->rx_ctrl->rssi : 0;
        ensure_peer_exists(recv_info->src_addr);
        remember_device(recv_info->src_addr, rssi);
        char mac_text[18];
        mac_to_string(recv_info->src_addr, mac_text, sizeof(mac_text));
        ESP_LOGI(TAG, "Receiver present: %s, RSSI=%d", mac_text, rssi);
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
        strcmp(name, "IDENTIFY") != 0 && strcmp(name, "DISCOVER") != 0) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Unknown command.");
    }

    esp_err_t ret = send_espnow_broadcast(name);
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

static esp_err_t state_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /state");
    if (handle_cors_options(req)) return ESP_OK;
    set_cors_headers(req);

    receiver_device_t *device_snapshot = (receiver_device_t *)calloc(MAX_DEVICES, sizeof(receiver_device_t));
    group_config_t *group_snapshot = (group_config_t *)calloc(MAX_GROUPS, sizeof(group_config_t));
    discovery_record_t *record_snapshot = (discovery_record_t *)calloc(MAX_DISCOVERY_RECORDS, sizeof(discovery_record_t));
    int device_snapshot_count = 0;
    int record_snapshot_count = 0;

    if (!device_snapshot || !group_snapshot || !record_snapshot) {
        free(device_snapshot);
        free(group_snapshot);
        free(record_snapshot);
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "Out of memory.");
    }

    portENTER_CRITICAL(&state_mux);
    device_snapshot_count = device_count;
    record_snapshot_count = record_count;
    memcpy(device_snapshot, devices, sizeof(receiver_device_t) * device_snapshot_count);
    memcpy(group_snapshot, groups, sizeof(group_config_t) * MAX_GROUPS);
    memcpy(record_snapshot, records, sizeof(discovery_record_t) * record_snapshot_count);
    portEXIT_CRITICAL(&state_mux);

    strbuf_t sb = {};
    if (!sb_init(&sb, 8192)) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "Out of memory.");
    }

    sb_appendf(&sb, "{\"devices\":[");
    int64_t now_ms = esp_timer_get_time() / 1000;
    for (int i = 0; i < device_snapshot_count; i++) {
        char mac_text[18];
        char display_name[DEVICE_NAME_LEN];
        char escaped_name[DEVICE_NAME_LEN * 2];
        snprintf(display_name, sizeof(display_name), "%s", device_snapshot[i].name);
        normalize_device_name_for_index(i, display_name, sizeof(display_name));
        mac_to_string(device_snapshot[i].mac, mac_text, sizeof(mac_text));
        json_escape(display_name, escaped_name, sizeof(escaped_name));
        sb_appendf(&sb,
                   "%s{\"idx\":%d,\"mac\":\"%s\",\"name\":\"%s\",\"group_mask\":%u,\"rssi\":%d,\"seen_ms\":%lld}",
                   i == 0 ? "" : ",",
                   i, mac_text, escaped_name,
                   (unsigned int)device_snapshot[i].group_mask,
                   device_snapshot[i].rssi,
                   (long long)(now_ms - device_snapshot[i].last_seen_ms));
    }
    sb_appendf(&sb, "],\"groups\":[");
    for (int g = 0; g < MAX_GROUPS; g++) {
        char name[DEVICE_NAME_LEN * 2];
        char note[GROUP_TEXT_LEN * 2];
        char effect[GROUP_TEXT_LEN * 2];
        char silence[GROUP_TEXT_LEN * 2];
        json_escape(group_snapshot[g].name, name, sizeof(name));
        json_escape(group_snapshot[g].note, note, sizeof(note));
        json_escape(group_snapshot[g].effect_note, effect, sizeof(effect));
        json_escape(group_snapshot[g].silence_note, silence, sizeof(silence));
        sb_appendf(&sb,
                   "%s{\"id\":%d,\"valid\":%u,\"name\":\"%s\",\"note\":\"%s\",\"effect\":\"%s\",\"silence\":\"%s\",\"target\":%u,\"mode\":%u,\"rssi\":%d,\"hold\":%u}",
                   g == 0 ? "" : ",",
                   g,
                   (unsigned int)group_snapshot[g].valid,
                   name, note, effect, silence,
                   (unsigned int)group_snapshot[g].target_group,
                   (unsigned int)group_snapshot[g].mode,
                   (int)group_snapshot[g].rssi_threshold,
                   (unsigned int)group_snapshot[g].hold_ms);
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
    sb_appendf(&sb, "]}");

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

    esp_err_t ret = httpd_resp_send(req, sb.buf, sb.len);
    sb_free(&sb);
    free(device_snapshot);
    free(group_snapshot);
    free(record_snapshot);
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

    receiver_device_t imported_devices[MAX_DEVICES];
    group_config_t imported_groups[MAX_GROUPS];
    discovery_record_t imported_records[MAX_DISCOVERY_RECORDS];
    int imported_device_count = 0;
    int imported_record_count = 0;
    int schema_version = 0;
    char error_text[128];

    bool ok = parse_registry_import_json(body,
                                         imported_devices, &imported_device_count,
                                         imported_groups,
                                         imported_records, &imported_record_count,
                                         &schema_version,
                                         error_text, sizeof(error_text));
    free(body);

    if (!ok) {
        ESP_LOGW(TAG, "Import parse failed: %s", error_text[0] ? error_text : "Invalid config JSON.");
        httpd_resp_set_status(req, "400 Bad Request");
        set_cors_headers(req);
        return httpd_resp_sendstr(req, error_text[0] ? error_text : "Invalid config JSON.");
    }
    ESP_LOGI(TAG, "Import parsed ok: schema=%d devices=%d groups=%d records=%d", schema_version, imported_device_count, MAX_GROUPS, imported_record_count);

    portENTER_CRITICAL(&state_mux);
    memset(devices, 0, sizeof(devices));
    memset(groups, 0, sizeof(groups));
    memset(records, 0, sizeof(records));
    memcpy(devices, imported_devices, sizeof(receiver_device_t) * imported_device_count);
    memcpy(groups, imported_groups, sizeof(groups));
    memcpy(records, imported_records, sizeof(discovery_record_t) * imported_record_count);
    device_count = imported_device_count;
    record_count = imported_record_count;
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
             "{\"ok\":true,\"schema_version\":%d,\"devices\":%d,\"groups\":%d,\"records\":%d}",
             schema_version, imported_device_count, MAX_GROUPS, imported_record_count);
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


