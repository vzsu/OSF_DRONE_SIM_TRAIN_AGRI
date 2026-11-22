// WebRTC signalling for LAN screens (phone/tablet as the RC screen or camera monitor).
// Tiny in-memory mailbox per pairing code; peers poll it. Kept on globalThis so every Next
// route bundle shares the same store. Rooms expire after 3 hours.
import crypto from 'node:crypto';
import os from 'node:os';

export interface Msg { n: number; from: string; to: string; data: unknown }
interface Room { code: string; created: number; n: number; msgs: Msg[] }

const g = globalThis as unknown as { __osfLink?: Map<string, Room> };
const rooms: Map<string, Room> = (g.__osfLink ??= new Map());
const TTL = 3 * 3600_000;

function sweep() { const now = Date.now(); for (const [k, r] of rooms) if (now - r.created > TTL) rooms.delete(k); }

export function createRoom(): string {
  sweep();
  let code = '';
  do { code = String(crypto.randomInt(100000, 999999)); } while (rooms.has(code));
  rooms.set(code, { code, created: Date.now(), n: 0, msgs: [] });
  return code;
}
export const validCode = (c: string) => /^\d{6}$/.test(c) && rooms.has(c);

export function post(code: string, from: string, to: string, data: unknown): boolean {
  const r = rooms.get(code); if (!r) return false;
  if (JSON.stringify(data ?? null).length > 200_000) return false;
  r.msgs.push({ n: ++r.n, from: String(from).slice(0, 40), to: String(to).slice(0, 40), data });
  if (r.msgs.length > 200) r.msgs.splice(0, r.msgs.length - 200);
  return true;
}
export function poll(code: string, me: string, since: number): Msg[] {
  const r = rooms.get(code); if (!r) return [];
  return r.msgs.filter((m) => m.n > since && (m.to === me || m.to === '*') && m.from !== me);
}

/** https URLs other devices on the LAN can open (virtual adapters skipped). */
export function lanUrls(httpsPort: number): string[] {
  const out: string[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|wsl|virtualbox|vmware|hyper-v|docker|loopback/i.test(name)) continue;
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(`https://${a.address}:${httpsPort}`);
  }
  return out;
}
