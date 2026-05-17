'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { createMeeting, getMeetings, Meeting, todayString } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';

// Quick-log fallback agenda — kept in sync with the new presenter
// mode's 6-step flow so what families see in the sidebar matches.
// Some steps that have rich UI in presenter (attendance toggles, multi-
// week goals review, multi-select reflection) collapse to a simple
// inline input here — presenter mode is the recommended path.
const BASE_AGENDA = [
  { step: 'Attendance',           icon: '👋', desc: 'Who is here + any presentations',                hasInputs: null },
  { step: 'Gratitude circle',     icon: '🙏', desc: 'Each person shares something thankful',          hasInputs: 'gratitude' as const },
  { step: 'Celebrate the wins',   icon: '🎉', desc: 'Open the Points Review and walk the week',      hasInputs: null },
  { step: 'Appreciations',        icon: '💛', desc: 'Kind, helpful, or brave things you noticed',     hasInputs: null },
  { step: 'Goals review',         icon: '🎯', desc: 'Last week done/not + commit for next week',     hasInputs: 'goals' as const },
  { step: 'Closing reflection',   icon: '✨', desc: 'Story, songs, or a family prayer',              hasInputs: 'notes' as const },
];

export default function MeetingsPage() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const [tab, setTab] = useState<'new' | 'past'>('new');
  const [meetingType, setMeetingType] = useState<'weekly' | 'kid-led'>('weekly');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [gratitude, setGratitude] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Points Review used to be its own filtered step here; it's now
  // merged into "Celebrate the wins" in presenter mode (link to the
  // existing /meetings/review screen). The agenda below is fixed.
  const agenda = BASE_AGENDA;

  useEffect(() => {
    if (!profile?.familyId) return;
    getMeetings(profile.familyId).then(setMeetings);
  }, [profile?.familyId]);

  const handleSave = async () => {
    if (!profile?.familyId) return;
    setSaving(true);
    await createMeeting(profile.familyId, {
      date: todayString(),
      type: meetingType,
      attendees: children.map((c) => c.id),
      gratitude,
      goals,
      notes,
      createdBy: profile.uid,
    } as any);
    setSaved(true);
    setSaving(false);
    getMeetings(profile.familyId).then(setMeetings);
  };

  const reset = () => {
    setSaved(false); setActiveStep(0);
    setGratitude({}); setGoals({}); setNotes('');
  };

  const currentStep = agenda[activeStep];
  const completedStep = (i: number) => i < activeStep;
  const isLastStep = activeStep === agenda.length - 1;

  // ── Step content body (shared) ────────────────────────────
  const StepInputs = () => {
    if (!currentStep) return null;
    if (currentStep.hasInputs === 'gratitude') {
      return (
        <div className="space-y-3">
          {children.map((c) => (
            <div key={c.id}>
              <label className="text-xs font-semibold mb-1 block">{c.avatarEmoji} {c.name}</label>
              <input
                value={gratitude[c.id] || ''}
                onChange={(e) => setGratitude({ ...gratitude, [c.id]: e.target.value })}
                className="w-full h-10 px-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                placeholder="I'm thankful for…"
              />
            </div>
          ))}
        </div>
      );
    }
    if (currentStep.hasInputs === 'goals') {
      return (
        <div className="space-y-3">
          {children.map((c) => (
            <div key={c.id}>
              <label className="text-xs font-semibold mb-1 block">{c.avatarEmoji} {c.name}</label>
              <input
                value={goals[c.id] || ''}
                onChange={(e) => setGoals({ ...goals, [c.id]: e.target.value })}
                className="w-full h-10 px-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                placeholder="My goal is…"
              />
            </div>
          ))}
        </div>
      );
    }
    if (currentStep.hasInputs === 'notes') {
      return (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full h-32 px-3 py-2 bg-kaya-cream rounded-kaya-sm text-sm resize-none focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
          placeholder="Meeting notes, votes, decisions…"
        />
      );
    }
    if (currentStep.step === 'Celebrate the wins') {
      return (
        <div className="rounded-kaya bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-white p-5 lg:p-6">
          <p className="text-[10px] uppercase tracking-[0.2em] text-kaya-gold/80 font-bold mb-1">Cast it</p>
          <h4 className="font-display text-lg lg:text-xl font-black mb-1">Open the Points Review</h4>
          <p className="text-xs lg:text-sm text-white/70 leading-relaxed mb-4">
            Full-screen leaderboard plus the <strong>Excellent Belt&reg;</strong> and{' '}
            <strong>Excellent Ladder&reg;</strong> reveal — perfect for casting to a TV.
          </p>
          <Link
            href="/meetings/review"
            className="inline-flex items-center gap-2 h-11 px-5 rounded-kaya-sm bg-kaya-gold text-kaya-chocolate font-bold text-sm hover:bg-kaya-gold-dark transition-colors"
          >
            Open Points Review <span aria-hidden>→</span>
          </Link>
        </div>
      );
    }
    return null;
  };

  // ── Tabs (shared markup) ──────────────────────────────────
  const Tabs = () => (
    <div className="flex gap-2">
      {(['new', 'past'] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          className={`flex-1 lg:flex-none lg:px-4 h-10 rounded-kaya-sm text-sm font-semibold transition-colors ${
            tab === t ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'
          }`}
        >
          {t === 'new' ? '✨ New meeting' : `📁 Past (${meetings.length})`}
        </button>
      ))}
    </div>
  );

  return (
    <>
      {/* ─────────────────────────────────────────────────────────── */}
      {/* MOBILE (< lg) — preserved                                    */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="lg:hidden mx-auto max-w-md w-full px-4 pt-4">
        <BackButton />
        <div className="mb-5">
          <h1 className="font-display text-2xl font-black">Family Meetings</h1>
          <p className="text-kaya-sand text-sm">Weekly check-ins to grow together</p>
        </div>

        {/* Presenter Mode CTA — the recommended way to run the meeting,
            cast-friendly with the new 5-step Gratitude → Celebrate →
            Appreciations → Goals → Closing Reflection flow. */}
        <Link
          href="/meetings/present"
          className="mb-5 block bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-kaya-gold-light rounded-kaya-lg p-5 hover:brightness-110 transition-all"
        >
          <p className="text-[10px] uppercase tracking-[0.18em] font-bold opacity-80 mb-1">
            Start the meeting
          </p>
          <h2 className="font-display font-black text-xl leading-tight mb-1">
            🎬 Presenter Mode
          </h2>
          <p className="text-[12px] opacity-75 leading-relaxed">
            Full-screen, one step at a time — cast to a TV or prop up the phone.
            Gratitude → Celebrate → Appreciations → Goals → Closing Reflection.
          </p>
          <span className="inline-flex items-center gap-1 mt-3 text-[12px] font-bold">
            Open presenter →
          </span>
        </Link>

        <div className="mb-5"><Tabs /></div>

        {tab === 'new' ? (
          saved ? (
            <div className="text-center pt-10 animate-slide-up">
              <div className="text-5xl mb-4">✅</div>
              <h2 className="font-display text-xl font-black mb-2">Meeting Logged!</h2>
              <p className="text-kaya-sand text-sm">Great {meetingType === 'kid-led' ? 'kid-led' : 'family'} time together</p>
              <button onClick={reset} className="mt-4 px-6 py-2 bg-kaya-warm rounded-kaya-sm text-sm font-semibold text-kaya-sand">
                Start Another
              </button>
            </div>
          ) : (
            <div>
              <div className="flex gap-3 mb-5">
                <button
                  onClick={() => setMeetingType('weekly')}
                  className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-kaya border-2 transition-all ${
                    meetingType === 'weekly' ? 'border-green-600 bg-green-600/5' : 'border-kaya-warm-dark bg-white'
                  }`}
                >
                  <span className="text-2xl">👨‍👩‍👧‍👦</span>
                  <span className="text-xs font-bold">Family Led</span>
                  <span className="text-[10px] text-kaya-sand">Parents guide</span>
                </button>
                <button
                  onClick={() => setMeetingType('kid-led')}
                  className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-kaya border-2 transition-all ${
                    meetingType === 'kid-led' ? 'border-orange-500 bg-orange-500/5' : 'border-kaya-warm-dark bg-white'
                  }`}
                >
                  <span className="text-2xl">🧒</span>
                  <span className="text-xs font-bold">Kid-Led</span>
                  <span className="text-[10px] text-kaya-sand">Kids run it</span>
                </button>
              </div>

              {meetingType === 'kid-led' && (
                <div className="bg-orange-50 border border-orange-200 rounded-kaya-sm p-3 mb-4 text-xs text-orange-700 leading-relaxed">
                  🧒 <strong>Kid-Led Mode</strong> — The children lead the meeting using the guided structure. Parents observe and support.
                </div>
              )}

              <div className="flex gap-1 mb-5">
                {agenda.map((_, i) => (
                  <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= activeStep ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'}`} />
                ))}
              </div>

              {currentStep && (
                <div className="bg-white border border-kaya-warm-dark rounded-kaya p-5 mb-4">
                  <div className="text-3xl mb-3">{currentStep.icon}</div>
                  <h3 className="font-display text-lg font-black mb-1">{currentStep.step}</h3>
                  <p className="text-kaya-sand text-sm mb-4">{currentStep.desc}</p>
                  <StepInputs />
                </div>
              )}

              <div className="flex gap-3">
                {activeStep > 0 && (
                  <button onClick={() => setActiveStep(activeStep - 1)} className="h-11 px-5 bg-kaya-warm rounded-kaya-sm text-sm font-semibold text-kaya-sand">
                    Back
                  </button>
                )}
                {!isLastStep ? (
                  <button onClick={() => setActiveStep(activeStep + 1)} className="flex-1 h-11 bg-kaya-gold text-white rounded-kaya-sm font-bold text-sm">
                    Next Step →
                  </button>
                ) : (
                  <button onClick={handleSave} disabled={saving} className="flex-1 h-11 bg-kaya-chocolate text-white rounded-kaya-sm font-bold text-sm disabled:opacity-50">
                    {saving ? 'Saving…' : 'Finish Meeting ✅'}
                  </button>
                )}
              </div>
            </div>
          )
        ) : (
          <div className="space-y-3">
            {meetings.length === 0 ? (
              <div className="bg-white border border-kaya-warm-dark rounded-kaya p-6 text-center">
                <p className="text-3xl mb-2">📝</p>
                <p className="text-kaya-sand text-sm">No meetings logged yet</p>
              </div>
            ) : (
              meetings.map((m) => (
                <div key={m.id} className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-bold text-sm">{m.date}</p>
                    <span className={`text-xs px-2 py-1 rounded-full font-semibold ${m.type === 'kid-led' ? 'bg-orange-50 text-orange-600' : 'bg-kaya-warm text-kaya-sand'}`}>
                      {m.type === 'kid-led' ? '🧒 Kid-Led' : '👨‍👩‍👧‍👦 Weekly'}
                    </span>
                  </div>
                  {m.notes && <p className="text-xs text-kaya-sand">{m.notes}</p>}
                  {Object.keys(m.goals || {}).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-kaya-warm-dark">
                      <p className="text-[10px] text-kaya-sand font-semibold uppercase mb-1">Goals Set</p>
                      {Object.entries(m.goals).map(([childId, goal]) => {
                        const c = children.find((x) => x.id === childId);
                        return goal ? <p key={childId} className="text-xs">{c?.avatarEmoji} {c?.name}: {goal}</p> : null;
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* DESKTOP (lg+) — vertical stepper + main pane                 */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="hidden lg:block max-w-[1400px] w-full px-8 py-8">
        <div className="flex items-end justify-between gap-6 mb-6">
          <div>
            <h1 className="font-display text-[34px] leading-tight font-extrabold tracking-tight">Family meetings</h1>
            <p className="text-sm text-kaya-sand mt-1">A 5-step weekly rhythm: gratitude, celebration, appreciations, goals, closing reflection.</p>
          </div>
          <Tabs />
        </div>

        {/* Presenter Mode CTA — desktop. Same destination as the mobile
            banner above; this is the recommended way to run the meeting. */}
        <Link
          href="/meetings/present"
          className="mb-7 flex items-center gap-5 bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-kaya-gold-light rounded-kaya-lg p-6 hover:brightness-110 transition-all"
        >
          <div className="text-4xl shrink-0" aria-hidden>🎬</div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] font-bold opacity-80 mb-1">
              Recommended · Start the meeting
            </p>
            <h2 className="font-display font-black text-2xl leading-tight mb-1">
              Open Presenter Mode
            </h2>
            <p className="text-[13px] opacity-75 leading-relaxed">
              Full-screen, one step at a time — cast to a TV or prop the laptop on the table.
              Gratitude → Celebrate the Wins → Appreciations → Goals Review → Closing Reflection.
            </p>
          </div>
          <span className="shrink-0 text-sm font-extrabold opacity-80">→</span>
        </Link>

        {tab === 'new' ? (
          saved ? (
            <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-12 text-center max-w-xl mx-auto animate-slide-up">
              <div className="text-6xl mb-4">✅</div>
              <h2 className="font-display text-2xl font-black mb-2">Meeting logged</h2>
              <p className="text-kaya-sand text-sm mb-6">Great {meetingType === 'kid-led' ? 'kid-led' : 'family'} time together.</p>
              <button onClick={reset} className="px-6 py-2.5 bg-kaya-gold text-white rounded-kaya-sm text-sm font-bold hover:bg-kaya-gold-dark transition-colors">
                Start another meeting
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-6">
              {/* Stepper + meeting type (left) */}
              <aside className="col-span-4 space-y-5">
                <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand mb-3">Meeting type</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setMeetingType('weekly')}
                      className={`flex flex-col items-center gap-1 p-3 rounded-kaya border-2 transition-all ${
                        meetingType === 'weekly' ? 'border-green-600 bg-green-600/5' : 'border-kaya-warm-dark bg-white hover:border-kaya-sand-light'
                      }`}
                    >
                      <span className="text-xl">👨‍👩‍👧‍👦</span>
                      <span className="text-xs font-bold">Family-led</span>
                      <span className="text-[10px] text-kaya-sand">Parents guide</span>
                    </button>
                    <button
                      onClick={() => setMeetingType('kid-led')}
                      className={`flex flex-col items-center gap-1 p-3 rounded-kaya border-2 transition-all ${
                        meetingType === 'kid-led' ? 'border-orange-500 bg-orange-500/5' : 'border-kaya-warm-dark bg-white hover:border-kaya-sand-light'
                      }`}
                    >
                      <span className="text-xl">🧒</span>
                      <span className="text-xs font-bold">Kid-led</span>
                      <span className="text-[10px] text-kaya-sand">Kids run it</span>
                    </button>
                  </div>
                  {meetingType === 'kid-led' && (
                    <p className="text-[11px] text-orange-700 leading-relaxed mt-3 bg-orange-50 border border-orange-200 rounded-kaya-sm p-2.5">
                      🧒 The children lead the meeting using the guided structure. Parents observe and support.
                    </p>
                  )}
                </div>

                <nav className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg overflow-hidden">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand px-5 pt-4 pb-2">Agenda</p>
                  <ol>
                    {agenda.map((item, i) => {
                      const isActive = i === activeStep;
                      const isDone = completedStep(i);
                      return (
                        <li key={item.step}>
                          <button
                            onClick={() => setActiveStep(i)}
                            className={`w-full flex items-center gap-3 px-5 py-3 text-left border-l-2 transition-colors ${
                              isActive
                                ? 'bg-kaya-gold/5 border-kaya-gold'
                                : 'border-transparent hover:bg-kaya-warm/40'
                            }`}
                          >
                            <div
                              className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                                isDone ? 'bg-kaya-gold text-white' :
                                isActive ? 'bg-kaya-chocolate text-white' :
                                'bg-kaya-warm border-2 border-dashed border-kaya-sand text-kaya-sand'
                              }`}
                            >
                              {isDone ? '✓' : i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-[13px] truncate ${isActive ? 'font-bold' : 'font-semibold text-kaya-chocolate'}`}>
                                {item.icon} {item.step}
                              </p>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </nav>
              </aside>

              {/* Step content (right) */}
              <section className="col-span-8">
                {currentStep && (
                  <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-7 mb-4">
                    <div className="flex items-start gap-4 mb-5">
                      <div className="w-14 h-14 rounded-[16px] bg-kaya-warm/60 flex items-center justify-center text-3xl shrink-0">{currentStep.icon}</div>
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand mb-1">Step {activeStep + 1} of {agenda.length}</p>
                        <h3 className="font-display text-2xl font-extrabold tracking-tight">{currentStep.step}</h3>
                        <p className="text-sm text-kaya-sand mt-1">{currentStep.desc}</p>
                      </div>
                    </div>
                    <StepInputs />
                  </div>
                )}

                <div className="flex gap-3">
                  {activeStep > 0 && (
                    <button onClick={() => setActiveStep(activeStep - 1)} className="h-12 px-5 bg-kaya-warm rounded-kaya-sm text-sm font-semibold text-kaya-sand hover:bg-kaya-warm-dark/60 transition-colors">
                      ← Back
                    </button>
                  )}
                  {!isLastStep ? (
                    <button onClick={() => setActiveStep(activeStep + 1)} className="flex-1 h-12 bg-kaya-gold text-white rounded-kaya font-bold text-sm hover:bg-kaya-gold-dark transition-colors">
                      Next step →
                    </button>
                  ) : (
                    <button onClick={handleSave} disabled={saving} className="flex-1 h-12 bg-kaya-chocolate text-white rounded-kaya font-bold text-sm disabled:opacity-50 hover:bg-kaya-chocolate-light transition-colors">
                      {saving ? 'Saving…' : 'Finish meeting ✅'}
                    </button>
                  )}
                </div>
              </section>
            </div>
          )
        ) : (
          // Past meetings (desktop) — grid of cards
          meetings.length === 0 ? (
            <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-12 text-center max-w-xl mx-auto">
              <p className="text-4xl mb-3">📝</p>
              <p className="text-kaya-sand text-sm">No meetings logged yet. Start a new one to build a record.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {meetings.map((m) => (
                <div key={m.id} className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-display font-bold text-base">{m.date}</p>
                    <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-wider ${m.type === 'kid-led' ? 'bg-orange-50 text-orange-600' : 'bg-kaya-warm text-kaya-sand'}`}>
                      {m.type === 'kid-led' ? 'Kid-led' : 'Weekly'}
                    </span>
                  </div>

                  {Object.keys(m.gratitude || {}).length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider mb-1.5">🙏 Gratitude</p>
                      <ul className="space-y-1">
                        {Object.entries(m.gratitude).map(([cid, txt]) => {
                          const c = children.find((x) => x.id === cid);
                          return txt ? <li key={cid} className="text-[12px] truncate"><span className="text-kaya-sand">{c?.avatarEmoji} {c?.name}:</span> {txt}</li> : null;
                        })}
                      </ul>
                    </div>
                  )}

                  {Object.keys(m.goals || {}).length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider mb-1.5">🎯 Goals</p>
                      <ul className="space-y-1">
                        {Object.entries(m.goals).map(([cid, goal]) => {
                          const c = children.find((x) => x.id === cid);
                          return goal ? <li key={cid} className="text-[12px] truncate"><span className="text-kaya-sand">{c?.avatarEmoji} {c?.name}:</span> {goal}</li> : null;
                        })}
                      </ul>
                    </div>
                  )}

                  {m.notes && (
                    <div>
                      <p className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider mb-1.5">📝 Notes</p>
                      <p className="text-[12px] text-kaya-chocolate leading-snug">{m.notes}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </>
  );
}
