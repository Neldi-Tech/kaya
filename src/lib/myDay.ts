// "My Day" aggregator — reads from the engines Kaya already has and
// presents ONE prioritised list per person. It never duplicates task
// state (the proposal's rule): each module keeps its own data; My Day is
// a read/aggregation layer.
//
// Phase 3 ships the KID hook. Sources (kid):
//   • Kids' Workplan items + completion  → Do (tap to tick, server-awarded)
//   • Pulse reading tasks (today)        → Do (tap → Quick Entry)
//   • Hive/Business requests (pending)   → Heads-up (status)
//   • Notifications (unread)             → Heads-up (reminders; pulse/
//     business nudges already covered by their Do rows are filtered out)
//
// Items group into Do / Heads-up / Done; Do is ordered morning → anytime
// → evening, timed first. Parent + helper hooks land in Phase 4.

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  type KidWorkplanItem, type KidWorkplanCompletion,
  subscribeKidWorkplanItems, subscribeKidCompletion,
  kidItemsScheduledOn, completeKidTask, categoryMeta, todayDateString,
} from '@/lib/kidWorkplan';
import {
  subscribeToOwnerTasks, subscribeToTrackables,
  type PulseTask, type Trackable,
} from '@/lib/pulse';
import { subscribeToKidRequests } from '@/lib/hive';
import type { ApprovalRequest } from '@/lib/hive';
import { getNotifications } from '@/lib/firestore';
import type { Notification } from '@/lib/firestore';

export type MyDaySource = 'workplan' | 'pulse' | 'request' | 'reminder';
export type MyDayGroup = 'do' | 'headsup' | 'done';
export type MyDayPeriod = 'morning' | 'anytime' | 'evening';

export interface MyDayItem {
  id: string;            // unique, source-prefixed
  source: MyDaySource;
  group: MyDayGroup;
  period: MyDayPeriod;   // ordering within Do/Done
  time?: string;         // "HH:MM" for sorting timed rows first
  icon: string;
  label: string;
  sublabel: string;      // source tag / status line
  accent?: string;       // category / brand color dot
  points?: number;
  done?: boolean;
  badge?: string;        // 'Log' / 'pending' / '+5' / '✓'
  href?: string;         // tap target for link rows
  /** Workplan tick — present only on workplan Do rows. */
  tickItemId?: string;
}

const PULSE_DONE: ReadonlyArray<PulseTask['status']> = ['logged', 'review', 'closed'];
const isPulseDone = (t: PulseTask) => PULSE_DONE.includes(t.status);

function periodFromTime(time?: string): MyDayPeriod {
  if (!time) return 'anytime';
  const h = parseInt(time.slice(0, 2), 10);
  if (Number.isNaN(h)) return 'anytime';
  if (h < 12) return 'morning';
  if (h >= 17) return 'evening';
  return 'anytime';
}

const PERIOD_ORDER: Record<MyDayPeriod, number> = { morning: 0, anytime: 1, evening: 2 };

function reminderIcon(type: Notification['type']): string {
  if (type.startsWith('moment')) return '📸';
  if (type.startsWith('purchase')) return '🧾';
  if (type === 'business-stocktake-reminder') return '🛒';
  if (type === 'reward') return '🎁';
  if (type === 'badge') return '🏅';
  if (type === 'meeting') return '👨‍👩‍👧‍👦';
  if (type === 'streak') return '🔥';
  return '🔔';
}

function requestIcon(type: ApprovalRequest['type']): string {
  const t = String(type);
  if (t.includes('cash_out')) return '💸';
  if (t.includes('honey')) return '🍯';
  if (t.includes('invest')) return '📈';
  if (t.includes('spend')) return '🛍️';
  return '🤝';
}

export interface UseKidMyDay {
  loading: boolean;
  items: MyDayItem[];
  doItems: MyDayItem[];
  headsUp: MyDayItem[];
  doneItems: MyDayItem[];
  total: number;
  doneCount: number;
  pct: number;
  /** Tick a workplan row (server-awarded). Realtime subscription
   *  reflects the new state. */
  tickWorkplan: (itemId: string, on: boolean) => Promise<void>;
}

