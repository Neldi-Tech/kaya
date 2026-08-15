'use client';

// Kaya Sparks · 📚 The Quest Library.
//
// Every quest owns a library of activities, and this is where a parent
// runs it. The loop Elia asked for, end to end:
//
//   ✨ Generate a week or two of DAILY activities, ahead of time
//   → 👀 read the whole batch in advance
//   → ✅ tick the ones you'll allow (or discard / edit / add your own)
//   → 📅 schedule the approved ones onto the days, one per day
//   → the child opens the app and gets exactly today's.
//
// Three piles, in the order a parent works through them:
//   1. To review  — generated, nobody has ticked them, no child can see them
//   2. Ready      — approved and waiting for a day
//   3. Scheduled  — on the calendar (and pullable back off it until done)
//
// The rule that makes the whole thing safe is the invariant underneath:
// only an APPROVED activity ever gets a date, and only a dated activity
// is visible to the child, the reminder cron, or the streak.

import { useMemo, useState } from 'react';
import {
  generateLibrary, approveActivities, removeActivities, addActivity,
  editActivity, scheduleLibrary, unscheduleActivity, libraryBuckets,
  type Quest, type QuestStep,
} from '@/lib/sparks/quests';
import { toDisplayDate } from '@/lib/dates';

interface Props {
  familyId: string;
  kidId: string;
  kidName: string;
  quest: Quest;
  steps: QuestStep[];
}

