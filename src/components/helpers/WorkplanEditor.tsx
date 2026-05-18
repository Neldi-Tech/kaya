'use client';

// Parent-facing workplan setup for one helper. Loads items from the
// helper's `workplanItems` subcollection; auto-saves on every edit.
// Used in two places:
//   1. Settings → Helpers → expanded HelperRow (per-helper deep
//      config, alongside access cards + frequency)
//   2. Pantry → People → expanded row (Household-context view)
// Both surfaces show the same data + the same edit affordances.

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { Check, ChevronDown, ChevronUp, Pause, Play, Trash2, ClipboardList, Plus } from 'lucide-react';
import Link from 'next/link';
import {
  listWorkplanItems, addWorkplanItem, updateWorkplanItem, deleteWorkplanItem,
  todayDayOfWeek, upcomingAdhoc, NANNY_STARTER_ITEMS,
} from '@/lib/workplan';
import { toDisplayDate } from '@/lib/dates';
import type { HelperLink, WorkplanItem, WorkplanPeriod, DayOfWeek } from '@/lib/firestore';

export default function WorkplanEditor({
  familyId, helperUid, helperName, presetHint,
  defaultOpen = false,
}: {
  familyId: string;
  helperUid: string;
  helperName: string;
  presetHint: HelperLink['preset'];
  /** Defaults closed (Settings context). Pantry People page passes
   *  true so it's open as soon as the parent expands a helper row. */
  defaultOpen?: boolean;
}) {
  const { profile } = useAuth();
  const confirmAction = useConfirm();
  const [items, setItems] = useState<WorkplanItem[] | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const flash = () => { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500); };

  const reload = useCallback(async () => {
    const list = await listWorkplanItems(familyId, helperUid);
    setItems(list);
  }, [familyId, helperUid]);
  useEffect(() => { reload(); }, [reload]);

  // v4-final §04 Step 7 — keep the recurring/adhoc lists separate. The
  // per-day matrix below only makes sense for recurring items; ad-hoc
  // one-offs render in a small read-only preview at the top of the
  // editor so the parent sees "what I assigned + when" without having
  // to look on the helper's home.
  const recurringItems = (items ?? []).filter((i) => (i.kind ?? 'recurring') === 'recurring');
  const adhocUpcoming = upcomingAdhoc(items ?? []);
  const grouped: Record<WorkplanPeriod, WorkplanItem[]> = {
    morning: [],
    anytime: [],
    evening: [],
  };
  for (const i of recurringItems) grouped[i.period].push(i);

  // Today's count includes both flavours so the eyebrow accurately
  // reflects what the helper will see on /helper today.
  const dow = todayDayOfWeek();
  const todayIso = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();
  const todaysCount = (items ?? []).filter((i) => {
    if (!i.active) return false;
    if ((i.kind ?? 'recurring') === 'adhoc') return (i.scheduledDates ?? []).includes(todayIso);
    return i.daysOfWeek.includes(dow);
  }).length;
  const totalActive = (items ?? []).filter((i) => i.active).length;

  const seedStarter = async () => {
    if (!profile?.uid) return;
    setBusy(true);
    try {
      for (const item of NANNY_STARTER_ITEMS) {
        await addWorkplanItem(familyId, helperUid, { ...item, createdBy: profile.uid });
      }
      await reload();
      flash();
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-kaya-cream/40"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-kaya-sand inline-flex items-center gap-1.5">
            <ClipboardList size={12} /> Workplan
          </p>
          <p className="text-[11px] text-kaya-sand mt-0.5 truncate">
            {items === null ? 'Loading…' :
             totalActive === 0 ? 'No tasks yet — tap to set up' :
             `${todaysCount} today · ${totalActive} total`}
          </p>
        </div>
        {open ? <ChevronUp size={16} className="text-kaya-sand flex-shrink-0" /> : <ChevronDown size={16} className="text-kaya-sand flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-kaya-warm-dark/40 p-3 space-y-3 bg-kaya-cream/30">
          {savedFlash && (
            <div className="text-[10px] uppercase tracking-wider text-green-700 font-bold inline-flex items-center gap-1">
              <Check size={12} /> Saved
            </div>
          )}

          {/* Upcoming ad-hoc preview (v4-final §04 Step 7) — read-only
              list of one-offs the parent has already assigned. Lets
              them eyeball "did I already ask for this?" before opening
              the Assign form. Edits land on /pantry/workplan/assign or
              by deleting the item from the recurring matrix below if
              kind===adhoc shows up there. */}
          {adhocUpcoming.length > 0 && (
            <div className="bg-[#FFF3D9] border border-hive-honey rounded-kaya p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-hive-honey-dk font-bold mb-1.5 inline-flex items-center gap-1.5">
                ✨ Upcoming one-offs <span className="text-[9px] text-kaya-sand normal-case font-normal">({adhocUpcoming.length})</span>
              </p>
              <ul className="space-y-1">
                {adhocUpcoming.map((a) => {
                  const dates = (a.scheduledDates ?? []).slice().sort();
                  // 2026-05-18 — render dates as DD-Mmm-YYYY (toDisplayDate)
                  // instead of raw ISO. "18-May-2026 +1 more" reads cleanly;
                  // "2026-05-18 +1" is ambiguous (US/EU order) and ugly.
                  const summary = dates.length === 1
                    ? toDisplayDate(dates[0])
                    : `${toDisplayDate(dates[0])} +${dates.length - 1} more`;
                  return (
                    <li key={a.id} className="text-[11px] flex items-center gap-2">
                      <span className="text-base flex-shrink-0">{a.icon}</span>
                      <span className="font-bold truncate flex-1">{a.label}</span>
                      <span className="text-[10px] text-kaya-sand uppercase tracking-wider flex-shrink-0">
                        {a.period === 'morning' ? '☀️' : a.period === 'evening' ? '🌙' : '⏱️'} · {summary}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <Link
                href="/pantry/workplan/assign"
                className="mt-1.5 inline-block text-[10px] font-bold text-hive-honey-dk underline"
              >
                + Assign another →
              </Link>
            </div>
          )}

          {/* Empty-state copy keys off the RECURRING list — an ad-hoc-only
              workplan is still "no regular workplan set up yet". */}
          {items !== null && recurringItems.length === 0 && presetHint === 'nanny' && (
            <button
              type="button"
              onClick={seedStarter}
              disabled={busy}
              className="w-full px-3 py-2.5 text-xs bg-kaya-gold-light/30 border-2 border-dashed border-kaya-gold rounded-kaya hover:bg-kaya-gold-light/50 font-bold disabled:opacity-50"
            >
              ✨ Start with a Nanny starter pack (8 typical tasks)
            </button>
          )}
          {items !== null && recurringItems.length === 0 && presetHint !== 'nanny' && (
            <p className="text-[11px] text-kaya-sand italic">No recurring tasks yet. Use <span className="font-bold">Add task</span> to give {helperName} their daily responsibilities.</p>
          )}

          {(['morning', 'anytime', 'evening'] as WorkplanPeriod[]).map((period) => (
            grouped[period].length > 0 && (
              <div key={period}>
                <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1.5">
                  {period === 'morning' ? '☀️ Morning' : period === 'evening' ? '🌙 Evening' : '⏱️ Anytime'}
                </p>
                <div className="space-y-1.5">
                  {grouped[period].map((item) => (
                    <WorkplanItemRow
                      key={item.id}
                      item={item}
                      busy={busy}
                      onUpdate={async (patch) => {
                        setBusy(true);
                        try { await updateWorkplanItem(familyId, helperUid, item.id, patch); await reload(); flash(); }
                        finally { setBusy(false); }
                      }}
                      onDelete={async () => {
                        const ok = await confirmAction({
                          title: `Remove "${item.label}" from this helper's workplan?`,
                          confirmLabel: 'Remove',
                          tone: 'danger',
                        });
                        if (!ok) return;
                        setBusy(true);
                        try { await deleteWorkplanItem(familyId, helperUid, item.id); await reload(); flash(); }
                        finally { setBusy(false); }
                      }}
                    />
                  ))}
                </div>
              </div>
            )
          ))}

          {!showAdd ? (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="w-full px-3 py-2 text-xs font-bold bg-kaya-chocolate text-white rounded-kaya hover:bg-kaya-chocolate/90 inline-flex items-center justify-center gap-1.5"
            >
              <Plus size={14} /> Add task
            </button>
          ) : (
            <AddWorkplanItemForm
              onCancel={() => setShowAdd(false)}
              onAdd={async (input) => {
                if (!profile?.uid) return;
                setBusy(true);
                try {
                  await addWorkplanItem(familyId, helperUid, { ...input, createdBy: profile.uid });
                  await reload();
                  flash();
                  setShowAdd(false);
                } finally { setBusy(false); }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function WorkplanItemRow({ item, busy, onUpdate, onDelete }: {
  item: WorkplanItem;
  busy: boolean;
  onUpdate: (patch: Partial<WorkplanItem>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  return (
    <div className={`bg-white border border-kaya-warm-dark rounded-kaya ${item.active ? '' : 'opacity-50'}`}>
      <div className="px-2.5 py-2 flex items-center gap-2">
        <span className="text-xl flex-shrink-0">{item.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate">{item.label}</p>
          <div className="mt-0.5 flex items-center gap-1 flex-wrap">
            {(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as DayOfWeek[]).map((d) => {
              const on = item.daysOfWeek.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const next = on ? item.daysOfWeek.filter((x) => x !== d) : [...item.daysOfWeek, d];
                    await onUpdate({ daysOfWeek: next });
                  }}
                  className={`text-[9px] uppercase tracking-wider font-bold px-1 py-0.5 rounded ${on
                    ? 'bg-kaya-chocolate text-white'
                    : 'bg-kaya-cream text-kaya-sand hover:bg-white border border-kaya-warm-dark'
                  } disabled:opacity-50`}
                >
                  {d.slice(0, 1).toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => onUpdate({ active: !item.active })}
            className="p-1.5 text-kaya-sand hover:text-kaya-chocolate disabled:opacity-50"
            title={item.active ? 'Pause this task' : 'Resume'}
          >
            {item.active ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="p-1.5 text-kaya-sand hover:text-red-600 disabled:opacity-50"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function AddWorkplanItemForm({ onCancel, onAdd }: {
  onCancel: () => void;
  onAdd: (input: Omit<WorkplanItem, 'id' | 'createdAt' | 'createdBy'>) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState('✅');
  const [days, setDays] = useState<DayOfWeek[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [period, setPeriod] = useState<WorkplanPeriod>('anytime');
  const [busy, setBusy] = useState(false);

  const toggleDay = (d: DayOfWeek) =>
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);

  return (
    <div className="bg-white border-2 border-kaya-gold rounded-kaya p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={icon}
          onChange={(e) => setIcon(e.target.value.slice(0, 2))}
          className="w-12 text-center text-xl px-1 py-1.5 bg-kaya-cream border border-kaya-warm-dark rounded-kaya"
          placeholder="🛏️"
          aria-label="Emoji"
        />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Task name (e.g. Make beds)"
          className="flex-1 px-2 py-1.5 text-sm bg-kaya-cream border border-kaya-warm-dark rounded-kaya focus:outline-none focus:border-kaya-chocolate"
          autoFocus
        />
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1">Days</p>
        <div className="flex items-center gap-1">
          {(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as DayOfWeek[]).map((d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded ${on
                  ? 'bg-kaya-chocolate text-white'
                  : 'bg-kaya-cream text-kaya-sand hover:bg-white border border-kaya-warm-dark'
                }`}
              >
                {d.slice(0, 1).toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1">When</p>
        <div className="grid grid-cols-3 gap-1">
          {(['morning', 'anytime', 'evening'] as WorkplanPeriod[]).map((p) => {
            const on = p === period;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`text-xs py-1.5 rounded-kaya border ${on
                  ? 'bg-kaya-chocolate text-white border-kaya-chocolate'
                  : 'bg-white border-kaya-warm-dark text-kaya-chocolate hover:border-kaya-chocolate'
                }`}
              >
                {p === 'morning' ? '☀️ Morning' : p === 'evening' ? '🌙 Evening' : '⏱️ Anytime'}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-kaya-sand hover:text-kaya-chocolate"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !label.trim() || days.length === 0}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdd({ label: label.trim(), icon, daysOfWeek: days, period, active: true });
            } finally { setBusy(false); }
          }}
          className="flex-1 px-3 py-1.5 text-xs font-bold bg-kaya-chocolate text-white rounded-kaya hover:bg-kaya-chocolate/90 disabled:opacity-50"
        >
          Add task
        </button>
      </div>
    </div>
  );
}
