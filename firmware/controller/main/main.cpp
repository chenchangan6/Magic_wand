// ESP32-C6 controller v2:
// - Opens a local WiFi AP for browser control.
// - Serves a tiny web page with global START / STOP / IDENTIFY buttons.
// - Scans ESP-NOW receivers and keeps a small in-memory device list.
// - Supports per-device IDENTIFY after scan.
// - Keeps the BOOT button START/STOP toggle for field use.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

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
#define WIFI_AP_PASS "12345678"
#define WIFI_AP_CHANNEL 1
#define WIFI_AP_MAX_CONN 4
#define BTN_BOOT ((gpio_num_t)9)
#define MAX_DEVICES 32
#define MAX_GROUPS 16
#define MAX_DISCOVERY_RECORDS 64
#define DEVICE_NAME_LEN 32
#define GROUP_TEXT_LEN 48
#define WEB_UI_VERSION "v0.2.0"

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
    uint8_t target_group;
    uint8_t mode;
    int16_t rssi_threshold;
    uint16_t hold_ms;
    uint8_t reserved[2];
} group_config_t;

typedef struct {
    uint8_t source_group;
    uint8_t target_group;
    int16_t source_device_index;
    int16_t target_device_index;
    uint8_t source_mac[6];
    uint8_t target_mac[6];
    int64_t first_seen_ms;
    int64_t last_seen_ms;
} discovery_record_t;

