# Fast desktop display

Replace noVNC Tight/JPEG rectangles with H.264, **without changing who is allowed to see or drive a computer**.

The protocol (WebSocket vs WebRTC) is how pixels move on the **browser ↔ API** hop. The architecture is: **the guest never faces a browser**. That is the security design. Ingress (homelab reverse proxy vs a real domain) does not change it.

This is not Record & Replay, not tape screenshots, and not RDP.

**Do not implement from an earlier short plan.** This file is the spec.

---

## 1. Diagnosis

The computer window is an iframe:

```
apps/web/src/ui/wm/Window.tsx
  src={`/desktops/${id}/?v=rfb`}
```

Guest: Xtigervnc → websockify `:6901` → noVNC Tight JPEG tiles in JS. Every visible computer keeps that socket open. That is the latency.

The **proxy shape is already the right trust boundary.** The codec and a few missing checks are not.

Not the cause: tape PNGs, `grabShotBounded`.

---

## 2. Trust model (this is the architecture)

Three principals:

| Principal | Trust | Role |
|---|---|---|
| **Guest** | Untrusted. Runs operator/agent Chromium, attacker-controlled pages, stolen cookies. | Encode `:1` and inject XTEST. Must not speak to the internet as a media server. Must not hold WAN credentials (TURN secrets, session cookies). |
| **Browser** | Untrusted. XSS on the origin = full desktop. Other origins must not be able to subscribe. | Render pixels, send HID. Must never receive `MACHINE_TOKEN`. |
| **API** | Trusted media plane. | Authenticate the viewer, authorize computer `id`, inject guest credentials, copy bytes (or terminate WebRTC). Only process that may reach `:6902` / `:6901` / `:8080`. |

A live desktop is as sensitive as VNC root: passwords, mail, cookies on screen, plus HID (keyboard) and clipboard. Treat **view and control as one capability**.

```
browser  ── TLS (WSS) ──►  API  ── 127.0.0.1 + MACHINE_TOKEN ──►  guest encoder
              ▲                         │
              │                         └── HID (XTEST) on the same authorized socket
              └── later: DTLS/SRTP to the API (Pion), still this diagram
```

**Rejected (looks like “real WebRTC”, wrong boundary):**

- Guest as WebRTC peer + host TURN. Media bypasses the API after SDP. TURN secret lands in every container. A compromised desktop is a TURN client. A copied signaling session can keep watching after you “closed” the window. Selkies share-links (`#shared`) are a second viewer with no operator UI.
- Per-container public UDP.
- Browser talking to `172.17.x.x` or a published guest port.
- Static `kasm_user:password` as the stream password (today’s VNC path). Fine as a leftover for `?v=rfb`; not for the product stream.

RDP is rejected on product grounds (bitmaps, PAM), not only security.

---

## 3. What “secure streaming” actually requires

### 3.1 Confidentiality

- **Browser ↔ API:** TLS. Today that is whatever terminates HTTPS in front of nginx. The stream is WSS on that origin. Do not offer a plaintext `:80` API (already 404).
- **API ↔ guest:** loopback. Docker publish `127.0.0.1:0:6902` only. Encrypted overlay is optional; the host is the trust root.
- **Later WebRTC:** terminate **on the API** (Pion), DTLS-SRTP to the browser. Guest stays localhost H.264. Same authorization. Do not put aiortc in the guest.

### 3.2 Authorization (who may subscribe)

Today `/desktops/:id/` is a **capability URL with no secret**. Knowing `brisk-harbor` is enough to view and type. Computer names come from a small adjective×noun set.

This work does not invent OIDC, but it must not make that worse, and it must leave a place for a session:

