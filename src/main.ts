import { Engine } from './sim/engine';
import { World3D } from './render/world3d';
import { Hud } from './ui/hud';
import { homeScreen, droneScreen, envScreen, settingsScreen, logsScreen, debriefScreen, setBack } from './ui/screens';
import { missionScreen } from './ui/mission';
import { loginScreen, adminScreen } from './ui/account';
import { me, logout, currentUser, offline } from './auth/client';
import { DroneSound } from './audio/sound';
import { voiceForEvent, speak } from './audio/voice';
import { GcsHost, type Telemetry } from './gcs/host';
import { GcsUI } from './gcs/ui';
import { LinkHost } from './net/linkHost';
import { DRONES } from './data/drones';
import { HOME, setWorld, generateWorld, placeById, WORLD, overCrowd } from './data/world';
import { defaultPlan } from './sim/mission';
import { settings, saveSettings, type View } from './settings';
import { onKey, keyboardArmReset } from './input/input';
import { saveLog } from './logs/db';
import { CRASH_CAUSE } from './sim/wasm';
import type { FlightLog } from './logs/recorder';

const engine = new Engine();
const world = new World3D(document.getElementById('gl') as HTMLCanvasElement);
const hud = new Hud();
const uiEl = document.getElementById('ui')!;
const toasts = document.getElementById('toasts')!;

let flying = false;
let crashTimer = 0;
let lastT = 0;
let lastViewPos = -1;
let pauseEl: HTMLElement | null = null;
let slowWarned = false;
const sound = new DroneSound();
// ---------- ground-station tablet (slides up from the bottom; same UI on LAN devices) ----------
const gcsHost = new GcsHost(engine, {
  beep: (f, n, len) => sound.beep(f, n, len), toast: (t, bad) => toast(t, bad),
  missionChanged: () => reloadMission(),
});
let telCache: Telemetry | null = null, telAt = 0;
const localTel = () => {
  if (!flying) return null;
  const now = performance.now();
  if (!telCache || now - telAt > 100) { telCache = gcsHost.telemetry(false, true); telAt = now; }
  return telCache;
};
const gcs = new GcsUI({ tel: localTel, world: () => (flying ? gcsHost.worldGeo() : null), send: (c) => gcsHost.command(c) }, document.body, true);
{
  const h = document.createElement('div'); h.className = 'gcs-handle'; h.title = 'Close (G)'; h.onclick = () => gcs.close();
  gcs.root.prepend(h);
}
const gcsBtn = document.createElement('button');
gcsBtn.className = 'gcs-open-btn'; gcsBtn.textContent = 'Ground station (G)';
gcsBtn.onclick = () => gcs.toggle();
document.body.appendChild(gcsBtn);
const linkHost = new LinkHost(engine, world, gcsHost, (t, bad) => toast(t, bad));
let missionKey = '';
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => sound.unlock());

declare global { interface Window { __sim?: { engine: Engine; world: World3D; state: () => string; nav: typeof nav } } }

function toast(text: string, bad = false) {
  const d = document.createElement('div');
  d.textContent = text; if (bad) d.className = 'bad';
  toasts.appendChild(d);
  setTimeout(() => d.remove(), 4000);
  while (toasts.children.length > 5) toasts.firstElementChild!.remove();
}

const VIEWS: View[] = ['vlos', 'chase', 'fpv', 'cam', 'top'];
/** Gimbal camera view only on camera drones (DJI); agri drones use the FPV camera. */
const viewsFor = (): View[] => (engine.drone?.fc === 'dji' ? VIEWS : VIEWS.filter((v) => v !== 'cam'));
function cycleView() { const vs = viewsFor(); settings.camera.view = vs[(vs.indexOf(settings.camera.view) + 1) % vs.length]; saveSettings(); }

