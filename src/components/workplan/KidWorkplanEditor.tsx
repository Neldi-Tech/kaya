// KidWorkplanEditor — parent surface to assign a child's workplan.
// Repeatable weekly tasks WITH real times (school schedule), playful
// categories (incl. Play), optional points. One-tap "school-day
// starter" seeds a sensible week. Mirrors the helper WorkplanEditor in
// spirit but tuned for kids (time + category + points). Parent-only.
'use client';

import { useEffect, useState } from 'react';
import type { DayOfWeek } from '@/lib/firestore';
import {
  type KidWorkplanItem, type KidTaskCategory, type KidTaskKind,
  subscribeKidWorkplanItems, listKidWorkplanItems, addKidWorkplanItem, updateKidWorkplanItem, deleteKidWorkplanItem,
  KID_CATEGORIES, categoryMeta, KID_DAY_LABELS, KID_SCHOOL_STARTER,
  sortKidItemsByTime, formatTimeLocal, todayDateString,
} from '@/lib/kidWorkplan';
import { Trash2, Plus, Sparkles, Check } from 'lucide-react';

export interface ChildRef { id: string; name: string }

const NAVY = '#0F1F44';
const GOLD = '#D4A847';

interface Draft {
  label: string;
  icon: string;
  category: KidTaskCategory;
  kind: KidTaskKind;
  daysOfWeek: DayOfWeek[];
  date: string;       // adhoc one-off date
  timeLocal: string;
  points: string;     // text input
}

const EMPTY: Draft = {
  label: '', icon: '', category: 'study', kind: 'recurring',
  daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], date: todayDateString(), timeLocal: '', points: '',
};

function draftFromItem(i: KidWorkplanItem): Draft {
  return {
    label: i.label,
    icon: i.icon,
    category: i.category,
    kind: i.kind ?? 'recurring',
    daysOfWeek: i.daysOfWeek?.length ? i.daysOfWeek : ['mon', 'tue', 'wed', 'thu', 'fri'],
    date: i.scheduledDates?.[0] ?? todayDateString(),
    timeLocal: i.timeLocal ?? '',
    points: i.pointsValue ? String(i.pointsValue) : '',
  };
}

/** Friendly message for a failed write so a save never silently does
 *  nothing. Permission-denied usually means the kids' workplan rules
 *  aren't deployed yet. */
function saveError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const message = (e as { message?: string })?.message ?? '';
  if (`${code} ${message}`.toLowerCase().includes('permission')) {
    return "Couldn't save — kids' workplan rules aren't live yet. Deploy Firestore rules, then try again.";
  }
  return "Couldn't save — check your connection and try again.";
}

