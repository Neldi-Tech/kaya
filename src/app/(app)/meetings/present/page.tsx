'use client';

// /meetings/present — Full-screen presenter mode for the weekly family
// meeting. Designed to be cast to a TV or propped up on the dinner
// table. Dark backdrop, large typography, one step at a time, prev/next
// nav at the bottom.
//
// Five-step agenda (2026-05-16 redesign):
//   1. Gratitude Circle    — what each person is thankful for
//   2. Celebrate the Wins  — celebration + "Open Points Review" link
//                            to the existing /meetings/review presenter
//   3. Appreciations       — per-kid appreciation note (problem-solving
//                            still welcome as a sub-bullet, but the
//                            leading energy is positive)
//   4. Goals Review        — last week's goal per kid ✓/✗ + this
//                            week's commitment per kid (AI-assist coming)
//   5. Closing Reflection  — chooser: Inspiring Story / Songs /
//                            Family Prayer. Prayer ends with a
//                            flowers-drop CSS animation.
//
// Persists to Firestore via the existing Meeting collection — new
// fields (appreciations, lastWeekGoalsDone, reflection) are optional
// on the schema, so older meetings continue to load unchanged.

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toDisplayDate } from '@/lib/dates';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  createMeeting, updateMeeting, getMeetings, getFamilyMembers, createNotification,
  updateFamily,
  Meeting, ReflectionMode, todayString,
} from '@/lib/firestore';
import {
  subscribeMeetingSubmissions, clearMeetingSubmissions,
  appreciationTagsForLine, appreciationTagLabelForLine, isCurrentCycle, meetingCycleKey,
  type MeetingSubmission,
} from '@/lib/meetingSubmissions';
import { sendMeetingRecapEmail } from '@/lib/meetingRecap';
import { archiveMeetingSubmissions } from '@/lib/meetingSubmissionHistory';
import { resolveSongEmbed } from '@/lib/songEmbed';
import { upsertSong, rateSong, getTodaysSong, getSongLibrary, approveTodaysSong, markSongRevealed, type SongLibraryEntry } from '@/lib/meetingSongLibrary';
import {
  listFamilyCapsules, dueCapsules, sealCapsule,
  reflectOnCapsule,
  computeOpenOn,
  type FamilyCapsule,
} from '@/lib/familyCapsules';

// ── Agenda definition ──────────────────────────────────────────────
// Canonical step catalog — the presenter renders the subset that the
// parent enabled in /settings/meetings (via `family.meetingSetup
// .agendaSteps`). When no setup exists, every step is on.
//
// The `open` step (Sunday-Meeting v2 · 2026-06-07) is the always-on
// opening reveal — confirms today is the family's meeting day against
// `meetingSetup.schedule` and warms the room up before Attendance. It
// is not filterable from settings (it carries the date/time check) so
// the filter logic below special-cases it.
const STEPS = [
  { id: 'open',          title: 'Meeting Opens',      emoji: '✨', sub: 'A moment to mark that we\'re here — and that today is our day.' },
  { id: 'attendance',    title: 'Attendance',         emoji: '👋', sub: 'Who is here tonight, and is anyone presenting?' },
  { id: 'openingword',   title: 'Opening Word',       emoji: '🙏', sub: 'The leader opens the night — a prayer or a short word, from the heart.' },
  { id: 'gratitude',     title: 'Gratitude Circle',   emoji: '🙏', sub: 'What is each of us thankful for today?' },
  { id: 'celebrate',     title: 'Celebrate the Wins', emoji: '🎉', sub: 'Look back at the week — points, badges, moments worth a cheer.' },
  { id: 'appreciations', title: 'Appreciations',      emoji: '💛', sub: 'Something kind, helpful, or brave you noticed this week.' },
  { id: 'goals',         title: 'Goals Review',       emoji: '🎯', sub: 'Mark last week\'s goals done, revisit older outstanding ones, then commit for next week.' },
  { id: 'reflection',    title: 'Closing Reflection', emoji: '✨', sub: 'Pick one — or all — of story, song, or family prayer.' },
] as const;

// Structural type — looser than `typeof STEPS[number]` (which keeps
// each entry's literal union shape) so we can build new step objects
// from the catalog with a parent-customised title without a cast.
type StepDef = { id: string; title: string; emoji: string; sub: string };

// A family member expected to prep (Sunday-Meeting v2 PR C). `id` is the
// childId for kids and the uid for parents — matching how submissions key
// (kids carry childId, parents key by uid).
type PrepMember = { id: string; name: string; emoji: string; kind: 'kid' | 'parent' };
type StepId = typeof STEPS[number]['id'];

// How many of the most-recent meetings to surface in the Goals Review
// step. Older goals beyond this fall off the agenda — they're still
// in the meeting history, just not nagging on every weekly review.
const GOALS_REVIEW_WEEKS_BACK = 4;

