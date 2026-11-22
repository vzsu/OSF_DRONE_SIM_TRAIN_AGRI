import { NextResponse } from 'next/server';
import { createRoom, lanUrls } from '../../../server/link';
import { sessionUser } from '../../../server/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Simulator PC creates a pairing room (needs a signed-in user). */
export async function POST(req: Request) {
  if (!(await sessionUser(req))) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  const port = Number(process.env.HTTPS_PORT || 3443);
  return NextResponse.json({ code: createRoom(), urls: lanUrls(port) });
}
