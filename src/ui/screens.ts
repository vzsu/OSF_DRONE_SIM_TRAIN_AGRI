// Menu screens: home, drone select, environment, settings (controller calibration), logs, debrief.
import { DRONES, droneById } from '../data/drones';
import { ENV_PRESETS, CRASH_CAUSE, MODES } from '../sim/wasm';
import { HDRIS } from '../render/environment';
import { PLACES } from '../data/world';
import { currentUser, offline } from '../auth/client';
import { settings, saveSettings, profileFor, defaultProfile, exportJson, downloadBlob, STICK_FUNCS, SWITCH_FUNCS, type Func, type Src, type ControllerProfile } from '../settings';
import { listPads, activePad, KEYBOARD_ID, normStick, normThrottle, readSrc, readSticks, type RawPad, type Sticks } from '../input/input';
import { listLogs, deleteLog, loadLog } from '../logs/db';
import { column, toCsv, toJson, type FlightLog } from '../logs/recorder';
import type { TrainingData } from '../logs/score';

const ui = () => document.getElementById('ui')!;
type Nav = (screen: string, arg?: unknown) => void;
let raf = 0;
function stopLoop() { cancelAnimationFrame(raf); }
function loop(fn: () => void) { stopLoop(); const f = () => { fn(); raf = requestAnimationFrame(f); }; raf = requestAnimationFrame(f); }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

let back = { target: 'home', label: '← Home' };
/** Where the screen header's back button goes (home, or back to a paused flight). */
export function setBack(target: string, label: string) { back = { target, label }; }
export const backTarget = () => back.target;

export function mount(html: string): HTMLElement {
  stopLoop();
  ui().innerHTML = `<div class="screen"><div class="wrap">${html}</div></div>`;
  return ui().firstElementChild as HTMLElement;
}
export const header = (title: string) => `<div class="row spread" style="margin-bottom:16px"><h1>${title}</h1><button data-nav="${back.target}">${back.label}</button></div>`;
export function wireNav(root: HTMLElement, nav: Nav) {
  root.querySelectorAll<HTMLElement>('[data-nav]').forEach((b) => b.addEventListener('click', () => nav(b.dataset.nav!)));
}

