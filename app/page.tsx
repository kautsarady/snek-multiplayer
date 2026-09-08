'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, Crown, Gamepad2, Keyboard, LogOut, RotateCcw, Sparkles, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Direction, RoomResponse, RoomState } from '@/lib/game-types';

type Session = { playerId: string; roomCode: string };
type ApiRoomResponse = RoomResponse & { playerId?: string };
type ModelContext = { registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void> };

const SAMPLE_ROOM: RoomState = {
  code: 'MINTY', hostId: 'minty', width: 32, height: 22, tickMs: 170, status: 'playing', lastTick: 0, winnerId: null, round: 1,
  players: [
    { id: 'minty', name: 'Minty', color: '#a3ff4f', score: 1200, alive: true, direction: 'right', queuedDirection: 'right', inputQueue: [], snake: [{ x: 9, y: 6 }, { x: 8, y: 6 }, { x: 7, y: 6 }, { x: 6, y: 6 }, { x: 5, y: 6 }] },
    { id: 'bubble', name: 'Bubble', color: '#ff70a6', score: 800, alive: true, direction: 'left', queuedDirection: 'left', inputQueue: [], snake: [{ x: 20, y: 14 }, { x: 21, y: 14 }, { x: 22, y: 14 }, { x: 23, y: 14 }] },
  ],
  foods: [{ x: 15, y: 10 }, { x: 27, y: 4 }],
};

async function api<T>(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Something went wrong.');
  return payload;
}

function ArenaBoard({ state, playerId, onSteer }: { state: RoomState; playerId?: string; onSteer?: (direction: Direction) => void }) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const wrappedPods = new Set<string>();

  state.players.forEach((player) => player.snake.forEach((cell, index) => {
    const trailingCell = player.snake[index + 1];
    if (trailingCell && (Math.abs(trailingCell.x - cell.x) > 1 || Math.abs(trailingCell.y - cell.y) > 1)) {
      wrappedPods.add(`${player.id}-${index}`);
    }
  }));

  function finishSwipe(event: React.TouchEvent) {
    if (!touchStart.current || !onSteer) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    onSteer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  }

  return (
    <div
      className="board-live"
      onTouchStart={(event) => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }}
      onTouchEnd={finishSwipe}
      style={{ '--cols': state.width, '--rows': state.height } as React.CSSProperties}
    >
      <div className="grid-lines" />
      {state.foods.map((food, index) => (
        <span className={`snack ${index % 2 ? 'snack-blue' : ''}`} key={`${food.x}-${food.y}`} style={{ '--x': food.x, '--y': food.y } as React.CSSProperties}>✦</span>
      ))}
      {state.players.flatMap((player) => player.snake.map((cell, index) => (
        <span
          className={`snake-pod ${index === 0 ? `head dir-${player.direction}` : ''} ${!player.alive ? 'out' : ''} ${player.id === playerId ? 'mine' : ''} ${wrappedPods.has(`${player.id}-${index}`) ? 'wrap-jump' : ''}`}
          key={`${player.id}-${index}`}
          style={{ '--pod-color': player.color, '--x': cell.x, '--y': cell.y, '--pod-z': player.snake.length - index } as React.CSSProperties}
        >{index === 0 && <i aria-hidden="true"><b>•</b><b>•</b></i>}</span>
      )))}
    </div>
  );
}

function Brand({ onClick }: { onClick?: () => void }) {
  const content = <><span className="brand-mark" aria-hidden="true"><span>•</span><span>•</span></span><span>SNEK!</span></>;
  return onClick ? <button className="brand brand-button" onClick={onClick} type="button">{content}</button> : <div className="brand">{content}</div>;
}

