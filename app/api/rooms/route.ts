import { cleanName, createRoom, jsonError } from '@/lib/game-server';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: unknown };
    return Response.json(await createRoom(cleanName(body.name)));
  } catch (error) {
    return jsonError(error);
  }
}