export default function QuestLibrary({ familyId, kidId, kidName, quest, steps }: Props) {
  const { pending, approved, scheduled } = useMemo(() => libraryBuckets(steps), [steps]);

  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newHow, setNewHow] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const upcoming = scheduled.filter((s) => !s.done);

  function toggle(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function generate(days: number) {
    setBusy('gen'); setError(''); setNote('');
    try {
      const { created } = await generateLibrary(quest.id, days);
      setNote(`Kaya added ${created} activities below. Read them, tick the ones you’ll allow.`);
    } catch (e) {
      const err = e as Error & { hint?: string };
      setError(err.hint
        || (err.message === 'ai-unavailable'
          ? 'Kaya’s generator isn’t available right now — you can still write activities yourself.'
          : 'Kaya couldn’t fill the library just now. Try again in a moment.'));
    }
    setBusy('');
  }

  async function approve(ids: string[]) {
    if (!ids.length) return;
    setBusy('approve'); setError('');
    await approveActivities(familyId, kidId, quest.id, ids).catch(() => setError('Couldn’t approve those.'));
    setTicked(new Set());
    setBusy('');
  }

  async function discard(ids: string[]) {
    if (!ids.length) return;
    setBusy('discard');
    await removeActivities(familyId, kidId, quest.id, ids).catch(() => {});
    setTicked(new Set());
    setBusy('');
  }

  async function schedule() {
    setBusy('schedule'); setError(''); setNote('');
    try {
      const r = await scheduleLibrary(familyId, kidId, quest.id);
      setNote(r.scheduled === 0
        ? 'Nothing to schedule — approve some activities first.'
        : `Scheduled ${r.scheduled} activities, ${toDisplayDate(r.from ?? '')} → ${toDisplayDate(r.to ?? '')}. ${kidName} gets one a day.`);
    } catch { setError('Couldn’t schedule those.'); }
    setBusy('');
  }

  async function addOwn() {
    if (newTitle.trim().length < 2) return;
    setBusy('add');
    await addActivity(familyId, kidId, {
      questId: quest.id,
      title: newTitle.trim(),
      how: newHow.trim(),
      minutes: quest.minutesPerDay,
      kindTag: 'Your own',
    }).catch(() => setError('Couldn’t add that.'));
    setNewTitle(''); setNewHow(''); setAdding(false);
    setBusy('');
  }

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <div className="font-display font-extrabold text-[13px] text-[#0F1F44]">
          📚 The Library
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => generate(7)}
            disabled={!!busy}
            className="px-3 py-1.5 rounded-full text-[11.5px] font-extrabold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #A66CFF 0%, #4ECDC4 100%)' }}
          >
            {busy === 'gen' ? 'Kaya is thinking…' : '✨ Generate 1 week'}
          </button>
          <button
            type="button"
            onClick={() => generate(14)}
            disabled={!!busy}
            className="px-3 py-1.5 rounded-full text-[11.5px] font-extrabold border border-[#DCC7FA] bg-white text-[#5A3CB8] disabled:opacity-50"
          >
            2 weeks
          </button>
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className="px-3 py-1.5 rounded-full text-[11.5px] font-extrabold border border-[#ECE4D3] bg-white text-[#5A6488]"
          >
            ＋ Write my own
          </button>
        </div>
      </div>
      <p className="text-[11.5px] text-[#5A6488] leading-snug mb-3 m-0">
        Kaya writes a week or two of daily activities at a time. Read them all in advance, tick what
        you&apos;ll allow, then schedule them — {kidName} gets one a day and can see what&apos;s
        next, but can&apos;t run ahead.
      </p>

      {(note || error) && (
        <div className={`rounded-xl px-3.5 py-2.5 text-[12px] leading-snug mb-3 ${
          error
            ? 'bg-[#FDE8E8] border border-[#F5C6C6] text-[#8B2130]'
            : 'bg-[#E7F5EC] border border-[#BFE0CC] text-[#256B31]'
        }`}>
          {error || note}
        </div>
      )}

      {adding && (
        <div className="rounded-[16px] border border-[#ECE4D3] bg-[#FDFCF8] p-3.5 mb-3">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Read a page of your book out loud, slowly"
            maxLength={120}
            className="w-full rounded-lg border border-[#ECE4D3] px-3 py-2 text-[13.5px] mb-2"
          />
          <textarea
            value={newHow}
            onChange={(e) => setNewHow(e.target.value)}
            rows={2}
            placeholder="How to do it — one or two sentences in your child’s words."
            maxLength={600}
            className="w-full rounded-lg border border-[#ECE4D3] px-3 py-2 text-[13px] resize-none"
          />
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={addOwn}
              disabled={!!busy || newTitle.trim().length < 2}
              className="px-3.5 py-2 rounded-xl text-[12px] font-extrabold text-white disabled:opacity-40"
              style={{ background: quest.colour }}
            >
              Add to library
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="px-3.5 py-2 rounded-xl text-[12px] font-extrabold border border-[#ECE4D3] bg-white text-[#5A6488]"
            >
              Cancel
            </button>
          </div>
          <p className="text-[10.5px] text-[#8A8471] mt-2 mb-0">
            Yours goes straight to <strong>Ready</strong> — you wrote it, so it&apos;s approved.
          </p>
        </div>
      )}

      {/* ── 1 · To review ───────────────────────────────────────────── */}
      {pending.length > 0 && (
        <Pile
          title={`👀 To review · ${pending.length}`}
          sub={`${kidName} cannot see any of these yet.`}
        >
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <button
              type="button"
              onClick={() => approve(pending.map((s) => s.id))}
              disabled={!!busy}
              className="px-3 py-1.5 rounded-full text-[11.5px] font-extrabold text-white disabled:opacity-50"
              style={{ background: '#2E7D34' }}
            >
              ✅ Allow all {pending.length}
            </button>
            {ticked.size > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => approve([...ticked])}
                  disabled={!!busy}
                  className="px-3 py-1.5 rounded-full text-[11.5px] font-extrabold border border-[#BFE0CC] bg-white text-[#2E7D34]"
                >
                  Allow {ticked.size} ticked
                </button>
                <button
                  type="button"
                  onClick={() => discard([...ticked])}
                  disabled={!!busy}
                  className="px-3 py-1.5 rounded-full text-[11.5px] font-extrabold border border-[#F5C6C6] bg-white text-[#D64550]"
                >
                  Discard {ticked.size}
                </button>
              </>
            )}
          </div>
          <div className="grid gap-2">
            {pending.map((s) => (
              <ActivityCard
                key={s.id}
                step={s}
                quest={quest}
                ticked={ticked.has(s.id)}
                onToggle={() => toggle(s.id)}
                editing={editingId === s.id}
                onEdit={() => setEditingId(editingId === s.id ? null : s.id)}
                onSaveEdit={async (patch) => {
                  setBusy('edit');
                  await editActivity(familyId, kidId, quest.id, s.id, patch).catch(() => {});
                  setEditingId(null);
                  setBusy('');
                }}
                onDiscard={() => discard([s.id])}
              />
            ))}
          </div>
        </Pile>
      )}

      {/* ── 2 · Ready ───────────────────────────────────────────────── */}
      {approved.length > 0 && (
        <Pile
          title={`✅ Ready · ${approved.length}`}
          sub="Approved and waiting for a day."
        >
          <button
            type="button"
            onClick={schedule}
            disabled={!!busy}
            className="px-3.5 py-2 rounded-xl text-[12px] font-extrabold text-white disabled:opacity-50 mb-2"
            style={{ background: quest.colour }}
          >
            {busy === 'schedule' ? 'Scheduling…' : `📅 Schedule all ${approved.length} — one a day`}
          </button>
          <div className="grid gap-2">
            {approved.map((s) => (
              <ActivityCard
                key={s.id}
                step={s}
                quest={quest}
                onDiscard={() => discard([s.id])}
              />
            ))}
          </div>
        </Pile>
      )}

      {/* ── 3 · Scheduled ───────────────────────────────────────────── */}
      {upcoming.length > 0 && (
        <Pile
          title={`📅 Scheduled · ${upcoming.length}`}
          sub={`One a day, on ${kidName}'s active days.`}
        >
          <div className="grid gap-2">
            {upcoming.map((s) => (
              <ActivityCard
                key={s.id}
                step={s}
                quest={quest}
                onUnschedule={async () => {
                  setBusy('unsched');
                  await unscheduleActivity(familyId, kidId, quest.id, s.id).catch(() => {});
                  setBusy('');
                }}
              />
            ))}
          </div>
        </Pile>
      )}

      {pending.length === 0 && approved.length === 0 && upcoming.length === 0 && (
        <div className="bg-[#FBF7EE] rounded-2xl px-5 py-7 text-center">
          <div className="text-3xl mb-2" aria-hidden>📚</div>
          <div className="font-display font-extrabold text-[13.5px] text-[#0F1F44]">
            The library is empty
          </div>
          <p className="text-[12px] text-[#5A6488] mt-1 mb-0 leading-snug max-w-sm mx-auto">
            Tap <strong>Generate 1 week</strong> and Kaya writes seven daily activities for this
            goal — different kinds, not seven versions of the same drill. You read them, allow the
            ones you like, and schedule them.
          </p>
        </div>
      )}
    </div>
  );
}