// ---------------- HOME ----------------
export function homeScreen(nav: Nav) {
  const d = droneById(settings.droneId);
  const pad = activePad();
  const root = mount(`
    <div class="home-hero">
      <h1>OSF Agri Flight Trainer</h1>
      <p class="muted">Practice agricultural drone flying with your own RC transmitter. Flight physics and flight-controller behaviour come first; the graphics are kept simple on purpose.</p>
    </div>
    <div class="row" style="align-items:flex-start;gap:28px">
      <div class="menu">
        <button class="primary" data-nav="fly">▶ Fly — ${esc(d.name)}</button>
        <button data-nav="drone">Select drone</button>
        <button data-nav="mission">Mission planner (AUTO spray)</button>
        <button data-nav="env">Environment &amp; weather</button>
        <button data-nav="settings">Settings &amp; controller calibration</button>
        <button data-nav="logs">Flight logs</button>
        ${currentUser?.role === 'admin' ? '<button data-nav="admin">Admin panel (students)</button>' : ''}
        ${currentUser ? '<button data-nav="logout">Sign out</button>' : ''}
      </div>
      <div class="card" style="min-width:280px;max-width:420px">
        <h3>Session</h3>
        ${currentUser ? `<div class="kv" style="margin-bottom:8px"><span>Signed in</span><span><b>${esc(currentUser.name)}</b> (${currentUser.role === 'admin' ? 'instructor' : 'student'})</span></div>` : `<p class="small bad">${offline ? 'Training server unreachable — practising locally, logs stay in this browser.' : ''}</p><div class="field"><label>Trainee name</label><input id="trainee" value="${esc(settings.trainee)}" placeholder="Name for flight logs"></div>`}
        <div class="kv">
          <span>Drone</span><span>${esc(d.name)}</span>
          <span>Controller</span><span id="ctl">${pad ? esc(pad.id) : 'Keyboard (no RC detected)'}</span>
          <span>Ground</span><span>${esc(settings.place.id === 'custom' ? `${settings.place.category} #${settings.place.seed}` : (PLACES.find((p) => p.id === settings.place.id)?.name ?? ''))}</span>
          <span>Wind</span><span>${settings.env.windSpd} m/s from ${settings.env.windDir}°</span>
          <span>View</span><span>${settings.camera.view.toUpperCase()}</span>
        </div>
        <p class="small muted" style="margin-top:10px">Radiomaster Pocket: plug in by USB-C and choose <b>USB Joystick (HID)</b> on the radio. Then move a stick so the browser detects it.</p>
      </div>
    </div>`);
  wireNav(root, nav);
  root.querySelector<HTMLInputElement>('#trainee')?.addEventListener('input', (e) => { settings.trainee = (e.target as HTMLInputElement).value; saveSettings(); });
  loop(() => { const p = activePad(); const el = root.querySelector('#ctl'); if (el) el.textContent = p ? p.id : 'Keyboard (no RC detected)'; });
}

// ---------------- DRONE SELECT ----------------
export function droneScreen(nav: Nav) {
  const card = (d: (typeof DRONES)[number]) => `
    <div class="card click ${d.id === settings.droneId ? 'sel' : ''}" data-id="${d.id}">
      <div class="row spread"><b>${esc(d.name)}</b><span class="tag">${esc(d.category)}</span></div>
      <div class="muted small">${esc(d.maker)} · ${esc(d.frame)}</div>
      <div style="margin:8px 0">${esc(d.specText)}</div>
      <div class="kv small">
        <span>Mass (no liquid)</span><span>${d.massEmpty} kg</span>
        <span>Tank</span><span>${d.tankCap ? d.tankCap + ' L' : '—'}</span>
        <span>Props</span><span>${d.nMotors} × ${(d.propD / 0.0254).toFixed(0)}"</span>
        <span>Battery</span><span>${d.battS}S ${d.battMah} mAh</span>
        <span>Flight controller</span><span>${d.fc === 'dji' ? 'DJI-style' : 'ArduPilot-style'}</span>
      </div>
      <div class="small muted" style="margin-top:8px">${esc(d.sources)}</div>
    </div>`;
  const root = mount(`${header('Select drone')}
    <p class="muted small">Values marked as estimates need the manufacturer spec sheet. Edit <code>src/data/drones.ts</code> to correct them.</p>
    <div class="grid">${DRONES.map(card).join('')}</div>
    <div class="card" style="margin-top:14px"><div class="field"><label>Tank fill at take-off: <span class="val" id="tfv">${Math.round(settings.env.tankFill * 100)}%</span></label>
    <input type="range" id="tf" min="0" max="1" step="0.05" value="${settings.env.tankFill}"></div></div>`);
  wireNav(root, nav);
  root.querySelectorAll<HTMLElement>('[data-id]').forEach((c) => c.addEventListener('click', () => { settings.droneId = c.dataset.id!; saveSettings(); droneScreen(nav); }));
  const tf = root.querySelector<HTMLInputElement>('#tf')!;
  tf.addEventListener('input', () => { settings.env.tankFill = +tf.value; root.querySelector('#tfv')!.textContent = `${Math.round(+tf.value * 100)}%`; saveSettings(); });
}

// ---------------- ENVIRONMENT ----------------
const ENV_FIELDS: { k: keyof typeof settings.env; label: string; min: number; max: number; step: number; unit: string }[] = [
  { k: 'windSpd', label: 'Mean wind speed (at 10 m)', min: 0, max: 14, step: 0.5, unit: 'm/s' },
  { k: 'windDir', label: 'Wind from (direction)', min: 0, max: 359, step: 1, unit: '°' },
  { k: 'gust', label: 'Gust factor', min: 0, max: 1.5, step: 0.05, unit: '×' },
  { k: 'turb', label: 'Turbulence intensity', min: 0, max: 2, step: 0.05, unit: '' },
  { k: 'temp', label: 'Temperature', min: 0, max: 48, step: 1, unit: '°C' },
  { k: 'elev', label: 'Field elevation', min: 0, max: 3500, step: 50, unit: 'm' },
  { k: 'gpsBaseSats', label: 'GPS satellites (typical)', min: 4, max: 24, step: 1, unit: '' },
  { k: 'battSoc', label: 'Battery charge at start', min: 0.2, max: 1, step: 0.05, unit: '' },
  { k: 'timeOfDay', label: 'Time of day', min: 6, max: 18.5, step: 0.25, unit: 'h' },
];
export function envScreen(nav: Nav) {
  const presets = Object.keys(ENV_PRESETS).map((k) => `<button data-p="${k}">${({ calm: 'Calm', morning: 'Morning breeze', gusty: 'Gusty afternoon', poorGps: 'Poor GPS', hotHigh: 'Hot & high' } as Record<string, string>)[k]}</button>`).join('');
  const envCard = (id: string, name: string, note: string) => `<div class="card click ${settings.env.hdri === id ? 'sel' : ''}" data-hdri="${id}"><b>${esc(name)}</b><div class="small muted">${esc(note)}</div></div>`;
  const pl = settings.place;
  const placeCard = (p: (typeof PLACES)[number]) => `<div class="card click ${pl.id === p.id ? 'sel' : ''}" data-place="${p.id}"><div class="row spread"><b>${esc(p.name)}</b><span class="tag">${p.category === 'agri' ? 'Agri spray' : 'Wedding shoot'}</span></div><div class="small muted">${esc(p.note)}</div></div>`;
  const root = mount(`${header('Environment')}
    <h3>Training ground</h3>
    <p class="small muted"><b>Agri spray</b>: crop field, bunds, tree lines, power lines — spray missions and manual spraying. <b>Wedding shoot</b>: lawn venue with mandap, stage, shamiana tents, guests (no-fly over people) and string lights between poles — use a DJI camera drone and the CAMERA view. Each place is generated from a seed; "Generate new" makes a fresh layout.</p>
    <div class="grid" style="margin-bottom:8px">${PLACES.map(placeCard).join('')}
      <div class="card ${pl.id === 'custom' ? 'sel' : ''}"><b>Generate new place</b><div class="small muted">${pl.id === 'custom' ? `Current: ${pl.category} #${pl.seed}` : 'Random layout'}</div>
        <div class="row" style="margin-top:6px"><button class="small" data-gen="agri">New farm</button><button class="small" data-gen="wedding">New wedding venue</button></div></div></div>
    <label class="small"><input type="checkbox" id="ha" ${settings.env.holdAssist !== false ? 'checked' : ''}> <b>Hold assist</b> — ALT HOLD / ATTI brakes and holds position when sticks are centred (beginner). Switch off to practise real ATTI wind drift.</label>
    <h3 style="margin-top:14px">360° scene (real HDRI scans, CC0 from Poly Haven)</h3>
    <div class="grid" style="margin-bottom:16px">${HDRIS.map((h) => envCard(h.id, h.name, h.note)).join('')}${envCard('procedural', 'Simple sky (fastest)', 'Procedural sky; uses the time-of-day slider. Best for very weak PCs.')}</div>
    <h3>Weather presets</h3>
    <div class="row" style="margin-bottom:14px">${presets}</div>
    <div class="grid">${ENV_FIELDS.map((f) => `<div class="card"><div class="field"><label>${f.label}: <span class="val" id="v-${f.k}"></span></label>
      <input type="range" data-k="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${settings.env[f.k]}"></div></div>`).join('')}</div>
    <p class="muted small" style="margin-top:12px">Air density from temperature and elevation reduces thrust (hot and high = less margin). Wind increases with height (shear), plus gusts and turbulence. Fewer satellites means more GPS drift, and LOITER may refuse to engage.</p>`);
  wireNav(root, nav);
  const show = () => ENV_FIELDS.forEach((f) => {
    const v = settings.env[f.k] as number;
    root.querySelector(`#v-${f.k}`)!.textContent = f.k === 'battSoc' ? `${Math.round(v * 100)}%` : f.k === 'timeOfDay' ? `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}` : `${v} ${f.unit}`;
  });
  show();
  root.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((i) => i.addEventListener('input', () => { (settings.env as any)[i.dataset.k!] = +i.value; saveSettings(); show(); }));
  root.querySelectorAll<HTMLElement>('[data-place]').forEach((c) => c.addEventListener('click', () => { const p = PLACES.find((x) => x.id === c.dataset.place)!; settings.place = { id: p.id, category: p.category, seed: p.seed }; saveSettings(); envScreen(nav); }));
  root.querySelectorAll<HTMLElement>('[data-gen]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); settings.place = { id: 'custom', category: b.dataset.gen as 'agri' | 'wedding', seed: 1000 + Math.floor(Math.random() * 900000) }; saveSettings(); envScreen(nav); }));
  root.querySelector<HTMLInputElement>('#ha')!.addEventListener('change', (e) => { settings.env.holdAssist = (e.target as HTMLInputElement).checked; saveSettings(); });
  root.querySelectorAll<HTMLElement>('[data-hdri]').forEach((c) => c.addEventListener('click', () => { settings.env.hdri = c.dataset.hdri!; saveSettings(); envScreen(nav); }));
  root.querySelectorAll<HTMLElement>('[data-p]').forEach((b) => b.addEventListener('click', () => {
    Object.assign(settings.env, ENV_PRESETS[b.dataset.p!], { hdri: settings.env.hdri, timeOfDay: settings.env.timeOfDay, holdAssist: settings.env.holdAssist }); saveSettings(); envScreen(nav);
  }));
}

