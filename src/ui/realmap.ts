// Real map (Chhattisgarh): pick a real field on satellite imagery, choose the weather, and save it as
// a training ground. The ground is generated from OpenStreetMap (trees, buildings, power lines,
// farmland outline) + the satellite picture. Free sources only (Esri World Imagery, OSM, Overpass,
// Nominatim) through the server's cache — no API keys.
import L from 'leaflet';
import { mount, header, wireNav } from './screens';
import { settings, saveSettings } from '../settings';
import { ENV_PRESETS } from '../sim/wasm';
import { worldFromOsm, bboxFor, enu, BOX, type OsmJson } from '../maps/osm';
import { currentUser } from '../auth/client';

type Nav = (screen: string, arg?: unknown) => void;
interface MapMeta { id: string; name: string; lat: number; lon: number; createdAt: string; by: string; byId: string; env: Record<string, number>; stats: Record<string, number> }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const CG_BOUNDS: L.LatLngBoundsExpression = [[17.7, 80.2], [24.2, 84.5]];
const PRESET_NAMES: Record<string, string> = { calm: 'Calm', morning: 'Morning breeze', gusty: 'Gusty afternoon', poorGps: 'Poor GPS', hotHigh: 'Hot & high' };

let lmap: L.Map | null = null;

export function realMapScreen(nav: Nav) {
  lmap?.remove(); lmap = null;
  let home: [number, number] | null = null;
  let weather = 'calm';
  const root = mount(`${header('Real map — Chhattisgarh')}
    <div class="grid rm-grid">
      <div class="card rm-mapcard"><div id="rm-map" class="rm-map"></div>
        <div class="row" style="margin-top:10px"><button id="rm-sat" class="on">Satellite</button><button id="rm-osm">Streets</button>
        <span class="small muted" style="margin-left:auto">Imagery © Esri, Maxar · Map data © OpenStreetMap contributors</span></div></div>
      <div class="card">
        <h3>1 · Find the field</h3>
        <div class="row"><input id="rm-q" placeholder="Village, town or field (e.g. Abhanpur)" style="flex:1"><button id="rm-go">Search</button></div>
        <div id="rm-res" class="rm-res"></div>
        <h3>2 · Home point &amp; fly area</h3>
        <div class="rm-tools">
          <button id="rm-tpin" class="tool on" title="Click the map to place the take-off point">📍 Pin home</button>
          <button id="rm-tarea" class="tool" title="Click the map to add corners of the area you may fly / spray">▱ Draw fly area</button>
          <button id="rm-tbld" class="tool" title="Click the map to add a building (outline block)">🏠 Add building</button>
          <button id="rm-ttree" class="tool" title="Click the map to add a tree">🌳 Add tree</button>
          <button id="rm-undo" class="small">Undo point</button><button id="rm-clear" class="small danger">Clear area</button>
        </div>
        <p class="small" id="rm-hint">Choose a tool, then click on the map. Drag the pin or any corner to adjust.</p>
        <div class="kv small" id="rm-stats"><span>Home</span><span class="mono" id="rm-pos">not placed</span><span>Fly area</span><span id="rm-area">not drawn (optional)</span><span>Your objects</span><span id="rm-objs">none — OpenStreetMap data is added when available</span></div>
        <h3>3 · Weather</h3>
        <div class="row" id="rm-w">${Object.keys(ENV_PRESETS).map((k) => `<button data-w="${k}" class="${k === weather ? 'on' : ''}">${PRESET_NAMES[k]}</button>`).join('')}</div>
        <h3>4 · Save</h3>
        <div class="row"><input id="rm-name" placeholder="Name, e.g. Ramesh's paddy, Abhanpur" style="flex:1"></div>
        <button class="primary" id="rm-build" disabled>Build training ground</button>
        <div id="rm-prog" class="small"></div>
      </div>
    </div>
    <h2 style="margin-top:22px">Saved real maps</h2>
    <div class="grid" id="rm-list"><p class="muted">Loading…</p></div>`);
  wireNav(root, nav);
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;

  // ---- Leaflet map ----
  const m = L.map($('rm-map'), { maxBounds: CG_BOUNDS, maxBoundsViscosity: 0.8, minZoom: 7, maxZoom: 19, zoomControl: true }).setView([21.2514, 81.6296], 11);
  lmap = m;
  const sat = L.tileLayer('/tiles/sat/{z}/{x}/{y}', { maxZoom: 19, maxNativeZoom: 19 }).addTo(m);
  const osm = L.tileLayer('/tiles/osm/{z}/{x}/{y}', { maxZoom: 19 });
  $('rm-sat').onclick = () => { m.removeLayer(osm); sat.addTo(m); $('rm-sat').classList.add('on'); $('rm-osm').classList.remove('on'); };
  $('rm-osm').onclick = () => { m.removeLayer(sat); osm.addTo(m); $('rm-osm').classList.add('on'); $('rm-sat').classList.remove('on'); };
  // ---- tools: pin the home point, draw the fly area (geofence + spray area) ----
  let tool: 'pin' | 'area' | 'bld' | 'tree' = 'pin';
  const myBuildings: { m: L.Marker }[] = [], myTrees: { m: L.Marker }[] = [];
  let rect: L.Rectangle | null = null, mark: L.Marker | null = null;
  let area: L.LatLng[] = [];
  let poly: L.Polygon | null = null;
  const corners: L.Marker[] = [];
  const homeIcon = L.divIcon({ className: 'rm-home', html: 'H', iconSize: [28, 28] });
  const cornerIcon = (i: number) => L.divIcon({ className: 'rm-corner', html: String(i + 1), iconSize: [20, 20] });
  const inCG = (lat: number, lng: number) => lat > 17.7 && lat < 24.2 && lng > 80.2 && lng < 84.5;
  const setTool = (t: typeof tool) => {
    tool = t;
    $('rm-tpin').classList.toggle('on', t === 'pin'); $('rm-tarea').classList.toggle('on', t === 'area');
    $('rm-tbld').classList.toggle('on', t === 'bld'); $('rm-ttree').classList.toggle('on', t === 'tree');
    $('rm-map').classList.toggle('drawing', true);
    $('rm-hint').textContent = t === 'pin' ? 'Click where the pilot takes off. The orange box (160 × 190 m) is the 3D training ground.'
      : t === 'area' ? 'Click to add corners of the fly area (min. 3). Drag a corner to move it.'
      : t === 'bld' ? 'Click to place a building (10 × 8 m, 4 m high). Drag to move, right-click to delete.'
      : 'Click to place a tree. Drag to move, right-click to delete.';
  };
  $('rm-tpin').onclick = () => setTool('pin');
  $('rm-tbld').onclick = () => { if (!home) { $('rm-hint').textContent = 'Pin the home point first.'; return; } setTool('bld'); };
  $('rm-ttree').onclick = () => { if (!home) { $('rm-hint').textContent = 'Pin the home point first.'; return; } setTool('tree'); };
  const objIcon = (kind: 'bld' | 'tree') => L.divIcon({ className: kind === 'bld' ? 'rm-bld' : 'rm-tree', html: '', iconSize: kind === 'bld' ? [22, 18] : [16, 16] });
  const updateObjs = () => { $('rm-objs').textContent = myBuildings.length || myTrees.length ? `${myBuildings.length} buildings · ${myTrees.length} trees` : 'none — OpenStreetMap data is added when available'; };
  const addObj = (kind: 'bld' | 'tree', ll: L.LatLng) => {
    const list = kind === 'bld' ? myBuildings : myTrees;
    const mk = L.marker(ll, { icon: objIcon(kind), draggable: true }).addTo(m);
    const item = { m: mk };
    mk.on('contextmenu', () => { mk.remove(); list.splice(list.indexOf(item), 1); updateObjs(); });
    list.push(item); updateObjs();
  };
  $('rm-tarea').onclick = () => { if (!home) { $('rm-hint').textContent = 'Pin the home point first.'; return; } setTool('area'); };
  $('rm-undo').onclick = () => { area.pop(); redrawArea(); };
  $('rm-clear').onclick = () => { area = []; redrawArea(); };

  function placeHome(lat: number, lng: number) {
    home = [lat, lng];
    const c = enu(lat, lng);
    const [s, w] = c.from(BOX.x0, BOX.y0), [n, e] = c.from(BOX.x1, BOX.y1);
    rect?.remove();
    rect = L.rectangle([[s, w], [n, e]], { color: '#ff7a00', weight: 2, dashArray: '6 6', fillOpacity: 0.04, interactive: false }).addTo(m);
    if (!mark) {
      mark = L.marker([lat, lng], { icon: homeIcon, draggable: true, zIndexOffset: 1000 }).addTo(m);
      mark.on('drag', () => { const p = mark!.getLatLng(); if (inCG(p.lat, p.lng)) placeHome(p.lat, p.lng); });
    } else mark.setLatLng([lat, lng]);
    $('rm-pos').textContent = `${lat.toFixed(6)}° N, ${lng.toFixed(6)}° E`;
    $<HTMLButtonElement>('rm-build').disabled = false;
    redrawArea();
  }

  function redrawArea() {
    poly?.remove(); poly = null;
    corners.forEach((c) => c.remove()); corners.length = 0;
    if (area.length >= 2) poly = L.polygon(area, { color: '#3bceac', weight: 3, fillColor: '#3bceac', fillOpacity: 0.18, interactive: false }).addTo(m);
    area.forEach((ll, i) => {
      const c = L.marker(ll, { icon: cornerIcon(i), draggable: true }).addTo(m);
      c.on('drag', () => { area[i] = c.getLatLng(); poly?.setLatLngs(area); updateStats(); });
      c.on('contextmenu', () => { area.splice(i, 1); redrawArea(); });
      corners.push(c);
    });
    updateStats();
  }

  function updateStats() {
    const el = $('rm-area');
    if (area.length < 3 || !home) { el.textContent = area.length ? `${area.length} corner${area.length > 1 ? 's' : ''} — add at least 3` : 'not drawn (optional — the OSM field is used)'; el.className = ''; return; }
    const c = enu(home[0], home[1]);
    const pts = area.map((p) => c.to(p.lat, p.lng));
    let a = 0, per = 0;
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; per += Math.hypot(q[0] - p[0], q[1] - p[1]); });
    const fits = pts.every(([x, y]) => x >= BOX.x0 && x <= BOX.x1 && y >= BOX.y0 && y <= BOX.y1);
    el.innerHTML = `${(Math.abs(a) / 2 / 10000).toFixed(3)} ha · ${per.toFixed(0)} m perimeter${fits ? '' : ' · <b class="bad">goes outside the 3D box — move H or shrink it</b>'}`;
  }

  m.on('click', (ev: L.LeafletMouseEvent) => {
    const { lat, lng } = ev.latlng;
    if (!inCG(lat, lng)) { $('rm-hint').textContent = 'Outside Chhattisgarh — pick a point inside the state'; return; }
    if (tool === 'pin') {
      placeHome(lat, lng);
      if (m.getZoom() < 16) m.setView([lat + 0.0004, lng], 17);
      if (!area.length) setTool('area'); // next natural step
    } else if (tool === 'area') { area.push(ev.latlng); redrawArea(); }
    else addObj(tool, ev.latlng);
  });
  setTool('pin');
  setTimeout(() => m.invalidateSize(), 50);

  // ---- search ----
  const search = async () => {
    const q = $<HTMLInputElement>('rm-q').value.trim(); if (!q) return;
    $('rm-res').textContent = 'Searching…';
    try {
      const r = await fetch(`/geo/search?q=${encodeURIComponent(q)}`);
      const list = (await r.json()) as { name: string; lat: number; lon: number }[] | { error: string };
      if (!Array.isArray(list)) { $('rm-res').textContent = list.error; return; }
      $('rm-res').innerHTML = list.length ? list.map((p, i) => `<button class="small" data-i="${i}">${esc(p.name.split(',').slice(0, 3).join(','))}</button>`).join('') : 'Nothing found in Chhattisgarh';
      $('rm-res').querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => (b.onclick = () => { const p = list[+b.dataset.i!]; m.setView([p.lat, p.lon], 16); }));
    } catch { $('rm-res').textContent = 'Search unavailable (offline?) — pan the map by hand'; }
  };
  $('rm-go').onclick = () => void search();
  $<HTMLInputElement>('rm-q').onkeydown = (e) => { if (e.key === 'Enter') void search(); };
  $('rm-w').querySelectorAll<HTMLButtonElement>('[data-w]').forEach((b) => (b.onclick = () => { weather = b.dataset.w!; $('rm-w').querySelectorAll('[data-w]').forEach((x) => x.classList.toggle('on', x === b)); }));

  // ---- build + save ----
  $('rm-build').onclick = async () => {
    if (!home) return;
    const btn = $<HTMLButtonElement>('rm-build'); btn.disabled = true;
    const prog = $('rm-prog');
    const name = $<HTMLInputElement>('rm-name').value.trim() || `Field ${home[0].toFixed(4)}, ${home[1].toFixed(4)}`;
    try {
      prog.textContent = '1/2 Downloading buildings, trees, roads, power lines (OpenStreetMap)…';
      const bb = bboxFor(home[0], home[1], { x0: BOX.x0 - 30, x1: BOX.x1 + 30, y0: BOX.y0 - 30, y1: BOX.y1 + 30 });
      let osmData: OsmJson = { elements: [] }, note = '';
      try {
        const r = await fetch(`/geo/osm?s=${bb.s}&w=${bb.w}&n=${bb.n}&e=${bb.e}`);
        const j = (await r.json()) as OsmJson & { error?: string };
        if (r.ok) osmData = j; else note = j.error ?? 'map data unavailable';
      } catch { note = 'map data unavailable'; }
      const w = worldFromOsm(osmData, home[0], home[1], name);
      // your own buildings and trees (always included; they work even when OSM is unavailable)
      {
        const c = enu(home[0], home[1]);
        for (const b of myBuildings) {
          const [x, y] = c.to(b.m.getLatLng().lat, b.m.getLatLng().lng);
          if (Math.hypot(x, y) < 10) continue; // keep the pad clear
          w.boxes.unshift({ x, y, hx: 5, hy: 4, h: 4, kind: 'building', poly: [[x - 5, y - 4], [x + 5, y - 4], [x + 5, y + 4], [x - 5, y + 4]] });
        }
        for (const t of myTrees) {
          const [x, y] = c.to(t.m.getLatLng().lat, t.m.getLatLng().lng);
          if (Math.hypot(x, y) < 6) continue;
          w.trees.unshift({ x, y, trunkH: 3.5, crownR: 2.8 });
        }
        w.boxes = w.boxes.slice(0, 22); w.trees = w.trees.slice(0, 30);
        w.stats.buildings = w.boxes.length; w.stats.trees = w.trees.length;
      }
      if (area.length >= 3) {
        const c = enu(home[0], home[1]);
        const pts = area.map((p) => { const [x, y] = c.to(p.lat, p.lng); return [Math.max(BOX.x0, Math.min(BOX.x1, x)), Math.max(BOX.y0, Math.min(BOX.y1, y))] as [number, number]; });
        w.fieldPoly = pts; w.geofence = pts;
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        w.field = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), rowSpacing: 1.2 };
      }
      prog.textContent = '2/2 Saving…';
      const { stats, ...world } = w;
      const img = '';
      const env = { ...ENV_PRESETS[weather] };
      const sr = await fetch('/api/maps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, lat: home[0], lon: home[1], env, stats, world, ground: img }) });
      const saved = (await sr.json()) as MapMeta & { error?: string };
      if (!sr.ok) throw new Error(saved.error ?? 'save failed');
      prog.innerHTML = `${note ? `<span class="bad">OpenStreetMap: ${esc(note)} — built with your own area, buildings and trees only.</span><br>` : ''}Saved <b>${esc(saved.name)}</b>: ${stats.buildings} buildings, ${stats.trees} trees, ${stats.poles} power poles, field ${stats.fieldM2 ? (stats.fieldM2 / 10000).toFixed(2) + ' ha' : 'not mapped (default area)'}.
        <div class="row" style="margin-top:8px"><button class="primary" id="rm-fly">Fly here now</button></div>`;
      $('rm-fly').onclick = () => flyMap(saved, nav);
      void loadList();
    } catch (e) {
      prog.textContent = `Could not build: ${e instanceof Error ? e.message : String(e)}`;
    } finally { btn.disabled = false; }
  };

  async function loadList() {
    const box = $('rm-list');
    try {
      const r = await fetch('/api/maps');
      const list = (await r.json()) as MapMeta[];
      if (!Array.isArray(list) || !list.length) { box.innerHTML = '<p class="muted">No saved maps yet.</p>'; return; }
      box.innerHTML = list.map((mm) => `<div class="card ${settings.place.id === 'map:' + mm.id ? 'sel' : ''}">
        <div class="row spread"><b>${esc(mm.name)}</b><span class="tag">real map</span></div>
        <div class="small mono">${mm.lat.toFixed(5)}° N, ${mm.lon.toFixed(5)}° E</div>
        <div class="small">${mm.stats.buildings ?? 0} buildings · ${mm.stats.trees ?? 0} trees · ${mm.stats.poles ?? 0} poles · ${PRESET_NAMES[Object.keys(ENV_PRESETS).find((k) => ENV_PRESETS[k].windSpd === mm.env.windSpd && ENV_PRESETS[k].gust === mm.env.gust) ?? ''] ?? `wind ${mm.env.windSpd} m/s`}</div>
        <div class="small muted">by ${esc(mm.by)} · ${new Date(mm.createdAt).toLocaleDateString()}</div>
        <div class="row" style="margin-top:8px"><button class="primary small" data-fly="${mm.id}">Fly here</button><button class="small" data-show="${mm.id}">Show on map</button>
        ${currentUser?.role === 'admin' || currentUser?.id === mm.byId ? `<button class="small danger" data-del="${mm.id}">Delete</button>` : ''}</div></div>`).join('');
      box.querySelectorAll<HTMLButtonElement>('[data-fly]').forEach((b) => (b.onclick = () => flyMap(list.find((x) => x.id === b.dataset.fly)!, nav)));
      box.querySelectorAll<HTMLButtonElement>('[data-show]').forEach((b) => (b.onclick = () => { const mm = list.find((x) => x.id === b.dataset.show)!; m.setView([mm.lat, mm.lon], 17); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
      box.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => (b.onclick = async () => {
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirm delete'; setTimeout(() => { b.dataset.armed = ''; b.textContent = 'Delete'; }, 3000); return; }
        await fetch(`/api/maps/${b.dataset.del}`, { method: 'DELETE' }); void loadList();
      }));
    } catch { box.innerHTML = '<p class="muted">Server unreachable.</p>'; }
  }
  void loadList();
}

/** Select a saved map as the training ground, apply its weather, and fly. */
function flyMap(mm: MapMeta, nav: Nav) {
  settings.place = { id: 'map:' + mm.id, category: 'agri', seed: 0 };
  Object.assign(settings.env, mm.env, { hdri: settings.env.hdri, timeOfDay: settings.env.timeOfDay, holdAssist: settings.env.holdAssist, crop: settings.env.crop, grass: settings.env.grass, tankFill: settings.env.tankFill, battSoc: settings.env.battSoc });
  saveSettings();
  lmap?.remove(); lmap = null;
  nav('fly');
}
