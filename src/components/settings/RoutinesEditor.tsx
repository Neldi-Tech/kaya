'use client';

// Parent-facing CRUD for the morning / evening routine list that drives
// the Rate page. Each row maps 1:1 to a `Routine` on `family.routines`.
// Edits persist to the family doc via `updateFamily`; FamilyContext
// re-reads and the Rate page picks up changes immediately.
//
// Mounted from /settings (parent-only).

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { updateFamily, Routine } from '@/lib/firestore';

type Period = 'morning' | 'evening';

const SUGGESTED_ICONS = ['🛏️', '🪥', '🚿', '⏰', '🥣', '✨', '🤲', '⭐', '📚', '🍽️', '🌙', '🕌', '🧹', '👕', '💧', '🎒', '🏃', '🎵', '📖', '🐾'];

export default function RoutinesEditor() {
  const { profile, isGuest } = useAuth();
  const { family, refresh } = useFamily();
  const [period, setPeriod] = useState<Period>('morning');
  const [working, setWorking] = useState<Routine[]>(family?.routines || []);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState('');

  // Re-sync if the family doc changes from elsewhere (another parent
  // editing, initial load, etc.) but don't trample a draft in progress.
  useEffect(() => {
    setWorking(family?.routines || []);
  }, [family?.routines]);

  const list = useMemo(
    () => working.filter((r) => r.period === period),
    [working, period],
  );

  const dirty = useMemo(() => {
    const a = JSON.stringify(family?.routines || []);
    const b = JSON.stringify(working);
    return a !== b;
  }, [family?.routines, working]);

  const updateRoutine = (id: string, patch: Partial<Routine>) => {
    setWorking((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeRoutine = (id: string) => {
    setWorking((prev) => prev.filter((r) => r.id !== id));
  };
  const moveRoutine = (id: string, dir: -1 | 1) => {
    setWorking((prev) => {
      const samePeriod = prev.filter((r) => r.period === period);
      const idx = samePeriod.findIndex((r) => r.id === id);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= samePeriod.length) return prev;
      const reordered = [...samePeriod];
      [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
      // Walk `prev`, slotting in the reordered items at the same-period
      // positions and leaving the other period in place.
      let i = 0;
      return prev.map((r) => (r.period === period ? reordered[i++] : r));
    });
  };
  const addRoutine = () => {
    const id = `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const fresh: Routine = {
      id,
      label: 'New routine',
      labelSw: '',
      icon: SUGGESTED_ICONS[Math.floor(Math.random() * SUGGESTED_ICONS.length)],
      period,
      pointsExcellent: 2,
      pointsGood: 1,
      pointsBad: 0,
      active: true,
    };
    setWorking((prev) => [...prev, fresh]);
  };

  const save = async () => {
    if (!profile?.familyId || isGuest) return;
    setError('');
    // Validate: every routine needs a non-empty label and positive points.
    for (const r of working) {
      if (!r.label.trim()) { setError('Every routine needs a name.'); return; }
      if (r.pointsExcellent < 0 || r.pointsGood < 0 || r.pointsBad < 0) {
        setError('Points cannot be negative.'); return;
      }
    }
    setSaving(true);
    try {
      await updateFamily(profile.familyId, { routines: working } as any);
      await refresh();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch (e: any) {
      setError(e?.message || 'Failed to save routines.');
    }
    setSaving(false);
  };

  const reset = () => {
    setWorking(family?.routines || []);
    setError('');
  };

  if (isGuest) {
    return (
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
        <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-2">Daily routines</p>
        <p className="text-[11px] text-kaya-sand">Routine editing is disabled in the demo. Sign up to manage your own list.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">Daily routines</p>
        <span className="text-[10px] text-kaya-sand-light">
          {working.filter((r) => r.active).length} active · {working.length} total
        </span>
      </div>
      <p className="text-[11px] text-kaya-sand mb-3 leading-relaxed">
        The tasks scored on the Rate page. Set Excellent / Good / Bad points per task. Toggle inactive to hide without deleting.
      </p>

      {/* Period tabs */}
      <div className="flex gap-2 mb-3">
        {(['morning', 'evening'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 h-9 text-xs font-bold rounded-kaya-sm transition-colors ${
              period === p ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'
            }`}
          >
            {p === 'morning' ? '☀️ Morning' : '🌙 Evening'} ({working.filter((r) => r.period === p).length})
          </button>
        ))}
      </div>

      {/* Routine rows */}
      <div className="space-y-2">
        {list.length === 0 && (
          <p className="text-[12px] text-kaya-sand-light text-center py-4">
            No {period} routines yet. Add one below.
          </p>
        )}
        {list.map((r, idx) => (
          <RoutineRow
            key={r.id}
            routine={r}
            isFirst={idx === 0}
            isLast={idx === list.length - 1}
            onChange={(patch) => updateRoutine(r.id, patch)}
            onRemove={() => removeRoutine(r.id)}
            onMove={(dir) => moveRoutine(r.id, dir)}
          />
        ))}
      </div>

      <button
        onClick={addRoutine}
        className="mt-3 w-full h-10 rounded-kaya-sm border-2 border-dashed border-kaya-warm-dark text-kaya-sand text-xs font-bold hover:border-kaya-chocolate hover:text-kaya-chocolate transition-colors"
      >
        + Add a {period} routine
      </button>

      {error && (
        <p className="text-red-500 text-[11px] mt-3 bg-red-50 border border-red-200 rounded-kaya-sm px-2 py-1.5">{error}</p>
      )}

      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-kaya-warm-dark/60">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="h-10 px-4 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40"
        >
          {saving ? 'Saving…' : savedFlash ? '✓ Saved' : 'Save routines'}
        </button>
        {dirty && !saving && (
          <button onClick={reset} className="h-10 px-3 text-[11px] font-bold text-kaya-sand hover:text-kaya-chocolate">
            Reset
          </button>
        )}
        {!dirty && !savedFlash && (
          <span className="text-[11px] text-kaya-sand-light">No unsaved changes.</span>
        )}
      </div>
    </div>
  );
}

