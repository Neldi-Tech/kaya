'use client';

// Kaya Sparks · New Quest wizard (D3 · goal-first).
//
// Three steps, in this order on purpose:
//   1. 🎯 The goal  — "Where do we want to BE, and by when?"  The honest
//      starting point is asked SEPARATELY, marked parent-only, and is
//      written to `sparks_quest_private` — never onto the quest, never
//      onto a kid surface, never quoted back by AI (F7 · R6).
//   2. 🗓 The rhythm — difficulty, minutes/day, active days (the rest is
//      declared REST, which can never count as a miss), cutoff time.
//   3. 📈 The markers — 1–3 measurable checks, because counting steps
//      measures obedience and markers measure growth (F8).
//
// Parents only. The wizard creates the quest; the pathway is built on
// the quest's own page (one batch approval · D4).

import { useState } from 'react';
import type { DayOfWeek } from '@/lib/firestore';
import {
  createQuest, DIFFICULTY_META, DEFAULT_ACTIVE_DAYS, DEFAULT_CUTOFF,
  QUEST_COLOURS, QUEST_EMOJIS, dayLabel,
  type QuestDifficulty, type QuestMarker, type QuestVisibility, type MarkerKind,
} from '@/lib/sparks/quests';

const ALL_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

interface Props {
  familyId: string;
  kidId: string;
  kidName: string;
  onClose: () => void;
  onCreated: (questId: string) => void;
}

