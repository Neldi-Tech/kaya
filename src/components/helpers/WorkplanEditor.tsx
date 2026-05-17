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
import { Check, ChevronDown, ChevronUp, Pause, Play, Trash2, ClipboardList, Plus } from 'lucide-react';
import {
  listWorkplanItems, addWorkplanItem, updateWorkplanItem, deleteWorkplanItem,
  todayDayOfWeek, NANNY_STARTER_ITEMS,
} from '@/lib/workplan';
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

  const grouped: Record<WorkplanPeriod, WorkplanItem[]> = {
    morning: [],
    anytime: [],
    evening: [],
  };
  for (const i of items ?? []) grouped[i.period].push(i);

  const todaysCount = (items ?? []).filter((i) => i.active && i.daysOfWeek.includes(todayDayOfWeek())).length;
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

          {items !== null && items.length === 0 && presetHint === 'nanny' && (
            <button
              type="button"
              onClick={seedStarter}
              disabled={busy}
              className="w-full px-3 py-2.5 text-xs bg-kaya-gold-light/30 border-2 border-dashed border-kaya-gold rounded-kaya hover:bg-kaya-gold-light/50 font-bold disabled:opacity-50"
            >
              ✨ Start with a Nanny starter pack (8 typical tasks)
            </button>
          )}
          {items !== null && items.length === 0 && presetHint !== 'nanny' && (
            <p className="text-[11px] text-kaya-sand italic">No tasks yet. Use <span className="font-bold">Add task</span> to give {helperName} their daily responsibilities.</p>
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
                        if (!confirm(`Remove "${item.label}" from this helper's workplan?`)) return;
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
