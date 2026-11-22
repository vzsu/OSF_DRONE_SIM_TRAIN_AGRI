// Agri ground-station tablet UI (like the screen on an agri RC / spray app):
// status bar · geo map with area editor (lat/lon grid, scale, hazards, lanes, coverage, trail,
// breakpoint) · side panel (Plan / Fly / Battery) · slide-to-start · pre-flight check overlay.
// Works with any link: in the simulator (slides up from the bottom) or on a LAN phone/tablet.
import type { Telemetry, GcsCmd, WorldGeo } from './host';
import { toLatLon } from './host';
import { planLanes, missionStats, polyArea, type MissionPlan, type Pt } from '../sim/mission';

export interface GcsLink { tel(): Telemetry | null; world(): WorldGeo | null; send(c: GcsCmd): Promise<string> | string }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmtT = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class GcsUI {
  root: HTMLElement;
  private map!: HTMLCanvasElement;
  private tab: 'plan' | 'fly' | 'battery' = 'plan';
  private view = { cx: 0, cy: 50, scale: 3 }; // metres at centre, px per metre (CSS px)
  private follow = false;
  private edit = true;
  private draft: MissionPlan | null = null; // local edits until pushed
  private drag = -1; private pan: { x: number; y: number; cx: number; cy: number } | null = null;
  private covImg = new Image(); private covSrc = '';
  private msg = ''; private msgBad = false; private msgAt = 0;
  private lastPanel = 0; private fitted = '';
  private raf = 0;

