import { Engine } from './sim/engine';
import { World3D } from './render/world3d';
import { Hud } from './ui/hud';
import { homeScreen, droneScreen, envScreen, settingsScreen, logsScreen, debriefScreen, setBack } from './ui/screens';
import { missionScreen } from './ui/mission';
import { realMapScreen } from './ui/realmap';
import { popIn, popOut, toastIn, toastOut, bindPressFeedback } from './ui/motion';
import { TRAIL_STYLES, TRAIL_LABEL, type TrailStyle } from './render/trails';
import { setKbFlightLock } from './input/input';
import { LessonRunner, lessonById, ALL_LESSONS as LESSONS } from './lessons/lessons';
import { lessonsScreen, LessonCard, showLessonResult, startLesson } from './ui/lessonUI';
import type { WorldDef } from './data/world';
import { loginScreen, adminScreen } from './ui/account';
import { courseScreen, moduleScreen, quizScreen, checklistsScreen, practicalScreen } from './ui/course';
import { parse, pathFor, crumbsFor, breadcrumbHtml } from './ui/router';
import { setCrumbs } from './ui/screens';
import { loadProgress, saveProgress, progress } from './course/progress';
import { loadLog } from './logs/db';
import { me, logout, currentUser, offline, isGuest } from './auth/client';
import { DroneSound } from './audio/sound';
import { voiceForEvent, speak } from './audio/voice';
import { GcsHost, type Telemetry } from './gcs/host';
import { GcsUI } from './gcs/ui';
import { LinkHost } from './net/linkHost';
import { DRONES } from './data/drones';
import { HOME, setWorld, generateWorld, placeById, WORLD, overCrowd, fenceBreach, BOXES } from './data/world';
import * as THREE from 'three';
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
/** camera drones: lock the gimbal on the subject in the centre of the picture (Spotlight / POI) */
function toggleTrack() {
  if (engine.drone.fc !== 'dji') { toast('Subject tracking is for camera drones'); return; }
  const g = world.gimbal;
  if (g.mode === 'track') { g.mode = 'follow'; g.target = null; engine.yawAssist = null; toast('Tracking off — gimbal Follow'); sound.beep(700, 1, 0.06); return; }
  const canopy = BOXES.find((b) => b.kind === 'canopy' || b.kind === 'stage');
  const fallback = canopy ? new THREE.Vector3(canopy.x, 2, -canopy.y) : world.gimbalPos.clone().add(new THREE.Vector3(30, -world.gimbalPos.y, 0));
  g.lockOnCentre(world.gimbalPos, fallback);
  toast('Tracking subject — fly with the sticks, the camera stays on it (T to release)'); sound.beep(1500, 2, 0.05);
}
let fenceTripped = false;
const sound = new DroneSound();
// ---------- lessons + checkride ----------
const lessons = new LessonRunner();
const lessonCard = new LessonCard(document.getElementById('hud')!);
let aidsBackup: { trailStyle: TrailStyle; groundMarker: boolean; orientArrow: boolean } | null = null;
function restoreAids() { if (aidsBackup) { Object.assign(settings.display, aidsBackup); aidsBackup = null; } }
lessons.onObjectiveDone = (i) => { lessonCard.objectiveDone(i); sound.beep(1760, 2, 0.05); speak('Objective complete', 1500); };
/** beginner course: the first run of an exercise is a demo flown by the autopilot */
let demoNext = false;
function endDemo(skipped: boolean) {
  engine.demoSticks = null; lessons.demo = false; engine.gcsMode = null;
  toast(skipped ? 'Demo skipped — your turn!' : 'That is how it is done. Your turn!');
  speak('Your turn', 0); sound.beep(1320, 2, 0.08);
  void startFlight();
}
(window as unknown as { __skipDemo?: () => void }).__skipDemo = () => { if (lessons.demo) endDemo(true); };
lessons.onFinish = (r) => {
  if (lessons.demo) { setTimeout(() => endDemo(false), 1200); return; } // demo results are never saved
  engine.recorder.header.lesson = { ...r, objectives: r.objectives.map((o) => ({ text: o.text, done: o.done })) };
  void saveProgress({ lessons: { [r.id]: { passed: r.passed, time: r.time, checkride: r.checkride, at: new Date().toISOString() } } });
  speak(r.passed ? 'Lesson passed. Well done' : `Lesson failed. ${r.reason}`, 0);
  sound.beep(r.passed ? 1320 : 400, r.passed ? 3 : 2, 0.1);
  const idx = LESSONS.findIndex((l) => l.id === r.id);
  const next = r.passed && LESSONS[idx + 1] ? LESSONS[idx + 1] : null;
  setTimeout(() => showLessonResult(r, {
    retry: () => void startFlight(), debrief: () => void endFlight(), menu: () => { flying = false; restoreAids(); nav('lessons'); },
    next: next ? () => { flying = false; demoNext = next.track === 'basic'; startLesson(next, nav); } : null,
  }), r.passed ? 600 : 900);
};
// ---------- ground-station tablet (slides up from the bottom; same UI on LAN devices) ----------
const gcsHost = new GcsHost(engine, {
  beep: (f, n, len) => sound.beep(f, n, len), toast: (t, bad) => toast(t, bad),
  missionChanged: () => reloadMission(),
  photo: () => { hud.photo(); sound.beep(2600, 1, 0.03); },
  rec: () => { hud.toggleRec(); sound.beep(hud.recording ? 1200 : 800, 1, 0.08); },
  gimbal: (p) => { if (p !== undefined) { world.gimbalPitch = p; if (world.gimbal.mode === 'track') { world.gimbal.mode = 'follow'; world.gimbal.target = null; } } return world.gimbalPitch; },
  gimbalMode: (m) => { if (m === 'track') { if (world.gimbal.mode !== 'track') toggleTrack(); } else { if (world.gimbal.mode === 'track') toggleTrack(); world.gimbal.mode = m; } return world.gimbal.mode; },
  gimbalState: () => world.gimbal.mode,
  camState: () => hud.camState(),
});
let telCache: Telemetry | null = null, telAt = 0;
const localTel = () => {
  if (!flying) return null;
  const now = performance.now();
  if (!telCache || now - telAt > 100) { telCache = gcsHost.telemetry(false, true); telAt = now; }
  return telCache;
};
const gcs = new GcsUI({ tel: localTel, world: () => (flying ? gcsHost.worldGeo() : null), send: (c) => gcsHost.command(c), video: () => linkHost.aux }, document.body, true);
{
  const h = document.createElement('div'); h.className = 'gcs-handle'; h.title = 'Close (G)'; h.onclick = () => gcs.close();
  gcs.root.prepend(h);
}
const gcsBtn = document.createElement('button');
gcsBtn.className = 'gcs-open-btn'; gcsBtn.textContent = 'Ground station (G)';
gcsBtn.onclick = () => gcs.toggle();
document.body.appendChild(gcsBtn);
const linkHost = new LinkHost(gcsHost, (t, bad) => toast(t, bad));
let missionKey = '';
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => sound.unlock());

