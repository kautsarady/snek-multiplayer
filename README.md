# Snek! Multiplayer

A live multiplayer reimagining of the original [Snek](https://github.com/kautsarady/snek) game.

## Play

- Create a room and share its five-character code.
- Join with up to four players.
- The host starts each round.
- Move with WASD, arrow keys, the touch controls, or a swipe across the board.
- Eat stars for 100 points and stay clear of every snake.

The arena wraps at every edge and uses a 32 × 22 grid.

## Development

```bash
npm install
npm run dev
```

Database schema changes are defined in `db/schema.ts` and generated with:

```bash
npm run db:generate
```