/** Build the selected training ground (agri farm / wedding venue) for physics, renderer, map. */
function applyPlace() {
  const pl = settings.place.id === 'custom' ? { category: settings.place.category, seed: settings.place.seed, name: '' } : placeById(settings.place.id);
  if (WORLD.category !== pl.category || WORLD.seed !== pl.seed) {
    setWorld(generateWorld(pl.category, pl.seed, pl.name));
    // keep the mission area on the new field
    settings.mission.poly = defaultPlan().poly; saveSettings();
  }
  world.rebuildSite(); // no-op unless place, crop or grass changed
}

function nav(screen: string, arg?: unknown) {
  closePause();
  if (screen === 'fly') { if (!currentUser && !offline) { loginScreen(nav); return; } return startFlight(); }
  if (screen === 'resume' && flying) {
    // back from settings / mission planner opened in the pause menu
    setBack('home', '← Home');
    reloadMission();
    uiEl.innerHTML = ''; hud.show(true); openPause();
    return;
  }
  // settings and mission planner can be opened mid-flight: the flight stays paused underneath
  gcs.close();
  const keep = flying && (screen === 'settings' || screen === 'mission');
  if (keep) { engine.paused = true; setBack('resume', '← Back to flight'); }
  else { flying = false; setBack('home', '← Home'); }
  hud.show(false);
  if (screen === 'logout') { void logout().then(() => loginScreen(nav)); return; }
  // students and instructors must sign in (unless the server is unreachable → local practice)
  if (!currentUser && !offline) { loginScreen(nav); return; }
  if (screen === 'admin') { if (currentUser?.role === 'admin') void adminScreen(nav); else homeScreen(nav); return; }
  if (screen === 'home') homeScreen(nav);
  else if (screen === 'drone') droneScreen(nav);
  else if (screen === 'env') envScreen(nav);
  else if (screen === 'settings') settingsScreen(nav);
  else if (screen === 'mission') missionScreen(nav);
  else if (screen === 'logs') logsScreen(nav);
  else if (screen === 'debrief') debriefScreen(nav, arg as FlightLog);
}

/** Apply an edited mission plan to the running flight (keeps progress if unchanged). */
function reloadMission() {
  const k = JSON.stringify(settings.mission);
  if (k === missionKey) return;
  missionKey = k;
  const ok = settings.mission.poly.length >= 3;
  engine.mission.load(ok ? settings.mission : null, [HOME.x, HOME.y]);
  engine.coverage.setTarget(ok ? settings.mission.poly : []);
  hud.missionChanged();
}

function startFlight() {
  applyPlace();
  engine.start(settings.droneId, settings.env);
  if (!viewsFor().includes(settings.camera.view)) settings.camera.view = 'vlos';
  world.setDrone(engine.drone);
  void world.setEnvironment(settings.env.hdri, settings.env.timeOfDay);
  world.setTimeOfDay(settings.env.timeOfDay);
  world.snap(engine);
  missionKey = JSON.stringify(settings.mission);
  hud.resetTrail(); hud.missionChanged();
  gcsHost.reset(); linkHost.worldChanged();
  keyboardArmReset();
  uiEl.innerHTML = '';
  hud.show(true);
  flying = true; crashTimer = 0; lastViewPos = -1;
  toast(`${engine.drone.name} on the pad. Arm with throttle low. Backspace = reset, M = big map, 4 = AUTO mission.`);
}

async function endFlight() {
  if (!flying) return;
  flying = false;
  closePause();
  const log = engine.finish();
  const where = await saveLog(log);
  toast(where === 'server' ? 'Flight log saved on the training server' : 'Server unreachable — log kept in this browser', where !== 'server');
  hud.show(false);
  nav('debrief', log);
}