1. **Origin on desktop HTTP and WS.** `/api/ws` already checks `ALLOWED_ORIGINS`. `/desktops/:id` **upgrades do not**. Any page the browser can open can attach to the framebuffer + HID. **Close that.** Same `originAllowed()` as `/api/ws`. Missing Origin: allow (curl, non-browser) or deny in production via env — match `/api/ws` (allow missing).
2. **`frame-ancestors 'self'`** on everything under `/desktops/`. Today the proxy **strips** CSP/XFO so the SPA can iframe; that also lets `evil.example` iframe `https://our-origin/desktops/foo/` and steal the stream. Set `Content-Security-Policy: frame-ancestors 'self'` on API-served HTML **and** on proxied Selkies/noVNC responses. Do not strip it.
3. **Do not put `MACHINE_TOKEN` in the iframe URL, localStorage, or JS.** API injects Basic toward the guest only.
4. **One viewer.** `--enable-sharing=false`. No `#shared` / player links. Second connection: last-writer or refuse — pick **refuse extra HID** if Selkies allows; otherwise document that two operator tabs fight (same as VNC AlwaysShared today) and keep sharing off.
5. **Stop encode when the authorized iframe detaches** (§11). A background computer must not keep pushing frames to a socket that should not exist.
6. **When a session exists (public domain gate):** `GET/upgrade /desktops/:id` requires the same cookie as `/api`. Optional: short-lived `stream_ticket` (HMAC of `computerId + exp + sid`) as a query param the iframe presents once; API consumes it on upgrade. Not in v1 if still unauthenticated, but do not design a URL that cannot grow a ticket.

### 3.3 Isolation (computers vs computers)

- Sibling containers share a Docker bridge. `:6902` / `:8080` / `:6901` are reachable as `webmcp-<id>:<port>`.
- Stream password = **per-spawn `MACHINE_TOKEN`**, not the static VNC password.
- Bridge already uses that token as Bearer. Same secret for Selkies Basic.
- Do not pass TURN secrets, cloud keys, or `ALLOWED_ORIGINS` into the guest.

### 3.4 Integrity of HID and clipboard

- Live pointer/keyboard stay on the **authorized stream socket**, not `POST /api/act` (too slow, and would split view vs control).
- `--command-enabled=false` (Selkies must not run shell from the WS).
- `--file-transfers=none` (do not expose `~/Desktop` beside our own file tools).
- Clipboard on for the operator (`--enable-clipboard=true`) because the SPA is HTTPS/same-origin. That is clipboard sync with whoever can load the iframe — acceptable only while §3.2 holds. Disable if we ever add an anonymous viewer.

### 3.5 Guest breakout

Unchanged: no `SYS_ADMIN`, `no-new-privileges`, no in-guest media server on a public port. Chromium in the guest can still hit the WAN (that is the desktop). It must not be able to **publish** the framebuffer except to localhost Selkies.

---

## 4. Product path (same boundary, better codec)

```
browser iframe /desktops/:id/
  ├─ product:  / and /api/websockets  →  API (Origin + frame-ancestors)  →  Selkies :6902
  │                                      inject Basic selkies:${MACHINE_TOKEN}
  │                                      Selkies: pixelflux H.264 + XTEST, --mode=websockets
  └─ debug:    ?v=rfb, /websockify    →  API  →  websockify :6901  →  Xtigervnc
```

- Geometry 1280×800, CSS-scale. `--enable-resize=false`.
- Do not fork `selkies-ws-core.js`.
- **Guest `--mode=websockets` only. `--enable-dual-mode=false`.** No in-guest WebRTC.

**Later (not this implementation):** Pion (or similar) **in the API process**. Browser WebRTC ↔ API; API still pulls H.264 from localhost Selkies. TURN, if any, is the API’s, not the guest’s. Same §2 diagram.

Plan B if Selkies 2.x cannot install: ffmpeg in the **bridge**, still only reachable via API + `MACHINE_TOKEN`.

---

## 5. Public domain

The control plane is unauthenticated. A public A record without a session in front of `/api` **and** `/desktops` is an incident.

Release gate for a real hostname (separate track):

- TLS on 443.
- Identity in front of `/api` and `/desktops` (cookie/OIDC).
- `ALLOWED_ORIGINS` includes that origin.
- Then §3.2 item 6 (ticket) becomes natural.

Display work must already enforce Origin + `frame-ancestors` so the gate has something to hang on.

---

## 6. Artifact pin

Need Selkies **2.x** (`--mode=websockets`, pixelflux). GitHub `releases/latest` is **v1.6.2** GStreamer — forbidden.

Spike: `selkies --help` has `--mode`, version is 2.x. Pin `.deb` / ghcr digest / `pip install --only-binary=pixelflux`. Hard-fail the image on 1.6.x.

---

## 7. Guest image

### 7.1 Dockerfile