// ---------------- SETTINGS ----------------
let settingsTab = 'controller';
export function settingsScreen(nav: Nav) {
  const tabs = [['controller', 'Controller'], ['camera', 'Camera & view'], ['latency', 'Latency'], ['display', 'Display & aids']];
  const root = mount(`${header('Settings')}
    <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === settingsTab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="tab"></div>`);
  wireNav(root, nav);
  root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { settingsTab = b.dataset.tab!; settingsScreen(nav); }));
  const tab = root.querySelector<HTMLElement>('#tab')!;
  if (settingsTab === 'controller') controllerTab(tab, nav);
  else if (settingsTab === 'camera') cameraTab(tab);
  else if (settingsTab === 'latency') latencyTab(tab);
  else displayTab(tab);
}

function slider(id: string, label: string, v: number, min: number, max: number, step: number, fmt: (v: number) => string = String) {
  return `<div class="field"><label>${label}: <span class="val" id="${id}-v">${fmt(v)}</span></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
}
function bindSlider(root: HTMLElement, id: string, set: (v: number) => void, fmt: (v: number) => string = String) {
  const el = root.querySelector<HTMLInputElement>('#' + id)!;
  el.addEventListener('input', () => { set(+el.value); root.querySelector('#' + id + '-v')!.textContent = fmt(+el.value); saveSettings(); });
}

function cameraTab(t: HTMLElement) {
  const c = settings.camera;
  t.innerHTML = `<div class="grid">
    <div class="card"><div class="field"><label>Default view</label><select id="view">
      ${['vlos', 'chase', 'fpv', 'cam', 'top'].map((v) => `<option value="${v}" ${c.view === v ? 'selected' : ''}>${({ vlos: 'VLOS — pilot on the ground', chase: 'Third-person chase', fpv: 'FPV / onboard camera', cam: 'Gimbal camera (DJI camera drones)', top: 'Top-down map' } as Record<string, string>)[v]}</option>`).join('')}
    </select></div>${slider('fov', 'Field of view', c.fov, 30, 90, 1, (v) => v + '°')}
    <label><input type="checkbox" id="vz" ${c.vlosZoom ? 'checked' : ''}> VLOS auto-zoom (binocular aid; real eyes do not zoom)</label></div>
    <div class="card">${slider('px', 'Pilot position east (m)', c.pilotX, -40, 40, 1)}${slider('py', 'Pilot position north (m)', c.pilotY, -40, 40, 1)}${slider('eye', 'Eye height (m)', c.eye, 1.2, 2.2, 0.05)}</div>
    <div class="card">${slider('tilt', 'FPV camera tilt', c.fpvTilt, -60, 20, 1, (v) => v + '°')}<p class="small muted">Press V in flight (or the RC view switch) to cycle views.</p></div></div>`;
  t.querySelector<HTMLSelectElement>('#view')!.addEventListener('change', (e) => { c.view = (e.target as HTMLSelectElement).value as any; saveSettings(); });
  t.querySelector<HTMLInputElement>('#vz')!.addEventListener('change', (e) => { c.vlosZoom = (e.target as HTMLInputElement).checked; saveSettings(); });
  bindSlider(t, 'fov', (v) => (c.fov = v), (v) => v + '°'); bindSlider(t, 'px', (v) => (c.pilotX = v)); bindSlider(t, 'py', (v) => (c.pilotY = v));
  bindSlider(t, 'eye', (v) => (c.eye = v)); bindSlider(t, 'tilt', (v) => (c.fpvTilt = v), (v) => v + '°');
}

function latencyTab(t: HTMLElement) {
  t.innerHTML = `<div class="card">${slider('lk', 'Added RC link delay', settings.latency.linkMs, 0, 300, 5, (v) => v + ' ms')}
    <p class="small muted">The browser reads the transmitter once per screen frame (about 60–144 Hz). The physics runs at 400 Hz. Add link delay to practise with a laggy long-range link. The measured frame time is shown on the flight HUD.</p>
    <div class="kv"><span>Physics rate</span><span>400 Hz fixed step</span><span>Log rate</span><span>50 Hz</span><span>Display refresh</span><span id="fps">measuring…</span></div></div>`;
  bindSlider(t, 'lk', (v) => (settings.latency.linkMs = v), (v) => v + ' ms');
  let n = 0, t0 = performance.now();
  loop(() => { n++; const dt = performance.now() - t0; if (dt > 1000) { const el = t.querySelector('#fps'); if (el) el.textContent = `${(n * 1000 / dt).toFixed(0)} Hz`; n = 0; t0 = performance.now(); } });
}

function displayTab(t: HTMLElement) {
  const d = settings.display;
  t.innerHTML = `<div class="grid"><div class="card">
    <div class="field"><label>Units</label><select id="units"><option value="metric" ${d.units === 'metric' ? 'selected' : ''}>Metric</option><option value="imperial" ${d.units === 'imperial' ? 'selected' : ''}>Imperial</option></select></div>
    <div class="field"><label>Graphics quality</label><select id="q"><option value="high" ${d.quality === 'high' ? 'selected' : ''}>High (shadows)</option><option value="low" ${d.quality === 'low' ? 'selected' : ''}>Low (weak laptops)</option></select></div>
    <p class="small muted">Changing graphics quality takes effect after a page reload.</p>
    <h3 style="margin-top:12px">Sound</h3><label><input type="checkbox" id="snd" ${settings.audio.on ? 'checked' : ''}> Drone sound (rotors, motors, wind, pump, alerts)</label>
    ${slider('vol', 'Volume', settings.audio.volume, 0, 1, 0.05, (v) => Math.round(v * 100) + '%')}</div>
    <div class="card"><h3>Training aids (switch off for checkrides)</h3>
    <label><input type="checkbox" id="oa" ${d.orientArrow ? 'checked' : ''}> Orientation arrow above the drone</label><br>
    <label><input type="checkbox" id="gm" ${d.groundMarker ? 'checked' : ''}> Ground marker under the drone (height cue)</label><br>
    <label><input type="checkbox" id="ss" ${d.showSticks ? 'checked' : ''}> Show stick positions on the HUD</label><br>
    <label><input type="checkbox" id="tr" ${d.trail !== false ? 'checked' : ''}> Flight trail (3D path + map; blue = oldest, yellow = newest)</label></div></div>`;
  const ch = (id: string, f: (v: boolean) => void) => t.querySelector<HTMLInputElement>('#' + id)!.addEventListener('change', (e) => { f((e.target as HTMLInputElement).checked); saveSettings(); });
  ch('snd', (v) => (settings.audio.on = v)); bindSlider(t, 'vol', (v) => (settings.audio.volume = v), (v) => Math.round(v * 100) + '%');
  ch('oa', (v) => (d.orientArrow = v)); ch('gm', (v) => (d.groundMarker = v)); ch('ss', (v) => (d.showSticks = v)); ch('tr', (v) => (d.trail = v));
  t.querySelector<HTMLSelectElement>('#units')!.addEventListener('change', (e) => { d.units = (e.target as HTMLSelectElement).value as any; saveSettings(); });
  t.querySelector<HTMLSelectElement>('#q')!.addEventListener('change', (e) => { d.quality = (e.target as HTMLSelectElement).value as any; saveSettings(); });
}

// ---- controller tab ----
const FUNC_LABEL: Record<Func, string> = { roll: 'Roll (aileron)', pitch: 'Pitch (elevator)', throttle: 'Throttle', yaw: 'Yaw (rudder)', arm: 'Arm switch', mode: 'Flight-mode switch (3-pos)', spray: 'Spray switch', rtl: 'RTL switch', kill: 'Emergency motor stop (kill switch)', flow: 'Pump flow knob (0–100%)', view: 'View switch', reset: 'Reset to pad (momentary button)' };

function controllerTab(t: HTMLElement, nav: Nav) {
  const pads = listPads();
  const sel = settings.activeDevice;
  const pad = activePad();
  const prof = pad ? profileFor(pad.id) : null;
  const opt = (v: string, l: string) => `<option value="${esc(v)}" ${sel === v ? 'selected' : ''}>${esc(l)}</option>`;
  t.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="row"><div class="field" style="flex:1;min-width:240px"><label>Input device</label>
        <select id="dev">${opt('', 'Auto (first connected RC)')}${opt(KEYBOARD_ID, 'Keyboard')}${pads.map((p) => opt(p.id, p.id)).join('')}</select></div>
        <button id="rescan">Rescan</button></div>
      ${pads.length ? '' : '<p class="muted">No RC detected. Connect the radio in <b>USB Joystick (HID)</b> mode, then <b>move a stick</b> (browsers only expose a controller after input).</p>'}
    </div>
    ${prof && pad ? `
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
      <div class="card"><h3>Live channels — ${esc(pad.id)}</h3><div id="chans"></div><div id="btns" style="margin-top:6px"></div></div>
      <div class="card"><h3>Calibration</h3>
        <p class="small muted">${prof.calibrated ? '✔ Calibrated.' : 'Not calibrated yet — run the wizard once per radio and browser.'}</p>
        <div class="row"><button class="primary" id="wiz">Run calibration wizard</button><button id="reset">Reset to defaults</button></div>
        <div class="row" style="margin-top:8px"><button class="small" id="exp">Export profile</button><label class="small"><input type="file" id="imp" accept=".json" style="display:none"><span class="tag" style="cursor:pointer">Import profile</span></label></div>
        <div style="margin-top:12px">${slider('db', 'Stick deadband', prof.deadband, 0, 0.15, 0.005, (v) => (v * 100).toFixed(1) + '%')}
        ${slider('ex', 'Expo', prof.expo, 0, 0.8, 0.05)}${slider('rt', 'Rate', prof.rate, 0.5, 1.2, 0.05)}</div>
        <div class="field"><label>Stick mode (for reference/keyboard)</label><select id="sm"><option value="2" ${prof.stickMode === 2 ? 'selected' : ''}>Mode 2 (throttle left)</option><option value="1" ${prof.stickMode === 1 ? 'selected' : ''}>Mode 1 (throttle right)</option></select></div>
        <div class="field"><label>Arming method</label><select id="am"><option value="switch" ${prof.armMethod === 'switch' ? 'selected' : ''}>Arm switch</option><option value="gesture" ${prof.armMethod === 'gesture' ? 'selected' : ''}>Stick gesture (throttle low + yaw right 1.5 s)</option></select></div>
        <div class="row">${[0, 1, 2].map((i) => `<div class="field"><label>Mode switch pos ${i + 1}</label><select data-mp="${i}">${MODES.map((m, k) => `<option value="${k}" ${prof.modePositions[i] === k ? 'selected' : ''}>${m}</option>`).join('')}</select></div>`).join('')}</div>
      </div>
      <div class="card" style="grid-column:1/-1"><h3>Radio layout — what each control does (live)</h3>
        <div class="row" style="align-items:flex-start;gap:20px">${pocketSvg(prof)}
        <div class="small" style="max-width:360px;line-height:1.6"><b>Radiomaster Pocket</b>: SA and SD are 2-position, SB and SC 3-position, SE a momentary button.
          Move any stick or switch: its function lights up on the diagram.<br><br>
          <b>Suggested EdgeTX mixer</b> (Model → Mixes):<br>CH5 ← SA: <b>ARM</b><br>CH6 ← SB: <b>flight mode</b> (up / mid / down = positions 1/2/3 above — set one to AUTO for missions)<br>
          CH7 ← SC: <b>spray</b><br>CH8 ← SD: <b>RTL</b><br>SE → mix to a free channel for <b>reset to pad</b> or <b>kill</b> (USB joystick mode exposes 8 channels; EdgeTX "Advanced" joystick mode gives more).<br>
          Then set the "On radio" column below so the diagram matches your radio.</div></div></div>
      <div class="card" style="grid-column:1/-1"><h3>Channel mapping</h3><table><tr><th>Function</th><th>On radio</th><th>Source</th><th>Index</th><th>Reverse</th><th>Live</th></tr>
        ${[...STICK_FUNCS, ...SWITCH_FUNCS].map((f) => mapRow(f, prof.map[f] ?? { kind: 'none', index: 0, reverse: false, min: -1, center: 0, max: 1 }, pad, prof)).join('')}</table></div>
    </div>` : '<div class="card"><h3>Keyboard (Mode 2)</h3><p>W/S throttle · A/D yaw · arrow keys pitch/roll · Enter arm/disarm · 1/2/3 mode switch (1 STABILIZE, 2 ALT HOLD, 3 LOITER) · Space spray · [ ] pump flow · K emergency stop · R RTL · V view · Esc pause</p></div>'}`;
  t.querySelector<HTMLSelectElement>('#dev')!.addEventListener('change', (e) => { settings.activeDevice = (e.target as HTMLSelectElement).value; saveSettings(); settingsScreen(nav); });
  t.querySelector('#rescan')!.addEventListener('click', () => settingsScreen(nav));
  if (!prof || !pad) { let n = pads.length; loop(() => { if (listPads().length !== n) { n = listPads().length; settingsScreen(nav); } }); return; }
  bindSlider(t, 'db', (v) => (prof.deadband = v), (v) => (v * 100).toFixed(1) + '%');
  bindSlider(t, 'ex', (v) => (prof.expo = v)); bindSlider(t, 'rt', (v) => (prof.rate = v));
  t.querySelector<HTMLSelectElement>('#sm')!.addEventListener('change', (e) => { prof.stickMode = +(e.target as HTMLSelectElement).value as 1 | 2; saveSettings(); });
  t.querySelector<HTMLSelectElement>('#am')!.addEventListener('change', (e) => { prof.armMethod = (e.target as HTMLSelectElement).value as any; saveSettings(); });
  t.querySelectorAll<HTMLSelectElement>('[data-mp]').forEach((s) => s.addEventListener('change', () => { prof.modePositions[+s.dataset.mp!] = +s.value; saveSettings(); }));
  t.querySelectorAll<HTMLElement>('[data-map]').forEach((row) => {
    const f = row.dataset.map as Func;
    row.querySelector<HTMLSelectElement>('.kind')!.addEventListener('change', (e) => { prof.map[f].kind = (e.target as HTMLSelectElement).value as Src['kind']; saveSettings(); });
    row.querySelector<HTMLInputElement>('.idx')!.addEventListener('change', (e) => { prof.map[f].index = +(e.target as HTMLInputElement).value; saveSettings(); });
    row.querySelector<HTMLInputElement>('.rev')!.addEventListener('change', (e) => { prof.map[f].reverse = (e.target as HTMLInputElement).checked; saveSettings(); });
    row.querySelector<HTMLSelectElement>('.phys')!.addEventListener('change', (e) => { (prof.phys ??= {})[f] = (e.target as HTMLSelectElement).value; saveSettings(); settingsScreen(nav); });
  });
  t.querySelector('#wiz')!.addEventListener('click', () => calibrationWizard(pad.id, () => settingsScreen(nav)));
  t.querySelector('#reset')!.addEventListener('click', () => { settings.profiles[pad.id] = defaultProfile(pad.id); saveSettings(); settingsScreen(nav); });
  t.querySelector('#exp')!.addEventListener('click', () => exportJson(prof, 'controller-profile.json'));
  t.querySelector<HTMLInputElement>('#imp')!.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    try { const p = JSON.parse(await f.text()) as ControllerProfile; settings.profiles[pad.id] = { ...defaultProfile(pad.id), ...p, deviceId: pad.id }; saveSettings(); settingsScreen(nav); } catch { alertBox('Invalid profile file'); }
  });
  let prevSt: Sticks | null = null;
  const hotUntil: Partial<Record<Func, number>> = {};
  const val = (x: Sticks, f: Func): number => ({ roll: x.roll, pitch: x.pitch, throttle: x.thr, yaw: x.yaw, arm: x.arm, mode: x.modePos, spray: +x.spray, rtl: +x.rtl, kill: +x.kill, flow: x.flow, view: x.viewPos, reset: +x.reset } as Record<Func, number>)[f];
  loop(() => {
    const p = listPads().find((x) => x.id === pad.id);
    if (!p) return;
    // radio diagram: light up the functions that move
    const st = readSticks(false), now = performance.now();
    if (prevSt) for (const f of [...STICK_FUNCS, ...SWITCH_FUNCS]) if (Math.abs(val(st, f) - val(prevSt, f)) > 0.08) hotUntil[f] = now + 700;
    prevSt = st;
    t.querySelectorAll<SVGElement>('[data-fn]').forEach((el) => { const fs = (el.dataset.fn ?? '').split(','); el.classList.toggle('hot', fs.some((f) => (hotUntil[f as Func] ?? 0) > now)); });
    const dot = (id: string, x: number, y: number) => { const c = t.querySelector<SVGCircleElement>('#' + id); if (c) { c.setAttribute('cx', String(+c.dataset.cx! + x * 42)); c.setAttribute('cy', String(+c.dataset.cy! - y * 42)); } };
    if (prof.stickMode === 2) { dot('pk-l', st.yaw, st.thr * 2 - 1); dot('pk-r', st.roll, st.pitch); } else { dot('pk-l', st.yaw, st.pitch); dot('pk-r', st.roll, st.thr * 2 - 1); }
    const ch = t.querySelector('#chans'); if (!ch) return;
    ch.innerHTML = p.axes.map((v, i) => `<div class="chan"><span>Axis ${i}</span><div class="bar"><b></b><i style="left:${v < 0 ? 50 + v * 50 : 50}%;width:${Math.abs(v) * 50}%"></i></div><span>${v.toFixed(2)}</span></div>`).join('');
    t.querySelector('#btns')!.innerHTML = p.buttons.map((b, i) => `<span class="btnlamp ${b ? 'on' : ''}">${i}</span>`).join('');
    t.querySelectorAll<HTMLElement>('[data-map]').forEach((row) => {
      const f = row.dataset.map as Func, s = prof.map[f];
      const raw = readSrc(p, s);
      const v = f === 'throttle' ? normThrottle(raw, s) : normStick(raw, s);
      row.querySelector('.live')!.textContent = s.kind === 'none' ? '—' : v.toFixed(2);
    });
  });
}

