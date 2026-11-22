// Flight log: versioned schema, 50 Hz rows stored as Float32Array, events list.
// Designed to grow: replay, scoring and instructor review read the same structure.
import type { DroneDef } from '../data/drones';
import type { EnvSettings } from '../sim/wasm';
import type { TrainingData } from './score';

export const LOG_SCHEMA = 1;
export const LOG_RATE_HZ = 50;

export const COLS = [
  't', 'rc_roll', 'rc_pitch', 'rc_yaw', 'rc_thr', 'mode', 'armed', 'x', 'y', 'z', 'vx', 'vy', 'vz',
  'roll', 'pitch', 'yaw', 'p', 'q', 'r', 'batt_v', 'batt_a', 'batt_soc', 'mah', 'tank_l', 'spraying',
  'wind_x', 'wind_y', 'wind_z', 'sats', 'hdop', 'agl', 'baro_alt', 'gnd_speed', 'air_speed', 'thr_out', 'warn', 'crashed',
] as const;
export type Col = (typeof COLS)[number];

export interface LogEvent { t: number; code: number; text: string }
export interface LogHeader {
  schema: number; simVersion: string; id: string; trainee: string; startedAt: string;
  drone: DroneDef; env: EnvSettings; controller: string; linkDelayMs: number;
  place?: string; userId?: string;
}
export interface LogSummary {
  duration: number; flightTime: number; maxAlt: number; maxSpeed: number; distance: number;
  mahUsed: number; sprayedL: number; result: string; crashCause: number; warnings: number;
  score?: number; grade?: string;
}
export interface FlightLog { header: LogHeader; summary: LogSummary; cols: string[]; rows: number; data: ArrayBuffer; events: LogEvent[]; training?: TrainingData }

export class Recorder {
  private buf = new Float32Array(COLS.length * 50 * 60 * 5);
  private n = 0;
  events: LogEvent[] = [];
  header: LogHeader;
  constructor(header: LogHeader) { this.header = header; }

  add(row: number[]) {
    const w = COLS.length;
    if ((this.n + 1) * w > this.buf.length) {
      const nb = new Float32Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb;
    }
    this.buf.set(row, this.n * w);
    this.n++;
  }
  event(t: number, code: number, text: string) { this.events.push({ t, code, text }); }
  get rows() { return this.n; }
  col(name: Col): Float32Array {
    const w = COLS.length, k = COLS.indexOf(name), out = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) out[i] = this.buf[i * w + k];
    return out;
  }

  finish(result: string, crashCause: number, flightTime: number): FlightLog {
    const data = this.buf.slice(0, this.n * COLS.length);
    const log: FlightLog = { header: this.header, summary: undefined as unknown as LogSummary, cols: [...COLS], rows: this.n, data: data.buffer, events: this.events };
    log.summary = summarize(log, result, crashCause, flightTime);
    return log;
  }
}

export function column(log: FlightLog, name: string): Float32Array {
  const w = log.cols.length, k = log.cols.indexOf(name), d = new Float32Array(log.data), out = new Float32Array(log.rows);
  for (let i = 0; i < log.rows; i++) out[i] = d[i * w + k];
  return out;
}

function summarize(log: FlightLog, result: string, crashCause: number, flightTime: number): LogSummary {
  const t = column(log, 't'), z = column(log, 'agl'), gs = column(log, 'gnd_speed'), x = column(log, 'x'), y = column(log, 'y');
  const mah = column(log, 'mah'), tank = column(log, 'tank_l');
  let maxAlt = 0, maxSpeed = 0, dist = 0;
  for (let i = 0; i < log.rows; i++) {
    maxAlt = Math.max(maxAlt, z[i]); maxSpeed = Math.max(maxSpeed, gs[i]);
    if (i) dist += Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
  }
  const n = log.rows;
  return {
    duration: n ? t[n - 1] : 0, flightTime, maxAlt, maxSpeed, distance: dist,
    mahUsed: n ? mah[n - 1] : 0, sprayedL: n ? tank[0] - tank[n - 1] : 0,
    result, crashCause, warnings: log.events.filter((e) => [6, 7, 8, 9, 14, 15, 19].includes(e.code)).length,
  };
}

export function toCsv(log: FlightLog): string {
  const d = new Float32Array(log.data), w = log.cols.length;
  const lines = [log.cols.join(',')];
  for (let i = 0; i < log.rows; i++) {
    const r: string[] = [];
    for (let j = 0; j < w; j++) r.push(String(+d[i * w + j].toFixed(4)));
    lines.push(r.join(','));
  }
  return lines.join('\n');
}

export function toJson(log: FlightLog) {
  const d = Array.from(new Float32Array(log.data));
  return { header: log.header, summary: log.summary, cols: log.cols, rows: log.rows, events: log.events, data: d };
}
