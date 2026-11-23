// Extra HTTP endpoints handled directly by the Node server (before Next.js):
//
//  /live/*   Phone / tablet screen relay. No WebRTC (phone hotspots and mDNS break it): the sim
//            posts telemetry + JPEG camera frames, the server fans them out to every viewer over
//            Server-Sent Events (telemetry, ~10 Hz) and an MJPEG stream (camera). Commands from the
//            phone go back to the sim over its own SSE stream. Pairing is a QR code with an
//            unguessable token.
//  /tiles/*  Map tiles proxy + disk cache (Esri World Imagery satellite, OpenStreetMap streets).
//  /geo/*    Place search (Nominatim) and map features (Overpass) proxy + cache, Chhattisgarh only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';

const UA = 'OSF-Drone-Trainer/0.6 (offline-capable LAN training simulator)';
// Chhattisgarh bounding box (with a small margin)
export const CG = { s: 17.7, n: 24.2, w: 80.2, e: 84.5 };
const DATA = path.join(process.cwd(), 'data');

// ---------------- live relay ----------------
const rooms = new Map(); // token → room
const TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;
const ROOM_TTL = 8 * 3600_000;

function room(token) {
  const r = rooms.get(token);
  if (r) r.seen = Date.now();
  return r;
}
setInterval(() => { const now = Date.now(); for (const [k, r] of rooms) if (now - r.seen > ROOM_TTL) { for (const c of [...r.viewers, ...r.hosts, ...r.video]) c.end(); rooms.delete(k); } }, 60_000).unref();

