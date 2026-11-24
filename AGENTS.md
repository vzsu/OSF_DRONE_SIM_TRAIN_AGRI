# AGENTS.md — developer / AI-agent guide

Read this first, then `PROGRESS.md` (checklist, work log, lessons) and `PLAN.md` (original design). The human user manual is `docs/USER_MANUAL.md`. Keep all three up to date when you change behaviour.

## Stack
- **Physics + flight controller:** AssemblyScript → `public/sim.wasm`. Fixed 400 Hz step, no allocations after init (`--runtime stub`).
- **App:** Next.js 15 App Router. The simulator is client-only: `src/app/page.tsx` dynamically imports `src/main.ts`.
- **Server:** custom `server.mjs` (HTTP :3000 + HTTPS :3443 with a self-signed LAN certificate). API routes are in `src/app/api`.
- **Rendering:** Three.js 0.170. Audio: Web Audio (procedural). Input: Gamepad API (secure context only) + keyboard.
- **Tests:** Vitest in Node, running the same WASM.

## Commands
```bash
npm run build:wasm   # regenerate layout + compile WASM (run after any assembly/ or gen-layout change)
npm test             # all physics / mission / world / auth tests (must stay green)
npx tsc --noEmit -p . # typecheck
npm run build        # WASM + next build
npm start            # LAN server (needs a build)
REPLAY=<logId> npx vitest run tests/replay.test.ts   # replay a real flight log through the physics
```
On Windows the user starts everything with `start-sim.cmd` (wraps `start-sim.ps1`).

