import { DurableObject } from 'cloudflare:workers';

import type {
  Cell,
  Direction,
  Player,
  RoomResponse,
  RoomState,
} from '../lib/game-types';

const COLORS = ['#a3ff4f', '#ff70a6', '#7bdff2', '#ffd166'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const WIDTH = 32;
const HEIGHT = 22;
const TICK_MS = 80;
const MAX_PLAYERS = 4;

type RoomSnapshot = RoomResponse & { serverTime: number };
type EnterRoomResponse = RoomSnapshot & { playerId: string; socketUrl: string };
type CommandResult =
  | { ok: true; snapshot: RoomSnapshot }
  | { ok: false; error: string; status: number };
type SocketAttachment = { playerId: string };
type ClientMessage =
  | { type: 'input'; direction: Direction }
  | { type: 'start' }
  | { type: 'leave' };
type RealtimeEnv = Omit<Env, 'SNEK_ROOMS'> & {
  SNEK_ROOMS: DurableObjectNamespace<SnekRoom>;
};

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes]
    .map((byte) => CODE_CHARS[byte % CODE_CHARS.length])
    .join('');
}

function randomIndex(limit: number) {
  const values = crypto.getRandomValues(new Uint32Array(1));
  return values[0] % limit;
}

function cleanName(input: unknown) {
  const name =
    typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : '';
  return name.length >= 1 && name.length <= 16 ? name : null;
}

function cleanCode(input: string) {
  const code = input.trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{5}$/.test(code) ? code : null;
}

function isDirection(input: unknown): input is Direction {
  return (
    input === 'up' || input === 'down' || input === 'left' || input === 'right'
  );
}

function isOpposite(a: Direction, b: Direction) {
  return (
    (a === 'up' && b === 'down') ||
    (a === 'down' && b === 'up') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left')
  );
}

function starterSnake(
  index: number,
): Pick<Player, 'snake' | 'direction' | 'queuedDirection' | 'inputQueue'> {
  const starts: Array<{ snake: Cell[]; direction: Direction }> = [
    {
      snake: [
        { x: 5, y: 6 },
        { x: 4, y: 6 },
        { x: 3, y: 6 },
      ],
      direction: 'right',
    },
    {
      snake: [
        { x: 26, y: 15 },
        { x: 27, y: 15 },
        { x: 28, y: 15 },
      ],
      direction: 'left',
    },
    {
      snake: [
        { x: 9, y: 16 },
        { x: 9, y: 17 },
        { x: 9, y: 18 },
      ],
      direction: 'up',
    },
    {
      snake: [
        { x: 23, y: 5 },
        { x: 23, y: 4 },
        { x: 23, y: 3 },
      ],
      direction: 'down',
    },
  ];
  return {
    ...starts[index],
    queuedDirection: starts[index].direction,
    inputQueue: [],
  };
}

function makePlayer(id: string, name: string, index: number): Player {
  return {
    id,
    name,
    color: COLORS[index],
    ...starterSnake(index),
    score: 0,
    alive: true,
  };
}

function occupied(state: RoomState) {
  return new Set(
    state.players.flatMap((player) =>
      player.snake.map((cell) => `${cell.x}:${cell.y}`),
    ),
  );
}

function spawnFood(state: RoomState): Cell {
  const taken = occupied(state);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const cell = { x: randomIndex(state.width), y: randomIndex(state.height) };
    if (
      !taken.has(`${cell.x}:${cell.y}`) &&
      !state.foods.some((food) => food.x === cell.x && food.y === cell.y)
    )
      return cell;
  }
  return { x: 0, y: 0 };
}

function resetRound(state: RoomState): RoomState {
  const reset: RoomState = {
    ...state,
    status: 'playing',
    lastTick: Date.now(),
    winnerId: null,
    round: state.round + 1,
    players: state.players.map((player, index) => ({
      ...player,
      ...starterSnake(index),
      score: 0,
      alive: true,
    })),
    foods: [],
  };
  reset.foods = [spawnFood(reset), spawnFood(reset)];
  return reset;
}

function move(cell: Cell, direction: Direction, state: RoomState): Cell {
  const delta =
    direction === 'up'
      ? [0, -1]
      : direction === 'down'
        ? [0, 1]
        : direction === 'left'
          ? [-1, 0]
          : [1, 0];
  return {
    x: (cell.x + delta[0] + state.width) % state.width,
    y: (cell.y + delta[1] + state.height) % state.height,
  };
}