static const uint8_t broadcast_mac[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static bool next_button_stop = true;
static receiver_device_t devices[MAX_DEVICES];
static group_config_t groups[MAX_GROUPS];
static discovery_record_t discoveries[MAX_DISCOVERY_RECORDS];
static int device_count = 0;
static int discovery_count = 0;
static portMUX_TYPE device_mux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool registry_dirty = false;
static receiver_device_t registry_load_buffer[MAX_DEVICES];
static receiver_device_v1_t registry_load_v1_buffer[MAX_DEVICES];

static const char INDEX_HTML[] = R"MAGICHTML(
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Magic Wand Controller</title>
<style>
body{margin:0;font-family:Arial,'Microsoft YaHei',sans-serif;background:#101418;color:#f4f7fb;}
main{max-width:720px;margin:0 auto;padding:28px 18px;}
h1{font-size:26px;margin:0 0 8px;letter-spacing:0;}
h2{font-size:18px;margin:28px 0 12px;letter-spacing:0;}
p{margin:0 0 18px;color:#aeb8c5;line-height:1.6;}
.panel{display:grid;grid-template-columns:1fr;gap:12px;}
@media(min-width:640px){.panel{grid-template-columns:repeat(4,1fr);}}
button{min-height:50px;border:0;border-radius:8px;font-size:16px;font-weight:700;color:#081016;padding:0 14px;}
button:active{transform:translateY(1px);}
.start{background:#62d394;}.stop{background:#ff6b6b;}.id{background:#66c7ff;}.scan{background:#f6c95f;}
#status{margin-top:18px;color:#d7dee8;min-height:24px;}
.summary{margin-top:16px;padding:10px 12px;border:1px solid #2a3440;border-radius:8px;background:#171d24;color:#d7dee8;font-size:14px;line-height:1.5;}
.list{display:grid;gap:10px;margin-top:12px;}
.row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:12px;border:1px solid #2a3440;border-radius:8px;background:#171d24;}
.name{width:100%;box-sizing:border-box;border:1px solid #33404d;border-radius:6px;background:#101418;color:#f4f7fb;font-size:16px;padding:10px;margin-bottom:8px;}
.group{width:100%;box-sizing:border-box;border:1px solid #33404d;border-radius:6px;background:#101418;color:#f4f7fb;font-size:15px;padding:10px;margin-bottom:8px;}
.mac{font-family:Consolas,monospace;font-size:14px;color:#f4f7fb;}
.meta{font-size:13px;color:#9ca8b6;margin-top:4px;}
.actions{display:grid;gap:8px;}
.small{min-height:40px;font-size:14px;background:#66c7ff;}
 .save{background:#f6c95f;}
.found{background:#8bd39a;}
.version{position:fixed;top:10px;right:12px;color:#8f9baa;font-size:12px;background:#171d24;border:1px solid #2a3440;border-radius:6px;padding:4px 7px;}
</style>
</head>
<body>
<div class="version">UI v0.1.7</div>
<main>
<h1>&#39764;&#27861;&#36947;&#20855;&#25511;&#21046;&#21488;</h1>
<p>&#36830;&#25509;&#25511;&#21046;&#31471;&#28909;&#28857;&#21518;&#65292;&#21487;&#20197;&#25195;&#25551;&#25509;&#25910;&#31471;&#12289;&#28857;&#21517;&#35782;&#21035;&#27169;&#22359;&#65292;&#24182;&#21457;&#36865;&#22522;&#30784;&#25511;&#21046;&#21629;&#20196;&#12290;</p>
<div class="panel">
<button class="start" onclick="sendCmd('START')">&#21551;&#21160;</button>
<button class="stop" onclick="sendCmd('STOP')">&#20572;&#27490;</button>
<button class="id" onclick="sendCmd('IDENTIFY')">&#20840;&#37096;&#28857;&#21517;</button>
<button class="scan" onclick="scanDevices()">&#25195;&#25551;&#35774;&#22791;</button>
</div>
<div id="status"></div>
<div id="summary" class="summary"></div>
<h2>&#25509;&#25910;&#31471;&#21015;&#34920;</h2>
<div id="devices" class="list"></div>
</main>
<script>
const BASE='http://192.168.4.1';
const statusEl=document.getElementById('status');
const summaryEl=document.getElementById('summary');
function msg(html){statusEl.innerHTML=html;}
function fallbackGet(path){const img=new Image();img.src=BASE+path+(path.includes('?')?'&':'?')+'fallback='+Date.now();}
async function sendCmd(cmd){
  msg('&#27491;&#22312;&#21457;&#36865; '+cmd+' ...');
  try{const r=await fetch(BASE+'/cmd?name='+encodeURIComponent(cmd)+'&t='+Date.now(),{cache:'no-store'});msg(await r.text());setTimeout(loadDevices,500);}
  catch(e){fallbackGet('/cmd?name='+encodeURIComponent(cmd));msg('&#21457;&#36865;&#35831;&#27714;&#24050;&#29992;&#22791;&#29992;&#26041;&#24335;&#21457;&#20986;&#65292;&#22914;&#26080;&#25928;&#35831;&#30475;&#20018;&#21475;&#26085;&#24535;&#65306;'+e);}
}
async function scanDevices(){
  msg('&#27491;&#22312;&#25195;&#25551;&#25509;&#25910;&#31471;...');
  try{const r=await fetch(BASE+'/scan?t='+Date.now(),{cache:'no-store'});msg(await r.text());}
  catch(e){fallbackGet('/scan');msg('&#25195;&#25551;&#35831;&#27714;&#24050;&#29992;&#22791;&#29992;&#26041;&#24335;&#21457;&#20986;&#65292;&#35831;&#30475;&#20018;&#21475;&#26085;&#24535;&#65306;'+e);}
  setTimeout(loadDevices,1000);
}
async function identify(idx){
  msg('&#27491;&#22312;&#28857;&#21517; #'+idx+' ...');
  try{const r=await fetch(BASE+'/identify?idx='+encodeURIComponent(idx)+'&t='+Date.now(),{cache:'no-store'});msg(await r.text());setTimeout(loadDevices,700);}
  catch(e){fallbackGet('/identify?idx='+encodeURIComponent(idx));msg('&#28857;&#21517;&#35831;&#27714;&#24050;&#29992;&#22791;&#29992;&#26041;&#24335;&#21457;&#20986;&#65292;&#35831;&#30475;&#20018;&#21475;&#26085;&#24535;&#65306;'+e);}
}
async function renameDevice(idx,nameId,groupId){
  const name=document.getElementById(nameId).value;
  const group=document.getElementById(groupId).value;
  msg('&#27491;&#22312;&#20445;&#23384; #'+idx+' ...');
  try{const r=await fetch(BASE+'/rename?idx='+encodeURIComponent(idx)+'&name='+encodeURIComponent(name)+'&group='+encodeURIComponent(group)+'&t='+Date.now(),{cache:'no-store'});msg(await r.text());setTimeout(loadDevices,500);}
  catch(e){fallbackGet('/rename?idx='+encodeURIComponent(idx)+'&name='+encodeURIComponent(name)+'&group='+encodeURIComponent(group));msg('&#20445;&#23384;&#35831;&#27714;&#24050;&#29992;&#22791;&#29992;&#26041;&#24335;&#21457;&#20986;&#65292;&#35831;&#30475;&#20018;&#21475;&#26085;&#24535;&#65306;'+e);}
}
async function toggleFound(idx, value){
  const next = value ? 0 : 1;
  msg(next ? '&#27491;&#22312;&#26631;&#35760;&#20026;&#24050;&#25214;&#21040; #'+idx+' ...' : '&#27491;&#22312;&#28165;&#38500;&#24050;&#25214;&#21040; #'+idx+' ...');
  try{const r=await fetch(BASE+'/found?idx='+encodeURIComponent(idx)+'&value='+next+'&t='+Date.now(),{cache:'no-store'});msg(await r.text());setTimeout(loadDevices,500);}
  catch(e){fallbackGet('/found?idx='+encodeURIComponent(idx)+'&value='+next);msg('&#29366;&#24577;&#20462;&#25913;&#35831;&#27714;&#22833;&#36133;&#65306;'+e);}
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadDevices(){
  try{
    const r=await fetch(BASE+'/devices?t='+Date.now(),{cache:'no-store'});
    const data=await r.json();
    const root=document.getElementById('devices');
    if(!data.devices.length){root.innerHTML='<p>&#36824;&#27809;&#26377;&#21457;&#29616;&#25509;&#25910;&#31471;&#12290;&#35831;&#20808;&#28857;&#20987;&#8220;&#25195;&#25551;&#35774;&#22791;&#8221;&#12290;</p>';summaryEl.innerHTML='&#32479;&#35745;&#65306;0 &#21488;&#35774;&#22791;';return;}
    const foundCount = data.devices.filter(d=>Number(d.found||0) === 1).length;
    const groupACount = data.devices.filter(d=>Number(d.group||0) === 1).length;
    const groupBCount = data.devices.filter(d=>Number(d.group||0) === 2).length;
    summaryEl.innerHTML='&#32479;&#35745;&#65306;'+data.devices.length+' &#21488; &#65372; A&#32452; '+groupACount+' &#21488; &#65372; B&#32452; '+groupBCount+' &#21488; &#65372; &#24050;&#25214;&#21040; '+foundCount+' &#21488;';
    root.innerHTML=data.devices.map((d,i)=>{
      const nameId='name_'+i;
      const groupId='group_'+i;
      const g=Number(d.group||0);
      const found = Number(d.found||0) === 1;
      return '<div class="row"><div><input id="'+nameId+'" class="name" maxlength="31" value="'+esc(d.name)+'"><select id="'+groupId+'" class="group"><option value="0"'+(g===0?' selected':'')+'>&#26410;&#20998;&#32452;</option><option value="1"'+(g===1?' selected':'')+'>A&#32452;&#39764;&#26454;</option><option value="2"'+(g===2?' selected':'')+'>B&#32452;&#23453;&#31665;</option></select><div class="mac">'+esc(d.mac)+'</div><div class="meta">&#20449;&#21495; '+d.rssi+' dBm&#65292;&#26368;&#36817;&#21709;&#24212; '+d.seen_ms+' ms &#21069;&#65372;&#29366;&#24577; '+(found?'&#24050;&#25214;&#21040;':'&#26410;&#25214;&#21040;')+'</div></div><div class="actions"><button class="small" onclick="identify('+i+')">&#28857;&#21517;</button><button class="small save" onclick="renameDevice('+i+',\''+nameId+'\',\''+groupId+'\')">&#20445;&#23384;</button><button class="small found" onclick="toggleFound('+i+','+(found?1:0)+')">'+(found?'&#28165;&#38500;&#25214;&#21040;':'&#26631;&#35760;&#25214;&#21040;')+'</button></div></div>';
    }).join('');
  }catch(e){msg('&#35835;&#21462;&#35774;&#22791;&#21015;&#34920;&#22833;&#36133;&#65306;'+e);}
}
loadDevices();
</script>
</body>
</html>
)MAGICHTML";
static void mac_to_string(const uint8_t *mac, char *out, size_t out_size)
{
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

        output[out++] = input[in] == '+' ? ' ' : input[in];
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

    if (hex_count != 12) {
        return false;
    }

    for (int i = 0; i < 6; i++) {
        char byte_text[3] = { hex_only[i * 2], hex_only[i * 2 + 1], '\0' };
        unsigned int value = 0;
        if (sscanf(byte_text, "%02x", &value) != 1 || value > 0xFF) {
            return false;
        }
        mac[i] = (uint8_t)value;
    }
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

static void make_default_device_name(int index, char *out, size_t out_size)
{
    snprintf(out, out_size, "\xE7\xA2\x8E\xE7\x89\x87%d", index + 1);
}

static bool is_legacy_default_device_name(const char *name)
{
    if (strncmp(name, "Fragment ", 9) != 0) {
        return false;
    }

    for (int i = 9; name[i] != '\0'; i++) {
        if (name[i] < '0' || name[i] > '9') {
            return false;
        }
    }
    return name[9] != '\0';
}

static void json_escape(const char *input, char *output, size_t output_size)
{
    size_t out = 0;
    for (size_t in = 0; input[in] != '\0' && out < output_size - 1; in++) {
        if ((input[in] == '"' || input[in] == '\\') && out < output_size - 2) {
            output[out++] = '\\';
            output[out++] = input[in];
        } else if ((unsigned char)input[in] >= 0x20) {
            output[out++] = input[in];
        }
    }
    output[out] = '\0';
}

static void registry_save(void)
{
    receiver_device_t snapshot[MAX_DEVICES];
    uint8_t found_snapshot[MAX_DEVICES];
    int count = 0;

    portENTER_CRITICAL(&device_mux);
    count = device_count;
    memcpy(snapshot, devices, sizeof(receiver_device_t) * count);
    memcpy(found_snapshot, found_states, sizeof(uint8_t) * count);
    registry_dirty = false;
    portEXIT_CRITICAL(&device_mux);

    nvs_handle_t nvs = 0;
    esp_err_t ret = nvs_open("registry", NVS_READWRITE, &nvs);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "NVS open failed while saving registry: %s", esp_err_to_name(ret));
        return;
    }

    ret = nvs_set_i32(nvs, "count", count);
    if (ret == ESP_OK) {
        ret = nvs_set_blob(nvs, "devices", snapshot, sizeof(receiver_device_t) * count);
    }
    if (ret == ESP_OK) {
        ret = nvs_set_blob(nvs, "found", found_snapshot, sizeof(uint8_t) * count);
    }
    if (ret == ESP_OK) {
        ret = nvs_commit(nvs);
    }
    nvs_close(nvs);

    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "Device registry saved: %d device(s).", count);
    } else {
        ESP_LOGW(TAG, "Device registry save failed: %s", esp_err_to_name(ret));
    }
}

static void registry_load(void)
{
    receiver_device_t *loaded = registry_load_buffer;
    memset(registry_load_buffer, 0, sizeof(registry_load_buffer));
    memset(registry_load_v1_buffer, 0, sizeof(registry_load_v1_buffer));
    memset(found_states, 0, sizeof(found_states));
    int loaded_count = 0;
    bool needs_save = false;

    nvs_handle_t nvs = 0;
    esp_err_t ret = nvs_open("registry", NVS_READONLY, &nvs);
    if (ret != ESP_OK) {
        ESP_LOGI(TAG, "No saved device registry yet.");
        return;
    }

    int32_t saved_count = 0;
    size_t blob_size = 0;
    ret = nvs_get_i32(nvs, "count", &saved_count);
    if (ret == ESP_OK) {
        ret = nvs_get_blob(nvs, "devices", NULL, &blob_size);
    }

    bool compatible_new = ret == ESP_OK && saved_count > 0 && saved_count <= MAX_DEVICES &&
                          blob_size == sizeof(receiver_device_t) * (size_t)saved_count;
    bool compatible_old = ret == ESP_OK && saved_count > 0 && saved_count <= MAX_DEVICES &&
                          blob_size == sizeof(receiver_device_v1_t) * (size_t)saved_count;

    if (compatible_new) {
        size_t read_size = blob_size;
        ret = nvs_get_blob(nvs, "devices", loaded, &read_size);
        if (ret == ESP_OK) {
            loaded_count = saved_count;
        }
    } else if (compatible_old) {
        receiver_device_v1_t *old_devices = registry_load_v1_buffer;
        size_t read_size = blob_size;
        ret = nvs_get_blob(nvs, "devices", old_devices, &read_size);
        if (ret == ESP_OK) {
            loaded_count = saved_count;
            for (int i = 0; i < loaded_count; i++) {
                memcpy(loaded[i].mac, old_devices[i].mac, sizeof(loaded[i].mac));
                snprintf(loaded[i].name, sizeof(loaded[i].name), "%s", old_devices[i].name);
                loaded[i].group = DEVICE_GROUP_NONE;
                loaded[i].rssi = old_devices[i].rssi;
                loaded[i].last_seen_ms = old_devices[i].last_seen_ms;
            }
            needs_save = true;
        }
    }

    nvs_close(nvs);

    if (ret == ESP_OK && loaded_count > 0) {
        size_t found_size = 0;
        nvs_handle_t nvs_found = 0;
        if (nvs_open("registry", NVS_READONLY, &nvs_found) == ESP_OK) {
            if (nvs_get_blob(nvs_found, "found", NULL, &found_size) == ESP_OK &&
                found_size == sizeof(uint8_t) * (size_t)loaded_count) {
                size_t read_size = found_size;
                if (nvs_get_blob(nvs_found, "found", found_states, &read_size) != ESP_OK) {
                    memset(found_states, 0, sizeof(found_states));
                }
            }
            nvs_close(nvs_found);
        }

        int64_t now_ms = esp_timer_get_time() / 1000;
        for (int i = 0; i < loaded_count; i++) {
            loaded[i].rssi = 0;
            loaded[i].last_seen_ms = now_ms;
            if (loaded[i].group > DEVICE_GROUP_B) {
                loaded[i].group = DEVICE_GROUP_NONE;
                needs_save = true;
            }
            if (loaded[i].name[0] == '\0' || is_legacy_default_device_name(loaded[i].name)) {
                make_default_device_name(i, loaded[i].name, sizeof(loaded[i].name));
                needs_save = true;
            }
        }

        portENTER_CRITICAL(&device_mux);
        device_count = loaded_count;
        memcpy(devices, loaded, sizeof(receiver_device_t) * loaded_count);
        if (needs_save) {
            registry_dirty = true;
        }
        portEXIT_CRITICAL(&device_mux);

        ESP_LOGI(TAG, "Device registry loaded: %d device(s).", loaded_count);
    } else {
        ESP_LOGI(TAG, "Saved device registry is empty or incompatible.");
    }
}

static void ensure_peer_exists(const uint8_t *mac)
{
    if (mac == NULL || esp_now_is_peer_exist(mac)) {
        return;
    }

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

static void remember_device(const uint8_t *mac, int rssi)
{
    int64_t now_ms = esp_timer_get_time() / 1000;

    portENTER_CRITICAL(&device_mux);
    for (int i = 0; i < device_count; i++) {
        if (memcmp(devices[i].mac, mac, 6) == 0) {
            devices[i].rssi = rssi;
            devices[i].last_seen_ms = now_ms;
            portEXIT_CRITICAL(&device_mux);
            return;
        }
    }

    if (device_count < MAX_DEVICES) {
        memcpy(devices[device_count].mac, mac, 6);
        make_default_device_name(device_count, devices[device_count].name, sizeof(devices[device_count].name));
        devices[device_count].group = DEVICE_GROUP_NONE;
        devices[device_count].reserved[0] = 0;
        devices[device_count].reserved[1] = 0;
        devices[device_count].reserved[2] = 0;
        devices[device_count].rssi = rssi;
        devices[device_count].last_seen_ms = now_ms;
        found_states[device_count] = 0;
        device_count++;
        registry_dirty = true;
    }
    portEXIT_CRITICAL(&device_mux);
}

static bool update_device_settings(const uint8_t *mac, const char *name, uint8_t group)
{
    bool updated = false;
    if (group > DEVICE_GROUP_B) {
        group = DEVICE_GROUP_NONE;
    }

    portENTER_CRITICAL(&device_mux);
    for (int i = 0; i < device_count; i++) {
        if (memcmp(devices[i].mac, mac, 6) == 0) {
            if (name[0] == '\0') {
                make_default_device_name(i, devices[i].name, sizeof(devices[i].name));
            } else {
                snprintf(devices[i].name, sizeof(devices[i].name), "%s", name);
            }
            devices[i].group = group;
            registry_dirty = true;
            updated = true;
            break;
        }
    }
    portEXIT_CRITICAL(&device_mux);

    return updated;
}

static bool update_device_settings_by_index(int index, const char *name, uint8_t group)
{
    bool updated = false;
    if (group > DEVICE_GROUP_B) {
        group = DEVICE_GROUP_NONE;
    }

    portENTER_CRITICAL(&device_mux);
    if (index >= 0 && index < device_count) {
        if (name[0] == '\0') {
            make_default_device_name(index, devices[index].name, sizeof(devices[index].name));
        } else {
            snprintf(devices[index].name, sizeof(devices[index].name), "%s", name);
        }
        devices[index].group = group;
        registry_dirty = true;
        updated = true;
    }
    portEXIT_CRITICAL(&device_mux);

    return updated;
}

static bool update_found_state_by_index(int index, bool found)
{
    bool updated = false;

    portENTER_CRITICAL(&device_mux);
    if (index >= 0 && index < device_count) {
        found_states[index] = found ? 1 : 0;
        registry_dirty = true;
        updated = true;
    }
    portEXIT_CRITICAL(&device_mux);

    return updated;
}

static void espnow_recv_cb(const esp_now_recv_info_t *recv_info, const uint8_t *data, int data_len)
{
    if (recv_info == NULL || recv_info->src_addr == NULL || data == NULL || data_len <= 0) {
        return;
    }

    char msg[64];
    int copy_len = data_len;
    if (copy_len >= (int)sizeof(msg)) {
        copy_len = sizeof(msg) - 1;
    }
    memcpy(msg, data, copy_len);
    msg[copy_len] = '\0';

    if (strncmp(msg, "PRESENT", 7) == 0) {
        int rssi = 0;
        if (recv_info->rx_ctrl) {
            rssi = recv_info->rx_ctrl->rssi;
        }

        ensure_peer_exists(recv_info->src_addr);
        remember_device(recv_info->src_addr, rssi);

        char mac_text[18];
        mac_to_string(recv_info->src_addr, mac_text, sizeof(mac_text));
        ESP_LOGI(TAG, "Receiver present: %s, RSSI=%d", mac_text, rssi);
    }
}

static esp_err_t send_espnow_command_to(const uint8_t *mac, const char *cmd)
{
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

static esp_err_t root_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET / -> UI %s", WEB_UI_VERSION);
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, INDEX_HTML, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t command_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /cmd");
    char query[64] = {0};
    char name[24] = {0};

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK ||
        httpd_query_key_value(query, "name", name, sizeof(name)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Missing command.");
    }

    if (strcmp(name, "START") != 0 &&
        strcmp(name, "STOP") != 0 &&
        strcmp(name, "IDENTIFY") != 0 &&
        strcmp(name, "DISCOVER") != 0) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Unknown command.");
    }

    esp_err_t ret = send_espnow_broadcast(name);
    if (ret != ESP_OK) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "ESP-NOW send failed.");
    }

    char reply[48];
    if (strcmp(name, "DISCOVER") == 0) {
        snprintf(reply, sizeof(reply), "Scan sent. Receivers will appear below.");
    } else {
        snprintf(reply, sizeof(reply), "Sent %s to all receivers.", name);
    }
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, reply);
}

static esp_err_t scan_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /scan");
    esp_err_t ret = send_espnow_broadcast("DISCOVER");
    if (ret != ESP_OK) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "Scan failed.");
    }

    httpd_resp_set_type(req, "text/plain; charset=utf-8");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, "Scan sent. Please wait and refresh the list.");
}

// Replace the whole devices_handler with this version
static esp_err_t devices_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /devices");

    const size_t JSON_BUF_SIZE = 4096;
    char *json = (char *)malloc(JSON_BUF_SIZE);
    if (json == NULL) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "Out of memory.");
    }

    int offset = snprintf(json, JSON_BUF_SIZE, "{\"devices\":[");
    int64_t now_ms = esp_timer_get_time() / 1000;

    portENTER_CRITICAL(&device_mux);
    for (int i = 0; i < device_count && offset > 0 && offset < (int)JSON_BUF_SIZE; i++) {
        char mac_text[18];
        char escaped_name[DEVICE_NAME_LEN * 2];
        mac_to_string(devices[i].mac, mac_text, sizeof(mac_text));
        json_escape(devices[i].name, escaped_name, sizeof(escaped_name));

        int written = snprintf(
            json + offset, JSON_BUF_SIZE - offset,
            "%s{\"mac\":\"%s\",\"name\":\"%s\",\"group\":%u,\"rssi\":%d,\"seen_ms\":%lld,\"found\":%u}",
            i == 0 ? "" : ",",
            mac_text,
            escaped_name,
            (unsigned int)devices[i].group,
            devices[i].rssi,
            (long long)(now_ms - devices[i].last_seen_ms),
            (unsigned int)(found_states[i] ? 1 : 0)
        );

        if (written < 0 || written >= (int)(JSON_BUF_SIZE - offset)) {
            offset = JSON_BUF_SIZE - 3; // leave room for "]}" and '\0'
            break;
        }
        offset += written;
    }
    portEXIT_CRITICAL(&device_mux);

    if (offset < 0) {
        free(json);
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "JSON build failed.");
    }

    if (offset > (int)JSON_BUF_SIZE - 3) {
        offset = JSON_BUF_SIZE - 3;
    }
    json[offset++] = ']';
    json[offset++] = '}';
    json[offset] = '\0';

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

    esp_err_t send_ret = httpd_resp_sendstr(req, json);
    free(json);
    return send_ret;
}