export default function NewQuestWizard({ familyId, kidId, kidName, onClose, onCreated }: Props) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── 1 · goal ──
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [deadline, setDeadline] = useState('');
  const [startingPoint, setStartingPoint] = useState('');
  const [emoji, setEmoji] = useState('🚀');
  const [colour, setColour] = useState(QUEST_COLOURS[0]);

  // ── 2 · rhythm ──
  const [difficulty, setDifficulty] = useState<QuestDifficulty>('medium');
  const [minutes, setMinutes] = useState(DIFFICULTY_META.medium.minutes);
  const [activeDays, setActiveDays] = useState<DayOfWeek[]>(DEFAULT_ACTIVE_DAYS);
  const [cutoff, setCutoff] = useState(DEFAULT_CUTOFF);

  // ── 3 · markers + visibility ──
  const [markers, setMarkers] = useState<QuestMarker[]>([
    { id: 'm1', label: '', kind: 'rubric' },
  ]);
  const [visibility, setVisibility] = useState<QuestVisibility>('private');

  const restDays = ALL_DAYS.filter((d) => !activeDays.includes(d));
  const canNext1 = title.trim().length > 1 && goal.trim().length > 4;
  const canNext2 = activeDays.length > 0;
  const cleanMarkers = markers.filter((m) => m.label.trim().length > 1);

  function pickDifficulty(d: QuestDifficulty) {
    setDifficulty(d);
    setMinutes(DIFFICULTY_META[d].minutes);
  }

  function toggleDay(d: DayOfWeek) {
    setActiveDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  function setMarker(i: number, patch: Partial<QuestMarker>) {
    setMarkers((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  async function submit() {
    setSaving(true);
    setError('');
    try {
      const id = await createQuest(familyId, {
        kidId,
        title: title.trim(),
        goal: goal.trim(),
        deadline: deadline || undefined,
        difficulty,
        emoji,
        colour,
        minutesPerDay: minutes,
        activeDays,
        cutoffHHmm: cutoff,
        visibility,
        markers: cleanMarkers.map((m, i) => ({ ...m, id: m.id || `m${i + 1}`, label: m.label.trim() })),
        startingPoint: startingPoint.trim() || undefined,
      });
      onCreated(id);
    } catch (e) {
      const msg = (e as Error).message;
      setError(
        msg === 'too-many-active'
          ? `${kidName} already has 2 quests running. Pause one first — two at a time is deliberate, so nobody drowns.`
          : 'Could not create the quest. Please try again.',
      );
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="bg-white w-full sm:max-w-lg max-h-[92vh] rounded-t-[24px] sm:rounded-[24px] overflow-hidden flex flex-col">
        {/* Head */}
        <div
          className="px-5 py-4 text-white flex items-center justify-between gap-3"
          style={{ background: 'linear-gradient(135deg, #3B2E86 0%, #5AB7D6 100%)' }}
        >
          <div className="min-w-0">
            <div className="text-[10px] font-extrabold tracking-[1.5px] opacity-85">
              NEW QUEST · STEP {step} OF 3
            </div>
            <h2 className="font-display font-extrabold text-[17px] m-0 leading-tight">
              {step === 1 && '🎯 The goal'}
              {step === 2 && '🗓 The rhythm'}
              {step === 3 && '📈 How we’ll measure it'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/20 text-white font-black shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5 overflow-y-auto flex-1">
          {/* ── STEP 1 · GOAL ─────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-[12.5px] text-[#5A6488] leading-relaxed m-0">
                Quests start with where you want {kidName} to <strong>get to</strong> — not with
                what&apos;s wrong today. {kidName} reads the goal, so write it the way you&apos;d
                say it to them.
              </p>

              <Field label="Quest name" hint="Short — this is what the tile says.">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Speak & Articulate"
                  maxLength={80}
                  className="w-full rounded-xl border border-[#ECE4D3] px-3 py-2.5 text-[14px]"
                />
              </Field>

              <Field
                label={`Where do we want ${kidName} to be?`}
                hint="The finish line, in one or two sentences."
              >
                <textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder={`Introduce himself and tell a 2-minute story to a room without freezing.`}
                  rows={3}
                  maxLength={600}
                  className="w-full rounded-xl border border-[#ECE4D3] px-3 py-2.5 text-[14px] resize-none"
                />
              </Field>

              <Field label="By when?" hint="Optional — a date to aim at.">
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="w-full rounded-xl border border-[#ECE4D3] px-3 py-2.5 text-[14px]"
                />
              </Field>

              {/* D3 · the parent-only note, visibly fenced off. */}
              <div className="rounded-xl border-2 border-dashed border-[#E8D9B5] bg-[#FFFBF0] p-3.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <span aria-hidden>🔒</span>
                  <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
                    Starting point — parents only
                  </div>
                </div>
                <p className="text-[11.5px] text-[#5A6488] leading-snug m-0 mb-2">
                  The honest version, for you and Kaya&apos;s planning. {kidName} never sees this,
                  it never appears in an export, and Kaya never repeats it back to them.
                </p>
                <textarea
                  value={startingPoint}
                  onChange={(e) => setStartingPoint(e.target.value)}
                  placeholder="Speaks fast, trails off, avoids eye contact."
                  rows={2}
                  maxLength={1200}
                  className="w-full rounded-lg border border-[#E8D9B5] bg-white px-3 py-2 text-[13px] resize-none"
                />
              </div>

              <Field label="Icon & colour">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {QUEST_EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setEmoji(e)}
                      className={`w-9 h-9 rounded-xl text-lg grid place-items-center border ${
                        emoji === e ? 'border-[#3B2E86] bg-[#DFE3FB]' : 'border-[#ECE4D3] bg-white'
                      }`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {QUEST_COLOURS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColour(c)}
                      aria-label={`Colour ${c}`}
                      className={`w-8 h-8 rounded-full border-2 ${colour === c ? 'border-[#0F1F44]' : 'border-transparent'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </Field>
            </div>
          )}

          {/* ── STEP 2 · RHYTHM ───────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <Field label="How hard should this be?" hint="Sets the daily length and how fast the pathway ramps.">
                <div className="grid gap-2">
                  {(Object.keys(DIFFICULTY_META) as QuestDifficulty[]).map((d) => {
                    const m = DIFFICULTY_META[d];
                    const on = difficulty === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => pickDifficulty(d)}
                        className={`text-left rounded-xl border px-3.5 py-3 ${
                          on ? 'border-[#3B2E86] bg-[#F2F4FE]' : 'border-[#ECE4D3] bg-white'
                        }`}
                      >
                        <div className="font-display font-extrabold text-[13.5px] text-[#0F1F44]">
                          {m.emoji} {m.label} · {m.minutes} min · ~{m.weeks} weeks
                        </div>
                        <div className="text-[11.5px] text-[#5A6488] mt-0.5 leading-snug">{m.blurb}</div>
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Minutes a day">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={3}
                    max={45}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="font-display font-extrabold text-[15px] text-[#3B2E86] w-16 text-right">
                    {minutes} min
                  </span>
                </div>
              </Field>

              <Field
                label="Which days?"
                hint="Everything you leave off is a declared rest day — it can never break a streak."
              >
                <div className="flex flex-wrap gap-1.5">
                  {ALL_DAYS.map((d) => {
                    const on = activeDays.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDay(d)}
                        className={`px-3 py-2 rounded-xl text-[12px] font-extrabold border ${
                          on
                            ? 'border-[#3B2E86] bg-[#3B2E86] text-white'
                            : 'border-[#ECE4D3] bg-white text-[#5A6488]'
                        }`}
                      >
                        {dayLabel(d)}
                      </button>
                    );
                  })}
                </div>
                {restDays.length > 0 && (
                  <div className="text-[11.5px] text-[#2E7D34] mt-2 font-bold">
                    😴 Rest days: {restDays.map(dayLabel).join(' · ')}
                  </div>
                )}
              </Field>

              <Field
                label="Daily cut-off"
                hint="After this time an open step counts as missed, and reminders go out."
              >
                <input
                  type="time"
                  value={cutoff}
                  onChange={(e) => setCutoff(e.target.value)}
                  className="w-full rounded-xl border border-[#ECE4D3] px-3 py-2.5 text-[14px]"
                />
              </Field>
            </div>
          )}

          {/* ── STEP 3 · MARKERS ──────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-[12.5px] text-[#5A6488] leading-relaxed m-0">
                Counting steps measures whether {kidName} showed up. <strong>Markers</strong> measure
                whether they got better. Pick up to three — Kaya captures a baseline on day one and
                re-takes them as you go.
              </p>

              {markers.map((m, i) => (
                <div key={i} className="rounded-xl border border-[#ECE4D3] p-3.5 bg-[#FDFCF8]">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="font-display font-extrabold text-[12px] text-[#3B2E86]">
                      Marker {i + 1}
                    </div>
                    {markers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setMarkers((p) => p.filter((_, idx) => idx !== i))}
                        className="text-[11px] font-bold text-[#D64550]"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <input
                    value={m.label}
                    onChange={(e) => setMarker(i, { label: e.target.value })}
                    placeholder="60-second self-intro — how clear?"
                    maxLength={120}
                    className="w-full rounded-lg border border-[#ECE4D3] px-3 py-2 text-[13.5px] mb-2"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {(['rubric', 'stars', 'count'] as MarkerKind[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setMarker(i, { kind: k })}
                        className={`px-3 py-1.5 rounded-full text-[11.5px] font-extrabold border ${
                          m.kind === k
                            ? 'border-[#3B2E86] bg-[#DFE3FB] text-[#3B2E86]'
                            : 'border-[#ECE4D3] bg-white text-[#5A6488]'
                        }`}
                      >
                        {k === 'rubric' && '0–100 score'}
                        {k === 'stars' && '⭐ Parent rating'}
                        {k === 'count' && '# Countable'}
                      </button>
                    ))}
                  </div>
                  {m.kind === 'count' && (
                    <input
                      value={m.unit ?? ''}
                      onChange={(e) => setMarker(i, { unit: e.target.value })}
                      placeholder="Unit — words / min"
                      maxLength={24}
                      className="w-full rounded-lg border border-[#ECE4D3] px-3 py-2 text-[13px] mt-2"
                    />
                  )}
                </div>
              ))}

              {markers.length < 3 && (
                <button
                  type="button"
                  onClick={() => setMarkers((p) => [...p, { id: `m${p.length + 1}`, label: '', kind: 'rubric' }])}
                  className="w-full rounded-xl border-2 border-dashed border-[#ECE4D3] py-2.5 text-[12.5px] font-extrabold text-[#5A6488]"
                >
                  + Add another marker
                </button>
              )}

              <Field
                label="Who can see this quest?"
                hint="Quests start private because many of them are. You can open it up later."
              >
                <div className="grid gap-2">
                  {([
                    ['private', '🔒 Just parents and ' + kidName, 'Nobody else in the family sees it.'],
                    ['siblings', '👧 Brothers and sisters too', 'Siblings can see it and cheer.'],
                    ['family', '👨‍👩‍👧‍👦 The whole family', 'Shows up on family surfaces.'],
                  ] as Array<[QuestVisibility, string, string]>).map(([v, label, blurb]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setVisibility(v)}
                      className={`text-left rounded-xl border px-3.5 py-2.5 ${
                        visibility === v ? 'border-[#3B2E86] bg-[#F2F4FE]' : 'border-[#ECE4D3] bg-white'
                      }`}
                    >
                      <div className="font-display font-extrabold text-[13px] text-[#0F1F44]">{label}</div>
                      <div className="text-[11.5px] text-[#5A6488] mt-0.5">{blurb}</div>
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-xl bg-[#FDE8E8] border border-[#F5C6C6] px-3.5 py-3 text-[12.5px] text-[#8B2130] leading-snug">
              {error}
            </div>
          )}
        </div>

        {/* Foot */}
        <div className="px-5 py-4 border-t border-[#ECE4D3] flex items-center gap-2.5">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="px-4 py-2.5 rounded-xl border border-[#ECE4D3] font-extrabold text-[13px] text-[#5A6488]"
            >
              Back
            </button>
          )}
          <div className="flex-1" />
          {step < 3 ? (
            <button
              type="button"
              disabled={step === 1 ? !canNext1 : !canNext2}
              onClick={() => setStep((s) => s + 1)}
              className="px-5 py-2.5 rounded-xl font-extrabold text-[13px] text-white disabled:opacity-40"
              style={{ background: '#3B2E86' }}
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              disabled={saving || cleanMarkers.length === 0}
              onClick={submit}
              className="px-5 py-2.5 rounded-xl font-extrabold text-[13px] text-white disabled:opacity-40"
              style={{ background: '#3B2E86' }}
            >
              {saving ? 'Creating…' : '🚀 Create quest'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44] mb-1">{label}</div>
      {hint && <div className="text-[11.5px] text-[#5A6488] mb-1.5 leading-snug">{hint}</div>}
      {children}
    </div>
  );
}