declare global { interface Window { __sim?: { engine: Engine; world: World3D; state: () => string; nav: typeof nav } } }

function toast(text: string, bad = false) {
  const d = document.createElement('div');
  d.textContent = text; if (bad) d.className = 'bad';
  toasts.appendChild(d);
  toastIn(d);
  setTimeout(() => toastOut(d), 4000);
  while (toasts.children.length > 5) toasts.firstElementChild!.remove();
}

const VIEWS: View[] = ['vlos', 'chase', 'fpv', 'cam', 'top'];
/** Gimbal camera view only on camera drones (DJI); agri drones use the FPV camera. */
const viewsFor = (): View[] => (engine.drone?.fc === 'dji' ? VIEWS : VIEWS.filter((v) => v !== 'cam'));
function cycleView() { const vs = viewsFor(); settings.camera.view = vs[(vs.indexOf(settings.camera.view) + 1) % vs.length]; saveSettings(); }

/** Build the selected training ground (agri farm / wedding venue) for physics, renderer, map. */
const mapCache = new Map<string, WorldDef>();
/** which ground a lesson uses: beginner + general lessons → training airfield */
function lessonPlace(): { category: 'agri' | 'wedding' | 'training'; seed: number; name: string } | null {
  const l = lessonById(settings.lesson);
  if (!l) return null;
  if (l.kind === 'camera') return { category: 'wedding', seed: 11, name: 'Lawn wedding — mandap' };
  if (l.kind === 'agri') return { category: 'agri', seed: 0, name: 'Home farm (1 ha)' };
  return { category: 'training', seed: 0, name: 'Training airfield' };
}
async function applyPlace(): Promise<void> {
  const lp = lessonPlace();
  if (lp) {
    if (WORLD.category !== lp.category || WORLD.seed !== lp.seed || WORLD.mapId) { setWorld(generateWorld(lp.category, lp.seed, lp.name)); }
    world.rebuildSite();
    return;
  }
  if (settings.place.id.startsWith('map:')) {
    // saved real map (Chhattisgarh): load its ground definition from the server
    const id = settings.place.id.slice(4);
    if (WORLD.mapId !== id) {
      let w = mapCache.get(id);
      if (!w) {
        const r = await fetch(`/api/maps/${id}`).catch(() => null);
        if (!r || !r.ok) { toast('Saved map not available — flying the home farm', true); settings.place = { id: 'agri-classic', category: 'agri', seed: 0 }; saveSettings(); return applyPlace(); }
        w = ((await r.json()) as { world: WorldDef }).world;
        mapCache.set(id, w);
      }
      setWorld(w);
      settings.mission.poly = defaultPlan().poly; saveSettings();
    }
    world.rebuildSite();
    return;
  }
  const pl = settings.place.id === 'custom' ? { category: settings.place.category, seed: settings.place.seed, name: '' } : placeById(settings.place.id);
  if (WORLD.category !== pl.category || WORLD.seed !== pl.seed || WORLD.mapId) {
    setWorld(generateWorld(pl.category, pl.seed, pl.name));
    // keep the mission area on the new field
    settings.mission.poly = defaultPlan().poly; saveSettings();
  }
  world.rebuildSite(); // no-op unless place, crop or grass changed
}