function RoutineRow({
  routine, isFirst, isLast, onChange, onRemove, onMove,
}: {
  routine: Routine;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<Routine>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const confirmAction = useConfirm();
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  return (
    <div className={`border rounded-kaya-sm p-3 transition-colors ${
      routine.active ? 'border-kaya-warm-dark bg-white' : 'border-kaya-warm-dark/40 bg-kaya-warm/30 opacity-70'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        {/* Icon picker */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIconPickerOpen((v) => !v)}
            className="w-10 h-10 rounded-kaya-sm bg-kaya-warm flex items-center justify-center text-xl hover:bg-kaya-warm-dark/40 transition-colors"
            aria-label="Pick icon"
          >
            {routine.icon || '📋'}
          </button>
          {iconPickerOpen && (
            <div className="absolute z-10 mt-1 left-0 bg-white border border-kaya-warm-dark rounded-kaya-sm p-2 shadow-lg grid grid-cols-5 gap-1 w-[200px]">
              {SUGGESTED_ICONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => { onChange({ icon: emoji }); setIconPickerOpen(false); }}
                  className={`w-8 h-8 rounded text-lg flex items-center justify-center hover:bg-kaya-warm ${
                    routine.icon === emoji ? 'bg-kaya-gold/20' : ''
                  }`}
                >
                  {emoji}
                </button>
              ))}
              <input
                type="text"
                value={routine.icon || ''}
                onChange={(e) => onChange({ icon: e.target.value })}
                maxLength={4}
                className="col-span-5 h-8 px-2 mt-1 bg-kaya-cream rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                placeholder="Or paste any emoji"
              />
            </div>
          )}
        </div>

        {/* Label inputs */}
        <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
          <input
            value={routine.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="English name"
            className="h-10 px-2 bg-kaya-cream rounded-kaya-sm text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
          />
          <input
            value={routine.labelSw || ''}
            onChange={(e) => onChange({ labelSw: e.target.value })}
            placeholder="Swahili (optional)"
            className="h-10 px-2 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
          />
        </div>
      </div>

      {/* Points + controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <PointInput label="🌟 Exc" value={routine.pointsExcellent} onChange={(n) => onChange({ pointsExcellent: n })} color="#27AE60" />
        <PointInput label="👍 Good" value={routine.pointsGood} onChange={(n) => onChange({ pointsGood: n })} color="#D4A017" />
        <PointInput label="👎 Bad" value={routine.pointsBad} onChange={(n) => onChange({ pointsBad: n })} color="#E74C3C" />

        <div className="flex-1" />

        {/* Active toggle */}
        <button
          type="button"
          onClick={() => onChange({ active: !routine.active })}
          className="flex items-center gap-1.5"
          aria-label={routine.active ? 'Deactivate routine' : 'Activate routine'}
        >
          <div className={`w-9 h-5 rounded-full relative transition-colors ${routine.active ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'}`}>
            <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all" style={{ left: routine.active ? '18px' : '2px' }} />
          </div>
          <span className="text-[10px] font-bold text-kaya-sand">{routine.active ? 'ON' : 'OFF'}</span>
        </button>

        {/* Reorder */}
        <div className="flex">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={isFirst}
            className="w-7 h-7 rounded-l-kaya-sm bg-kaya-warm text-kaya-sand text-xs font-bold disabled:opacity-30 hover:bg-kaya-warm-dark/40"
            aria-label="Move up"
          >↑</button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={isLast}
            className="w-7 h-7 rounded-r-kaya-sm bg-kaya-warm text-kaya-sand text-xs font-bold disabled:opacity-30 hover:bg-kaya-warm-dark/40 border-l border-white"
            aria-label="Move down"
          >↓</button>
        </div>

        {/* Delete */}
        <button
          type="button"
          onClick={async () => {
            const ok = await confirmAction({
              title: `Delete "${routine.label}"?`,
              message: 'Past ratings keep their data but this row stops appearing on Rate.',
              confirmLabel: 'Delete',
              tone: 'danger',
            });
            if (ok) {
              onRemove();
            }
          }}
          className="w-7 h-7 rounded-kaya-sm bg-red-50 text-red-600 text-xs font-bold hover:bg-red-100"
          aria-label="Delete routine"
        >✕</button>
      </div>
    </div>
  );
}

function PointInput({
  label, value, onChange, color,
}: { label: string; value: number; onChange: (n: number) => void; color: string }) {
  return (
    <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-kaya-sand">
      <span style={{ color }}>{label}</span>
      <input
        type="number"
        min={0}
        max={20}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(Number.isNaN(n) ? 0 : Math.max(0, Math.min(20, n)));
        }}
        className="w-12 h-7 px-1 bg-kaya-cream rounded text-sm text-center font-bold focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
      />
    </label>
  );
}
