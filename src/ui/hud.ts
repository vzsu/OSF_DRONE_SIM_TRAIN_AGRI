// Flight HUD: telemetry like a real agri GCS / RC screen, minimap with spray coverage, stick monitor, warnings.
import type { Engine } from '../sim/engine';
import { settings } from '../settings';
import { FIELD, TREES, POLES, HOUSE, HOME, BOXES, CROWD, WORLD, fenceBreach } from '../data/world';
import { GRID } from '../sim/coverage';
import { planLanes } from '../sim/mission';
import { pulse } from './motion';
import gsap from 'gsap';

const $ = (id: string) => document.getElementById(id)!;
const WARN_TEXT: [number, string][] = [
  [64, 'RC LINK LOST'], [2, 'BATTERY CRITICAL'], [1, 'BATTERY LOW'], [4, 'GPS LOST / POOR'],
  [16, 'VORTEX RING STATE'], [8, 'HIGH WIND'], [32, 'TANK EMPTY'], [256, 'GPS HDOP HIGH'],
];

export class Hud {
  root = $('hud');
  private last = 0;
  private trail: { x: number; y: number }[] = [];
  private lastTrail = { x: 1e9, y: 1e9 };
  private mini!: HTMLCanvasElement;
  private covCanvas = document.createElement('canvas');
  private lanes: { a: [number, number]; b: [number, number] }[] = [];
  private big = false;
  overCrowd = false;
  private rec = false;
  private recStart = 0;
  private photos = 0;
  toggleRec() { this.rec = !this.rec; this.recStart = performance.now(); }
  get recording() { return this.rec; }
  camState() { return { rec: this.rec, recSec: this.rec ? (performance.now() - this.recStart) / 1000 : 0, photos: this.photos }; }
  /** shutter: white flash on the screen */
  photo() {
    this.photos++;
    const f = document.createElement('div'); f.className = 'shutter-flash'; document.body.appendChild(f);
    setTimeout(() => f.remove(), 260);
  }
  private lastCov = 0;

  constructor() {
    this.root.innerHTML = `
      <div class="box top">
        <span class="mode" id="h-mode">—</span>
        <span class="armed" id="h-armed">—</span>
        <span id="h-time">00:00</span>
        <span id="h-gps">GPS —</span>
        <span id="h-batt">— V</span>
        <span id="h-link">RC —</span>
      </div>
      <div class="box warnbar" id="h-warn"></div>
      <div class="box left altbox">
        <canvas id="h-tape" width="54" height="190"></canvas>
        <div class="altnums">
        <div class="lbl">HEIGHT ABOVE GROUND</div><div class="big" id="h-agl">0.0</div>
        <div class="line"><span>Above crop</span><span id="h-crop">—</span></div>
        <div class="line"><span>Above take-off</span><span id="h-rel">0.0</span></div>
        <div class="line"><span>Altitude MSL</span><span id="h-msl">—</span></div>
        <div class="line"><span>Vertical speed</span><span id="h-vs">0.0</span></div>
        <div class="line"><span>Target height</span><span id="h-tgt">—</span></div>
        <div class="line"><span>ROLL/PITCH</span><span id="h-att">0/0</span></div>
        <div class="line"><span>THR OUT</span><span id="h-thr">0%</span></div>
        </div>
      </div>
      <div class="box right">
        <div class="lbl">GND SPEED</div><div class="big" id="h-gs">0.0</div>
        <div class="line"><span>AIRSPEED</span><span id="h-as">0.0</span></div>
        <div class="line"><span>HDG</span><span id="h-hdg">000°</span></div>
        <div class="line"><span>WIND @DRONE</span><span id="h-wind">0.0</span></div>
        <div class="line"><span>REL DIR</span><span id="h-windarrow" style="display:inline-block">↓</span></div>
        <div class="line"><span>WIND @GROUND</span><span id="h-gwind">0.0</span></div>
        <div class="line"><span>HOME</span><span id="h-home">0 m</span></div>
      </div>
      <div class="box bottom">
        <div><div class="lbl">TANK</div><div id="h-tank">—</div></div>
        <div><div class="lbl">SPRAY</div><div id="h-spray">OFF</div></div>
        <div><div class="lbl">MASS</div><div id="h-mass">—</div></div>
        <div><div class="lbl">POWER</div><div id="h-pwr">—</div></div>
        <div><div class="lbl">VIEW</div><div id="h-view">VLOS</div></div>
        <div><div class="lbl">LATENCY</div><div id="h-lat">—</div></div>
      </div>
      <div class="box sticks" id="h-sticks">
        <div class="stickcol"><div class="stick" id="h-stl"><b class="ax h"></b><b class="ax v"></b><em class="lab t">THR</em><em class="lab r">YAW</em><i></i></div><div class="sval" id="h-stlv"></div></div>
        <div class="stickcol"><div class="stick" id="h-str"><b class="ax h"></b><b class="ax v"></b><em class="lab t">PITCH</em><em class="lab r">ROLL</em><i></i></div><div class="sval" id="h-strv"></div></div>
      </div>
      <div class="box mini" id="h-minibox"><canvas id="h-mini" width="200" height="220"></canvas><div class="small" id="h-cov"></div></div>
      <div class="box mission" id="h-mission"></div>
      <div class="camosd" id="h-cam"><div class="thirds"></div><div class="rec" id="h-rec"></div><div class="camline" id="h-camline"></div></div>
      <div class="help" id="h-help">Esc pause · V view · keyboard: W/S thr · A/D yaw · arrows pitch/roll · Enter arm · 1 STAB 2 ALT HOLD 3 LOITER · Space spray · [ ] pump · K E-stop · R RTL · 4 AUTO · M map · B battery/refill · Backspace reset · camera drones: C record, PgUp/PgDn gimbal tilt, T track subject, F Follow/FPV</div>
    `;
    this.mini = $('h-mini') as HTMLCanvasElement;
    gsap.set($('h-warn'), { xPercent: -50, x: 0 }); // centred via GSAP so pulses keep it centred
    this.covCanvas.width = GRID.w; this.covCanvas.height = GRID.h;
  }

