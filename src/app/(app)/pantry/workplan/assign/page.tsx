'use client';

// /pantry/workplan/assign — Assign one-off work form (v4-final §04 Step 7).
//
// Parent-facing four-field form for ad-hoc tasks outside the helper's
// recurring workplan. Maps 1:1 to the v4-final §04 Phone 2 mock:
//
//   1. WHO    — helper picker (single-select, photo + role + code)
//   2. WHAT   — emoji + label + optional one-line note
//   3. WHEN   — date picker with quick chips: Today / Tomorrow / pick
//                also supports multi-select (assign on Mon+Tue+Wed)
//   4. PERIOD — Morning / Anytime / Evening (mirrors recurring schema)
//
// On submit we write a single WorkplanItem with `kind: 'adhoc'` +
// `scheduledDates: [iso, ...]` to the helper's `workplanItems`
// subcollection — see `addAdhocWorkplanItem` in `src/lib/workplan.ts`.
//
// Out of scope (Step 8): push notification on assign. For now the
// helper sees the new item the next time they open /helper. Step 8
// wires FCM via the existing PWA pipeline (PR #49).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { listHelpers } from '@/lib/helpers';
import { addAdhocWorkplanItem, todayDateString } from '@/lib/workplan';
import { notifyAdhocAssigned } from '@/lib/notify';
import { toDisplayDate } from '@/lib/dates';
import type { HelperLink, WorkplanPeriod } from '@/lib/firestore';

// Emoji palette for the "What" picker. Curated to common helper-task
// vocabulary. Parents can also override by typing in the emoji slot.
const QUICK_EMOJI = ['🛠️', '🛒', '🐔', '🚗', '🧺', '🌿', '🧽', '💧', '📦', '🍽️', '👶', '📚'];

// Quick label suggestions per common preset (just inspiration — the
// label is free-text; this saves a tap for the most common one-offs).
const QUICK_LABELS_BY_PRESET: Record<HelperLink['preset'], string[]> = {
  nanny:       ['Make extra snack', 'Pick up at school', 'Iron shirts', 'Tidy guest room'],
  tutor:       ['Bring extra workbook', 'Cover Sunday session', 'Photocopy worksheets'],
  driver:      ['Pick up groceries', 'Top up fuel', 'Wash the car', 'School pickup'],
  gardener:    ['Buy extra chicken', 'Trim front hedge', 'Repair gate hinge', 'Water back garden'],
  grandparent: ['Read bedtime story', 'Take to park', 'Sunday lunch prep'],
  custom:      ['One-off task'],
};

// Period chips, mirrors the recurring schema vocabulary so completion
// percentages calc the same regardless of kind.
const PERIODS: { id: WorkplanPeriod; label: string; emoji: string }[] = [
  { id: 'morning', label: 'Morning', emoji: '☀️' },
  { id: 'anytime', label: 'Anytime', emoji: '⏱️' },
  { id: 'evening', label: 'Evening', emoji: '🌙' },
];

// Helper avatar emoji per preset — matches /pantry/workplan + Settings.
const PRESET_EMOJI: Record<HelperLink['preset'], string> = {
  nanny: '🤱', tutor: '📚', driver: '🚗', gardener: '🌿', grandparent: '👵', custom: '🤝',
};

// Build the next 7 days as { iso, label } so the date chips give a
// human-friendly weekday (parents shouldn't have to think "is the
// 21st a Thursday?"). Date labels use DD-Mmm format (e.g. "20-May")
// to match the universal date-planning style (toDisplayDate).
function nextSevenDays(): { iso: string; label: string; weekday: string }[] {
  const out: { iso: string; label: string; weekday: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = todayDateString(d);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    // "20-May" — strip the year for compactness in the chip (year is
    // implied as "next 7 days from now"); the full date is in the
    // hover/screen-reader path via the iso.
    const dd = toDisplayDate(iso).slice(0, 6); // "20-May"
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dd;
    out.push({ iso, label, weekday });
  }
  return out;
}

