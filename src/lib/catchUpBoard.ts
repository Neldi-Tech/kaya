'use client';

// ⏰ The Catch-Up Board — compute engine (approved design 2026-08-10).
//
// Surfaces what each kid keeps skipping across four lanes, computed
// ENTIRELY from data that already exists (zero new checklists, zero
// rules deploys):
//
//   🧹 Chores       kid workplan items due-but-not-done (schedule-aware:
//                   daysOfWeek + per-item/global pauses + excused days
//                   never count as skips)
//   🪞 Reflections  Sparks Daily Reflection days missed on the kid's
//                   active days (default Mon–Fri)
//   🗺️ Quests      scheduled quest steps whose day passed without done
//   💎 Treasures    missed Treasure reviews — via the SEAM below (the
//                   Treasure build runs in parallel; this lane stays
//                   silently empty until its data lands)
//
// Windows: "this week" = the 7 days ending YESTERDAY (today is still in
// play — an unticked chore today is not yet a skip). Trend compares the
// 7 days before that. On-Track % = done ÷ due across every lane that has
// data; lanes with nothing due simply don't dilute the score.
//
// Growth-voice rule: this module reports "catch-ups", never failures —
// and it only READS. Nudges live with the UI, fired by a parent's tap.

import {
  listKidWorkplanItems, listKidCompletions, kidItemsScheduledOn, isPausedOn,
  type KidWorkplanItem, type KidWorkplanCompletion,
} from './kidWorkplan';
import { listReflections } from './sparks/reflection';
import { getSparksProfile } from './sparks/firestore';
import { questsApi, type Quest, type QuestDetail } from './sparks/quests';
import { DEFAULT_REFLECTION_REMINDERS } from './sparks/schema';
import type { DayOfWeek } from './firestore';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';

export type CatchUpLane = 'chores' | 'reflections' | 'quests' | 'treasures';

export interface CatchUpItem {
  lane: CatchUpLane;
  /** Stable key for pins/dedupe, e.g. `chore:<itemId>` / `reflection:missed`. */
  key: string;
  icon: string;
  label: string;
  /** One-line honest why — "Due 6× this week · done 3". */
  detail: string;
  /** Consecutive-day skip streak (chores) — 2+ means it's sliding. */
  streak?: number;
  /** Where tapping should land the kid — the REAL task, never a copy. */
  href: string;
}

export interface KidCatchUps {
  childId: string;
  name: string;
  emoji: string;
  /** done ÷ due this week (0–100); null when nothing was due at all. */
  onTrackPct: number | null;
  /** Same score for the prior week — the trend arrow. Null = no data. */
  prevPct: number | null;
  due: number;
  done: number;
  /** Catch-ups CLEARED this week — skipped first, then done after
   *  (chores re-ticked, reflections written after a miss, quest steps
   *  finished late). The celebration number. */
  cleared: number;
  /** R2-3 · 🧹 helpers-style chores accomplishment for the period —
   *  done ÷ due of the chores lane alone; null when none were due. */
  choresPct: number | null;
  /** Open catch-ups, worst first. UI caps what it shows. */
  items: CatchUpItem[];
}