function tick(state: RoomState): RoomState {
  const previousHeads = new Map(
    state.players.map((player) => [player.id, player.snake[0]]),
  );
  const nextPlayers = state.players.map((player) => {
    if (!player.alive) return player;
    const candidate = player.inputQueue[0];
    const direction =
      candidate && !isOpposite(player.direction, candidate)
        ? candidate
        : player.direction;
    const inputQueue = candidate
      ? player.inputQueue.slice(1)
      : player.inputQueue;
    const head = move(player.snake[0], direction, state);
    const foodIndex = state.foods.findIndex(
      (food) => food.x === head.x && food.y === head.y,
    );
    const ate = foodIndex >= 0;
    return {
      ...player,
      direction,
      queuedDirection: inputQueue.at(-1) ?? direction,
      inputQueue,
      snake: [head, ...(ate ? player.snake : player.snake.slice(0, -1))],
      score: player.score + (ate ? 100 : 0),
      ate: foodIndex,
    };
  });

  const dead = new Set<string>();
  nextPlayers.forEach((player) => {
    if (!player.alive) return;
    const head = player.snake[0];
    const bodyHit = nextPlayers.some((other) =>
      other.snake.some(
        (cell, index) =>
          (other.id !== player.id || index > 0) &&
          cell.x === head.x &&
          cell.y === head.y,
      ),
    );
    const crossedHead = nextPlayers.some((other) => {
      const previousHead = previousHeads.get(player.id);
      const otherPreviousHead = previousHeads.get(other.id);
      return (
        other.id !== player.id &&
        previousHead &&
        otherPreviousHead &&
        head.x === otherPreviousHead.x &&
        head.y === otherPreviousHead.y &&
        other.snake[0].x === previousHead.x &&
        other.snake[0].y === previousHead.y
      );
    });
    if (bodyHit || crossedHead) dead.add(player.id);
  });

  const eaten = new Set<number>();
  const players = nextPlayers.map((player) => {
    const foodIndex = 'ate' in player ? Number(player.ate) : -1;
    if (foodIndex >= 0) eaten.add(foodIndex);
    const { ate: _ate, ...clean } = player as Player & { ate?: number };
    return { ...clean, alive: clean.alive && !dead.has(clean.id) };
  });
  const next: RoomState = {
    ...state,
    players,
    foods: state.foods.filter((_, index) => !eaten.has(index)),
    lastTick: Date.now(),
  };
  while (next.foods.length < 2) next.foods.push(spawnFood(next));

  const alive = players.filter((player) => player.alive);
  if (players.length > 1 && alive.length <= 1) {
    next.status = 'finished';
    next.winnerId =
      alive[0]?.id ??
      players.slice().sort((a, b) => b.score - a.score)[0]?.id ??
      null;
  }
  return next;
}

function isSocketAttachment(input: unknown): input is SocketAttachment {
  return (
    typeof input === 'object' &&
    input !== null &&
    'playerId' in input &&
    typeof input.playerId === 'string'
  );
}

function parseClientMessage(
  message: string | ArrayBuffer,
): ClientMessage | null {
  if (typeof message !== 'string' || message.length > 256) return null;
  try {
    const parsed: unknown = JSON.parse(message);
    if (typeof parsed !== 'object' || parsed === null || !('type' in parsed))
      return null;
    if (parsed.type === 'start' || parsed.type === 'leave')
      return { type: parsed.type };
    if (
      parsed.type === 'input' &&
      'direction' in parsed &&
      isDirection(parsed.direction)
    ) {
      return { type: 'input', direction: parsed.direction };
    }
    return null;
  } catch {
    return null;
  }
}

