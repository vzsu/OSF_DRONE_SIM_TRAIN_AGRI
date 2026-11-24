// Screens for Drone Training OS launches: the exercise brief before flying, and the replay viewer.
import { mount } from '../ui/screens';
import { dtos, resolveLaunch, loadReplayFlight, type DtosLaunch } from './session';
import { lessonById } from '../lessons/lessons';
import { droneById } from '../data/drones';
import { settings } from '../settings';
import { activePad } from '../input/input';
import { ReplayPlayer } from '../replay/player';
import type { FlightLog } from '../logs/recorder';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export interface DtosHooks {
  fly: (lessonId: string, demo: boolean) => void;
  replay: (log: FlightLog, launch: DtosLaunch) => void;
}

/** /dtos — resolve the launch link, then show the exercise brief (fly) or start the replay. */
export async function dtosScreen(hooks: DtosHooks) {
  const root = mount(`<div class="home-hero"><h1>Drone Training OS · Simulator</h1><p class="muted" id="dt-msg">Checking your link…</p></div>`);
  let L: DtosLaunch | null = dtos?.launch ?? null;
  // the simulator or the Training OS may still be starting: retry a few times before giving up
  let err: Error | null = null;
  for (let i = 0; i < 4 && !L; i++) {
    try { L = L ?? (await resolveLaunch()); err = null; }
    catch (e) {
      err = e as Error;
      const st = (e as { status?: number }).status;
      if (st === 404 || st === 400 || st === 403) break; // expired / invalid: retrying will not help
      root.querySelector('#dt-msg')!.textContent = `Connecting to Drone Training OS… (${esc(err.message)})`;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  if (err) {
    root.querySelector('#dt-msg')!.innerHTML = `<span class="bad">${esc(err.message)}</span><br>Go back to Drone Training OS → Training → Simulator and press <b>Fly</b> again — each button press makes a fresh link (valid 4 hours).
      <div class="row" style="justify-content:center;margin-top:14px"><button class="primary" id="dt-retry">Try again</button></div>`;
    root.querySelector<HTMLButtonElement>('#dt-retry')!.onclick = () => void dtosScreen(hooks);
    return;
  }
  if (!L) { root.querySelector('#dt-msg')!.innerHTML = 'Open the simulator from Drone Training OS → Training → Simulator.'; return; }

  if (L.mode === 'replay') {
    root.querySelector('#dt-msg')!.textContent = 'Loading the recorded flight…';
    try { hooks.replay(await loadReplayFlight(), L); }
    catch (e) { root.querySelector('#dt-msg')!.innerHTML = `<span class="bad">${esc((e as Error).message)}</span>`; }
    return;
  }

  const lesson = lessonById(L.lessonId ?? '');
  if (!lesson) { root.querySelector('#dt-msg')!.innerHTML = '<span class="bad">This simulator lesson is not available.</span>'; return; }
  const pad = activePad();
  const box = mount(`
    <div class="home-hero">
      <div class="eyebrow">${esc(L.orgName)} · ${esc(L.collegeName)}</div>
      <h1>${L.checkride ? `<span>${esc(L.checkride.title)}</span>` : `<span>${esc(L.exercise?.id ?? '')}</span> · <span>${esc(L.exercise?.title ?? lesson.title)}</span>`}</h1>
      <p class="muted">${esc(L.exercise?.objective ?? '')}</p>
    </div>
    <div class="grid" style="grid-template-columns:minmax(280px,1.3fr) minmax(260px,1fr);align-items:start">
      <div class="card">
        <div class="row spread"><h3 style="text-transform:none;font-size:20px;letter-spacing:0">Simulator lesson: ${esc(lesson.title)}</h3><span class="tag">${Math.round(lesson.timeLimit / 60)} min limit</span></div>
        <p>${esc(lesson.brief)}</p>
        <ul class="small" style="line-height:1.7;padding-left:18px">
          <li>First watch the demo — the sticks are shown bottom-left — then it's your turn.</li>
          <li>RTH, auto-land and AUTO are disabled. Fly it by hand.</li>
          <li>When you finish, your result and the recorded flight go to the Training OS automatically. Your instructor can replay it.</li>
        </ul>
        ${L.checkride ? `<p class="guest-note"><span>Checkride: no demo, flight aids off. Your best passed attempt counts.</span><br><span>Time left</span>: <b id="dt-left">—</b></p>` : ''}
        <div class="row" style="margin-top:12px">
          ${L.checkride ? '' : '<button class="primary" id="dt-demo">▶ Watch demo, then fly</button>'}
          <button ${L.checkride ? 'class="primary"' : ''} id="dt-fly">${L.checkride ? '▶ Start checkride flight' : 'Fly now'}</button>
        </div>
      </div>
      <div class="card">
        <h3>Session</h3>
        <div class="kv">
          <span>Student</span><span><b>${esc(L.user.name)}</b> (${esc(L.user.username)})</span>
          <span>Drone</span><span>${esc(droneById(lesson.kind === 'camera' ? 'dji_mavic3pro' : settings.droneId).name)}</span>
          <span>Controller</span><span>${pad ? esc(pad.id) : 'Keyboard (no RC detected)'}</span>
        </div>
        <p class="small muted" style="margin-top:10px">Radiomaster Pocket: plug in by USB-C, choose USB Joystick (HID) and move a stick. Calibrate once in Settings → Controller.</p>
      </div>
    </div>`);
  const demoBtn = box.querySelector<HTMLButtonElement>('#dt-demo');
  if (demoBtn) demoBtn.onclick = () => hooks.fly(lesson.id, true);
  box.querySelector<HTMLButtonElement>('#dt-fly')!.onclick = () => hooks.fly(lesson.id, false);
  if (L.checkride) {
    const end = Date.parse(L.checkride.endsAt);
    const tick = () => { const el = box.querySelector('#dt-left'); if (!el) return; const s = Math.max(0, (end - Date.now()) / 1000); el.textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; if (s > 0) setTimeout(tick, 1000); };
    tick();
  }
}

/** Replay controls (DOM overlay). The caller renders frames with player.fake as the engine. */
export class ReplayUI {
  el: HTMLDivElement;
  private bar: HTMLInputElement;
  constructor(readonly p: ReplayPlayer, launch: DtosLaunch, onSeek: () => void, onExit: () => void) {
    const a = launch.attempt, h = p.log.header;
    const el = (this.el = document.createElement('div'));
    el.className = 'replay';
    el.innerHTML = `
      <div class="rp-top">
        <div><b>REPLAY</b> · ${esc(a?.student?.name ?? h.trainee)} · ${esc(a?.exerciseId ?? '')} ${esc(a?.lessonTitle ?? h.lesson?.title ?? '')}
          <span class="${a?.passed ? 'ok' : 'bad'}">${a ? (a.passed ? `passed · ${a.score}` : 'not passed') : ''}</span></div>
        <div class="rp-sub">${esc(h.drone.name)} · ${new Date(h.startedAt).toLocaleString()} · drag to look, W A S D move, wheel zoom, Tab follow</div>
      </div>
      <div class="rp-stats"><div><span>Height</span><b id="rp-z">—</b></div><div><span>Speed</span><b id="rp-v">—</b></div><div><span>Mode</span><b id="rp-m">—</b></div><div><span>Battery</span><b id="rp-b">—</b></div></div>
      <div class="rp-sticks"><canvas id="rp-st" width="220" height="104"></canvas></div>
      <div class="rp-bottom">
        <button id="rp-play">❚❚</button>
        <button id="rp-back">−10 s</button><button id="rp-fwd">+10 s</button>
        <select id="rp-spd"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select>
        <div class="rp-track"><input type="range" id="rp-bar" min="0" max="${p.duration.toFixed(2)}" step="0.02" value="0"><div class="rp-ev">${p.log.events.filter((e) => e.code < 100 || e.code >= 900).slice(0, 80).map((e) => `<i style="left:${(e.t / Math.max(p.duration, 1)) * 100}%" title="${esc(mmss(e.t))} ${esc(e.text)}"></i>`).join('')}</div></div>
        <span id="rp-t" class="rp-time">0:00 / ${mmss(p.duration)}</span>
        <button id="rp-exit">Close</button>
      </div>`;
    document.body.appendChild(el);
    this.bar = el.querySelector('#rp-bar')!;
    const q = <T extends HTMLElement>(id: string) => el.querySelector<T>('#' + id)!;
    q('rp-play').onclick = () => { if (p.t >= p.duration) { p.seek(0); onSeek(); } p.playing = !p.playing; };
    q('rp-back').onclick = () => { p.seek(p.t - 10); onSeek(); };
    q('rp-fwd').onclick = () => { p.seek(p.t + 10); onSeek(); };
    q<HTMLSelectElement>('rp-spd').onchange = (e) => (p.speed = +(e.target as HTMLSelectElement).value);
    this.bar.oninput = () => { p.seek(+this.bar.value); onSeek(); };
    q('rp-exit').onclick = onExit;
  }
  update() {
    const p = this.p, q = (id: string) => this.el.querySelector('#' + id)!;
    if (document.activeElement !== this.bar) this.bar.value = String(p.t);
    q('rp-play').textContent = p.playing ? '❚❚' : '▶';
    q('rp-t').textContent = `${mmss(p.t)} / ${mmss(p.duration)}`;
    q('rp-z').textContent = `${p.col('agl').toFixed(1)} m`;
    q('rp-v').textContent = `${p.col('gnd_speed').toFixed(1)} m/s`;
    q('rp-m').textContent = p.col('armed') > 0.5 ? p.modeName() : 'DISARMED';
    q('rp-b').textContent = `${p.col('batt_v').toFixed(1)} V`;
    // stick monitor (mode 2): left = throttle/yaw, right = pitch/roll
    const c = this.el.querySelector<HTMLCanvasElement>('#rp-st')!, g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const box = (x0: number, sx: number, sy: number) => {
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; g.strokeRect(x0 + 2, 2, 100, 100);
      g.beginPath(); g.moveTo(x0 + 52, 2); g.lineTo(x0 + 52, 102); g.moveTo(x0 + 2, 52); g.lineTo(x0 + 102, 52); g.stroke();
      g.fillStyle = '#d8ff3d'; g.beginPath(); g.arc(x0 + 52 + sx * 46, 52 - sy * 46, 6, 0, 7); g.fill();
    };
    box(0, p.col('rc_yaw'), p.col('rc_thr') * 2 - 1);
    box(114, p.col('rc_roll'), p.col('rc_pitch'));
  }
  remove() { this.el.remove(); }
}