engine.mission.onMessage = (text, bad) => {
  toast(text, bad); sound.beep(bad ? 700 : 1500, bad ? 2 : 1, 0.07);
  if (/breakpoint saved/i.test(text)) speak('Breakpoint saved'); else if (/Resuming/.test(text)) speak('Resuming from breakpoint'); else if (/All lanes sprayed/.test(text)) speak('Spraying complete. Returning home'); else if (/Mission start/.test(text)) speak('Mission started');
};
engine.onResetRequest = () => { if (flying) { toast('Reset — back on the pad'); startFlight(); } };
function serviceDrone() {
  if (!flying) return;
  gcs.open('battery'); return;
  if (engine.service()) { toast('Battery swapped and tank refilled. Arm to continue — AUTO resumes from the breakpoint.'); sound.beep(1200, 2); }
  else toast('Land and disarm before changing the battery / refilling', true);
}
engine.onEvent = (code, text) => {
  sound.event(code);
  voiceForEvent(code, engine.modeNames());
  const bad = [6, 7, 8, 9, 10, 14, 15, 19].includes(code) || (code >= 4 && code <= 5) || code === 16 || code === 17 || code === 20;
  if (code === 10) text = `CRASH — ${CRASH_CAUSE[engine.o('CRASH_CAUSE')] ?? ''}`;
  toast(text, bad);
};