  missionChanged() { this.lanes = settings.mission.poly.length >= 3 ? planLanes(settings.mission) : []; }
  /** H: hide everything except warnings (clean view for watching / filming). */
  hidden = false;
  toggleHidden() { this.hidden = !this.hidden; this.root.classList.toggle('off', this.hidden); }
  /** set by main while a lesson / exercise runs: keep the screen free of mission/game clutter */
  inLesson = false;
  toggleBigMap() {
    this.big = !this.big;
    $('h-minibox').classList.toggle('large', this.big);
    this.mini.width = this.big ? 560 : 200; this.mini.height = this.big ? 620 : 220;
  }

  show(on: boolean) { this.root.classList.toggle('hidden', !on); }
  resetTrail() { this.trail = []; this.lastTrail = { x: 1e9, y: 1e9 }; this.rec = false; }

  update(e: Engine, now: number) {
    this.root.classList.toggle('detail', !!settings.display.hudDetail);
    this.root.classList.toggle('lesson', this.inLesson);
    const o = (k: Parameters<Engine['o']>[0]) => e.o(k);
    if (o('ARMED') > 0.5) {
      const x = o('X'), y = o('Y');
      if (Math.hypot(x - this.lastTrail.x, y - this.lastTrail.y) > 1) { this.trail.push({ x, y }); this.lastTrail = { x, y }; if (this.trail.length > 1500) this.trail.shift(); }
    }
    if (now - this.last < 66) return; // ~15 Hz text updates
    this.last = now;
    const imp = settings.display.units === 'imperial';
    const dist = (m: number) => imp ? `${(m * 3.281).toFixed(1)} ft` : `${m.toFixed(1)} m`;
    const spd = (v: number) => imp ? `${(v * 2.237).toFixed(1)} mph` : `${v.toFixed(1)} m/s`;
    const names = e.modeNames();
    $('h-mode').textContent = names[o('MODE')] ?? '?';
    const armed = o('ARMED') > 0.5, crashed = o('CRASHED') > 0.5;
    const a = $('h-armed'); a.textContent = crashed ? 'CRASHED' : armed ? 'ARMED' : 'DISARMED'; a.className = 'armed ' + (armed || crashed ? 'on' : 'off');
    const ft = o('FLIGHT_TIME'); $('h-time').textContent = `${String(Math.floor(ft / 60)).padStart(2, '0')}:${String(Math.floor(ft % 60)).padStart(2, '0')}`;
    const sats = o('SATS'), hdop = o('HDOP'), fix = o('FIX');
    const fixTxt = fix >= 3 ? (e.drone.rtk && sats >= 12 ? 'RTK' : '3D') : fix === 2 ? '2D' : 'NO FIX';
    const g = $('h-gps'); g.textContent = `SAT ${sats.toFixed(0)} · HDOP ${hdop > 50 ? '--' : hdop.toFixed(1)} · ${fixTxt}`;
    g.className = sats >= e.drone.minSats && hdop <= 2 ? 'ok' : sats >= 6 ? 'warn' : 'bad';
    const soc = o('BATT_SOC') * 100;
    const b = $('h-batt'); b.textContent = `${o('BATT_V').toFixed(1)} V · ${soc.toFixed(0)}% · ${o('BATT_I').toFixed(0)} A`;
    b.className = soc > e.drone.lowBatt ? 'ok' : soc > e.drone.critBatt ? 'warn' : 'bad';
    const link = e.sticks.ok && !e.rcLost;
    const l = $('h-link'); l.textContent = link ? `RC ${e.sticks.source === 'Keyboard' ? 'KBD' : 'OK'}` : 'RC LOST'; l.className = link ? 'ok' : 'bad';
    const agl = o('RADAR_AGL') >= 0 ? o('RADAR_AGL') : o('Z');
    const hGround = o('Z'), cropH = e.env.cropH ?? 0;
    $('h-agl').textContent = dist(hGround);
    $('h-crop').textContent = cropH > 0 && o('RADAR_AGL') >= 0 ? `${dist(agl)} (radar)` : '—';
    $('h-rel').textContent = dist(o('BARO_ALT'));
    $('h-msl').textContent = dist(e.env.elev + hGround);
    const vsv = o('VSPEED');
    $('h-vs').textContent = `${Math.abs(vsv) < 0.05 ? '' : vsv > 0 ? '▲ ' : '▼ '}${spd(Math.abs(vsv))}`;
    this.drawTape(hGround, o('MODE') === 0 ? NaN : o('TGT_ALT') + (hGround - agl), vsv);
    $('h-tgt').textContent = o('MODE') === 0 ? '—' : dist(o('TGT_ALT'));
    $('h-att').textContent = `${(o('ROLL') * 57.3).toFixed(0)}° / ${(-o('PITCH') * 57.3).toFixed(0)}°`;
    $('h-thr').textContent = `${(o('THR_OUT') * 100).toFixed(0)}%`;
    $('h-gs').textContent = spd(o('GNDSPEED'));
    $('h-as').textContent = spd(o('AIRSPEED'));
    const hdg = o('HEADING');
    $('h-hdg').textContent = `${hdg.toFixed(0).padStart(3, '0')}°`;
    const wx = o('WIND_X'), wy = o('WIND_Y');
    const ws = Math.hypot(wx, wy);
    const windTo = Math.atan2(wx, wy) * 57.3; // compass deg the wind blows toward
    $('h-wind').textContent = `${spd(ws)} from ${(((windTo + 180) % 360 + 360) % 360).toFixed(0)}°`;
    ($('h-windarrow') as HTMLElement).style.transform = `rotate(${windTo - hdg + 180}deg)`;
    $('h-gwind').textContent = `${spd(e.env.windSpd * Math.pow(0.5, 0.143))} from ${e.env.windDir.toFixed(0)}°`;
    $('h-home').textContent = dist(o('HOME_DIST'));
    $('h-tank').textContent = e.drone.tankCap > 0 ? `${o('TANK_L').toFixed(1)} / ${e.drone.tankCap} L` : 'n/a';
    const sp = $('h-spray'); const pump = Math.round(e.sticks.flow * 100); sp.textContent = o('SPRAYING') > 0.5 ? `ON ${(e.drone.flowLpm * e.sticks.flow).toFixed(1)} L/min (${pump}%)` : `${e.sticks.spray ? 'ARMED' : 'OFF'} · pump ${pump}%`; sp.className = o('SPRAYING') > 0.5 ? 'ok' : '';
    $('h-mass').textContent = `${o('MASS').toFixed(1)} kg`;
    $('h-pwr').textContent = `${(o('POWER_W') / 1000).toFixed(2)} kW`;
    $('h-view').textContent = settings.camera.view.toUpperCase();
    $('h-lat').textContent = `${(e.frameMs).toFixed(0)} ms frame + ${settings.latency.linkMs} ms link`;
    // warnings
    const w = o('WARN');
    const msgs = WARN_TEXT.filter(([bit]) => (w & bit) !== 0).map(([, t]) => t);
    if (crashed) msgs.unshift('CRASH');
    if (e.sticks.kill) msgs.unshift('EMERGENCY STOP SWITCH ON');
    if (this.overCrowd) msgs.unshift('OVER PEOPLE — MOVE AWAY');
    { const fb = fenceBreach(e.o('X'), e.o('Y')); if (fb > 0 && e.o('ARMED') > 0.5) msgs.unshift(`OUTSIDE FLY AREA (${fb.toFixed(0)} m)`); }
    this.cameraOsd(e, now);
    const wb = $('h-warn'); const wt = msgs.slice(0, 3).join(' · ');
    if (wt && wt !== wb.textContent) pulse(wb, true);
    wb.style.display = msgs.length ? 'block' : 'none'; wb.textContent = wt;
    // sticks (Mode 2: left = yaw/throttle, right = roll/pitch; Mode 1 swaps throttle/pitch sides)
    const s = e.sticks;
    $('h-sticks').style.display = settings.display.showSticks ? 'flex' : 'none';
    const place = (id: string, x: number, y: number) => {
      const i = $(id).querySelector('i') as HTMLElement; i.style.left = `${50 + x * 45}%`; i.style.top = `${50 - y * 45}%`;
    };
    place('h-stl', s.yaw, s.thr * 2 - 1);
    place('h-str', s.roll, s.pitch);
    const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100)).toString().padStart(3, ' ')}`;
    $('h-stlv').textContent = `T ${Math.round(s.thr * 100).toString().padStart(3, ' ')}%  Y ${pct(s.yaw)}`;
    $('h-strv').textContent = `P ${pct(s.pitch)}  R ${pct(s.roll)}`;
    this.missionPanel(e);
    this.drawMini(e, now);
  }

  /** DJI-style camera OSD in the gimbal camera view: rule-of-thirds grid, REC timer, gimbal angle, height/distance. */
  private cameraOsd(e: Engine, now: number) {
    const el = $('h-cam');
    const on = settings.camera.view === 'cam';
    el.style.display = on ? 'block' : 'none';
    if (!on) return;
    const t = (now - this.recStart) / 1000;
    $('h-rec').innerHTML = this.rec ? `<span class="dot"></span> REC ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}` : 'STANDBY · press C to record';
    const w = window as unknown as { __sim?: { world: { gimbalPitch: number; gimbal: { mode: string } } } };
    const gp = w.__sim?.world.gimbalPitch ?? 0, gm = w.__sim?.world.gimbal.mode ?? 'follow';
    $('h-cam').classList.toggle('tracking', gm === 'track');
    $('h-camline').textContent = `4K 30fps · ISO 100 · 1/60 · gimbal ${gp.toFixed(0)}° ${gm === 'track' ? '· ◎ TRACKING (T)' : gm === 'fpv' ? '· FPV' : '· FOLLOW'} · H ${e.o('Z').toFixed(1)} m · D ${e.o('HOME_DIST').toFixed(0)} m · ${e.o('GNDSPEED').toFixed(1)} m/s`;
  }

  /** Vertical altitude tape (height above ground), target bug and vertical-speed bar. */
  private drawTape(h: number, tgt: number, vs: number) {
    const c = $('h-tape') as HTMLCanvasElement, g = c.getContext('2d')!;
    const W = c.width, H = c.height, mid = H / 2, ppm = 9; // pixels per metre
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, W - 10, H);
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '10px ui-monospace, monospace'; g.lineWidth = 1;
    for (let m = Math.floor(h - mid / ppm); m <= h + mid / ppm; m++) {
      if (m < 0) continue;
      const y = mid - (m - h) * ppm;
      const major = m % 5 === 0;
      g.beginPath(); g.moveTo(W - 10, y); g.lineTo(W - 10 - (major ? 12 : 6), y); g.stroke();
      if (major) g.fillText(String(m), 3, y + 3);
    }
    // ground line
    const gy = mid + h * ppm; if (gy < H) { g.fillStyle = 'rgba(140,100,60,0.55)'; g.fillRect(0, gy, W - 10, H - gy); }
    if (Number.isFinite(tgt)) { const ty = mid - (tgt - h) * ppm; g.fillStyle = '#3cc9ff'; g.beginPath(); g.moveTo(W - 10, ty); g.lineTo(W - 18, ty - 5); g.lineTo(W - 18, ty + 5); g.fill(); }
    // current value pointer
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(W - 10, mid); g.lineTo(W - 18, mid - 6); g.lineTo(W - 18, mid + 6); g.fill();
    // vertical speed bar on the right edge (±3 m/s full scale)
    const vh = Math.max(-1, Math.min(1, vs / 3)) * (mid - 6);
    g.fillStyle = vs >= 0 ? '#3ccf7a' : '#ffb020'; g.fillRect(W - 6, Math.min(mid, mid - vh), 5, Math.abs(vh));
  }

  private missionPanel(e: Engine) {
    const m = e.mission, el = $('h-mission');
    const armed = e.o('ARMED') > 0.5, landed = e.o('LANDED') > 0.5;
    const lines: string[] = [];
    if (m.legs.length) {
      const phase = { idle: 'ready', takeoff: 'take-off', toBreak: '→ breakpoint', leg: m.legs[m.idx]?.spray ? 'spraying lane' : 'transit', land: 'landing', done: 'complete' }[m.phase];
      const pct = m.laneCount ? Math.round(m.lanesDone / m.laneCount * 100) : 0;
      lines.push(`<b>MISSION</b> ${phase} · lane ${Math.min(m.lanesDone + 1, m.laneCount)}/${m.laneCount} · ${pct}%`);
      lines.push(`<div class="bar"><i style="width:${pct}%"></i></div>`);
      if (m.phase === 'leg' && m.legs[m.idx]?.spray) lines.push(`Cross-track ${m.xte.toFixed(2)} m`);
      if (m.breakpoint) lines.push(`<span class="warn">Breakpoint: ${m.breakpoint.reason}</span>`);
      if (e.o('MODE') !== 5 && m.phase !== 'done') lines.push('<span class="small">Mode switch → AUTO (key 4) to run</span>');
    }
    if (!armed && landed && (e.o('BATT_SOC') * 100 < e.drone.lowBatt + 10 || (e.drone.tankCap > 0 && e.o('TANK_L') < e.drone.tankCap * 0.1))) {
      lines.push('<span class="warn">On the pad: press <b>B</b> to swap battery + refill tank</span>');
    }
    el.style.display = lines.length ? 'block' : 'none';
    el.innerHTML = lines.join('<br>');
  }

  private drawMini(e: Engine, now: number) {
    const c = this.mini, g = c.getContext('2d')!;
    const W = c.width, H = c.height;
    const x0 = -75, x1 = 75, y0 = -45, y1 = 130;
    const sc = Math.min(W / (x1 - x0), H / (y1 - y0));
    const X = (x: number) => (x - x0) * sc, Y = (y: number) => H - (y - y0) * sc;
    g.fillStyle = '#26301f'; g.fillRect(0, 0, W, H);
    g.fillStyle = WORLD.category === 'wedding' ? '#5f9a45' : '#4c6a28'; g.fillRect(X(FIELD.x0), Y(FIELD.y1), (FIELD.x1 - FIELD.x0) * sc, (FIELD.y1 - FIELD.y0) * sc);
    // mission area + planned lanes
    const poly = settings.mission.poly;
    if (poly.length >= 3) {
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.beginPath();
      poly.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1; g.beginPath();
      for (const l of this.lanes) { g.moveTo(X(l.a[0]), Y(l.a[1])); g.lineTo(X(l.b[0]), Y(l.b[1])); }
      g.stroke();
    }
    // spray coverage (blue = once, amber = overlap, red = off-target/drift), refreshed at 4 Hz
    if (e.coverage.dirty && now - this.lastCov > 250) {
      this.covCanvas.getContext('2d')!.putImageData(e.coverage.image(), 0, 0);
      e.coverage.dirty = false; this.lastCov = now;
      const st = e.coverage.stats();
      $('h-cov').textContent = st.sprayedM2 ? `Coverage ${st.coveredPct.toFixed(0)}% · overlap ${st.overlapPct.toFixed(0)}% · drift ${st.offTargetM2.toFixed(0)} m²` : '';
    }
    g.imageSmoothingEnabled = false;
    g.drawImage(this.covCanvas, X(GRID.x0), Y(GRID.y0 + GRID.h), GRID.w * sc, GRID.h * sc);
    g.fillStyle = '#2f5a25'; for (const t of TREES) { g.beginPath(); g.arc(X(t.x), Y(t.y), t.crownR * sc, 0, 7); g.fill(); }
    g.strokeStyle = '#e8d24a'; g.lineWidth = 1; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(X(POLES[0].x), Y(POLES[0].y)); g.lineTo(X(POLES[POLES.length - 1].x), Y(POLES[POLES.length - 1].y)); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#b89a70'; g.fillRect(X(HOUSE.x - HOUSE.hx), Y(HOUSE.y + HOUSE.hy), HOUSE.hx * 2 * sc, HOUSE.hy * 2 * sc);
    g.fillStyle = '#fff'; g.font = `${this.big ? 14 : 10}px monospace`; g.fillText('H', X(HOME.x) - 3, Y(HOME.y) + 4);
    g.fillStyle = '#4ea3ff'; g.beginPath(); g.arc(X(settings.camera.pilotX), Y(settings.camera.pilotY), 3, 0, 7); g.fill();
    // venue items (wedding): tents/stage/canopy and guest areas (red hatched = no-fly)
    for (const b of BOXES) { g.fillStyle = b.kind === 'stage' ? '#8a1c2b' : b.kind === 'canopy' ? '#d94f2a' : '#e8e2d6'; g.fillRect(X(b.x - b.hx), Y(b.y + b.hy), b.hx * 2 * sc, b.hy * 2 * sc); }
    g.strokeStyle = '#ff4a4a'; g.lineWidth = 1.5;
    for (const c of CROWD) { g.fillStyle = 'rgba(255,60,60,0.25)'; g.fillRect(X(c.x0), Y(c.y1), (c.x1 - c.x0) * sc, (c.y1 - c.y0) * sc); g.strokeRect(X(c.x0), Y(c.y1), (c.x1 - c.x0) * sc, (c.y1 - c.y0) * sc); }
    // fly area (geofence)
    if (WORLD.geofence && WORLD.geofence.length > 2) {
      g.strokeStyle = '#3bceac'; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath();
      WORLD.geofence.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); g.stroke(); g.setLineDash([]);
    }
    // flight trail: blue (oldest) → yellow (newest)
    const tn = this.trail.length;
    g.lineWidth = this.big ? 2.5 : 1.5;
    for (let i = 1; i < tn; i++) {
      const a = this.trail[i - 1], b = this.trail[i];
      if (Math.hypot(b.x - a.x, b.y - a.y) > 6) continue;
      const u = i / (tn - 1);
      g.strokeStyle = `rgb(${Math.round(30 + 225 * u)},${Math.round(115 + 115 * u)},${Math.round(255 - 230 * u)})`;
      g.beginPath(); g.moveTo(X(a.x), Y(a.y)); g.lineTo(X(b.x), Y(b.y)); g.stroke();
    }
    // current mission leg + breakpoint
    const m = e.mission;
    const leg = m.legs[m.idx];
    if (leg && (m.phase === 'leg' || m.phase === 'toBreak')) {
      g.strokeStyle = '#3ccf7a'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(leg.a[0]), Y(leg.a[1])); g.lineTo(X(leg.b[0]), Y(leg.b[1])); g.stroke();
    }
    if (m.breakpoint) { g.fillStyle = '#ff5a4a'; g.fillRect(X(m.breakpoint.x) - 4, Y(m.breakpoint.y) - 4, 8, 8); g.fillText('BP', X(m.breakpoint.x) + 6, Y(m.breakpoint.y) + 4); }
    // drone
    const px = X(e.o('X')), py = Y(e.o('Y')), yaw = e.o('YAW');
    const k = this.big ? 1.6 : 1;
    g.save(); g.translate(px, py); g.rotate(-yaw); g.scale(k, k);
    g.fillStyle = '#ff7a1a'; g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, 5); g.lineTo(-2, 0); g.lineTo(-5, -5); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#ccc'; g.fillText(this.big ? 'N↑  10 m   (M to close)' : 'N↑  10 m', 4, 12);
    g.strokeStyle = '#ccc'; g.beginPath(); g.moveTo(this.big ? 60 : 60, this.big ? 20 : 8); g.lineTo(60 + 10 * sc, this.big ? 20 : 8); g.stroke();
  }
}