export default function MeetingPresenterPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children } = useFamily();

  // ── Stepper state ────────────────────────────────────────────────
  // Active steps respect the parent's `meetingSetup.agendaSteps` if set,
  // otherwise default to the full STEPS catalog. We preserve the order
  // the parent saved (which is the canonical order today but lets a
  // future drag-to-reorder land without code changes here).
  const activeSteps: StepDef[] = useMemo(() => {
    const enabled = family?.meetingSetup?.agendaSteps;
    const labels = family?.meetingSetup?.stepLabels || {};
    // `open` (Sunday-Meeting v2) is the opening reveal — always first,
    // never filtered out by saved settings. Everything else respects
    // the parent's enabled-steps list.
    const openStep = STEPS[0];
    const rest = STEPS.slice(1);
    // 'openingword' (SM3.1 · #2) is governed by its OWN flag, not the saved
    // agendaSteps list — families who saved their step list before this
    // feature existed still get it by default (flag absent = on).
    const openingWordOn = family?.meetingSetup?.openingWordEnabled !== false;
    const enabledSet = new Set(enabled || []);
    const filteredRest = rest.filter((s) => {
      if (s.id === 'openingword') return openingWordOn;
      if (!enabled || enabled.length === 0) return true;
      return enabledSet.has(s.id);
    });
    const base = [openStep, ...filteredRest];
    // Apply per-step display-name overrides. `title` falls back to the
    // canonical default when the parent hasn't customised it.
    return base.map((s) => {
      const custom = (labels[s.id] || '').trim();
      return custom ? { ...s, title: custom } : s;
    });
  }, [family?.meetingSetup?.agendaSteps, family?.meetingSetup?.stepLabels, family?.meetingSetup?.openingWordEnabled]);

  // Step index — persisted in sessionStorage so navigating away (e.g.
  // "Open Points Review" → /meetings/review → browser Back) returns
  // the parent to the step they left, not all the way back to step 1.
  // Cleared when the meeting is finished (handleFinish) so the next
  // weekly meeting starts fresh.
  const [stepIdx, setStepIdx] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const raw = window.sessionStorage.getItem('kaya:meeting-presenter:stepIdx');
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem('kaya:meeting-presenter:stepIdx', String(stepIdx));
  }, [stepIdx]);

  // Autopilot — when a sibling reveal screen (e.g. /meetings/review)
  // closes back into the presenter, it appends ?advance=1 to ask us
  // to move forward instead of dropping the family back to the meeting
  // hub. We bump the step once, then strip the param so a re-mount
  // (HMR / browser back) doesn't double-advance. Sunday-Meeting v2.
  const searchParams = useSearchParams();
  useEffect(() => {
    const adv = searchParams?.get('advance');
    if (adv && /^\d+$/.test(adv)) {
      const bump = Math.max(1, Math.min(parseInt(adv, 10), 10));
      setStepIdx((i) => i + bump);
      router.replace('/meetings/present');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  // Clamp stepIdx if a setup change shrinks the agenda mid-render.
  const safeStepIdx = Math.min(stepIdx, Math.max(0, activeSteps.length - 1));
  const step = activeSteps[safeStepIdx];
  const isLastStep = safeStepIdx === activeSteps.length - 1;

  // Closing reflection modes enabled by the parent (defaults to all).
  const enabledClosingModes: ReflectionMode[] = useMemo(() => {
    const set = family?.meetingSetup?.closingModesEnabled;
    if (!set || set.length === 0) return ['story', 'songs', 'prayer'];
    return set;
  }, [family?.meetingSetup?.closingModesEnabled]);

  // Prayer library + a "preloaded" random pick — chosen once per
  // presenter session so opening Prayer doesn't reshuffle the textarea
  // every render. Parent can still edit or replace it on the night.
  const prayerLibrary = family?.meetingSetup?.prayers || [];
  const preloadedPrayer = useMemo(() => {
    if (prayerLibrary.length === 0) return '';
    const pick = prayerLibrary[Math.floor(Math.random() * prayerLibrary.length)];
    return pick.body || '';
    // Intentionally not depending on prayerLibrary identity — we want
    // one pick per mount, not per render. The empty-deps form is the
    // standard "compute once" pattern for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Captured per step ────────────────────────────────────────────
  // Attendance — initialized to "everyone present" when the household
  // list loads (parents + kids default in; tap to toggle). Guests are
  // captured separately as free-form rows with a relationship label.
  const [attendees, setAttendees] = useState<Set<string>>(new Set());
  const [parentAttendees, setParentAttendees] = useState<Set<string>>(new Set());
  const [guestAttendees, setGuestAttendees] = useState<Array<{ id: string; name: string; relationship?: string }>>([]);
  const [attendanceInit, setAttendanceInit] = useState(false);
  const [householdParents, setHouseholdParents] = useState<Array<{ uid: string; name: string; avatarEmoji?: string }>>([]);
  const [presentBy, setPresentBy] = useState('');
  const [presentTopic, setPresentTopic] = useState('');

  // 🙏 Opening Word (SM3.1 · #2) — how the leader opens the night. From the
  // heart by default; `done` gates Next when the family set it as required.
  const [openingWordMode, setOpeningWordMode] = useState<'prayer' | 'wisdom' | 'verse' | 'own'>('prayer');
  const [openingWordNote, setOpeningWordNote] = useState('');
  const [openingWordDone, setOpeningWordDone] = useState(false);
  const openingWordRequired = family?.meetingSetup?.openingWordRequired === true;
  const openingWordShowLibrary = family?.meetingSetup?.openingWordShowLibrary === true;

  const [gratitude, setGratitude] = useState<Record<string, string>>({});
  const [appreciations, setAppreciations] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<Record<string, string>>({});           // this week
  // 🤝 Pinky-Promise (v4) — childIds who sealed their goal this meeting.
  const [pinkyPromised, setPinkyPromised] = useState<Set<string>>(new Set());

  // Multi-week Goals Review — per-meeting per-kid done toggles. Keyed
  // by meeting id → kid id → done. Persisted at finish time by patching
  // each touched meeting's `goalsDone` map (so a goal set 3 weeks ago
  // can be marked done tonight without losing context).
  const [reviewedGoalsDone, setReviewedGoalsDone] =
    useState<Record<string, Record<string, boolean>>>({});

  // Closing Reflection — execute mode. Modes that the parent enabled
  // in /settings/meetings auto-run here (no chooser). `reflectionModes`
  // is what we persist with the saved meeting — derived once from the
  // setup so the meeting record reflects what actually played.
  const [reflectionModes, setReflectionModes] = useState<ReflectionMode[]>([]);
  // Sunday-Meeting v2 (b5): when a kid pastes a song URL and the family
  // requires parent approval, this captures the uid of the parent who
  // OK'd it. Persisted on handleFinish under reflection.songLinkApprovedBy.
  const [songLinkApprovedBy, setSongLinkApprovedBy] = useState<string | null>(null);
  const [reflectionContents, setReflectionContents] =
    useState<Partial<Record<ReflectionMode, string>>>({});
  const [reflectionSeeded, setReflectionSeeded] = useState(false);
  // null = idle; non-null = show the full-screen prayer stage with the
  // text typeset large + flowers cascading on top. Captured at click
  // time so editing the textarea afterwards doesn't change the on-
  // screen prayer mid-celebration.
  const [prayerOnStage, setPrayerOnStage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // ── Recent meetings (for the Goals Review step) ─────────────────
  // Last N meetings (DESC by date). Each is rendered in Goals Review
  // showing its goals + current done state (from each meeting's own
  // `goalsDone` map, falling back to legacy `lastWeekGoalsDone` of the
  // NEXT meeting for goals set before the v2 schema).
  const [recentMeetings, setRecentMeetings] = useState<Meeting[]>([]);
  // Longer meeting history (~a year) — feeds guest suggestions only, so the
  // goals-review window above stays exactly as-is. (SM3.1 · #1)
  const [meetingHistory, setMeetingHistory] = useState<Meeting[]>([]);
  // Household helpers — standing guest suggestions (name-only is enough).
  const [householdHelpers, setHouseholdHelpers] = useState<Array<{ name: string }>>([]);

  // 📅 On This Day (v4.2 surprise) — a memory from a past meeting that lands
  // on today's day-of-month (≥25 days ago). Prefers a goal that was later
  // marked DONE (proof the ritual works), then a gratitude, then an
  // appreciation. Pure client-side over the already-loaded recentMeetings.
  const onThisDay = useMemo(() => {
    if (!recentMeetings.length || !children.length) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dom = today.getDate();
    const parseLocal = (s: string) => {
      const [y, mo, d] = (s || '').split('-').map(Number);
      return (y && mo && d) ? new Date(y, mo - 1, d) : null;
    };
    const cands = recentMeetings
      .map((m) => ({ m, d: parseLocal(m.date) }))
      .filter((x): x is { m: Meeting; d: Date } => !!x.d && x.d.getDate() === dom && (today.getTime() - x.d.getTime()) >= 25 * 864e5)
      .sort((a, b) => a.d.getTime() - b.d.getTime()); // oldest = most nostalgic
    for (const { m, d } of cands) {
      let who = ''; let line = ''; let kind: 'goal' | 'grateful' | 'appreciate' = 'grateful'; let done = false;
      for (const c of children) {
        const g = (m.goals?.[c.id] || '').trim();
        if (g && m.goalsDone?.[c.id]) { who = c.name; line = g; kind = 'goal'; done = true; break; }
      }
      if (!line) for (const c of children) {
        const gr = (m.gratitude?.[c.id] || '').trim();
        if (gr) { who = c.name; line = gr; kind = 'grateful'; break; }
      }
      if (!line) for (const c of children) {
        const ap = (m.appreciations?.[c.id] || '').trim();
        if (ap) { who = c.name; line = ap; kind = 'appreciate'; break; }
      }
      if (!line) continue;
      const months = Math.round((today.getTime() - d.getTime()) / (30 * 864e5));
      const yrs = Math.round(months / 12);
      const dateLabel = months >= 12 ? `${yrs} year${yrs > 1 ? 's' : ''} ago` : months <= 1 ? '1 month ago' : `${months} months ago`;
      return { who, line, kind, done, dateLabel };
    }
    return null;
  }, [recentMeetings, children]);

  // Guest suggestions — unique (name, relationship) pairs pulled from the
  // meeting HISTORY (up to ~a year back, SM3.1 · #1), plus the family's
  // helpers as standing suggestions even if they've never attended. One-tap
  // re-add so a parent doesn't have to retype "Bibi Asha · Grandma" every
  // week. Filters out anyone already on tonight's guest list.
  const guestSuggestions = useMemo(() => {
    const seen = new Map<string, { name: string; relationship?: string; lastSeen: string }>();
    for (const m of meetingHistory) {
      for (const g of (m.guestAttendees || [])) {
        const key = `${(g.name || '').trim().toLowerCase()}|${(g.relationship || '').toLowerCase()}`;
        if (!seen.has(key) || (seen.get(key)?.lastSeen || '') < m.date) {
          seen.set(key, { name: g.name, relationship: g.relationship, lastSeen: m.date });
        }
      }
    }
    // Standing suggestions — household helpers (nanny/tutor/…), deduped by
    // NAME against past guests so the same person never shows twice.
    const namesSeen = new Set(Array.from(seen.values()).map((s) => s.name.trim().toLowerCase()));
    for (const h of householdHelpers) {
      const nm = h.name.trim();
      if (!nm || namesSeen.has(nm.toLowerCase())) continue;
      seen.set(`${nm.toLowerCase()}|helper`, { name: nm, relationship: 'Helper', lastSeen: '0000-00-00' });
    }
    // Exclude anyone already added to tonight's list (by name).
    const tonightNames = new Set(guestAttendees.map((g) => g.name.trim().toLowerCase()));
    return Array.from(seen.values())
      .filter((s) => !tonightNames.has(s.name.trim().toLowerCase()))
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
      .slice(0, 8);
  }, [meetingHistory, householdHelpers, guestAttendees]);
  useEffect(() => {
    if (!profile?.familyId) return;
    getMeetings(profile.familyId).then((ms) => {
      setRecentMeetings(ms.slice(0, GOALS_REVIEW_WEEKS_BACK));
      setMeetingHistory(ms.slice(0, 60));   // ~a year of Sundays for guest suggestions
    });
  }, [profile?.familyId]);

  // Fetch parent profiles for the household so attendance lists adults
  // alongside kids. Falls back to just the signed-in profile if the
  // family-members query is empty (e.g. guest mode).
  // Map a roster tag id → the recipient's auth uid, so @-tagged
  // appreciations can be routed as a notification at meeting submit.
  // Parents: their uid is the roster id already. Kids: resolve via the
  // member whose childId matches (kids with no login won't have one —
  // they simply get no notification; the appreciation still shows in the
  // meeting). Sunday-Meeting v2 PR E.
  const [uidByTagId, setUidByTagId] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!profile?.familyId) return;
    let cancelled = false;
    getFamilyMembers(profile.familyId).then((members) => {
      if (cancelled) return;
      const parents = members.filter((m) => m.role === 'parent');
      const fallback = parents.length > 0
        ? parents
        : (profile.role === 'parent' ? [profile] : []);
      setHouseholdParents(
        fallback.map((p) => ({
          uid: p.uid,
          name: p.displayName || 'Parent',
          avatarEmoji: (p as { avatarEmoji?: string }).avatarEmoji,
        }))
      );
      // Helpers → standing guest suggestions on the Attendance step.
      setHouseholdHelpers(
        members.filter((m) => m.role === 'helper')
          .map((h) => ({ name: h.displayName || '' }))
          .filter((h) => h.name)
      );
      const map: Record<string, string> = {};
      for (const m of members) {
        map[m.uid] = m.uid;                               // parents (+ any) by uid
        if (m.role === 'kid' && m.childId) map[m.childId] = m.uid; // kids by childId
      }
      setUidByTagId(map);
    });
    return () => { cancelled = true; };
  }, [profile?.familyId, profile]);

  // Async pre-fill submissions — LIVE subscription (Sunday-Meeting v2
  // PR C). The presenter reads what everyone filled and updates in real
  // time, so a member filling from their own My Day / Workplan appears
  // here mid-meeting without a refresh. The meeting screen itself is for
  // reading + celebrating — see StepSubmissions for the "still to add"
  // nudge + optional in-meeting capture fallback.
  const [submissionsRaw, setSubmissions] = useState<MeetingSubmission[]>([]);
  useEffect(() => {
    if (!profile?.familyId) return;
    const unsub = subscribeMeetingSubmissions(profile.familyId, setSubmissions);
    return () => unsub();
  }, [profile?.familyId]);
  // Cycle gating: only THIS meeting cycle's prep is shown/used — last
  // week's (a passed meeting) is ignored even if it wasn't cleared.
  const meetingScheduleDow = family?.meetingSetup?.schedule?.dayOfWeek;
  const submissions = useMemo(
    () => submissionsRaw.filter((s) => isCurrentCycle(s, meetingScheduleDow)),
    [submissionsRaw, meetingScheduleDow],
  );

  // Roster of everyone expected to prep — kids + present parents. Used by
  // StepSubmissions to compute "who's still to add" for each section.
  // id = childId for kids, uid for parents (matches submission keying).
  const prepRoster = useMemo<PrepMember[]>(() => [
    ...children.map((c) => ({ id: c.id, name: c.name, emoji: c.avatarEmoji || '🧒', kind: 'kid' as const })),
    ...householdParents.map((p) => ({ id: p.uid, name: p.name, emoji: p.avatarEmoji || '👤', kind: 'parent' as const })),
  ], [children, householdParents]);

  // 🔥 Surprise 1 — "Most Prepared" crown. Whoever filled the most of
  // their 3 prep sections this cycle wears 👑 in the opener. Pure
  // celebration of the behaviour we want (filling ahead). Ties → the
  // earliest in the roster; nobody crowned if no one filled anything.
  const mostPrepared = useMemo(() => {
    let best: { name: string; emoji: string; count: number } | null = null;
    for (const m of prepRoster) {
      const s = submissions.find((x) => (m.kind === 'kid' ? x.childId === m.id : x.uid === m.id));
      const count = s ? [s.gratitudes, s.appreciations, s.goals].filter((a) => (a || []).some(Boolean)).length : 0;
      if (count > 0 && (!best || count > best.count)) best = { name: m.name, emoji: m.emoji, count };
    }
    return best;
  }, [prepRoster, submissions]);

  // Family Time Capsule — Sunday-Meeting v2 (b7). Sealed notes from
  // ~1 year ago surface as the first reveal of the meeting if today
  // falls in their ±3-day window. Sealed locally and re-fetched after
  // a seal so the closing step reflects the new entry.
  const [capsules, setCapsules] = useState<FamilyCapsule[]>([]);
  useEffect(() => {
    if (!profile?.familyId) return;
    let cancelled = false;
    listFamilyCapsules(profile.familyId).then((rows) => {
      if (!cancelled) setCapsules(rows);
    }).catch(() => { /* tolerate offline */ });
    return () => { cancelled = true; };
  }, [profile?.familyId]);
  const todayIsoLocal = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const dueCapsulesList = useMemo(
    () => dueCapsules(capsules, todayIsoLocal, 3),
    [capsules, todayIsoLocal],
  );

  // Default attendance to "everyone in the household present" once
  // the kid + parent lists arrive. Only runs once so a manual
  // deselection isn't overwritten if a list refreshes.
  useEffect(() => {
    if (attendanceInit) return;
    if (children.length === 0 && householdParents.length === 0) return;
    setAttendees(new Set(children.map((c) => c.id)));
    setParentAttendees(new Set(householdParents.map((p) => p.uid)));
    setAttendanceInit(true);
  }, [children, householdParents, attendanceInit]);

  // Seed Closing Reflection from setup the first time the family doc
  // arrives — execute mode means the meeting record auto-tracks the
  // enabled modes, and the prayer textarea preloads from the library.
  useEffect(() => {
    if (reflectionSeeded || !family) return;
    const enabled = family.meetingSetup?.closingModesEnabled;
    if (enabled && enabled.length > 0) {
      setReflectionModes(enabled);
      if (enabled.includes('prayer') && preloadedPrayer) {
        setReflectionContents((prev) => ({ ...prev, prayer: prev.prayer || preloadedPrayer }));
      }
    } else {
      // No setup yet — default to all three available (matches the
      // pre-setup default behaviour from earlier ships).
      setReflectionModes(['story', 'songs', 'prayer']);
      if (preloadedPrayer) {
        setReflectionContents((prev) => ({ ...prev, prayer: prev.prayer || preloadedPrayer }));
      }
    }

    setReflectionSeeded(true);
  }, [family, preloadedPrayer, reflectionSeeded]);

  // Seed today's closing song (v4.1) — read from the family-writable Song
  // Library (set by a parent OR the kid leader), so it shows for EVERYONE
  // running the meeting + drives the countdown reveal. Falls back to a
  // legacy parents-set family-doc closingSong if one exists.
  const [songSeeded, setSongSeeded] = useState(false);
  // Whether today's pick is pre-approved (parent-set, or kid-set with the gate
  // off, or a parent approved it). When false, the presenter shows the
  // approve prompt to whoever's running the meeting (v4.5).
  const [songPreApproved, setSongPreApproved] = useState(true);
  useEffect(() => {
    if (songSeeded || !family || !profile?.familyId) return;
    const scheduleDow = family.meetingSetup?.schedule?.dayOfWeek;
    const cycleKey = meetingCycleKey(scheduleDow) ?? 'always';
    let cancelled = false;
    getTodaysSong(profile.familyId, cycleKey)
      .then((s) => {
        if (cancelled) return;
        let url = s?.url || '';
        if (s) setSongPreApproved(s.pickApproved !== false);
        if (!url) {
          // Legacy fallback: a parent-set closingSong on the family doc.
          const legacy = family.meetingSetup?.closingSong;
          const currentKey = meetingCycleKey(scheduleDow);
          if (legacy?.url && (!legacy.cycleKey || !currentKey || legacy.cycleKey === currentKey)) url = legacy.url;
        }
        if (url) setReflectionContents((prev) => ({ ...prev, songs: prev.songs || url }));
        setSongSeeded(true);
      })
      .catch(() => { if (!cancelled) setSongSeeded(true); });
    return () => { cancelled = true; };
  }, [family, profile?.familyId, songSeeded]);

  // ── Save handler ─────────────────────────────────────────────────
  // Two writes happen on finish:
  //   1. Patches to each historical meeting whose `goalsDone` was
  //      toggled tonight (so old goals stay marked done even when
  //      reviewed weeks later).
  //   2. The new meeting record — captures tonight's attendance,
  //      gratitude, appreciations, new goals, and chosen reflection.
  const handleFinish = async () => {
    if (!profile?.familyId) return;
    setSaving(true);

    // 1. Persist each touched historical meeting's goalsDone.
    const historicalPatches = Object.entries(reviewedGoalsDone)
      .filter(([, perKid]) => Object.keys(perKid).length > 0)
      .map(([meetingId, perKid]) => {
        // Merge with whatever the meeting already had on Firestore.
        const existing = recentMeetings.find((m) => m.id === meetingId);
        const merged = { ...(existing?.goalsDone || {}), ...perKid };
        return updateMeeting(profile.familyId!, meetingId, { goalsDone: merged });
      });
    await Promise.all(historicalPatches);

    // 2. Compose + create tonight's meeting.
    const reflection = reflectionModes.length > 0
      ? {
          modes: reflectionModes,
          contents: Object.fromEntries(
            reflectionModes
              .map((m) => [m, (reflectionContents[m] || '').trim()])
              .filter(([, v]) => v),
          ) as Partial<Record<ReflectionMode, string>>,
          ...(songLinkApprovedBy ? { songLinkApprovedBy } : {}),
        }
      : undefined;

    const presentation = (presentBy.trim() || presentTopic.trim())
      ? { by: presentBy.trim() || undefined, topic: presentTopic.trim() || undefined }
      : undefined;

    // This week's committed goals come from each kid's prep submission
    // (or a live capture). Merge prep goals into the per-kid `goals` map
    // so the saved meeting doc records them — next week's carry-forward
    // review reads `meeting.goals`, so an unmerged commitment would
    // silently fail to carry. Live-captured goals take precedence.
    const goalsForRecord: Record<string, string> = { ...goals };
    for (const c of children) {
      if (!goalsForRecord[c.id]?.trim()) {
        // Up to 3 goals join into the single per-kid meeting field so the
        // carry-forward review (which reads meeting.goals[childId]) keeps
        // the whole set.
        const g = (submissions.find((s) => s.childId === c.id)?.goals || [])
          .map((x) => x.trim()).filter(Boolean).join(' · ');
        if (g) goalsForRecord[c.id] = g;
      }
    }

    const payload: Omit<Meeting, 'id' | 'createdAt'> = {
      date: todayString(),
      type: 'weekly',
      attendees: Array.from(attendees),
      parentAttendees: Array.from(parentAttendees),
      guestAttendees: guestAttendees
        .filter((g) => g.name.trim().length > 0)
        .map((g) => ({ id: g.id, name: g.name.trim(), relationship: g.relationship || undefined })),
      gratitude,
      goals: goalsForRecord,
      notes: '',
      appreciations,
      presentation,
      reflection,
      ...(pinkyPromised.size > 0 ? { pinkyPromised: Array.from(pinkyPromised) } : {}),
      ...(openingWordDone ? {
        openingWord: {
          mode: openingWordMode,
          ...(openingWordNote.trim() ? { note: openingWordNote.trim() } : {}),
          doneAt: Date.now(),
        },
      } : {}),
      createdBy: profile.uid,
    };
    await createMeeting(profile.familyId, payload as Omit<Meeting, 'id'>);

    // Sunday-Meeting v2 (multi-tag): reveal @-tagged appreciations on
    // meeting day. A line can tag SEVERAL people or "All" — notify each
    // recipient once per line. Fire-and-forget; never blocks finish.
    const allMemberUids = Array.from(new Set(Object.values(uidByTagId)));
    for (const s of submissions) {
      (s.appreciations || []).forEach((rawText, i) => {
        const text = (rawText || '').trim();
        if (!text) return;
        const tag = appreciationTagsForLine(s, i);
        // Resolve target uids: "All" → every member; else each tagged id.
        const targetUids = tag.all
          ? allMemberUids
          : tag.ids.map((id) => uidByTagId[id]).filter(Boolean);
        const seen = new Set<string>();
        for (const toUid of targetUids) {
          if (!toUid || toUid === s.uid || seen.has(toUid)) continue; // dedupe / skip self
          seen.add(toUid);
          createNotification(profile.familyId!, {
            type: 'appreciation',
            title: '💛 You were appreciated',
            message: `${s.name} appreciates you — ${text}`,
            read: false,
            forUserId: toUid,
            link: '/meetings',
          } as any).catch(() => { /* non-fatal */ });
        }
      });
    }

    // Archive everyone's submissions into their history (PR F) BEFORE
    // clearing, so members can always look back in "My Submissions".
    // Then clear the upcoming docs so next week starts fresh. Both are
    // best-effort — the meeting itself is already saved.
    await archiveMeetingSubmissions(profile.familyId, submissions, payload.date)
      .catch(() => { /* non-fatal */ });
    clearMeetingSubmissions(profile.familyId).catch(() => { /* non-fatal */ });

    // Sunday-Meeting v2 (b6): email the Meeting Recap Book to parents +
    // Family contacts when the family has it switched on (default ON).
    // Fire-and-forget — recap is a perk, not a barrier to finishing.
    const recapEnabled = family?.meetingSetup?.recapBookEmailEnabled ?? true;
    if (recapEnabled) {
      sendMeetingRecapEmail({
        family,
        payload,
        submissions,
        householdParents,
        children,
        songLinkApprovedBy,
      }).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[meeting-recap] send failed (non-fatal):', e);
      });
    }

    setSaving(false);
    setDone(true);
    // Clear the persisted step so next week's meeting starts at step 1.
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem('kaya:meeting-presenter:stepIdx');
    }
  };

  // ── Step gating (prevent advance if required input missing) ──────
  // Intentionally lenient — a parent might want to skip a step on a
  // busy night. Reflection still requires at least one mode picked
  // before Finish so the saved record makes sense.
  const canAdvance = useMemo(() => {
    if (step.id !== 'reflection') return true;
    return reflectionModes.length > 0;
  }, [step.id, reflectionModes]);

  // Helper: toggle done state for a specific meeting+kid goal.
  const toggleHistoricalGoalDone = (meetingId: string, kidId: string, done: boolean) => {
    setReviewedGoalsDone((prev) => ({
      ...prev,
      [meetingId]: { ...(prev[meetingId] || {}), [kidId]: done },
    }));
  };

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-br from-kaya-chocolate via-kaya-chocolate to-kaya-chocolate-light text-white overflow-hidden">
      {/* Top bar — step indicator + exit */}
      <header className="flex items-center justify-between px-6 lg:px-12 pt-6 pb-4 shrink-0">
        <div>
          <p className="text-[10px] lg:text-[11px] uppercase tracking-[0.2em] font-bold text-kaya-gold-light/80">
            Family Meeting · Presenter
          </p>
          <p className="text-[12px] lg:text-[13px] text-white/60 font-semibold mt-0.5">
            {family?.name || 'Your family'} · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/meetings')}
          aria-label="Exit presenter"
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-lg flex items-center justify-center transition-colors"
        >
          ✕
        </button>
      </header>

      {/* Step progress rail */}
      <div className="px-6 lg:px-12 pb-3 shrink-0">
        <div className="flex gap-1.5">
          {activeSteps.map((s, i) => (
            <button
              type="button"
              key={s.id}
              onClick={() => setStepIdx(i)}
              aria-label={`Jump to ${s.title}`}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                i < safeStepIdx ? 'bg-kaya-gold' : i === safeStepIdx ? 'bg-kaya-gold-light' : 'bg-white/15'
              }`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-2 text-[10px] uppercase tracking-[0.16em] font-bold text-white/50">
          <span>Step {safeStepIdx + 1} of {activeSteps.length}</span>
          <span>{step.title}</span>
        </div>
      </div>

      {/* Main step pane */}
      <main className="flex-1 overflow-y-auto px-6 lg:px-12 py-4 lg:py-8">
        <div className="max-w-3xl mx-auto">
          {done ? (
            <FinishedSplash onClose={() => router.push('/meetings')} />
          ) : (
            <>
              {/* Step heading — hidden on the opening reveal, which
                  ships its own bigger typography in `OpenStep`. */}
              {step.id !== 'open' && (
                <div className="mb-6 lg:mb-10 text-center">
                  <div className="text-5xl lg:text-7xl mb-3" aria-hidden>{step.emoji}</div>
                  <h1 className="font-display font-black text-3xl lg:text-5xl tracking-tight">
                    {step.title}
                  </h1>
                  <p className="mt-3 text-[14px] lg:text-base text-white/70 max-w-xl mx-auto leading-relaxed">
                    {step.sub}
                  </p>
                </div>
              )}

              {/* Step body */}
              {step.id === 'open' && (
                <>
                  {onThisDay && <OnThisDayBanner memory={onThisDay} />}
                  {dueCapsulesList.length > 0 && (
                    <CapsuleReveal
                      capsules={dueCapsulesList}
                      onReflect={async (id, cameTrue) => {
                        if (!profile?.familyId) return;
                        await reflectOnCapsule(profile.familyId, id, cameTrue);
                        setCapsules((prev) => prev.map((c) =>
                          c.id === id ? { ...c, status: 'reflected', cameTrue } : c
                        ));
                      }}
                    />
                  )}
                  <OpenStep
                    family={family}
                    // Prefer the queued leader (set last meeting); fall back
                    // to whoever's driving the device right now so a
                    // first-ever meeting isn't blank.
                    leaderName={family?.nextMeetingLeader?.name || profile?.displayName}
                    leaderEmoji={family?.nextMeetingLeader?.emoji}
                    mostPrepared={mostPrepared}
                    onContinue={() => setStepIdx(safeStepIdx + 1)}
                  />
                </>
              )}

              {step.id === 'attendance' && profile?.familyId && (
                <>
                  <LeaderPicker
                    familyId={profile.familyId}
                    queued={family?.nextMeetingLeader || null}
                    parents={householdParents}
                    childrenList={children}
                    currentUserUid={profile.uid}
                  />
                  <div className="my-5 lg:my-7 h-px bg-white/10" aria-hidden />
                </>
              )}

              {step.id === 'attendance' && (
                <AttendanceStep
                  childrenList={children}
                  parentsList={householdParents}
                  attendees={attendees}
                  parentAttendees={parentAttendees}
                  guests={guestAttendees}
                  guestSuggestions={guestSuggestions}
                  onToggleAttendee={(kidId) => {
                    setAttendees((prev) => {
                      const next = new Set(prev);
                      if (next.has(kidId)) next.delete(kidId);
                      else next.add(kidId);
                      return next;
                    });
                  }}
                  onToggleParent={(uid) => {
                    setParentAttendees((prev) => {
                      const next = new Set(prev);
                      if (next.has(uid)) next.delete(uid);
                      else next.add(uid);
                      return next;
                    });
                  }}
                  onAddGuest={(name, relationship) => {
                    setGuestAttendees((prev) => [
                      ...prev,
                      { id: `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`, name, relationship },
                    ]);
                  }}
                  onRemoveGuest={(id) => setGuestAttendees((prev) => prev.filter((g) => g.id !== id))}
                  presentBy={presentBy}
                  presentTopic={presentTopic}
                  onChangePresentBy={setPresentBy}
                  onChangePresentTopic={setPresentTopic}
                />
              )}

              {step.id === 'openingword' && (
                <OpeningWordStep
                  leaderName={family?.nextMeetingLeader?.name || profile?.displayName || 'The leader'}
                  mode={openingWordMode}
                  onMode={setOpeningWordMode}
                  note={openingWordNote}
                  onNote={setOpeningWordNote}
                  done={openingWordDone}
                  onDone={() => { setOpeningWordDone(true); setStepIdx(safeStepIdx + 1); }}
                  required={openingWordRequired}
                  onSkip={() => setStepIdx(safeStepIdx + 1)}
                  showLibrary={openingWordShowLibrary}
                  prayers={prayerLibrary}
                />
              )}

              {step.id === 'gratitude' && (
                <StepSubmissions
                  section="gratitudes"
                  submissions={submissions}
                  roster={prepRoster}
                  liveValues={gratitude}
                  onChangeLive={(id, v) => setGratitude({ ...gratitude, [id]: v })}
                  placeholder="I'm thankful for…"
                />
              )}

              {step.id === 'celebrate' && (
                <CelebrateStep />
              )}

              {step.id === 'appreciations' && (
                <StepSubmissions
                  section="appreciations"
                  submissions={submissions}
                  roster={prepRoster}
                  liveValues={appreciations}
                  onChangeLive={(id, v) => setAppreciations({ ...appreciations, [id]: v })}
                  placeholder="I appreciate @name for…"
                />
              )}

              {step.id === 'goals' && (
                <GoalsStep
                  childrenList={children}
                  submissions={submissions}
                  roster={prepRoster}
                  recentMeetings={recentMeetings}
                  reviewedGoalsDone={reviewedGoalsDone}
                  onToggleHistoricalGoalDone={toggleHistoricalGoalDone}
                  goals={goals}
                  onChangeGoals={setGoals}
                  pinkyPromised={pinkyPromised}
                  onTogglePinky={(kidId) => setPinkyPromised((prev) => {
                    const next = new Set(prev);
                    if (next.has(kidId)) next.delete(kidId); else next.add(kidId);
                    return next;
                  })}
                />
              )}

              {step.id === 'reflection' && (
                <>
                  {profile?.familyId && <AnthemCard familyId={profile.familyId} />}
                  <ReflectionStep
                    enabledModes={enabledClosingModes}
                    contents={reflectionContents}
                    onContentChange={(m, v) => {
                      setReflectionContents({ ...reflectionContents, [m]: v });
                      // If the songs content was *changed*, any prior
                      // approval no longer applies — they might've pasted
                      // a totally different link. Re-arm the gate.
                      if (m === 'songs') setSongLinkApprovedBy(null);
                    }}
                    onCelebratePrayer={() => {
                      // Snapshot the prayer text so on-stage typography
                      // doesn't reflow if the textarea changes mid-fall.
                      setPrayerOnStage((reflectionContents.prayer || '').trim() || ' ');
                    }}
                    prayerLibraryCount={prayerLibrary.length}
                    viewerUid={profile?.uid || ''}
                    kidSongLinkRequiresApproval={family?.meetingSetup?.kidSongLinkRequiresApproval ?? true}
                    songLinkApprovedBy={songLinkApprovedBy}
                    songPreApproved={songPreApproved}
                    onApproveSongLink={(uid) => {
                      setSongLinkApprovedBy(uid);
                      setSongPreApproved(true);
                      // Persist the approval on the pick so it sticks + clears
                      // the prompt for everyone else.
                      const dow = family?.meetingSetup?.schedule?.dayOfWeek;
                      if (profile?.familyId) approveTodaysSong(profile.familyId, meetingCycleKey(dow) ?? 'always').catch(() => {});
                    }}
                    familyId={profile?.familyId || ''}
                    viewerName={(profile?.displayName || 'Family').split(' ')[0]}
                  />
                  {/* Time Capsule sealer — last beat of the meeting. */}
                  {profile?.familyId && profile?.uid && (
                    <CapsuleSealer
                      familyId={profile.familyId}
                      uid={profile.uid}
                      displayName={profile.displayName || 'Family'}
                      lockYears={family?.meetingSetup?.timeCapsuleLockYears ?? 1}
                      scheduleDayOfWeek={family?.meetingSetup?.schedule?.dayOfWeek}
                      onSealed={(c) => setCapsules((prev) => [...prev, c])}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>

      {/* Footer nav */}
      {!done && (
        <footer className="px-6 lg:px-12 pb-6 lg:pb-8 pt-3 shrink-0 border-t border-white/10 bg-black/20 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStepIdx(Math.max(0, safeStepIdx - 1))}
              disabled={safeStepIdx === 0}
              className="h-12 lg:h-14 px-5 lg:px-7 rounded-kaya bg-white/10 hover:bg-white/20 text-white font-display font-extrabold text-sm lg:text-base transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← Back
            </button>
            <div className="flex-1" />
            {!isLastStep ? (
              <button
                type="button"
                onClick={() => setStepIdx(safeStepIdx + 1)}
                disabled={step?.id === 'openingword' && openingWordRequired && !openingWordDone}
                title={step?.id === 'openingword' && openingWordRequired && !openingWordDone
                  ? 'Mark the Opening Word done to continue (set in Meeting settings)' : undefined}
                className="h-12 lg:h-14 px-6 lg:px-8 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-sm lg:text-base transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinish}
                disabled={!canAdvance || saving}
                className="h-12 lg:h-14 px-6 lg:px-8 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-sm lg:text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : '✅ Finish meeting'}
              </button>
            )}
          </div>
        </footer>
      )}

      {/* Prayer stage — full-screen typography of the prayer text with
          the flowers-drop overlay on top. Triggered by the Prayer
          "Say & celebrate" button. */}
      {prayerOnStage !== null && (
        <PrayerStage
          prayer={prayerOnStage}
          familyName={family?.name || 'our family'}
          onClose={() => setPrayerOnStage(null)}
          onCelebrateAndFinish={() => {
            // Celebrate (flowers ran on stage), then close the stage
            // and finish the meeting — flow lands on the Kaya Kaya
            // celebration screen with fireworks + flowers + sparkles.
            setPrayerOnStage(null);
            handleFinish();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

// ── Opening reveal ───────────────────────────────────────────────────
// The first step of every meeting — a dark "Day Opens" stage matching
// the Kaya-Sunday-Meeting v2 design proposal (b0). Confirms today is
// the family's meeting day by reading `family.meetingSetup.schedule`,
// then surfaces a green ✓ badge if it matches, or an amber "opening
// anyway" badge if the parent is rallying off-schedule. Big typography,
// gold underglow, single "Open the meeting →" CTA that auto-advances
// to Attendance. PR #4 will populate the leader pill from the queue.

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'] as const;

function OpenStep({
  family,
  leaderName,
  leaderEmoji,
  mostPrepared,
  onContinue,
}: {
  family: any; // Family doc; loose-typed here because the import chain
               // is heavy and the only fields touched are meetingSetup +
               // name (both optional with safe fallbacks).
  leaderName?: string;
  leaderEmoji?: string;
  mostPrepared?: { name: string; emoji: string; count: number } | null;
  onContinue: () => void;
}) {
  const sch = family?.meetingSetup?.schedule;
  const now = new Date();
  const todayDow = now.getDay();
  // YYYY-MM-DD in LOCAL time (helpers may be in different TZs) — per
  // the project's date-format rule.
  const isoLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dateDisplay = toDisplayDate(isoLocal);
  const todayDayName = DAY_NAMES[todayDow];

  const scheduledDayName = sch && typeof sch.dayOfWeek === 'number'
    ? DAY_NAMES[sch.dayOfWeek] : null;
  const scheduledTime: string | null = sch?.time || null;
  const matches = !!sch && sch.dayOfWeek === todayDow;
  const hasSchedule = !!sch && scheduledDayName;

  return (
    <div
      className="relative text-center mx-auto max-w-xl rounded-3xl px-6 py-10 lg:px-10 lg:py-14 overflow-hidden"
      style={{
        background:
          'radial-gradient(circle at 50% 30%, rgba(61,36,26,0.9) 0%, rgba(30,18,11,1) 60%, rgba(10,6,4,1) 100%)',
        boxShadow: 'inset 0 0 80px rgba(212,160,23,0.10)',
      }}
    >
      {/* Soft underglow accents — pure CSS, no animation lib. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 20% 80%, rgba(212,160,23,0.15), transparent 40%), radial-gradient(circle at 80% 20%, rgba(212,160,23,0.12), transparent 35%)',
        }}
      />

      <div className="relative">
        <p className="text-[10px] lg:text-[11px] uppercase tracking-[0.3em] font-extrabold text-kaya-gold-light/90">
          ✨ {family?.meetingSetup?.title || 'Sunday Meeting'}
        </p>

        <h1
          className="font-display font-black text-4xl lg:text-6xl mt-2 mb-2 leading-tight"
          style={{ textShadow: '0 2px 16px rgba(212,160,23,0.35)' }}
        >
          It&apos;s time, family.
        </h1>

        <p className="text-kaya-gold-light text-base lg:text-lg font-extrabold tracking-[0.06em]">
          {todayDayName} · {dateDisplay}
        </p>

        {scheduledTime && (
          <div className="inline-flex items-center gap-2 bg-kaya-gold/20 border border-kaya-gold-light/40 rounded-full px-4 py-1.5 mt-4 text-kaya-gold-light text-sm font-extrabold">
            🕖 Family meeting time · {scheduledTime}
          </div>
        )}

        {hasSchedule && (
          <div className="mt-3">
            {matches ? (
              <span className="inline-flex items-center gap-1.5 bg-emerald-500 text-white rounded-full px-3 py-1 text-[10px] lg:text-xs font-extrabold uppercase tracking-[0.12em]">
                ✓ Matches your {scheduledDayName}{scheduledTime ? ` ${scheduledTime}` : ''} setting
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-amber-500 text-white rounded-full px-3 py-1 text-[10px] lg:text-xs font-extrabold uppercase tracking-[0.12em]">
                Set for {scheduledDayName}s — opening anyway
              </span>
            )}
          </div>
        )}

        {leaderName && (
          <div className="inline-flex items-center gap-2 bg-white text-kaya-chocolate rounded-full pl-1.5 pr-3.5 py-1 mt-5 font-display font-black text-sm shadow-[0_6px_18px_rgba(212,160,23,0.35)]">
            <span className="w-6 h-6 rounded-full bg-kaya-gold-light flex items-center justify-center text-base" aria-hidden>
              {leaderEmoji || '🎤'}
            </span>
            {leaderName} · leading
          </div>
        )}

        {/* 👑 Surprise 1 — Most Prepared crown (whoever filled the most
            prep this cycle). Pure celebration of filling ahead. */}
        {mostPrepared && (
          <div className="mt-3">
            <span className="inline-flex items-center gap-1.5 bg-kaya-gold/20 border border-kaya-gold-light/40 rounded-full px-3 py-1 text-kaya-gold-light text-[11px] lg:text-xs font-extrabold">
              👑 Most Prepared · {mostPrepared.emoji} {mostPrepared.name}
            </span>
          </div>
        )}

        <div className="mt-8 lg:mt-10">
          <button
            type="button"
            onClick={onContinue}
            className="bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-black text-base lg:text-lg px-7 lg:px-9 py-3 lg:py-3.5 rounded-full inline-flex items-center gap-2 shadow-[0_6px_14px_rgba(0,0,0,0.35)] transition-colors"
          >
            Open the meeting →
          </button>
          <p className="mt-3 text-[11px] text-white/45 leading-snug">
            We&apos;ll move from step to step on autopilot — the leader can jump anywhere from the bars at the top.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Family Time Capsule (Sunday-Meeting v2 · b7) ─────────────────────
// Two components:
//   • CapsuleReveal — on the Open step, surface any sealed notes whose
//     openOn lands within ±3 days of today. Same warm gold motif as
//     the rest of the opener so it feels like part of the ceremony.
//   • CapsuleSealer — on the Closing step, let one person leave a
//     single-line note that gets sealed for the family's lock window
//     (default 1 year). The openOn is snapped to the nearest scheduled
//     meeting within ±3 days of the anniversary.

function CapsuleReveal({
  capsules, onReflect,
}: {
  capsules: FamilyCapsule[];
  onReflect: (id: string, cameTrue: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="mb-6 lg:mb-8 space-y-3">
      {capsules.map((c) => {
        const ageYears = (Date.now() - c.writtenAt) / (365.25 * 24 * 60 * 60 * 1000);
        const ageLabel = ageYears >= 0.9 && ageYears <= 1.1 ? 'A year ago'
          : ageYears >= 2.8 ? `${Math.round(ageYears)} years ago`
          : `${Math.round(ageYears * 12)} months ago`;
        const reflected = c.status === 'reflected';
        return (
          <div
            key={c.id}
            className="rounded-3xl border border-kaya-gold/60 p-5 lg:p-6 text-center"
            style={{ background: 'linear-gradient(180deg, rgba(212,160,23,0.10), rgba(212,160,23,0.04))' }}
          >
            <div className="text-4xl lg:text-5xl mb-2">🎁</div>
            <p className="text-[10px] uppercase tracking-[0.24em] font-extrabold text-kaya-gold-light/85">
              💌 {ageLabel}, your family wrote…
            </p>
            <p className="font-display text-lg lg:text-xl font-extrabold italic text-white mt-3 leading-snug">
              &ldquo;{c.text}&rdquo;
            </p>
            <p className="text-[11px] text-white/55 mt-2">
              — {c.writtenByEmoji || '✍️'} {c.writtenByName}
            </p>
            {!reflected ? (
              <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
                <span className="text-[12px] text-white/70">Did it come true?</span>
                <button
                  type="button"
                  onClick={async () => { setBusy(c.id); try { await onReflect(c.id, true); } finally { setBusy(null); } }}
                  disabled={busy === c.id}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-[12px] font-extrabold transition-colors disabled:opacity-50"
                >
                  ✓ Yes
                </button>
                <button
                  type="button"
                  onClick={async () => { setBusy(c.id); try { await onReflect(c.id, false); } finally { setBusy(null); } }}
                  disabled={busy === c.id}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-white/10 hover:bg-white/15 text-white/85 text-[12px] font-extrabold transition-colors disabled:opacity-50"
                >
                  Not yet
                </button>
              </div>
            ) : (
              <p className="mt-4 text-[12px] font-extrabold text-emerald-300">
                ✓ {c.cameTrue ? 'Came true 🎉' : 'Carried forward 💛'}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CapsuleSealer({
  familyId, uid, displayName, lockYears, scheduleDayOfWeek, onSealed,
}: {
  familyId: string;
  uid: string;
  displayName: string;
  lockYears: number;
  scheduleDayOfWeek?: number;
  onSealed: (capsule: FamilyCapsule) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [sealed, setSealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openOnPreview = useMemo(
    () => computeOpenOn({ from: new Date(), lockYears, scheduleDayOfWeek }),
    [lockYears, scheduleDayOfWeek],
  );

  const lockLabel = lockYears === 0.5 ? '6 months' : lockYears === 3 ? '3 years' : '1 year';

  const handleSeal = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true); setError(null);
    try {
      const id = await sealCapsule(familyId, {
        text: trimmed,
        writtenByUid: uid,
        writtenByName: displayName,
        openOn: openOnPreview,
        lockYears,
      });
      const c: FamilyCapsule = {
        id,
        text: trimmed,
        writtenByUid: uid,
        writtenByName: displayName,
        writtenAt: Date.now(),
        openOn: openOnPreview,
        lockYears,
        status: 'sealed',
      };
      onSealed(c);
      setSealed(true);
    } catch (e: any) {
      setError(e?.message || 'Could not seal — try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-6 lg:mt-8 rounded-kaya-lg border border-purple-400/40 bg-purple-500/[0.07] p-5 lg:p-6">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-left"
        >
          <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-purple-200/85">
            💌 Family Time Capsule · optional
          </p>
          <p className="font-display font-extrabold text-base lg:text-lg text-white mt-1">
            Leave a one-line note to your future family
          </p>
          <p className="text-[12px] text-white/55 mt-1">
            We&apos;ll seal it for {lockLabel} and surface it on the closest meeting to that date.
          </p>
        </button>
      ) : sealed ? (
        <div className="text-center">
          <div className="text-3xl mb-1">🔒</div>
          <p className="font-display font-extrabold text-white text-base">Sealed for {lockLabel}!</p>
          <p className="text-[12px] text-white/60 mt-1">
            Opens around <b className="text-purple-200">{openOnPreview}</b>.
          </p>
        </div>
      ) : (
        <>
          <p className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-purple-200/85 mb-2">
            💌 Family Time Capsule
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={180}
            placeholder="A hope, a quote, a tiny prediction…"
            rows={3}
            className="w-full bg-white/10 border border-white/10 rounded-kaya-sm px-4 py-3 text-[14px] lg:text-base text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-400/60 resize-none leading-relaxed"
          />
          <p className="mt-2 text-[11px] text-white/55">
            Sealed for <b className="text-purple-200">{lockLabel}</b> · opens around <b className="text-purple-200">{openOnPreview}</b>{scheduleDayOfWeek !== undefined ? ' (snapped to your meeting day · ±3 days)' : ''}.
          </p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleSeal}
              disabled={saving || text.trim().length === 0}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-purple-500 hover:bg-purple-400 text-white font-display font-extrabold text-[13px] transition-colors disabled:opacity-50"
            >
              🔒 Seal for {lockLabel}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center h-11 px-4 rounded-full bg-white/10 hover:bg-white/15 text-white/80 text-[12px] font-bold transition-colors"
            >
              Cancel
            </button>
            {error && <span className="text-[11px] text-rose-300 font-bold">⚠️ {error}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ── StepSubmissions (Sunday-Meeting v2 PR C) ─────────────────────────
// Replaces the old "wall of empty input boxes" for Gratitude /
// Appreciations. Two parts:
//   1. Filled — what everyone added in advance (live-synced; a member
//      filling from their own My Day / Workplan pops in here mid-meeting),
//      plus anything captured live in the meeting (tagged "added live").
//   2. Still to add — a tidy chip per member who hasn't filled this
//      section. The preferred path is they fill from their own device
//      (it appears above live). Tapping a chip opens an OPTIONAL inline
//      capture as a quiet fallback ("but can leave it", per Elia) — it
//      writes to the leader's local map, persisted with the meeting.
function StepSubmissions({
  section, submissions, roster, liveValues, onChangeLive, placeholder,
  filledHeader, missingHeader,
}: {
  section: 'gratitudes' | 'appreciations' | 'goals';
  submissions: MeetingSubmission[];
  roster: PrepMember[];
  liveValues: Record<string, string>;
  onChangeLive: (memberId: string, value: string) => void;
  placeholder: string;
  /** Optional overrides (used by the Goals step to read
   *  "🎯 This week — our commitments" / "Still to set this week"). */
  filledHeader?: string;
  missingHeader?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // 💌 Surprise 3 — tagged appreciations arrive SEALED and unwrap on tap
  // (a little group reveal moment in the meeting). Tracks which have been
  // opened this session.
  const [unwrapped, setUnwrapped] = useState<Set<string>>(new Set());

  const subDoc = (m: PrepMember): MeetingSubmission | undefined =>
    submissions.find((x) => (m.kind === 'kid' ? x.childId === m.id : x.uid === m.id));

  // Per-line view for this section. For appreciations each line carries
  // its own @-tag name (PR "3-lines"); other sections have no tags.
  const linesFor = (m: PrepMember): Array<{ text: string; tag?: string }> => {
    const s = subDoc(m);
    if (!s) return [];
    return (s[section] || [])
      .map((text, i) => ({ text, tag: section === 'appreciations' ? (appreciationTagLabelForLine(s, i) || undefined) : undefined }))
      .filter((r) => !!r.text && r.text.trim().length > 0);
  };

  const filled = roster
    .map((m) => ({ m, lines: linesFor(m), live: (liveValues[m.id] || '').trim() }))
    .filter((r) => r.lines.length > 0 || r.live.length > 0);
  const missing = roster.filter((m) => linesFor(m).length === 0 && !(liveValues[m.id] || '').trim());

  const sectionLabel = section === 'gratitudes' ? 'Gratitudes'
    : section === 'appreciations' ? 'Appreciations' : 'Goals';
  const filledHead = filledHeader ?? `📨 Filled in advance · ${sectionLabel}`;
  const missingHead = missingHeader ?? 'Still to add';

  return (
    <div className="space-y-4 lg:space-y-5">
      {filled.length > 0 && (
        <div className="rounded-kaya-lg border border-purple-400/30 bg-purple-500/[0.06] p-4 lg:p-5">
          <p className="text-[10px] lg:text-[11px] uppercase tracking-[0.18em] font-extrabold text-purple-200/85 mb-3">
            {filledHead}
          </p>
          <ul className="space-y-2">
            {filled.map(({ m, lines, live }) => {
              // 💌 Sealed gift: if ANY appreciation line is tagged, the
              // member's set stays wrapped until tapped, then unwraps with
              // a little pop. Each line keeps its own @chip on reveal.
              const hasTag = lines.some((l) => !!l.tag);
              const sealed = hasTag && !unwrapped.has(m.id);
              const tagNames = lines.filter((l) => l.tag).map((l) => l.tag).join(' · ');
              if (sealed) {
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setUnwrapped((prev) => new Set(prev).add(m.id))}
                      className="w-full flex items-center gap-3 text-left rounded-kaya border border-purple-300/40 bg-purple-500/15 hover:bg-purple-500/25 px-3 py-2.5 transition-colors"
                    >
                      <span className="text-2xl" aria-hidden>🎁</span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-display font-extrabold text-white text-[13px]">
                          {lines.length > 1 ? 'Appreciations' : 'An appreciation'} for {tagNames}
                        </span>
                        <span className="block text-[11px] text-purple-100/80">Tap to unwrap 💛</span>
                      </span>
                    </button>
                  </li>
                );
              }
              return (
                <li key={m.id} className="flex items-start gap-2.5 text-[13px] lg:text-[14px]">
                  <span className="text-base lg:text-lg" aria-hidden>{m.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-extrabold text-white">
                      {m.name}
                      {hasTag && unwrapped.has(m.id) && (
                        <span className="ml-1.5 text-[12px]" aria-hidden>🎉</span>
                      )}
                    </p>
                    <ul className="text-white/80 leading-snug">
                      {lines.map((l, i) => (
                        <li key={i} className="italic">
                          {l.tag && (
                            <span className="not-italic mr-1.5 inline-flex items-center rounded-full bg-purple-500/30 border border-purple-300/40 px-2 py-0.5 text-[10px] font-extrabold text-purple-100">
                              💛 {l.tag}
                            </span>
                          )}
                          &ldquo;{l.text}&rdquo;
                        </li>
                      ))}
                      {live && (
                        <li className="italic">
                          &ldquo;{live}&rdquo;{' '}
                          <span className="not-italic text-[10px] font-bold uppercase tracking-wide text-kaya-gold-light/80">· added live</span>
                        </li>
                      )}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {missing.length > 0 && (
        <div className="rounded-kaya-lg border border-dashed border-white/20 bg-white/[0.04] p-4 lg:p-5">
          <p className="text-[10px] uppercase tracking-[0.16em] font-extrabold text-white/45 mb-1">
            Still to add
          </p>
          <p className="text-[11px] text-white/45 mb-3">
            They can fill from their own <strong className="text-white/70">My Day / Workplan</strong> — it appears here live.
          </p>
          <div className="flex flex-wrap gap-2">
            {missing.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setOpenId(openId === m.id ? null : m.id)}
                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-bold border transition-colors ${
                  openId === m.id
                    ? 'bg-white/15 border-white/40 text-white'
                    : 'bg-white/[0.06] border-white/15 text-white/70 hover:bg-white/10'
                }`}
              >
                <span aria-hidden>{m.emoji}</span>
                <span>{m.name}</span>
                <span className="text-kaya-gold-light/80 font-extrabold">{openId === m.id ? '✕' : '+ add here'}</span>
              </button>
            ))}
          </div>

          {openId && (
            <div className="mt-3">
              <input
                autoFocus
                value={liveValues[openId] || ''}
                onChange={(e) => onChangeLive(openId, e.target.value)}
                placeholder={placeholder}
                className="w-full bg-white/10 border border-white/15 rounded-kaya-sm px-4 py-3 text-[14px] text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-kaya-gold/60"
              />
              <p className="mt-1.5 text-[10.5px] text-white/40">
                Optional — the meeting is for reading &amp; celebrating. Best if {roster.find((r) => r.id === openId)?.name || 'they'} fills from their own My Day.
              </p>
            </div>
          )}
        </div>
      )}

      {filled.length === 0 && missing.length === 0 && (
        <EmptyHint>Nobody has added a {section === 'gratitudes' ? 'gratitude' : 'appreciation'} yet — they can fill from My Day / Workplan and it shows here live.</EmptyHint>
      )}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-kaya-lg border border-white/10 bg-white/[0.04] p-6 text-center text-white/55 text-[13px]">
      {children}
    </div>
  );
}

