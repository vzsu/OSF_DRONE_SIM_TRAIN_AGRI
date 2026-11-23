// Real map (Chhattisgarh): pick a real field on satellite imagery, choose the weather, and save it as
// a training ground. The ground is generated from OpenStreetMap (trees, buildings, power lines,
// farmland outline) + the satellite picture. Free sources only (Esri World Imagery, OSM, Overpass,
// Nominatim) through the server's cache — no API keys.
import L from 'leaflet';
import { mount, header, wireNav } from './screens';
import { settings, saveSettings } from '../settings';
import { ENV_PRESETS } from '../sim/wasm';
import { worldFromOsm, groundImage, bboxFor, enu, BOX, GROUND, type OsmJson } from '../maps/osm';
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
        <h3>2 · Click the take-off point</h3>
        <p class="small">Click on the map where the pilot takes off (<b>H</b>). The orange box (160 × 190 m) becomes the training ground. Click again to move it.</p>
        <p class="small mono" id="rm-pos">no point yet</p>
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
  let rect: L.Rectangle | null = null, mark: L.Marker | null = null;
  const icon = L.divIcon({ className: 'rm-home', html: 'H', iconSize: [26, 26] });
  m.on('click', (ev: L.LeafletMouseEvent) => {
    const { lat, lng } = ev.latlng;
    if (lat < 17.7 || lat > 24.2 || lng < 80.2 || lng > 84.5) { $('rm-pos').textContent = 'Outside Chhattisgarh — pick a point inside the state'; return; }
    home = [lat, lng];
    const c = enu(lat, lng);
    const [s, w] = c.from(BOX.x0, BOX.y0), [n, e] = c.from(BOX.x1, BOX.y1);
    rect?.remove(); mark?.remove();
    rect = L.rectangle([[s, w], [n, e]], { color: '#ff7a00', weight: 3, fillOpacity: 0.08 }).addTo(m);
    mark = L.marker([lat, lng], { icon }).addTo(m);
    $('rm-pos').textContent = `H ${lat.toFixed(6)}° N, ${lng.toFixed(6)}° E`;
    $<HTMLButtonElement>('rm-build').disabled = false;
    if (m.getZoom() < 16) m.setView([lat + (n - s) * 0.25, lng], 17);
  });
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
      prog.textContent = '1/3 Downloading trees, buildings, power lines and fields (OpenStreetMap)…';
      const bb = bboxFor(home[0], home[1], { x0: BOX.x0 - 30, x1: BOX.x1 + 30, y0: BOX.y0 - 30, y1: BOX.y1 + 30 });
      const r = await fetch(`/geo/osm?s=${bb.s}&w=${bb.w}&n=${bb.n}&e=${bb.e}`);
      const osmData = (await r.json()) as OsmJson & { error?: string };
      if (!r.ok) throw new Error(osmData.error ?? 'map data unavailable');
      const w = worldFromOsm(osmData, home[0], home[1], name);
      prog.textContent = '2/3 Building the satellite ground picture…';
      const img = await groundImage(home[0], home[1]);
      prog.textContent = '3/3 Saving…';
      const { stats, ...world } = w;
      world.ground = { url: '', ...GROUND };
      const env = { ...ENV_PRESETS[weather] };
      const sr = await fetch('/api/maps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, lat: home[0], lon: home[1], env, stats, world, ground: img }) });
      const saved = (await sr.json()) as MapMeta & { error?: string };
      if (!sr.ok) throw new Error(saved.error ?? 'save failed');
      prog.innerHTML = `Saved <b>${esc(saved.name)}</b>: ${stats.buildings} buildings, ${stats.trees} trees, ${stats.poles} power poles, field ${stats.fieldM2 ? (stats.fieldM2 / 10000).toFixed(2) + ' ha' : 'not mapped (default area)'}.
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
