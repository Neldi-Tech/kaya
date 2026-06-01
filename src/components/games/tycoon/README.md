# Kaya Tycoon

An original family property-trading board game — a Kaya Games title. Production
port of the working prototype (`Kaya Games/Kaya Tycoon/Kaya_Tycoon_Prototype.html`).
Phase 1 is local pass-and-play (2–6 players, one device).

## How to run

It's part of the Kaya Next.js app — no separate build.

- **Play it:** `npm run dev`, sign in, open **Games → Kaya Tycoon** (`/games/tycoon`).
- **Engine tests:** `npx tsx src/lib/tycoon/engine.test.ts`
  (Node's built-in `node:test`, zero extra deps — deterministic with a seeded RNG.)
- **Typecheck:** `npx tsc --noEmit`

## Architecture (engine / UI split)

The game logic is a **pure, UI-independent module** so online multiplayer can be
added later without a rewrite.

```
src/lib/tycoon/                 ← pure engine (no React, no DOM, no Kaya imports)
  types.ts      GameState, Player, Tile, Prompt, GameEvent, …
  data.ts       BASE board (40 tiles), 12 country PACKS, Universe theme, cards, constants
  currency.ts   niceRound, conv, money, the home-currency availability rule
  engine.ts     createGame + pure reducers (roll, buy, auction, rent, build,
                mortgage, cards, jail, debt→raise-cash, bankruptcy, endTurn, win)
  engine.test.ts  headless deterministic tests
  index.ts      barrel (UI imports from '@/lib/tycoon')

src/components/games/
  KayaTycoon.tsx              ← top-level (wires the hook to the views), full-screen
  tycoon/
    useTycoon.ts   React orchestrator: holds GameState, plays each action's
                   emitted `events` as a timed animation, then commits next state
    SetupScreen.tsx, Board.tsx, SidePanel.tsx, Modals.tsx, Confetti.tsx, TycoonStyles.tsx
```

**Where the data lives:** all board/pack/currency/card data is in `src/lib/tycoon/data.ts`,
ported verbatim from the prototype. The economy is authored in the BASE currency
(US$ ×1) and scaled per-currency by `conv` + `niceRound`.

**Engine contract:** every action is `(state, …args) => { state, events }`. State is
treated immutably (each action clones, mutates the clone, returns it). `events` is an
animation/log timeline the UI plays; tests ignore it and assert on the returned state.
Randomness is injected (`Rng`) so games are reproducible — production uses `Math.random`,
tests use `makeRng(seed)`.

## How Phase 2 (online) slots in

Nothing here blocks it:

- Actions are pure and serialisable-driven, so a thin `net` layer can **broadcast the
  same actions** and apply them on every client (optimistic local apply + server
  reconcile). The engine doesn't know whether play is local or online.
- `board` / `cur` / `themeRender` on `GameState` are **derived from `GameConfig`**
  (rebuildable via `createGame`/`buildBoard`), so only the dynamic state + the config
  need syncing — not the functions/derived board.
- Kaya already ships the infrastructure: `MultiDeviceRoom.tsx`, `gameSessions.ts`, and
  `games/join/[code]`. Tycoon can reuse the same room-code + turn-ownership plumbing the
  other multi-device games use.

## Rewards (deferred — one product decision)

Phase 1 ships Tycoon as a **"just for fun"** family game (`points: 0` in the catalog) and
owns its own win/standings screen, so it does **not** call the runner's award route.
Pass-and-play with 2–6 players doesn't map cleanly onto the single-kid House-Points /
Fun-Points model, and that model is itself still being finalised. Wiring rewards (award
the device-owner on a win? per-player Fun-Points?) is a deliberate follow-up for Elia.

## Deviations from the prototype

Aimed for zero; behaviour, numbers, layout and flow match the prototype 1:1. The three
exceptions are deliberate fixes to prototype edge-case bugs:

1. **Debt + the Free-Parking pot (bug fix).** In the prototype, an unaffordable tax or
   card-fine credited the pot immediately *and again* on settle (double-count), because
   the landing finished synchronously while the raise-cash modal was open. The engine
   pauses the landing until the debt resolves, so the pot is credited exactly once.
2. **Birthday card with an insolvent payer (simplification).** The prototype could open
   and overwrite a raise-cash modal mid-loop for a non-current player. The engine instead
   has each other player pay what they can (down to 0) — no interactive raise-cash for a
   non-current player. (Rare multi-insolvency edge.)
3. **Jail fee while insolvent (Grand Tour).** A player who can't afford the after-3-tries
   fee goes through raise-cash and stays put that turn rather than moving. (Rare edge.)
