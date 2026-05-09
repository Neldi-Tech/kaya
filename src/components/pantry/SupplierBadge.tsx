'use client';

// Compact supplier label used inline on staple rows + list rows.
// Renders the supplier's first letter avatar + name. Falls back to
// "No supplier" italics when nothing's tagged.

import type { Supplier } from '@/lib/pantry';

export default function SupplierBadge({ supplier }: { supplier?: Supplier | null }) {
  if (!supplier) {
    return <span className="text-[10px] italic text-hive-muted">No supplier</span>;
  }
  const initial = supplier.name?.[0]?.toUpperCase() || '?';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-4 h-4 rounded-[5px] bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center text-[9px] font-nunito font-extrabold">
        {initial}
      </span>
      <span className="text-[11px] text-hive-muted font-bold truncate max-w-[120px]">
        {supplier.name}
      </span>
    </span>
  );
}
