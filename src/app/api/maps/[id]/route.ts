import { NextResponse } from 'next/server';
import { getMap, deleteMap } from '../../../../server/mapStore';
import { sessionUser } from '../../../../server/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  if (!(await sessionUser(req))) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  const m = await getMap((await ctx.params).id);
  return m ? NextResponse.json(m) : NextResponse.json({ error: 'not found' }, { status: 404 });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  const id = (await ctx.params).id;
  const m = await getMap(id);
  if (m && me.role !== 'admin' && m.byId !== me.id) return NextResponse.json({ error: 'Only the creator or an admin can delete this map' }, { status: 403 });
  await deleteMap(id);
  return NextResponse.json({ ok: true });
}