/** Navigate by URL path (links, back/forward, deep links). */
function go(path: string, push = true) {
  const r = parse(path);
  if (r.screen === 'debrief') {
    // deep link to a debrief: load the log (the API only returns the student's own logs)
    void loadLog({ header: { id: r.arg } as FlightLog['header'], summary: {} as FlightLog['summary'], where: 'server' }).then((log) => {
      if (log) nav('debrief', log, push ? 'push' : 'none'); else nav('logs', undefined, 'replace');
    });
    return;
  }
  nav(r.screen, r.arg, push ? 'push' : 'none');
}
window.addEventListener('popstate', () => go(location.pathname, false));
document.addEventListener('click', (ev) => {
  const a = (ev.target as HTMLElement).closest?.('a[data-route]') as HTMLAnchorElement | null;
  if (!a || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return;
  const url = new URL(a.href, location.origin);
  if (url.origin !== location.origin) return; // never route to another site
  ev.preventDefault(); go(url.pathname);
});

function nav(screen: string, arg?: unknown, history: 'push' | 'replace' | 'none' = 'push') {
  closePause();
  // URL + breadcrumbs for the screen we are about to show
  {
    const id = screen === 'debrief' ? (arg as FlightLog | undefined)?.header?.id : typeof arg === 'string' ? arg : undefined;
    const p = pathFor(screen === 'freefly' ? 'fly' : screen, id);
    if (p && history !== 'none' && location.pathname !== p) history === 'replace' ? window.history.replaceState(null, '', p) : window.history.pushState(null, '', p);
    setCrumbs(breadcrumbHtml(crumbsFor(parse(p ?? location.pathname))));
  }
  if (screen === 'freefly') { settings.lesson = null; saveSettings(); screen = 'fly'; }
  const signedIn = !!currentUser || offline || isGuest();
  if (screen === 'fly') { if (!signedIn) { loginScreen(nav); return; } void startFlight(); return; }
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
  else { flying = false; setBack('home', '← Home'); restoreAids(); }
  hud.show(false);
  if (screen === 'logout') { void logout().then(() => { void loadProgress(); window.history.pushState(null, '', '/login'); setCrumbs(''); loginScreen(nav); }); return; }
  // students and instructors sign in, or use guest mode (unless the server is unreachable → local practice)
  if (screen === 'login' || !signedIn) { if (location.pathname !== '/login') window.history.replaceState(null, '', '/login'); setCrumbs(''); loginScreen(nav); return; }
  if (screen === 'admin') { if (currentUser?.role === 'admin') void adminScreen(nav); else homeScreen(nav); return; }
  if (screen === 'home') homeScreen(nav);
  else if (screen === 'drone') droneScreen(nav);
  else if (screen === 'env') envScreen(nav);
  else if (screen === 'settings') settingsScreen(nav);
  else if (screen === 'mission') missionScreen(nav);
  else if (screen === 'realmap') realMapScreen(nav);
  else if (screen === 'lessons') { restoreAids(); lessonsScreen(nav, (withDemo) => { demoNext = withDemo; }); }
  else if (screen === 'logs') logsScreen(nav);
  else if (screen === 'debrief') debriefScreen(nav, arg as FlightLog);
  else if (screen === 'course') courseScreen(nav);
  else if (screen === 'module' && typeof arg === 'string') moduleScreen(nav, arg);
  else if (screen === 'quiz' && typeof arg === 'string') quizScreen(nav, arg);
  else if (screen === 'checklists') checklistsScreen(nav);
  else if (screen === 'practical') practicalScreen(nav);
  else if (screen === 'lesson' && typeof arg === 'string') {
    const l = lessonById(arg);
    if (l) { demoNext = l.track === 'basic' && !progress.lessons[l.id]; startLesson(l, nav); } else homeScreen(nav);
  }
  else homeScreen(nav);
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

async function startFlight() {
  setOrbit(false);
  await applyPlace();
  const lesson = lessonById(settings.lesson);
  const env = { ...settings.env };
  if (lesson) { if (lesson.holdAssist !== undefined) env.holdAssist = lesson.holdAssist; if (lesson.wind !== undefined) env.windSpd = lesson.wind; }
  if (lesson && settings.checkride) {
    // checkride: aids off (restored when leaving the lesson)
    if (!aidsBackup) aidsBackup = { trailStyle: (settings.display.trailStyle ?? 'path') as TrailStyle, groundMarker: settings.display.groundMarker, orientArrow: settings.display.orientArrow };
    Object.assign(settings.display, { trailStyle: 'off', groundMarker: false, orientArrow: false }); env.holdAssist = false;
  } else restoreAids();
  engine.start(settings.droneId, env);
  lessons.start(lesson, engine, !!settings.checkride);
  engine.lockAutoModes = !!lesson;
  if (lesson?.track === 'basic' && demoNext) {
    demoNext = false; lessons.demo = true; engine.gcsMode = 2;
    let lastT = 0;
    engine.demoSticks = (t) => { const dt = lastT ? Math.max(0, Math.min(0.1, t - lastT)) : 0.016; lastT = t; return lessons.basic ? lessons.basic.demo(engine, dt) : {}; };
    toast(`DEMO — watch the sticks (bottom left) and the checklist. Press "Skip demo" to fly yourself.`);
  } else { engine.demoSticks = null; lessons.demo = false; }
  if (lesson) toast(`Lesson ${lesson.n}: ${lesson.title} — ${lesson.brief}`);
  if (!viewsFor().includes(settings.camera.view)) settings.camera.view = 'vlos';
  world.setDrone(engine.drone);
  void world.setEnvironment(settings.env.hdri, settings.env.timeOfDay);
  world.setTimeOfDay(settings.env.timeOfDay);
  world.snap(engine);
  missionKey = JSON.stringify(settings.mission);
  hud.resetTrail(); hud.missionChanged();
  gcsHost.reset();
  keyboardArmReset();
  uiEl.innerHTML = '';
  hud.show(true);
  flying = true; crashTimer = 0; lastViewPos = -1;
  toast(`${engine.drone.name} on the pad. Arm with throttle low. Backspace = reset, M = big map, 4 = AUTO mission.`);
}

async function endFlight() {
  setOrbit(false);
  if (!flying) return;
  flying = false;
  closePause();
  const log = engine.finish();
  if (isGuest()) toast('Guest mode — this flight is not saved');
  else {
    const where = await saveLog(log);
    toast(where === 'server' ? 'Flight log saved on the training server' : 'Server unreachable — log kept in this browser', where !== 'server');
  }
  hud.show(false);
  nav('debrief', log);
}

engine.mission.onMessage = (text, bad) => {
  toast(text, bad); sound.beep(bad ? 700 : 1500, bad ? 2 : 1, 0.07);
  if (/breakpoint saved/i.test(text)) speak('Breakpoint saved'); else if (/Resuming/.test(text)) speak('Resuming from breakpoint'); else if (/All lanes sprayed/.test(text)) speak('Spraying complete. Returning home'); else if (/Mission start/.test(text)) speak('Mission started');
};
engine.onBlocked = (what) => { toast(`${what} is disabled during training lessons — fly it by hand`, true); sound.beep(500, 2, 0.06); };
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
function closePause() { if (pauseEl) popOut(pauseEl); pauseEl = null; engine.paused = false; }
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
        <div class="field" style="margin-bottom:6px"><label>Flight trail (Y)</label><select id="p-tr">${TRAIL_STYLES.map((t) => `<option value="${t}" ${(settings.display.trailStyle ?? 'path') === t ? 'selected' : ''}>${TRAIL_LABEL[t]}</option>`).join('')}</select></div>
        <label class="small"><input type="checkbox" id="p-hd" ${settings.display.hudDetail ? 'checked' : ''}> Detailed telemetry (speed, wind, tank, power, keys) — I</label><br>
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
  popIn(pauseEl);
  const q = <T extends HTMLElement>(id: string) => pauseEl!.querySelector<T>('#' + id)!;
  q('p-res').onclick = closePause;
  q('p-rst').onclick = () => { closePause(); startFlight(); };
  q('p-end').onclick = () => endFlight();
  q('p-home').onclick = () => { flying = false; nav('home'); };
  q('p-set').onclick = () => nav('settings');
  q<HTMLSelectElement>('p-tr').onchange = (ev) => { settings.display.trailStyle = (ev.target as HTMLSelectElement).value as TrailStyle; saveSettings(); };
  q<HTMLInputElement>('p-hd').onchange = (ev) => { settings.display.hudDetail = (ev.target as HTMLInputElement).checked; saveSettings(); };
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

/** Orbit view is only for watching a planned mission while it is being flown. */
const missionWorking = () => engine.o('ARMED') > 0.5 && engine.mission.legs.length > 0 && [3, 4, 5].includes(engine.o('MODE'));
let orbitHint: HTMLDivElement | null = null;
function setOrbit(on: boolean, why = '') {
  if (on === world.orbit.on) return;
  if (on) {
    world.orbit.start(world.dronePos(), world.camera.position);
    orbitHint = document.createElement('div'); orbitHint.className = 'orbit-hint';
    orbitHint.innerHTML = '<b>ORBIT VIEW</b> W A S D move · Q / E rotate · drag look · wheel or Z / X zoom · Shift fast · Tab follow drone · O exit';
    document.body.appendChild(orbitHint);
  } else {
    world.orbit.on = false; orbitHint?.remove(); orbitHint = null;
    if (why) toast(why);
  }
  setKbFlightLock(on);
}
onKey((a) => {
  if (!flying) return;
  if (a === 'orbit' && !pauseEl) {
    if (world.orbit.on) setOrbit(false);
    else if (engine.o('ARMED') > 0.5 && engine.mission.legs.length > 0 && engine.o('MODE') === 5) setOrbit(true);
    else toast('Orbit view works only while a planned mission is flying in AUTO', true);
  }
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
  if (a === 'track') toggleTrack();
  if (a === 'gimbalMode' && engine.drone.fc === 'dji') { const g = world.gimbal; g.mode = g.mode === 'fpv' ? 'follow' : 'fpv'; g.target = null; toast(`Gimbal ${g.mode === 'fpv' ? 'FPV (rolls with the aircraft)' : 'Follow (horizon level)'}`); }
  if (a === 'trail') {
    const cur = (settings.display.trailStyle ?? 'path') as TrailStyle;
    settings.display.trailStyle = TRAIL_STYLES[(TRAIL_STYLES.indexOf(cur) + 1) % TRAIL_STYLES.length]; saveSettings();
    toast(`Trail: ${TRAIL_LABEL[settings.display.trailStyle]}`);
  }
  if (a === 'hud') { hud.toggleHidden(); toast(hud.hidden ? 'HUD hidden — press H to show' : 'HUD shown'); }
  if (a === 'hudDetail') { settings.display.hudDetail = !settings.display.hudDetail; saveSettings(); toast(settings.display.hudDetail ? 'Detailed telemetry on' : 'Detailed telemetry off (I)'); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && flying) openPause(); });

// ---------- main loop ----------
let frameErrors = 0;
/** Main loop. One bad frame (e.g. a HUD bug on an unusual training ground) must never freeze the simulator. */
function frame(now: number) {
  try { frameInner(now); }
  catch (e) {
    console.error('[frame]', e);
    if (frameErrors++ === 0) toast('A display error occurred — the simulation keeps running. Please report it.', true);
  }
  requestAnimationFrame(frame);
}
function frameInner(now: number) {
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
  lastT = now;
  if (flying) {
    engine.frame(now);
    if (world.orbit.on && !missionWorking()) setOrbit(false, 'Orbit view closed — the mission is not running');
    // RC view switch: change view on switch movement
    const vp = engine.sticks.viewPos;
    if (lastViewPos >= 0 && vp !== lastViewPos) cycleView();
    lastViewPos = vp;
    // drone-camera picture: needed by phone screens and by the camera-drone ground station
    world.auxCtx = linkHost.viewers > 0 || (gcs.isOpen() && engine.drone.fc === 'dji') ? linkHost.aux.getContext('2d') : null;
    world.update(engine, engine.paused ? 0 : dt);
    // Spotlight: yaw the aircraft toward the tracked subject (pilot yaw input always wins)
    if (engine.drone.fc === 'dji' && world.gimbal.mode === 'track' && engine.o('ARMED') > 0.5) {
      const err = world.gimbal.aircraftYawError(world.drone!.group.quaternion, world.gimbalPos);
      engine.yawAssist = Math.max(-0.6, Math.min(0.6, -err * 1.4));
    } else engine.yawAssist = null;
    // camera drones have no pump: the radio's pump/flow knob drives the gimbal pitch instead
    if (engine.drone.tankCap === 0 && engine.sticks.flow < 0.999 && world.gimbal.mode !== 'track') world.gimbalPitch = -90 + engine.sticks.flow * 110;
    // wedding training: never fly over the guests
    hud.overCrowd = overCrowd(engine.o('X'), engine.o('Y'), 2) && engine.o('Z') > 0.5;
    // fly area (geofence): > 3 m outside → return home, like an agri FC fence (action RTL)
    {
      const fb = fenceBreach(engine.o('X'), engine.o('Y'));
      if (fb > 3 && engine.o('ARMED') > 0.5 && engine.o('LANDED') < 0.5 && !fenceTripped) {
        fenceTripped = true; engine.gcsMode = 3; engine.guided = null;
        toast('GEOFENCE breach — returning home', true); speak('Geofence breach. Returning home', 0);
        engine.recorder.event(engine.o('T'), 960, 'Geofence breach → RTH');
      }
      if (fb === 0 && engine.o('LANDED') > 0.5) fenceTripped = false;
    }
    const cp = world.camera.position;
    sound.update(engine, { x: cp.x, y: -cp.z, z: cp.y }, dt);
    hud.update(engine, now);
    document.body.classList.toggle('flying', !engine.paused && settings.camera.view !== 'top');
    linkHost.tick(now);
    lessons.update(engine, engine.paused ? 0 : dt);
    lessonCard.update(lessons);
    hud.inLesson = !!lessons.def;
    world.setMarkers(lessons.def ? lessons.markers : [], world.drone?.group.position);
    gcsBtn.style.display = gcs.isOpen() || lessons.def || hud.hidden ? 'none' : 'block';
    if (engine.o('CRASHED') > 0.5) { crashTimer += dt; if (crashTimer > 3) endFlight(); }
    // slow PC warning: sustained low frame rate makes the controls feel laggy
    if (!slowWarned && engine.frameMs > 45 && engine.o('T') > 8 && !document.hidden) {
      slowWarned = true;
      toast(`Low frame rate (${Math.round(1000 / engine.frameMs)} fps) — controls will feel laggy. Try Settings → Display → Low, or the Simple sky environment.`, true);
    }
  } else {
    document.body.classList.remove('flying');
    gcsBtn.style.display = 'none';
    sound.silence();
    // idle background: slow orbit over the farm
    world.camera.position.set(Math.cos(now / 20000) * 70, 28, -40 + Math.sin(now / 20000) * 70);
    world.camera.lookAt(0, 0, -50);
    world.renderer.render(world.scene, world.camera);
  }
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
  await loadProgress();
  engine.start(settings.droneId, settings.env);
  world.setDrone(engine.drone);
  window.__sim = { engine, world, state: () => (flying ? (engine.paused ? 'paused' : 'flying') : 'menu'), nav };
  (window.__sim as unknown as { go: typeof go }).go = go;
  go(location.pathname, false); // deep links: /course/…, /lessons/…, /logs/<id>, …
  requestAnimationFrame(frame);
}
let booted = false;
/** Called once by the Next.js page after the DOM shell is mounted. */
export function startApp() {
  if (booted) return;
  booted = true;
  bindPressFeedback();
  boot().catch((err) => { uiEl.innerHTML = `<div class="screen"><div class="wrap"><h1>Failed to start</h1><pre>${String(err)}</pre></div></div>`; console.error(err); });
}
