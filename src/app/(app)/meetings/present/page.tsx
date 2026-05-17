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
  createMeeting, getMeetings, Meeting, todayString,
} from '@/lib/firestore';

// ── Agenda definition ──────────────────────────────────────────────
const STEPS = [
  { id: 'gratitude',     title: 'Gratitude Circle',   emoji: '🙏', sub: 'What is each of us thankful for today?' },
  { id: 'celebrate',     title: 'Celebrate the Wins', emoji: '🎉', sub: 'Look back at the week — points, badges, moments worth a cheer.' },
  { id: 'appreciations', title: 'Appreciations',      emoji: '💛', sub: 'Something kind, helpful, or brave you noticed this week.' },
  { id: 'goals',         title: 'Goals Review',       emoji: '🎯', sub: 'Did we hit last week\'s goals? What do we commit to for next week?' },
  { id: 'reflection',    title: 'Closing Reflection', emoji: '✨', sub: 'A gentle close — a story, a song, or a family prayer.' },
] as const;

type StepId = typeof STEPS[number]['id'];
type ReflectionMode = 'story' | 'songs' | 'prayer';

export default function MeetingPresenterPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children } = useFamily();

  // ── Stepper state ────────────────────────────────────────────────
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];
  const isLastStep = stepIdx === STEPS.length - 1;

  // ── Captured per step ────────────────────────────────────────────
  const [gratitude, setGratitude] = useState<Record<string, string>>({});
  const [appreciations, setAppreciations] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<Record<string, string>>({});           // this week
  const [lastWeekGoalsDone, setLastWeekGoalsDone] = useState<Record<string, boolean>>({});
  const [reflectionMode, setReflectionMode] = useState<ReflectionMode | null>(null);
  const [reflectionContent, setReflectionContent] = useState('');
  // null = idle; non-null = show the full-screen prayer stage with the
  // text typeset large + flowers cascading on top. Captured at click
  // time so editing the textarea afterwards doesn't change the on-
  // screen prayer mid-celebration.
  const [prayerOnStage, setPrayerOnStage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // ── Last week's goals (for the Goals Review step) ───────────────
  const [previousMeeting, setPreviousMeeting] = useState<Meeting | null>(null);
  useEffect(() => {
    if (!profile?.familyId) return;
    getMeetings(profile.familyId).then((ms) => {
      // getMeetings returns DESC by date; take the most recent.
      setPreviousMeeting(ms[0] || null);
    });
  }, [profile?.familyId]);

  const lastWeekGoals = previousMeeting?.goals || {};

  // ── Save handler ─────────────────────────────────────────────────
  const handleFinish = async () => {
    if (!profile?.familyId) return;
    setSaving(true);
    const payload: Omit<Meeting, 'id' | 'createdAt'> = {
      date: todayString(),
      type: 'weekly',
      attendees: children.map((c) => c.id),
      gratitude,
      goals,
      notes: '',
      appreciations,
      lastWeekGoalsDone,
      reflection: reflectionMode
        ? { mode: reflectionMode, content: reflectionContent.trim() || undefined }
        : undefined,
      createdBy: profile.uid,
    } as Omit<Meeting, 'id' | 'createdAt'>;
    await createMeeting(profile.familyId, payload as Omit<Meeting, 'id'>);
    setSaving(false);
    setDone(true);
  };

  // ── Step gating (prevent advance if required input missing) ──────
  // Intentionally lenient — a parent might want to skip a step on a
  // busy night. Only the reflection step requires a sub-mode selection
  // before "Finish" so the saved record makes sense.
  const canAdvance = useMemo(() => {
    if (step.id !== 'reflection') return true;
    return reflectionMode !== null;
  }, [step.id, reflectionMode]);

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
          {STEPS.map((s, i) => (
            <button
              type="button"
              key={s.id}
              onClick={() => setStepIdx(i)}
              aria-label={`Jump to ${s.title}`}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                i < stepIdx ? 'bg-kaya-gold' : i === stepIdx ? 'bg-kaya-gold-light' : 'bg-white/15'
              }`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-2 text-[10px] uppercase tracking-[0.16em] font-bold text-white/50">
          <span>Step {stepIdx + 1} of {STEPS.length}</span>
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
                  lastWeekGoals={lastWeekGoals}
                  lastWeekGoalsDone={lastWeekGoalsDone}
                  onToggleLastWeek={(kidId, done) =>
                    setLastWeekGoalsDone({ ...lastWeekGoalsDone, [kidId]: done })
                  }
                  goals={goals}
                  onChangeGoals={setGoals}
                />
              )}

              {step.id === 'reflection' && (
                <ReflectionStep
                  mode={reflectionMode}
                  onModeChange={setReflectionMode}
                  content={reflectionContent}
                  onContentChange={setReflectionContent}
                  onCelebrate={() => {
                    // Snapshot the prayer text so on-stage typography
                    // doesn't reflow if the textarea changes mid-fall.
                    setPrayerOnStage((reflectionContent || '').trim() || ' ');
                  }}
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
              onClick={() => setStepIdx(Math.max(0, stepIdx - 1))}
              disabled={stepIdx === 0}
              className="h-12 lg:h-14 px-5 lg:px-7 rounded-kaya bg-white/10 hover:bg-white/20 text-white font-display font-extrabold text-sm lg:text-base transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← Back
            </button>
            <div className="flex-1" />
            {!isLastStep ? (
              <button
                type="button"
                onClick={() => setStepIdx(stepIdx + 1)}
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

function GoalsStep({
  childrenList,
  lastWeekGoals,
  lastWeekGoalsDone,
  onToggleLastWeek,
  goals,
  onChangeGoals,
}: {
  childrenList: Array<{ id: string; name: string; avatarEmoji?: string }>;
  lastWeekGoals: Record<string, string>;
  lastWeekGoalsDone: Record<string, boolean>;
  onToggleLastWeek: (kidId: string, done: boolean) => void;
  goals: Record<string, string>;
  onChangeGoals: (next: Record<string, string>) => void;
}) {
  const hasLastWeek = Object.values(lastWeekGoals).some((g) => g && g.trim());

  return (
    <div className="space-y-6">
      {/* Last week review */}
      {hasLastWeek && (
        <section>
          <h3 className="font-display font-black text-base lg:text-lg text-kaya-gold-light mb-3 px-1">
            ✅ Last week — did we do what we agreed?
          </h3>
          <div className="space-y-2">
            {childrenList.map((c) => {
              const g = (lastWeekGoals[c.id] || '').trim();
              if (!g) return null;
              const done = !!lastWeekGoalsDone[c.id];
              return (
                <div
                  key={c.id}
                  className="bg-white/5 border border-white/10 rounded-kaya p-4 flex items-start gap-3"
                >
                  <button
                    type="button"
                    onClick={() => onToggleLastWeek(c.id, !done)}
                    aria-label={done ? `Mark ${c.name}'s goal not done` : `Mark ${c.name}'s goal done`}
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
                      <span className="text-xl">{c.avatarEmoji || '👧'}</span>
                      <span>{c.name}</span>
                    </div>
                    <p className={`mt-1 text-[14px] lg:text-base leading-snug ${done ? 'text-white/50 line-through' : 'text-white/85'}`}>
                      {g}
                    </p>
                  </div>
                </div>
              );
            })}
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

function ReflectionStep({
  mode,
  onModeChange,
  content,
  onContentChange,
  onCelebrate,
}: {
  mode: ReflectionMode | null;
  onModeChange: (m: ReflectionMode) => void;
  content: string;
  onContentChange: (s: string) => void;
  onCelebrate: () => void;
}) {
  const choices: Array<{ id: ReflectionMode; emoji: string; title: string; sub: string }> = [
    { id: 'story',  emoji: '📖', title: 'Inspiring Story', sub: 'Paste a story or a link to read together.' },
    { id: 'songs',  emoji: '🎵', title: 'Songs',            sub: 'Gospel, family favorites, anything that lifts the room.' },
    { id: 'prayer', emoji: '🙏', title: 'Family Prayer',    sub: 'A short prayer to close the night.' },
  ];

  if (mode === null) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        {choices.map((c) => (
          <button
            type="button"
            key={c.id}
            onClick={() => onModeChange(c.id)}
            className="bg-white/5 hover:bg-white/10 border border-white/10 hover:border-kaya-gold/60 rounded-kaya-lg p-6 text-left transition-all group"
          >
            <div className="text-4xl lg:text-5xl mb-3" aria-hidden>{c.emoji}</div>
            <div className="font-display font-black text-lg lg:text-xl text-kaya-gold-light mb-1">
              {c.title}
            </div>
            <p className="text-[13px] lg:text-sm text-white/65 leading-relaxed">{c.sub}</p>
            <div className="mt-4 text-[12px] font-bold text-kaya-gold opacity-0 group-hover:opacity-100 transition-opacity">
              Choose →
            </div>
          </button>
        ))}
      </div>
    );
  }

  const placeholder =
    mode === 'story' ? 'Paste a story, a verse, or a link…' :
    mode === 'songs' ? 'Paste a YouTube or Spotify link (or just a song title)…' :
                       'Paste your family prayer here, or write one fresh…';

  return (
    <div>
      {/* Back-to-chooser strip */}
      <button
        type="button"
        onClick={() => onModeChange(null as any)}
        className="text-[12px] lg:text-[13px] text-white/60 hover:text-white mb-4 flex items-center gap-1.5"
      >
        ← Choose a different closing
      </button>

      <div className="bg-white/5 border border-white/10 rounded-kaya-lg p-5 lg:p-7">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">
            {mode === 'story' ? '📖' : mode === 'songs' ? '🎵' : '🙏'}
          </span>
          <h3 className="font-display font-black text-xl lg:text-2xl text-kaya-gold-light">
            {mode === 'story' ? 'Inspiring Story' : mode === 'songs' ? 'Songs' : 'Family Prayer'}
          </h3>
          {mode === 'prayer' && (
            <span className="ml-auto text-[9px] lg:text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full bg-white/10 text-white/50">
              AI assist · Soon
            </span>
          )}
        </div>

        <textarea
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder={placeholder}
          rows={mode === 'prayer' ? 8 : 6}
          className="w-full bg-white/10 border border-white/10 rounded-kaya-sm px-4 py-3 text-[14px] lg:text-base text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-kaya-gold/60 resize-none leading-relaxed"
        />

        {mode === 'prayer' && (
          <button
            type="button"
            onClick={onCelebrate}
            className="mt-5 w-full h-13 lg:h-14 rounded-kaya bg-gradient-to-br from-kaya-gold to-kaya-gold-dark hover:brightness-110 text-kaya-chocolate font-display font-extrabold text-base lg:text-lg transition-all py-3"
          >
            🌸 Say &amp; celebrate
          </button>
        )}

        {(mode === 'story' || mode === 'songs') && content.trim().startsWith('http') && (
          <a
            href={content.trim()}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-5 inline-flex items-center gap-2 h-12 lg:h-14 px-6 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-sm lg:text-base transition-colors"
          >
            🔗 Open link
          </a>
        )}
      </div>
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