// ── Leader queue + Spinning Wheel ────────────────────────────────────
// Sunday-Meeting v2 (b1). Lives inside the Attendance step. Lets the
// current leader queue *who runs the next meeting* — either by tapping
// a member chip or spinning the 🎡 wheel for a fair random pick.
//
// Pool = parents + kids only by default (per Elia's tweak). Helpers,
// grandparents, and guests can be added later via a parent-approval
// flow (out of scope for PR 4; the data shape already supports it).
//
// Persistence: `Family.nextMeetingLeader` (top-level on the Family doc,
// not nested under meetingSetup — it changes weekly while meetingSetup
// is configuration). Saved via `updateFamily`, no rules change needed:
// existing rules already allow parents to write the Family doc.

type LeaderPoolMember = {
  id: string;
  name: string;
  emoji: string;
  kind: 'parent' | 'kid' | 'helper';
};

function LeaderPicker({
  familyId, queued, parents, childrenList, currentUserUid,
}: {
  familyId: string;
  queued: { id: string; name: string; emoji: string; kind: 'parent' | 'kid' | 'helper' } | null;
  parents: Array<{ uid: string; name: string; avatarEmoji?: string }>;
  childrenList: Array<{ id: string; name: string; avatarEmoji?: string }>;
  currentUserUid: string;
}) {
  const [wheelOpen, setWheelOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pool: LeaderPoolMember[] = useMemo(() => [
    ...parents.map((p) => ({
      id: p.uid,
      name: p.name,
      emoji: p.avatarEmoji || '👤',
      kind: 'parent' as const,
    })),
    ...childrenList.map((c) => ({
      id: c.id,
      name: c.name,
      emoji: c.avatarEmoji || '🧒',
      kind: 'kid' as const,
    })),
  ], [parents, childrenList]);

  const handlePick = async (member: LeaderPoolMember) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateFamily(familyId, {
        nextMeetingLeader: {
          id: member.id,
          name: member.name,
          emoji: member.emoji,
          kind: member.kind,
          pickedBy: currentUserUid,
          pickedAt: Date.now(),
        },
      });
    } catch (e: any) {
      setError(e?.message || 'Could not save the pick.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-kaya-lg border border-white/15 bg-gradient-to-br from-kaya-gold/10 via-transparent to-transparent p-4 lg:p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl" aria-hidden>🎤</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] font-extrabold text-kaya-gold-light">
            Next meeting leader
          </p>
          <p className="text-[13px] text-white/75">
            {queued ? (
              <>
                <span className="font-bold text-white">{queued.emoji} {queued.name}</span>
                <span className="text-white/55"> is queued to lead next.</span>
              </>
            ) : (
              <>Tap someone — or <span className="font-bold text-kaya-gold-light">spin the wheel</span> for a fair pick.</>
            )}
          </p>
        </div>
      </div>

      {pool.length === 0 ? (
        <p className="text-xs text-white/55 italic">No family members in the pool yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 lg:gap-2 mb-3">
            {pool.map((m) => {
              const isPicked = queued?.id === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handlePick(m)}
                  disabled={saving}
                  className={`inline-flex items-center gap-1.5 h-9 lg:h-10 px-3 rounded-full text-xs lg:text-sm font-bold transition-colors disabled:opacity-50 ${
                    isPicked
                      ? 'bg-kaya-gold text-kaya-chocolate border-2 border-kaya-gold-light'
                      : 'bg-white/10 hover:bg-white/15 text-white border-2 border-transparent'
                  }`}
                >
                  <span aria-hidden>{m.emoji}</span>
                  <span>{m.name}</span>
                  {isPicked && <span aria-hidden>✓</span>}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setWheelOpen(true)}
            disabled={saving}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-400/40 text-xs lg:text-sm font-bold transition-colors disabled:opacity-50"
          >
            🎡 <span>Spin the Wheel</span>
          </button>

          <p className="mt-2 text-[10.5px] text-white/45">
            Pool: parents + kids. Helpers and grandparents can be added later (parent-approved).
          </p>

          {error && (
            <p className="mt-2 text-[11px] text-rose-300">⚠️ {error}</p>
          )}
        </>
      )}

      {wheelOpen && (
        <LeaderWheel
          pool={pool}
          onClose={() => setWheelOpen(false)}
          onLand={async (m) => {
            await handlePick(m);
          }}
        />
      )}
    </div>
  );
}

// ── LeaderWheel — CSS-only roulette ──────────────────────────────────
// Surprise touch from the v2 design proposal. A 1.6s deterministic spin
// (rotation calculated so the chosen sector lands under the pointer),
// then a confetti-light "🎉 {name}!" reveal. No canvas, no animation
// library — single conic-gradient + transform on a transition.

function LeaderWheel({
  pool, onLand, onClose,
}: {
  pool: LeaderPoolMember[];
  onLand: (m: LeaderPoolMember) => Promise<void> | void;
  onClose: () => void;
}) {
  const SECTOR_COLOURS = ['#D4A017','#3FAF6C','#E36F6F','#9B5DE5','#3FAFD0','#B8860B','#FF6B6B','#0F1F44'];
  const sectorDeg = 360 / Math.max(1, pool.length);
  const conic = useMemo(() => {
    if (pool.length === 0) return SECTOR_COLOURS[0];
    const stops: string[] = [];
    for (let i = 0; i < pool.length; i++) {
      const colour = SECTOR_COLOURS[i % SECTOR_COLOURS.length];
      const from = (i * sectorDeg).toFixed(3);
      const to   = ((i + 1) * sectorDeg).toFixed(3);
      stops.push(`${colour} ${from}deg ${to}deg`);
    }
    return `conic-gradient(${stops.join(',')})`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.length]);

  const [rotation, setRotation] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'landed'>('idle');
  const [winnerIdx, setWinnerIdx] = useState<number | null>(null);

  const handleSpin = () => {
    if (phase !== 'idle' || pool.length === 0) return;
    const idx = Math.floor(Math.random() * pool.length);
    // Pointer sits at the top (12 o'clock = 0°/360°). Sector i's
    // *centre* sits at `i * sectorDeg + sectorDeg/2` (measured
    // clockwise from 0°). To land it under the pointer we rotate the
    // wheel so that centre ends up at 0° (mod 360). With a CSS
    // `transform: rotate(R)` (positive = clockwise), the visible
    // angle of sector i becomes `(i*sectorDeg + sectorDeg/2 + R) mod 360`.
    // We want that === 0 → R ≡ -(i*sectorDeg + sectorDeg/2). Add
    // multiple full spins so it actually *spins*.
    const fullSpins = 5;
    const targetDelta = - (idx * sectorDeg + sectorDeg / 2);
    const newRotation = rotation + fullSpins * 360 + ((targetDelta % 360) - (rotation % 360) + 720) % 360;
    setRotation(newRotation);
    setWinnerIdx(idx);
    setPhase('spinning');
    setTimeout(async () => {
      setPhase('landed');
      await onLand(pool[idx]);
    }, 1700);
  };

  const winner = winnerIdx !== null ? pool[winnerIdx] : null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Spin the Leader Wheel"
      onClick={(e) => { if (e.target === e.currentTarget && phase !== 'spinning') onClose(); }}
    >
      <div className="relative w-full max-w-sm bg-kaya-chocolate text-white rounded-3xl border border-white/15 shadow-2xl p-6 text-center">
        <button
          type="button"
          onClick={onClose}
          disabled={phase === 'spinning'}
          aria-label="Close wheel"
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white text-base flex items-center justify-center disabled:opacity-50"
        >
          ✕
        </button>

        <p className="text-[10px] uppercase tracking-[0.24em] font-extrabold text-kaya-gold-light/90">
          🎡 Leader Wheel
        </p>
        <h3 className="font-display text-2xl font-black mt-1 mb-4">
          {phase === 'landed' && winner ? `🎉 ${winner.name}!` : 'Spin for a fair pick'}
        </h3>

        {/* Wheel */}
        <div className="relative mx-auto" style={{ width: 220, height: 220 }}>
          {/* Pointer */}
          <div
            aria-hidden
            className="absolute z-10"
            style={{
              top: -4,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '12px solid transparent',
              borderRight: '12px solid transparent',
              borderTop: '20px solid #1E120B',
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))',
            }}
          />
          <div
            className="w-full h-full rounded-full"
            style={{
              background: conic,
              boxShadow: '0 12px 28px rgba(0,0,0,0.45), inset 0 0 0 6px white',
              transition: phase === 'spinning' ? 'transform 1.6s cubic-bezier(0.17, 0.67, 0.21, 1.0)' : 'none',
              transform: `rotate(${rotation}deg)`,
            }}
          />
          {/* Hub */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            aria-hidden
          >
            <div
              className="w-14 h-14 rounded-full bg-white text-2xl flex items-center justify-center"
              style={{ boxShadow: 'inset 0 0 0 3px #D4A017' }}
            >
              {phase === 'landed' && winner ? winner.emoji : '🎤'}
            </div>
          </div>
        </div>

        {/* Pool legend */}
        <div className="grid grid-cols-3 gap-1.5 mt-4 text-[10.5px] font-bold text-white/55">
          {pool.map((m, i) => (
            <div
              key={m.id}
              className={`${winnerIdx === i && phase === 'landed' ? 'text-kaya-gold' : ''} truncate`}
              title={m.name}
            >
              {m.emoji} {m.name}
            </div>
          ))}
        </div>

        {phase === 'idle' && (
          <button
            type="button"
            onClick={handleSpin}
            className="mt-5 inline-flex items-center gap-2 h-11 px-6 rounded-full bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-black text-sm transition-colors"
          >
            🎡 Spin!
          </button>
        )}
        {phase === 'spinning' && (
          <p className="mt-5 text-sm text-white/70 italic">Spinning…</p>
        )}
        {phase === 'landed' && winner && (
          <div className="mt-5">
            <p className="text-sm text-white/80">
              {winner.name} is leading next meeting!
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 inline-flex items-center gap-2 h-11 px-6 rounded-full bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-black text-sm transition-colors"
            >
              Done →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CelebrateStep() {
  return (
    <div className="bg-gradient-to-br from-kaya-gold/20 via-kaya-gold-light/10 to-transparent border border-kaya-gold/30 rounded-kaya-lg p-6 lg:p-10 text-center">
      <p className="text-[11px] uppercase tracking-[0.2em] font-bold text-kaya-gold-light mb-2">
        Open the leaderboard
      </p>
      <h2 className="font-display font-black text-2xl lg:text-3xl mb-3">
        Cast the Points Review
      </h2>
      <p className="text-white/70 text-sm lg:text-base leading-relaxed max-w-xl mx-auto mb-6">
        Full-screen leaderboard with the <strong>Excellent Belt®</strong> and{' '}
        <strong>Excellent Ladder®</strong> reveal — perfect for casting to a TV.
        Open it, walk through the week, then come back to continue.
      </p>
      <Link
        href="/meetings/review?from=present"
        className="inline-flex items-center gap-2 h-12 lg:h-14 px-6 lg:px-8 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-sm lg:text-base transition-colors"
      >
        🎬 Open Points Review →
      </Link>
      <p className="text-[12px] text-white/50 mt-6">
        Tip: the Points Review opens in the same window. When you close it,
        we&apos;ll bring you straight to the next step of the meeting — no need
        to come back through the menu.
      </p>
    </div>
  );
}

// ── Attendance step ────────────────────────────────────────────────
// Two halves: a tap-to-toggle attendee grid (default all-present), and
// a small optional "anyone presenting tonight?" capture. Both halves
// are tolerant of being left empty so a family can move on quickly.
// Relationship chip palette for the "+ Add guest" dialog. Plain English,
// covers the common household guests; "Other…" surfaces a free-text input.
const GUEST_RELATIONSHIPS = [
  'Family Friend', 'Grandpa', 'Grandma', 'Uncle', 'Aunt', 'Cousin',
  'Nanny', 'Tutor', 'Helper', 'Neighbour', 'Other',
] as const;

// ── 🙏 Opening Word (SM3.1 · #2) ─────────────────────────────────────────
// The leader opens the night — a prayer, a word of wisdom, a verse, or their
// own words, spoken FROM THE HEART (nothing to read by default). Marking it
// done stamps the meeting record and moves on; when the family's settings
// make it required, the footer Next stays locked until then. The saved
// prayers library only appears when the family switched it on in settings.
const OPENING_MODES: Array<{ id: 'prayer' | 'wisdom' | 'verse' | 'own'; label: string; emoji: string; hint: string }> = [
  { id: 'prayer', label: 'Prayer',         emoji: '🙏', hint: 'Spoken from the heart — no reading needed.' },
  { id: 'wisdom', label: 'Word of wisdom', emoji: '💡', hint: 'A short thought to carry into the week.' },
  { id: 'verse',  label: 'Verse',          emoji: '📖', hint: 'A verse that speaks to this week.' },
  { id: 'own',    label: 'My own words',   emoji: '🗣️', hint: 'Whatever the night needs — your words.' },
];

function OpeningWordStep({
  leaderName, mode, onMode, note, onNote, done, onDone, required, onSkip, showLibrary, prayers,
}: {
  leaderName: string;
  mode: 'prayer' | 'wisdom' | 'verse' | 'own';
  onMode: (m: 'prayer' | 'wisdom' | 'verse' | 'own') => void;
  note: string;
  onNote: (v: string) => void;
  done: boolean;
  onDone: () => void;
  required: boolean;
  onSkip: () => void;
  showLibrary: boolean;
  prayers: Array<{ id: string; title: string; body: string }>;
}) {
  const active = OPENING_MODES.find((m) => m.id === mode) || OPENING_MODES[0];
  return (
    <div className="max-w-2xl mx-auto w-full">
      <p className="text-center text-white/70 text-sm lg:text-base mb-4">
        <span className="font-display font-extrabold text-kaya-gold-light">{leaderName}</span> opens the meeting.
      </p>

      {/* Mode chips */}
      <div className="flex flex-wrap justify-center gap-2 mb-4">
        {OPENING_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onMode(m.id)}
            aria-pressed={mode === m.id}
            className={`px-4 py-2.5 rounded-kaya font-display font-extrabold text-[13px] lg:text-sm transition-colors ${
              mode === m.id
                ? 'bg-kaya-gold text-kaya-chocolate'
                : 'bg-white/10 text-white/75 hover:bg-white/20'
            }`}
          >
            {m.emoji} {m.label}
          </button>
        ))}
      </div>
      <p className="text-center text-white/55 text-[12.5px] lg:text-sm mb-4">{active.hint}</p>

      {/* Prayer library — optional equipment, per family settings. */}
      {showLibrary && mode === 'prayer' && prayers.length > 0 && (
        <div className="rounded-kaya bg-white/5 border border-white/10 p-4 mb-4 max-h-44 overflow-y-auto">
          <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-gold-light mb-2">📖 From your prayer library (optional)</p>
          {prayers.slice(0, 3).map((p) => (
            <div key={p.id} className="mb-2 last:mb-0">
              {p.title && <p className="text-[12px] font-display font-extrabold text-white/85">{p.title}</p>}
              <p className="text-[12.5px] text-white/70 leading-relaxed whitespace-pre-wrap">{p.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* Optional note — lands on the meeting record + report. */}
      <input
        value={note}
        onChange={(e) => onNote(e.target.value)}
        placeholder="(Optional) note what was shared — it goes into the meeting record"
        maxLength={300}
        className="w-full h-12 bg-white/10 border border-white/10 rounded-kaya-sm px-4 text-[13.5px] text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-kaya-gold/60 mb-4"
      />

      {done ? (
        <p className="text-center font-display font-extrabold text-kaya-gold-light">✓ Opening done — thank you, {leaderName}.</p>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onDone}
            className="h-12 lg:h-14 px-8 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-sm lg:text-base transition-colors"
          >
            ✓ Opening done — continue →
          </button>
          {!required && (
            <button
              type="button"
              onClick={onSkip}
              className="text-[12px] font-bold text-white/50 hover:text-white/80 underline underline-offset-2"
            >
              Skip for tonight
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AttendanceStep({
  childrenList,
  parentsList,
  attendees,
  parentAttendees,
  guests,
  guestSuggestions,
  onToggleAttendee,
  onToggleParent,
  onAddGuest,
  onRemoveGuest,
  presentBy,
  presentTopic,
  onChangePresentBy,
  onChangePresentTopic,
}: {
  childrenList: Array<{ id: string; name: string; avatarEmoji?: string }>;
  parentsList: Array<{ uid: string; name: string; avatarEmoji?: string }>;
  attendees: Set<string>;
  parentAttendees: Set<string>;
  guests: Array<{ id: string; name: string; relationship?: string }>;
  /** People the family has had at past meetings — surfaced as one-tap
   *  chips so the parent doesn't have to retype Grandma every week. */
  guestSuggestions: Array<{ name: string; relationship?: string }>;
  onToggleAttendee: (kidId: string) => void;
  onToggleParent: (uid: string) => void;
  onAddGuest: (name: string, relationship?: string) => void;
  onRemoveGuest: (id: string) => void;
  presentBy: string;
  presentTopic: string;
  onChangePresentBy: (s: string) => void;
  onChangePresentTopic: (s: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestRel, setGuestRel] = useState<string>('Family Friend');
  const [otherRel, setOtherRel] = useState('');

  const commitGuest = () => {
    const name = guestName.trim();
    if (!name) return;
    const rel = guestRel === 'Other' ? (otherRel.trim() || 'Guest') : guestRel;
    onAddGuest(name, rel);
    setGuestName('');
    setOtherRel('');
    setGuestRel('Family Friend');
    setAdding(false);
  };

  const empty = childrenList.length === 0 && parentsList.length === 0;

  return (
    <div className="space-y-7">
      <section>
        <h3 className="font-display font-black text-base lg:text-lg text-kaya-gold-light mb-3 px-1">
          👥 Who is here tonight?
        </h3>
        {empty ? (
          <div className="bg-white/5 border border-white/10 rounded-kaya p-6 text-center text-white/60 text-sm">
            Add family members in <Link href="/profiles" className="underline">profiles</Link> to track attendance.
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Parents first */}
            {parentsList.map((p) => {
              const here = parentAttendees.has(p.uid);
              return (
                <button
                  type="button"
                  key={p.uid}
                  onClick={() => onToggleParent(p.uid)}
                  aria-pressed={here}
                  className={`flex items-center gap-3 p-4 rounded-kaya border transition-all text-left ${
                    here
                      ? 'bg-kaya-gold/15 border-kaya-gold/60 text-white'
                      : 'bg-white/5 border-white/10 text-white/45 hover:bg-white/10'
                  }`}
                >
                  <span className="text-3xl">{p.avatarEmoji || '👤'}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-display font-extrabold text-[14px] lg:text-base truncate">{p.name}</span>
                    <span className="block text-[10px] lg:text-[11px] mt-0.5 uppercase tracking-wider font-bold opacity-70">Parent</span>
                  </span>
                  <span className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-sm font-black ${
                    here ? 'bg-kaya-gold text-kaya-chocolate' : 'bg-white/10 text-white/40'
                  }`}>{here ? '✓' : ' '}</span>
                </button>
              );
            })}
            {/* Kids */}
            {childrenList.map((c) => {
              const here = attendees.has(c.id);
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => onToggleAttendee(c.id)}
                  aria-pressed={here}
                  className={`flex items-center gap-3 p-4 rounded-kaya border transition-all text-left ${
                    here
                      ? 'bg-kaya-gold/15 border-kaya-gold/60 text-white'
                      : 'bg-white/5 border-white/10 text-white/45 hover:bg-white/10'
                  }`}
                >
                  <span className="text-3xl">{c.avatarEmoji || '👧'}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-display font-extrabold text-[14px] lg:text-base truncate">{c.name}</span>
                    <span className="block text-[10px] lg:text-[11px] mt-0.5 uppercase tracking-wider font-bold opacity-70">Kid</span>
                  </span>
                  <span className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-sm font-black ${
                    here ? 'bg-kaya-gold text-kaya-chocolate' : 'bg-white/10 text-white/40'
                  }`}>{here ? '✓' : ' '}</span>
                </button>
              );
            })}
            {/* Guests (already added) */}
            {guests.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-3 p-4 rounded-kaya border bg-kaya-chocolate-light/40 border-kaya-gold/40 text-white text-left"
              >
                <span className="text-3xl">🧑</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-display font-extrabold text-[14px] lg:text-base truncate">{g.name}</span>
                  <span className="block text-[10px] lg:text-[11px] mt-0.5 uppercase tracking-wider font-bold opacity-70">
                    {g.relationship || 'Guest'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveGuest(g.id)}
                  aria-label={`Remove ${g.name}`}
                  className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-sm font-black bg-white/10 text-white/60 hover:bg-rose-500/30"
                >✕</button>
              </div>
            ))}
            {/* Suggestion tiles — past guests, one-tap re-add. */}
            {!adding && guestSuggestions.map((g) => (
              <button
                type="button"
                key={`sugg-${g.name}-${g.relationship || ''}`}
                onClick={() => onAddGuest(g.name, g.relationship)}
                className="flex items-center gap-3 p-4 rounded-kaya border border-dashed border-kaya-gold/40 bg-kaya-gold/5 text-white/85 hover:bg-kaya-gold/15 hover:border-kaya-gold/70 transition-all text-left"
              >
                <span className="text-3xl">🧑</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-display font-extrabold text-[14px] lg:text-base truncate">{g.name}</span>
                  <span className="block text-[10px] lg:text-[11px] mt-0.5 uppercase tracking-wider font-bold text-kaya-gold-light/80">
                    {g.relationship || 'Guest'} · tap to add
                  </span>
                </span>
                <span className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-sm font-black bg-kaya-gold/30 text-kaya-gold-light">＋</span>
              </button>
            ))}
            {/* Add guest tile */}
            {!adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex items-center justify-center gap-2 p-4 rounded-kaya border-2 border-dashed border-white/20 text-white/55 hover:text-white hover:border-white/40 transition-all font-display font-extrabold text-[14px] lg:text-base"
              >
                ＋ Add someone new
              </button>
            ) : (
              <div className="col-span-2 lg:col-span-3 bg-white/5 border border-white/10 rounded-kaya p-4 lg:p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-display font-extrabold text-[14px] text-kaya-gold-light">Add a guest</p>
                  <button type="button" onClick={() => setAdding(false)} className="text-[11px] font-bold text-white/55 hover:text-white">Cancel</button>
                </div>
                <input
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Name — e.g. Bibi Asha"
                  autoFocus
                  className="w-full h-11 lg:h-12 bg-white/10 border border-white/10 rounded-kaya-sm px-4 text-[14px] lg:text-base text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-kaya-gold/60"
                />
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-white/55 mb-2">Relationship</p>
                  <div className="flex flex-wrap gap-1.5">
                    {GUEST_RELATIONSHIPS.map((r) => (
                      <button
                        type="button"
                        key={r}
                        onClick={() => setGuestRel(r)}
                        aria-pressed={guestRel === r}
                        className={`px-3 py-1.5 rounded-kaya-sm font-display font-extrabold text-[11.5px] lg:text-[12px] transition-colors ${
                          guestRel === r
                            ? 'bg-kaya-gold text-kaya-chocolate'
                            : 'bg-white/5 text-white/60 hover:bg-white/15'
                        }`}
                      >{r}</button>
                    ))}
                  </div>
                  {guestRel === 'Other' && (
                    <input
                      value={otherRel}
                      onChange={(e) => setOtherRel(e.target.value)}
                      placeholder="Describe — e.g. Family pastor"
                      className="mt-2 w-full h-10 bg-white/10 border border-white/10 rounded-kaya-sm px-3 text-[13px] text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-kaya-gold/60"
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={commitGuest}
                  disabled={!guestName.trim()}
                  className="w-full h-11 lg:h-12 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-[13px] lg:text-sm transition-colors hover:bg-kaya-gold-dark disabled:opacity-40"
                >＋ Add to tonight's meeting</button>
              </div>
            )}
          </div>
        )}
        <p className="text-[11px] lg:text-[12px] text-white/40 mt-3 px-1">
          Household defaults to present — tap to mark absent. Add anyone else with “＋ Add attendee”.
        </p>
      </section>

      <section>
        <h3 className="font-display font-black text-base lg:text-lg text-kaya-gold-light mb-3 px-1">
          🎤 Anyone presenting tonight?
        </h3>
        <div className="bg-white/5 border border-white/10 rounded-kaya p-4 lg:p-5 space-y-3">
          <div>
            <label className="block text-[12px] lg:text-[13px] font-bold text-white/70 mb-1.5">
              Who is presenting?
            </label>
            <input
              value={presentBy}
              onChange={(e) => onChangePresentBy(e.target.value)}
              placeholder="Name (or leave blank if no one)"
              className="w-full h-11 lg:h-12 bg-white/10 border border-white/10 rounded-kaya-sm px-4 text-[14px] lg:text-base text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-kaya-gold/60"
            />
          </div>
          <div>
            <label className="block text-[12px] lg:text-[13px] font-bold text-white/70 mb-1.5">
              What's the topic?
            </label>
            <input
              value={presentTopic}
              onChange={(e) => onChangePresentTopic(e.target.value)}
              placeholder="One line — e.g. 'My school project on bees'"
              className="w-full h-11 lg:h-12 bg-white/10 border border-white/10 rounded-kaya-sm px-4 text-[14px] lg:text-base text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-kaya-gold/60"
            />
          </div>
        </div>
        <p className="text-[11px] lg:text-[12px] text-white/40 mt-2 px-1">
          Skip if no presentation tonight — totally optional.
        </p>
      </section>
    </div>
  );
}

// ── Goals Review (multi-week) ──────────────────────────────────────
// Surfaces outstanding goals from up to N recent meetings. Each goal
// has a ✓ toggle that, on finish, writes back to its source meeting's
// `goalsDone` map (so a goal set three weeks ago can be reviewed and
// closed tonight). Once a goal is marked done, it stays done forever
// — but visible here until the family stops caring (the source meeting
// drops off the recent-N window).
function GoalsStep({
  childrenList,
  submissions,
  roster,
  recentMeetings,
  reviewedGoalsDone,
  onToggleHistoricalGoalDone,
  goals,
  onChangeGoals,
  pinkyPromised,
  onTogglePinky,
}: {
  childrenList: Array<{ id: string; name: string; avatarEmoji?: string }>;
  submissions: MeetingSubmission[];
  roster: PrepMember[];
  recentMeetings: Meeting[];
  reviewedGoalsDone: Record<string, Record<string, boolean>>;
  onToggleHistoricalGoalDone: (meetingId: string, kidId: string, done: boolean) => void;
  goals: Record<string, string>;
  onChangeGoals: (next: Record<string, string>) => void;
  /** 🤝 Pinky-Promise (v4): childIds sealed this meeting + a toggle. */
  pinkyPromised: Set<string>;
  onTogglePinky: (kidId: string) => void;
}) {
  // Resolve effective done state — local toggle wins; otherwise fall
  // back to whatever the meeting already had stored. v2 uses
  // `goalsDone` on the meeting that holds the goal; v1 stored
  // `lastWeekGoalsDone` on the *next* meeting — handle both so families
  // who shipped a v1 meeting still see their progress.
  const v1NextMeetingDoneFor = (meetingIdx: number, kidId: string): boolean | undefined => {
    const nextMeeting = recentMeetings[meetingIdx - 1]; // newer
    return nextMeeting?.lastWeekGoalsDone?.[kidId];
  };
  const effectiveDone = (meetingIdx: number, kidId: string): boolean => {
    const meeting = recentMeetings[meetingIdx];
    const localToggle = reviewedGoalsDone[meeting.id]?.[kidId];
    if (typeof localToggle === 'boolean') return localToggle;
    if (typeof meeting.goalsDone?.[kidId] === 'boolean') return !!meeting.goalsDone[kidId];
    const v1 = v1NextMeetingDoneFor(meetingIdx, kidId);
    if (typeof v1 === 'boolean') return v1;
    return false;
  };

  // Build the visible list — meetings with at least one outstanding
  // (or already-done) goal. Order: most-recent first.
  const goalsByMeeting = recentMeetings
    .map((m, i) => ({
      meeting: m,
      index: i,
      kids: childrenList
        .map((c) => ({ child: c, goal: (m.goals?.[c.id] || '').trim() }))
        .filter((row) => row.goal.length > 0),
    }))
    .filter((entry) => entry.kids.length > 0);

  // Label for a meeting block ("Last week", "2 weeks ago", date).
  const label = (i: number, dateStr: string) => {
    if (i === 0) return 'Last week';
    if (i === 1) return '2 weeks ago';
    if (i === 2) return '3 weeks ago';
    return dateStr;
  };

  // 🔥 Streak Flames (v4) — consecutive most-recent weeks a kid KEPT a goal.
  // Walks the newest-first goal history; updates live as goals are ticked.
  const streakFor = (kidId: string): number => {
    let n = 0;
    for (const { index, kids } of goalsByMeeting) {
      if (!kids.some((k) => k.child.id === kidId)) continue; // no goal that week → skip
      if (effectiveDone(index, kidId)) n += 1; else break;
    }
    return n;
  };

  // ⚡ Family Combo (v4) — fraction of LAST week's goals ticked done this
  // round. 100% = everyone kept their goal → a family-wide celebration.
  const lastWeek = goalsByMeeting[0];
  const comboTotal = lastWeek ? lastWeek.kids.length : 0;
  const comboDone = lastWeek ? lastWeek.kids.filter((k) => effectiveDone(lastWeek.index, k.child.id)).length : 0;
  const comboPct = comboTotal ? Math.round((comboDone / comboTotal) * 100) : 0;
  const comboComplete = comboTotal > 0 && comboDone === comboTotal;

  // 🤝 Pinky-Promise (v4) — kids who committed a goal this week can seal it.
  const committedKids = childrenList.filter((c) =>
    (goals[c.id] || '').trim().length > 0
    || (submissions.find((s) => s.childId === c.id)?.goals || []).some((g) => g.trim()));

  return (
    <div className="space-y-7">
      <style>{`
        @keyframes gr-flick { 0%,100%{transform:scale(1) rotate(-3deg)} 50%{transform:scale(1.14) rotate(3deg)} }
        @keyframes gr-twinkle { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.18);opacity:.8} }
        @keyframes gr-pop { 0%{transform:scale(.4);opacity:0} 60%{transform:scale(1.15);opacity:1} 100%{transform:scale(1)} }
      `}</style>
      {/* 🔍 Self-reflection summary — who pre-marked their prior goals?
          Shows each submission's goalsReflection so the family sees how
          everyone felt BEFORE the meeting (no tick interaction needed). */}
      {submissions.some((s) => s.goalsReflection && s.goalsReflection.length > 0) && (
        <section className="mb-2">
          <h3 className="font-display font-black text-base lg:text-lg text-kaya-gold-light mb-1 px-1">
            🔍 Self-reflection — before tonight
          </h3>
          <p className="text-[11px] text-white/45 mb-3 px-1">
            How each person felt about last week&apos;s goals, filled in before the meeting.
          </p>
          <div className="space-y-3">
            {submissions
              .filter((s) => s.goalsReflection && s.goalsReflection.length > 0)
              .map((s) => (
                <div key={s.uid} className="bg-white/5 border border-white/10 rounded-kaya p-3 lg:p-4">
                  <p className="text-[11px] lg:text-[12px] font-extrabold text-white/70 mb-2">
                    {s.emoji || '🧒'} {s.name}
                  </p>
                  <div className="space-y-2">
                    {(s.goalsReflection || []).map((r, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className={`mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black ${
                          r.done ? 'bg-emerald-500 text-white' : 'bg-white/15 text-white/30'
                        }`}>
                          {r.done ? '✓' : '·'}
                        </span>
                        <div className="min-w-0">
                          <span className={`text-[13px] lg:text-sm leading-snug ${r.done ? 'text-emerald-300 line-through decoration-emerald-500/50' : 'text-white/70'}`}>
                            {r.text}
                          </span>
                          {r.note && (
                            <p className="mt-0.5 text-[12px] lg:text-[12.5px] italic text-kaya-gold-light/90 border-l-2 border-kaya-gold/50 pl-2">
                              “{r.note}”
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* ① This week — our commitments (forward-looking, shown FIRST per
          Elia). Read from each member's prep submission (live-synced),
          with a "still to set" nudge + optional in-meeting capture. */}
      <section>
        <StepSubmissions
          section="goals"
          submissions={submissions}
          roster={roster}
          liveValues={goals}
          onChangeLive={(id, v) => onChangeGoals({ ...goals, [id]: v })}
          placeholder="This week I want to…"
          filledHeader="🎯 This week — our commitments"
          missingHeader="Still to set this week"
        />
        <p className="text-[11px] lg:text-[12px] text-white/40 mt-3 px-1">
          Keep it small and specific — "read every night before bed" beats "do better at school."
        </p>

        {/* 🤝 Pinky-Promise — seal a commitment; next week we see if we kept it. */}
        {committedKids.length > 0 && (
          <div className="mt-4 rounded-kaya-lg border border-white/10 bg-white/5 p-4">
            <p className="font-display font-black text-[13px] lg:text-sm text-kaya-gold-light mb-0.5">🤝 Seal it with a pinky promise</p>
            <p className="text-[11px] text-white/45 mb-3">A promise made tonight — next week Kaya remembers who pinky-promised.</p>
            <div className="flex flex-wrap gap-2">
              {committedKids.map((c) => {
                const sealed = pinkyPromised.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onTogglePinky(c.id)}
                    aria-pressed={sealed}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-display font-extrabold border transition-colors ${
                      sealed
                        ? 'bg-kaya-gold text-kaya-chocolate border-kaya-gold'
                        : 'bg-white/5 text-white/70 border-white/15 hover:bg-white/10'
                    }`}
                  >
                    <span style={sealed ? { animation: 'gr-pop .5s ease-out' } : undefined}>{sealed ? '🤝' : '🤙'}</span>
                    <span>{c.avatarEmoji || '🧒'} {c.name}</span>
                    {sealed && <span className="text-[10px] uppercase tracking-wide">· promised</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ② Last week — tick what's done. Ticked goals are saved done (and
          land in history); unticked ones carry forward to next week,
          flagged with ↻. */}
      {goalsByMeeting.length > 0 && (
        <section>
          <h3 className="font-display font-black text-base lg:text-lg text-kaya-gold-light mb-1 px-1">
            ✅ Last week — tick what's done
          </h3>
          <p className="text-[11px] text-white/45 mb-3 px-1">
            Unticked goals <span className="font-bold text-amber-300">↻ carry</span> into next week so nothing drops.
          </p>

          {/* ⚡ Family Combo Meter — climbs as last week's goals get ticked. */}
          {comboTotal > 0 && (
            <div className={`mb-4 rounded-kaya-lg border p-4 transition-colors ${comboComplete ? 'border-kaya-gold bg-kaya-gold/10' : 'border-white/10 bg-white/5'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-display font-black text-[13px] lg:text-sm text-kaya-gold-light">⚡ Family Combo</span>
                <span className="font-display font-black text-[13px] text-white/70">{comboDone} / {comboTotal} kept</span>
              </div>
              <div className="h-4 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${comboPct}%`,
                    background: comboComplete
                      ? 'linear-gradient(90deg,#5BA88C,#D4A017)'
                      : 'linear-gradient(90deg,#5BA88C,#9BB36A)',
                  }}
                />
              </div>
              {comboComplete && (
                <p className="mt-2 text-center font-display font-black text-sm text-kaya-gold-light" style={{ animation: 'gr-pop .6s ease-out' }}>
                  ⚡ FAMILY COMBO! Everyone kept their goal 🎉
                </p>
              )}
            </div>
          )}

          <div className="space-y-5">
            {goalsByMeeting.map(({ meeting, index, kids }) => (
              <div key={meeting.id} className="bg-white/5 border border-white/10 rounded-kaya-lg p-4 lg:p-5">
                <p className="text-[10px] lg:text-[11px] uppercase tracking-[0.2em] font-bold text-white/50 mb-3">
                  {label(index, meeting.date)} · {meeting.date}
                </p>
                <div className="space-y-2">
                  {kids.map(({ child, goal }) => {
                    const done = effectiveDone(index, child.id);
                    const streak = done ? streakFor(child.id) : 0;
                    // 🌟 Comeback Star — an OLD goal (2+ weeks ago) finally done.
                    const comeback = done && index >= 1;
                    // 🤝 Pinky-Promise — was this goal sealed when it was set?
                    const wasPromised = (meeting.pinkyPromised || []).includes(child.id);
                    return (
                      <div
                        key={child.id}
                        className={`border rounded-kaya p-3 lg:p-4 flex items-start gap-3 transition-colors ${
                          comeback ? 'bg-kaya-gold/10 border-kaya-gold/40' : 'bg-white/5 border-white/10'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onToggleHistoricalGoalDone(meeting.id, child.id, !done)}
                          aria-label={done ? `Mark ${child.name}'s goal not done` : `Mark ${child.name}'s goal done`}
                          className={`w-9 h-9 lg:w-10 lg:h-10 rounded-full shrink-0 flex items-center justify-center text-base lg:text-lg font-black transition-colors ${
                            done
                              ? 'bg-kaya-gold text-kaya-chocolate'
                              : 'bg-white/10 text-white/40 hover:bg-white/20'
                          }`}
                        >
                          {done ? '✓' : ' '}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-[13px] lg:text-base font-display font-extrabold">
                            <span className="text-xl">{child.avatarEmoji || '👧'}</span>
                            <span>{child.name}</span>
                            {/* 🔥 Streak Flames */}
                            {streak >= 1 && (
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-black text-kaya-gold-light bg-kaya-gold/15 rounded-full px-2 py-0.5"
                                title={`${streak} week${streak === 1 ? '' : 's'} in a row`}
                              >
                                <span style={{ animation: 'gr-flick 1.4s ease-in-out infinite' }}>
                                  {streak >= 5 ? '🏆' : '🔥'}
                                </span>
                                {streak}
                              </span>
                            )}
                            {!done && (
                              <span className="ml-auto text-[9px] font-extrabold uppercase tracking-wide text-amber-300 bg-amber-400/15 rounded-full px-2 py-0.5">
                                ↻ carries
                              </span>
                            )}
                          </div>
                          <p className={`mt-1 text-[14px] lg:text-base leading-snug ${done ? 'text-white/50 line-through' : 'text-white/85'}`}>
                            {goal}
                          </p>
                          {/* 🤝 Pinky-Promise callback — the ribbon + "kept!" beat */}
                          {wasPromised && (
                            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-kaya-gold/15 border border-kaya-gold/30 px-2.5 py-1 text-[11px] font-extrabold text-kaya-gold-light">
                              🤝 {done ? 'Pinky promise kept! 🎉' : 'You pinky-promised this'}
                            </div>
                          )}
                          {/* 🌟 Comeback Star — persistence pays off */}
                          {comeback && (
                            <div className="mt-2 flex items-center gap-2" style={{ animation: 'gr-pop .6s ease-out' }}>
                              <span className="text-lg" style={{ animation: 'gr-twinkle 2.4s ease-in-out infinite' }}>🌟</span>
                              <span className="text-[11.5px] font-black text-kaya-gold-light">
                                Comeback Star — {index + 1} weeks in the making, you never gave up!
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Closing Reflection (multi-select) ──────────────────────────────
// Parents pick ONE or ALL of Story / Songs / Prayer. Each picked mode
// shows its own input on the same screen, so a family who wants both
// a story and a closing prayer doesn't have to choose between them.
// Prayer keeps its "Say & celebrate" button which triggers the full-
// screen typeset stage + flowers cascade.
// Closing Reflection — execute mode.
//
// What parents enabled in /settings/meetings runs automatically here.
// No chooser, no "pick on the night" UX — every enabled closing renders
// its own card stacked vertically, primed with the saved content
// (prayer from library, song link, story text from setup) so the
// meeting just flows.
function ReflectionStep({
  enabledModes,
  contents,
  onContentChange,
  onCelebratePrayer,
  prayerLibraryCount,
  viewerUid,
  kidSongLinkRequiresApproval,
  songLinkApprovedBy,
  songPreApproved,
  onApproveSongLink,
  familyId,
  viewerName,
}: {
  /** Which of the 3 closings the parent enabled in /settings/meetings.
   *  Disabled modes simply don't render. */
  enabledModes: ReflectionMode[];
  contents: Partial<Record<ReflectionMode, string>>;
  onContentChange: (mode: ReflectionMode, value: string) => void;
  onCelebratePrayer: () => void;
  /** How many prayers live in the family's library — drives the
   *  "Library preloaded" hint on the Prayer input. */
  prayerLibraryCount: number;
  /** Sunday-Meeting v2 (b5): kid-attached song approval. Defaults are
   *  conservative — if any of these are missing or off, the play
   *  button works as before with no gate. */
  viewerUid?: string;
  kidSongLinkRequiresApproval?: boolean;
  songLinkApprovedBy?: string | null;
  /** v4.5 — today's pick is already approved (parent-set / gate off / a
   *  parent OK'd it). When false, show the approve prompt to anyone running
   *  the meeting (not just the kid). */
  songPreApproved?: boolean;
  onApproveSongLink?: (uid: string) => void;
  /** v4 song library — the reveal saves the played song + lets the family rate it. */
  familyId?: string;
  viewerName?: string;
}) {
  // v4.4: keep the pre-set song link HIDDEN behind the reveal (a surprise,
  // not a long URL). A subtle "Change song" toggle re-opens the input.
  const [editSong, setEditSong] = useState(false);
  const allChoices: Array<{ id: ReflectionMode; emoji: string; title: string; sub: string }> = [
    { id: 'story',  emoji: '📖', title: 'Inspiring Story', sub: 'Paste a story, a verse, or a link to read together.' },
    { id: 'songs',  emoji: '🎵', title: 'Songs',            sub: 'Paste a YouTube / Spotify link to open in a new tab.' },
    { id: 'prayer', emoji: '🙏', title: 'Family Prayer',    sub: 'Pre-loaded from your library — edit freely.' },
  ];
  const choices = allChoices.filter((c) => enabledModes.includes(c.id));

  if (choices.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-kaya-lg p-8 text-center text-white/70">
        <div className="text-4xl mb-3">✨</div>
        <p className="font-display font-extrabold text-lg mb-2">No closings enabled</p>
        <p className="text-[13px] text-white/55 mb-4">Pick at least one closing in <Link href="/settings/meetings" className="underline">Meeting Setup</Link> — Story, Songs, or Family Prayer.</p>
      </div>
    );
  }

  const placeholderFor = (m: ReflectionMode) =>
    m === 'story' ? 'Paste a story, a verse, or a link…' :
    m === 'songs' ? 'Paste a YouTube or Spotify link…' :
                    'Pre-loaded from your library. Edit, or paste a different prayer.';

  return (
    <div className="space-y-5">
      <div className="text-center mb-2">
        <p className="text-[10px] lg:text-[11px] uppercase tracking-[0.2em] font-bold text-kaya-gold-light/80">
          Tonight's closing · {choices.length === 1 ? choices[0].title : `${choices.length} reflections`}
        </p>
      </div>
      {choices.map((c) => {
        const content = contents[c.id] || '';
        const isPrayer = c.id === 'prayer';
        const isSongs = c.id === 'songs';
        const isStory = c.id === 'story';
        const isLink = (isSongs || isStory) && content.trim().startsWith('http');
        const ctaLabel = isSongs ? '▶ Play in new tab' : '🔗 Open link';
        // v4.5 — a kid-set song needs a parent's OK. Shown to WHOEVER runs
        // the meeting (not just the kid) so it's never stuck.
        const needsApproval = isSongs && isLink
          && (kidSongLinkRequiresApproval ?? true)
          && !songPreApproved
          && !songLinkApprovedBy;
        return (
          <div key={c.id} className="bg-white/5 border border-white/10 rounded-kaya-lg p-5 lg:p-6">
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span className="text-2xl lg:text-3xl">{c.emoji}</span>
              <h4 className="font-display font-black text-lg lg:text-xl text-kaya-gold-light">
                {c.title}
              </h4>
              {isPrayer && prayerLibraryCount > 0 && (
                <span className="text-[9px] lg:text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full bg-kaya-gold/20 text-kaya-gold-light">
                  Library · {prayerLibraryCount} saved
                </span>
              )}
              {isPrayer && (
                <span className="ml-auto text-[9px] lg:text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full bg-white/10 text-white/50">
                  AI assist · Soon
                </span>
              )}
            </div>
            {/* For Songs with a link set, HIDE the raw URL (keep the
                surprise) — show a "song is ready" chip + a quiet Change. */}
            {isSongs && isLink && !editSong ? (
              <div className="flex items-center gap-2 rounded-kaya-sm bg-white/5 border border-white/10 px-4 py-3">
                <span className="text-lg">{needsApproval ? '🛡️' : '🎁'}</span>
                <span className="flex-1 text-[13px] lg:text-sm text-white/70 font-bold">
                  {needsApproval
                    ? 'A song is set — waiting for a parent’s OK (below).'
                    : 'Tonight’s song is set — it’s a surprise! Tap reveal below.'}
                </span>
                <button
                  type="button"
                  onClick={() => setEditSong(true)}
                  className="shrink-0 text-[11px] font-extrabold text-kaya-gold-light/80 hover:text-kaya-gold-light underline underline-offset-2"
                >
                  ✎ Change
                </button>
              </div>
            ) : (
              <textarea
                value={content}
                onChange={(e) => onContentChange(c.id, e.target.value)}
                placeholder={placeholderFor(c.id)}
                rows={isPrayer ? 7 : 4}
                className="w-full bg-white/10 border border-white/10 rounded-kaya-sm px-4 py-3 text-[14px] lg:text-base text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-kaya-gold/60 resize-none leading-relaxed"
              />
            )}

            {isPrayer && (
              <button
                type="button"
                onClick={onCelebratePrayer}
                disabled={!content.trim()}
                className="mt-4 w-full h-12 lg:h-14 rounded-kaya bg-gradient-to-br from-kaya-gold to-kaya-gold-dark hover:brightness-110 text-kaya-chocolate font-display font-extrabold text-base lg:text-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                🙏 Say the prayer
              </button>
            )}

            {(isSongs || isStory) && (() => {
              // Song-link approval gate. Story mode is exempt. v4.5: the gate
              // keys off the pick's approval state (songPreApproved), so the
              // approve prompt shows to whoever runs the meeting — not only
              // the kid — and a parent can OK it on the spot.
              const playable = isLink && !needsApproval;
              if (playable) {
                // 🎵 Songs open as a SURPRISE — a 5-4-3-2-1 countdown, then
                // the link opens. Story just opens in a new tab.
                if (isSongs) {
                  return (
                    <SongReveal
                      url={content.trim()}
                      approved={!!songLinkApprovedBy}
                      familyId={familyId}
                      viewerUid={viewerUid}
                      viewerName={viewerName}
                    />
                  );
                }
                return (
                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    <a
                      href={content.trim()}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-2 h-11 lg:h-12 px-5 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-[13px] lg:text-sm transition-colors"
                    >
                      {ctaLabel}
                    </a>
                  </div>
                );
              }
              if (needsApproval) {
                return (
                  <div className="mt-4 rounded-kaya bg-amber-500/10 border border-amber-400/40 p-3">
                    <p className="text-[12.5px] text-amber-100 font-bold">
                      🛡️ Awaiting a parent OK — the family asked Kaya to check kid-attached songs.
                    </p>
                    <button
                      type="button"
                      onClick={() => onApproveSongLink && viewerUid && onApproveSongLink(viewerUid)}
                      disabled={!onApproveSongLink || !viewerUid}
                      className="mt-2 inline-flex items-center gap-2 h-10 px-4 rounded-kaya-sm bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold text-[12.5px] transition-colors disabled:opacity-50"
                    >
                      ✓ I&apos;m a parent — approve
                    </button>
                    <p className="mt-2 text-[10.5px] text-white/50">
                      Tap from a parent&apos;s phone, or hand the device over for one tap.
                    </p>
                  </div>
                );
              }
              return (
                <p className="mt-3 text-[11px] lg:text-[12px] text-white/40">
                  {isSongs
                    ? 'Paste a YouTube or Spotify URL to enable the play button.'
                    : 'Paste a link to open it in a new tab, or just read the text together.'}
                </p>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

// 🎵 Song Reveal — 5-4-3-2-1 countdown then opens YouTube/Spotify as a
// SURPRISE moment during the Songs closing.
// States:
//   idle      → "🎵 Reveal today's song" button
//   counting  → large animated digits 5→4→3→2→1 (1 s each)
//   open      → "▶ Now playing — enjoy!" + a reopen link
// The URL opens in a new tab at the end of the countdown.
function SongReveal({ url, approved, familyId, viewerUid, viewerName }: {
  url: string; approved: boolean;
  familyId?: string; viewerUid?: string; viewerName?: string;
}) {
  const [phase, setPhase] = useState<'idle' | 'counting' | 'open'>('idle');
  const [count, setCount] = useState(5);
  const [songId, setSongId] = useState<string | null>(null);
  const [myRating, setMyRating] = useState(0);
  const embed = useMemo(() => resolveSongEmbed(url, { autoplay: true }), [url]);

  const startCountdown = () => {
    setPhase('counting');
    setCount(5);
    let c = 5;
    const iv = setInterval(() => {
      c -= 1;
      if (c <= 0) {
        clearInterval(iv);
        // Not embeddable → keep the old behaviour (open in a new tab).
        if (!embed.embeddable) window.open(url, '_blank', 'noopener,noreferrer');
        setPhase('open');
        // Save to the family song library + mark it PLAYED so every member
        // gets a post-meeting "rate it" prompt (best-effort).
        if (familyId) {
          upsertSong(familyId, { url, addedByName: viewerName, addedByUid: viewerUid })
            .then((id) => { setSongId(id); return markSongRevealed(familyId, id); })
            .catch(() => {});
        }
      } else {
        setCount(c);
      }
    }, 1000);
  };

  const rate = (n: number) => {
    setMyRating(n);
    if (familyId && songId && viewerUid) rateSong(familyId, songId, viewerUid, n).catch(() => {});
  };

  if (phase === 'idle') {
    return (
      <div className="mt-5 flex flex-col items-center gap-3">
        {approved && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 text-[10.5px] font-extrabold uppercase tracking-wider">
            ✓ Parent OK
          </span>
        )}
        <button
          type="button"
          onClick={startCountdown}
          className="h-14 px-8 rounded-kaya bg-gradient-to-br from-kaya-gold to-kaya-gold-dark hover:brightness-110 text-kaya-chocolate font-display font-extrabold text-base lg:text-lg transition-all shadow-lg shadow-kaya-gold/30 animate-pulse-slow"
        >
          🎵 Reveal today&apos;s song
        </button>
        <p className="text-[11px] text-white/40">Tap to begin the countdown — a surprise is waiting!</p>
      </div>
    );
  }

  if (phase === 'counting') {
    return (
      <div className="mt-5 flex flex-col items-center gap-4">
        <p className="text-[11px] uppercase tracking-widest font-bold text-kaya-gold-light/70">Playing in…</p>
        <div
          key={count}
          className="text-[7rem] lg:text-[9rem] font-display font-black text-kaya-gold leading-none"
          style={{ animation: 'pingOnce 0.9s ease-out forwards' }}
        >
          {count}
        </div>
        <p className="text-[12px] text-white/50">Get ready — the song is about to start! 🎶</p>
        <style>{`
          @keyframes pingOnce {
            0%   { transform: scale(1.5); opacity: 0; }
            30%  { transform: scale(1);   opacity: 1; }
            85%  { transform: scale(1);   opacity: 1; }
            100% { transform: scale(0.8); opacity: 0; }
          }
        `}</style>
      </div>
    );
  }

  // open — play inline (embeddable) or confirm the new-tab open (fallback)
  return (
    <div className="mt-5 flex flex-col items-center gap-3">
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-kaya-gold text-kaya-chocolate text-[10.5px] font-display font-black uppercase tracking-wider">
        <span className="w-2 h-2 rounded-full bg-red-700 animate-pulse" /> Now Playing
      </span>

      {embed.embeddable ? (
        <div className="w-full max-w-[520px] rounded-kaya-lg overflow-hidden border border-kaya-gold/40 shadow-[0_14px_30px_-8px_rgba(212,160,23,0.6)] bg-black">
          <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
            <iframe
              src={embed.embedUrl as string}
              title="Closing song"
              className="absolute inset-0 w-full h-full"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className="text-5xl">🎶</div>
          <p className="font-display font-extrabold text-xl text-kaya-gold-light">Now playing in a new tab — enjoy!</p>
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 h-11 px-5 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-[13px] transition-colors"
          >
            🎵 Open again
          </a>
        </div>
      )}

      {/* ⭐ rate it — feeds the Song Library ranking */}
      <div className="flex items-center gap-3 mt-1">
        <span className="text-[12px] text-white/60 font-bold">Love it? Rate it</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => rate(n)}
              aria-label={`Rate ${n} stars`}
              className={`text-[26px] leading-none transition-transform hover:scale-110 ${n <= myRating ? 'text-kaya-gold' : 'text-white/25'}`}
            >★</button>
          ))}
        </div>
      </div>
      {myRating > 0 && (
        <p className="text-[11.5px] text-kaya-gold-light/80 font-bold">✓ Saved to your 🎵 Song Library</p>
      )}
    </div>
  );
}

// 📅 On This Day banner (v4.2 surprise) — a warm "remember when" memory
// surfaced at the very start of the meeting from a past meeting on today's
// day-of-month. Pure presentational; the memory is computed upstream.
function OnThisDayBanner({ memory }: {
  memory: { who: string; line: string; kind: 'goal' | 'grateful' | 'appreciate'; done: boolean; dateLabel: string };
}) {
  const lead = memory.kind === 'goal'
    ? `${memory.dateLabel}, ${memory.who} set this goal…`
    : memory.kind === 'appreciate'
      ? `${memory.dateLabel}, ${memory.who} appreciated…`
      : `${memory.dateLabel}, ${memory.who} was thankful for…`;
  return (
    <div
      className="mb-4 rounded-kaya-lg border border-kaya-gold/30 p-4 lg:p-5"
      style={{ background: 'linear-gradient(180deg, rgba(245,230,184,.10), rgba(255,255,255,.02))', animation: 'gr-pop .6s ease-out' }}
    >
      <style>{`@keyframes gr-pop{0%{opacity:0;transform:translateY(8px) scale(.98)}60%{opacity:1;transform:translateY(0) scale(1.01)}100%{transform:scale(1)}}`}</style>
      <p className="text-[10px] lg:text-[11px] uppercase tracking-[0.2em] font-bold text-kaya-gold-light/80">📅 On this day</p>
      <p className="mt-1 text-[12.5px] lg:text-sm text-white/60">{lead}</p>
      <p className="mt-1 text-[15px] lg:text-lg font-display font-extrabold text-white/90 leading-snug">
        &ldquo;{memory.line}&rdquo;
      </p>
      {memory.kind === 'goal' && memory.done && (
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-extrabold text-emerald-300">
          ✅ …and you DID it!
        </p>
      )}
    </div>
  );
}

// 🏆 Family Anthem of the Year (v4.2 surprise) — crowns the family's top
// Song Library track (by rating, then plays) in the Closing step, turning
// months of ⭐ ratings into a shared family hymn. Client-side over the
// already-stored library; renders nothing until a song earns it.
function AnthemCard({ familyId }: { familyId: string }) {
  const [anthem, setAnthem] = useState<SongLibraryEntry | null>(null);
  useEffect(() => {
    if (!familyId) return;
    let cancelled = false;
    getSongLibrary(familyId)
      .then((rows) => {
        if (cancelled) return;
        // rows arrive sorted top-rated → top-played. Crown #1 once it has
        // earned it (any rating, or played more than once).
        const top = rows[0];
        if (top && (top.ratingCount > 0 || (top.playCount || 0) > 1)) setAnthem(top);
      })
      .catch(() => { /* offline — skip */ });
    return () => { cancelled = true; };
  }, [familyId]);

  if (!anthem) return null;
  const title = anthem.title?.trim()
    || (anthem.provider === 'youtube' ? 'our YouTube song' : anthem.provider === 'spotify' ? 'our Spotify track' : 'our family song');
  return (
    <div
      className="mb-5 rounded-kaya-lg border border-kaya-gold/40 p-5 text-center"
      style={{ background: 'radial-gradient(420px 200px at 50% 0%, rgba(212,160,23,.18), transparent 70%)', boxShadow: '0 14px 30px -10px rgba(212,160,23,.5)', animation: 'gr-pop .6s ease-out' }}
    >
      <div className="text-4xl" style={{ filter: 'drop-shadow(0 4px 10px rgba(212,160,23,.6))' }}>🏆</div>
      <p className="mt-1 text-[10px] uppercase tracking-[0.2em] font-bold text-kaya-gold-light/80">This year&apos;s Family Anthem</p>
      <p className="mt-1 font-display font-black text-xl text-kaya-gold-light leading-tight">{title}</p>
      <p className="mt-1 text-[12.5px] text-white/60">
        {anthem.ratingCount > 0 ? `⭐ ${anthem.avgRating.toFixed(1)} · ` : ''}played {anthem.playCount || 1}×
      </p>
      <a
        href={anthem.url}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-3 inline-flex items-center gap-2 h-10 px-5 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-[12.5px] transition-colors"
      >
        🎵 Play our anthem
      </a>
    </div>
  );
}

// "Kaya Kaya!" celebration — replaces the flat ✅ splash with a
// proper send-off for a weekly ritual. Layered effects:
//   - radial gold glow background
//   - 36 falling flowers (reuses FlowersDrop)
//   - scale-up + soft pulse on the wordmark
//   - emoji sparkles dotted around the canvas with a twinkle animation
//   - "Back to home" CTA visible from the start; ESC / tap exits early
// Kid-pleasing send-off. Multiple layers fire at once:
//   - radial gold glow that pulses behind the wordmark
//   - twinkling sparkles dotted around the canvas
//   - 6 CSS firework bursts (concentric particle radials, no canvas)
//   - the existing flowers cascade
//   - "Kaya Kaya!" wordmark pop-in
// Auto-closes after 7s so the family can soak it in but doesn't get
// stuck on the splash; "Back to Meetings" CTA always visible.
function FinishedSplash({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 7000);
    return () => clearTimeout(t);
  }, [onClose]);

  // Firework burst positions + colors + timings. Each burst renders 12
  // particles radiating outward from its centre. Random-ish but laid
  // out to feel balanced across the canvas.
  const fireworks = useMemo(() => ([
    { id: 'fw1', cx: '18%', cy: '24%', color: '#F5E6B8', delay: '0ms'    },
    { id: 'fw2', cx: '82%', cy: '18%', color: '#F39C2F', delay: '450ms'  },
    { id: 'fw3', cx: '30%', cy: '70%', color: '#FF6B9D', delay: '900ms'  },
    { id: 'fw4', cx: '74%', cy: '64%', color: '#5BA88C', delay: '1350ms' },
    { id: 'fw5', cx: '50%', cy: '12%', color: '#D4A017', delay: '1800ms' },
    { id: 'fw6', cx: '50%', cy: '82%', color: '#FCD9A0', delay: '2250ms' },
  ]), []);

  return (
    <div className="relative flex flex-col items-center justify-center py-10 lg:py-14 overflow-visible min-h-[60vh]">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes kaya-pop-in {
              0%   { opacity:0; transform:scale(.6) translateY(20px); }
              60%  { opacity:1; transform:scale(1.08) translateY(-4px); }
              100% { opacity:1; transform:scale(1) translateY(0); }
            }
            @keyframes kaya-glow {
              0%,100% { opacity:.55; transform:scale(1); }
              50%     { opacity:.95; transform:scale(1.08); }
            }
            @keyframes kaya-twinkle {
              0%,100% { opacity:0; transform:scale(.5) rotate(0deg); }
              50%     { opacity:1; transform:scale(1.3) rotate(180deg); }
            }
            @keyframes kaya-wordmark-pulse {
              0%,100% { transform:scale(1); }
              50%     { transform:scale(1.04); }
            }
            /* Firework — each particle starts at centre and translates
               outward to (--dx, --dy) while fading. Reused for all 12
               particles per burst with --i = 0..11 driving the angle. */
            @keyframes kaya-firework {
              0%   { opacity:0;  transform:translate(0,0) scale(.4); }
              15%  { opacity:1;  }
              100% { opacity:0;  transform:translate(var(--dx), var(--dy)) scale(1); }
            }
            .kaya-pop { animation: kaya-pop-in 700ms cubic-bezier(.2,1.2,.4,1) both; }
            .kaya-pop-delay-1 { animation-delay: 250ms; }
            .kaya-pop-delay-2 { animation-delay: 600ms; }
            .kaya-glow { animation: kaya-glow 2400ms ease-in-out infinite; }
            .kaya-twinkle { animation: kaya-twinkle 2200ms ease-in-out infinite; }
            .kaya-wordmark { animation: kaya-pop-in 700ms cubic-bezier(.2,1.2,.4,1) both, kaya-wordmark-pulse 2200ms ease-in-out 800ms infinite; }
            .kaya-firework-burst {
              position: absolute;
              width: 0; height: 0;
              pointer-events: none;
            }
            .kaya-firework-particle {
              position: absolute;
              top: 0; left: 0;
              width: 8px; height: 8px;
              border-radius: 50%;
              animation: kaya-firework 1500ms ease-out forwards;
              box-shadow: 0 0 8px currentColor;
            }
          `,
        }}
      />

      {/* Radial gold glow */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none kaya-glow"
        style={{
          background: 'radial-gradient(circle at center, rgba(212,160,23,.5) 0%, rgba(212,160,23,.18) 30%, transparent 60%)',
        }}
      />

      {/* Twinkling sparkles dotted around the canvas */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        {[
          { glyph: '✨', t: '8%',  l: '12%', d: '0ms',   s: 28 },
          { glyph: '🎊', t: '18%', l: '78%', d: '400ms', s: 30 },
          { glyph: '⭐', t: '34%', l: '8%',  d: '800ms', s: 24 },
          { glyph: '🌟', t: '48%', l: '88%', d: '300ms', s: 28 },
          { glyph: '✨', t: '70%', l: '14%', d: '900ms', s: 22 },
          { glyph: '🎉', t: '76%', l: '82%', d: '550ms', s: 32 },
        ].map((s, i) => (
          <span
            key={i}
            className="absolute kaya-twinkle"
            style={{
              top: s.t, left: s.l, fontSize: `${s.s}px`,
              animationDelay: s.d, opacity: 0,
            }}
          >
            {s.glyph}
          </span>
        ))}
      </div>

      {/* Fireworks — 6 staggered bursts. Each burst spawns 12 particles
          radiating outward (every 30°). Pure CSS, no canvas. */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        {fireworks.map((b) => (
          <div
            key={b.id}
            className="kaya-firework-burst"
            style={{ left: b.cx, top: b.cy }}
          >
            {Array.from({ length: 12 }).map((_, i) => {
              const angle = (i * 30) * (Math.PI / 180);
              const dist = 90; // px outward
              const dx = Math.cos(angle) * dist;
              const dy = Math.sin(angle) * dist;
              return (
                <span
                  key={i}
                  className="kaya-firework-particle"
                  style={{
                    color: b.color,
                    backgroundColor: b.color,
                    animationDelay: b.delay,
                    // CSS custom properties consumed by the keyframe.
                    ['--dx' as never]: `${dx}px`,
                    ['--dy' as never]: `${dy}px`,
                  } as React.CSSProperties}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Foreground content */}
      <div className="relative text-center px-6 z-10">
        <div className="text-7xl lg:text-8xl mb-3 kaya-pop">🎉</div>
        <h1
          className="font-display font-black text-5xl sm:text-6xl lg:text-7xl tracking-tight kaya-wordmark"
          style={{
            WebkitTextFillColor: 'transparent',
            backgroundImage: 'linear-gradient(135deg, #F5E6B8, #D4A017)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
          }}
        >
          Kaya Kaya!
        </h1>
        <p className="text-white/85 text-base lg:text-xl max-w-md mx-auto mt-4 mb-8 kaya-pop kaya-pop-delay-2">
          Beautiful meeting. See you next week.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="kaya-pop kaya-pop-delay-2 h-12 lg:h-14 px-7 lg:px-9 rounded-kaya bg-white text-kaya-chocolate font-display font-extrabold text-sm lg:text-base hover:bg-kaya-gold-light transition-colors shadow-2xl"
        >
          Back to Meetings →
        </button>
        <p className="kaya-pop kaya-pop-delay-2 text-[11px] lg:text-[12px] text-kaya-gold-light/70 font-display font-extrabold tracking-wider mt-6">
          Designed by Diella ✨
        </p>
      </div>

      {/* Flowers cascade layered on top — shared visual language with
          the prayer stage's celebration. */}
      <FlowersDrop onDone={() => { /* keep the splash up until auto-close */ }} />
    </div>
  );
}

// ── Prayer stage ───────────────────────────────────────────────────
// Two-step: SAY first (typeset stage, no flowers, no auto-close), then
// CELEBRATE (flowers cascade + signals the presenter to finish the
// meeting). Splits what was a single "Say & celebrate" because the
// celebration shouldn't happen mid-prayer — the family says the words
// together, then taps Celebrate when they're ready to close the night.
function PrayerStage({
  prayer,
  familyName,
  onClose,
  onCelebrateAndFinish,
}: {
  prayer: string;
  familyName: string;
  /** Dismiss without celebrating (the "Amen ✕" out). */
  onClose: () => void;
  /** Celebrate the prayer (flowers cascade) AND advance the meeting
   *  to the finish splash. Fires once the user taps "Celebrate". */
  onCelebrateAndFinish: () => void;
}) {
  // Two-phase state — saying first, then celebrating.
  const [celebrating, setCelebrating] = useState(false);

  // Split into stanzas (blank-line separated). Falls back to the raw
  // text in a single paragraph if no blank lines are present.
  const stanzas = useMemo(() => {
    const trimmed = prayer.trim();
    if (!trimmed) return ['Amen.'];
    const blocks = trimmed.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
    return blocks.length > 0 ? blocks : [trimmed];
  }, [prayer]);

  // When the parent taps Celebrate, run flowers for ~3.5s, then
  // signal the presenter to advance to the finish splash. The stage
  // closes itself as part of that transition.
  const handleCelebrate = () => {
    if (celebrating) return;
    setCelebrating(true);
    setTimeout(() => {
      onCelebrateAndFinish();
    }, 3500);
  };

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-gradient-to-br from-kaya-chocolate via-[#2a1810] to-kaya-chocolate text-white">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes kaya-prayer-fade-in {
              0%   { opacity: 0; transform: translateY(8px); }
              100% { opacity: 1; transform: translateY(0); }
            }
            .kaya-prayer-fade { animation: kaya-prayer-fade-in 900ms ease-out both; }
            .kaya-prayer-fade-1 { animation-delay: 200ms; }
            .kaya-prayer-fade-2 { animation-delay: 600ms; }
            .kaya-prayer-fade-3 { animation-delay: 1000ms; }
          `,
        }}
      />

      {/* Amen / dismiss — for early exit without celebrating. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="End prayer without celebrating"
        className="absolute top-5 right-5 lg:top-7 lg:right-7 z-[57] h-9 lg:h-10 px-4 lg:px-5 rounded-full bg-white/10 hover:bg-white/20 text-white text-[12px] lg:text-[13px] font-display font-extrabold transition-colors"
      >
        Amen ✕
      </button>

      {/* Centered prayer text */}
      <main className="relative z-[56] flex-1 flex flex-col items-center justify-center px-6 lg:px-16 py-10 overflow-y-auto">
        <div className="max-w-3xl w-full text-center">
          <div className="text-kaya-gold-light text-2xl lg:text-3xl mb-3 kaya-prayer-fade" aria-hidden>✦</div>
          <p className="text-[11px] lg:text-[12px] uppercase tracking-[0.28em] font-bold text-kaya-gold-light/70 mb-8 lg:mb-10 kaya-prayer-fade">
            A prayer from {familyName}
          </p>

          <div className="space-y-6 lg:space-y-8">
            {stanzas.map((s, i) => (
              <p
                key={i}
                className={`text-white/95 font-display font-semibold leading-[1.45] tracking-tight whitespace-pre-line kaya-prayer-fade ${
                  i === 0 ? 'kaya-prayer-fade-1' :
                  i === 1 ? 'kaya-prayer-fade-2' :
                            'kaya-prayer-fade-3'
                } ${
                  stanzas.length === 1 ? 'text-2xl lg:text-4xl' : 'text-xl lg:text-3xl'
                }`}
              >
                {s}
              </p>
            ))}
          </div>

          <div className="text-kaya-gold-light text-2xl lg:text-3xl mt-10 lg:mt-14 kaya-prayer-fade kaya-prayer-fade-3" aria-hidden>✦</div>

          {/* Celebrate CTA — only visible while NOT celebrating. Once
              tapped, the button disappears, flowers cascade, and the
              presenter advances to the Kaya Kaya finish. */}
          {!celebrating && (
            <button
              type="button"
              onClick={handleCelebrate}
              className="kaya-prayer-fade kaya-prayer-fade-3 mt-10 lg:mt-14 inline-flex items-center gap-2 h-12 lg:h-14 px-8 lg:px-10 rounded-kaya bg-gradient-to-br from-kaya-gold to-kaya-gold-dark hover:brightness-110 text-kaya-chocolate font-display font-extrabold text-base lg:text-lg transition-all shadow-2xl"
            >
              ✨ Celebrate &amp; finish
            </button>
          )}
        </div>
      </main>

      {/* Flowers cascade — only mounts AFTER the parent taps Celebrate
          so the flowers don't fall during the actual prayer reading. */}
      {celebrating && (
        <FlowersDrop onDone={() => { /* finish signal happens via timeout above */ }} />
      )}
    </div>
  );
}

// ── Flowers-drop celebration ────────────────────────────────────────
// Pure CSS — no extra dependencies. Renders ~36 flower glyphs at random
// horizontal positions, each falling with a randomised delay/duration so
// the drop looks organic. Auto-cleans up after 4s.
function FlowersDrop({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);
  const flowers = useMemo(() => {
    const glyphs = ['🌸', '🌼', '🌷', '🌹', '💐', '🌺', '✨'];
    return Array.from({ length: 36 }, (_, i) => ({
      glyph: glyphs[i % glyphs.length],
      left: Math.random() * 100,
      delay: Math.random() * 1.2,
      duration: 2.8 + Math.random() * 1.8,
      size: 28 + Math.random() * 28,
    }));
  }, []);
  return (
    <div className="fixed inset-0 z-[60] pointer-events-none overflow-hidden">
      {/* Keyframes need to ship as a *global* stylesheet rule —
          styled-jsx (and CSS Modules) would scope the @keyframes
          identifier so the un-scoped `animation: kaya-flower-fall` on
          each span below would never match. A plain <style> tag injects
          the rule into the page-level stylesheet. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes kaya-flower-fall {
            0%   { transform: translateY(-15vh) rotate(0deg);   opacity: 0; }
            10%  { opacity: 1; }
            100% { transform: translateY(115vh) rotate(720deg); opacity: 1; }
          }`,
        }}
      />
      {flowers.map((f, i) => (
        <span
          key={i}
          className="absolute top-0 select-none"
          style={{
            left: `${f.left}%`,
            fontSize: `${f.size}px`,
            animation: `kaya-flower-fall ${f.duration}s linear ${f.delay}s forwards`,
          }}
        >
          {f.glyph}
        </span>
      ))}
    </div>
  );
}