const PHYS = ['', 'SA', 'SB', 'SC', 'SD', 'SE', 'S1', 'S2', 'Left stick ↕', 'Left stick ↔', 'Right stick ↕', 'Right stick ↔'];
const SHORT: Record<Func, string> = { roll: 'ROLL', pitch: 'PITCH', throttle: 'THROTTLE', yaw: 'YAW', arm: 'ARM', mode: 'MODE', spray: 'SPRAY', rtl: 'RTL', kill: 'KILL', flow: 'PUMP', view: 'VIEW', reset: 'RESET' };

/** Radiomaster Pocket outline with the functions mapped to each physical control. */
function pocketSvg(prof: ControllerProfile): string {
  const phys = prof.phys ?? {};
  const on = (name: string) => (Object.keys(phys) as Func[]).filter((f) => phys[f] === name && prof.map[f]?.kind !== 'none');
  const names = (name: string) => on(name).map((f) => SHORT[f]).join(' + ') || '—';
  const sw = (name: string, x: number, pos: number) =>
    `<rect class="sw" data-fn="${on(name).join(',')}" x="${x - 9}" y="22" width="18" height="34" rx="4"/>` +
    `<text x="${x}" y="16" text-anchor="middle" fill="#9fb0a9" font-size="11">${name} ${pos}-pos</text>` +
    `<text x="${x}" y="72" text-anchor="middle" class="fn" data-fn="${on(name).join(',')}">${names(name)}</text>`;
  const gimbal = (k: string, cx: number) => {
    const v = k === 'l' ? 'Left stick ↕' : 'Right stick ↕', h = k === 'l' ? 'Left stick ↔' : 'Right stick ↔';
    return `<circle cx="${cx}" cy="190" r="56" fill="#111816" stroke="#4a5853"/>` +
      `<line x1="${cx - 50}" y1="190" x2="${cx + 50}" y2="190" stroke="#2c3a35"/><line x1="${cx}" y1="140" x2="${cx}" y2="240" stroke="#2c3a35"/>` +
      `<circle id="pk-${k}" data-cx="${cx}" data-cy="190" cx="${cx}" cy="190" r="9" fill="#e8641b"/>` +
      `<text x="${cx}" y="128" text-anchor="middle" class="fn" data-fn="${on(v).join(',')}">↕ ${names(v)}</text>` +
      `<text x="${cx + (k === 'l' ? -62 : 62)}" y="194" text-anchor="${k === 'l' ? 'end' : 'start'}" class="fn" data-fn="${on(h).join(',')}">↔ ${names(h)}</text>`;
  };
  return `<svg class="pocket" viewBox="0 0 560 290">
    <rect x="20" y="40" width="520" height="230" rx="60" fill="#1b2220" stroke="#4a5853" stroke-width="2"/>
    ${sw('SA', 70, 2)}${sw('SB', 150, 3)}${sw('SC', 410, 3)}${sw('SD', 490, 2)}
    <circle class="sw" data-fn="${on('SE').join(',')}" cx="230" cy="40" r="10"/>
    <text x="230" y="70" text-anchor="middle" fill="#9fb0a9" font-size="11">SE button</text>
    <text x="230" y="86" text-anchor="middle" class="fn" data-fn="${on('SE').join(',')}">${names('SE')}</text>
    <rect x="245" y="120" width="70" height="50" rx="6" fill="#0c110f" stroke="#4a5853"/><text x="280" y="150" text-anchor="middle" fill="#6f7f79" font-size="11">screen</text>
    ${gimbal('l', 140)}${gimbal('r', 420)}
    <text x="280" y="262" text-anchor="middle" fill="#6f7f79" font-size="11">Stick mode ${prof.stickMode} · arm by ${prof.armMethod === 'switch' ? 'switch' : 'stick gesture'}</text>
  </svg>`;
}

