import { mapGround } from '../../../../../server/mapStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Satellite picture of a saved map (public: phone screens have no login). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const b = await mapGround((await ctx.params).id);
  if (!b) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(b), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
}