export default function KidWorkplanEditor({ familyId, childId, childName, parentUid, allChildren = [] }: {
  familyId: string;
  childId: string;
  childName: string;
  parentUid: string;
  /** Full sibling list — enables "apply to all / multi-select" when
   *  creating tasks or seeding (plans are mostly the same across kids). */
  allChildren?: ChildRef[];
}) {
  const [items, setItems] = useState<KidWorkplanItem[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  // Which kids a NEW task / seed applies to. Defaults to the child whose
  // plan you're viewing; resets when you switch child. Editing an
  // existing task always stays per-child (independent docs).
  const [applyTo, setApplyTo] = useState<Set<string>>(() => new Set([childId]));
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => subscribeKidWorkplanItems(familyId, childId, setItems), [familyId, childId]);
  useEffect(() => { setApplyTo(new Set([childId])); setFlash(null); }, [childId]);

  // Resolve the target kids for a create/seed (never empty).
  const targets = (): string[] => (applyTo.size ? Array.from(applyTo) : [childId]);
  const flashFor = (ids: string[], verb: string) => {
    if (ids.length <= 1) { setFlash(null); return; }
    setFlash(`${verb} for ${ids.length} kids`);
    setTimeout(() => setFlash(null), 3500);
  };

  // Returns everything except createdBy (the add path stamps that;
  // edits must never rewrite it).
  const buildPayload = (d: Draft): Omit<KidWorkplanItem, 'id' | 'createdAt' | 'createdBy'> => {
    const cat = categoryMeta(d.category);
    const base = {
      label: d.label.trim() || cat.label,
      icon: d.icon.trim() || cat.icon,
      category: d.category,
      active: true,
      ...(d.timeLocal ? { timeLocal: d.timeLocal } : {}),
      ...(d.points && Number(d.points) > 0 ? { pointsValue: Number(d.points) } : {}),
    };
    if (d.kind === 'adhoc') {
      return { ...base, kind: 'adhoc', daysOfWeek: [], scheduledDates: [d.date] };
    }
    return { ...base, kind: 'recurring', daysOfWeek: d.daysOfWeek };
  };

  const submitNew = async () => {
    if (!draft.label.trim()) return;
    const ids = targets();
    setBusy(true);
    setErr(null);
    try {
      const payload = buildPayload(draft);
      for (const id of ids) {
        await addKidWorkplanItem(familyId, id, { ...payload, createdBy: parentUid });
      }
      setDraft(EMPTY);
      setAdding(false);
      flashFor(ids, 'Added');
    } catch (e) {
      setErr(saveError(e));
    } finally { setBusy(false); }
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    setErr(null);
    try {
      await updateKidWorkplanItem(familyId, childId, editingId, buildPayload(editDraft));
      setEditingId(null);
    } catch (e) {
      setErr(saveError(e));
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setErr(null);
    try { await deleteKidWorkplanItem(familyId, childId, id); }
    catch (e) { setErr(saveError(e)); }
    finally { setBusy(false); }
  };

  const seedStarter = async () => {
    const ids = targets();
    setBusy(true);
    setErr(null);
    try {
      const seeded: string[] = [];
      for (const id of ids) {
        // Skip kids who already have a plan so a multi-seed never
        // duplicates onto a child who's already set up.
        if (id !== childId) {
          const existing = await listKidWorkplanItems(familyId, id);
          if (existing.length > 0) continue;
        }
        for (const s of KID_SCHOOL_STARTER) {
          await addKidWorkplanItem(familyId, id, { ...s, createdBy: parentUid });
        }
        seeded.push(id);
      }
      flashFor(seeded, 'Seeded a plan');
    } catch (e) {
      setErr(saveError(e));
    } finally { setBusy(false); }
  };

  const sorted = items ? sortKidItemsByTime(items) : [];

  return (
    <div>
      {flash && (
        <div className="mb-2 rounded-hive bg-green-50 border border-green-300 text-green-800 text-[12px] font-extrabold px-3 py-2">✓ {flash}</div>
      )}
      {err && (
        <div className="mb-2 rounded-hive bg-red-50 border border-red-300 text-red-800 text-[12px] font-extrabold px-3 py-2">⚠ {err}</div>
      )}
      {items === null ? (
        <p className="text-[13px] text-hive-muted">Loading…</p>
      ) : items.length === 0 && !adding ? (
        <div className="rounded-hive-lg border border-hive-line bg-hive-paper p-6 text-center">
          <div className="text-3xl mb-2">🗓️</div>
          <p className="font-nunito font-extrabold text-[14px]">No tasks for {childName} yet</p>
          <p className="text-[12px] text-hive-muted mt-1 mb-4">Seed a school-day plan with times, then tweak — or add tasks one by one.</p>
          {allChildren.length > 1 && (
            <div className="max-w-xs mx-auto text-left mb-3">
              <ApplyToRow allChildren={allChildren} applyTo={applyTo} setApplyTo={setApplyTo} currentId={childId} />
              <p className="text-[10px] text-hive-muted -mt-1">Seeding skips any kid who already has a plan.</p>
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button onClick={seedStarter} disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-hive-pill text-white font-nunito font-extrabold text-[12px] disabled:opacity-50"
              style={{ background: NAVY }}>
              <Sparkles size={14} /> Seed school-day starter
            </button>
            <button onClick={() => setAdding(true)} disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-hive-pill bg-hive-cream border border-hive-line font-nunito font-extrabold text-[12px]">
              <Plus size={14} /> Add a task
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((item) => {
            const cat = categoryMeta(item.category);
            const isEditing = editingId === item.id;
            if (isEditing) {
              return (
                <div key={item.id} className="rounded-hive-lg border-2 border-hive-honey bg-hive-cream/40 p-3">
                  <DraftForm draft={editDraft} setDraft={setEditDraft} />
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button onClick={() => remove(item.id)} disabled={busy}
                      className="inline-flex items-center gap-1 text-[12px] font-bold text-hive-rose disabled:opacity-50">
                      <Trash2 size={13} /> Delete
                    </button>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingId(null)} className="text-[12px] font-bold text-hive-muted px-2">Cancel</button>
                      <button onClick={saveEdit} disabled={busy}
                        className="h-9 px-4 rounded-hive-pill text-white font-nunito font-extrabold text-[12px] disabled:opacity-50"
                        style={{ background: NAVY }}>Save</button>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <button key={item.id} type="button"
                onClick={() => { setEditingId(item.id); setEditDraft(draftFromItem(item)); }}
                className="w-full flex items-center gap-3 rounded-hive-lg border border-hive-line bg-hive-paper p-3 text-left hover:bg-hive-cream/40">
                <span className="flex-shrink-0 w-12 text-right text-[11px] font-extrabold" style={{ color: item.timeLocal ? NAVY : '#9aa' }}>
                  {item.timeLocal ? formatTimeLocal(item.timeLocal) : 'any'}
                </span>
                <span className="text-2xl flex-shrink-0">{item.icon || cat.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-nunito font-extrabold text-[13px] truncate">{item.label}</span>
                  <span className="block text-[10px] font-bold mt-0.5" style={{ color: cat.color }}>
                    {cat.label} · {(item.kind ?? 'recurring') === 'adhoc'
                      ? `one-off ${item.scheduledDates?.[0] ?? ''}`
                      : daysSummary(item.daysOfWeek)}
                  </span>
                </span>
                {item.pointsValue ? (
                  <span className="flex-shrink-0 text-[10px] font-black px-2 py-1 rounded-lg text-white" style={{ background: GOLD }}>+{item.pointsValue}</span>
                ) : null}
              </button>
            );
          })}

          {adding ? (
            <div className="rounded-hive-lg border-2 border-hive-honey bg-hive-cream/40 p-3">
              {allChildren.length > 1 && (
                <ApplyToRow allChildren={allChildren} applyTo={applyTo} setApplyTo={setApplyTo} currentId={childId} />
              )}
              <DraftForm draft={draft} setDraft={setDraft} />
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => { setAdding(false); setDraft(EMPTY); }} className="text-[12px] font-bold text-hive-muted px-2">Cancel</button>
                <button onClick={submitNew} disabled={busy || !draft.label.trim()}
                  className="h-9 px-4 rounded-hive-pill text-white font-nunito font-extrabold text-[12px] disabled:opacity-50"
                  style={{ background: NAVY }}>
                  {applyTo.size > 1 ? `Assign to ${applyTo.size} kids` : 'Assign task'}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-hive-lg border-2 border-dashed border-hive-line text-hive-navy font-nunito font-extrabold text-[12px] hover:bg-hive-cream/40">
              <Plus size={15} /> Add a task
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function daysSummary(days: DayOfWeek[]): string {
  if (!days || days.length === 0) return '—';
  const set = new Set(days);
  const wd: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const we: DayOfWeek[] = ['sat', 'sun'];
  if (days.length === 7) return 'Every day';
  if (wd.every((d) => set.has(d)) && !we.some((d) => set.has(d))) return 'Mon–Fri';
  if (we.every((d) => set.has(d)) && !wd.some((d) => set.has(d))) return 'Weekends';
  return KID_DAY_LABELS.filter((d) => set.has(d.id)).map((d) => d.short).join(' ');
}

// ── Apply-to multi-select (create / seed only) ────
// Lets the parent fan a new task or the starter plan out to several
// kids at once — plans are mostly the same. Per-child edits afterward
// stay independent (separate docs). Always keeps ≥1 child selected.
function ApplyToRow({ allChildren, applyTo, setApplyTo, currentId }: {
  allChildren: ChildRef[];
  applyTo: Set<string>;
  setApplyTo: (s: Set<string>) => void;
  currentId: string;
}) {
  if (allChildren.length <= 1) return null;
  const allOn = allChildren.every((c) => applyTo.has(c.id));
  const toggle = (id: string) => {
    const next = new Set(applyTo);
    if (next.has(id)) next.delete(id); else next.add(id);
    if (next.size === 0) next.add(currentId);
    setApplyTo(next);
  };
  const toggleAll = () => setApplyTo(allOn ? new Set([currentId]) : new Set(allChildren.map((c) => c.id)));
  const pill = (on: boolean) => (on
    ? { background: NAVY, borderColor: NAVY, color: '#fff' }
    : { background: '#fff', borderColor: '#E8DEC9', color: '#5C6975' });
  return (
    <div className="mb-2.5">
      <p className="text-[9px] font-black uppercase tracking-wider text-hive-muted mb-1.5">Apply to</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={toggleAll}
          className="text-[11px] font-extrabold px-2.5 py-1 rounded-lg border inline-flex items-center gap-1" style={pill(allOn)}>
          {allOn && <Check size={11} />}All kids
        </button>
        {allChildren.map((c) => {
          const on = applyTo.has(c.id);
          return (
            <button key={c.id} type="button" onClick={() => toggle(c.id)}
              className="text-[11px] font-extrabold px-2.5 py-1 rounded-lg border inline-flex items-center gap-1" style={pill(on)}>
              {on && <Check size={11} />}{c.name.split(' ')[0]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Shared draft form (add + edit) ────────────────
function DraftForm({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const toggleDay = (d: DayOfWeek) => {
    const has = draft.daysOfWeek.includes(d);
    set({ daysOfWeek: has ? draft.daysOfWeek.filter((x) => x !== d) : [...draft.daysOfWeek, d] });
  };
  const chip = (on: boolean) =>
    `text-[11px] font-extrabold px-2.5 py-1 rounded-lg border ${on ? 'text-white' : 'bg-white text-hive-muted border-hive-line'}`;
  const chipStyle = (on: boolean) => (on ? { background: NAVY, borderColor: NAVY } : {});

  return (
    <div className="space-y-2.5">
      <div>
        <label className="block text-[9px] font-black uppercase tracking-wider text-hive-muted mb-1">Task</label>
        <input value={draft.label} onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Homework — Maths" maxLength={60}
          className="w-full h-10 px-3 rounded-hive border border-hive-line bg-white text-[13px] font-bold focus:outline-none focus:border-hive-navy" />
      </div>

      <div>
        <label className="block text-[9px] font-black uppercase tracking-wider text-hive-muted mb-1">Category</label>
        <div className="flex flex-wrap gap-1.5">
          {KID_CATEGORIES.map((c) => {
            const on = draft.category === c.id;
            return (
              <button key={c.id} type="button" onClick={() => set({ category: c.id })}
                className="text-[11px] font-extrabold px-2.5 py-1 rounded-lg border"
                style={on ? { background: c.color, borderColor: c.color, color: '#fff' } : { background: '#fff', borderColor: '#E8DEC9', color: '#5C6975' }}>
                {c.icon} {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[9px] font-black uppercase tracking-wider text-hive-muted mb-1">Time (optional)</label>
          <input type="time" value={draft.timeLocal} onChange={(e) => set({ timeLocal: e.target.value })}
            className="w-full h-10 px-3 rounded-hive border border-hive-line bg-white text-[13px] font-bold focus:outline-none focus:border-hive-navy" />
        </div>
        <div>
          <label className="block text-[9px] font-black uppercase tracking-wider text-hive-muted mb-1">Points (optional)</label>
          <input type="number" min={0} value={draft.points} onChange={(e) => set({ points: e.target.value })}
            placeholder="0"
            className="w-full h-10 px-3 rounded-hive border border-hive-line bg-white text-[13px] font-bold focus:outline-none focus:border-hive-navy" />
        </div>
      </div>

      <div>
        <label className="block text-[9px] font-black uppercase tracking-wider text-hive-muted mb-1">Repeat</label>
        <div className="flex gap-1.5 mb-2">
          <button type="button" onClick={() => set({ kind: 'recurring' })} className={chip(draft.kind === 'recurring')} style={chipStyle(draft.kind === 'recurring')}>Weekly</button>
          <button type="button" onClick={() => set({ kind: 'adhoc' })} className={chip(draft.kind === 'adhoc')} style={chipStyle(draft.kind === 'adhoc')}>One-off</button>
        </div>
        {draft.kind === 'recurring' ? (
          <div className="flex flex-wrap gap-1.5">
            {KID_DAY_LABELS.map((d) => {
              const on = draft.daysOfWeek.includes(d.id);
              return (
                <button key={d.id} type="button" onClick={() => toggleDay(d.id)} className={chip(on)} style={chipStyle(on)}>{d.short}</button>
              );
            })}
          </div>
        ) : (
          <input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })}
            className="w-full h-10 px-3 rounded-hive border border-hive-line bg-white text-[13px] font-bold focus:outline-none focus:border-hive-navy" />
        )}
      </div>

      <div>
        <label className="block text-[9px] font-black uppercase tracking-wider text-hive-muted mb-1">Icon (optional — defaults to category)</label>
        <input value={draft.icon} onChange={(e) => set({ icon: e.target.value })}
          placeholder={categoryMeta(draft.category).icon} maxLength={4}
          className="w-20 h-10 px-3 rounded-hive border border-hive-line bg-white text-[15px] text-center focus:outline-none focus:border-hive-navy" />
      </div>
    </div>
  );
}