function mapRow(f: Func, s: Src, pad: RawPad, prof?: ControllerProfile) {
  const ph = prof?.phys?.[f] ?? '';
  return `<tr data-map="${f}"><td>${FUNC_LABEL[f]}</td>
    <td><select class="phys">${PHYS.map((n) => `<option value="${n}" ${n === ph ? 'selected' : ''}>${n || '—'}</option>`).join('')}</select></td>
    <td><select class="kind"><option value="axis" ${s.kind === 'axis' ? 'selected' : ''}>Axis</option><option value="button" ${s.kind === 'button' ? 'selected' : ''}>Button</option><option value="none" ${s.kind === 'none' ? 'selected' : ''}>None</option></select></td>
    <td><input class="idx" type="number" min="0" max="${Math.max(pad.axes.length, pad.buttons.length)}" value="${s.index}" style="width:64px"></td>
    <td><input class="rev" type="checkbox" ${s.reverse ? 'checked' : ''}></td><td class="live" style="font-family:var(--mono)">—</td></tr>`;
}

function alertBox(msg: string) {
  const d = document.createElement('div'); d.className = 'pause';
  d.innerHTML = `<div class="card"><p>${esc(msg)}</p><button>OK</button></div>`;
  d.querySelector('button')!.onclick = () => d.remove();
  ui().appendChild(d);
}

