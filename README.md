# OSF Agri Flight Trainer

Web-based training simulator for agricultural drone pilots (Marut AG365 family first). It is flown with a real RC transmitter such as the Radiomaster Pocket, or with the keyboard. Physics and flight-controller behaviour run in WebAssembly at a fixed 400 Hz.

**Manuals:** [docs/USER_MANUAL.md](docs/USER_MANUAL.md) is for instructors and students. [AGENTS.md](AGENTS.md) is for developers and AI agents.

**Training grounds:** generated *Agri spray* farms and *Wedding shoot* venues. Each venue has a mandap, stage, tents, guests (no-fly) and string lights.

**Accounts:** students and instructors sign in. On first start the server creates `admin` with a one-time password and saves it in `data/ADMIN_FIRST_LOGIN.txt`.

## Quick start (Windows)

Double-click **`start-sim.cmd`**. It checks Node.js, installs packages, rebuilds only when files have changed, frees the ports from an old sim server, starts the LAN server and opens the browser.

Run **`start-sim.cmd -SetupFirewall`** once so trainee PCs can connect. It asks for administrator permission one time. Other options: `-Rebuild`, `-Dev`, `-NoBrowser`, `-HttpPort 3000`, `-HttpsPort 3443`.

## Run (Next.js + Node server, local network)

```bash
npm install
npm run build      # compile WASM + Next.js production build
npm start          # serve on the LAN (HTTP :3000 and HTTPS :3443)
npm run dev        # development mode, same ports
npm test           # physics + flight-controller tests (Node, same WASM)
```

The server prints its addresses on startup:

```
This PC:        http://localhost:3000
Trainee PCs:    https://192.168.x.x:3443   (accept the certificate warning once)
```

- **Other PCs on the network must use the `https://…:3443` address.** Browsers only allow RC transmitters (the Gamepad API) on secure pages. Plain `http://<LAN-IP>` is not secure, so the radio would not be detected. `http://localhost` on the server PC is secure.
- The certificate is self-signed and created in `./certs` on first run. It covers this PC's current LAN addresses. On each trainee PC, choose **Advanced → Proceed** once. If the server's IP changes, a new certificate is created automatically.
- **Windows Firewall:** the first time `npm start` runs, allow Node.js on **Private networks**. Otherwise other PCs can't connect.
- **Flight logs** are saved on the server in `./data/logs`, one JSON file per flight. Every PC on the network shares them, so an instructor can open any trainee's flight. If the server is unreachable, logs are kept in that browser and uploaded the next time the Logs screen is opened.
- Ports: `node server.mjs --http-port 3000 --https-port 3443`, or set the `PORT` / `HTTPS_PORT` environment variables.

Use Chrome or Edge. Keep the sim window in front. Browsers slow down animation in background or covered windows, which makes the simulation run in slow motion.

## Connect the Radiomaster Pocket

1. Plug the radio into the PC with USB-C.
2. On the radio prompt choose **USB Joystick (HID)**.
3. Open the sim and move a stick. The home screen shows the controller name.
4. Go to **Settings → Controller → Run calibration wizard**. Do this once per radio and browser.

The default mapping matches EdgeTX: CH1–CH8 map to axes 0–7 (AETR). CH5 is arm, CH6 is the flight-mode switch, CH7 is spray and CH8 is RTL. The wizard detects your own layout and any reversed channels. Profiles can be exported and imported as JSON.

## Keyboard (Mode 2)

| Key | Action |
|---|---|
| W / S | Throttle |
| A / D | Yaw |
| Arrow keys | Pitch / roll |
| Enter | Arm switch |
| 1 / 2 / 3 | Flight-mode switch position |
| 4 | AUTO (fly the planned spray mission) |
| B | Swap battery + refill tank (landed, disarmed) |
| M | Big map with spray coverage |
| Backspace | Reset to the pad |
| Space | Spray |
| R | RTL |
| V | Change view |
| Esc | Pause menu: change drone/tank, settings, mission planner, live wind, failure injection, sound |

