'use client';

// Shared hook for surfacing reminders in My Day + the Home chip (Kaya
// Reminders R1, PR B). Fetches the caller's visible reminders via the
// Admin-SDK list route, merges the auto-imported family birthdays/
// anniversary (read-only mirrors, computed from the family profiles), and
// returns today's occurrences + the upcoming horizon.
//
// Day-of birthdays are dropped from `todays` because the Birthdays engine
// (B1) already owns the day-of celebration (Home hero + My Day wish card);
// they still appear in `upcoming` as a heads-up.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  fetchReminders, autoImportedEvents, occurrencesInRange, isAutoImported,
  todayKey, type ReminderEvent, type ReminderOccurrence, type DoseEntry,
} from '@/lib/reminders';

export interface UseRemindersResult {
  loading: boolean;
  todays: ReminderOccurrence[];
  upcoming: ReminderOccurrence[];
  /** today's + upcoming count (for the Home chip badge). */
  count: number;
  /** 💊 v5 — care events active today (visibility-filtered) for dose cards. */
  careToday: ReminderEvent[];
  /** 💊 v5 — fold a tick response into local state (no refetch). */
  applyDose: (eventId: string, entry: DoseEntry) => void;
}

export function useReminders(horizonDays = 30): UseRemindersResult {
  // (v5) Care events are split out of the generic rows — the 💊 dose cards
  // own them; see `careToday` + `applyDose` below.
  const { user, profile } = useAuth();
  const { children, family } = useFamily();
  const [events, setEvents] = useState<ReminderEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!user || !profile?.familyId) { setLoading(false); return; }
    user.getIdToken()
      .then((t) => fetchReminders(t))
      .then((evs) => { if (alive) { setEvents(evs); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user, profile?.familyId]);

  const auto = useMemo(() => {
    if (!profile?.familyId) return [] as ReminderEvent[];
    const people = (children || []).map((c) => ({ id: c.id, name: c.name, birthday: c.birthday, kind: 'kid' as const }));
    return autoImportedEvents(profile.familyId, people, family || undefined);
  }, [children, family, profile?.familyId]);

  const all = useMemo(() => [...events, ...auto], [events, auto]);

  const occ = useMemo(
    () => occurrencesInRange(all, profile?.uid || '', profile?.role, { horizonDays, viewerChildId: profile?.childId }),
    [all, profile?.uid, profile?.role, profile?.childId, horizonDays],
  );

  const today = todayKey();
  const todays = occ.filter((o) => o.dateKey === today
    && !o.event.care
    && !(isAutoImported(o.event) && o.event.type === 'birthday'));
  const upcoming = occ.filter((o) => o.dateKey > today && !o.event.care);
  const careToday = useMemo(
    () => occ.filter((o) => o.dateKey === today && !!o.event.care).map((o) => o.event),
    [occ, today],
  );

  const applyDose = useCallback((eventId: string, entry: DoseEntry) => {
    setEvents((evs) => evs.map((ev) => {
      if (ev.id !== eventId) return ev;
      const log = (ev.doseLog || []).filter((d) => d.key !== entry.key);
      return { ...ev, doseLog: [...log, entry] };
    }));
  }, []);

  return { loading, todays, upcoming, count: todays.length + upcoming.length, careToday, applyDose };
}
