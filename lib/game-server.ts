import { env } from 'cloudflare:workers';

import type { Cell, Direction, Player, RoomState } from '@/lib/game-types';

const COLORS = ['#a3ff4f', '#ff70a6', '#7bdff2', '#ffd166'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const WIDTH = 32;
const HEIGHT = 22;
const TICK_MS = 170;

type RoomRow = {
  code: string;
  host_id: string;
  state_json: string;
  version: number;
  created_at: number;
  updated_at: number;
};

export class GameError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function database() {
  if (!env.DB) throw new GameError('The room service is unavailable.', 503);
  return env.DB as D1Database;
}

export function cleanName(input: unknown) {
  const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 1 || name.length > 16) throw new GameError('Choose a nickname with 1–16 characters.');
  return name;
}

export function cleanCode(input: unknown) {
  const code = typeof input === 'string' ? input.trim().toUpperCase() : '';
  if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) throw new GameError('Enter a valid five-character room code.');
  return code;
}

export function cleanDirection(input: unknown): Direction {
  if (!['up', 'down', 'left', 'right'].includes(String(input))) throw new GameError('Invalid direction.');
  return input as Direction;
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((byte) => CODE_CHARS[byte % CODE_CHARS.length]).join('');
}

function starterSnake(index: number): Pick<Player, 'snake' | 'direction' | 'queuedDirection'> {
  const starts: Array<{ snake: Cell[]; direction: Direction }> = [
    { snake: [{ x: 5, y: 6 }, { x: 4, y: 6 }, { x: 3, y: 6 }], direction: 'right' },
    { snake: [{ x: 26, y: 15 }, { x: 27, y: 15 }, { x: 28, y: 15 }], direction: 'left' },
    { snake: [{ x: 9, y: 16 }, { x: 9, y: 17 }, { x: 9, y: 18 }], direction: 'up' },
    { snake: [{ x: 23, y: 5 }, { x: 23, y: 4 }, { x: 23, y: 3 }], direction: 'down' },
  ];
  return { ...starts[index], queuedDirection: starts[index].direction };
}

function makePlayer(id: string, name: string, index: number): Player {
  return { id, name, color: COLORS[index], ...starterSnake(index), score: 0, alive: true };
}

function occupied(state: RoomState) {
  return new Set(state.players.flatMap((player) => player.snake.map((cell) => `${cell.x}:${cell.y}`)));
}

function spawnFood(state: RoomState): Cell {
  const taken = occupied(state);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const cell = { x: Math.floor(Math.random() * state.width), y: Math.floor(Math.random() * state.height) };
    if (!taken.has(`${cell.x}:${cell.y}`) && !state.foods.some((food) => food.x === cell.x && food.y === cell.y)) return cell;
  }
  return { x: 0, y: 0 };
}

function resetRound(state: RoomState, now: number): RoomState {
  const reset = {
    ...state,
    status: 'playing' as const,
    lastTick: now,
    winnerId: null,
    round: state.round + 1,
    players: state.players.map((player, index) => ({ ...player, ...starterSnake(index), score: 0, alive: true })),
    foods: [] as Cell[],
  };
  reset.foods = [spawnFood(reset), spawnFood(reset)];
  return reset;
}

function isOpposite(a: Direction, b: Direction) {
  return (a === 'up' && b === 'down') || (a === 'down' && b === 'up') || (a === 'left' && b === 'right') || (a === 'right' && b === 'left');
}

function move(cell: Cell, direction: Direction, state: RoomState): Cell {
  const delta = direction === 'up' ? [0, -1] : direction === 'down' ? [0, 1] : direction === 'left' ? [-1, 0] : [1, 0];
  return { x: (cell.x + delta[0] + state.width) % state.width, y: (cell.y + delta[1] + state.height) % state.height };
}