// ---- calibration wizard ----
export function calibrationWizard(deviceId: string, done: () => void) {
  const prof = profileFor(deviceId);
  const box = document.createElement('div'); box.className = 'pause';
  box.innerHTML = `<div class="card wizard"><h2>Controller calibration</h2><div id="w-body"></div>
    <div class="row" style="margin-top:14px"><button id="w-next" class="primary">Next</button><button id="w-skip">Skip this step</button><button id="w-cancel">Cancel</button></div></div>`;
  ui().appendChild(box);
  const body = box.querySelector<HTMLElement>('#w-body')!;
  const get = () => listPads().find((p) => p.id === deviceId);
  let rest: number[] = [], restB: boolean[] = [], mins: number[] = [], maxs: number[] = [];
  const assigned = new Set<string>();
  const map: Partial<Record<Func, Src>> = {};
  let step = 0, detect: { f: Func; dir: string } | null = null, waitReturn = false;
  const stickSteps: { f: Func; dir: string }[] = [
    { f: 'throttle', dir: 'Push THROTTLE fully UP' }, { f: 'yaw', dir: 'Push YAW (rudder) fully RIGHT' },
    { f: 'pitch', dir: 'Push PITCH (elevator) fully FORWARD / UP' }, { f: 'roll', dir: 'Push ROLL (aileron) fully RIGHT' },
  ];
  const switchSteps: { f: Func; dir: string }[] = [
    { f: 'arm', dir: 'Flip your ARM switch to the ARMED position' }, { f: 'mode', dir: 'Move your FLIGHT-MODE switch to the BOTTOM position' },
    { f: 'spray', dir: 'Flip your SPRAY switch ON' }, { f: 'rtl', dir: 'Flip your RTL switch ON' },
    { f: 'kill', dir: 'Flip your EMERGENCY STOP (kill) switch ON' }, { f: 'flow', dir: 'Turn your PUMP FLOW knob to MAXIMUM' }, { f: 'view', dir: 'Flip a switch to use for CAMERA VIEW' },
    { f: 'reset', dir: 'Press the button for RESET TO PAD (Pocket: SE, if mixed to a channel)' },
  ];
  const steps = ['rest', 'range', ...stickSteps.map((s) => 's:' + s.f), ...switchSteps.map((s) => 'w:' + s.f), 'done'];
  const close = () => { clearInterval(wr); box.remove(); done(); };
  box.querySelector('#w-cancel')!.addEventListener('click', close);
  const next = () => {
    const p = get();
    const cur = steps[step];
    if (cur === 'rest' && p) { rest = [...p.axes]; restB = [...p.buttons]; mins = [...p.axes]; maxs = [...p.axes]; }
    if (cur === 'done') {
      for (const f of Object.keys(map) as Func[]) prof.map[f] = map[f]!;
      for (const f of STICK_FUNCS) {
        const s = prof.map[f];
        if (s.kind === 'axis') {
          s.min = mins[s.index] ?? -1; s.max = maxs[s.index] ?? 1;
          s.center = f === 'throttle' ? (s.min + s.max) / 2 : rest[s.index] ?? 0;
          if (s.max - s.min < 0.2) { s.min = -1; s.max = 1; }
        }
      }
      for (const f of SWITCH_FUNCS) { const s = prof.map[f]; if (s.kind === 'axis') { s.min = mins[s.index] ?? -1; s.max = maxs[s.index] ?? 1; s.center = (s.min + s.max) / 2; } }
      prof.calibrated = true; saveSettings(); close(); return;
    }
    step++; detect = null; waitReturn = false; render();
  };
  box.querySelector('#w-next')!.addEventListener('click', next);
  box.querySelector('#w-skip')!.addEventListener('click', () => {
    const cur = steps[step];
    if (cur.startsWith('w:')) map[cur.slice(2) as Func] = { kind: 'none', index: 0, reverse: false, min: -1, center: 0, max: 1 };
    if (cur === 'w:arm') prof.armMethod = 'gesture';
    next();
  });
  const render = () => {
    const cur = steps[step];
    if (cur === 'rest') body.innerHTML = `<p>Centre the roll, pitch and yaw sticks. Put the <b>throttle fully DOWN</b> and all switches in their <b>first (up/off) position</b>.</p><div class="big">Then press Next</div>`;
    else if (cur === 'range') body.innerHTML = `<p>Move <b>both sticks in full circles</b> 3 times, and move every switch through all its positions.</p><div class="big">Then return sticks to centre, throttle low → Next</div><div id="w-live" class="small muted"></div>`;
    else if (cur === 'done') body.innerHTML = `<p>Calibration complete.</p><div class="big">Press Next to save</div>`;
    else {
      const st = [...stickSteps, ...switchSteps].find((s) => cur.slice(2) === s.f)!;
      detect = st;
      body.innerHTML = `<p>Step ${step - 1} of ${stickSteps.length + switchSteps.length}</p><div class="big">${st.dir}</div><p id="w-det" class="muted">Waiting for movement…</p>`;
    }
  };
  let wr: ReturnType<typeof setInterval>; // timer, not rAF: keeps polling even if the tab is throttled
  const watch = () => {
    const p = get();
    if (p) {
      p.axes.forEach((v, i) => { mins[i] = Math.min(mins[i] ?? v, v); maxs[i] = Math.max(maxs[i] ?? v, v); });
      const live = body.querySelector('#w-live'); if (live) live.textContent = p.axes.map((v, i) => `A${i}: ${v.toFixed(2)}`).join('  ');
      if (detect && !waitReturn) {
        let best = -1, bestD = 0, kind = 'axis' as 'axis' | 'button';
        p.axes.forEach((v, i) => { const d = v - (rest[i] ?? 0); if (!assigned.has('a' + i) && Math.abs(d) > Math.abs(bestD)) { bestD = d; best = i; } });
        const isSwitch = SWITCH_FUNCS.includes(detect.f);
        if (Math.abs(bestD) < 0.5 && isSwitch) {
          p.buttons.forEach((b, i) => { if (!assigned.has('b' + i) && b !== (restB[i] ?? false)) { best = i; bestD = b ? 1 : -1; kind = 'button'; } });
        }
        if (best >= 0 && (kind === 'button' || Math.abs(bestD) > 0.5)) {
          // throttle UP should read +, other sticks right/forward = +; switches: target position = +
          const reverse = bestD < 0;
          const f = detect.f;
          if (f === 'mode') {
            // bottom position should map to position 3 (index 2) → positive
            map[f] = { kind, index: best, reverse, min: -1, center: 0, max: 1 };
          } else map[f] = { kind, index: best, reverse, min: -1, center: 0, max: 1 };
          assigned.add((kind === 'axis' ? 'a' : 'b') + best);
          const det = body.querySelector('#w-det');
          if (det) det.textContent = `Detected ${kind} ${best}${reverse ? ' (reversed)' : ''}. ${isSwitch ? 'Return the switch' : 'Return the stick'} and press Next.`;
          waitReturn = true;
        }
      }
    }
  };
  render(); wr = setInterval(watch, 30);
}

