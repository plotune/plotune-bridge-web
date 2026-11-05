# BR-WEB-006 rev 2 — real-device local WebSocket evidence

- **Requirement IDs:** BR-WEB-006 rev 2, BWEB-002 rev 1, BR-WEB-001 rev 2 (local half)
- **Level:** L3 integration (real device)
- **UTC:** 2026-11-05T10:48:22.092Z
- **Verdict:** PASS
- **Page (declared permitted origin):** http://127.0.0.1:4173
- **Real device:** ws://192.168.1.10:9100
- **Identity:** `plotune-bridge-can-7c0c5f578a74` · firmware `plotune-bridge-can-fw-0.1.0` · contract `0.1.0` · can_fd=`false`
- **Capabilities:** supported bit rates [125000,250000,500000,1000000]; channels [{"channel":1,"name":"CAN1","bitrate":500000,"streaming":false}]
- **Chromium:** 141.0.7390.37
- **CDP Browser.grantPermissions(localNetworkAccess):** granted
- **Cloud blocked after load:** https://api.plotune.net, https://stream.plotune.net, https://www.plotune.net, https://plotune.net
- **Screenshot:** docs/evidence/br-web-006-real-device.png

## Steps

- **hello over ws://** — device_id=plotune-bridge-can-7c0c5f578a74, contract=0.1.0, can_fd=false, bitrates=[125000,250000,500000,1000000]
- **serve dist** — http://127.0.0.1:4173/ (production build, relative asset base)
- **headless Chromium** — 141.0.7390.37
- **CDP Browser.grantPermissions(localNetworkAccess)** — granted
- **Cloud blocked after load** — https://api.plotune.net, https://stream.plotune.net, https://www.plotune.net, https://plotune.net
- **local connect** — device-chip reports Connected
- **local acquisition/control** — CAN1 bit rate = 500000; Start capture -> Stop capture visible
- **local workspace persisted with Cloud blocked** — bw.workspace=true, bw.projects=true
- **verdict** — PASS

## Raw hello

```json
{
  "type": "response",
  "id": 1,
  "ok": true,
  "result": {
    "contract_version": "0.1.0",
    "session_id": "plotune-bridge-can-7c0c5f578a74-s6",
    "device_id": "plotune-bridge-can-7c0c5f578a74",
    "firmware": "plotune-bridge-can-fw-0.1.0",
    "profile": "prototype1",
    "can_fd": false,
    "supported_bitrates": [
      125000,
      250000,
      500000,
      1000000
    ],
    "rx_queue_capacity": 256,
    "clock": {
      "monotonic_ns": 2959586668000,
      "wall_clock_ns": null,
      "wall_clock_synced": false
    },
    "channels": [
      {
        "channel": 1,
        "name": "CAN1",
        "bitrate": 500000,
        "termination": false,
        "bus_state": "error_active",
        "streaming": false,
        "rx_queue_depth": 0,
        "rx_queue_capacity": 256,
        "rx_overloaded": false,
        "rx_high_water": false
      }
    ],
    "limits": {
      "tx_queue_depth": 32,
      "rx_overload_depth": 192,
      "net_tx_high_water_bytes": 24576,
      "net_tx_stall_ms": 250,
      "remote_backlog_bytes": 8192,
      "remote_backlog_ms": 500,
      "peer_min_internal_bytes": 147456,
      "heap_floor_bytes": 40960,
      "stack_used_pct_max": 75
    }
  }
}
```

## Limitations

- No CAN bus is attached to the device; capture is armed but no bus traffic is generated.
- A plain `ws://` non-loopback endpoint is refused by the hosted HTTPS origin as mixed content, so this evidence uses the declared local preview origin `http://127.0.0.1:4173`.
- Remote WebRTC / Cloud connection (BR-WEB-001 remote half, BWEB-001/003) is not verified here.
- The native local-network permission prompt cannot be shown in automation; `localNetworkAccess` is granted through CDP.
