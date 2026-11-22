import { NextResponse } from 'next/server';
import { getLog, deleteLog } from '../../../../server/logStore';
import { sessionUser } from '../../../../server/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  const { id } = await ctx.params;
  const log = await getLog(id);
  if (!log || (me.role !== 'admin' && log.header.userId !== me.id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(log);
}

export async function DELETE(req: Request, ctx: Ctx) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  const { id } = await ctx.params;
  const log = await getLog(id);
  if (log && me.role !== 'admin' && log.header.userId !== me.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await deleteLog(id);
  return NextResponse.json({ ok: true });
}
