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