export default function Home() {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const latestVersion = useRef(-1);
  const inputChain = useRef<Promise<void>>(Promise.resolve());

  const applyRoomResponse = useCallback((result: RoomResponse) => {
    if (result.version < latestVersion.current) return;
    latestVersion.current = result.version;
    setRoom(result.state);
  }, []);

  const enterRoom = useCallback(async (action: 'create' | 'join', suppliedName?: string, suppliedCode?: string) => {
    const chosenName = (suppliedName ?? name).trim();
    const chosenCode = (suppliedCode ?? roomCode).trim().toUpperCase();
    if (!chosenName) throw new Error('Pick a nickname first.');
    setBusy(true);
    setError('');
    try {
      const path = action === 'create' ? '/api/rooms' : `/api/rooms/${chosenCode}/join`;
      const result = await api<ApiRoomResponse>(path, { method: 'POST', body: JSON.stringify({ name: chosenName }) });
      if (!result.playerId) throw new Error('Could not enter the room.');
      setName(chosenName);
      setRoomCode(result.state.code);
      setSession({ playerId: result.playerId, roomCode: result.state.code });
      latestVersion.current = result.version;
      setRoom(result.state);
      return { roomCode: result.state.code, playerId: result.playerId, status: result.state.status };
    } finally {
      setBusy(false);
    }
  }, [name, roomCode]);

  async function submitLobby(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await enterRoom(mode); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Something went wrong.'); }
  }

  const startRound = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<RoomResponse>(`/api/rooms/${session.roomCode}/start`, { method: 'POST', body: JSON.stringify({ playerId: session.playerId }) });
      applyRoomResponse(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the round.');
    } finally { setBusy(false); }
  }, [applyRoomResponse, session]);

  const steer = useCallback((direction: Direction) => {
    if (!session || room?.status !== 'playing') return;
    inputChain.current = inputChain.current.then(async () => {
      const result = await api<RoomResponse>(`/api/rooms/${session.roomCode}/input`, { method: 'POST', body: JSON.stringify({ playerId: session.playerId, direction }) });
      applyRoomResponse(result);
    }).catch(() => undefined);
  }, [applyRoomResponse, room?.status, session]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    let timer = 0;
    const poll = async () => {
      try {
        const result = await api<RoomResponse>(`/api/rooms/${session.roomCode}`);
        if (active) { applyRoomResponse(result); setError(''); }
      } catch (caught) {
        if (active && caught instanceof Error && !caught.message.includes('busy')) setError(caught.message);
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), 90);
      }
    };
    void poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [applyRoomResponse, session]);

  useEffect(() => {
    if (!session || room?.status !== 'playing') return;
    const directions: Record<string, Direction> = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const direction = directions[event.code];
      if (!direction) return;
      event.preventDefault();
      if (event.repeat) return;
      steer(direction);
    };
    window.addEventListener('keydown', onKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [room?.status, session, steer]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    const register = async () => {
      await context.registerTool({
        name: 'create_snek_room', title: 'Create Snek room', description: 'Create a live multiplayer Snek room and enter it as the host.',
        inputSchema: { type: 'object', properties: { nickname: { type: 'string', minLength: 1, maxLength: 16 } }, required: ['nickname'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: unknown) => { const nickname = (input as { nickname?: unknown })?.nickname; if (typeof nickname !== 'string') throw new Error('nickname is required'); return enterRoom('create', nickname); },
      }, { signal: controller.signal });
      await context.registerTool({
        name: 'join_snek_room', title: 'Join Snek room', description: 'Join an existing live Snek room with a nickname and room code.',
        inputSchema: { type: 'object', properties: { nickname: { type: 'string', minLength: 1, maxLength: 16 }, roomCode: { type: 'string', pattern: '^[A-HJ-NP-Z2-9]{5}$' } }, required: ['nickname', 'roomCode'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: unknown) => { const values = input as { nickname?: unknown; roomCode?: unknown }; if (typeof values.nickname !== 'string' || typeof values.roomCode !== 'string') throw new Error('nickname and roomCode are required'); return enterRoom('join', values.nickname, values.roomCode); },
      }, { signal: controller.signal });
    };
    void register().catch(() => undefined);
    return () => controller.abort();
  }, [enterRoom]);

  async function copyCode() {
    if (!room) return;
    await navigator.clipboard.writeText(room.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  const me = room?.players.find((player) => player.id === session?.playerId);
  const winner = room?.players.find((player) => player.id === room.winnerId);
  const rankedPlayers = useMemo(() => room?.players.slice().sort((a, b) => b.score - a.score) ?? [], [room]);

  if (room && session) {
    const isHost = session.playerId === room.hostId;
    return (
      <main className="arena-shell game-shell">
        <div className="aurora aurora-one" /><div className="aurora aurora-two" />
        <header className="topbar game-topbar">
          <Brand onClick={() => { setRoom(null); setSession(null); }} />
          <button className="room-code" onClick={() => void copyCode()} type="button"><span>ROOM</span><b>{room.code}</b>{copied ? <Check /> : <Copy />}</button>
          <div className="live-pill"><span /> {room.status === 'playing' ? 'Round live' : 'Room live'}</div>
        </header>

        <section className="game-layout">
          <aside className="score-panel">
            <div className="score-heading"><Users /><span>Players</span><b>{room.players.length}/4</b></div>
            <div className="score-list">
              {rankedPlayers.map((player, index) => (
                <div className={`score-player ${player.id === session.playerId ? 'is-me' : ''} ${!player.alive && room.status !== 'waiting' ? 'is-out' : ''}`} key={player.id}>
                  <span className="player-avatar" style={{ '--pod-color': player.color } as React.CSSProperties}>{player.name.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{player.name}</strong><small>{player.id === room.hostId ? 'Host' : player.id === session.playerId ? 'You' : `Player ${index + 1}`}</small></div>
                  <b>{player.score}</b>
                </div>
              ))}
              {Array.from({ length: 4 - room.players.length }, (_, index) => <div className="empty-player" key={index}><span>+</span> Open spot</div>)}
            </div>
            <div className="desktop-controls"><Keyboard /><span><b>WASD</b> or arrow keys</span></div>
            <button className="leave-button" onClick={() => { setRoom(null); setSession(null); }} type="button"><LogOut /> Leave room</button>
          </aside>

          <div className="playfield-card">
            <div className="playfield-bar">
              <span className="you-chip" style={{ '--pod-color': me?.color || '#a3ff4f' } as React.CSSProperties}><i /> {me?.name}</span>
              <span><b>32 × 22</b> arena</span>
            </div>
            <div className="playfield-wrap">
              <ArenaBoard state={room} playerId={session.playerId} onSteer={steer} />
              {room.status === 'waiting' && (
                <div className="game-overlay">
                  <div className="overlay-icon"><Users /></div>
                  <h2>{room.players.length < 2 ? 'Invite a friend' : 'Ready to slither?'}</h2>
                  <button className="invite-code" onClick={() => void copyCode()} type="button"><span>{room.code}</span>{copied ? <Check /> : <Copy />}</button>
                  {isHost ? <Button className="overlay-button" disabled={busy || room.players.length < 2} onClick={() => void startRound()}>{room.players.length < 2 ? 'Waiting for players' : 'Start round'} <ArrowRight /></Button> : <div className="waiting-pill"><span /> Waiting for host</div>}
                </div>
              )}
              {room.status === 'finished' && (
                <div className="game-overlay finish-overlay">
                  <div className="overlay-icon crown"><Crown /></div>
                  <h2>{winner?.id === session.playerId ? 'You win!' : `${winner?.name ?? 'Nobody'} wins!`}</h2>
                  <div className="winner-score">{winner?.score ?? 0} points</div>
                  {isHost ? <Button className="overlay-button" disabled={busy} onClick={() => void startRound()}><RotateCcw /> Play again</Button> : <div className="waiting-pill"><span /> Waiting for rematch</div>}
                </div>
              )}
            </div>
            <div className="mobile-controls" aria-label="Touch controls">
              <button onClick={() => steer('left')} aria-label="Move left">←</button>
              <button onClick={() => steer('up')} aria-label="Move up">↑</button>
              <button onClick={() => steer('down')} aria-label="Move down">↓</button>
              <button onClick={() => steer('right')} aria-label="Move right">→</button>
            </div>
          </div>
        </section>
        {error && <div className="error-toast" role="alert">{error}</div>}
      </main>
    );
  }

  return (
    <main className="arena-shell">
      <div className="aurora aurora-one" /><div className="aurora aurora-two" />
      <header className="topbar"><Brand /><div className="live-pill"><span /> Live rooms</div></header>
      <section className="lobby-layout">
        <div className="lobby-card">
          <div className="eyebrow"><Sparkles /> Multiplayer arcade</div>
          <h1>Snake is better<br />with <em>friends.</em></h1>
          <div className="mode-tabs" aria-label="Room action">
            <button className={mode === 'create' ? 'active' : ''} onClick={() => { setMode('create'); setError(''); }} type="button"><Gamepad2 /> Create</button>
            <button className={mode === 'join' ? 'active' : ''} onClick={() => { setMode('join'); setError(''); }} type="button"><Users /> Join</button>
          </div>
          <form className="lobby-fields" onSubmit={submitLobby}>
            <label htmlFor="nickname"><span>Nickname</span><Input id="nickname" aria-label="Nickname" autoComplete="nickname" maxLength={16} value={name} onChange={(event) => setName(event.target.value)} placeholder="Speedy" /></label>
            {mode === 'join' && <label htmlFor="room-code-input"><span>Room code</span><Input id="room-code-input" aria-label="Room code" className="uppercase" maxLength={5} value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="MINTY" /></label>}
            <Button className="play-button" disabled={busy} size="lg" type="submit">{busy ? 'Opening room…' : mode === 'create' ? 'Create room' : 'Join room'} <ArrowRight /></Button>
          </form>
          {error && <div className="lobby-error" role="alert">{error}</div>}
          <div className="controls-row"><span className="keycap">W</span><span className="keycap">A</span><span className="keycap">S</span><span className="keycap">D</span><span className="control-label">or arrow keys</span></div>
        </div>
        <div className="board-stage" aria-label="32 by 22 multiplayer snake arena preview">
          <div className="board-topline"><div><span className="player-dot lime" /> MINTY <b>1,200</b></div><div><span className="player-dot pink" /> BUBBLE <b>800</b></div></div>
          <ArenaBoard state={SAMPLE_ROOM} />
          <div className="board-caption"><span><b>32 × 22</b> extra roomy grid</span><span>Up to <b>4 sneks</b></span></div>
        </div>
      </section>
    </main>
  );
}
