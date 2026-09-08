import { cleanCode, cleanName, joinRoom, jsonError } from '@/lib/game-server';

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const body = await request.json() as { name?: unknown };
    return Response.json(await joinRoom(cleanCode(code), cleanName(body.name)));
  } catch (error) {
    return jsonError(error);
  }
}