export function useKidMyDay(familyId: string, childId: string, userUid: string): UseKidMyDay {
  const dateStr = todayDateString();

  const [items, setItems] = useState<KidWorkplanItem[] | null>(null);
  const [completion, setCompletion] = useState<KidWorkplanCompletion | null>(null);
  const [pulseTasks, setPulseTasks] = useState<PulseTask[] | null>(null);
  const [trackById, setTrackById] = useState<Record<string, Trackable>>({});
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [notifs, setNotifs] = useState<Notification[]>([]);

  useEffect(() => {
    const u1 = subscribeKidWorkplanItems(familyId, childId, setItems);
    const u2 = subscribeKidCompletion(familyId, childId, dateStr, setCompletion);
    const u3 = subscribeToOwnerTasks(familyId, childId, dateStr, setPulseTasks);
    const u4 = subscribeToTrackables(familyId, (list) =>
      setTrackById(Object.fromEntries(list.map((t) => [t.id, t]))));
    const u5 = subscribeToKidRequests(familyId, childId, setRequests);
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [familyId, childId, dateStr]);

  // Notifications: one-shot (existing indexed query). userUid for a kid
  // with their own login; falls back to childId for code-only kids.
  useEffect(() => {
    let cancelled = false;
    const uid = userUid || childId;
    getNotifications(familyId, uid)
      .then((n) => { if (!cancelled) setNotifs(n); })
      .catch(() => { if (!cancelled) setNotifs([]); });
    return () => { cancelled = true; };
  }, [familyId, childId, userUid]);

  const built = useMemo<MyDayItem[]>(() => {
    const out: MyDayItem[] = [];

    // Workplan
    const scheduled = items ? kidItemsScheduledOn(items) : [];
    const doneSet = new Set(completion?.completedItemIds ?? []);
    for (const it of scheduled) {
      const cat = categoryMeta(it.category);
      const done = doneSet.has(it.id);
      out.push({
        id: `wp_${it.id}`,
        source: 'workplan',
        group: done ? 'done' : 'do',
        period: periodFromTime(it.timeLocal),
        time: it.timeLocal,
        icon: it.icon || cat.icon,
        label: it.label,
        sublabel: cat.label,
        accent: cat.color,
        points: it.pointsValue,
        done,
        badge: it.pointsValue ? (done ? `+${it.pointsValue} ✓` : `+${it.pointsValue}`) : (done ? '✓' : undefined),
        tickItemId: it.id,
      });
    }

    // Pulse readings
    for (const t of pulseTasks ?? []) {
      const tr = trackById[t.trackableId];
      const done = isPulseDone(t);
      out.push({
        id: `pl_${t.id}`,
        source: 'pulse',
        group: done ? 'done' : 'do',
        period: 'anytime',
        icon: tr?.emoji ?? '📊',
        label: `${tr?.name ?? 'Meter'} reading`,
        sublabel: 'Kaya Pulse',
        accent: '#0F1F44',
        done,
        badge: done ? '✓' : (t.status === 'missed' ? 'missed' : 'Log'),
        href: done ? undefined : `/pulse/log/${t.id}`,
      });
    }

    // Pending requests → Heads-up
    for (const r of requests) {
      if (r.status !== 'pending') continue;
      const amt = r.amountCents != null ? ` ${Math.round(r.amountCents / 100).toLocaleString()}` : '';
      out.push({
        id: `rq_${r.id}`,
        source: 'request',
        group: 'headsup',
        period: 'anytime',
        icon: requestIcon(r.type),
        label: r.description?.trim() || `${String(r.type).replace(/_/g, ' ')}${amt}`,
        sublabel: 'Waiting for a grown-up ✓',
        badge: 'pending',
        href: '/hive',
      });
    }

    // Reminders → Heads-up. Skip pulse-* (covered by Do rows) + read.
    for (const n of notifs) {
      if (n.read) continue;
      if (n.type === 'pulse-reading-due' || n.type === 'pulse-missed') continue;
      out.push({
        id: `nt_${n.id}`,
        source: 'reminder',
        group: 'headsup',
        period: 'anytime',
        icon: reminderIcon(n.type),
        label: n.title,
        sublabel: n.message,
        badge: 'reminder',
        href: n.link,
      });
    }

    return out;
  }, [items, completion, pulseTasks, trackById, requests, notifs]);

  const sortDo = (a: MyDayItem, b: MyDayItem) => {
    if (PERIOD_ORDER[a.period] !== PERIOD_ORDER[b.period]) return PERIOD_ORDER[a.period] - PERIOD_ORDER[b.period];
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time && !b.time) return -1;
    if (!a.time && b.time) return 1;
    return 0;
  };

  const doItems = built.filter((i) => i.group === 'do').sort(sortDo);
  const headsUp = built.filter((i) => i.group === 'headsup');
  const doneItems = built.filter((i) => i.group === 'done').sort(sortDo);

  // Progress = the actionable "Do/Done" tasks (workplan + pulse), not reminders.
  const taskItems = built.filter((i) => i.source === 'workplan' || i.source === 'pulse');
  const total = taskItems.length;
  const doneCount = taskItems.filter((i) => i.done).length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const loading = items === null || pulseTasks === null;

  const tickWorkplan = async (itemId: string, on: boolean) => {
    await completeKidTask({ familyId, childId, itemId, date: dateStr, on });
  };

  return { loading, items: built, doItems, headsUp, doneItems, total, doneCount, pct, tickWorkplan };
}
