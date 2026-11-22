import { NextResponse } from 'next/server';
import { post, poll, validCode } from '../../../../server/link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

/** The 6-digit pairing code is the key: a phone only needs the code shown on the simulator. */
export async function GET(req: Request, ctx: Ctx) {
  const { code } = await ctx.params;
  if (!validCode(code)) return NextResponse.json({ error: 'unknown code' }, { status: 404 });
  const u = new URL(req.url);
  return NextResponse.json(poll(code, u.searchParams.get('me') ?? '', Number(u.searchParams.get('since') ?? 0)));
}

export async function POST(req: Request, ctx: Ctx) {
  const { code } = await ctx.params;
  if (!validCode(code)) return NextResponse.json({ error: 'unknown code' }, { status: 404 });
  const b = (await req.json()) as { from: string; to: string; data: unknown };
  return post(code, b.from, b.to, b.data) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'rejected' }, { status: 400 });
}