## Map of the source
| Path | What |
|---|---|
| `scripts/gen-layout.mjs` | **Single source of truth** for the shared memory layout (PARAMS / INPUTS / OUTPUTS). Generates `assembly/layout.ts` + `src/sim/layout.ts`. Never edit the generated files. |
| `assembly/index.ts` | Rigid body, rotors/mixer, aero, battery, tank/slosh, ground contact, obstacles, wind, sensors (GNSS/vision/baro/radar), FC (STAB/ALTHOLD/LOITER/RTL/LAND/AUTO), failsafes, events. Exports `setup/reset/step/service`. |
| `src/sim/wasm.ts` | Loader, `writeParams`, `writeInputs`, event texts, mode names, env presets |
| `src/sim/engine.ts` | Real-time loop (accumulator, link delay), mission runner + coverage hooks, recorder, `finish()` → score |
| `src/sim/mission.ts` | Lane planner (boustrophedon), `MissionRunner` (AUTO guidance, auto spray, breakpoint, resume) |
| `src/sim/coverage.ts` | 1 m spray-coverage grid with droplet drift, overlap, off-target |
| `src/data/world.ts` | Training grounds: `generateWorld(category, seed)`, `PLACES`, live `let` bindings (`FIELD`, `TREES`, `POLES`, `WIRES`, `BOXES`, `PILLARS`, `CROWD`…), `obstacleList()`, `overCrowd()` |
| `src/data/drones.ts` | Drone roster (masses, props, thrust, batteries, FC limits); `sources` says what is real vs estimated |
| `src/render/world3d.ts` | Scene, `rebuildSite()` per training ground, crops/trees/venue, trail (blue→yellow), spray particles, cameras incl. gimbal `cam` view |
| `src/render/droneModel.ts`, `environment.ts` | Parametric PBR drones; HDRI loading (GroundedSkybox + PMREM + sun from the brightest pixel) |
| `src/audio/sound.ts` | Procedural rotor/motor/wind/pump audio, Doppler, alert beeps |
| `src/input/input.ts`, `src/settings.ts` | Gamepad/keyboard mapping, profiles (schema `v`), settings (schema `sv`) with migrations |
| `src/ui/*.ts` | Screens (home, drone, environment, settings + Pocket diagram, logs, debrief), HUD/minimap, mission planner, login/admin |
| `src/logs/*` | 50 Hz recorder (`LOG_SCHEMA`), server/IndexedDB store, scoring (`score.ts`) |
| `src/server/*` | `logStore.ts` (data/logs/*.json), `users.ts` (accounts, scrypt, HMAC cookie sessions) |
| `src/auth/client.ts` | Browser auth helpers (`currentUser`, `offline`) |
| `src/gcs/host.ts` | Ground-station host: `telemetry()`, `command()` (plan/start/pause/resume/rth/manual/pack/refill), slide-to-start pre-flight sequence, ENU↔lat/lon |
| `src/gcs/ui.ts` | Tablet UI (`GcsUI`) — same code embedded (slides up, key G) and full-screen on LAN devices; talks only through `GcsLink` |
| `src/sim/batteries.ts` | 3-pack battery bay, 1 charger slot, heating/cooling, CC/CV charging |
| `src/data/crops.ts` | Crop + grass presets (crop height feeds the radar via `CROP_H` + field bounds params) |
| `src/input/keys.ts` | Remappable keyboard actions (`settings.keys`); `onKey` delivers ACTION ids, not key codes |
| `src/audio/voice.ts` | Voice prompts (speechSynthesis), per-event mapping |
| `server-live.mjs` | Plain-Node routes before Next: `/live/*` phone-screen relay (SSE telemetry/commands + MJPEG camera, QR token), `/tiles/{sat,osm}` tile proxy + disk cache (z≥9 only inside Chhattisgarh), `/geo/search` (Nominatim) and `/geo/osm` (Overpass) proxy + cache |
| `src/net/linkHost.ts`, `src/remote/remote.ts`, `src/app/remote/page.tsx` | Phone/tablet screen. **No WebRTC** (failed on phone hotspots: mDNS `.local` candidates, Public network). Sim POSTs telemetry 10 Hz + JPEG frames ~12 fps; phone gets SSE + `<img>` MJPEG |
| `src/maps/osm.ts`, `src/ui/realmap.ts`, `src/server/mapStore.ts`, `api/maps` | Real-map grounds: Leaflet picker, OSM → `WorldDef` (buildings, trees, power lines, farmland `fieldPoly`), satellite ground image, saved in `data/maps` |
| `src/lessons/basics.ts` | Beginner exercises 1–10: grading + **demo autopilot** (`BasicLesson.demo`) flying the same objectives with sticks only; `tests/basics.test.ts` proves every demo passes its own exercise |
| `src/course/*`, `src/ui/course.ts`, `content/course/` | DGCA course (from OSF_DRONE_LEARNING_OS content): modules, KaTeX formulas, quizzes (MCQ + true/false), checklists, training plan, `SIM_LINKS` to sim exercises |
| `src/server/progressStore.ts`, `api/progress` | Per-student progress (quiz best, exercises, concepts read, checklists) in `data/progress/<userId>.json`; students write only their own, admins read anyone's |
| `src/ui/router.ts` | Whitelisted History-API routes + shadcn-structured breadcrumbs; `src/app/[[...slug]]/page.tsx` serves every path |
| `.mcp.json`, `.claude/skills/codegraph/` | CodeGraph code index (MCP `codegraph_explore` + CLI); `.codegraph/` is git-ignored |
| `tests/*` | `sim` (FC/physics), `mission` (planner, AUTO, breakpoint, score), `world` (every ground), `auth`, `replay` |

## Rules (learned the hard way — see PROGRESS.md "Lessons")
1. **Layout changes:** edit `gen-layout.mjs` → `npm run build:wasm`. New params also go into `writeParams`. New inputs go into `writeInputs` and `tests/harness.ts` if tests need them.
2. **Every FC/physics change gets a headless test first.** Analyse real logs (`data/logs`, replay harness) before "fixing" handling. Half of the first "unstable" complaint was pilot input.
3. **Position/velocity gains scale from the attitude bandwidth** (`attKa`). Heavy agri drones and small DJI drones share one controller.
4. **Hold modes must hold** (user-reported bug):
   - LOITER/P-GPS uses a strong velocity integrator. AUTO uses a softer one, otherwise it overshoots cross-track after turns.
   - DJI drones use vision-positioning noise below 30 m.
   - ALT HOLD has `HOLD_ASSIST` (default on). Tests that need real ATTI drift pass `holdAssist: false`.
5. **Default weather is calm.** Wind is opt-in per lesson. Settings schema `sv` migrates old saved settings.
6. **Never use `MeshPhysicalMaterial.transmission`.** It costs 160 ms/frame on an integrated GPU. Check render ms before blaming physics for "laggy controls".
7. **Training grounds:** must fit `OBS_MAX = 96` obstacle slots and keep 6 m clear around the pad. `tests/world.test.ts` checks every `PLACES` entry plus random seeds. Seed 0 (`classicFarm`) must stay identical, because old logs depend on it.
8. **Auth:**
   - The server sets `header.userId`/`trainee` on uploaded logs; never trust the client.
   - Students only see their own logs.
   - Passwords are scrypt hashes only. `data/` (users, secret, logs, admin password file) is git-ignored and must never be committed.
9. **Browser automation:** the Chrome automation window throttles rAF, so drive `engine.frame()` from a timer. `window.__sim` exposes `{engine, world, state, nav}` and `window.__virtualPad` fakes an RC.
10. **This PC has ~7.5 GB RAM and often < 1 GB free.** Check free memory before starting the server and Chrome. The server has been killed for low memory before.
11. **Windows shell:** Bash heredocs containing backticks or `${}` inside Python can break. Write patch scripts to the scratchpad with the Write tool. PowerShell `Set-Content` adds a BOM, so use the Write tool for JSON.
13. The engine's `gcsMode` overrides the RC mode while the tablet runs a mission; any RC mode-switch movement clears it. `requestArm()` pulses the WASM `ARM_CMD` input.
14. The aux camera for LAN video is rendered into a scissored corner of the main framebuffer and read back before the main render, so it keeps tone mapping; it only runs while a remote peer is connected.
15. Camera drones (`drone.fc === 'dji'`) get the camera ground-station (`GcsUI.kind === 'cam'`). Auto take-off uses `engine.guided` (AUTO holding a point), then hands over to LOITER (`gcsMode = 2`).
16. Real-map worlds can have more obstacles than physics slots: `obstacleList()` keeps the 96 nearest to the take-off area.
17. UI style: menus and screens are neo-brutalist (`.screen`, `.pause` scoped CSS). The HUD and the tablet stay clean and dark — don't mix them.
18. **After `next build`, restart any running `server.mjs`.** A production server started before the build serves HTML pointing at deleted chunks → JS 500 → blank page (happened 2026-11-23).
19. **Guest mode** (`isGuest()`, sessionStorage per tab): never call `saveLog` / persist progress for guests. Entering guest mode logs out any old session and clears progress.
20. New screens: add the route to `STATIC` / `parse` / `pathFor` / `crumbsFor` in `router.ts` and a branch in `main.ts` `nav()`. Never route on unvalidated params.
21. Navigating code: use CodeGraph first (see `.claude/skills/codegraph/SKILL.md`).
22. Lessons set `engine.lockAutoModes` (RTL / LAND / AUTO requests become LOITER, tablet auto commands refused); the runner fails a run if mode 3/4/5 is ever active. Lessons fly on `generateWorld('training')` (see `lessonPlace()` in main).
23. The main loop wraps each frame in try/catch: a HUD bug must not freeze the simulation. Never index `POLES[0]` etc. — some grounds have none.
12. Keep `MODES` order = WASM mode numbers (0 STAB, 1 ALTHOLD, 2 LOITER, 3 RTL, 4 LAND, 5 AUTO). Event codes ≥ 100 are mode changes.

## Adding things
- **A drone:** add a `DroneDef` in `src/data/drones.ts` (cite sources). The roster test in `tests/sim.test.ts` flies it automatically.
- **A training-ground category:**
  1. Add a generator in `world.ts`.
  2. Add a renderer branch in `buildSite()`.
  3. Add a minimap drawing in `hud.ts`.
  4. Add score items in `score.ts`.
  5. Add `PLACES` entries.
- **A score item:** `scoreFlight()` in `src/logs/score.ts`. Each item has a weight and an instructor tip; weight 0 = information only.
- **A flight mode:** add the WASM `M_*` constant, `needsGps`, the control branch, `MODES`/`DJI_MODES` names, and the mode-switch option list.