export default function AssignWorkPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family } = useFamily();
  const isParent = profile?.role === 'parent';

  const [helpers, setHelpers] = useState<HelperLink[] | null>(null);
  const [selectedHelperUid, setSelectedHelperUid] = useState<string | null>(null);
  const [icon, setIcon] = useState<string>('🛠️');
  const [label, setLabel] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [selectedDates, setSelectedDates] = useState<string[]>([todayDateString()]);
  const [period, setPeriod] = useState<WorkplanPeriod>('anytime');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneFlash, setDoneFlash] = useState<string | null>(null);

  // Load helpers (parent-only — helpers shouldn't reach this page).
  useEffect(() => {
    if (!family || !isParent) return;
    (async () => {
      const list = await listHelpers(family.id);
      const active = list.filter((h) => h.status !== 'removed');
      setHelpers(active);
      // Auto-select if there's only one helper — saves a tap.
      if (active.length === 1) setSelectedHelperUid(active[0].uid);
    })();
  }, [family, isParent]);

  const days = useMemo(() => nextSevenDays(), []);
  const selectedHelper = helpers?.find((h) => h.uid === selectedHelperUid) ?? null;
  const quickLabels = selectedHelper ? QUICK_LABELS_BY_PRESET[selectedHelper.preset] ?? [] : [];

  // Form validity — all 4 required fields filled.
  const canSubmit =
    !!selectedHelperUid &&
    label.trim().length > 0 &&
    selectedDates.length > 0 &&
    !!period &&
    !busy;

  const toggleDate = (iso: string) => {
    setSelectedDates((prev) =>
      prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort()
    );
  };

  const submit = async () => {
    if (!family || !profile?.uid || !selectedHelperUid) return;
    setError(null);
    setBusy(true);
    try {
      const trimmedLabel = label.trim();
      const trimmedNote = note.trim() || undefined;
      await addAdhocWorkplanItem(family.id, selectedHelperUid, {
        label: trimmedLabel,
        icon,
        period,
        scheduledDates: selectedDates,
        assignedBy: profile.uid,
        note: trimmedNote,
      });

      // Step 8: in-app bell + FCM web-push to the assigned helper.
      // Fire-and-forget so push failures don't roll back the write.
      const todayIso = todayDateString();
      const hasToday = selectedDates.includes(todayIso);
      const extraDays = selectedDates.length - (hasToday ? 1 : 0);
      // 2026-05-18 — notification copy uses DD-Mmm-YYYY (toDisplayDate)
      // instead of raw ISO. "18-May-2026" is unambiguous; "2026-05-18"
      // depends on the reader's mental locale.
      const scheduledLabel = hasToday
        ? extraDays > 0
          ? `today + ${extraDays} more day${extraDays === 1 ? '' : 's'}`
          : 'today'
        : selectedDates.length === 1
          ? toDisplayDate(selectedDates[0])
          : `${toDisplayDate(selectedDates[0])} + ${selectedDates.length - 1} more day${selectedDates.length - 1 === 1 ? '' : 's'}`;
      notifyAdhocAssigned({
        familyId: family.id,
        helperUid: selectedHelperUid,
        parentName: profile.displayName?.split(' ')[0] || 'A parent',
        taskLabel: trimmedLabel,
        taskIcon: icon,
        note: trimmedNote,
        scheduledLabel,
      }).catch(() => undefined);

      // Brief "Assigned ✓" flash, then bounce back to Workplan home.
      const helper = helpers?.find((h) => h.uid === selectedHelperUid);
      setDoneFlash(`Assigned to ${helper?.displayName ?? 'helper'} ✓`);
      setTimeout(() => router.push('/pantry/workplan'), 900);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || 'Failed to assign');
      setBusy(false);
    }
  };

  // Helper-side guard — the only people who land here without being
  // parent are bookmarks or accidentally tapping a link. Show the
  // explainer copy from Step 6.
  if (!isParent) {
    return (
      <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
        <div className="bg-[#FFF3D9] border border-hive-honey rounded-hive p-6 text-center">
          <div className="text-3xl mb-2">🛠️</div>
          <h3 className="font-nunito font-black text-lg text-hive-ink">Parent-only surface</h3>
          <p className="text-hive-ink text-sm mt-2 mb-4 leading-relaxed">
            Ad-hoc work is assigned by parents from here. Your end-of-day workplan
            (regular + any one-offs assigned to you) lives on your helper home.
          </p>
          <Link
            href="/pantry/workplan"
            className="inline-block text-[12px] font-nunito font-bold text-hive-honey-dk underline"
          >
            ← Back to Workplan
          </Link>
        </div>
      </div>
    );
  }

  if (!family) return null;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">
          Workplan · Assign one-off
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          Quick assign
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          Outside the regular plan — pick the helper, what to do, when, and which period of the day.
        </p>
      </div>

      {/* ── 1. WHO ── */}
      <Section title="1 · Who" subtitle="Who should do it?">
        {helpers === null && <p className="text-[12px] text-hive-muted">Loading helpers…</p>}
        {helpers && helpers.length === 0 && (
          <div className="bg-hive-paper border border-hive-line rounded-hive p-4 text-center">
            <p className="text-[12px] text-hive-muted mb-2">No active helpers yet.</p>
            <Link
              href="/settings/helpers"
              className="inline-block text-[12px] font-nunito font-bold text-pantry-leaf-dk underline"
            >
              + Add helper in Settings
            </Link>
          </div>
        )}
        {helpers && helpers.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {helpers.map((h) => {
              const on = selectedHelperUid === h.uid;
              return (
                <button
                  key={h.uid}
                  type="button"
                  onClick={() => setSelectedHelperUid(h.uid)}
                  className={`text-left p-3 rounded-hive border-2 transition-colors flex items-center gap-2.5 ${
                    on
                      ? 'bg-hive-honey/20 border-hive-honey-dk'
                      : 'bg-hive-paper border-hive-line hover:border-hive-honey'
                  }`}
                  aria-pressed={on}
                >
                  <span className="text-2xl flex-shrink-0">{PRESET_EMOJI[h.preset]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-nunito font-extrabold text-sm truncate">{h.displayName}</p>
                    <p className="text-[10px] text-hive-muted truncate uppercase tracking-wider mt-0.5">
                      {h.preset}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── 2. WHAT ── */}
      <Section title="2 · What" subtitle="The task itself">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value.slice(0, 2))}
              className="w-12 text-center text-xl px-1 py-2 bg-hive-paper border border-hive-line rounded-hive"
              placeholder="🛠️"
              aria-label="Emoji"
            />
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Buy extra chicken"
              className="flex-1 px-3 py-2 text-sm bg-hive-paper border border-hive-line rounded-hive focus:outline-none focus:border-hive-honey-dk"
              maxLength={60}
            />
          </div>

          {/* Quick emoji palette */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setIcon(e)}
                className={`text-xl w-9 h-9 rounded-hive border ${
                  icon === e
                    ? 'bg-hive-honey/30 border-hive-honey-dk'
                    : 'bg-hive-paper border-hive-line hover:border-hive-honey'
                }`}
                aria-label={`Pick ${e}`}
              >{e}</button>
            ))}
          </div>

          {/* Quick label suggestions — preset-aware. Saves typing. */}
          {quickLabels.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-hive-muted font-bold mb-1">Quick picks</p>
              <div className="flex flex-wrap gap-1.5">
                {quickLabels.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setLabel(s)}
                    className="text-[11px] font-nunito font-bold px-2.5 py-1 rounded-full bg-hive-paper border border-hive-line text-hive-muted hover:border-hive-honey hover:text-hive-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Optional note — short message to the helper */}
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (e.g. pls call when done)"
            className="w-full px-3 py-2 text-sm bg-hive-paper border border-hive-line rounded-hive focus:outline-none focus:border-hive-honey-dk"
            maxLength={120}
          />
        </div>
      </Section>

      {/* ── 3. WHEN ── */}
      <Section title="3 · When" subtitle="Pick one day or several">
        <div className="grid grid-cols-4 gap-1.5">
          {days.map((d) => {
            const on = selectedDates.includes(d.iso);
            return (
              <button
                key={d.iso}
                type="button"
                onClick={() => toggleDate(d.iso)}
                className={`p-2 rounded-hive border-2 text-center transition-colors ${
                  on
                    ? 'bg-hive-honey/20 border-hive-honey-dk'
                    : 'bg-hive-paper border-hive-line hover:border-hive-honey'
                }`}
                aria-pressed={on}
              >
                <p className="text-[10px] uppercase tracking-wider text-hive-muted font-bold">{d.weekday}</p>
                <p className="text-[11px] font-nunito font-extrabold mt-0.5">{d.label}</p>
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-hive-muted mt-2">
          {selectedDates.length === 0
            ? 'Pick at least one day.'
            : selectedDates.length === 1
              ? '1 day selected.'
              : `${selectedDates.length} days selected — helper sees this task on each.`}
        </p>
      </Section>

      {/* ── 4. PERIOD ── */}
      <Section title="4 · Period" subtitle="When in the day?">
        <div className="grid grid-cols-3 gap-1.5">
          {PERIODS.map((p) => {
            const on = period === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriod(p.id)}
                className={`p-3 rounded-hive border-2 text-center transition-colors ${
                  on
                    ? 'bg-hive-honey/20 border-hive-honey-dk'
                    : 'bg-hive-paper border-hive-line hover:border-hive-honey'
                }`}
                aria-pressed={on}
              >
                <p className="text-xl">{p.emoji}</p>
                <p className="text-[11px] font-nunito font-extrabold mt-0.5">{p.label}</p>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Submit */}
      <div className="mt-6 space-y-2">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-[12px] p-3 rounded-hive">
            {error}
          </div>
        )}
        {doneFlash && (
          <div className="bg-green-50 border border-green-300 text-green-800 text-sm font-nunito font-extrabold p-3 rounded-hive text-center">
            {doneFlash}
          </div>
        )}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="w-full text-center bg-hive-honey hover:bg-hive-honey-dk text-hive-ink font-nunito font-black text-base py-4 rounded-hive border-2 border-hive-honey-dk disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'Assigning…' : '＋ Assign this work'}
        </button>
        <p className="text-[10px] text-hive-muted text-center">
          Helper sees the task on their home for each day you picked + gets a notification (in-app bell + web push if they&apos;ve enabled it).
        </p>
        <div className="text-center pt-2">
          <Link
            href="/pantry/workplan"
            className="text-[12px] font-nunito font-bold text-hive-honey-dk underline"
          >
            ← Cancel · back to Workplan
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────
// Small card with a numbered eyebrow. Keeps the form's visual rhythm
// uniform across the 4 steps.
function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 bg-hive-paper border border-hive-line rounded-hive-lg p-4">
      <div className="mb-3">
        <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">
          {title}
        </p>
        <p className="text-[12px] text-hive-muted mt-0.5">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}