Pin 2.x. `EXPOSE 6901 6902 8080`. No Pulse, no GStreamer desktop.

### 7.2 entrypoint.sh

Forward `MACHINE_TOKEN` explicitly into `session.sh`. Do **not** forward TURN secrets (none should exist in the guest).

### 7.3 session.sh

Start Selkies after X + Openbox/tint2/pcmanfm. Background. Parent remains `VNC_PID`. Log `/tmp/selkies.log`.

```
selkies \
  --addr=0.0.0.0 \
  --port=6902 \
  --mode=websockets \
  --enable-dual-mode=false \
  --enable-https=false \
  --enable-basic-auth=true \
  --basic-auth-user=selkies \
  --basic-auth-password="$MACHINE_TOKEN" \
  --encoder=h264enc \
  --use-cpu=true \
  --enable-resize=false \
  --manual-width=1280 \
  --manual-height=800 \
  --framerate=24-24 \
  --video-bitrate=2500-2500 \
  --audio-enabled=false \
  --microphone-enabled=false \
  --webcam-enabled=false \
  --gamepad-enabled=false \
  --file-transfers=none \
  --enable-sharing=false \
  --command-enabled=false \
  --enable-clipboard=true \
  --ui-show-sidebar=false \
  --ui-show-core-buttons=false
```

No `--subfolder`. No `selkies-resize`. Audio off (no Pulse). 24 fps / 2500 kbps until measured. `--use-cpu=true` until a GPU device is actually passed in.

### 7.4 shm

`COMPUTER_SHM` → **256m**.

### 7.5 Rebuild

Rebuild `webmcp-slim:local`. Destroy and respawn. Reconcile without `6902/tcp` must not crash.

---

## 8. Host / control plane

### 8.1 host.ts

```
streamUrl(id): string | undefined
streamAuth(id): string | undefined  // Basic selkies:${MACHINE_TOKEN}
```

Never serialize the token to the browser.

### 8.2 docker-host.ts

- `-p 127.0.0.1:0:6902` only. **No guest UDP. No TURN env in `docker run`.**
- Reconcile 6902; missing → `streamUrl` undefined.
- Recover `MACHINE_TOKEN` from inspect as today.

### 8.3 MemoryHost / Plane

Stubs / passthrough.

### 8.4 waitHealthy

After bridge `/health`, `GET /api/health` on `:6902` with `streamAuth`. Fail spawn if Selkies is down ~20s.

### 8.5 Desktop proxy hardening ([`apps/api/src/index.ts`](../apps/api/src/index.ts))

On **HTTP and upgrade** for `/desktops/:id`:

1. `originAllowed(Origin)` — same helper as `/api/ws`. Destroy the socket on failure.
2. Classifier (§9).
3. Inject `streamAuth` for Selkies, `VNC_AUTH` only for noVNC leftovers.
4. **Set** (do not strip) `Content-Security-Policy: frame-ancestors 'self'`. Strip COEP/COOP/XFO if they block the SPA iframe; CSP frame-ancestors replaces XFO.
5. `permissions-policy`: `unload=*, tools=(self), clipboard-read=(self), clipboard-write=(self)`.
6. `Cache-Control: private, no-store` on HTML and the WS is already not cached.

---

## 9. API routing

[`apps/api/src/desktop-route.ts`](../apps/api/src/desktop-route.ts) — unit-test every row.

| `rest` | Class | Upstream |
|---|---|---|
| `/?v=rfb`, `/vnc.html` | `html-rfb` | `vncViewerHtml()` |
| `/`, `/index.html` | `html-stream` if `streamUrl` else `html-rfb` | Selkies `/` |
| `/websockify`, `/core/*` | `novnc` | `vncUrl` |
| `/package.json` | stub | existing |
| `/api/websockets`, `/api/*` | `selkies` | `streamUrl` |
| other static | `selkies` | `streamUrl` |

HTTP and upgrade both classify. Today all WS go to `vncUrl`.

No `SELKIES_SUBFOLDER`. `req.url = rest`.

---

## 10. Record overlay

Same `recording.ts` contract. `vncViewerHtml` keeps its hook. Selkies path: `contentDocument` fallback, `videoWidth`/`videoHeight`, observe-only. Recording keeps the iframe mounted.

