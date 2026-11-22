# OSF Agri Drone Training Simulator — Plan v1

Goal: a web-based, real-time flight trainer for agricultural drone pilots (Marut AG365 family first), flown with a real RC transmitter (Radiomaster Pocket or any USB joystick-mode radio). Priority order: **controls and latency > flight physics > flight-controller behaviour > logs > visuals.** Graphics stay simple and low-poly on purpose.

---

## 1. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Build | Vite + TypeScript | Fast dev server, static output, runs offline from a laptop |
| Physics + flight controller | AssemblyScript compiled to WebAssembly | Deterministic, fixed-step, same code runs in browser and in Node for automated tests. No Rust/C toolchain needed (only Node is installed) |
| Rendering | Three.js, low-poly, procedural models | Runs on weak training-centre laptops |
| Input | Browser Gamepad API | Radiomaster Pocket (EdgeTX) appears as a USB HID joystick |
| Storage | IndexedDB (logs), localStorage (settings) + JSON export/import | No server needed in v1 |
| Tests | Vitest (physics in Node), Claude-in-Chrome browser runs with a scripted virtual gamepad | Repeatable checks |

Loop design: physics at a fixed **400 Hz** inside WASM, rendering at display rate with interpolation, input sampled every frame and timestamped. Physics state is shared through one Float64Array view of WASM memory (no per-field calls across the JS/WASM boundary).

---

## 2. Drone roster v1

Figures marked **S** come from a manufacturer or retailer source; **E** are engineering estimates to be replaced with spec sheets or tuned against real flight logs. Every drone is a JSON file in `/drones/` so values can be corrected without code changes.

| Drone | Class | Frame | Empty / MTOW | Tank | Flight time | Notes |
|---|---|---|---|---|---|---|
| Marut AG365H | Medium (India) | Hexa (E) | ~30 kg (S, retailer) | 10 L (S) | ~23 min (S) | Closest public match to "AG365XP" — **need real spec sheet** |
| Marut AG365S | Small (<25 kg) | Hexa (E) | ~25 kg (S) | 10 L (S) | ~22 min (S) | First DGCA type-certified small agri drone |
| Garuda Kisan (GA-AD V2) | Small | Hexa (E) | gross 24.9 kg, payload 8 kg (S) | 8 L | ~20 min (E) | |
| IoTechWorld Agribot | Small | Hexa (E) | ~15 kg + 10 kg payload (S, older) | 10 L | ~20 min (S) | |
| DJI Agras T25 | Medium | Coaxial quad (S) | 25.4 kg w/o batt, 32 kg with; MTOW 52 kg spray (S) | 20 L | — | |
| DJI Agras T50 | Medium | Coaxial octo (S) | 39.9 kg w/o batt, 52 kg with; MTOW 92 kg spray (S) | 40 L | — | |
| DJI Air 3S | Consumer | Quad | 724 g (S) | — | ~45 min | |
| DJI Mavic 3 Pro | Consumer | Quad | 958 g (S) | — | ~43 min | |
| DJI Phantom 4 Pro V2.0 | Consumer | Quad | 1375 g (S) | — | ~30 min | |

3D models: exact manufacturer CAD is proprietary and not available. Each drone gets a **parametric low-poly model** built from its JSON (arm count, span, prop diameter, tank shape, landing gear, colour scheme), so the silhouette, size and prop layout are right for orientation training. No brand logos. A "load your own .glb" slot is reserved for later.

---

## 3. Physics model (WASM)

Per-step (2.5 ms):

