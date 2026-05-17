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
  createMeeting, updateMeeting, getMeetings, Meeting, ReflectionMode, todayString,
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

type StepDef = typeof STEPS[number];
type StepId = StepDef['id'];

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
    if (!enabled || enabled.length === 0) return [...STEPS];
    const allowed = new Set(enabled);
    // Keep canonical order — STEPS is the canonical order.
    return STEPS.filter((s) => allowed.has(s.id));
  }, [family?.meetingSetup?.agendaSteps]);

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
  // Attendance — initialized to "everyone present" when the kid list
  // loads (parents tap to mark absent).
  const [attendees, setAttendees] = useState<Set<string>>(new Set());
  const [attendanceInit, setAttendanceInit] = useState(false);
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

  // Closing Reflection — multi-select. `modes` is the ordered set of
  // closings picked tonight; `contents` is per-mode plain text the
  // parent typed/pasted.
  const [reflectionModes, setReflectionModes] = useState<ReflectionMode[]>([]);
  const [reflectionContents, setReflectionContents] =
    useState<Partial<Record<ReflectionMode, string>>>({});
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

  // Default attendance to "all kids present" once the children list
  // arrives. Only runs once so a manual deselection isn't overwritten
  // if the children list refreshes.
  useEffect(() => {
    if (!attendanceInit && children.length > 0) {
      setAttendees(new Set(children.map((c) => c.id)));
      setAttendanceInit(true);
    }
  }, [children, attendanceInit]);

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
                  attendees={attendees}
                  onToggleAttendee={(kidId) => {
                    setAttendees((prev) => {
                      const next = new Set(prev);
                      if (next.has(kidId)) next.delete(kidId);
                      else next.add(kidId);
                      return next;
                    });
                  }}
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
                  modes={reflectionModes}
                  onModesChange={(next) => {
                    setReflectionModes(next);
                    // If parent just picked Prayer for the first time AND
                    // the textarea is empty AND a library prayer is
                    // available, preload it. Parent can still edit or
                    // clear; we only auto-fill on the *transition*.
                    if (next.includes('prayer') && !reflectionModes.includes('prayer')
                        && !(reflectionContents.prayer || '').trim()
                        && preloadedPrayer) {
                      setReflectionContents({ ...reflectionContents, prayer: preloadedPrayer });
                    }
                  }}
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
function AttendanceStep({
  childrenList,
  attendees,
  onToggleAttendee,
  presentBy,
  presentTopic,
  onChangePresentBy,
  onChangePresentTopic,
}: {
  childrenList: Array<{ id: string; name: string; avatarEmoji?: string }>;
  attendees: Set<string>;
  onToggleAttendee: (kidId: string) => void;
  presentBy: string;
  presentTopic: string;
  onChangePresentBy: (s: string) => void;
  onChangePresentTopic: (s: string) => void;
}) {
  return (
    <div className="space-y-7">
      <section>
        <h3 className="font-display font-black text-base lg:text-lg text-kaya-gold-light mb-3 px-1">
          👥 Who is here tonight?
        </h3>
        {childrenList.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-kaya p-6 text-center text-white/60 text-sm">
            Add kids in <Link href="/profiles" className="underline">profiles</Link> to track attendance.
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
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
                    <span className="block font-display font-extrabold text-[14px] lg:text-base truncate">
                      {c.name}
                    </span>
                    <span className="block text-[11px] lg:text-[12px] mt-0.5">
                      {here ? 'Here' : 'Tap if here'}
                    </span>
                  </span>
                  <span
                    className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-sm font-black ${
                      here ? 'bg-kaya-gold text-kaya-chocolate' : 'bg-white/10 text-white/40'
                    }`}
                  >
                    {here ? '✓' : ' '}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[11px] lg:text-[12px] text-white/40 mt-3 px-1">
          Everyone defaults to present — tap to mark absent.
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
function ReflectionStep({
  enabledModes,
  modes,
  onModesChange,
  contents,
  onContentChange,
  onCelebratePrayer,
  prayerLibraryCount,
}: {
  /** Which of the 3 closings the parent enabled in /settings/meetings.
   *  Disabled modes are filtered out of the chooser entirely. */
  enabledModes: ReflectionMode[];
  modes: ReflectionMode[];
  onModesChange: (next: ReflectionMode[]) => void;
  contents: Partial<Record<ReflectionMode, string>>;
  onContentChange: (mode: ReflectionMode, value: string) => void;
  onCelebratePrayer: () => void;
  /** How many prayers live in the family's library — drives the
   *  "Library preloaded" hint on the Prayer input. */
  prayerLibraryCount: number;
}) {
  const allChoices: Array<{ id: ReflectionMode; emoji: string; title: string; sub: string }> = [
    { id: 'story',  emoji: '📖', title: 'Inspiring Story', sub: 'Paste a story or a link to read together.' },
    { id: 'songs',  emoji: '🎵', title: 'Songs',            sub: 'Gospel, family favorites, anything that lifts the room.' },
    { id: 'prayer', emoji: '🙏', title: 'Family Prayer',    sub: 'A short prayer to close the night.' },
  ];
  // Respect the parent's setup — drop closings they turned off.
  const choices = allChoices.filter((c) => enabledModes.includes(c.id));

  const isPicked = (id: ReflectionMode) => modes.includes(id);
  const toggle = (id: ReflectionMode) => {
    onModesChange(isPicked(id) ? modes.filter((m) => m !== id) : [...modes, id]);
  };

  const placeholderFor = (m: ReflectionMode) =>
    m === 'story' ? 'Paste a story, a verse, or a link…' :
    m === 'songs' ? 'Paste a YouTube or Spotify link (or just a song title)…' :
                    'Paste your family prayer here, or write one fresh…';

  return (
    <div className="space-y-7">
      {/* Multi-select chooser */}
      <section>
        <div className="flex items-baseline justify-between mb-3 px-1">
          <h3 className="font-display font-black text-base lg:text-lg text-kaya-gold-light">
            Pick one — or all
          </h3>
          {modes.length > 0 && (
            <span className="text-[10px] lg:text-[11px] uppercase tracking-wider font-bold text-white/50">
              {modes.length} selected
            </span>
          )}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {choices.map((c) => {
            const picked = isPicked(c.id);
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => toggle(c.id)}
                aria-pressed={picked}
                className={`relative rounded-kaya-lg p-5 lg:p-6 text-left transition-all border-2 ${
                  picked
                    ? 'bg-kaya-gold/15 border-kaya-gold'
                    : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/30'
                }`}
              >
                <div className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-sm font-black bg-white/10 text-white/40">
                  {picked && <span className="w-7 h-7 rounded-full flex items-center justify-center bg-kaya-gold text-kaya-chocolate">✓</span>}
                </div>
                <div className="text-3xl lg:text-4xl mb-2" aria-hidden>{c.emoji}</div>
                <div className="font-display font-black text-base lg:text-lg text-kaya-gold-light mb-1">
                  {c.title}
                </div>
                <p className="text-[12px] lg:text-[13px] text-white/65 leading-relaxed">{c.sub}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Per-mode input — only rendered for modes the parent picked. */}
      {modes.length > 0 && (
        <section className="space-y-5">
          {choices.filter((c) => isPicked(c.id)).map((c) => {
            const content = contents[c.id] || '';
            const isPrayer = c.id === 'prayer';
            const isLink = (c.id === 'story' || c.id === 'songs') && content.trim().startsWith('http');
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
                  rows={isPrayer ? 7 : 5}
                  className="w-full bg-white/10 border border-white/10 rounded-kaya-sm px-4 py-3 text-[14px] lg:text-base text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-kaya-gold/60 resize-none leading-relaxed"
                />

                {isPrayer && (
                  <button
                    type="button"
                    onClick={onCelebratePrayer}
                    className="mt-4 w-full h-12 lg:h-14 rounded-kaya bg-gradient-to-br from-kaya-gold to-kaya-gold-dark hover:brightness-110 text-kaya-chocolate font-display font-extrabold text-base lg:text-lg transition-all"
                  >
                    🌸 Say &amp; celebrate
                  </button>
                )}

                {isLink && (
                  <a
                    href={content.trim()}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-4 inline-flex items-center gap-2 h-11 lg:h-12 px-5 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-[13px] lg:text-sm transition-colors"
                  >
                    🔗 Open link
                  </a>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

function FinishedSplash({ onClose }: { onClose: () => void }) {
  return (
    <div className="text-center py-12 lg:py-20">
      <div className="text-7xl lg:text-8xl mb-6">✅</div>
      <h1 className="font-display font-black text-3xl lg:text-5xl mb-3">
        Meeting saved
      </h1>
      <p className="text-white/70 text-base lg:text-lg max-w-md mx-auto mb-8">
        Beautiful. Same time next week — we'll see how those goals went.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="h-12 lg:h-14 px-7 lg:px-9 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-sm lg:text-base transition-colors"
      >
        Back to Meetings →
      </button>
    </div>
  );
}

// ── Prayer stage ───────────────────────────────────────────────────
// Full-screen typography of the prayer text + flowers cascading on top.
// The textarea gives us plain text with newlines; we render it as
// clean HTML by splitting on blank lines into paragraphs and
// preserving single-line breaks inside each paragraph (whitespace-
// pre-line). One gold ornament tops the stage, one closes it. Auto-
// closes after ~9s; "Amen" button lets a parent end early.
function PrayerStage({
  prayer,
  familyName,
  onClose,
}: {
  prayer: string;
  familyName: string;
  onClose: () => void;
}) {
  // Auto-close so the meeting can move on without manual dismissal.
  useEffect(() => {
    const t = setTimeout(onClose, 9000);
    return () => clearTimeout(t);
  }, [onClose]);

  // Split into stanzas (blank-line separated). Falls back to the raw
  // text in a single paragraph if no blank lines are present.
  const stanzas = useMemo(() => {
    const trimmed = prayer.trim();
    if (!trimmed) return ['Amen.'];
    const blocks = trimmed.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
    return blocks.length > 0 ? blocks : [trimmed];
  }, [prayer]);

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-gradient-to-br from-kaya-chocolate via-[#2a1810] to-kaya-chocolate text-white">
      {/* Inline keyframes — kept global (not styled-jsx) so transform
          animations on child elements resolve correctly. */}
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

      {/* Close affordance */}
      <button
        type="button"
        onClick={onClose}
        aria-label="End prayer"
        className="absolute top-5 right-5 lg:top-7 lg:right-7 z-[57] h-9 lg:h-10 px-4 lg:px-5 rounded-full bg-white/10 hover:bg-white/20 text-white text-[12px] lg:text-[13px] font-display font-extrabold transition-colors"
      >
        Amen ✕
      </button>

      {/* Centered prayer text */}
      <main className="relative z-[56] flex-1 flex flex-col items-center justify-center px-6 lg:px-16 py-10 overflow-y-auto">
        <div className="max-w-3xl w-full text-center">
          {/* Ornament + heading */}
          <div className="text-kaya-gold-light text-2xl lg:text-3xl mb-3 kaya-prayer-fade" aria-hidden>✦</div>
          <p className="text-[11px] lg:text-[12px] uppercase tracking-[0.28em] font-bold text-kaya-gold-light/70 mb-8 lg:mb-10 kaya-prayer-fade">
            A prayer from {familyName}
          </p>

          {/* Stanzas — each stanza its own paragraph with whitespace-pre-line
              so single-line breaks inside the stanza are honored. */}
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

          {/* Closing ornament */}
          <div className="text-kaya-gold-light text-2xl lg:text-3xl mt-10 lg:mt-14 kaya-prayer-fade kaya-prayer-fade-3" aria-hidden>✦</div>
        </div>
      </main>

      {/* Flowers cascade on top — sits at z-[60] so it's above the prayer text. */}
      <FlowersDrop onDone={() => { /* keep stage open until auto-close or Amen */ }} />
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
