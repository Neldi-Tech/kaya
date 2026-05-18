'use client';

// Reusable "Start from template" picker (2026-05-18). Mounted on each
// purchase-module home page above the "+ New request" button.
// Subscribes to the family's templates for the matching module;
// renders a small collapsed-by-default panel with N templates;
// caller-supplied onPick handler creates the draft (and handles any
// module-specific pre-pick like Drivers vehicle / Utility meter).
//
// Renders nothing when the family has zero templates for this module
// — keeps the module home clean for new families.

import { useEffect, useState } from 'react';
import {
  subscribeToTemplates,
  type PurchaseTemplate,
  type PurchaseModule,
} from '@/lib/purchase';
import { formatCents } from './format';
import { toDisplayDate } from '@/lib/dates';

interface Props {
  familyId: string;
  module: PurchaseModule;
  currency: string;
  /** Called when the user taps a template. Returning a Promise lets
   *  the picker show a busy state on the chosen row. Caller is
   *  responsible for createDraftFromTemplate + navigation (and any
   *  module-specific picker like Drivers vehicle / Utility meter). */
  onPick: (template: PurchaseTemplate) => void | Promise<void>;
}

export default function TemplatePicker({ familyId, module, currency, onPick }: Props) {
  const [templates, setTemplates] = useState<PurchaseTemplate[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => subscribeToTemplates(familyId, module, setTemplates), [familyId, module]);

  if (templates.length === 0) return null;

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive mb-3 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full p-3 flex items-center justify-between text-left hover:bg-hive-cream/40"
        aria-expanded={expanded}
      >
        <span className="font-nunito font-extrabold text-sm inline-flex items-center gap-2">
          📋 Start from template
          <span className="text-[11px] text-hive-muted font-bold">({templates.length})</span>
        </span>
        <span className="text-hive-muted text-xs font-bold">{expanded ? '▴ Hide' : '▾ Show'}</span>
      </button>
      {expanded && (
        <ul className="border-t border-hive-line">
          {templates.map((t) => {
            const isApproved = t.sourceStatus === 'approved';
            const when = t.createdAt?.toDate?.();
            const whenStr = when ? toDisplayDate(formatToIso(when)) : '';
            return (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={busy === t.id}
                  onClick={async () => {
                    setBusy(t.id);
                    try { await onPick(t); } finally { setBusy(null); }
                  }}
                  className="w-full p-3 text-left flex items-center gap-3 hover:bg-hive-cream/40 border-t border-hive-line first:border-t-0 disabled:opacity-60"
                >
                  <span
                    className={`text-[10px] font-nunito font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      isApproved
                        ? 'bg-pantry-leaf-soft text-pantry-leaf-dk'
                        : 'bg-[#FCEAEA] text-hive-rose'
                    }`}
                    title={isApproved ? 'Last approved' : 'Last rejected'}
                  >
                    {isApproved ? '✓ Approved' : '↩ Rejected'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-nunito font-extrabold text-sm truncate">{t.name}</p>
                    <p className="text-[11px] text-hive-muted truncate">
                      {t.items.length} item{t.items.length === 1 ? '' : 's'} · ~{formatCents(t.estimatedTotalCents, currency)}
                      {t.useCount > 0 && ` · used ${t.useCount}×`}
                      {whenStr && ` · saved ${whenStr}`}
                    </p>
                  </div>
                  <span className="text-pantry-leaf-dk font-nunito font-extrabold text-xs flex-shrink-0">
                    {busy === t.id ? '…' : '＋ Use'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Local Date → YYYY-MM-DD for toDisplayDate. Duplicated locally to
 *  avoid pulling the whole workplan lib into a UI component. */
function formatToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