// ── Date helpers (LOCAL days — never UTC, per the house rule) ─────────

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBack(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

const DOW_KEYS: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** R2-3: the standard period — 7 (default) / 14 / 30 days, always
 *  ending yesterday; the prior window (same length) drives the trend. */
export type CatchUpPeriod = 7 | 14 | 30;

function windows(days: CatchUpPeriod = 7): { thisWeek: Date[]; prevWeek: Date[] } {
  const thisWeek: Date[] = [];
  const prevWeek: Date[] = [];
  for (let i = days; i >= 1; i--) thisWeek.push(daysBack(i));
  for (let i = days * 2; i >= days + 1; i--) prevWeek.push(daysBack(i));
  return { thisWeek, prevWeek };
}

interface LaneTotals { due: number; done: number; cleared: number }

// ── 🧹 Chores ─────────────────────────────────────────────────────────

function choreLane(
  items: KidWorkplanItem[],
  completions: Map<string, KidWorkplanCompletion>,
  days: Date[],
): { totals: LaneTotals; open: CatchUpItem[] } {
  const totals: LaneTotals = { due: 0, done: 0, cleared: 0 };
  // Per item: ordered scheduled-day outcomes inside the window.
  const perItem = new Map<string, { item: KidWorkplanItem; outcomes: boolean[] }>();

  for (const day of days) {
    const key = dayKey(day);
    const completion = completions.get(key) || null;
    if (completion?.excused) continue;             // sick day — never a skip
    const scheduled = kidItemsScheduledOn(items, day)
      .filter((it) => !isPausedOn(it.pause, key)); // belt-and-braces
    const doneSet = new Set(completion?.completedItemIds || []);
    for (const it of scheduled) {
      totals.due += 1;
      const done = doneSet.has(it.id);
      if (done) totals.done += 1;
      const row = perItem.get(it.id) || { item: it, outcomes: [] };
      row.outcomes.push(done);
      perItem.set(it.id, row);
    }
  }

  const open: CatchUpItem[] = [];
  for (const { item, outcomes } of perItem.values()) {
    const skips = outcomes.filter((o) => !o).length;
    if (skips === 0) continue;
    // Cleared = a done AFTER at least one skip (they caught up).
    const firstSkip = outcomes.indexOf(false);
    if (outcomes.slice(firstSkip + 1).some(Boolean)) totals.cleared += 1;
    // Trailing streak — consecutive scheduled days skipped, ending latest.
    let streak = 0;
    for (let i = outcomes.length - 1; i >= 0 && !outcomes[i]; i--) streak += 1;
    if (streak === 0) continue;                    // ended the week done — not open
    open.push({
      lane: 'chores',
      key: `chore:${item.id}`,
      icon: item.icon || '🧹',
      label: item.label,
      detail: `Due ${outcomes.length}× this period · done ${outcomes.filter(Boolean).length}${streak >= 2 ? ` · skipped ${streak} in a row` : ''}`,
      streak,
      href: '/workplan',
    });
  }
  open.sort((a, b) => (b.streak || 0) - (a.streak || 0));
  return { totals, open };
}

// ── 🪞 Reflections ────────────────────────────────────────────────────

async function reflectionLane(
  familyId: string,
  childId: string,
  days: Date[],
  prevDays: Date[],
): Promise<{ totals: LaneTotals; prev: LaneTotals; open: CatchUpItem[] }> {
  const empty = { due: 0, done: 0, cleared: 0 };
  try {
    const profile = await getSparksProfile(familyId, childId).catch(() => null);
    const p = profile as { reflection_reminders?: { active_days?: DayOfWeek[] } } | null;
    const activeDays = p?.reflection_reminders?.active_days
      ?? DEFAULT_REFLECTION_REMINDERS.active_days;
    const entries = await listReflections(familyId, childId, 70).catch(() => []);
    const have = new Set(entries.map((e) => (e as { date?: string }).date).filter(Boolean));

    const count = (win: Date[]): LaneTotals => {
      const t: LaneTotals = { due: 0, done: 0, cleared: 0 };
      let missedBefore = false;
      for (const day of win) {
        if (!activeDays.includes(DOW_KEYS[day.getDay()])) continue;
        t.due += 1;
        if (have.has(dayKey(day))) {
          t.done += 1;
          if (missedBefore) { t.cleared += 1; missedBefore = false; }
        } else {
          missedBefore = true;
        }
      }
      return t;
    };

    const totals = count(days);
    const prev = count(prevDays);
    const missed = totals.due - totals.done;
    const open: CatchUpItem[] = missed > 0 ? [{
      lane: 'reflections',
      key: 'reflection:missed',
      icon: '🪞',
      label: `Reflections — ${missed} of ${totals.due} days missed`,
      detail: 'Handwrite it, scan it — Kaya reads and cheers.',
      href: '/sparks',
    }] : [];
    return { totals, prev, open };
  } catch {
    return { totals: empty, prev: empty, open: [] };
  }
}

// ── 🗺️ Quests ────────────────────────────────────────────────────────

async function questLane(
  familyId: string,
  childId: string,
  days: Date[],
): Promise<{ totals: LaneTotals; open: CatchUpItem[] }> {
  const totals: LaneTotals = { due: 0, done: 0, cleared: 0 };
  const open: CatchUpItem[] = [];
  try {
    const { quests } = await questsApi<{ quests: Quest[] }>('list', { kidId: childId });
    const active = (quests || []).filter((q) =>
      (q as { status?: string }).status === 'active'
      && !(q as { pausedUntil?: string }).pausedUntil);
    const winKeys = new Set(days.map(dayKey));
    const todayKey = dayKey(new Date());
    for (const q of active.slice(0, 4)) {          // bounded fan-out
      const detail = await questsApi<QuestDetail>('get', { questId: q.id })
        .catch(() => null);
      if (!detail) continue;
      let overdue = 0;
      for (const s of detail.steps || []) {
        if (!s.date || s.date >= todayKey) continue;      // unscheduled / future
        if (winKeys.has(s.date)) {
          totals.due += 1;
          if (s.done) {
            totals.done += 1;
            if (s.doneLate) totals.cleared += 1;          // caught up late 👏
          }
        }
        if (!s.done) overdue += 1;
      }
      if (overdue > 0) {
        open.push({
          lane: 'quests',
          key: `quest:${q.id}`,
          icon: (q as { emoji?: string }).emoji || '🗺️',
          label: `Quest “${q.title}” — ${overdue} step${overdue === 1 ? '' : 's'} waiting`,
          detail: 'A quick step today keeps the quest alive.',
          href: `/sparks/quests/${q.id}`,
        });
      }
    }
  } catch { /* quests unreachable — lane stays empty, score unaffected */ }
  return { totals, open };
}

// ── 💎 Treasures — the SEAM ───────────────────────────────────────────
//
// CONTRACT for the parallel Treasure build (or its follow-up): write one
// doc per scheduled review at
//   families/{familyId}/treasureReviews/{docId}
//   { kidId: string, dueDate: 'YYYY-MM-DD', title?: string,
//     doneAt?: number }        // absent doneAt = not reviewed yet
// This lane reads that shape DEFENSIVELY: collection missing, rules
// denying, or shape drift → the lane is silently empty and the score is
// computed without it. Nothing here ever throws.

async function treasureLane(
  familyId: string,
  childId: string,
  days: Date[],
): Promise<{ totals: LaneTotals; open: CatchUpItem[] }> {
  const totals: LaneTotals = { due: 0, done: 0, cleared: 0 };
  const open: CatchUpItem[] = [];
  try {
    const snap = await getDocs(query(
      collection(db, 'families', familyId, 'treasureReviews'),
      where('kidId', '==', childId),
    ));
    const winKeys = new Set(days.map(dayKey));
    const todayKey = dayKey(new Date());
    let missed = 0;
    for (const d of snap.docs) {
      const r = d.data() as { kidId?: string; dueDate?: string; title?: string; doneAt?: number };
      if (!r.dueDate || r.dueDate >= todayKey) continue;
      if (winKeys.has(r.dueDate)) {
        totals.due += 1;
        if (r.doneAt) {
          totals.done += 1;
          totals.cleared += 1;   // any done review after its day = caught up
        }
      }
      if (!r.doneAt) missed += 1;
    }
    if (missed > 0) {
      open.push({
        lane: 'treasures',
        key: 'treasure:missed',
        icon: '💎',
        label: `Treasures — ${missed} review${missed === 1 ? '' : 's'} missing`,
        detail: 'Count it, check it, keep the treasure map true.',
        href: '/wealth',
      });
    }
  } catch { /* seam not live yet — lane silently empty */ }
  return { totals, open };
}

// ── The board ─────────────────────────────────────────────────────────

export interface CatchUpKidInput {
  id: string;
  name: string;
  avatarEmoji?: string;
}

export async function computeKidCatchUps(
  familyId: string,
  kid: CatchUpKidInput,
  period: CatchUpPeriod = 7,
): Promise<KidCatchUps> {
  const { thisWeek, prevWeek } = windows(period);

  const [items, completionRows] = await Promise.all([
    listKidWorkplanItems(familyId, kid.id).catch(() => [] as KidWorkplanItem[]),
    listKidCompletions(familyId, kid.id).catch(() => [] as KidWorkplanCompletion[]),
  ]);
  const completions = new Map(completionRows.map((c) => [c.date, c]));

  const chores = choreLane(items, completions, thisWeek);
  const choresPrev = choreLane(items, completions, prevWeek);
  const [reflections, quests, treasures] = await Promise.all([
    reflectionLane(familyId, kid.id, thisWeek, prevWeek),
    questLane(familyId, kid.id, thisWeek),
    treasureLane(familyId, kid.id, thisWeek),
  ]);

  const due = chores.totals.due + reflections.totals.due + quests.totals.due + treasures.totals.due;
  const done = chores.totals.done + reflections.totals.done + quests.totals.done + treasures.totals.done;
  const cleared = chores.totals.cleared + reflections.totals.cleared + quests.totals.cleared + treasures.totals.cleared;
  // Trend uses the lanes we can honestly reconstruct for last week
  // (chores + reflections — quest/treasure history isn't re-derivable).
  const prevDue = choresPrev.totals.due + reflections.prev.due;
  const prevDone = choresPrev.totals.done + reflections.prev.done;

  // R2-3 fix ("Reflections not reading"): the open list is LANE-DIVERSE —
  // round-robin one item per lane so a pile of chores can never crowd the
  // other lanes out of a capped view. Within a lane, worst-first order kept.
  const lanes = [chores.open, reflections.open, quests.open, treasures.open];
  const interleaved: CatchUpItem[] = [];
  for (let i = 0; lanes.some((l) => i < l.length); i++) {
    for (const l of lanes) if (i < l.length) interleaved.push(l[i]);
  }

  return {
    childId: kid.id,
    name: kid.name,
    emoji: kid.avatarEmoji || '🧒',
    onTrackPct: due > 0 ? Math.round((done / due) * 100) : null,
    prevPct: prevDue > 0 ? Math.round((prevDone / prevDue) * 100) : null,
    due,
    done,
    cleared,
    choresPct: chores.totals.due > 0 ? Math.round((chores.totals.done / chores.totals.due) * 100) : null,
    items: interleaved,
  };
}

export async function computeFamilyCatchUps(
  familyId: string,
  kids: CatchUpKidInput[],
  period: CatchUpPeriod = 7,
): Promise<KidCatchUps[]> {
  return Promise.all(kids.map((k) => computeKidCatchUps(familyId, k, period)));
}

/** Shared UI helper — the period pills every surface renders. */
export const CATCHUP_PERIODS: Array<{ days: CatchUpPeriod; label: string }> = [
  { days: 7, label: 'Last 7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
];

/** 🟢 ≥80 · 🟡 50–79 · 🔴 <50 — shared by every surface. */
export function scoreMeta(pct: number | null): { emoji: string; cls: 'green' | 'amber' | 'red' | 'none'; label: string } {
  if (pct == null) return { emoji: '⚪', cls: 'none', label: 'nothing due' };
  if (pct >= 80) return { emoji: '🟢', cls: 'green', label: `${pct}% on-track` };
  if (pct >= 50) return { emoji: '🟡', cls: 'amber', label: `${pct}% on-track` };
  return { emoji: '🔴', cls: 'red', label: `${pct}% on-track` };
}

export function trendLabel(k: KidCatchUps): string | null {
  if (k.onTrackPct == null || k.prevPct == null) return null;
  const d = k.onTrackPct - k.prevPct;
  if (Math.abs(d) < 3) return '— steady';
  return d > 0 ? `▲ up from ${k.prevPct}%` : `▼ down from ${k.prevPct}%`;
}