---

## 11. Iframe lifecycle (performance and privacy)

Do not keep a live socket to a computer the operator is not looking at. That is bandwidth **and** a smaller leaked-frame window.

```
shouldAttachIframe(id):
  running && not minimized && not minimizing|closing
  && (recordingComputerId === id || overview || selected || acting)
```

Detach → `about:blank` (encoder idles). Debounce unattach 400ms. `allow="unload; tools; autoplay; clipboard-read; clipboard-write"`.

---

## 12. Out of scope

- OIDC/session implementation (gate in §5).
- Pion in the API (same architecture, later transport).
- coturn / in-guest WebRTC.
- Claude’s `vncViewerHtml` record script.
- Machine ops, approval, tape.

---

## 13. Risks

| Risk | Handling |
|---|---|
| Foreign origin attaches WS to `/desktops` | Origin check on upgrade (bug today) |
| Foreign origin iframes `/desktops` | `frame-ancestors 'self'` |
| Token in the browser | API injects Basic only |
| Sibling `:6902` | per-spawn `MACHINE_TOKEN` |
| Guest becomes a media server | websockets-only, loopback publish, no TURN in guest |
| Extra Selkies viewers | `--enable-sharing=false` |
| WS runs a shell | `--command-enabled=false` |
| Public DNS, no login | §5 gate; Origin/CSP still land now |
| Install 1.6.2 | §6 hard-fail |
| 1.5 CPU | 24 fps / 2500 kbps |
| No Pulse | `--audio-enabled=false` |

---

## 14. Files

| File | Change |
|---|---|
| `infra/slim/Dockerfile` | Pin Selkies 2.x; `EXPOSE 6902` |
| `infra/slim/entrypoint.sh` | Forward `MACHINE_TOKEN` only |
| `infra/slim/session.sh` | Selkies flags in §7.3 |
| `packages/contract/src/names.ts` | `COMPUTER_SHM = "256m"` |
| `apps/api/src/host.ts` | `streamUrl`, `streamAuth` |
| `apps/api/src/docker-host.ts` | 6902, tokens, waitHealthy; no TURN env |
| `apps/api/src/memory-host.ts` | stubs |
| `apps/api/src/plane.ts` | passthrough |
| `apps/api/src/desktop-route.ts` | **new** |
| `apps/api/src/desktop-route.test.ts` | **new** |
| `apps/api/src/index.ts` | Classifier, Origin on `/desktops`, `frame-ancestors`, per-id Basic |
| `apps/web/src/ui/wm/Window.tsx` | attach policy |
| `apps/web/src/ui/wm/recording.ts` | contentDocument fallback |
| `apps/web/src/store/snapshot.ts` | comment |
| `deploy/README.md` | Trust boundary, loopback-only guests, rebuild |

No `coturn.conf` in this work.

---

## 15. Tests and verify

- `desktop-route.test.ts` for §9.
- Origin denied → desktop WS destroyed (unit or a small integration around the helper).
- Proxied HTML includes `frame-ancestors 'self'`.
- Existing tests green.

Manual:

1. 2.x binary in the image.
2. Respawn computers.
3. One WSS to `/desktops/<id>/api/websockets`, H.264, not JPEG tiles. HID works.
4. Background computer: no socket.
5. From another origin (or `Origin: https://evil.example` on the upgrade): connection fails.
6. `<iframe src="https://<app>/desktops/<id>/">` from a data URL / other origin does not show the desktop.
7. Token not in iframe HTML or query string.
8. Sibling without token → 401 on `:6902`.
9. Agent type/click still works. Record coords still guest pixels.
10. `?v=rfb` still works.

---

## 16. Plan B

ffmpeg on the bridge `:8080`, still API-proxied, still `MACHINE_TOKEN`. No guest WebRTC.

---

## 17. Sequence

1. §6 pin 2.x.
2. §11 attach policy (helps current noVNC immediately).
3. Image + Selkies flags + token + shm.
4. `streamUrl` / `streamAuth` / waitHealthy.
5. Classifier + Origin + `frame-ancestors` + dual proxy.
6. Window default `/desktops/:id/` + record fallback.
7. Rebuild, respawn, §15.

Pion-on-API is a later PR on this boundary, not a fork of it.
