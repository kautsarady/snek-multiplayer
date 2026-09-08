export type Direction = 'up' | 'down' | 'left' | 'right';

export type Cell = { x: number; y: number };

export type Player = {
  id: string;
  name: string;
  color: string;
  snake: Cell[];
  direction: Direction;
  queuedDirection: Direction;
  score: number;
  alive: boolean;
};

export type GameStatus = 'waiting' | 'playing' | 'finished';

export type RoomState = {
  code: string;
  hostId: string;
  width: number;
  height: number;
  tickMs: number;
  status: GameStatus;
  players: Player[];
  foods: Cell[];
  lastTick: number;
  winnerId: string | null;
  round: number;
};

export type RoomResponse = {
  state: RoomState;
  version: number;
};
