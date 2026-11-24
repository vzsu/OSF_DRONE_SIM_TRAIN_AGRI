import { NextResponse } from 'next/server';
import { bridge, TOKEN_RE } from '../../../../server/dtos';
import { encodeFlight } from '../../../../server/flightCodec';
import type { WireLog } from '../../../../server/logStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A graded exercise ended: compress the flight (.osfz) and hand result + flight to the Training OS. */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 40_000_000) throw new Error('too large');
    const b = JSON.parse(raw) as { token: string; lessonId: string; passed: boolean; score: number; time: number; checkride: boolean; reason: string; objectives: { text: string; done: boolean }[]; drone: string; log?: WireLog };
    if (!TOKEN_RE.test(b.token)) return NextResponse.json({ error: 'Invalid link' }, { status: 400 });
    let flight: { id: string; osfzB64: string } | undefined;
    if (b.log?.header?.id && typeof b.log.dataB64 === 'string') flight = { id: b.log.header.id, osfzB64: encodeFlight(b.log).toString('base64') };
    const s = b.log?.summary as Record<string, unknown> | undefined;
    const summary = s ? { maxAlt: s.maxAlt, distance: s.distance, flightTime: s.flightTime, result: s.result } : {};
    const r = await bridge('result', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: b.token, lessonId: b.lessonId, passed: b.passed, score: b.score, time: b.time, checkride: b.checkride, reason: b.reason, objectives: b.objectives, drone: b.drone, summary, flight }),
    });
    return NextResponse.json({ ...(await r.json()), flightBytes: flight ? Buffer.from(flight.osfzB64, 'base64').length : 0 });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: (e as { status?: number }).status ?? 400 }); }
}