function readBody(req, max) {
  return new Promise((res, rej) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > max) { rej(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
function sse(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(': ok\n\n');
  const ka = setInterval(() => res.write(': ka\n\n'), 15_000);
  res.on('close', () => clearInterval(ka));
}
const send = (set, event, data) => { for (const c of set) c.write(`event: ${event}\ndata: ${data}\n\n`); };

async function live(req, res, parts, lan) {
  const [, , token, what] = parts; // ['', 'live', token|'new', what]
  if (token === 'new' && req.method === 'POST') {
    const t = crypto.randomBytes(18).toString('base64url');
    rooms.set(t, { seen: Date.now(), tel: '', viewers: new Set(), hosts: new Set(), video: new Set(), frame: null });
    const urls = lan().map((ip) => `http://${ip}:${process.env.PORT_HTTP}/remote?t=${t}`);
    const qr = urls[0] ? await QRCode.toString(urls[0], { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : '';
    return json(res, 200, { token: t, urls, qr });
  }
  if (!TOKEN_RE.test(token ?? '')) return json(res, 400, { error: 'bad token' });
  const r = room(token);
  if (!r) return json(res, 404, { error: 'This screen link expired — scan the new QR code on the simulator' });
  try {
    if (what === 'events' && req.method === 'GET') {
      const role = new URL(req.url, 'http://x').searchParams.get('role');
      sse(res);
      const set = role === 'host' ? r.hosts : r.viewers;
      set.add(res); res.on('close', () => set.delete(res));
      if (role !== 'host' && r.tel) res.write(`event: tel\ndata: ${r.tel}\n\n`);
      if (role !== 'host') send(r.hosts, 'viewers', String(r.viewers.size));
      res.on('close', () => { if (role !== 'host') send(r.hosts, 'viewers', String(r.viewers.size)); });
      return;
    }
    if (what === 'tel' && req.method === 'POST') {
      r.tel = (await readBody(req, 600_000)).toString('utf8').replace(/\n/g, ' ');
      send(r.viewers, 'tel', r.tel);
      return json(res, 200, { viewers: r.viewers.size, video: r.video.size });
    }
    if (what === 'cmd' && req.method === 'POST') {
      const b = (await readBody(req, 300_000)).toString('utf8').replace(/\n/g, ' ');
      if (!r.hosts.size) return json(res, 503, { error: 'Simulator not connected' });
      send(r.hosts, 'cmd', b);
      return json(res, 200, { ok: true });
    }
    if (what === 'ack' && req.method === 'POST') {
      send(r.viewers, 'ack', (await readBody(req, 10_000)).toString('utf8').replace(/\n/g, ' '));
      return json(res, 200, { ok: true });
    }
    if (what === 'frame' && req.method === 'POST') {
      r.frame = await readBody(req, 2_000_000);
      for (const c of r.video) {
        if (c.writableLength > 2_000_000) continue; // slow client: skip frames instead of buffering
        c.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${r.frame.length}\r\n\r\n`); c.write(r.frame); c.write('\r\n');
      }
      return json(res, 200, { video: r.video.size });
    }
    if (what === 'video' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame', 'cache-control': 'no-store', connection: 'keep-alive' });
      r.video.add(res); res.on('close', () => r.video.delete(res));
      if (r.frame) { res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${r.frame.length}\r\n\r\n`); res.write(r.frame); res.write('\r\n'); }
      return;
    }
  } catch (e) { return json(res, 400, { error: String(e.message ?? e) }); }
  return json(res, 404, { error: 'not found' });
}

// ---------------- map tiles ----------------
const TILE_SRC = {
  sat: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
};
const tile2lon = (x, z) => x / 2 ** z * 360 - 180;
const tile2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

async function tiles(req, res, parts) {
  const [, , style, zs, xs, ys] = parts;
  const z = +zs, x = +xs, y = parseInt(ys, 10);
  if (!TILE_SRC[style] || !(z >= 0 && z <= 19) || !(x >= 0 && x < 2 ** z) || !(y >= 0 && y < 2 ** z)) return json(res, 400, { error: 'bad tile' });
  // detailed zoom levels only over Chhattisgarh (fair use of the free tile servers)
  if (z >= 9) {
    const w = tile2lon(x, z), e = tile2lon(x + 1, z), n = tile2lat(y, z), s = tile2lat(y + 1, z);
    if (e < CG.w || w > CG.e || n < CG.s || s > CG.n) { res.writeHead(204); return res.end(); }
  }
  const file = path.join(DATA, 'tiles', style, String(z), String(x), `${y}.${style === 'osm' ? 'png' : 'jpg'}`);
  const type = style === 'osm' ? 'image/png' : 'image/jpeg';
  try { const b = fs.readFileSync(file); res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=604800' }); return res.end(b); } catch { /* fetch */ }
  try {
    const r = await fetch(TILE_SRC[style](z, x, y), { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { res.writeHead(r.status); return res.end(); }
    const b = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, b);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=604800' }); res.end(b);
  } catch { res.writeHead(502); res.end(); }
}

// ---------------- geocoding + OSM features ----------------
let lastNominatim = 0;
async function geo(req, res, parts) {
  const u = new URL(req.url, 'http://x');
  if (parts[2] === 'search') {
    const q = (u.searchParams.get('q') ?? '').slice(0, 120).trim();
    if (q.length < 2) return json(res, 200, []);
    const wait = 1100 - (Date.now() - lastNominatim); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatim = Date.now();
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=8&countrycodes=in&bounded=1&viewbox=${CG.w},${CG.n},${CG.e},${CG.s}&q=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA, 'accept-language': 'en' }, signal: AbortSignal.timeout(15000) });
      const list = await r.json();
      return json(res, 200, list.map((p) => ({ name: p.display_name, lat: +p.lat, lon: +p.lon })));
    } catch { return json(res, 502, { error: 'search unavailable (offline?)' }); }
  }
  if (parts[2] === 'osm') {
    const s = +u.searchParams.get('s'), w = +u.searchParams.get('w'), n = +u.searchParams.get('n'), e = +u.searchParams.get('e');
    if (![s, w, n, e].every(Number.isFinite) || n - s > 0.012 || e - w > 0.012 || n <= s || e <= w) return json(res, 400, { error: 'area too large' });
    if (s < CG.s || n > CG.n || w < CG.w || e > CG.e) return json(res, 400, { error: 'Only areas inside Chhattisgarh are supported' });
    const key = [s, w, n, e].map((v) => v.toFixed(5)).join('_');
    const file = path.join(DATA, 'osm', `${key}.json`);
    try { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(fs.readFileSync(file)); } catch { /* fetch */ }
    const bb = `${s},${w},${n},${e}`;
    const ql = `[out:json][timeout:25];(way["building"](${bb});node["natural"="tree"](${bb});way["natural"~"^(wood|tree_row|scrub|water)$"](${bb});way["landuse"~"^(forest|orchard|farmland|meadow|grass|village_green|residential)$"](${bb});way["power"~"^(line|minor_line)$"](${bb});node["power"~"^(tower|pole)$"](${bb});way["highway"](${bb});way["waterway"](${bb}););out body;>;out skel qt;`;
    try {
      const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(ql), signal: AbortSignal.timeout(45000) });
      if (!r.ok) return json(res, 502, { error: `map data server busy (${r.status}) — try again in a minute` });
      const b = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, b);
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(b);
    } catch { return json(res, 502, { error: 'map data unavailable (offline?)' }); }
  }
  return json(res, 404, { error: 'not found' });
}

/** Returns true when the request was handled here. */
export function extraRoutes(lan) {
  return (req, res) => {
    const p = (req.url ?? '').split('?')[0];
    const parts = p.split('/');
    if (parts[1] === 'live') { void live(req, res, parts, lan); return true; }
    if (parts[1] === 'tiles') { void tiles(req, res, parts); return true; }
    if (parts[1] === 'geo') { void geo(req, res, parts); return true; }
    return false;
  };
}
