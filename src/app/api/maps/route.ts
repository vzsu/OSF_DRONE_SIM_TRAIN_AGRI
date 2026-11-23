import { NextResponse } from 'next/server';
import { listMaps, saveMap } from '../../../server/mapStore';
import { sessionUser } from '../../../server/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await sessionUser(req))) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  return NextResponse.json(await listMaps());
}

export async function POST(req: Request) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  try {
    const body = await req.json();
    if (JSON.stringify(body).length > 8_000_000) throw new Error('map too large');
    return NextResponse.json(await saveMap(body, me));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