1. **Rigid body 6-DOF** — mass and inertia from the drone file, quaternion attitude, semi-implicit Euler.
2. **Rotors** — thrust `T = kT·ω²`, torque `Q = kQ·ω²`, first-order **motor/prop spin-up lag** (large 30"+ agri props: ~80–150 ms; DJI consumer: ~20 ms). This lag is the main "heavy drone" feel trainees must learn.
3. **Air density** from field elevation + temperature (density altitude cuts thrust; e.g. summer Rajasthan vs Punjab winter).
4. **Aerodynamics** — linear + quadratic body drag, rotor induced drag (H-force), translational lift, **ground effect** below ~1 rotor diameter, simplified **vortex ring state** on fast vertical descent.
5. **Wind** — mean wind with **altitude shear** (power law), **Dryden turbulence**, discrete gusts, optional thermal bumps. Same wind field drives the windsock and the spray drift.
6. **Payload** — tank mass falls with flow rate (L/min) while spraying; **slosh** modelled as a damped pendulum mass inside the tank (causes the real "wobble after a stop" with a half tank).
7. **Battery** — 12S/14S pack, Thevenin model (OCV curve + internal resistance + RC pair): voltage sag under load, capacity in mAh, temperature effect. Drives max thrust.
8. **Ground contact** — spring-damper landing legs, friction, tip-over detection, crash = impact speed or attitude threshold.
9. **Failures (injectable)** — one motor out (hexa/octo stays controllable), GPS loss, compass error, low battery, RC link loss.

## 4. Flight controller emulation (WASM)

Modelled on ArduPilot/JIYI-style agri controllers (what most Indian agri drones run). DJI models use a DJI behaviour profile.

- Cascaded PID: rate → attitude → velocity → position, with tilt and climb limits per drone.
- **Modes:** Stabilize (manual throttle), **AltHold** (throttle centre = hold, drifts with wind), **Loiter/PosHold** (needs GPS fix), Brake, RTL, Land, and later **Auto A-B line spraying**.
- **Pre-arm checks:** sats ≥ threshold, HDOP, compass, battery, throttle low, mode valid. **Arming gesture**: throttle low + yaw right (ArduPilot) or CSC (DJI).
- **Failsafes:** RC loss → RTL/Land, low battery → RTL, GPS loss in Loiter → falls back to AltHold (drone starts drifting — key training event), geofence.

## 5. Sensors and GNSS model

- **Satellite count** varies over time (base 14–22), drops near trees/buildings; **HDOP**, fix type (No fix / 2D / 3D / RTK float / RTK fixed).
- GPS position noise + slow random walk + occasional glitch; RTK option for high-end models.
- Baro altitude with noise and drift; **radar/terrain AGL** for agri models (terrain following).
- Compass with optional interference zone (near pump house / power line).

## 6. Environment (simple, training-focused)

- One flat Indian farm scene: ~2 ha field with crop rows, bunds, a road, trees, a farmhouse, **power lines and poles** (most common real accident cause), a water tank, take-off pad.
- **Windsock** + flag (trainees must learn to read wind visually), drift visible on spray particles.
- Settings: wind speed/direction/gust/turbulence, temperature, field elevation, time of day (sun glare for VLOS), GPS quality preset.
- Correct real-world scale everywhere — at 100 m a 1.8 m drone *should* look tiny in VLOS.

## 7. Screens

1. **Home** — Fly, Drone select, Environment, Settings, Logs.
2. **Drone select** — roster cards with key specs; payload slider (tank fill %).
3. **Environment setup** — wind, gust, temperature, elevation, GPS quality, time of day; presets ("Calm morning", "Afternoon gusty", "Poor GPS").
4. **Flight (play) screen** — 3D view + HUD + mini-map; pause menu (restart, reset position, change wind, end flight).
5. **Post-flight debrief** — flight summary, max altitude/speed, battery used, events/warnings, crash reason; graphs of altitude/attitude/stick inputs; export.
6. **Settings**
   - **Controller:** device picker, live channel bars, **calibration wizard** (centre → move all sticks to extremes → flip each switch), per-channel assign, reverse, deadband, expo, rate, **Mode 1 / Mode 2** stick layout, switch → flight mode mapping (3-pos switch positions), arm/spray/RTL switch assignment. Profiles saved per device ID + JSON export/import.
   - **Camera:** VLOS pilot position and eye height, FOV, zoom limit; chase distance; FPV camera tilt.
   - **Latency:** show measured input latency; optional added **link delay** and **video delay** to train for real telemetry/FPV lag.
   - **Units** (m / ft, m/s / km/h), HUD element toggles, graphics quality.
   - **Training aids** (instructor can switch off): drone orientation arrow, ghost heading indicator, ground shadow marker.
7. **Logs** — list of flights (trainee name, drone, date, duration, result), open debrief, export CSV/JSON, delete.

## 8. Cameras / POV

- **VLOS** (default for agri): fixed at pilot position, 1.7 m eye height, auto-tracks the drone with a human-like lag, limited zoom. Pilot position draggable on the map.
- **Third-person chase**: behind the drone, smoothing, optional heading-locked vs world-locked.
- **FPV / gimbal**: onboard camera, adjustable tilt.
- **Top-down map**: for spray-line work.
- Hotkey + RC switch to cycle views.

## 9. HUD / telemetry

Mode, armed state, **altitude AGL** (radar) and **relative to home**, MSL, vertical speed, ground speed, airspeed, **wind speed + direction at drone and at ground**, heading/compass tape, attitude indicator, **sat count + HDOP + fix type**, battery V / % / A / mAh used / time left estimate, **tank litres + flow rate + spray on/off**, distance and bearing to home, RC link quality, warnings banner (low battery, GPS lost, geofence, high wind, VRS risk).

## 10. Flight logs (built now with room to grow)

- Recorded at **50 Hz**, header + rows, stored in IndexedDB.
- Header: schema version, sim version, trainee, drone ID + full parameter snapshot, environment settings, controller profile, start time.
- Row: t, raw RC channels, processed sticks, mode, armed, position, velocity, attitude, rates, motor outputs, battery V/A/mAh, tank L, spray state, wind at drone, sats, HDOP, AGL, events.
- Events table: arm/disarm, mode change, failsafe, warnings, crash with cause.
- Export: CSV (per-row) and JSON (full). The schema is versioned so scoring, replay, instructor review and ArduPilot `.bin` comparison can be added later without breaking old logs.

## 11. Testing (what I will do myself)

1. **Physics unit tests in Node** (WASM runs headless): hover throttle within expected band, energy/battery drain vs flight-time spec, motor lag step response, wind drift rate, ground effect, slosh settles, determinism (same inputs → same log).
2. **Flight-controller tests:** AltHold holds ±0.5 m in calm air, Loiter holds position, GPS loss → AltHold drift, RC loss → RTL, pre-arm blocks with low sats.
3. **Scripted flights:** recorded stick scripts (take-off, hover, box, spray line, land) replayed through the sim; assertions on the resulting log.
4. **Browser tests via Claude in Chrome:** load every screen, inject a **virtual gamepad** (overrides `navigator.getGamepads`) to fly the scripted routes, screenshot each screen, check console errors, check FPS and frame-time stability.
5. **What I cannot test:** your physical Radiomaster Pocket and how the flight "feels" to an experienced AG365 pilot. You must do the hardware check (Section 13) and a feel check.

## 12. Problems found in brainstorm, and the fix for each

| # | Problem | Fix |
|---|---|---|
| 1 | Pocket must be in **USB Joystick (HID)** mode; in "USB Storage" or "Serial" mode the browser sees nothing | Connection screen with step-by-step EdgeTX instructions |
| 2 | Browser only exposes a gamepad **after a stick/button moves** | "Move a stick to connect" prompt |
| 3 | Axis order and ranges differ between Chrome/Edge/Firefox and Windows/Mac | Mandatory calibration wizard; profile keyed by device ID + browser |
| 4 | Windows HID limits (8 axes); switches may arrive as buttons or as axes | Map any input (axis or button) to any function; EdgeTX "Advanced" joystick mode notes |
| 5 | Gamepad is polled at frame rate (~60–144 Hz), not the radio's 250–500 Hz | Fine for training; timestamp inputs, interpolate into 400 Hz physics, show measured latency |
| 6 | Frame drops on weak laptops → unstable physics | Fixed-step accumulator, max 0.1 s catch-up, physics independent of FPS |
| 7 | Background tab throttling pauses the sim | Auto-pause on hidden tab; log the pause |
| 8 | Real AG365 parameters unknown → wrong feel | All params in JSON; tune against real flight data (hover throttle %, max speed, flight time, ArduPilot logs) |
| 9 | ArduPilot AltHold uses **mid-stick throttle**; trainees used to DJI or toys get confused | Model it exactly; HUD shows throttle-centre marker |
| 10 | Mode 1 vs Mode 2 trainees | Setting in controller profile |
| 11 | VLOS orientation loss (nose-in) is the real skill gap | Real scale, no orientation aids by default, optional aids for beginners, nose-in exercises later |
| 12 | Heavy-drone inertia and slow motor response are the main crash cause | Explicit motor lag + full-tank mass; payload slider |
| 13 | Sim too "clean" → false confidence | Turbulence, GPS drift, sat drops, battery sag, slosh on by default; "Calm" preset only for first lessons |
| 14 | WASM↔JS call overhead | Single shared state buffer, one `step(n)` call per frame |
| 15 | Motion sickness in FPV view | FOV setting, horizon-stable option, VLOS default |
| 16 | Logs filling browser storage | Size cap with warning, export-and-delete |
| 17 | Exact 3D models unavailable / licensing | Parametric accurate-size models, .glb import slot later |
| 18 | DJI drones behave very differently from ArduPilot agri drones | Separate FC behaviour profile per drone |
| 19 | Power-line strikes not represented | Thin wires with sag in the scene, collision on wire |
| 20 | Spray drift not visible → no lesson | Simple particle spray affected by the same wind field |

## 13. Your hardware checklist (Radiomaster Pocket)

1. Plug the Pocket into the PC by USB-C.
2. On the radio prompt choose **USB Joystick (HID)**.
3. Open the sim in Chrome or Edge, move a stick.
4. Run the calibration wizard in Settings → Controller.

## 14. Build phases (Basic scope)

| Phase | Deliverable |
|---|---|
| P0 | Project scaffold, WASM build pipeline, test harness |
| P1 | Gamepad layer + calibration wizard + controller profiles |
| P2 | Physics core (rigid body, rotors, motor lag, drag, ground, battery, payload, slosh) + tests |
| P3 | Wind (shear, Dryden, gusts) + air density + GNSS/baro/radar sensor models |
| P4 | Flight controller: Stabilize, AltHold, Loiter, RTL, Land, arming, failsafes + tests |
| P5 | Scene, parametric drone models (9 drones), cameras (VLOS / chase / FPV / map) |
| P6 | HUD, screens, settings, environment setup |
| P7 | Flight logs + debrief + export |
| P8 | Full self-test pass (Node + browser), fixes, README |

Later (not in Basic): training lessons and scoring, instructor panel, replay, A-B auto spray missions, ArduPilot log import for tuning, multiplayer trainer/trainee.

## 15. Open questions for the owner

1. **AG365XP spec sheet** — mass empty/full, frame (hexa?), prop size, motor model, battery (S count, mAh), tank size, max speed, flight controller (ArduPilot / JIYI / other). "AG365XP" was not found publicly; AG365H is used as the placeholder.
2. Stick mode used in your training: Mode 1 or Mode 2?
3. Which flight controller behaviour should the Marut drones copy?
4. Units: metric only?
