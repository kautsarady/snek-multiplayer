# Snek! Multiplayer

A live multiplayer reimagining of the original [Snek](https://github.com/kautsarady/snek) game.

## Play

- Create a room and share its five-character code.
- Join with up to four players.
- The host starts each round.
- Move with WASD, arrow keys, the touch controls, or a swipe across the board.
- Eat stars for 100 points and stay clear of every snake.

The arena wraps at every edge and uses a 32 × 22 grid.

Each room runs in one authoritative Cloudflare Durable Object. The server accepts controls and pushes synchronized state over WebSockets on an 80 ms game tick; the browser smoothly interpolates each movement between ticks.

## Development

```bash
npm install
npm run dev
```

Run the real-time game server locally in a second terminal:

```bash
npm run realtime:dev
```

Validate both surfaces with `npm run build` and `npm run realtime:check`.