static esp_err_t identify_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /identify");
    char query[256] = {0};
    char mac_text[64] = {0};
    uint8_t mac[6] = {0};
    int index = -1;
    bool have_target = false;

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Invalid MAC.");
    }

    if (get_device_index_from_query(query, &index)) {
        portENTER_CRITICAL(&device_mux);
        if (index >= 0 && index < device_count) {
            memcpy(mac, devices[index].mac, sizeof(mac));
            have_target = true;
        }
        portEXIT_CRITICAL(&device_mux);
    }

    if (!have_target &&
        httpd_query_key_value(query, "mac", mac_text, sizeof(mac_text)) == ESP_OK &&
        parse_mac_string(mac_text, mac)) {
        have_target = true;
    }

    if (!have_target) {
        ESP_LOGW(TAG, "Invalid identify request: query=%s", query);
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

static esp_err_t rename_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /rename");
    char query[512] = {0};
    char mac_text[64] = {0};
    char encoded_name[256] = {0};
    char group_text[16] = {0};
    char name[DEVICE_NAME_LEN] = {0};
    uint8_t mac[6] = {0};
    uint8_t group = DEVICE_GROUP_NONE;
    int index = -1;
    bool have_index = false;

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
                return httpd_resp_sendstr(req, "Invalid rename request.");
    }

    have_index = get_device_index_from_query(query, &index);
    if (httpd_query_key_value(query, "name", encoded_name, sizeof(encoded_name)) == ESP_OK) {
        url_decode_component(encoded_name, name, sizeof(name));
    } else {
        name[0] = '\0';
    }

    if (httpd_query_key_value(query, "group", group_text, sizeof(group_text)) == ESP_OK) {
        int parsed_group = atoi(group_text);
        if (parsed_group >= DEVICE_GROUP_NONE && parsed_group <= DEVICE_GROUP_B) {
            group = (uint8_t)parsed_group;
        }
    }

    if (have_index) {
        if (!update_device_settings_by_index(index, name, group)) {
            httpd_resp_set_status(req, "404 Not Found");
            return httpd_resp_sendstr(req, "Receiver not found.");
        }
    } else {
        if (httpd_query_key_value(query, "mac", mac_text, sizeof(mac_text)) != ESP_OK ||
            !parse_mac_string(mac_text, mac) ||
            !update_device_settings(mac, name, group)) {
            ESP_LOGW(TAG, "Invalid rename request: query=%s", query);
            httpd_resp_set_status(req, "400 Bad Request");
                    return httpd_resp_sendstr(req, "Invalid rename request.");
        }
    }

    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, "Settings saved.");
}

