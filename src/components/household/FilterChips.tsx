'use client';

// Horizontal scrollable chip row. Mobile-friendly (overflow-x-auto).
// One chip per filter option; the "All" chip clears the active selection.

export interface FilterChip {
  id: string;
  label: string;
  emoji?: string;
  count?: number;       // optional count to show "Faith (3)"
}

export function FilterChips({
  chips,
  activeId,
  onChange,
  allLabel = 'All',
}: {
  chips: FilterChip[];
  activeId: string | null;
  onChange: (id: string | null) => void;
  allLabel?: string;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
      <Chip active={activeId == null} onClick={() => onChange(null)}>
        {allLabel}
      </Chip>
      {chips.map((c) => (
        <Chip
          key={c.id}
          active={activeId === c.id}
          onClick={() => onChange(c.id === activeId ? null : c.id)}
        >
          {c.emoji != null && <span className="mr-1">{c.emoji}</span>}
          {c.label}
          {c.count != null && <span className="ml-1 text-pulse-navy/55">({c.count})</span>}
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
        active
          ? 'bg-pulse-navy text-pulse-cream border-pulse-navy'
          : 'bg-white text-pulse-navy/80 border-pulse-navy/15 hover:border-pulse-gold/60'
      }`}
    >
      {children}
    </button>
  );
}
