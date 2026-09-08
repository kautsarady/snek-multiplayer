import { cleanCode, getRoom, jsonError } from '@/lib/game-server';

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    return Response.json(await getRoom(cleanCode(code)));
  } catch (error) {
    return jsonError(error);
  }
}