static esp_err_t found_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "HTTP GET /found");
    char query[128] = {0};
    int index = -1;
    char value_text[8] = {0};
    bool found = true;

    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK ||
        !get_device_index_from_query(query, &index)) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Invalid found request.");
    }

    if (httpd_query_key_value(query, "value", value_text, sizeof(value_text)) == ESP_OK) {
        found = atoi(value_text) != 0;
    }

    if (!update_found_state_by_index(index, found)) {
        httpd_resp_set_status(req, "404 Not Found");
        return httpd_resp_sendstr(req, "Receiver not found.");
    }

    httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    httpd_resp_set_hdr(req, "Pragma", "no-cache");
    httpd_resp_set_hdr(req, "Expires", "0");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, found ? "Marked as found." : "Cleared found state.");
}

static void register_get_uri(httpd_handle_t server, const char *uri, esp_err_t (*handler)(httpd_req_t *req))
{
    httpd_uri_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.uri = uri;
    cfg.method = HTTP_GET;
    cfg.handler = handler;
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &cfg));
}

static void start_web_server(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.stack_size = 8192;
    config.lru_purge_enable = true;
    httpd_handle_t server = NULL;

    ESP_ERROR_CHECK(httpd_start(&server, &config));
    register_get_uri(server, "/", root_handler);
    register_get_uri(server, "/cmd", command_handler);
    register_get_uri(server, "/scan", scan_handler);
    register_get_uri(server, "/devices", devices_handler);
    register_get_uri(server, "/identify", identify_handler);
    register_get_uri(server, "/rename", rename_handler);
    register_get_uri(server, "/found", found_handler);

    ESP_LOGI(TAG, "Web server ready: connect SSID '%s' (open), open http://192.168.4.1, UI %s", WIFI_AP_SSID, WEB_UI_VERSION);
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    if (event_base != WIFI_EVENT) {
        return;
    }

    if (event_id == WIFI_EVENT_AP_STACONNECTED) {
        wifi_event_ap_staconnected_t *event = (wifi_event_ap_staconnected_t *)event_data;
        ESP_LOGI(TAG, "Phone connected: %02X:%02X:%02X:%02X:%02X:%02X, AID=%d", event->mac[0], event->mac[1], event->mac[2], event->mac[3], event->mac[4], event->mac[5], event->aid);
    } else if (event_id == WIFI_EVENT_AP_STADISCONNECTED) {
        wifi_event_ap_stadisconnected_t *event = (wifi_event_ap_stadisconnected_t *)event_data;
        ESP_LOGW(TAG, "Phone disconnected: %02X:%02X:%02X:%02X:%02X:%02X, AID=%d", event->mac[0], event->mac[1], event->mac[2], event->mac[3], event->mac[4], event->mac[5], event->aid);
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
    esp_netif_create_default_wifi_sta();

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
    xTaskCreate(registry_task, "registry", 4096, NULL, 4, NULL);
    xTaskCreate(button_task, "button", 4096, NULL, 5, NULL);
}