// ---------------- LOGS ----------------
export async function logsScreen(nav: Nav) {
  const root = mount(`${header('Flight logs')}<div class="card" id="list">Loading…</div>`);
  wireNav(root, nav);
  const logs = await listLogs();
  const list = root.querySelector<HTMLElement>('#list')!;
  if (!logs.length) { list.innerHTML = '<p class="muted">No flights recorded yet.</p>'; return; }
  const offline = logs.some((l) => l.where === 'browser');
  list.innerHTML = `${offline ? '<p class="small muted">Some flights are stored only in this browser (server unreachable). They upload automatically when the server is back.</p>' : '<p class="small muted">Logs are stored on the training server and shared with every PC on the network.</p>'}
    <table><tr><th>Date</th><th>Trainee</th><th>Drone</th><th>Flight time</th><th>Max alt</th><th>Score</th><th>Result</th><th>Stored</th><th></th></tr>
    ${logs.map((l) => `<tr><td>${new Date(l.header.startedAt).toLocaleString()}</td><td>${esc(l.header.trainee)}</td><td>${esc(l.header.drone.name)}</td>
    <td>${fmtTime(l.summary.flightTime)}</td><td>${l.summary.maxAlt.toFixed(1)} m</td><td>${l.summary.score ?? '—'}</td><td class="${l.summary.result === 'Crash' ? 'bad' : ''}">${l.summary.result}${l.summary.crashCause ? ' — ' + CRASH_CAUSE[l.summary.crashCause] : ''}</td>
    <td><span class="tag">${l.where}</span></td>
    <td><button class="small" data-open="${l.header.id}">Open</button> <button class="small danger" data-del="${l.header.id}">Delete</button></td></tr>`).join('')}</table>`;
  const byId = (id: string) => logs.find((l) => l.header.id === id)!;
  list.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => b.addEventListener('click', async () => {
    b.textContent = 'Loading…';
    const log = await loadLog(byId(b.dataset.open!));
    if (log) nav('debrief', log); else { b.textContent = 'Failed'; }
  }));
  // two-step delete (no browser confirm dialog): first click arms, second click deletes
  list.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirm delete'; setTimeout(() => { b.dataset.armed = ''; b.textContent = 'Delete'; }, 3000); return; }
    await deleteLog(byId(b.dataset.del!)); logsScreen(nav);
  }));
}
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------- DEBRIEF ----------------
export function debriefScreen(nav: Nav, log: FlightLog) {
  const s = log.summary;
  const root = mount(`${header('Flight debrief')}
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
      <div class="card"><h3>Summary</h3><div class="kv">
        <span>Trainee</span><span>${esc(log.header.trainee)}</span><span>Drone</span><span>${esc(log.header.drone.name)}</span>
        <span>Result</span><span class="${s.result === 'Crash' ? 'bad' : ''}">${s.result}${s.crashCause ? ' — ' + CRASH_CAUSE[s.crashCause] : ''}</span>
        <span>Flight time</span><span>${fmtTime(s.flightTime)}</span><span>Max altitude</span><span>${s.maxAlt.toFixed(1)} m</span>
        <span>Max speed</span><span>${s.maxSpeed.toFixed(1)} m/s</span><span>Distance</span><span>${s.distance.toFixed(0)} m</span>
        <span>Battery used</span><span>${s.mahUsed.toFixed(0)} mAh</span><span>Sprayed</span><span>${s.sprayedL.toFixed(1)} L</span>
        <span>Wind</span><span>${log.header.env.windSpd} m/s from ${log.header.env.windDir}° (gust ×${log.header.env.gust})</span>
        <span>Warnings</span><span>${s.warnings}</span><span>Controller</span><span>${esc(log.header.controller)}</span>
      </div>
      <div class="row" style="margin-top:12px"><button class="primary" data-nav="fly">Fly again</button><button id="csv">Export CSV</button><button id="json">Export JSON</button></div></div>
      ${scoreCard(log.training)}
      <div class="card"><h3>Events</h3><div style="max-height:260px;overflow:auto"><table>${log.events.map((e) => `<tr><td style="font-family:var(--mono)">${e.t.toFixed(1)} s</td><td>${esc(e.text)}</td></tr>`).join('') || '<tr><td class="muted">No events</td></tr>'}</table></div></div>
    </div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(420px,1fr));margin-top:12px">
      <div class="card"><h3>Altitude AGL (m)</h3><canvas class="chart" id="c-alt"></canvas></div>
      <div class="card"><h3>Ground speed (m/s) · wind at drone (m/s)</h3><canvas class="chart" id="c-spd"></canvas></div>
      <div class="card"><h3>Battery voltage (V)</h3><canvas class="chart" id="c-bat"></canvas></div>
      <div class="card"><h3>Stick inputs: throttle · roll · pitch · yaw</h3><canvas class="chart" id="c-stk"></canvas></div>
    </div>`);
  wireNav(root, nav);
  const t = column(log, 't');
  const wx = column(log, 'wind_x'), wy = column(log, 'wind_y');
  const wind = wx.map((v, i) => Math.hypot(v, wy[i]));
  chart(root.querySelector('#c-alt')!, t, [[column(log, 'agl'), '#e8641b']]);
  chart(root.querySelector('#c-spd')!, t, [[column(log, 'gnd_speed'), '#3ccf7a'], [wind, '#4ea3ff']]);
  chart(root.querySelector('#c-bat')!, t, [[column(log, 'batt_v'), '#f2c230']]);
  chart(root.querySelector('#c-stk')!, t, [[column(log, 'rc_thr'), '#e8641b'], [column(log, 'rc_roll'), '#3ccf7a'], [column(log, 'rc_pitch'), '#4ea3ff'], [column(log, 'rc_yaw'), '#d070ff']]);
  const base = `flight-${log.header.trainee.replace(/\W+/g, '_')}-${log.header.startedAt.slice(0, 19).replace(/[:T]/g, '-')}`;
  root.querySelector('#csv')!.addEventListener('click', () => downloadBlob(new Blob([toCsv(log)], { type: 'text/csv' }), base + '.csv'));
  root.querySelector('#json')!.addEventListener('click', () => exportJson(toJson(log), base + '.json'));
}