  constructor(private link: GcsLink, container: HTMLElement, private embedded: boolean) {
    this.root = document.createElement('div');
    this.root.className = 'gcs' + (embedded ? ' embedded' : ' full');
    this.root.innerHTML = `
      <div class="gcs-screen">
        <div class="gcs-top" id="g-top"></div>
        <div class="gcs-body">
          <div class="gcs-mapwrap"><canvas class="gcs-map"></canvas>
            <div class="gcs-maptools">
              <button data-z="in">+</button><button data-z="out">−</button><button data-z="fit" title="Fit field">⤢</button><button data-z="follow" title="Follow drone">◎</button>
            </div>
            <div class="gcs-coord" id="g-coord"></div>
            <div class="gcs-checks" id="g-checks"></div>
          </div>
          <div class="gcs-side">
            <div class="gcs-tabs"><button data-t="plan">Plan</button><button data-t="fly">Fly</button><button data-t="battery">Battery</button></div>
            <div class="gcs-panel" id="g-panel"></div>
            <div class="gcs-msg" id="g-msg"></div>
          </div>
        </div>
        <div class="gcs-foot" id="g-foot">
          <div class="slide" id="g-slide"><div class="slide-fill"></div><span class="slide-text" id="g-slidetext">Slide to start spraying</span><div class="slide-thumb">›››</div></div>
          <div class="gcs-actions" id="g-actions"></div>
        </div>
      </div>`;
    container.appendChild(this.root);
    this.map = this.root.querySelector('.gcs-map')!;
    this.root.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => (b.onclick = () => { this.tab = b.dataset.t as typeof this.tab; this.renderPanel(true); }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-z]').forEach((b) => (b.onclick = () => {
      const z = b.dataset.z;
      if (z === 'in') this.view.scale *= 1.4; else if (z === 'out') this.view.scale /= 1.4;
      else if (z === 'fit') { this.fitted = ''; this.follow = false; } else this.follow = !this.follow;
      b.classList.toggle('on', z === 'follow' && this.follow);
    }));
    this.bindMap();
    this.bindSlider();
    const loop = () => { this.frame(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() { cancelAnimationFrame(this.raf); this.root.remove(); }

  private async send(c: GcsCmd) {
    const err = await this.link.send(c);
    if (err) this.flash(err, true);
    return err;
  }
  private flash(text: string, bad = false) { this.msg = text; this.msgBad = bad; this.msgAt = performance.now(); }

  private plan(t: Telemetry): MissionPlan { return this.draft ?? t.plan; }
  private pushPlan(p: MissionPlan) { this.draft = p; void this.send({ t: 'plan', plan: p }).then((e) => { if (!e) setTimeout(() => (this.draft = null), 400); }); }

  // ---------- map ----------
  private toPx(x: number, y: number): [number, number] {
    const r = this.map.getBoundingClientRect();
    return [r.width / 2 + (x - this.view.cx) * this.view.scale, r.height / 2 - (y - this.view.cy) * this.view.scale];
  }
  private toM(px: number, py: number): Pt {
    const r = this.map.getBoundingClientRect();
    return [+((px - r.width / 2) / this.view.scale + this.view.cx).toFixed(1), +((r.height / 2 - py) / this.view.scale + this.view.cy).toFixed(1)];
  }

  private bindMap() {
    const m = this.map;
    const local = (ev: PointerEvent) => { const r = m.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top] as const; };
    let downT = 0, moved = false;
    m.addEventListener('pointerdown', (ev) => {
      const t = this.link.tel(); if (!t) return;
      const [px, py] = local(ev);
      const plan = this.plan(t);
      const hit = plan.poly.findIndex(([x, y]) => { const [qx, qy] = this.toPx(x, y); return Math.hypot(qx - px, qy - py) < 14; });
      m.setPointerCapture(ev.pointerId); downT = performance.now(); moved = false;
      if (ev.button === 2 && hit >= 0 && this.edit) { const p = { ...plan, poly: plan.poly.filter((_, i) => i !== hit) }; this.pushPlan(p); return; }
      if (hit >= 0 && this.edit) { this.drag = hit; this.draft = { ...plan, poly: plan.poly.map((q) => [...q] as Pt) }; return; }
      this.pan = { x: px, y: py, cx: this.view.cx, cy: this.view.cy };
    });
    m.addEventListener('pointermove', (ev) => {
      const [px, py] = local(ev);
      if (this.drag >= 0 && this.draft) { this.draft.poly[this.drag] = this.toM(px, py); moved = true; return; }
      if (this.pan) {
        if (Math.hypot(px - this.pan.x, py - this.pan.y) > 4) moved = true;
        this.view.cx = this.pan.cx - (px - this.pan.x) / this.view.scale; this.view.cy = this.pan.cy + (py - this.pan.y) / this.view.scale; this.follow = false;
      }
      const [x, y] = this.toM(px, py), [la, lo] = toLatLon(x, y);
      this.root.querySelector('#g-coord')!.textContent = `${la.toFixed(6)}° N  ${lo.toFixed(6)}° E`;
    });
    m.addEventListener('pointerup', (ev) => {
      const t = this.link.tel();
      if (this.drag >= 0 && this.draft) {
        if (!moved && performance.now() - downT > 650) this.draft.poly.splice(this.drag, 1); // long-press deletes
        this.pushPlan(this.draft); this.drag = -1; return;
      }
      if (this.pan && !moved && t && this.edit && this.tab === 'plan') {
        const [px, py] = local(ev);
        const plan = this.plan(t);
        this.pushPlan({ ...plan, poly: [...plan.poly, this.toM(px, py)] });
      }
      this.pan = null;
    });
    m.addEventListener('contextmenu', (e) => e.preventDefault());
    m.addEventListener('wheel', (e) => { e.preventDefault(); this.view.scale *= e.deltaY < 0 ? 1.15 : 1 / 1.15; this.view.scale = Math.max(0.5, Math.min(40, this.view.scale)); }, { passive: false });
  }

  private drawMap(t: Telemetry, w: WorldGeo) {
    const c = this.map, dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    if (this.fitted !== w.key && r.width > 50) {
      const f = w.field; this.view.cx = (f.x0 + f.x1) / 2; this.view.cy = (f.y0 + f.y1) / 2 - 10;
      this.view.scale = Math.min(r.width / (f.x1 - f.x0 + 50), r.height / (f.y1 - f.y0 + 60)); this.fitted = w.key;
    }
    if (this.follow) { this.view.cx = t.x; this.view.cy = t.y; }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = (x: number, y: number) => this.toPx(x, y), s = this.view.scale;
    // "satellite" base: dark terrain, field with crop rows, lawn for venues
    g.fillStyle = '#2b3524'; g.fillRect(0, 0, r.width, r.height);
    const [fx0, fy1] = P(w.field.x0, w.field.y1), [fx1, fy0] = P(w.field.x1, w.field.y0);
    g.fillStyle = w.category === 'wedding' ? '#4f8a3a' : '#556b2c'; g.fillRect(fx0, fy1, fx1 - fx0, fy0 - fy1);
    if (w.category === 'agri' && s > 1.5) {
      g.strokeStyle = 'rgba(30,45,15,0.35)'; g.lineWidth = 1;
      for (let x = w.field.x0; x < w.field.x1; x += 2) { const [a] = P(x, 0); g.beginPath(); g.moveTo(a, fy1); g.lineTo(a, fy0); g.stroke(); }
    }
    const [hx, hy] = P(0, -8); g.fillStyle = '#7a6a52'; g.fillRect(0, hy - 2.25 * s, r.width, 4.5 * s); void hx;
    // lat/lon grid
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.fillStyle = 'rgba(255,255,255,0.45)'; g.font = '10px monospace';
    const step = s > 6 ? 10 : s > 2 ? 25 : 50;
    const [mx0, my0] = this.toM(0, r.height), [mx1, my1] = this.toM(r.width, 0);
    for (let x = Math.ceil(mx0 / step) * step; x < mx1; x += step) { const [a] = P(x, 0); g.beginPath(); g.moveTo(a, 0); g.lineTo(a, r.height); g.stroke(); g.fillText(`${toLatLon(x, 0)[1].toFixed(5)}°E`, a + 2, r.height - 4); }
    for (let y = Math.ceil(my0 / step) * step; y < my1; y += step) { const [, b] = P(0, y); g.beginPath(); g.moveTo(0, b); g.lineTo(r.width, b); g.stroke(); g.fillText(`${toLatLon(0, y)[0].toFixed(5)}°N`, 2, b - 2); }
    // coverage overlay (1 m grid image, x0=-80 y0=-50, 160×190)
    if (t.cov.img && t.cov.img !== this.covSrc) { this.covSrc = t.cov.img; this.covImg.src = t.cov.img; }
    if (this.covSrc && this.covImg.complete) {
      const [ix, iy] = P(-80, 140); g.imageSmoothingEnabled = false; g.globalAlpha = 0.9; g.drawImage(this.covImg, ix, iy, 160 * s, 190 * s); g.globalAlpha = 1;
    }
    // hazards: trees, buildings, tents, crowd, power / light lines
    for (const [x, y, cr] of w.trees) { const [a, b] = P(x, y); g.fillStyle = '#1f3f1a'; g.beginPath(); g.arc(a, b, cr * s, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,200,60,0.5)'; g.setLineDash([3, 3]); g.beginPath(); g.arc(a, b, (cr + 5) * s, 0, 7); g.stroke(); g.setLineDash([]); }
    { const h = w.house; const [a, b] = P(h.x - h.hx, h.y + h.hy); g.fillStyle = '#b09878'; g.fillRect(a, b, h.hx * 2 * s, h.hy * 2 * s); }
    for (const bx of w.boxes) { const [a, b] = P(bx.x - bx.hx, bx.y + bx.hy); g.fillStyle = bx.kind === 'stage' ? '#8a1c2b' : bx.kind === 'canopy' ? '#d94f2a' : '#e8e2d6'; g.fillRect(a, b, bx.hx * 2 * s, bx.hy * 2 * s); }
    for (const cw of w.crowd) { const [a, b] = P(cw.x0, cw.y1); g.fillStyle = 'rgba(255,50,50,0.25)'; g.strokeStyle = '#ff4a4a'; g.fillRect(a, b, (cw.x1 - cw.x0) * s, (cw.y1 - cw.y0) * s); g.strokeRect(a, b, (cw.x1 - cw.x0) * s, (cw.y1 - cw.y0) * s); g.fillStyle = '#ff8080'; g.fillText('NO-FLY: PEOPLE', a + 3, b + 12); }
    g.strokeStyle = '#ff5a3a'; g.lineWidth = 2; g.setLineDash([8, 5]);
    for (const [a, b] of w.wires) { const [x1, y1] = P(a[0], a[1]), [x2, y2] = P(b[0], b[1]); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    g.setLineDash([]); g.fillStyle = '#ffd0c0';
    for (const [x, y] of w.poles) { const [a, b] = P(x, y); g.beginPath(); g.arc(a, b, 3, 0, 7); g.fill(); }
    // mission area, lanes, current leg, breakpoint
    const plan = this.plan(t);
    if (plan.poly.length) {
      g.fillStyle = 'rgba(80,190,255,0.12)'; g.strokeStyle = '#4fc3ff'; g.lineWidth = 2;
      g.beginPath(); plan.poly.forEach(([x, y], i) => { const [a, b] = P(x, y); i ? g.lineTo(a, b) : g.moveTo(a, b); }); if (plan.poly.length > 2) g.closePath(); g.fill(); g.stroke();
      if (plan.poly.length > 2) {
        g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1;
        for (const l of planLanes(plan)) { const [a, b] = P(l.a[0], l.a[1]), [c2, d2] = P(l.b[0], l.b[1]); g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d2); g.stroke(); }
      }
      plan.poly.forEach(([x, y], i) => { const [a, b] = P(x, y); g.fillStyle = '#fff'; g.beginPath(); g.arc(a, b, 7, 0, 7); g.fill(); g.fillStyle = '#0a5a8a'; g.font = 'bold 10px sans-serif'; g.fillText(String(i + 1), a - 3, b + 4); });
    }
    if (t.mission.legA && t.mission.legB && (t.mission.phase === 'leg' || t.mission.phase === 'toBreak')) {
      const [a, b] = P(...t.mission.legA), [c2, d2] = P(...t.mission.legB); g.strokeStyle = '#3cff8a'; g.lineWidth = 3; g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d2); g.stroke();
    }
    if (t.mission.bp) { const [a, b] = P(t.mission.bp.x, t.mission.bp.y); g.fillStyle = '#ff3b30'; g.fillRect(a - 6, b - 6, 12, 12); g.fillStyle = '#fff'; g.font = 'bold 11px sans-serif'; g.fillText('BREAKPOINT', a + 9, b + 4); }
    // trail blue → yellow
    const tr = t.trail, n = tr.length;
    g.lineWidth = 2.5;
    for (let i = 1; i < n; i++) {
      const u = i / (n - 1);
      g.strokeStyle = `rgb(${Math.round(30 + 225 * u)},${Math.round(115 + 115 * u)},${Math.round(255 - 230 * u)})`;
      const [a, b] = P(tr[i - 1][0], tr[i - 1][1]), [c2, d2] = P(tr[i][0], tr[i][1]); g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d2); g.stroke();
    }
    // home + drone
    { const [a, b] = P(w.home[0], w.home[1]); g.fillStyle = '#ffcc00'; g.beginPath(); g.arc(a, b, 9, 0, 7); g.fill(); g.fillStyle = '#000'; g.font = 'bold 11px sans-serif'; g.fillText('H', a - 4, b + 4); }
    { const [a, b] = P(t.x, t.y); g.save(); g.translate(a, b); g.rotate(-t.yaw); g.fillStyle = t.armed ? '#ff7a1a' : '#ddd'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(13, 0); g.lineTo(-8, 8); g.lineTo(-3, 0); g.lineTo(-8, -8); g.closePath(); g.fill(); g.stroke(); g.restore(); }
    // scale bar + north
    const sb = step; g.fillStyle = '#fff'; g.fillRect(12, r.height - 26, sb * s, 3); g.fillText(`${sb} m`, 12, r.height - 30);
    g.font = 'bold 13px sans-serif'; g.fillText('N', r.width - 22, 22); g.beginPath(); g.moveTo(r.width - 18, 28); g.lineTo(r.width - 23, 40); g.lineTo(r.width - 13, 40); g.fill();
  }

  // ---------- panels ----------
  private renderTop(t: Telemetry) {
    const gps = `${t.sats.toFixed(0)}★ HDOP ${t.hdop > 50 ? '--' : t.hdop.toFixed(1)}${t.drone.rtk && t.sats >= 12 ? ' RTK' : t.fix >= 3 ? ' 3D' : ' NO FIX'}`;
    const gpsOk = t.fix >= 3 && t.sats >= t.drone.minSats && t.hdop <= 2;
    const soc = t.soc * 100;
    this.root.querySelector('#g-top')!.innerHTML = `
      <span class="chip ${t.armed ? 'on' : ''}">${t.crashed ? 'CRASHED' : t.armed ? (t.landed ? 'ARMED' : 'FLYING') : 'READY'}</span>
      <span class="chip mode">${esc(t.modeName)}${t.gcsMode !== null ? ' · GCS' : ''}</span>
      <span class="${gpsOk ? 'ok' : 'bad'}">GNSS ${gps}</span>
      <span class="${soc > t.drone.lowBatt ? 'ok' : 'bad'}">BAT ${soc.toFixed(0)}% ${t.volt.toFixed(1)}V</span>
      ${t.drone.tankCap ? `<span>TANK ${t.tank.toFixed(1)}L</span>` : ''}
      <span>H ${t.agl.toFixed(1)}m</span><span>${t.gs.toFixed(1)}m/s</span><span>D ${t.homeDist.toFixed(0)}m</span>
      <span class="spacer"></span><span>${esc(t.drone.name)}</span><span>${fmtT(t.flightTime)}</span>`;
  }

  private renderPanel(force = false) {
    const t = this.link.tel(); if (!t) return;
    const now = performance.now();
    if (!force && now - this.lastPanel < 400) return;
    // don't rebuild while the user is dragging a slider
    const act = document.activeElement as HTMLElement | null;
    if (!force && act && this.root.contains(act) && act.tagName === 'INPUT') return;
    this.lastPanel = now;
    this.root.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === this.tab));
    const p = this.root.querySelector<HTMLElement>('#g-panel')!;
    const plan = this.plan(t);
    if (this.tab === 'plan') {
      const st = missionStats(plan, t.drone.flowLpm, t.drone.tankCap, [0, 0]);
      const per = plan.poly.reduce((s, q, i) => s + Math.hypot(q[0] - plan.poly[(i + 1) % plan.poly.length][0], q[1] - plan.poly[(i + 1) % plan.poly.length][1]), 0);
      const sl = (k: keyof MissionPlan, label: string, min: number, max: number, stp: number, unit: string) =>
        `<label class="gsl">${label}<b>${k === 'angleDeg' && plan.angleDeg === null ? 'auto' : plan[k]}${unit}</b><input type="range" data-k="${k}" min="${min}" max="${max}" step="${stp}" value="${k === 'angleDeg' ? plan.angleDeg ?? -1 : plan[k]}"></label>`;
      p.innerHTML = `
        <div class="row"><label class="small"><input type="checkbox" id="g-edit" ${this.edit ? 'checked' : ''}> Edit area (tap map to add corners)</label></div>
        <div class="row"><button class="small" id="g-field">Use whole field</button><button class="small" id="g-undo">Undo</button><button class="small danger" id="g-clear">Clear</button></div>
        ${sl('spacing', 'Swath / lane spacing', 2, 12, 0.5, ' m')}${sl('height', 'Height above crop', 1.5, 6, 0.5, ' m')}${sl('speed', 'Spray speed', 1, 7, 0.5, ' m/s')}
        ${sl('angleDeg', 'Route direction', -1, 179, 1, '°')}${sl('margin', 'Boundary margin', 0, 5, 0.5, ' m')}
        <div class="kv small">
          <span>Area</span><span>${plan.poly.length > 2 ? `${(polyArea(plan.poly) / 10000).toFixed(3)} ha · ${(polyArea(plan.poly) / 4047).toFixed(2)} acre` : 'tap ≥ 3 corners'}</span>
          <span>Perimeter</span><span>${per.toFixed(0)} m · ${plan.poly.length} corners</span>
          <span>Lanes</span><span>${st.lanes} · route ${st.pathM.toFixed(0)} m</span>
          <span>Dose</span><span>${st.lPerHa.toFixed(1)} L/ha @ ${t.drone.flowLpm} L/min</span>
          <span>Liquid</span><span>${st.litres.toFixed(1)} L → ${st.tankLoads} tank${st.tankLoads === 1 ? '' : 's'}</span>
          <span>Time</span><span>~${st.minutes.toFixed(1)} min</span>
        </div>
        <p class="small muted">Corners: drag to move, long-press / right-click to delete. Dashed circles = keep-out around trees, red dashed = wires.</p>`;
      p.querySelector<HTMLInputElement>('#g-edit')!.onchange = (e) => (this.edit = (e.target as HTMLInputElement).checked);
      p.querySelector<HTMLButtonElement>('#g-field')!.onclick = () => { const w = this.link.world(); if (!w) return; const f = w.field; this.pushPlan({ ...plan, poly: [[f.x0 + 5, f.y0 + 5], [f.x1 - 5, f.y0 + 5], [f.x1 - 5, f.y1 - 5], [f.x0 + 5, f.y1 - 5]] }); };
      p.querySelector<HTMLButtonElement>('#g-undo')!.onclick = () => this.pushPlan({ ...plan, poly: plan.poly.slice(0, -1) });
      p.querySelector<HTMLButtonElement>('#g-clear')!.onclick = () => this.pushPlan({ ...plan, poly: [] });
      p.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((i) => {
        i.oninput = () => { const k = i.dataset.k as keyof MissionPlan; const v = +i.value; this.draft = { ...plan, [k]: k === 'angleDeg' && v < 0 ? null : v } as MissionPlan; i.previousElementSibling!.textContent = k === 'angleDeg' && v < 0 ? 'auto' : `${v}`; };
        i.onchange = () => { if (this.draft) this.pushPlan(this.draft); i.blur(); };
      });
    } else if (this.tab === 'fly') {
      const m = t.mission, pct = m.lanes ? m.lanesDone / m.lanes * 100 : 0;
      const area = polyArea(plan.poly) / 10000;
      p.innerHTML = `
        <div class="big-progress"><div class="ring" style="--p:${pct.toFixed(0)}"><span>${pct.toFixed(0)}%</span></div>
          <div class="kv small"><span>Phase</span><span>${({ idle: 'Ready', takeoff: 'Taking off', toBreak: 'To breakpoint', leg: t.spraying ? 'Spraying' : 'Turning / transit', land: 'Landing', done: 'Complete' } as Record<string, string>)[m.phase]}</span>
          <span>Lane</span><span>${Math.min(m.lanesDone + 1, m.lanes)} / ${m.lanes}</span><span>Sprayed area</span><span>${(area * pct / 100).toFixed(3)} ha</span>
          <span>Coverage</span><span>${t.cov.pct.toFixed(0)}% · overlap ${t.cov.overlap.toFixed(0)}%</span><span>Cross-track</span><span>${m.xte.toFixed(2)} m</span>
          <span>Pump</span><span>${t.spraying ? `ON ${(t.drone.flowLpm * t.flow).toFixed(1)} L/min` : 'off'}</span></div></div>
        ${m.bp ? `<div class="bp">Breakpoint saved (${esc(m.bp.reason)}). Swap battery / refill, then slide to resume.</div>` : ''}
        <div class="grid2">
          <button data-c="pause" ${t.armed && t.gcsMode === 5 ? '' : 'disabled'}>Pause (hover)</button>
          <button data-c="resume" ${t.armed && t.gcsMode !== 5 && m.lanes ? '' : 'disabled'}>Resume</button>
          <button data-c="rth" class="warnbtn" ${t.armed ? '' : 'disabled'}>Return home</button>
          <button data-c="manual" ${t.gcsMode !== null ? '' : 'disabled'}>Manual control</button>
        </div>
        <p class="small muted">Moving the RC mode switch always takes control back.</p>`;
      p.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => (b.onclick = () => void this.send({ t: b.dataset.c as 'pause' })));
    } else {
      const cellV = (soc: number) => (3.3 + 0.9 * soc) * t.drone.cells;
      const act = (id: string, place: string) => place === 'drone'
        ? `<button class="small" data-pk="${id}" data-to="charger">→ Charger</button><button class="small" data-pk="${id}" data-to="ground">→ Ground</button>`
        : place === 'charger' ? `<button class="small" data-pk="${id}" data-to="drone">Install</button><button class="small" data-pk="${id}" data-to="ground">Off charger</button>`
        : `<button class="small" data-pk="${id}" data-to="drone">Install</button><button class="small" data-pk="${id}" data-to="charger">→ Charger</button>`;
      const charging = t.packs.find((x) => x.place === 'charger');
      p.innerHTML = `
        <div class="packs">${t.packs.map((k) => `<div class="pack ${k.place}">
          <div class="row spread"><b>Pack ${k.id}</b><span class="tag">${esc(k.status)}</span></div>
          <div class="pbar"><i style="width:${(k.soc * 100).toFixed(0)}%;background:${k.soc > 0.5 ? '#3ccf7a' : k.soc > 0.25 ? '#f2c230' : '#ff5a4a'}"></i><span>${(k.soc * 100).toFixed(0)}%</span></div>
          <div class="small muted">${cellV(k.soc).toFixed(1)} V · ${k.tempC.toFixed(0)} °C · ${k.cycles} cycles</div>
          <div class="row">${act(k.id, k.place)}</div></div>`).join('')}</div>
        <div class="charger small">Charger: ${charging ? `pack ${charging.id} ${charging.soc >= 1 ? 'full' : charging.tempC > 45 ? 'waiting to cool' : `~${Math.ceil((1 - charging.soc) * t.chargeMinutes)} min to full`}` : 'empty slot'} · full charge ≈ ${t.chargeMinutes} min</div>
        ${t.drone.tankCap ? `<div class="pack"><div class="row spread"><b>Spray tank</b><span>${t.tank.toFixed(1)} / ${t.drone.tankCap} L</span></div>
          <div class="pbar tank"><i style="width:${(t.tank / t.drone.tankCap * 100).toFixed(0)}%"></i></div>
          <button class="small" id="g-refill" ${t.armed ? 'disabled' : ''}>Refill tank (mixed chemical)</button></div>` : ''}
        <p class="small muted">Land and disarm before swapping. Hot packs (&gt;45 °C) must cool before they charge. Rotate packs A → B → C to keep the job going.</p>`;
      p.querySelectorAll<HTMLButtonElement>('[data-pk]').forEach((b) => (b.onclick = () => void this.send({ t: 'pack', id: b.dataset.pk!, to: b.dataset.to as 'drone' })));
      const rf = p.querySelector<HTMLButtonElement>('#g-refill');
      if (rf) rf.onclick = () => { rf.classList.add('filling'); void this.send({ t: 'refill' }); };
    }
  }

  private renderFoot(t: Telemetry) {
    const slide = this.root.querySelector<HTMLElement>('#g-slide')!;
    const canStart = t.mission.lanes > 0 && !t.starting && !t.crashed && (t.gcsMode !== 5 || !t.armed);
    slide.classList.toggle('disabled', !canStart);
    this.root.querySelector('#g-slidetext')!.textContent = t.starting ? 'Pre-flight checks…' : !t.mission.lanes ? 'Plan an area first' : t.mission.bp ? 'Slide to resume from breakpoint' : t.armed && !t.landed ? 'Slide to start mission' : 'Slide to take off & spray';
    const a = this.root.querySelector<HTMLElement>('#g-actions')!;
    const html = t.starting ? '<button data-c="abort" class="danger">Cancel</button>' : t.armed ? '<button data-c="rth" class="warnbtn">RTH</button>' : '';
    if (a.innerHTML !== html) { a.innerHTML = html; a.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => (b.onclick = () => void this.send({ t: b.dataset.c as 'rth' }))); }
    // pre-flight checklist overlay
    const ck = this.root.querySelector<HTMLElement>('#g-checks')!;
    ck.style.display = t.checks.length ? 'block' : 'none';
    if (t.checks.length) ck.innerHTML = `<b>Pre-flight check</b>${t.checks.map((c) => `<div class="ck ${c.state}"><span>${c.state === 'ok' ? '✓' : c.state === 'fail' ? '✗' : '…'}</span>${esc(c.name)}<em>${esc(c.text)}</em></div>`).join('')}`;
    const mg = this.root.querySelector<HTMLElement>('#g-msg')!;
    const show = this.msg && performance.now() - this.msgAt < 5000;
    mg.style.display = show ? 'block' : 'none'; mg.textContent = show ? this.msg : ''; mg.className = 'gcs-msg' + (this.msgBad ? ' bad' : '');
  }

  private bindSlider() {
    const sl = this.root.querySelector<HTMLElement>('#g-slide')!, th = sl.querySelector<HTMLElement>('.slide-thumb')!, fill = sl.querySelector<HTMLElement>('.slide-fill')!;
    let x0 = 0, dragging = false;
    const set = (px: number) => { const max = sl.clientWidth - th.clientWidth - 6; const v = Math.max(0, Math.min(max, px)); th.style.transform = `translateX(${v}px)`; fill.style.width = `${v + th.clientWidth}px`; return v / max; };
    th.addEventListener('pointerdown', (e) => { if (sl.classList.contains('disabled')) return; dragging = true; x0 = e.clientX; th.setPointerCapture(e.pointerId); th.style.transition = 'none'; fill.style.transition = 'none'; });
    th.addEventListener('pointermove', (e) => { if (dragging) set(e.clientX - x0); });
    th.addEventListener('pointerup', (e) => {
      if (!dragging) return; dragging = false;
      const v = set(e.clientX - x0);
      th.style.transition = ''; fill.style.transition = '';
      if (v > 0.9) { set(9999); void this.send({ t: 'start' }); this.tab = 'fly'; this.renderPanel(true); setTimeout(() => set(0), 900); } else set(0);
    });
  }

  private frame() {
    if (this.embedded && !this.root.classList.contains('open')) return;
    const t = this.link.tel(), w = this.link.world();
    if (!t || !w) return;
    this.renderTop(t);
    this.drawMap(t, w);
    this.renderPanel();
    this.renderFoot(t);
  }

  open(tab?: 'plan' | 'fly' | 'battery') { if (tab) this.tab = tab; this.root.classList.add('open'); this.renderPanel(true); }
  close() { this.root.classList.remove('open'); (document.activeElement as HTMLElement | null)?.blur(); }
  isOpen() { return this.root.classList.contains('open'); }
  toggle() { if (this.isOpen()) this.close(); else this.open(); }
}