export class SnekRoom extends DurableObject<RealtimeEnv> {
  private room: RoomState | null = null;
  private version = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: RealtimeEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong'),
    );
    void this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          state_json TEXT NOT NULL,
          version INTEGER NOT NULL
        )
      `);
      const stored = this.ctx.storage.sql
        .exec<{ state_json: string; version: number }>(
          'SELECT state_json, version FROM room_state WHERE id = 1',
        )
        .toArray()[0];
      if (stored) {
        this.room = JSON.parse(stored.state_json) as RoomState;
        this.version = stored.version;
        if (
          this.room.status === 'playing' &&
          this.ctx.getWebSockets().length > 0
        )
          this.startLoop();
      }
    });
  }

  private snapshot(): RoomSnapshot {
    if (!this.room) throw new Error('Room not found.');
    return { state: this.room, version: this.version, serverTime: Date.now() };
  }

  private commit(next: RoomState) {
    const version = this.version + 1;
    this.ctx.storage.sql.exec(
      `INSERT INTO room_state (id, state_json, version) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, version = excluded.version`,
      JSON.stringify(next),
      version,
    );
    this.room = next;
    this.version = version;
  }

  private send(ws: WebSocket, payload: object) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      ws.close(1011, 'Connection unavailable');
    }
  }

  private broadcast() {
    const payload = { type: 'state', ...this.snapshot() };
    for (const ws of this.ctx.getWebSockets()) this.send(ws, payload);
  }

  private stopLoop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private startLoop() {
    if (this.timer !== null || this.room?.status !== 'playing') return;
    this.timer = setInterval(() => {
      try {
        if (
          !this.room ||
          this.room.status !== 'playing' ||
          this.ctx.getWebSockets().length === 0
        ) {
          this.stopLoop();
          return;
        }
        this.commit(tick(this.room));
        this.broadcast();
        if (this.room.status !== 'playing') this.stopLoop();
      } catch (error) {
        console.error(
          JSON.stringify({
            message: 'game tick failed',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        this.stopLoop();
      }
    }, TICK_MS);
  }

  async create(
    code: string,
    name: string,
    playerId: string,
  ): Promise<RoomSnapshot | null> {
    if (this.room) return null;
    const now = Date.now();
    const state: RoomState = {
      code,
      hostId: playerId,
      width: WIDTH,
      height: HEIGHT,
      tickMs: TICK_MS,
      status: 'waiting',
      players: [makePlayer(playerId, name, 0)],
      foods: [
        { x: 15, y: 10 },
        { x: 25, y: 5 },
      ],
      lastTick: now,
      winnerId: null,
      round: 0,
    };
    this.commit(state);
    return this.snapshot();
  }

  async join(name: string, playerId: string): Promise<CommandResult> {
    if (!this.room) return { ok: false, error: 'Room not found.', status: 404 };
    if (this.room.status !== 'waiting')
      return {
        ok: false,
        error: 'That round has already started.',
        status: 409,
      };
    if (this.room.players.length >= MAX_PLAYERS)
      return { ok: false, error: 'That room is full.', status: 409 };
    this.commit({
      ...this.room,
      players: [
        ...this.room.players,
        makePlayer(playerId, name, this.room.players.length),
      ],
    });
    this.broadcast();
    return { ok: true, snapshot: this.snapshot() };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json(
        { error: 'Expected a WebSocket upgrade.' },
        { status: 426 },
      );
    }
    if (!this.room)
      return Response.json({ error: 'Room not found.' }, { status: 404 });
    const playerId = new URL(request.url).searchParams.get('playerId');
    if (
      !playerId ||
      !this.room.players.some((player) => player.id === playerId)
    ) {
      return Response.json({ error: 'Player not found.' }, { status: 403 });
    }

    for (const existing of this.ctx.getWebSockets(playerId))
      existing.close(1000, 'Reconnected');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [playerId]);
    server.serializeAttachment({ playerId } satisfies SocketAttachment);
    this.send(server, { type: 'state', ...this.snapshot() });
    this.startLoop();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer) {
    const attachment: unknown = ws.deserializeAttachment();
    const message = parseClientMessage(rawMessage);
    if (!isSocketAttachment(attachment) || !message || !this.room) {
      this.send(ws, { type: 'error', error: 'Invalid game message.' });
      return;
    }

    const playerId = attachment.playerId;
    if (message.type === 'start') {
      if (this.room.hostId !== playerId) {
        this.send(ws, {
          type: 'error',
          error: 'Only the room host can start the round.',
        });
        return;
      }
      if (this.room.players.length < 2) {
        this.send(ws, {
          type: 'error',
          error: 'Invite at least one more player.',
        });
        return;
      }
      this.commit(resetRound(this.room));
      this.broadcast();
      this.startLoop();
      return;
    }

    if (message.type === 'leave') {
      const remaining = this.room.players.filter(
        (player) => player.id !== playerId,
      );
      if (remaining.length === 0) return;
      const hostId =
        this.room.hostId === playerId ? remaining[0].id : this.room.hostId;
      const players =
        this.room.status === 'playing'
          ? this.room.players.map((player) =>
              player.id === playerId ? { ...player, alive: false } : player,
            )
          : remaining;
      this.commit({ ...this.room, hostId, players });
      this.broadcast();
      return;
    }

    const players = this.room.players.map((player) => {
      if (
        player.id !== playerId ||
        !player.alive ||
        this.room?.status !== 'playing'
      )
        return player;
      const previous = player.inputQueue.at(-1) ?? player.direction;
      if (
        message.direction === previous ||
        isOpposite(previous, message.direction) ||
        player.inputQueue.length >= 2
      )
        return player;
      return {
        ...player,
        queuedDirection: message.direction,
        inputQueue: [...player.inputQueue, message.direction],
      };
    });
    this.commit({ ...this.room, players });
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
    if (this.ctx.getWebSockets().length === 0) this.stopLoop();
  }

  async webSocketError(ws: WebSocket) {
    ws.close(1011, 'Connection error');
    if (this.ctx.getWebSockets().length === 0) this.stopLoop();
  }
}

function allowedOrigins(env: RealtimeEnv) {
  return new Set(
    env.ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function isAllowedOrigin(request: Request, env: RealtimeEnv) {
  const origin = request.headers.get('Origin');
  return !origin || allowedOrigins(env).has(origin);
}

function corsHeaders(request: Request, env: RealtimeEnv) {
  const origin = request.headers.get('Origin');
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });
  if (origin && allowedOrigins(env).has(origin))
    headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function withCors(response: Response, request: Request, env: RealtimeEnv) {
  const headers = new Headers(response.headers);
  corsHeaders(request, env).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function socketUrl(request: Request, code: string, playerId: string) {
  const url = new URL(request.url);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/rooms/${code}/socket`;
  url.search = new URLSearchParams({ playerId }).toString();
  return url.toString();
}