function scoreCard(tr?: TrainingData): string {
  if (!tr) return '<div class="card"><h3>Training score</h3><p class="muted small">Not available for flights recorded before v0.3.</p></div>';
  const sc = tr.score;
  const col = (v: number) => (v >= 80 ? '#3ccf7a' : v >= 55 ? '#f2c230' : '#ff5a4a');
  const cov = tr.coverage;
  return `<div class="card"><h3>Training score</h3>
    <div class="row" style="align-items:center;gap:16px"><span class="score-big" style="color:${col(sc.total)}">${sc.total}</span><b>${esc(sc.grade)}</b></div>
    <table>${sc.items.map((i) => `<tr class="score-row" title="${esc(i.hint)}"><td>${esc(i.name)}</td><td style="font-family:var(--mono)">${esc(i.value)}</td>
      <td>${i.weight ? `<span class="score-bar"><i style="width:${i.score}%;background:${col(i.score)}"></i></span> ${i.score}` : '<span class="muted small">info</span>'}</td></tr>
      <tr><td colspan="3" class="small muted" style="padding:0 6px 6px">${esc(i.hint)}</td></tr>`).join('')}</table>
    ${tr.mission ? `<p class="small">Mission: ${tr.mission.lanesDone}/${tr.mission.lanes} lanes · ${tr.mission.height} m · ${tr.mission.speed} m/s</p>` : ''}
    ${cov?.img ? `<h3 style="margin-top:10px">Spray coverage map</h3><img src="${cov.img}" alt="coverage map" style="width:100%;max-width:320px;image-rendering:pixelated;background:#26301f;border-radius:6px">
      <p class="small muted">Blue = sprayed once · amber = overlap (double dose) · red = off-target / drift · faint = planned area not sprayed.</p>` : ''}
  </div>`;
}

function chart(c: HTMLCanvasElement, t: Float32Array, series: [ArrayLike<number>, string][]) {
  const dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth * dpr, H = c.clientHeight * dpr;
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  if (t.length < 2) return;
  let lo = Infinity, hi = -Infinity;
  for (const [d] of series) for (let i = 0; i < d.length; i++) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const pad = 26 * dpr, t0 = t[0], t1 = t[t.length - 1];
  const X = (v: number) => pad + (v - t0) / (t1 - t0) * (W - pad - 6 * dpr), Y = (v: number) => H - 14 * dpr - (v - lo) / (hi - lo) * (H - 24 * dpr);
  g.strokeStyle = '#2c3a35'; g.fillStyle = '#8fa39b'; g.font = `${10 * dpr}px monospace`; g.lineWidth = 1;
  for (const v of [lo, (lo + hi) / 2, hi]) { g.beginPath(); g.moveTo(pad, Y(v)); g.lineTo(W, Y(v)); g.stroke(); g.fillText(v.toFixed(1), 2, Y(v) + 3 * dpr); }
  g.fillText(`${t1.toFixed(0)} s`, W - 40 * dpr, H - 2 * dpr);
  const step = Math.max(1, Math.floor(t.length / 1500));
  for (const [d, col] of series) {
    g.strokeStyle = col; g.lineWidth = 1.5 * dpr; g.beginPath();
    for (let i = 0; i < d.length; i += step) { i ? g.lineTo(X(t[i]), Y(d[i])) : g.moveTo(X(t[i]), Y(d[i])); }
    g.stroke();
  }
}