## Spray missions (AUTO) and training score

1. **Mission planner** (home screen or pause menu): click corners of the spray area on the farm map. Then set the lane spacing (swath), height, speed and lane direction. It shows area (ha), lanes, L/ha, litres, tank loads and time.
2. In flight, switch to **AUTO**: keyboard `4`, or set a mode-switch position to AUTO in Settings → Controller. Then arm. The drone takes off, sprays every lane with the pump on only over lanes, and lands at the pad.
3. **Battery low or tank empty:** the drone does an RTL and saves a **breakpoint** (red "BP" on the map). After it lands, press `B` to swap the battery and refill the tank. Arm again in AUTO and it flies to the breakpoint and continues the same lane.
4. Flip out of AUTO at any time to take manual control. The breakpoint is kept.
5. **Debrief:** training score 0–100 and the spray coverage map. Blue is sprayed once, amber is overlap and red is drift or off-target. The score items are spray height hold, speed consistency, coverage, overlap, drift, stick smoothness, touchdown speed, obstacle clearance, battery reserve and emergency handling.

**Sound** is generated from the physics; no audio files are used. Each motor has a blade-pass tone at rpm/60 × blades, plus motor whine and broadband rotor noise. Doppler shift and distance fall-off follow the camera position. Wind, pump and RC-style alert beeps are also included. Turn sound on or off in Settings → Display or in the pause menu.

**Radio layout:** Settings → Controller shows a live Radiomaster Pocket diagram. It lights up whatever you move and shows which function each switch drives. Choose labels in the "On radio" column.

## Environments and assets

- **360° scenes:** real HDRI scans from [Poly Haven](https://polyhaven.com) (CC0, the same library Blender users use): *Rural road*, *Farm fields*, *Field at sunrise*. They are in `public/hdri` at 4K (High quality) and 2K (Low quality). Choose one under **Environment**, or pick *Simple sky* on very weak PCs.
- **Ground textures:** CC0 soil and grass maps from Poly Haven in `public/tex`.
- **RC inputs:** sticks, arm, 3-position flight mode, spray, RTL, **emergency motor stop (kill)**, **pump flow knob** and view. Map them in **Settings → Controller → calibration wizard**.

## What is simulated

- **Airframe:** 6-DOF rigid body. Per-motor thrust, motor spin-up lag (the "heavy drone" feel), drag, rotor H-force, translational lift, ground effect, vortex ring state.
- **Air:** density from temperature and elevation.
- **Wind:** shear with height, turbulence, gusts.
- **Battery:** open-circuit-voltage curve and voltage sag under load.
- **Tank:** liquid mass that drops while spraying, liquid slosh.
- **Ground and obstacles:** landing-gear contact, hard-landing and tip-over crashes, collisions with trees, poles, the house and power lines.
- **Sensors:** GNSS satellite count, HDOP, fix type, drift and glitches, RTK; barometer drift; radar altitude; compass error.
- **Flight controller (ArduPilot-style):** modes are STABILIZE, ALT HOLD (mid-stick throttle), LOITER, RTL and LAND. Arming works by switch or by stick gesture. Pre-arm checks cover throttle, GPS and battery.
  - **GPS lost:** drops to ALT HOLD and the drone drifts with the wind.
  - **RC lost:** RTL, or LAND if there is no GPS.
  - **Battery low / critical:** RTL / LAND.
  - **Spray:** the pump is cut during RTL and LAND.
- **Views:** VLOS (pilot on the ground), third-person chase, FPV and top-down.
- **Flight logs:** 50 Hz, versioned schema, stored in the browser (IndexedDB). The debrief shows charts and events, with CSV and JSON export.

## Drone data

Drone parameters are in `src/data/drones.ts`. Values that aren't sourced are engineering estimates. Replace them with real spec-sheet values such as mass, props, battery and thrust; the AG365XP sheet is still needed. No code changes are required.

## Project map

See `PROGRESS.md` (checklist, architecture, lessons) and `PLAN.md` (full plan).