async function readSmallJson(
  request: Request,
): Promise<Record<string, unknown> | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2048) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function handleRequest(
  request: Request,
  env: RealtimeEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const rooms = env.SNEK_ROOMS;
  if (request.method === 'GET' && url.pathname === '/health') {
    return Response.json({
      status: 'ok',
      transport: 'websocket',
      tickMs: TICK_MS,
    });
  }

  if (request.method === 'POST' && url.pathname === '/rooms') {
    const body = await readSmallJson(request);
    const name = cleanName(body?.name);
    if (!name)
      return Response.json(
        { error: 'Choose a nickname with 1–16 characters.' },
        { status: 400 },
      );
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = randomCode();
      const playerId = crypto.randomUUID();
      const snapshot = await rooms
        .getByName(code, { locationHint: 'apac' })
        .create(code, name, playerId);
      if (snapshot) {
        const response: EnterRoomResponse = {
          ...snapshot,
          playerId,
          socketUrl: socketUrl(request, code, playerId),
        };
        return Response.json(response);
      }
    }
    return Response.json(
      { error: 'Could not create a room. Try again.' },
      { status: 503 },
    );
  }

  const joinMatch = url.pathname.match(/^\/rooms\/([A-HJ-NP-Z2-9]{5})\/join$/);
  if (request.method === 'POST' && joinMatch) {
    const code = cleanCode(joinMatch[1]);
    const body = await readSmallJson(request);
    const name = cleanName(body?.name);
    if (!code || !name)
      return Response.json(
        { error: 'Enter a valid room code and nickname.' },
        { status: 400 },
      );
    const playerId = crypto.randomUUID();
    const result = await rooms
      .getByName(code, { locationHint: 'apac' })
      .join(name, playerId);
    if (!result.ok)
      return Response.json({ error: result.error }, { status: result.status });
    const response: EnterRoomResponse = {
      ...result.snapshot,
      playerId,
      socketUrl: socketUrl(request, code, playerId),
    };
    return Response.json(response);
  }

  const socketMatch = url.pathname.match(
    /^\/rooms\/([A-HJ-NP-Z2-9]{5})\/socket$/,
  );
  if (request.method === 'GET' && socketMatch) {
    const code = cleanCode(socketMatch[1]);
    if (!code)
      return Response.json({ error: 'Invalid room code.' }, { status: 400 });
    return rooms.getByName(code, { locationHint: 'apac' }).fetch(request);
  }

  return Response.json({ error: 'Not found.' }, { status: 404 });
}

export default {
  async fetch(request: Request, env: RealtimeEnv): Promise<Response> {
    if (!isAllowedOrigin(request, env))
      return Response.json({ error: 'Origin not allowed.' }, { status: 403 });
    if (request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    try {
      const response = await handleRequest(request, env);
      return response.status === 101
        ? response
        : withCors(response, request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: 'request failed',
          error: error instanceof Error ? error.message : String(error),
          path: new URL(request.url).pathname,
        }),
      );
      return withCors(
        Response.json(
          { error: 'The game server is temporarily unavailable.' },
          { status: 503 },
        ),
        request,
        env,
      );
    }
  },
} satisfies ExportedHandler<RealtimeEnv>;
