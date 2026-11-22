import { NextResponse } from 'next/server';
import { sessionUser, updateUser, deleteUser } from '../../../../server/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Admin: change name / password / role of anyone. Student: change own password only. */
export async function PATCH(req: Request, ctx: Ctx) {
  const me = await sessionUser(req);
  const { id } = await ctx.params;
  if (!me || (me.role !== 'admin' && me.id !== id)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const body = (await req.json()) as { name?: string; password?: string; role?: 'admin' | 'student' };
    const patch = me.role === 'admin' ? body : { password: body.password };
    return NextResponse.json(await updateUser(id, patch));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const me = await sessionUser(req);
  if (me?.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });
  const { id } = await ctx.params;
  if (id === me.id) return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
  try { await deleteUser(id); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