function tick(state: RoomState): RoomState {
  const nextPlayers = state.players.map((player) => {
    if (!player.alive) return player;
    const direction = isOpposite(player.direction, player.queuedDirection) ? player.direction : player.queuedDirection;
    const head = move(player.snake[0], direction, state);
    const foodIndex = state.foods.findIndex((food) => food.x === head.x && food.y === head.y);
    const ate = foodIndex >= 0;
    return { ...player, direction, snake: [head, ...(ate ? player.snake : player.snake.slice(0, -1))], score: player.score + (ate ? 100 : 0), ate: foodIndex };
  });

  const dead = new Set<string>();
  nextPlayers.forEach((player) => {
    if (!player.alive) return;
    const head = player.snake[0];
    const bodyHit = nextPlayers.some((other) => other.snake.some((cell, index) => (other.id !== player.id || index > 0) && cell.x === head.x && cell.y === head.y));
    if (bodyHit) dead.add(player.id);
  });

  const eaten = new Set<number>();
  const players = nextPlayers.map((player) => {
    const foodIndex = 'ate' in player ? Number(player.ate) : -1;
    if (foodIndex >= 0) eaten.add(foodIndex);
    const { ate: _ate, ...clean } = player as Player & { ate?: number };
    return { ...clean, alive: clean.alive && !dead.has(clean.id) };
  });

  const next = { ...state, players, foods: state.foods.filter((_, index) => !eaten.has(index)) };
  while (next.foods.length < 2) next.foods.push(spawnFood(next));

  const alive = players.filter((player) => player.alive);
  if (players.length > 1 && alive.length <= 1) {
    next.status = 'finished';
    next.winnerId = alive[0]?.id ?? players.slice().sort((a, b) => b.score - a.score)[0]?.id ?? null;
  }
  return next;
}

function advance(state: RoomState, now = Date.now()) {
  if (state.status !== 'playing') return state;
  const steps = Math.min(8, Math.floor((now - state.lastTick) / state.tickMs));
  let next = state;
  for (let i = 0; i < steps && next.status === 'playing'; i += 1) next = tick(next);
  return steps > 0 ? { ...next, lastTick: state.lastTick + steps * state.tickMs } : next;
}

async function readRow(code: string) {
  return database().prepare('SELECT code, host_id, state_json, version, created_at, updated_at FROM rooms WHERE code = ?').bind(code).first<RoomRow>();
}

export async function createRoom(name: string) {
  const hostId = crypto.randomUUID();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode();
    const now = Date.now();
    const state: RoomState = { code, hostId, width: WIDTH, height: HEIGHT, tickMs: TICK_MS, status: 'waiting', players: [makePlayer(hostId, name, 0)], foods: [{ x: 15, y: 10 }, { x: 25, y: 5 }], lastTick: now, winnerId: null, round: 0 };
    try {
      await database().prepare('INSERT INTO rooms (code, host_id, state_json, version, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').bind(code, hostId, JSON.stringify(state), now, now).run();
      return { playerId: hostId, state, version: 0 };
    } catch (error) {
      if (attempt === 7) throw error;
    }
  }
  throw new GameError('Could not create a room. Try again.', 503);
}

export async function updateRoom(code: string, mutate: (state: RoomState) => RoomState | Promise<RoomState>) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await readRow(code);
    if (!row) throw new GameError('Room not found.', 404);
    const state = await mutate(advance(JSON.parse(row.state_json) as RoomState));
    const now = Date.now();
    const result = await database().prepare('UPDATE rooms SET state_json = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?').bind(JSON.stringify(state), now, code, row.version).run();
    if ((result.meta?.changes ?? 0) > 0) return { state, version: row.version + 1 };
  }
  throw new GameError('The room is busy. Try that again.', 409);
}

export async function getRoom(code: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await readRow(code);
    if (!row) throw new GameError('Room not found.', 404);
    const current = JSON.parse(row.state_json) as RoomState;
    const state = advance(current);
    if (state === current) return { state, version: row.version };
    const result = await database().prepare('UPDATE rooms SET state_json = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?').bind(JSON.stringify(state), Date.now(), code, row.version).run();
    if ((result.meta?.changes ?? 0) > 0) return { state, version: row.version + 1 };
  }
  throw new GameError('The room is busy. Try that again.', 409);
}

export async function joinRoom(code: string, name: string) {
  const playerId = crypto.randomUUID();
  const result = await updateRoom(code, (state) => {
    if (state.status !== 'waiting') throw new GameError('That round has already started.', 409);
    if (state.players.length >= 4) throw new GameError('That room is full.', 409);
    return { ...state, players: [...state.players, makePlayer(playerId, name, state.players.length)] };
  });
  return { ...result, playerId };
}

export async function startRoom(code: string, playerId: string) {
  return updateRoom(code, (state) => {
    if (state.hostId !== playerId) throw new GameError('Only the room host can start the round.', 403);
    if (state.players.length < 2) throw new GameError('Invite at least one more player.', 409);
    return resetRound(state, Date.now() + 900);
  });
}

export async function steerRoom(code: string, playerId: string, direction: Direction) {
  return updateRoom(code, (state) => ({
    ...state,
    players: state.players.map((player) => player.id === playerId && player.alive && !isOpposite(player.direction, direction) ? { ...player, queuedDirection: direction } : player),
  }));
}

export function jsonError(error: unknown) {
  const gameError = error instanceof GameError ? error : new GameError('Something went wrong.', 500);
  return Response.json({ error: gameError.message }, { status: gameError.status });
}
