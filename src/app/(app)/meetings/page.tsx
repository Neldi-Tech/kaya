'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import CoachMark from '@/components/ui/CoachMark';
import NextUp from '@/components/ui/NextUp';
import MeetingPrepCard from '@/components/meetings/MeetingPrepCard';
import TodaysSongCard from '@/components/meetings/TodaysSongCard';
import { createMeeting, getMeetings, getAllMeetings, Meeting, todayString } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';
import MeetingReportSheet, { fmtMeetingDay } from '@/components/meetings/MeetingReportSheet';
import { subscribeMeetingSubmissions, isCurrentCycle, type MeetingSubmission } from '@/lib/meetingSubmissions';
import { getAllMeetingSubmissionHistory, type SubmissionHistoryDoc } from '@/lib/meetingSubmissionHistory';

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
  const [tab, setTab] = useState<'submission' | 'new' | 'past' | 'highlights'>('submission');
  const [meetingType, setMeetingType] = useState<'weekly' | 'kid-led'>('weekly');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [gratitude, setGratitude] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // SM3.1 (#5) — 📖 report sheet + 🟢/🟡 status. A meeting doc only exists
  // once a meeting FINISHED, so doc = 🟢 held & closed; a week with prep
  // submissions but no doc = 🟡 started · never closed.
  const [reportMeeting, setReportMeeting] = useState<Meeting | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'green' | 'amber'>('all');
  const [staleSubs, setStaleSubs] = useState<MeetingSubmission[]>([]);

  // Points Review used to be its own filtered step here; it's now
  // merged into "Celebrate the wins" in presenter mode (link to the
  // existing /meetings/review screen). The agenda below is fixed.
  const agenda = BASE_AGENDA;

  // Sunday-Meeting v2 (PR B) — the current user's prep-card props so the
  // Meetings hub is another doorway to fill Gratitude/Appreciation/Goal
  // before the meeting (parents especially, who land here to start it).
  // Kid childId can be empty-string — resolve via email match, never
  // silently children[0].
  const myPrep = useMemo(() => {
    if (!profile?.uid) return null;
    if (profile.role === 'kid') {
      const myEmail = profile.email?.toLowerCase() ?? '';
      const childId =
        (profile.childId?.trim() || '') ||
        (myEmail ? (children.find((c) => (c.emailLower || c.email?.toLowerCase() || '') === myEmail)?.id ?? '') : '');
      if (!childId) return null;
      const me = children.find((c) => c.id === childId);
      return { meId: profile.uid, role: 'kid' as const, name: (me?.name || profile.displayName || 'friend').split(' ')[0], childId, avatarEmoji: me?.avatarEmoji };
    }
    return {
      meId: profile.uid,
      role: (profile.role === 'helper' ? 'helper' : 'parent') as 'parent' | 'helper',
      name: (profile.displayName || 'there').split(' ')[0],
    };
  }, [profile?.uid, profile?.role, profile?.childId, profile?.email, profile?.displayName, children]);

  // Meeting day reminder — when the family has saved a schedule in
  // /settings/meetings and today is that day, surface a "Meeting
  // tonight at HH:mm" banner above the Presenter CTA. Pure client-
  // side check; no cron / push infrastructure yet.
  const scheduleReminder = useMemo(() => {
    const sch = family?.meetingSetup?.schedule;
    if (!sch || typeof sch.dayOfWeek !== 'number' || !sch.time) return null;
    const now = new Date();
    if (now.getDay() !== sch.dayOfWeek) return null;
    return {
      time: sch.time,
      dayName: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][sch.dayOfWeek],
    };
  }, [family?.meetingSetup?.schedule]);

  useEffect(() => {
    if (!profile?.familyId) return;
    getMeetings(profile.familyId).then(setMeetings);
  }, [profile?.familyId]);

  // Stale prep = a PAST cycle whose submissions were filled but whose
  // meeting never closed → the 🟡 cards. Current-cycle submissions are not
  // stale (that meeting simply hasn't happened yet).
  useEffect(() => {
    if (!profile?.familyId) return;
    const dow = family?.meetingSetup?.schedule?.dayOfWeek;
    return subscribeMeetingSubmissions(profile.familyId, (subs) => {
      setStaleSubs(subs.filter((s) => !isCurrentCycle(s, dow)));
    });
  }, [profile?.familyId, family?.meetingSetup?.schedule?.dayOfWeek]);

  // Group stale prep into weeks; skip any cycle that DID end in a saved
  // meeting within ±3 days (it closed — just maybe a day late).
  const amberWeeks = useMemo(() => {
    const near = (a: string, b: string) => {
      const ta = new Date(`${a}T00:00:00`).getTime();
      const tb = new Date(`${b}T00:00:00`).getTime();
      return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) <= 3 * 86400000;
    };
    const groups = new Map<string, { key: string; names: string[] }>();
    for (const s of staleSubs) {
      const key = s.cycleKey || 'earlier';
      const g = groups.get(key) || { key, names: [] };
      if (s.name && !g.names.includes(s.name)) g.names.push(s.name);
      groups.set(key, g);
    }
    return Array.from(groups.values())
      .filter((g) => g.key === 'earlier' || !meetings.some((m) => near(m.date, g.key)))
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [staleSubs, meetings]);

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
    <div className="flex gap-2 overflow-x-auto -mx-1 px-1">
      {(['submission', 'new', 'past', 'highlights'] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          className={`flex-1 lg:flex-none lg:px-4 h-10 px-2 rounded-kaya-sm text-[13px] font-semibold whitespace-nowrap transition-colors ${
            tab === t ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'
          }`}
        >
          {t === 'submission' ? '📝 Submission' : t === 'new' ? '✨ New' : t === 'past' ? `📁 Past (${meetings.length})` : '🔥 Highlights'}
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

        {/* Prep card now lives in its own Submission tab (below). */}

        {/* Today's closing song — parent or leader-of-day (shared card). */}
        <TodaysSongCard className="mb-4" />

        {/* Schedule reminder banner — only on the family's meeting day. */}
        {scheduleReminder && (
          <Link
            href="/meetings/present"
            className="mb-3 block bg-kaya-gold/15 border-2 border-kaya-gold rounded-kaya-lg p-4 hover:bg-kaya-gold/25 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="text-2xl shrink-0" aria-hidden>⏰</div>
              <div className="flex-1 min-w-0">
                <div className="font-display font-extrabold text-[13px] text-kaya-chocolate leading-tight">
                  Meeting tonight at {scheduleReminder.time}
                </div>
                <div className="text-[11px] text-kaya-chocolate/70 mt-0.5">
                  Your usual {scheduleReminder.dayName} family meeting. Tap to start.
                </div>
              </div>
              <span className="shrink-0 text-kaya-chocolate font-extrabold text-sm">→</span>
            </div>
          </Link>
        )}

        {/* Presenter Mode CTA — the recommended way to run the meeting,
            cast-friendly with the new 6-step Attendance → Gratitude →
            Celebrate → Appreciations → Goals → Closing Reflection flow. */}
        <Link
          href="/meetings/present"
          className="mb-3 block bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-kaya-gold-light rounded-kaya-lg p-5 hover:brightness-110 transition-all"
        >
          <p className="text-[10px] uppercase tracking-[0.18em] font-bold opacity-80 mb-1">
            Start the meeting
          </p>
          <h2 className="font-display font-black text-xl leading-tight mb-1">
            🎬 Presenter Mode
          </h2>
          <p className="text-[12px] opacity-75 leading-relaxed">
            Full-screen, one step at a time — cast to a TV or prop up the phone.
          </p>
          <span className="inline-flex items-center gap-1 mt-3 text-[12px] font-bold">
            Open presenter →
          </span>
        </Link>
        <Link
          href="/settings/meetings"
          className="mb-5 block text-[12px] text-kaya-sand hover:text-kaya-chocolate text-center font-bold"
        >
          ⚙️ Customize agenda + prayer library
        </Link>

        <div className="mb-5"><Tabs /></div>

        {tab === 'submission' ? (
          myPrep ? (
            <MeetingPrepCard {...myPrep} />
          ) : (
            <div className="bg-white border border-kaya-warm-dark rounded-kaya p-6 text-center">
              <p className="text-3xl mb-2">📝</p>
              <p className="text-kaya-sand text-sm">Your meeting prep will show here on prep day.</p>
            </div>
          )
        ) : tab === 'new' ? (
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
        ) : tab === 'past' ? (
          <div className="space-y-3">
            {/* SM3.1 (#5b) — status filter */}
            <div className="flex gap-2 mb-1">
              {([['all', 'All'], ['green', '🟢 Held'], ['amber', '🟡 Unfinished']] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setStatusFilter(k)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${statusFilter === k ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'}`}>
                  {label}
                </button>
              ))}
            </div>
            {statusFilter !== 'green' && amberWeeks.map((w) => (
              <div key={w.key} className="bg-amber-50 border-2 border-amber-300 rounded-kaya p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-bold text-sm">{w.key === 'earlier' ? 'An earlier week' : fmtMeetingDay(w.key)}</p>
                  <span className="text-base" aria-label="Started, never closed">🟡</span>
                </div>
                <p className="text-xs text-amber-800 font-semibold">
                  Started · never closed{w.names.length > 0 ? ` — prep by ${w.names.join(', ')}` : ''}
                </p>
                <Link href="/meetings/present" className="inline-block mt-2 text-xs font-black text-kaya-chocolate underline underline-offset-2">
                  Resume in presenter →
                </Link>
              </div>
            ))}
            {statusFilter === 'amber' && amberWeeks.length === 0 && (
              <div className="bg-white border border-kaya-warm-dark rounded-kaya p-6 text-center">
                <p className="text-kaya-sand text-sm">No unfinished weeks 🎉</p>
              </div>
            )}
            {statusFilter !== 'amber' && (meetings.length === 0 ? (
              <div className="bg-white border border-kaya-warm-dark rounded-kaya p-6 text-center">
                <p className="text-3xl mb-2">📝</p>
                <p className="text-kaya-sand text-sm">No meetings logged yet</p>
              </div>
            ) : (
              meetings.map((m) => (
                <div key={m.id}>
                  <button type="button" onClick={() => setReportMeeting(m)}
                    className="w-full text-left bg-white border-2 border-emerald-300/70 rounded-kaya p-4 hover:border-emerald-400 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-bold text-sm">🟢 {fmtMeetingDay(m.date)}</p>
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
                    <p className="mt-2 text-[11px] font-black text-kaya-chocolate/70">📖 Open report →</p>
                  </button>
                  {/* Meeting Notes — the full structured record (2026-06-21). */}
                  <Link href={`/meetings/notes/${m.id}`}
                    className="block text-right text-[11px] font-black text-kaya-gold-dark hover:underline mt-1 pr-1">
                    🗒️ Full Meeting Notes →
                  </Link>
                </div>
              ))
            ))}
          </div>
        ) : (
          <HighlightsPane
            meetings={meetings}
            childrenList={children}
            scheduleDow={family?.meetingSetup?.schedule?.dayOfWeek}
            familyId={profile?.familyId}
          />
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

        {/* Prep card now lives in its own Submission tab (below). */}

        {/* Today's closing song — desktop (shared card), constrained width. */}
        <div className="max-w-xl mb-4"><TodaysSongCard /></div>

        {/* Schedule reminder banner — desktop, only on meeting day. */}
        {scheduleReminder && (
          <Link
            href="/meetings/present"
            className="mb-3 flex items-center gap-4 bg-kaya-gold/15 border-2 border-kaya-gold rounded-kaya-lg px-6 py-4 hover:bg-kaya-gold/25 transition-colors"
          >
            <div className="text-3xl shrink-0" aria-hidden>⏰</div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-extrabold text-base text-kaya-chocolate leading-tight">
                Meeting tonight at {scheduleReminder.time}
              </div>
              <div className="text-[12px] text-kaya-chocolate/70 mt-0.5">
                Your usual {scheduleReminder.dayName} family meeting. Tap to start in Presenter Mode.
              </div>
            </div>
            <span className="shrink-0 text-kaya-chocolate font-extrabold text-base">→</span>
          </Link>
        )}

        {/* Presenter Mode CTA — desktop. Same destination as the mobile
            banner above; this is the recommended way to run the meeting. */}
        <div className="mb-7 flex items-stretch gap-3">
          <Link
            href="/meetings/present"
            className="flex-1 flex items-center gap-5 bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-kaya-gold-light rounded-kaya-lg p-6 hover:brightness-110 transition-all"
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
              </p>
            </div>
            <span className="shrink-0 text-sm font-extrabold opacity-80">→</span>
          </Link>
          <Link
            href="/settings/meetings"
            className="shrink-0 w-44 flex flex-col items-center justify-center bg-white border border-kaya-warm-dark text-kaya-chocolate rounded-kaya-lg p-5 hover:border-kaya-chocolate hover:bg-kaya-warm transition-colors text-center"
          >
            <div className="text-2xl mb-1" aria-hidden>⚙️</div>
            <div className="font-display font-extrabold text-[13px] leading-tight">Meeting setup</div>
            <div className="text-[11px] text-kaya-sand mt-0.5">Agenda + prayers</div>
          </Link>
        </div>

        {tab === 'submission' ? (
          myPrep ? (
            <div className="max-w-xl"><MeetingPrepCard {...myPrep} /></div>
          ) : (
            <div className="max-w-xl bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-8 text-center">
              <p className="text-4xl mb-2">📝</p>
              <p className="text-kaya-sand text-sm">Your meeting prep will show here on prep day.</p>
            </div>
          )
        ) : tab === 'new' ? (
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
        ) : tab === 'past' ? (
          // Past meetings (desktop) — chips + 🟡 unfinished weeks + 🟢 report cards (SM3.1 · #5)
          <div>
            <div className="flex gap-2 mb-4">
              {([['all', 'All'], ['green', '🟢 Held'], ['amber', '🟡 Unfinished']] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setStatusFilter(k)}
                  className={`px-3.5 py-2 rounded-full text-[12px] font-bold transition-colors ${statusFilter === k ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'}`}>
                  {label}
                </button>
              ))}
            </div>
            {meetings.length === 0 && amberWeeks.length === 0 ? (
            <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-12 text-center max-w-xl mx-auto">
              <p className="text-4xl mb-3">📝</p>
              <p className="text-kaya-sand text-sm">No meetings logged yet. Start a new one to build a record.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {statusFilter !== 'green' && amberWeeks.map((w) => (
                <div key={w.key} className="bg-amber-50 border-2 border-amber-300 rounded-kaya-lg p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-display font-bold text-base">{w.key === 'earlier' ? 'An earlier week' : fmtMeetingDay(w.key)}</p>
                    <span aria-label="Started, never closed">🟡</span>
                  </div>
                  <p className="text-[12px] text-amber-800 font-semibold">
                    Started · never closed{w.names.length > 0 ? ` — prep by ${w.names.join(', ')}` : ''}
                  </p>
                  <Link href="/meetings/present" className="inline-block mt-3 text-[12px] font-black text-kaya-chocolate underline underline-offset-2">
                    Resume in presenter →
                  </Link>
                </div>
              ))}
              {statusFilter !== 'amber' && meetings.map((m) => (
                <div key={m.id}>
                <button type="button" onClick={() => setReportMeeting(m)}
                  className="w-full text-left bg-white border-2 border-emerald-300/70 rounded-kaya-lg p-5 hover:border-emerald-400 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-display font-bold text-base">🟢 {fmtMeetingDay(m.date)}</p>
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
                  <p className="mt-3 text-[11px] font-black text-kaya-chocolate/70">📖 Open report →</p>
                </button>
                {/* Meeting Notes — the full structured record (2026-06-21). */}
                <Link href={`/meetings/notes/${m.id}`}
                  className="block text-right text-[11px] font-black text-kaya-gold-dark hover:underline mt-1 pr-1">
                  🗒️ Full Meeting Notes →
                </Link>
                </div>
              ))}
            </div>
          )}
          </div>
        ) : (
          <HighlightsPane
            meetings={meetings}
            childrenList={children}
            scheduleDow={family?.meetingSetup?.schedule?.dayOfWeek}
            familyId={profile?.familyId}
          />
        )}
        <NextUp from="meetings" />
      </div>
      {reportMeeting && profile?.familyId && (
        <MeetingReportSheet
          meeting={reportMeeting}
          childrenList={children}
          familyId={profile.familyId}
          onClose={() => setReportMeeting(null)}
        />
      )}
      <CoachMark
        pageId="meetings"
        uid={profile?.uid || ''}
        title="Three noticed, two to shape"
        body="Plan twenty minutes for Sunday. Three things you noticed, two to shape next week. The single most powerful family habit."
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 🔥 HIGHLIGHTS (SM3.1 · #6) — the meeting streak the family protects
// together + ✨ memories resurfaced from the record. A week "counts" when a
// finished meeting doc lands in it (amber/unfinished weeks break the streak
// — a streak means FINISHED meetings). Memories rotate daily but stay
// stable within a day, so the family sees fresh gems each Sunday.
// ─────────────────────────────────────────────────────────────────────────

function HighlightsPane({ meetings, childrenList, scheduleDow, familyId }: {
  meetings: Meeting[];
  childrenList: Array<{ id: string; name: string; avatarEmoji?: string }>;
  scheduleDow?: number;
  familyId?: string;
}) {
  const [span, setSpan] = useState<'year' | '6mo' | 'month'>('year');

  // Highlights 2.0 (2026-07-05) — the hub list caps at 20 meetings, but
  // year/month analytics need the archive. Loaded once when the tab
  // mounts; until it lands we compute from the 20 already in hand.
  const [allMeetings, setAllMeetings] = useState<Meeting[] | null>(null);
  const [history, setHistory] = useState<SubmissionHistoryDoc[]>([]);
  useEffect(() => {
    if (!familyId) return;
    getAllMeetings(familyId).then(setAllMeetings).catch(() => {});
    getAllMeetingSubmissionHistory(familyId).then(setHistory).catch(() => {});
  }, [familyId]);
  const source = allMeetings ?? meetings;

  // Filters — a specific year / month / member scopes the stats below.
  const [yearFilter, setYearFilter] = useState<'all' | number>('all');
  const [monthFilter, setMonthFilter] = useState<'all' | number>('all'); // 0-11
  const [memberFilter, setMemberFilter] = useState<'all' | string>('all'); // child id or history uid

  const yearsAvailable = useMemo(() => {
    const ys = new Set<number>();
    for (const m of source) {
      const y = Number((m.date || '').slice(0, 4));
      if (Number.isFinite(y) && y > 2000) ys.add(y);
    }
    return Array.from(ys).sort((a, b) => b - a);
  }, [source]);

  const inScope = (dateStr: string): boolean => {
    if (!dateStr) return false;
    if (yearFilter !== 'all' && Number(dateStr.slice(0, 4)) !== yearFilter) return false;
    if (monthFilter !== 'all' && Number(dateStr.slice(5, 7)) - 1 !== monthFilter) return false;
    return true;
  };
  const scoped = useMemo(
    () => source.filter((m) => inScope(m.date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, yearFilter, monthFilter],
  );

  const pad = (n: number) => String(n).padStart(2, '0');
  const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // Week key = the calendar date of that week's meeting day (defaults Sunday).
  const weekKeyOf = (dateStr: string): string => {
    const d = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(d.getTime())) return dateStr;
    const dow = typeof scheduleDow === 'number' ? scheduleDow : 0;
    const delta = (d.getDay() - dow + 7) % 7;
    d.setDate(d.getDate() - delta);
    return isoOf(d);
  };
  const stepWeeks = (key: string, weeks: number): string => {
    const d = new Date(`${key}T00:00:00`);
    d.setDate(d.getDate() + weeks * 7);
    return isoOf(d);
  };

  const { currentStreak, longestStreak, yearCount, dots, attendancePct } = useMemo(() => {
    // Current + longest streak always run on the FULL archive — a filter
    // scopes the stats, never the streak itself.
    const have = new Set(source.map((m) => weekKeyOf(m.date)));
    const now = new Date();
    const thisWeek = weekKeyOf(isoOf(now));
    // Current streak — grace for a this-week meeting that hasn't happened yet.
    let cur = 0;
    let cursor = have.has(thisWeek) ? thisWeek : stepWeeks(thisWeek, -1);
    while (have.has(cursor)) { cur += 1; cursor = stepWeeks(cursor, -1); }
    // Longest run ever.
    const keys = Array.from(have).sort();
    let longest = 0; let run = 0; let prev = '';
    for (const k of keys) {
      run = prev && stepWeeks(prev, 1) === k ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = k;
    }
    const statYear = yearFilter === 'all' ? now.getFullYear() : yearFilter;
    const yearCount = keys.filter((k) => k.startsWith(String(statYear))).length;
    // Streak map — a chosen year shows that year's weeks; otherwise the
    // rolling span ending this week (as before).
    const dots: Array<{ key: string; on: boolean }> = [];
    if (yearFilter !== 'all') {
      let k = weekKeyOf(`${yearFilter}-01-04`);
      const end = yearFilter === now.getFullYear() ? thisWeek : weekKeyOf(`${yearFilter}-12-28`);
      let guard = 0;
      while (k <= end && guard < 54) { dots.push({ key: k, on: have.has(k) }); k = stepWeeks(k, 1); guard++; }
    } else {
      const n = span === 'year' ? 52 : span === '6mo' ? 26 : 5;
      for (let i = n - 1; i >= 0; i--) {
        const k = stepWeeks(thisWeek, -i);
        dots.push({ key: k, on: have.has(k) });
      }
    }
    // Attendance — average share of the kid roster present, over the
    // scoped meetings (parents/guests tracked separately; kids are the
    // stable roster).
    const roster = Math.max(1, childrenList.length);
    const rates = scoped.map((m) => Math.min(1, (m.attendees?.length ?? 0) / roster));
    const attendancePct = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) : null;
    return { currentStreak: cur, longestStreak: longest, yearCount, dots, attendancePct };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, scoped, span, scheduleDow, yearFilter, childrenList.length]);

  const memories = useMemo(() => {
    const kidName = (id: string) => childrenList.find((c) => c.id === id)?.name || 'Someone';
    const out: Array<{ emoji: string; title: string; text: string; date: string }> = [];
    for (const m of meetings) {
      for (const [cid, txt] of Object.entries(m.gratitude || {})) {
        if ((txt || '').trim()) out.push({ emoji: '🙏', title: `${kidName(cid)}'s gratitude`, text: txt, date: m.date });
      }
      for (const [cid, txt] of Object.entries(m.appreciations || {})) {
        if ((txt || '').trim()) out.push({ emoji: '💛', title: `${kidName(cid)} appreciated`, text: txt, date: m.date });
      }
      for (const [cid, txt] of Object.entries(m.goals || {})) {
        if ((txt || '').trim() && m.goalsDone?.[cid] === true) {
          out.push({ emoji: '🎯', title: `Goal kept by ${kidName(cid)}`, text: txt, date: m.date });
        }
      }
      if (m.openingWord?.note) out.push({ emoji: '🕊️', title: 'An opening word', text: m.openingWord.note, date: m.date });
    }
    const now = new Date();
    const yearAgo = new Date(now); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const near = meetings.find((m) => {
      const d = new Date(`${m.date}T00:00:00`);
      return !Number.isNaN(d.getTime()) && Math.abs(d.getTime() - yearAgo.getTime()) <= 10 * 86400000;
    });
    if (near) out.unshift({ emoji: '🕰️', title: 'A year ago this week', text: `You met on ${fmtMeetingDay(near.date)} — the ritual holds.`, date: near.date });
    if (out.length === 0) return [];
    const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
    const start = dayOfYear % out.length;
    const picks: typeof out = [];
    for (let i = 0; i < Math.min(4, out.length); i++) picks.push(out[(start + i) % out.length]);
    return picks;
  }, [meetings, childrenList]);

  const nextMilestone = [5, 10, 25, 52].find((m) => m > currentStreak);

  // ── Per-member stats (Highlights 2.0) ──────────────────────────────
  // Two sources, merged by display name:
  //  • meetings — kid-keyed gratitude/goals/goalsDone/attendees
  //  • submission-history — every submitter (parents + helpers + kids):
  //    gratitudes, appreciations (+tag names = who received), goals
  //    reflection (done flags)
  type MemberStat = {
    id: string; name: string; emoji: string;
    gratitude: number; apprGiven: number; apprReceived: number;
    goalsSet: number; goalsKept: number;
    lastAppreciatedAt: string | null;
  };
  const memberStats = useMemo<MemberStat[]>(() => {
    const byName = new Map<string, MemberStat>();
    const ensure = (id: string, name: string, emoji?: string): MemberStat => {
      const key = name.trim().toLowerCase();
      let s = byName.get(key);
      if (!s) {
        s = { id, name: name.trim(), emoji: emoji || '👤', gratitude: 0, apprGiven: 0, apprReceived: 0, goalsSet: 0, goalsKept: 0, lastAppreciatedAt: null };
        byName.set(key, s);
      } else if (emoji && s.emoji === '👤') s.emoji = emoji;
      return s;
    };
    for (const c of childrenList) ensure(c.id, c.name, c.avatarEmoji);
    // From meetings (kids)
    for (const m of scoped) {
      for (const [cid, txt] of Object.entries(m.gratitude || {})) {
        const c = childrenList.find((x) => x.id === cid);
        if (c && (txt || '').trim()) ensure(c.id, c.name, c.avatarEmoji).gratitude += 1;
      }
      for (const [cid, txt] of Object.entries(m.goals || {})) {
        const c = childrenList.find((x) => x.id === cid);
        if (!c || !(txt || '').trim()) continue;
        const s = ensure(c.id, c.name, c.avatarEmoji);
        s.goalsSet += 1;
        if (m.goalsDone?.[cid] === true) s.goalsKept += 1;
      }
    }
    // From submission history (everyone)
    for (const doc of history) {
      const giver = ensure(doc.uid, doc.name || 'Member', doc.emoji);
      for (const e of doc.entries || []) {
        if (!inScope(e.date)) continue;
        giver.gratitude += (e.gratitudes || []).filter((t) => (t || '').trim()).length;
        const apprs = (e.appreciations || []).filter((t) => (t || '').trim());
        giver.apprGiven += apprs.length;
        for (const tagName of e.appreciationTagNames || []) {
          if (!tagName) continue;
          for (const nm of tagName.split(/,|&|\band\b/i).map((x) => x.replace('@', '').trim()).filter(Boolean)) {
            if (/^everyone$|^all$/i.test(nm)) {
              for (const s of Array.from(byName.values())) {
                if (s === giver) continue;
                s.apprReceived += 1;
                if (!s.lastAppreciatedAt || e.date > s.lastAppreciatedAt) s.lastAppreciatedAt = e.date;
              }
            } else {
              const s = ensure(nm, nm);
              s.apprReceived += 1;
              if (!s.lastAppreciatedAt || e.date > s.lastAppreciatedAt) s.lastAppreciatedAt = e.date;
            }
          }
        }
        for (const g of e.goalsReflection || []) {
          if (!(g.text || '').trim()) continue;
          giver.goalsSet += 1;
          if (g.done) giver.goalsKept += 1;
        }
      }
    }
    return Array.from(byName.values())
      .filter((s) => s.gratitude + s.apprGiven + s.apprReceived + s.goalsSet > 0 || childrenList.some((c) => c.id === s.id))
      .sort((a, b) => (b.gratitude + b.apprGiven + b.goalsSet) - (a.gratitude + a.apprGiven + a.goalsSet));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, history, childrenList, yearFilter, monthFilter]);

  const visibleStats = memberFilter === 'all'
    ? memberStats
    : memberStats.filter((s) => s.id === memberFilter || s.name.toLowerCase() === memberFilter.toLowerCase());

  // ── Trends + Kaya's read (deterministic — instant, no API) ─────────
  const trends = useMemo(() => {
    const kept = memberStats.reduce((a, s) => a + s.goalsKept, 0);
    const set = memberStats.reduce((a, s) => a + s.goalsSet, 0);
    const goalsPct = set > 0 ? Math.round((kept / set) * 100) : null;
    // Gratitude this month vs last (always current-calendar, unfiltered).
    const now = new Date();
    const mk = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const thisM = mk(now);
    const lastM = mk(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    let gThis = 0; let gLast = 0;
    for (const m of source) {
      const key = (m.date || '').slice(0, 7);
      const n = Object.values(m.gratitude || {}).filter((t) => (t || '').trim()).length;
      if (key === thisM) gThis += n; else if (key === lastM) gLast += n;
    }
    for (const doc of history) for (const e of doc.entries || []) {
      const key = (e.date || '').slice(0, 7);
      const n = (e.gratitudes || []).filter((t) => (t || '').trim()).length;
      if (key === thisM) gThis += n; else if (key === lastM) gLast += n;
    }
    const gratitudeDelta = gLast > 0 ? Math.round(((gThis - gLast) / gLast) * 100) : null;
    // Least-recently appreciated member (who gives but isn't received).
    const active = memberStats.filter((s) => s.apprGiven > 0 || s.apprReceived > 0 || s.goalsSet > 0);
    let coldest: MemberStat | null = null;
    for (const s of active) {
      if (!coldest) { coldest = s; continue; }
      const a = s.lastAppreciatedAt || '0000';
      const b = coldest.lastAppreciatedAt || '0000';
      if (a < b) coldest = s;
    }
    const weeksSince = coldest?.lastAppreciatedAt
      ? Math.floor((Date.now() - new Date(`${coldest.lastAppreciatedAt}T00:00:00`).getTime()) / (7 * 86400000))
      : null;
    return { goalsPct, kept, set, gThis, gLast, gratitudeDelta, coldest, weeksSince };
  }, [memberStats, source, history]);

  const suggestions = useMemo(() => {
    const out: Array<{ icon: string; title: string; text: string }> = [];
    if (longestStreak > currentStreak && longestStreak - currentStreak <= 6 && currentStreak >= 3) {
      out.push({ icon: '🔥', title: `${longestStreak - currentStreak + 1} week${longestStreak - currentStreak === 0 ? '' : 's'} from a record`, text: `You're on a ${currentStreak}-week streak — keep meeting to beat your all-time best of ${longestStreak}.` });
    } else if (currentStreak >= 3 && currentStreak >= longestStreak) {
      out.push({ icon: '🏆', title: 'You ARE the record', text: `${currentStreak} weeks in a row — every Sunday now extends your all-time best. Protect the ritual.` });
    }
    const struggling = memberStats.filter((s) => s.goalsSet >= 3 && s.goalsKept / s.goalsSet < 0.55).sort((a, b) => a.goalsKept / a.goalsSet - b.goalsKept / b.goalsSet)[0];
    if (struggling) out.push({ icon: '🎯', title: `${struggling.name}'s goals need a nudge`, text: `${struggling.goalsKept} of ${struggling.goalsSet} goals kept. Try setting one smaller, very doable goal together this Sunday.` });
    if (trends.gratitudeDelta != null && trends.gratitudeDelta <= -25) {
      out.push({ icon: '🙏', title: 'Gratitude is dipping', text: `${Math.abs(trends.gratitudeDelta)}% fewer gratitude entries than last month. A one-line prompt on prep day usually bounces it back.` });
    }
    if (trends.coldest && trends.weeksSince != null && trends.weeksSince >= 4) {
      out.push({ icon: '💛', title: 'Spread the love', text: `${trends.coldest.name} hasn't been appreciated in ${trends.weeksSince} weeks${trends.coldest.apprGiven > 0 ? ' — and they give plenty' : ''}. Worth a shout-out this week.` });
    }
    if (out.length < 3 && trends.goalsPct != null && trends.goalsPct >= 70) {
      out.push({ icon: '🌟', title: 'Goals are landing', text: `${trends.goalsPct}% of family goals kept — that's real follow-through. Celebrate it out loud at the next meeting.` });
    }
    if (out.length < 3 && attendancePct != null && attendancePct >= 90) {
      out.push({ icon: '👨‍👩‍👧‍👦', title: 'Everyone shows up', text: `${attendancePct}% attendance — the whole crew treats this as sacred time. That consistency is the win.` });
    }
    if (out.length === 0) {
      out.push({ icon: '🌱', title: 'Keep building the habit', text: 'Hold a few more meetings and Kaya will start spotting streak runs, goal patterns and who needs a shout-out.' });
    }
    return out.slice(0, 4);
  }, [memberStats, trends, currentStreak, longestStreak, attendancePct]);

  return (
    <div className="space-y-4">
      {/* 🔥 Streak card */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-5">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand">🔥 Meeting streak</p>
            <p className="font-display font-black text-2xl mt-0.5">
              {currentStreak} week{currentStreak === 1 ? '' : 's'} in a row
            </p>
            <p className="text-[12px] text-kaya-sand font-semibold mt-0.5">
              Longest ever: {longestStreak} · {yearFilter === 'all' ? 'This year' : yearFilter}: {yearCount} meeting{yearCount === 1 ? '' : 's'}
              {attendancePct != null ? ` · attendance ${attendancePct}%` : ''}
              {nextMilestone ? ` · next milestone: ${nextMilestone} 🎉` : ' · every milestone hit 🏆'}
            </p>
          </div>
          <div className="flex gap-1.5">
            {([['year', 'Year'], ['6mo', '6 months'], ['month', 'Month']] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setSpan(k)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${span === k ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-[3px] mt-4" aria-label="Weeks with a held meeting">
          {dots.map((d) => (
            <span key={d.key} title={fmtMeetingDay(d.key)}
              className={`w-2.5 h-2.5 rounded-[3px] ${d.on ? 'bg-emerald-500' : 'bg-kaya-warm'}`} />
          ))}
        </div>
        <p className="text-[10.5px] text-kaya-sand mt-2">
          A week counts when its meeting was held &amp; closed — unfinished weeks break the streak.
        </p>
      </div>

      {/* 🔎 Filters — slice the stats by year / month / member */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-2.5">🔎 Check the streak &amp; stats</p>
        <div className="flex flex-wrap gap-2">
          <select
            value={String(yearFilter)}
            onChange={(e) => setYearFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="text-[13px] font-bold border border-kaya-warm-dark rounded-kaya-sm px-3 py-2 bg-white text-kaya-chocolate"
            aria-label="Filter by year"
          >
            <option value="all">📅 All time</option>
            {yearsAvailable.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            value={String(monthFilter)}
            onChange={(e) => setMonthFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="text-[13px] font-bold border border-kaya-warm-dark rounded-kaya-sm px-3 py-2 bg-white text-kaya-chocolate"
            aria-label="Filter by month"
          >
            <option value="all">All months</option>
            {['January','February','March','April','May','June','July','August','September','October','November','December'].map((mn, i) => (
              <option key={mn} value={i}>{mn}</option>
            ))}
          </select>
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            className="text-[13px] font-bold border border-kaya-warm-dark rounded-kaya-sm px-3 py-2 bg-white text-kaya-chocolate"
            aria-label="Filter by member"
          >
            <option value="all">👨‍👩‍👧‍👦 Whole family</option>
            {memberStats.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {(yearFilter !== 'all' || monthFilter !== 'all' || memberFilter !== 'all') && (
            <button
              type="button"
              onClick={() => { setYearFilter('all'); setMonthFilter('all'); setMemberFilter('all'); }}
              className="text-[12px] font-black text-kaya-sand hover:text-kaya-chocolate px-2"
            >
              ✕ Clear
            </button>
          )}
        </div>
        {allMeetings === null && (
          <p className="text-[10.5px] text-kaya-sand mt-2">Loading the full meeting archive…</p>
        )}
      </div>

      {/* 👥 Per member */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-3">
          👥 Per member{yearFilter !== 'all' ? ` · ${yearFilter}` : ''}{monthFilter !== 'all' ? ` · ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][monthFilter]}` : ''}
        </p>
        {visibleStats.length === 0 ? (
          <p className="text-[13px] text-kaya-sand">No entries in this period yet — try widening the filters.</p>
        ) : (
          <div className="space-y-3">
            {visibleStats.map((s) => (
              <div key={s.id} className="flex items-start gap-3 pb-3 border-b border-kaya-warm-dark/50 last:border-b-0 last:pb-0">
                <div className="w-8 h-8 rounded-full bg-kaya-warm grid place-items-center text-base shrink-0">{s.emoji}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[14px]">{s.name}</p>
                  <p className="text-[12px] text-kaya-sand font-semibold leading-relaxed">
                    🙏 {s.gratitude} gratitude · 💛 {s.apprGiven} given / {s.apprReceived} received
                    {s.goalsSet > 0 && (
                      <> · 🎯 {s.goalsKept}/{s.goalsSet} goals kept
                        {s.goalsSet >= 3 && s.goalsKept / s.goalsSet < 0.55 && <span className="text-rose-500 font-black"> ◀ needs a nudge</span>}
                      </>
                    )}
                  </p>
                  {s.goalsSet > 0 && (
                    <div className="h-1.5 rounded-full bg-kaya-warm mt-1.5 overflow-hidden">
                      <span className="block h-full bg-emerald-500" style={{ width: `${Math.round((s.goalsKept / s.goalsSet) * 100)}%` }} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 📈 Trends */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-3">📈 Trends</p>
        <div className="space-y-3.5">
          <div>
            <div className="flex items-baseline justify-between">
              <p className="text-[13px] font-bold">🎯 Goals kept — family</p>
              <p className="text-[12px] text-kaya-sand font-semibold">{trends.goalsPct != null ? `${trends.goalsPct}% (${trends.kept}/${trends.set})` : 'no goals yet'}</p>
            </div>
            {trends.goalsPct != null && (
              <div className="h-2 rounded-full bg-kaya-warm mt-1.5 overflow-hidden">
                <span className="block h-full bg-emerald-500" style={{ width: `${trends.goalsPct}%` }} />
              </div>
            )}
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <p className="text-[13px] font-bold">🙏 Gratitude this month</p>
              <p className="text-[12px] text-kaya-sand font-semibold">
                {trends.gThis} entr{trends.gThis === 1 ? 'y' : 'ies'}
                {trends.gratitudeDelta != null ? ` · ${trends.gratitudeDelta >= 0 ? '▲' : '▼'} ${Math.abs(trends.gratitudeDelta)}% vs last` : ''}
              </p>
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <p className="text-[13px] font-bold">💛 Appreciation spread</p>
              <p className="text-[12px] text-kaya-sand font-semibold">
                {trends.coldest && trends.weeksSince != null && trends.weeksSince >= 2
                  ? `${trends.coldest.name} — ${trends.weeksSince}w since last`
                  : 'everyone recently appreciated 💛'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 🤖 Kaya's read */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-3">🤖 Kaya&rsquo;s read — this week&rsquo;s suggestions</p>
        <div className="space-y-2.5">
          {suggestions.map((sg, i) => (
            <div key={i} className="flex gap-3 rounded-kaya bg-kaya-cream/60 border border-kaya-warm-dark/60 p-3.5">
              <div className="text-xl shrink-0" aria-hidden>{sg.icon}</div>
              <div className="min-w-0">
                <p className="font-bold text-[13.5px] leading-tight">{sg.title}</p>
                <p className="text-[12.5px] text-kaya-sand leading-relaxed mt-0.5">{sg.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ✨ Memories */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-3">✨ From your meetings — today&rsquo;s picks</p>
        {memories.length === 0 ? (
          <p className="text-[13px] text-kaya-sand">Hold a few meetings and the gems will start appearing here — gratitude, kept goals, opening words, anniversaries.</p>
        ) : (
          <div className="space-y-2.5">
            {memories.map((mm, i) => (
              <div key={`${mm.date}-${i}`} className="rounded-kaya bg-kaya-cream/60 border border-kaya-warm-dark/60 p-3.5">
                <p className="text-[13px] text-kaya-chocolate leading-relaxed">
                  {mm.emoji} <span className="font-bold">{mm.title}:</span> &ldquo;{mm.text}&rdquo;
                </p>
                <p className="text-[10.5px] text-kaya-sand font-semibold mt-1">{fmtMeetingDay(mm.date)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
