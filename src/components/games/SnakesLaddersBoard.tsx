'use client';

// Presentational Snakes & Ladders board (10×10). Shared by the same-device
// component and the two-device room play. Stateless — just paints the grid +
// the two pawns from `pos`. Lives in its own file so both can import it
// without a circular dependency.

import { SL_LADDERS, SL_SNAKES, slCellNumber } from '@/lib/snakesLadders';

export default function SnakesLaddersBoard({ pos }: { pos: [number, number] }) {
  return (
    <div className="grid grid-cols-10 gap-px rounded-kaya overflow-hidden bg-games-ink/10 p-1 mx-auto" style={{ width: 'min(100%, 330px)' }}>
      {Array.from({ length: 100 }, (_, i) => {
        const r = Math.floor(i / 10), c = i % 10;
        const n = slCellNumber(r, c);
        const hasP1 = pos[0] === n;
        const hasP2 = pos[1] === n;
        const ladder = SL_LADDERS[n] !== undefined;
        const snake = SL_SNAKES[n] !== undefined;
        return (
          <div
            key={i}
            className="aspect-square flex items-center justify-center relative"
            style={{ background: n === 100 ? '#A7F3D0' : ladder ? '#DBEAFE' : snake ? '#FFE4E4' : '#FFFFFF', fontSize: 7 }}
          >
            <span className="absolute top-0 left-0.5 text-games-ink-soft font-bold" style={{ fontSize: 6 }}>{n}</span>
            {ladder && <span style={{ fontSize: 9 }}>🪜</span>}
            {snake && <span style={{ fontSize: 9 }}>🐍</span>}
            <span className="absolute bottom-0 right-0 flex" style={{ fontSize: 8 }}>
              {hasP1 && <span>🔴</span>}
              {hasP2 && <span>🟡</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
