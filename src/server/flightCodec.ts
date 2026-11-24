// Compact flight-log file format (.osfz) for the per-student database.
//
//   "OSFZ" | version u8 | metaLen u32le | gzip(meta JSON) | deflate(samples)
//
// meta    = header, summary, events, training, cols, rows, scales
// samples = column-major; every value quantised to an integer with a per-column scale
//           (e.g. position in cm, angles in 0.1 mrad, sticks in 1/1000), delta-encoded against the
//           previous sample, zig-zag + varint packed, then deflated. A 50 Hz flight shrinks from
//           ~10 KB/s (Float32 + base64 JSON) to well under 1 KB/s, with errors far below what the
//           replay or the debrief can show.
// The header can be read without unpacking the samples (fast lists for the instructor dashboard).
import zlib from 'node:zlib';
import type { WireLog } from './logStore';

const MAGIC = 'OSFZ', VERSION = 1;

/** value = int / scale */
const SCALE: Record<string, number> = {
  t: 1000, mode: 1, armed: 1, spraying: 1, sats: 1, warn: 1, crashed: 1, mah: 1,
  x: 100, y: 100, z: 100, vx: 100, vy: 100, vz: 100, agl: 100, baro_alt: 100, gnd_speed: 100, air_speed: 100,
  wind_x: 100, wind_y: 100, wind_z: 100, batt_v: 100, batt_a: 100, hdop: 100,
  roll: 10000, pitch: 10000, yaw: 10000, batt_soc: 10000,
};
const scaleOf = (c: string) => SCALE[c] ?? 1000; // sticks, rates, thr_out, tank_l …

function b64ToF32(s: string): Float32Array { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); }

export function encodeFlight(log: WireLog): Buffer {
  const cols = log.cols, w = cols.length, n = log.rows;
  const src = b64ToF32(log.dataB64);
  if (src.length < n * w) throw new Error('log data shorter than rows × cols');
  const scales = cols.map(scaleOf);
  const out: number[] = [];
  const push = (v: number) => { // zig-zag varint, safe up to ±2^52
    let z = v < 0 ? -v * 2 - 1 : v * 2;
    while (z >= 128) { out.push((z % 128) | 128); z = Math.floor(z / 128); }
    out.push(z);
  };
  for (let j = 0; j < w; j++) {
    let prev = 0;
    const s = scales[j];
    for (let i = 0; i < n; i++) {
      const v = src[i * w + j];
      const q = Number.isFinite(v) ? Math.round(v * s) : 0;
      push(q - prev); prev = q;
    }
  }
  const meta = Buffer.from(JSON.stringify({ header: log.header, summary: log.summary, events: log.events, training: (log as { training?: unknown }).training, cols, rows: n, scales }));
  const metaGz = zlib.gzipSync(meta, { level: 9 });
  const dataZ = zlib.deflateRawSync(Buffer.from(out), { level: 9 });
  const head = Buffer.alloc(9);
  head.write(MAGIC, 0, 'ascii'); head.writeUInt8(VERSION, 4); head.writeUInt32LE(metaGz.length, 5);
  return Buffer.concat([head, metaGz, dataZ]);
}

interface Meta { header: WireLog['header']; summary: WireLog['summary']; events: unknown[]; training?: unknown; cols: string[]; rows: number; scales: number[] }

export function isFlightFile(buf: Buffer) { return buf.length > 9 && buf.toString('ascii', 0, 4) === MAGIC; }

/** Header + summary only (no samples). */
export function readFlightMeta(buf: Buffer): Meta {
  if (!isFlightFile(buf)) throw new Error('not an .osfz flight');
  const len = buf.readUInt32LE(5);
  return JSON.parse(zlib.gunzipSync(buf.subarray(9, 9 + len)).toString('utf8'));
}

/** Back to the wire format the browser uses (Float32 rows, base64). */
export function decodeFlight(buf: Buffer): WireLog {
  const meta = readFlightMeta(buf);
  const len = buf.readUInt32LE(5);
  const bytes = zlib.inflateRawSync(buf.subarray(9 + len));
  const { cols, rows: n, scales } = meta, w = cols.length;
  const f = new Float32Array(n * w);
  let p = 0;
  const next = () => {
    let z = 0, mul = 1, b: number;
    do { b = bytes[p++]; z += (b & 127) * mul; mul *= 128; } while (b & 128);
    return z % 2 ? -(z + 1) / 2 : z / 2;
  };
  for (let j = 0; j < w; j++) {
    let q = 0;
    const s = scales[j];
    for (let i = 0; i < n; i++) { q += next(); f[i * w + j] = q / s; }
  }
  return { header: meta.header, summary: meta.summary, cols, rows: n, events: meta.events, ...(meta.training ? { training: meta.training } : {}), dataB64: Buffer.from(f.buffer).toString('base64') } as WireLog;
}
