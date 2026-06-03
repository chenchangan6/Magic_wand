# Shared Firmware Contracts

This directory documents the compact runtime protocol shared by the local
configuration page, controller firmware, and receiver firmware.

The PC-side `lan_config` page keeps the full editable JSON. ESP32-C6 firmware
only receives the active-room runtime subset.

## HTTP: Local Page To Controller

`POST /config/import` accepts the existing JSON plus runtime fields embedded in
each active group:

- `effect`: idle effect spec for this group.
- `trigger_effect`: effect spec to run after a local proximity trigger.
- `peer_mask`: bitmask of groups this group should react to.
- `room_hash`: compact active-room identifier.
- `rssi`: RSSI threshold for trigger detection.
- `hold`: milliseconds that the RSSI condition must hold.

The controller still preserves the existing `devices`, `groups`, and `records`
shape for compatibility.

## ESP-NOW: Controller To Receiver

- `CFG|room|group_mask|peer_mask|rssi|hold|idle_spec`
- `TRG|trigger_spec`
- `START`
- `STOP`
- `IDENTIFY`
- `DISCOVER`

`idle_spec` and `trigger_spec` use the short effect strings already understood
by the receiver, such as `silent`, `solid2|...`, `breath2|...`, or `pulse2|...`.

## ESP-NOW: Receiver To Receiver/Controller

- `BEACON|room|group_mask|seq`
- `EVENT|room|self_group_mask|peer_group_mask|rssi`
- `PRESENT,<mac>`

Receivers make the v1 proximity decision locally by comparing incoming beacon
RSSI against their configured `rssi` and `hold` values.
