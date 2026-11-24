import { NextResponse } from 'next/server';
import { bridge, TOKEN_RE } from '../../../../server/dtos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Resolve a Drone Training OS launch token: who is flying which exercise (or which attempt to replay). */
export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get('t') ?? '';
  if (!TOKEN_RE.test(t)) return NextResponse.json({ error: 'Invalid link' }, { status: 400 });
  try { return NextResponse.json(await (await bridge('launch/' + t)).json()); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: (e as { status?: number }).status ?? 502 }); }
}
