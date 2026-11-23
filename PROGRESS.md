# PROGRESS — OSF Agri Drone Training Simulator

Context file for every session. Read this first, then `PLAN.md`.
Update the checklist and the log at the end of every work block.

## Decisions (defaults until owner says otherwise)
- Stick mode: **Mode 2** (configurable per controller profile).
- Flight controller behaviour: **ArduPilot-style** for Indian agri drones, DJI profile for DJI drones.
- Units: metric.
- "AG365XP" spec sheet not available → **AG365H** public figures + estimates used as placeholder (`public/drones/marut_ag365h.json`).

## Architecture (quick map)
- `scripts/gen-layout.mjs` — single source of truth for the shared memory layout (params / inputs / outputs). Generates `assembly/layout.ts` and `src/sim/layout.ts`. **Never edit the generated files by hand.**
- `assembly/index.ts` — physics + wind + sensors + flight controller (AssemblyScript → `public/sim.wasm`). Fixed step 400 Hz.
- `src/sim/` — WASM loader, engine loop (fixed-step accumulator, input delay), drone/env → params writer.
- `src/input/` — Gamepad API, calibration, profiles, keyboard fallback, virtual gamepad for tests.
- `src/render/` — Three.js scene, parametric drone models, cameras, spray particles.
- `src/ui/` — screens, HUD, settings, logs, debrief.
- `src/logs/` — 50 Hz recorder, IndexedDB store, CSV/JSON export.
- `tests/` — Vitest physics/FC tests run the same WASM in Node.

## Commands
- `npm run build:wasm` — regenerate layout + compile WASM
- `npm run build` then `npm start` — Next.js production server on LAN (HTTP :3000, HTTPS :3443)
- `npm run dev` — Next dev mode through the same server
- `npm test` — physics/FC tests

## Next.js structure (since v0.2)
- `server.mjs` — custom Node server: HTTP + HTTPS on 0.0.0.0, self-signed cert in `./certs` (SANs = localhost + all IPv4), prints LAN URLs (virtual NICs hidden).
- `src/app/page.tsx` — DOM shell; dynamically imports `src/main.ts` and calls `startApp()` after mount (client only).
- `src/app/api/logs` (+ `[id]`) — log API → `src/server/logStore.ts` → `./data/logs/<id>.json` (ids validated by regex).
- `src/logs/db.ts` — server first, IndexedDB fallback, auto-upload of offline logs.

