import { cleanCode, jsonError, startRoom } from '@/lib/game-server';

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const body = await request.json() as { playerId?: unknown };
    if (typeof body.playerId !== 'string') throw new Error('Missing player.');
    return Response.json(await startRoom(cleanCode(code), body.playerId));
  } catch (error) {
    return jsonError(error);
  }
}