// ---------- pause menu (live environment + failure injection) ----------
function closePause() { pauseEl?.remove(); pauseEl = null; engine.paused = false; }
function openPause() {
  if (!flying || pauseEl) return;
  engine.paused = true;
  const e = engine.env, f = engine.fail;
  pauseEl = document.createElement('div'); pauseEl.className = 'pause';
  const VIEWS = viewsFor();
  pauseEl.innerHTML = `<div class="card">
    <div class="row spread"><h2>Paused</h2><span class="muted small">${engine.drone.name}</span></div>
    <div class="row" style="margin-bottom:12px"><button class="primary" id="p-res">Resume</button><button id="p-rst">Restart on pad (Backspace)</button><button id="p-end">End flight &amp; debrief</button><button id="p-home">Quit to home</button></div>
    <div class="row" style="margin-bottom:12px"><button id="p-set">Settings &amp; controller mapping</button><button id="p-mis">Mission planner</button><button id="p-svc">Batteries &amp; tank (B)</button><button id="p-link">Phone / tablet screen (LAN)</button>
      <label class="small"><input type="checkbox" id="p-snd" ${settings.audio.on ? 'checked' : ''}> Sound</label></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
      <div><h3>Drone (restarts on the pad)</h3><select id="p-drone">${DRONES.map((d) => `<option value="${d.id}" ${d.id === engine.drone.id ? 'selected' : ''}>${d.name}</option>`).join('')}</select>
        <div class="field" style="margin-top:8px"><label>Tank fill at start <span class="val" id="pv-tf">${Math.round(settings.env.tankFill * 100)}%</span></label><input type="range" id="p-tf" min="0" max="1" step="0.05" value="${settings.env.tankFill}"></div>
        <button class="small" id="p-apply">Apply &amp; restart</button></div>
      <div><h3>View</h3><select id="p-view">${VIEWS.map((v) => `<option value="${v}" ${settings.camera.view === v ? 'selected' : ''}>${v === 'cam' ? 'CAMERA (gimbal)' : v.toUpperCase()}</option>`).join('')}</select>
        <label class="small"><input type="checkbox" id="p-ha" ${engine.env.holdAssist !== false ? 'checked' : ''}> Hold assist (ALT HOLD / ATTI hold position) — next restart</label>
        <h3 style="margin-top:12px">Wind (live)</h3>
        <div class="field"><label>Speed <span class="val" id="pv-ws">${e.windSpd}</span> m/s</label><input type="range" id="p-ws" min="0" max="14" step="0.5" value="${e.windSpd}"></div>
        <div class="field"><label>From <span class="val" id="pv-wd">${e.windDir}</span>°</label><input type="range" id="p-wd" min="0" max="359" step="5" value="${e.windDir}"></div>
        <div class="field"><label>Gust <span class="val" id="pv-wg">${e.gust}</span>×</label><input type="range" id="p-wg" min="0" max="1.5" step="0.05" value="${e.gust}"></div>
        <div class="field"><label>Turbulence <span class="val" id="pv-wt">${e.turb}</span></label><input type="range" id="p-wt" min="0" max="2" step="0.05" value="${e.turb}"></div></div>
      <div><h3>Failure injection (instructor)</h3>
        <label><input type="checkbox" id="p-gps" ${f.gps ? 'checked' : ''}> GPS loss</label><br>
        <label><input type="checkbox" id="p-rc" ${engine.rcLost ? 'checked' : ''}> RC link loss</label><br>
        <div class="field" style="margin-top:8px"><label>Motor failure</label><select id="p-mot"><option value="0">None</option>${Array.from({ length: engine.drone.nMotors }, (_, i) => `<option value="${i + 1}" ${f.motor === i + 1 ? 'selected' : ''}>Motor ${i + 1}</option>`).join('')}</select></div>
        <div class="field"><label>Compass error <span class="val" id="pv-ce">${f.compassErrDeg}</span>°</label><input type="range" id="p-ce" min="-90" max="90" step="5" value="${f.compassErrDeg}"></div>
        <p class="small muted">Compass error causes "toilet-bowl" circling in LOITER. GPS loss drops LOITER to ALT HOLD, and the drone drifts with the wind.</p></div>
    </div></div>`;
  uiEl.appendChild(pauseEl);
  const q = <T extends HTMLElement>(id: string) => pauseEl!.querySelector<T>('#' + id)!;
  q('p-res').onclick = closePause;
  q('p-rst').onclick = () => { closePause(); startFlight(); };
  q('p-end').onclick = () => endFlight();
  q('p-home').onclick = () => { flying = false; nav('home'); };
  q('p-set').onclick = () => nav('settings');
  q<HTMLInputElement>('p-ha').onchange = (ev) => { settings.env.holdAssist = (ev.target as HTMLInputElement).checked; saveSettings(); };
  q('p-mis').onclick = () => nav('mission');
  q('p-svc').onclick = () => { closePause(); gcs.open('battery'); };
  q('p-link').onclick = () => { linkHost.showPairing(); };
  q<HTMLInputElement>('p-snd').onchange = (ev) => { settings.audio.on = (ev.target as HTMLInputElement).checked; saveSettings(); };
  q<HTMLInputElement>('p-tf').oninput = (ev) => { settings.env.tankFill = +(ev.target as HTMLInputElement).value; q('pv-tf').textContent = `${Math.round(settings.env.tankFill * 100)}%`; saveSettings(); };
  const applyDrone = () => { settings.droneId = q<HTMLSelectElement>('p-drone').value; saveSettings(); closePause(); startFlight(); };
  q<HTMLSelectElement>('p-drone').onchange = applyDrone;
  q('p-apply').onclick = applyDrone;
  q<HTMLSelectElement>('p-view').onchange = (ev) => { settings.camera.view = (ev.target as HTMLSelectElement).value as View; saveSettings(); };
  const wind = () => engine.setWind(+q<HTMLInputElement>('p-ws').value, +q<HTMLInputElement>('p-wd').value, +q<HTMLInputElement>('p-wg').value, +q<HTMLInputElement>('p-wt').value);
  for (const [id, v] of [['p-ws', 'pv-ws'], ['p-wd', 'pv-wd'], ['p-wg', 'pv-wg'], ['p-wt', 'pv-wt']]) {
    q<HTMLInputElement>(id).oninput = (ev) => { q(v).textContent = (ev.target as HTMLInputElement).value; wind(); };
  }
  q<HTMLInputElement>('p-gps').onchange = (ev) => (f.gps = (ev.target as HTMLInputElement).checked);
  q<HTMLInputElement>('p-rc').onchange = (ev) => (engine.rcLost = (ev.target as HTMLInputElement).checked);
  q<HTMLSelectElement>('p-mot').onchange = (ev) => (f.motor = +(ev.target as HTMLSelectElement).value);
  q<HTMLInputElement>('p-ce').oninput = (ev) => { f.compassErrDeg = +(ev.target as HTMLInputElement).value; q('pv-ce').textContent = String(f.compassErrDeg); };
}

