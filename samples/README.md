# Kaya · Mobile-compat samples

Drop-in React + TypeScript components implementing the three asks from
the 30-May review. Self-contained — no external imports beyond React,
inline hex colours so they Just Work in any Tailwind setup.

**Live HTML preview:**
https://raw.githack.com/etimotheo1/kaya/claude/samples-iLiOX/samples/mockups.html

## Files

| File | Drops into | Solves |
|------|------------|--------|
| `components/StockChangeLog.tsx`    | Spark · Inventory & worth · AND Admin · Approval doc | Stock changes visible on both surfaces (one source, two presentations) |
| `components/MeterLastReading.tsx`  | Every metered module (Luku / Maji / car odo / gas)  | "Last reading" hero — value · timestamp · who · how long ago |
| `components/UtilityRequestRow.tsx` | Utility list page                                    | Mobile overflow fix — title truncates, amount never clips |

## Usage

### 1 · Stock change log — `list` mode on Inventory & worth

```tsx
import { StockChangeLog, type StockChangeEvent } from '@/samples/components/StockChangeLog';

const events: StockChangeEvent[] = [
  { id: 'e1', kind: 'add',   qty: 5,   unit: 'crate', deltaCents:  2_500_000, at: '2026-05-28', by: 'Elia',  source: 'daily stock-take' },
  { id: 'e2', kind: 'sell',  qty: -12, unit: 'unit',  deltaCents: -9_600_000, at: '2026-05-29', by: 'Diana', source: 'log sale' },
  { id: 'e3', kind: 'spoil', qty: -1,  unit: 'unit',  deltaCents:   -500_000, at: '2026-05-30', by: 'Elia',  source: 'daily stock-take' },
];

<StockChangeLog
  events={events}
  currency="TZS"
  mode="list"
  onSeeAll={() => router.push('/spark/inventory/changes')}
/>
```

### 1b · Same data — `summary` mode on the Approval doc

```tsx
<StockChangeLog
  events={events}            // same array
  currency="TZS"
  mode="summary"             // tight inflows/outflows summary
  onSeeAll={() => router.push('/spark/inventory/changes')}
  title="What changed in this approval window"
/>
```

### 2 · Last reading — drop above any meter's Daily Consumption

```tsx
import { MeterLastReading } from '@/samples/components/MeterLastReading';

// Luku electricity
<MeterLastReading
  reading={{ value: 247, unit: 'units', at: '2026-05-28T18:32:00Z', by: 'Elia' }}
  accentEmoji="⚡"
  onLogNew={() => openLogSheet('luku-security')}
/>

// Maji water — same component
<MeterLastReading
  reading={{ value: 13402, unit: 'L', at: '2026-05-29T07:10:00Z', by: 'Diana' }}
  accentEmoji="💧"
  onLogNew={() => openLogSheet('maji-compound')}
/>

// Car odometer — same component
<MeterLastReading
  reading={{ value: 84221, unit: 'km', at: '2026-05-27T16:45:00Z', by: 'Elia' }}
  accentEmoji="🚗"
  onLogNew={() => openLogSheet('car-hilux-odo')}
/>

// Empty state — never logged
<MeterLastReading reading={null} accentEmoji="🔥" onLogNew={...} />
```

### 3 · Utility row — replace the existing list row

```tsx
import { UtilityRequestRow } from '@/samples/components/UtilityRequestRow';

{requests.map((r) => (
  <UtilityRequestRow
    key={r.id}
    code={r.code}
    date={r.dateShort}
    meter={r.meter}                  // long names are fine — they truncate
    statusLabel={r.statusLabel}
    itemCount={r.items.length}
    amountLabel={r.amountLabel}      // already-formatted "≈ TZS 100,000"
    amountTone={r.status === 'awaiting' ? 'pending' : 'default'}
    onTap={() => router.push(`/utility/${r.code}`)}
  />
))}
```

## Design notes

- Hex values inline so the components stand alone — no dependency on a
  shared `tailwind.config` palette. Match Kaya: paper `#FBF5E5`, ink
  `#0E2240`, honey `#E8A300` / `#B57A00`, rule `#EDE3CC`, green
  `#1F8A4C`, danger `#C0392B`.
- All three rows truncate their text with `min-w-0` + `truncate` and
  reserve their right-column amount with `shrink-0 whitespace-nowrap` —
  the pattern that fixes the original overflow.
- No external icon library — emojis throughout, matching the in-app
  style in the screenshots.

## Status

✅ Samples branched at `claude/samples-iLiOX`
✅ HTML mock-ups live (raw.githack URL above)
✅ Drop-in React components committed alongside the HTML

⛔ Wiring into the actual Spark / Admin / Utility pages still pending
the repo where those features live — this repo (`etimotheo1/kaya`)
is the family points-system / pantry / hive app, not the surface the
screenshots are from.