function Pile({ title, sub, children }: {
  title: string; sub: string; children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="font-display font-extrabold text-[11.5px] tracking-[0.5px] text-[#5A6488] uppercase">
        {title}
      </div>
      <div className="text-[11px] text-[#8A8471] mb-2">{sub}</div>
      {children}
    </div>
  );
}

function ActivityCard({
  step, quest, ticked, onToggle, editing, onEdit, onSaveEdit, onDiscard, onUnschedule,
}: {
  step: QuestStep;
  quest: Quest;
  ticked?: boolean;
  onToggle?: () => void;
  editing?: boolean;
  onEdit?: () => void;
  onSaveEdit?: (patch: { title: string; how: string }) => void;
  onDiscard?: () => void;
  onUnschedule?: () => void;
}) {
  const [title, setTitle] = useState(step.title);
  const [how, setHow] = useState(step.how);

  if (editing && onSaveEdit) {
    return (
      <div className="rounded-[14px] border border-[#3B2E86] bg-white p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          className="w-full rounded-lg border border-[#ECE4D3] px-3 py-2 text-[13px] mb-2"
        />
        <textarea
          value={how}
          onChange={(e) => setHow(e.target.value)}
          rows={2}
          maxLength={600}
          className="w-full rounded-lg border border-[#ECE4D3] px-3 py-2 text-[12.5px] resize-none"
        />
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => onSaveEdit({ title, how })}
            className="px-3 py-1.5 rounded-lg text-[11.5px] font-extrabold text-white"
            style={{ background: quest.colour }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="px-3 py-1.5 rounded-lg text-[11.5px] font-extrabold border border-[#ECE4D3] text-[#5A6488]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-[14px] border bg-white p-3 ${
      ticked ? 'border-[#3B2E86] bg-[#F7F9FF]' : 'border-[#ECE4D3]'
    }`}>
      <div className="flex items-start gap-2.5">
        {onToggle && (
          <input
            type="checkbox"
            checked={!!ticked}
            onChange={onToggle}
            className="mt-1 shrink-0"
            aria-label={`Select ${step.title}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-[#0F1F44] leading-snug">
            {step.tone === 'fun' ? '🎈 ' : ''}{step.title}
          </div>
          {step.how && (
            <p className="text-[11.5px] text-[#5A6488] mt-1 mb-0 leading-relaxed">{step.how}</p>
          )}
          <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
            {step.kindTag && (
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#DFE3FB] text-[#3B2E86]">
                {step.kindTag}
              </span>
            )}
            <span className="text-[10px] font-bold text-[#8A8471]">
              {step.minutes} min · {step.phase}
            </span>
            {step.date && (
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#FFF1C9] text-[#8A6800]">
                {toDisplayDate(step.date)}
              </span>
            )}
          </div>
        </div>
      </div>
      {(onEdit || onDiscard || onUnschedule) && (
        <div className="flex items-center gap-2.5 mt-2 pt-2 border-t border-[#F3EEE2]">
          {onEdit && (
            <button type="button" onClick={onEdit} className="text-[11px] font-extrabold text-[#5A6488]">
              ✏️ Edit
            </button>
          )}
          {onUnschedule && (
            <button type="button" onClick={onUnschedule} className="text-[11px] font-extrabold text-[#5A6488]">
              ↩︎ Back to library
            </button>
          )}
          {onDiscard && (
            <button type="button" onClick={onDiscard} className="text-[11px] font-extrabold text-[#D64550] ml-auto">
              Discard
            </button>
          )}
        </div>
      )}
    </div>
  );
}
