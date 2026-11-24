import { NextResponse } from 'next/server';
import { bridge, TOKEN_RE } from '../../../../server/dtos';
import { decodeFlight } from '../../../../server/flightCodec';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Recorded flight for a replay link, unpacked to the browser's log format. */
export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get('t') ?? '';
  if (!TOKEN_RE.test(t)) return NextResponse.json({ error: 'Invalid link' }, { status: 400 });
  try { return NextResponse.json(decodeFlight(Buffer.from(await (await bridge('flight/' + t)).arrayBuffer()))); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: (e as { status?: number }).status ?? 502 }); }
}