## Checklist
### P0 Scaffold
- [x] npm project, deps (vite, typescript, assemblyscript, vitest, three)
- [x] layout generator + WASM build pipeline
- [x] test harness loading WASM in Node (`tests/harness.ts`)
### P1 Input
- [x] Gamepad polling + profile mapping (axis/button, reverse, deadband, expo, rate)
- [x] Calibration wizard (centre, extremes, auto-detect function + direction, switches) — browser-tested incl. reversed channel
- [x] Mode 1 / Mode 2 setting, profiles per device, JSON export/import
- [x] Keyboard fallback + virtual gamepad (`window.__virtualPad`) for tests
### P2 Physics core
- [x] Rigid body 6-DOF, quaternion
- [x] Rotors, mixer with desaturation, motor lag
- [x] Drag, H-force, ETL, ground effect, VRS (debounced)
- [x] Battery (OCV + sag), payload/tank, spray flow, slosh
- [x] Ground contact, crash detection, obstacle collision (trees, poles, house, wires)
### P3 Environment + sensors
- [x] Wind: shear, turbulence (OU/Dryden-like), gusts; air density
- [x] GNSS (sats, HDOP, fix, drift, glitch, RTK), baro, radar, compass error
### P4 Flight controller
- [x] Attitude/rate control, Stabilize, AltHold, Loiter, RTL, Land
- [x] Arming (switch + gesture), pre-arm checks
- [x] Failsafes: RC loss, battery low/critical, GPS loss → AltHold; spray cut in RTL/LAND
### P5 Visuals
- [x] Farm scene (field, trees, power lines, house, water tank, windsock, pad, distance flags)
- [x] Parametric drone models for 9 drones
- [x] Cameras: VLOS, chase, FPV (own airframe hidden), top-down
- [x] Spray particles with wind drift; minimap spray-coverage trail
### P6 UI
- [x] Home, Drone select, Environment, Flight + HUD, Pause (live wind + failure injection), Settings
### P7 Logs
- [x] 50 Hz recorder, IndexedDB, logs list, debrief charts, CSV/JSON export
### P8 Test + polish
- [x] Node physics/FC tests green (26/26)
- [x] Browser run with virtual gamepad, screenshots of all views, no console errors
- [x] README, production build OK
### P9 Training features (v0.3)
- [x] AUTO mode in WASM (leg A→B guidance, lane-end stop, heading-gated speed, land with Z<0); `service()` export (battery swap / refill)
- [x] Mission planner screen (draw polygon, swath/height/speed/direction/margin, lanes preview, ha / L/ha / litres / tank loads / time)
- [x] Mission runner: auto spray on lanes only, battery-low / tank-empty → RTL + breakpoint, B = service, resume at breakpoint (tests)
- [x] Spray coverage grid (1 m) with wind drift, overlap and off-target; live map + big map (M)
- [x] Training score in debrief (height hold, speed consistency, coverage, overlap, drift, smoothness, landings, obstacle clearance, battery, emergencies) + coverage image saved in log
- [x] Procedural sound (per-motor blade-pass + motor whine + broadband, Doppler, distance absorption, wind, pump, alert beeps)
- [x] Pause menu: change drone / tank, open Settings & Mission planner mid-flight (back to paused flight), service, sound toggle
- [x] Reset to pad: Backspace or mappable RC button (`reset`); Radiomaster Pocket live layout diagram + "On radio" labels (profile v3)
- [ ] Browser check of v0.3 UI (skipped: PC had <1 GB free RAM; server was killed by low memory before)
### P10 v0.4 (2026-11-22)
- [x] Hold bug: default calm weather (+settings `sv` migration), HOLD_ASSIST in ALT HOLD/ATTI, stronger LOITER integrator, DJI vision positioning (drift 47 m → 0.5 m agri / 0.04 m DJI in 3 m/s wind; regression test)
- [x] Flight trail 3D + ground track + minimap, blue (old) → yellow (new)
- [x] Gimbal CAMERA view for DJI drones (stabilised, pitch via PgUp/PgDn or pump knob) + camera OSD (thirds, REC)
- [x] Generated training grounds: agri farms + wedding venues (mandap, stage, tents, crowd no-fly, string lights); PLACES + "generate new"; world test for every place
- [x] Accounts: login, admin panel (add/delete/reset students, progress table), server-side log ownership; auth test + HTTP smoke test
- [x] docs/USER_MANUAL.md (humans) + AGENTS.md (agents)
### P11 v0.5 (2026-11-22)
- [x] Ground-station tablet (slides up, G): geo map + area editor, Plan/Fly/Battery tabs, slide-to-start, animated pre-flight checks with tones + voice, ESC start-up tones, RTH tones/voice, pause/resume/RTH/manual
- [x] 3-pack battery bay with charger slot, heat/cool, charge time setting; tank refill; breakpoint resume flow through the tablet
- [x] Crop presets (paddy…sugarcane, bare) + grass; radar measures above the canopy (WASM CROP_H + field bounds); downwash bending + wind sway shader
- [x] Remappable keyboard shortcuts (Settings → Keyboard shortcuts)
- [x] LAN phone/tablet screen: /remote page, 6-digit code, WebRTC drone-camera video + full GCS over a data channel (signalling smoke-tested; browser WebRTC not yet tested on a real phone)
### P12 v0.6 (2026-11-23)
- [x] Phone screen rebuilt without WebRTC: QR pairing, HTTP relay (SSE telemetry 10 Hz, MJPEG camera, commands) in server-live.mjs; firewall rule now Private+Public, LocalSubnet (owner's PC is on a phone hotspot = Public)
- [x] Camera-drone ground station (DJI Fly style): live camera, shutter/record, gimbal, auto take-off/land/RTH
- [x] Real maps (Chhattisgarh): Leaflet picker on Esri satellite / OSM, Nominatim search, Overpass → trees/buildings/power lines/farmland, satellite ground; saved maps + weather; tile/OSM disk cache
- [x] HUD: height above ground / crop / take-off / MSL, vertical-speed arrows, altitude tape; clean glass HUD; neo-brutalist menus
- [ ] Browser test of v0.6 (skipped: 626 MB free RAM) — relay, tiles, search, Overpass smoke-tested with curl
### P13 v0.7 (2026-11-23)
- [x] GSAP motion system, Google fonts via next/font (offline), cheap realism (AgX, anti-tiling, contact shadow, tree AO, haze, CSS lens)
- [x] Lessons + checkride (8 lessons, live objectives, 3D markers, results in logs/debrief), tests
- [x] WebGL-unavailable fallback screen
### Next (not started)
- [ ] Owner hardware check: fly with the real Pocket and tune feel (expo, rates, `resp`, `tauMotor`)
- [ ] Real AG365XP spec sheet → `src/data/drones.ts`
- [ ] Training lessons + scoring (hover box, figure-8, spray lanes, nose-in, emergency landing)
- [ ] Log replay, instructor panel, A-B auto spray mission, ArduPilot .bin import for tuning
- [ ] Video (display) delay option; terrain following on sloped ground

## Work log
- 2026-11-22: Plan written (PLAN.md). Project started, deps installed.
- 2026-11-22: Full Basic scope built. WASM physics + FC, 26 Node tests green. Browser-tested: arm → climb → LOITER → spray → RTL → LAND → auto-disarm → debrief; all 4 views; calibration wizard. Owner's Radiomaster Pocket detected as "Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)", 8 axes, AETR on axes 0–3 (throttle low = -1).

- 2026-11-22: Ported to Next.js 15 + custom Node LAN server (HTTPS for Gamepad API). Server-side shared flight logs. Browser-tested on localhost:3000: flight → log saved on server → logs list → debrief. curl-tested HTTPS on LAN IP (page, WASM, API, invalid id rejection). Fixed false "Takeoff" event right after arming. 26/26 tests.

- 2026-11-22: Owner flew 3 real Pocket flights (all hard-landing crashes). Log analysis + exact replay (`REPLAY=<id> npx vitest run tests/replay.test.ts`) found: slosh model double-counted liquid inertia (46% attitude overshoot with full tank) → fixed; no input shaping + integrator windup → added ATC_INPUT_TC-style shaping + anti-windup; STAB throttle too steep → expo curve; ALT HOLD full-down hit ground at 2.6 m/s → radar/DJI near-ground descent limit; Pocket mode switch rested on STABILIZE → default mode order [STAB, ALTHOLD, LOITER] (profile v2 migration). Added kill switch + pump-flow knob inputs. 32 tests.
- 2026-11-22: Graphics: Poly Haven CC0 HDRIs (public/hdri, 2k+4k) via GroundedSkybox + PMREM IBL + sun direction from brightest HDR pixel; Poly Haven CC0 soil/grass textures (public/tex); 3D instanced crops + leaf-card trees; PBR drone models (blade shapes, blur discs, liquid level, nozzles, radar, LEDs). Render 7.9 ms/frame on the owner's AMD iGPU.

- 2026-11-22: v0.3 training features (see P9). 36 tests green, production build clean. Browser check pending (low RAM).

- 2026-11-22: v0.4 (P10). 48 tests green, build clean, auth smoke-tested on the real server (admin account created in data/).

- 2026-11-22: v0.5 (P11). 50 tests green, build clean, link/auth API smoke-tested.

- 2026-11-23: v0.6 (P12). 51 tests green, build clean.

- 2026-11-23: v0.7 (P13). 53 tests green, build clean.

## Lessons / working rules (grow this list)
- Rebuilding `.next` under a running production server breaks it (old HTML, missing chunks → 500 → blank page). Restart the server after every build.
- A WebGL context failure used to leave a blank page: the page now tests WebGL before importing the sim. Chrome disables the GPU process when memory runs out.
- Phones on hotspots: WebRTC host candidates are mDNS-obfuscated and the Windows profile is Public → use an HTTP relay (SSE + MJPEG) through the server; it always works if the port is reachable.
- Check the Windows network category (Get-NetConnectionProfile) when LAN devices can't connect; a Private-only firewall rule silently fails on Public networks.
- "Drift in hold" complaints: first check the default weather preset — the default had wind on. Physics was right for ATTI; product default was wrong.
- World data as ES-module `let` bindings + setWorld(): every importer (physics obstacles, HUD, planner, score) follows the new ground with no plumbing.
- AUTO legs: a multirotor that yaws 180° while already accelerating leaves the lane (1.4 m XTE). Gate lane speed on heading error (turn first, then go) → <0.75 m.
- Mission logic lives in TS (MissionRunner), guidance in WASM (AUTO_* inputs): keeps the FC simple and the mission testable headless.
- PC has ~7.5 GB RAM, often <1 GB free: don't run the server + Chrome automation without checking free memory first.
- Bash heredocs with backticks/`${}` inside Python can break in this shell — write patch scripts to the scratchpad with the Write tool.
- Never use `MeshPhysicalMaterial.transmission`: it re-renders the whole scene each frame (6 → 160 ms on integrated GPU). Low frame rate directly makes controls feel unstable — check render ms before blaming physics.
- Analyse real flight logs before changing physics: of the "unstable" complaint, half was pilot input (full-stick reversals) and half real bugs; the replay harness separates them.
- Slosh/pendulum payloads: apply only the deviation from rigid motion (F = k·d + c·v + m·a), never the full spring force — the rigid inertia is already in the body mass.
- Alpha-card foliage: duplicate quads with both windings + upward normals instead of DoubleSide (back faces otherwise render black).
- Heavy assets (HDRI 20–30 MB) must load in the background after the menu is shown.
- Gamepad API needs a secure context: LAN access must be HTTPS (self-signed OK), `http://localhost` is fine.
- Next 15.1 has no `allowedDevOrigins` (15.2+); don't add it.
- React StrictMode double-mount would start two sim loops → `reactStrictMode: false` + `startApp()` guard.
- Keep one source of truth for the WASM layout (codegen) — prevents silent index mismatch between AS and TS.
- Physics must be testable headless; every FC feature gets a scripted Node test before UI work.
- Scale position/velocity loop gains from the attitude bandwidth (derived from motor time constant). Fixed gains made heavy agri drones oscillate in LOITER while small drones were fine.
- Compute tilt in the yaw-TARGET frame and slew yaw targets at the yaw-rate limit; jumping yaw targets cause wrong-direction tilt and speed overshoot.
- Debounce event-generating conditions (VRS spammed the 32-slot event ring and hid other events).
- A body-strike rule must scale with gear height (6 cm DJI gear vs 50 cm agri gear).
- PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM → breaks package.json for Vite/PostCSS. Use the Write tool.
- Automation Chrome windows get rAF throttled to ~1–2 fps → sim looks like slow motion. Not a bug; for browser tests, drive `engine.frame()` from a timer. UI polling that must not stall (calibration wizard) uses setInterval, not rAF.
- Hexa (PNPNPN) motor-out: roll/pitch survive, yaw spins — realistic training scenario, test asserts "upright long enough to land".
