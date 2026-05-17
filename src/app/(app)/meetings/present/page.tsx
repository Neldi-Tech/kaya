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
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  createMeeting, updateMeeting, getMeetings, getFamilyMembers,
  Meeting, ReflectionMode, todayString,
} from '@/lib/firestore';

// ── Agenda definition ──────────────────────────────────────────────
// Canonical step catalog — the presenter renders the subset that the
// parent enabled in /settings/meetings (via `family.meetingSetup
// .agendaSteps`). When no setup exists, every step is on.
const STEPS = [
  { id: 'attendance',    title: 'Attendance',         emoji: '👋', sub: 'Who is here tonight, and is anyone presenting?' },
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
    const base = !enabled || enabled.length === 0
      ? [...STEPS]
      : STEPS.filter((s) => new Set(enabled).has(s.id));
    // Apply per-step display-name overrides. `title` falls back to the
    // canonical default when the parent hasn't customised it.
    return base.map((s) => {
      const custom = (labels[s.id] || '').trim();
      return custom ? { ...s, title: custom } : s;
    });
  }, [family?.meetingSetup?.agendaSteps, family?.meetingSetup?.stepLabels]);

  const [stepIdx, setStepIdx] = useState(0);
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

  const [gratitude, setGratitude] = useState<Record<string, string>>({});
  const [appreciations, setAppreciations] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<Record<string, string>>({});           // this week

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
  useEffect(() => {
    if (!profile?.familyId) return;
    getMeetings(profile.familyId).then((ms) => {
      setRecentMeetings(ms.slice(0, GOALS_REVIEW_WEEKS_BACK));
    });
  }, [profile?.familyId]);

  // Fetch parent profiles for the household so attendance lists adults
  // alongside kids. Falls back to just the signed-in profile if the
  // family-members query is empty (e.g. guest mode).
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
    });
    return () => { cancelled = true; };
  }, [profile?.familyId, profile]);

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
        }
      : undefined;

    const presentation = (presentBy.trim() || presentTopic.trim())
      ? { by: presentBy.trim() || undefined, topic: presentTopic.trim() || undefined }
      : undefined;

    const payload: Omit<Meeting, 'id' | 'createdAt'> = {
      date: todayString(),
      type: 'weekly',
      attendees: Array.from(attendees),
      parentAttendees: Array.from(parentAttendees),
      guestAttendees: guestAttendees
        .filter((g) => g.name.trim().length > 0)
        .map((g) => ({ id: g.id, name: g.name.trim(), relationship: g.relationship || undefined })),
      gratitude,
      goals,
      notes: '',
      appreciations,
      presentation,
      reflection,
      createdBy: profile.uid,
    };
    await createMeeting(profile.familyId, payload as Omit<Meeting, 'id'>);
    setSaving(false);
    setDone(true);
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
              {/* Step heading */}
              <div className="mb-6 lg:mb-10 text-center">
                <div className="text-5xl lg:text-7xl mb-3" aria-hidden>{step.emoji}</div>
                <h1 className="font-display font-black text-3xl lg:text-5xl tracking-tight">
                  {step.title}
                </h1>
                <p className="mt-3 text-[14px] lg:text-base text-white/70 max-w-xl mx-auto leading-relaxed">
                  {step.sub}
                </p>
              </div>

              {/* Step body */}
              {step.id === 'attendance' && (
                <AttendanceStep
                  childrenList={children}
                  parentsList={householdParents}
                  attendees={attendees}
                  parentAttendees={parentAttendees}
                  guests={guestAttendees}
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

              {step.id === 'gratitude' && (
                <PerKidTextInputs
                  childrenList={children}
                  values={gratitude}
                  onChange={setGratitude}
                  placeholder="I'm thankful for…"
                />
              )}

              {step.id === 'celebrate' && (
                <CelebrateStep />
              )}

              {step.id === 'appreciations' && (
                <PerKidTextInputs
                  childrenList={children}
                  values={appreciations}
                  onChange={setAppreciations}
                  placeholder="I appreciated when…"
                  multiline
                />
              )}

              {step.id === 'goals' && (
                <GoalsStep
                  childrenList={children}
                  recentMeetings={recentMeetings}
                  reviewedGoalsDone={reviewedGoalsDone}
                  onToggleHistoricalGoalDone={toggleHistoricalGoalDone}
                  goals={goals}
                  onChangeGoals={setGoals}
                />
              )}

              {step.id === 'reflection' && (
                <ReflectionStep
                  enabledModes={enabledClosingModes}
                  contents={reflectionContents}
                  onContentChange={(m, v) =>
                    setReflectionContents({ ...reflectionContents, [m]: v })
                  }
                  onCelebratePrayer={() => {
                    // Snapshot the prayer text so on-stage typography
                    // doesn't reflow if the textarea changes mid-fall.
                    setPrayerOnStage((reflectionContents.prayer || '').trim() || ' ');
                  }}
                  prayerLibraryCount={prayerLibrary.length}
                />
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
                className="h-12 lg:h-14 px-6 lg:px-8 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-sm lg:text-base transition-colors"
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

function PerKidTextInputs({
  childrenList,
  values,
  onChange,
  placeholder,
  multiline = false,
}: {
  childrenList: Array<{ id: string; name: string; avatarEmoji?: string }>;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  if (childrenList.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-kaya p-8 text-center text-white/60">
        Add kids to your family in <Link href="/profiles" className="underline">profiles</Link> first.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {childrenList.map((c) => (
        <div key={c.id} className="bg-white/5 border border-white/10 rounded-kaya p-4 lg:p-5">
          <label className="flex items-center gap-2 text-[13px] lg:text-base font-display font-extrabold text-kaya-gold-light mb-2">
            <span className="text-2xl">{c.avatarEmoji || '👧'}</span>
            <span>{c.name}</span>
          </label>
          {multiline ? (
            <textarea
              value={values[c.id] || ''}
              onChange={(e) => onChange({ ...values, [c.id]: e.target.value })}
              placeholder={placeholder}
              rows={3}
              className="w-full bg-white/10 border border-white/10 rounded-kaya-sm px-4 py-3 text-[15px] lg:text-base text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-kaya-gold/60 resize-none"
            />
          ) : (
            <input
              value={values[c.id] || ''}
              onChange={(e) => onChange({ ...values, [c.id]: e.target.value })}
              placeholder={placeholder}
              className="w-full h-12 lg:h-14 bg-white/10 border border-white/10 rounded-kaya-sm px-4 text-[15px] lg:text-base text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-kaya-gold/60"
            />
          )}
        </div>
      ))}
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
        href="/meetings/review"
        className="inline-flex items-center gap-2 h-12 lg:h-14 px-6 lg:px-8 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-sm lg:text-base transition-colors"
      >
        🎬 Open Points Review →
      </Link>
      <p className="text-[12px] text-white/50 mt-6">
        Tip: the Points Review opens in the same window. Use the browser back
        button (or your TV remote) to return here when done.
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

function AttendanceStep({
  childrenList,
  parentsList,
  attendees,
  parentAttendees,
  guests,
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
            {/* Add guest tile */}
            {!adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex items-center justify-center gap-2 p-4 rounded-kaya border-2 border-dashed border-white/20 text-white/55 hover:text-white hover:border-white/40 transition-all font-display font-extrabold text-[14px] lg:text-base"
              >
                ＋ Add attendee
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
  recentMeetings,
  reviewedGoalsDone,
  onToggleHistoricalGoalDone,
  goals,
  onChangeGoals,
}: {
  childrenList: Array<{ id: string; name: string; avatarEmoji?: string }>;
  recentMeetings: Meeting[];
  reviewedGoalsDone: Record<string, Record<string, boolean>>;
  onToggleHistoricalGoalDone: (meetingId: string, kidId: string, done: boolean) => void;
  goals: Record<string, string>;
  onChangeGoals: (next: Record<string, string>) => void;
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

  return (
    <div className="space-y-7">
      {/* Multi-week review */}
      {goalsByMeeting.length > 0 && (
        <section>
          <h3 className="font-display font-black text-base lg:text-lg text-kaya-gold-light mb-3 px-1">
            ✅ Outstanding goals — check off what we did
          </h3>
          <div className="space-y-5">
            {goalsByMeeting.map(({ meeting, index, kids }) => (
              <div key={meeting.id} className="bg-white/5 border border-white/10 rounded-kaya-lg p-4 lg:p-5">
                <p className="text-[10px] lg:text-[11px] uppercase tracking-[0.2em] font-bold text-white/50 mb-3">
                  {label(index, meeting.date)} · {meeting.date}
                </p>
                <div className="space-y-2">
                  {kids.map(({ child, goal }) => {
                    const done = effectiveDone(index, child.id);
                    return (
                      <div
                        key={child.id}
                        className="bg-white/5 border border-white/10 rounded-kaya p-3 lg:p-4 flex items-start gap-3"
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
                          </div>
                          <p className={`mt-1 text-[14px] lg:text-base leading-snug ${done ? 'text-white/50 line-through' : 'text-white/85'}`}>
                            {goal}
                          </p>
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

      {/* This week's goals */}
      <section>
        <div className="flex items-baseline justify-between mb-3 px-1">
          <h3 className="font-display font-black text-base lg:text-lg text-kaya-gold-light">
            🎯 This week — what do we commit to?
          </h3>
          <span className="text-[9px] lg:text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full bg-white/10 text-white/50">
            AI assist · Soon
          </span>
        </div>
        <PerKidTextInputs
          childrenList={childrenList}
          values={goals}
          onChange={onChangeGoals}
          placeholder="Next week I will…"
        />
        <p className="text-[11px] lg:text-[12px] text-white/40 mt-3 px-1">
          Keep it small and specific — "read every night before bed" beats "do better at school."
        </p>
      </section>
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
}) {
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
            <textarea
              value={content}
              onChange={(e) => onContentChange(c.id, e.target.value)}
              placeholder={placeholderFor(c.id)}
              rows={isPrayer ? 7 : 4}
              className="w-full bg-white/10 border border-white/10 rounded-kaya-sm px-4 py-3 text-[14px] lg:text-base text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-kaya-gold/60 resize-none leading-relaxed"
            />

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

            {(isSongs || isStory) && (
              isLink ? (
                <a
                  href={content.trim()}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-4 inline-flex items-center gap-2 h-11 lg:h-12 px-5 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-[13px] lg:text-sm transition-colors"
                >
                  {ctaLabel}
                </a>
              ) : (
                <p className="mt-3 text-[11px] lg:text-[12px] text-white/40">
                  {isSongs
                    ? 'Paste a YouTube or Spotify URL to enable the play button.'
                    : 'Paste a link to open it in a new tab, or just read the text together.'}
                </p>
              )
            )}
          </div>
        );
      })}
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
