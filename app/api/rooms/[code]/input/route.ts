import { cleanCode, cleanDirection, jsonError, steerRoom } from '@/lib/game-server';

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const body = await request.json() as { playerId?: unknown; direction?: unknown };
    if (typeof body.playerId !== 'string') throw new Error('Missing player.');
    return Response.json(await steerRoom(cleanCode(code), body.playerId, cleanDirection(body.direction)));
  } catch (error) {
    return jsonError(error);
  }
}
