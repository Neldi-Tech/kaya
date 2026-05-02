'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { createMeeting, getMeetings, Meeting, todayString } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';

const BASE_AGENDA = [
  { step: 'Gratitude circle', icon: '🙏', desc: 'Each person shares something thankful', hasInputs: 'gratitude' },
  { step: 'Celebrate wins', icon: '🎉', desc: 'Review top scorers and good behaviors', hasInputs: null },
  { step: 'Points review', icon: '📊', desc: 'Go through weekly performance', hasInputs: null, requiresFullPoints: true },
  { step: 'Problem solving', icon: '🤝', desc: 'Discuss challenges together', hasInputs: null },
  { step: 'Goals for next week', icon: '🎯', desc: 'Each child sets one goal', hasInputs: 'goals' },
  { step: 'Fun activity vote', icon: '🗳️', desc: 'Vote on a family reward', hasInputs: 'notes' },
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

  const pointsMode = family?.pointsMode || 'full';

  // Build agenda dynamically — skip Points Review unless full mode
  const agenda = useMemo(() => {
    return BASE_AGENDA.filter((item) => {
      if (item.requiresFullPoints && pointsMode !== 'full') return false;
      return true;
    });
  }, [pointsMode]);

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

  const currentStep = agenda[activeStep];

  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4">
      <BackButton />
      <div className="mb-5">
        <h1 className="font-display text-2xl font-black">Family Meetings</h1>
        <p className="text-kaya-sand text-sm">Weekly check-ins to grow together</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {(['new', 'past'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 h-10 rounded-kaya-sm text-sm font-semibold transition-colors ${
              tab === t ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'
            }`}
          >
            {t === 'new' ? '✨ New Meeting' : `📁 Past (${meetings.length})`}
          </button>
        ))}
      </div>

      {tab === 'new' ? (
        saved ? (
          <div className="text-center pt-10 animate-slide-up">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="font-display text-xl font-black mb-2">Meeting Logged!</h2>
            <p className="text-kaya-sand text-sm">Great {meetingType === 'kid-led' ? 'kid-led' : 'family'} time together</p>
            <button
              onClick={() => { setSaved(false); setActiveStep(0); setGratitude({}); setGoals({}); setNotes(''); }}
              className="mt-4 px-6 py-2 bg-kaya-warm rounded-kaya-sm text-sm font-semibold text-kaya-sand"
            >
              Start Another
            </button>
          </div>
        ) : (
          <div>
            {/* Meeting Type Selector */}
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
                🧒 <strong>Kid-Led Mode</strong> — The children lead the meeting using the guided structure. Parents observe and support. Great for building leadership skills!
              </div>
            )}

            {pointsMode !== 'full' && (
              <div className="bg-kaya-gold/10 border border-kaya-gold/30 rounded-kaya-sm p-3 mb-4 text-xs text-kaya-gold-dark leading-relaxed">
                ℹ️ Points review step is hidden because Points Mode is set to <strong>{pointsMode === 'badges-only' ? 'Badges Only' : 'Encouragement'}</strong>
              </div>
            )}

            {/* Agenda progress */}
            <div className="flex gap-1 mb-5">
              {agenda.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i <= activeStep ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'
                  }`}
                />
              ))}
            </div>

            {/* Current agenda step */}
            {currentStep && (
              <div className="bg-white border border-kaya-warm-dark rounded-kaya p-5 mb-4">
                <div className="text-3xl mb-3">{currentStep.icon}</div>
                <h3 className="font-display text-lg font-black mb-1">{currentStep.step}</h3>
                <p className="text-kaya-sand text-sm mb-4">{currentStep.desc}</p>

                {currentStep.hasInputs === 'gratitude' && (
                  <div className="space-y-3">
                    {children.map((child) => (
                      <div key={child.id}>
                        <label className="text-xs font-semibold mb-1 block">{child.avatarEmoji} {child.name}</label>
                        <input
                          value={gratitude[child.id] || ''}
                          onChange={(e) => setGratitude({ ...gratitude, [child.id]: e.target.value })}
                          className="w-full h-10 px-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                          placeholder="I'm thankful for..."
                        />
                      </div>
                    ))}
                  </div>
                )}

                {currentStep.hasInputs === 'goals' && (
                  <div className="space-y-3">
                    {children.map((child) => (
                      <div key={child.id}>
                        <label className="text-xs font-semibold mb-1 block">{child.avatarEmoji} {child.name}</label>
                        <input
                          value={goals[child.id] || ''}
                          onChange={(e) => setGoals({ ...goals, [child.id]: e.target.value })}
                          className="w-full h-10 px-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                          placeholder="My goal is..."
                        />
                      </div>
                    ))}
                  </div>
                )}

                {currentStep.hasInputs === 'notes' && (
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full h-24 px-3 py-2 bg-kaya-cream rounded-kaya-sm text-sm resize-none focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                    placeholder="Meeting notes, votes, decisions..."
                  />
                )}
              </div>
            )}

            {/* Navigation */}
            <div className="flex gap-3">
              {activeStep > 0 && (
                <button
                  onClick={() => setActiveStep(activeStep - 1)}
                  className="h-11 px-5 bg-kaya-warm rounded-kaya-sm text-sm font-semibold text-kaya-sand"
                >
                  Back
                </button>
              )}
              {activeStep < agenda.length - 1 ? (
                <button
                  onClick={() => setActiveStep(activeStep + 1)}
                  className="flex-1 h-11 bg-kaya-gold text-white rounded-kaya-sm font-bold text-sm"
                >
                  Next Step →
                </button>
              ) : (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 h-11 bg-kaya-chocolate text-white rounded-kaya-sm font-bold text-sm disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Finish Meeting ✅'}
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
                  <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                    m.type === 'kid-led'
                      ? 'bg-orange-50 text-orange-600'
                      : 'bg-kaya-warm text-kaya-sand'
                  }`}>
                    {m.type === 'kid-led' ? '🧒 Kid-Led' : '👨‍👩‍👧‍👦 Weekly'}
                  </span>
                </div>
                {m.notes && <p className="text-xs text-kaya-sand">{m.notes}</p>}
                {Object.keys(m.goals || {}).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-kaya-warm-dark">
                    <p className="text-[10px] text-kaya-sand font-semibold uppercase mb-1">Goals Set</p>
                    {Object.entries(m.goals).map(([childId, goal]) => {
                      const child = children.find((c) => c.id === childId);
                      return goal ? (
                        <p key={childId} className="text-xs">
                          {child?.avatarEmoji} {child?.name}: {goal}
                        </p>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
