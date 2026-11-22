// Mission planner: draw the spray area on the farm map (like an agri ground-station app),
// set lane spacing / height / speed / direction, preview lanes and the job estimate.
import { mount, header, wireNav, backTarget } from './screens';
import { settings, saveSettings } from '../settings';
import { droneById } from '../data/drones';
import { FIELD, TREES, POLES, HOUSE, HOME, WATER_TANK } from '../data/world';
import { planLanes, missionStats, defaultPlan, type Pt } from '../sim/mission';

type Nav = (screen: string, arg?: unknown) => void;

const B = { x0: -75, x1: 75, y0: -45, y1: 130 }; // map bounds (m)

export function missionScreen(nav: Nav) {
  const m = settings.mission;
  const d = droneById(settings.droneId);
  const root = mount(`${header('Mission planner — spray area')}
    <div class="grid" style="grid-template-columns:minmax(300px,640px) minmax(280px,1fr);align-items:start">
      <div class="card"><canvas class="planner" id="pl"></canvas>
        <p class="small muted">Click to add corners. Drag a corner to move it. Right-click (or long-press) a corner to delete it. White = area, thin lines = spray lanes, H = take-off pad.</p>
        <div class="row"><button id="whole">Whole field</button><button id="undo">Undo corner</button><button id="clear" class="danger">Clear</button></div></div>
      <div class="card">
        <div class="field"><label>Lane spacing (swath) <span class="val" id="v-sp"></span></label><input type="range" id="sp" min="2" max="12" step="0.5" value="${m.spacing}"></div>
        <div class="field"><label>Spray height above crop <span class="val" id="v-ht"></span></label><input type="range" id="ht" min="1.5" max="6" step="0.5" value="${m.height}"></div>
        <div class="field"><label>Spray speed <span class="val" id="v-sd"></span></label><input type="range" id="sd" min="1" max="7" step="0.5" value="${m.speed}"></div>
        <div class="field"><label>Lane direction <span class="val" id="v-an"></span></label><input type="range" id="an" min="-1" max="179" step="1" value="${m.angleDeg ?? -1}"></div>
        <div class="field"><label>Boundary margin <span class="val" id="v-mg"></span></label><input type="range" id="mg" min="0" max="5" step="0.5" value="${m.margin}"></div>
        <h3>Job estimate — ${d.name}</h3><div class="kv" id="stats"></div>
        <h3 style="margin-top:12px">How to fly it</h3>
        <ol class="small" style="padding-left:18px;line-height:1.6">
          <li>Fly → put the mode switch on <b>AUTO</b> (keyboard <b>4</b>; or set a mode-switch position to AUTO in Settings → Controller).</li>
          <li>Arm. The drone takes off, sprays every lane (pump on only on lanes), and lands at H.</li>
          <li>Battery low or tank empty → it returns home and saves a <b>breakpoint</b> (red BP on the map).</li>
          <li>Land, press <b>B</b> (swap battery + refill), arm again in AUTO → it flies to the breakpoint and continues.</li>
          <li>Flip the mode switch out of AUTO at any time to take manual control.</li>
        </ol>
        <div class="row"><button class="primary" id="fly">${backTarget() === 'resume' ? 'Back to flight with this mission' : 'Fly this mission'}</button></div>
      </div></div>`);
  wireNav(root, nav);
  const cv = root.querySelector<HTMLCanvasElement>('#pl')!;
  const dpr = window.devicePixelRatio || 1;
  let W = 0, H = 0, sc = 1;
  const X = (x: number) => (x - B.x0) * sc, Y = (y: number) => H - (y - B.y0) * sc;
  const toWorld = (px: number, py: number): Pt => [+(px / sc + B.x0).toFixed(1), +((H - py) / sc + B.y0).toFixed(1)];
  const resize = () => { W = cv.clientWidth * dpr; H = cv.clientHeight * dpr; cv.width = W; cv.height = H; sc = Math.min(W / (B.x1 - B.x0), H / (B.y1 - B.y0)); draw(); };

  const fmt = () => {
    const s = (id: string, t: string) => (root.querySelector('#v-' + id)!.textContent = t);
    s('sp', `${m.spacing} m`); s('ht', `${m.height} m`); s('sd', `${m.speed} m/s`); s('mg', `${m.margin} m`);
    s('an', m.angleDeg === null ? 'auto (longest edge)' : `${m.angleDeg}°`);
    const st = missionStats(m, d.flowLpm, d.tankCap, [HOME.x, HOME.y]);
    root.querySelector('#stats')!.innerHTML = m.poly.length < 3 ? '<span>Area</span><span>draw at least 3 corners</span>' : `
      <span>Area</span><span>${st.areaHa.toFixed(2)} ha (${(st.areaHa * 2.471).toFixed(2)} acre)</span>
      <span>Lanes</span><span>${st.lanes}</span>
      <span>Flight path</span><span>${st.pathM.toFixed(0)} m (spraying ${st.sprayM.toFixed(0)} m)</span>
      <span>Application rate</span><span>${st.lPerHa.toFixed(1)} L/ha at ${d.flowLpm} L/min</span>
      <span>Liquid needed</span><span>${st.litres.toFixed(1)} L ${d.tankCap ? `→ ${st.tankLoads} tank load${st.tankLoads === 1 ? '' : 's'}` : '(no tank on this drone)'}</span>
      <span>Est. flight time</span><span>${st.minutes.toFixed(1)} min</span>`;
  };

  function draw() {
    const g = cv.getContext('2d')!;
    g.fillStyle = '#26301f'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#4c6a28'; g.fillRect(X(FIELD.x0), Y(FIELD.y1), (FIELD.x1 - FIELD.x0) * sc, (FIELD.y1 - FIELD.y0) * sc);
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
    for (let x = -70; x <= 70; x += 10) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), H); g.stroke(); }
    for (let y = -40; y <= 130; y += 10) { g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(W, Y(y)); g.stroke(); }
    g.fillStyle = '#2f5a25'; for (const t of TREES) { g.beginPath(); g.arc(X(t.x), Y(t.y), t.crownR * sc, 0, 7); g.fill(); }
    g.strokeStyle = '#e8d24a'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(POLES[0].x), Y(POLES[0].y)); g.lineTo(X(POLES[POLES.length - 1].x), Y(POLES[POLES.length - 1].y)); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#b89a70'; g.fillRect(X(HOUSE.x - HOUSE.hx), Y(HOUSE.y + HOUSE.hy), HOUSE.hx * 2 * sc, HOUSE.hy * 2 * sc);
    g.fillStyle = '#8a8f96'; g.beginPath(); g.arc(X(WATER_TANK.x), Y(WATER_TANK.y), WATER_TANK.r * sc, 0, 7); g.fill();
    g.font = `${11 * dpr}px monospace`; g.fillStyle = '#e8d24a'; g.fillText('power line', X(POLES[0].x) + 4, Y(60));
    if (m.poly.length) {
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.strokeStyle = '#fff'; g.lineWidth = 2 * dpr; g.beginPath();
      m.poly.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      if (m.poly.length >= 3) { g.closePath(); g.fill(); }
      g.stroke();
      const lanes = planLanes(m);
      g.strokeStyle = 'rgba(80,180,255,0.9)'; g.lineWidth = 1.2 * dpr;
      let prev: Pt = [HOME.x, HOME.y];
      lanes.forEach((l) => {
        g.setLineDash([3 * dpr, 3 * dpr]); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(X(prev[0]), Y(prev[1])); g.lineTo(X(l.a[0]), Y(l.a[1])); g.stroke();
        g.setLineDash([]); g.strokeStyle = 'rgba(80,180,255,0.9)'; g.beginPath(); g.moveTo(X(l.a[0]), Y(l.a[1])); g.lineTo(X(l.b[0]), Y(l.b[1])); g.stroke();
        prev = l.b;
      });
      if (lanes.length) { g.fillStyle = '#3ccf7a'; g.beginPath(); g.arc(X(lanes[0].a[0]), Y(lanes[0].a[1]), 4 * dpr, 0, 7); g.fill(); }
      g.fillStyle = '#ff7a1a';
      m.poly.forEach(([x, y]) => { g.beginPath(); g.arc(X(x), Y(y), 5 * dpr, 0, 7); g.fill(); });
    }
    g.fillStyle = '#fff'; g.font = `bold ${13 * dpr}px monospace`; g.fillText('H', X(HOME.x) - 4 * dpr, Y(HOME.y) + 5 * dpr);
    g.font = `${11 * dpr}px monospace`; g.fillText('N↑   grid 10 m', 6 * dpr, 14 * dpr);
  }
  const changed = () => { saveSettings(); fmt(); draw(); };

  // pointer editing
  let drag = -1;
  const pos = (ev: PointerEvent) => { const r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) * dpr, (ev.clientY - r.top) * dpr] as const; };
  const hit = (px: number, py: number) => m.poly.findIndex(([x, y]) => Math.hypot(X(x) - px, Y(y) - py) < 10 * dpr);
  let pressT = 0;
  cv.addEventListener('pointerdown', (ev) => {
    const [px, py] = pos(ev);
    const i = hit(px, py);
    if (ev.button === 2) { if (i >= 0) { m.poly.splice(i, 1); changed(); } return; }
    pressT = performance.now();
    if (i >= 0) { drag = i; cv.setPointerCapture(ev.pointerId); return; }
    m.poly.push(toWorld(px, py)); changed();
  });
  cv.addEventListener('pointermove', (ev) => { if (drag < 0) return; const [px, py] = pos(ev); m.poly[drag] = toWorld(px, py); changed(); });
  cv.addEventListener('pointerup', () => {
    // long-press on a corner (touch screens) deletes it
    if (drag >= 0 && performance.now() - pressT > 700) { m.poly.splice(drag, 1); changed(); }
    drag = -1;
  });
  cv.addEventListener('contextmenu', (ev) => ev.preventDefault());
  root.querySelector('#whole')!.addEventListener('click', () => { m.poly = defaultPlan().poly; changed(); });
  root.querySelector('#undo')!.addEventListener('click', () => { m.poly.pop(); changed(); });
  root.querySelector('#clear')!.addEventListener('click', () => { m.poly = []; changed(); });
  const bind = (id: string, f: (v: number) => void) => root.querySelector<HTMLInputElement>('#' + id)!.addEventListener('input', (e) => { f(+(e.target as HTMLInputElement).value); changed(); });
  bind('sp', (v) => (m.spacing = v)); bind('ht', (v) => (m.height = v)); bind('sd', (v) => (m.speed = v));
  bind('mg', (v) => (m.margin = v)); bind('an', (v) => (m.angleDeg = v < 0 ? null : v));
  // "Fly this mission" returns to the paused flight when opened from the pause menu
  root.querySelector<HTMLElement>('#fly')!.onclick = () => nav(backTarget() === 'resume' ? 'resume' : 'fly');
  fmt(); requestAnimationFrame(resize);
  window.addEventListener('resize', resize, { once: true });
}