onKey((a) => {
  if (!flying) return;
  if (uiEl.querySelector('.screen')) { if (a === 'pause') nav('resume'); return; } // settings/mission open mid-flight
  if (a === 'pause') { if (gcs.isOpen()) gcs.close(); else if (pauseEl) closePause(); else openPause(); }
  if (a === 'view' && !pauseEl) cycleView();
  if (a === 'reset') { closePause(); toast('Reset — back on the pad'); startFlight(); }
  if (a === 'battery') gcs.open('battery');
  if (a === 'gcs') gcs.toggle();
  if (a === 'map' && !pauseEl) hud.toggleBigMap();
  if (a === 'gimbalUp') world.gimbalPitch = Math.min(20, world.gimbalPitch + 5);
  if (a === 'gimbalDown') world.gimbalPitch = Math.max(-90, world.gimbalPitch - 5);
  if (a === 'record') hud.toggleRec();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && flying) openPause(); });

// ---------- main loop ----------
function frame(now: number) {
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
  lastT = now;
  if (flying) {
    engine.frame(now);
    // RC view switch: change view on switch movement
    const vp = engine.sticks.viewPos;
    if (lastViewPos >= 0 && vp !== lastViewPos) cycleView();
    lastViewPos = vp;
    world.update(engine, engine.paused ? 0 : dt);
    // camera drones have no pump: the radio's pump/flow knob drives the gimbal pitch instead
    if (engine.drone.tankCap === 0 && engine.sticks.flow < 0.999) world.gimbalPitch = -90 + engine.sticks.flow * 110;
    // wedding training: never fly over the guests
    hud.overCrowd = overCrowd(engine.o('X'), engine.o('Y'), 2) && engine.o('Z') > 0.5;
    const cp = world.camera.position;
    sound.update(engine, { x: cp.x, y: -cp.z, z: cp.y }, dt);
    hud.update(engine, now);
    linkHost.tick(now);
    gcsBtn.style.display = gcs.isOpen() ? 'none' : 'block';
    if (engine.o('CRASHED') > 0.5) { crashTimer += dt; if (crashTimer > 3) endFlight(); }
    // slow PC warning: sustained low frame rate makes the controls feel laggy
    if (!slowWarned && engine.frameMs > 45 && engine.o('T') > 8 && !document.hidden) {
      slowWarned = true;
      toast(`Low frame rate (${Math.round(1000 / engine.frameMs)} fps) — controls will feel laggy. Try Settings → Display → Low, or the Simple sky environment.`, true);
    }
  } else {
    gcsBtn.style.display = 'none';
    sound.silence();
    // idle background: slow orbit over the farm
    world.camera.position.set(Math.cos(now / 20000) * 70, 28, -40 + Math.sin(now / 20000) * 70);
    world.camera.lookAt(0, 0, -50);
    world.renderer.render(world.scene, world.camera);
  }
  requestAnimationFrame(frame);
}

async function boot() {
  world.setTimeOfDay(settings.env.timeOfDay);
  await engine.init();
  // the 360° scene (20–30 MB) loads in the background; menus are usable immediately
  if (settings.env.hdri && settings.env.hdri !== 'procedural') toast('Loading 360° environment…');
  world.setEnvironment(settings.env.hdri, settings.env.timeOfDay)
    .then(() => { if (world.envId !== 'procedural') toast('360° environment ready'); })
    .catch((e) => { console.error(e); toast('Could not load 360° environment — using simple sky', true); void world.setEnvironment('procedural', settings.env.timeOfDay); });
  await me();
  engine.start(settings.droneId, settings.env);
  world.setDrone(engine.drone);
  window.__sim = { engine, world, state: () => (flying ? (engine.paused ? 'paused' : 'flying') : 'menu'), nav };
  nav('home');
  requestAnimationFrame(frame);
}
let booted = false;
/** Called once by the Next.js page after the DOM shell is mounted. */
export function startApp() {
  if (booted) return;
  booted = true;
  boot().catch((err) => { uiEl.innerHTML = `<div class="screen"><div class="wrap"><h1>Failed to start</h1><pre>${String(err)}</pre></div></div>`; console.error(err); });
}
