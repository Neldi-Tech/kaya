'use client';

// Kaya Sparks · one Quest.
//
// The quest's own page: the goal, the rhythm, the pathway (built once
// and approved as one batch · D4), the parent-only starting point (D3),
// and the pause / resume / edit controls (D10).
//
// Today's Step, proof capture and the streak land in Q2; markers and the
// progress tracks in Q4. This page is their home.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import AreaScreen from '@/components/sparks/AreaScreen';
import PathwayBuilder from '@/components/sparks/PathwayBuilder';
import TodayStepCard from '@/components/sparks/TodayStepCard';
import QuestPackQueue from '@/components/sparks/QuestPackQueue';
import QuestLibrary from '@/components/sparks/QuestLibrary';
import BaselineCallout from '@/components/sparks/BaselineCallout';
import MarkerPanel from '@/components/sparks/MarkerPanel';
import QuestRemindersPanel from '@/components/sparks/QuestRemindersPanel';
import CoachEarCard from '@/components/sparks/CoachEarCard';
import QuestFinishPanel from '@/components/sparks/QuestFinishPanel';
import {
  subscribeToQuest, pauseQuest, resumeQuest, deleteQuest, updateQuest, repairStreak,
  consistency, pathwayProgress, groupStepsByWeek, rhythmLine, restDays,
  dayLabel, todayKey, addDays, isDueOn, stepForDate, nextScheduledAfter,
  DIFFICULTY_META,
  type QuestDetail,
} from '@/lib/sparks/quests';
import { toDisplayDate } from '@/lib/dates';

export default function QuestDetailPage() {
  const params = useParams<{ kidId: string; questId: string }>();
  const kidId = params?.kidId ?? '';
  const questId = params?.questId ?? '';
  const router = useRouter();
  const { profile } = useAuth();
  const { children, loading } = useFamily();

  const familyId = profile?.familyId;
  const isParent = profile?.role === 'parent';
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  const [detail, setDetail] = useState<QuestDetail | null | 'missing'>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!familyId || !kidId || !questId) return;
    return subscribeToQuest(familyId, kidId, questId, (d) => setDetail(d ?? 'missing'));
  }, [familyId, kidId, questId]);

  if (loading || detail === null || !kid) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#0F1F44] text-sm">
        Loading…
      </div>
    );
  }

  if (detail === 'missing') {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center px-5">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-3" aria-hidden>🧭</div>
          <h1 className="font-display font-extrabold text-xl text-[#0F1F44]">Quest not found</h1>
          <p className="text-[#5A6488] text-[13.5px] mt-2">
            It may have been deleted, or it isn&apos;t shared with you.
          </p>
          <button
            type="button"
            onClick={() => router.push(`/sparks/${kidId}/quests`)}
            className="mt-5 inline-flex px-4 py-2.5 rounded-xl font-extrabold text-[13px] text-white"
            style={{ background: '#3B2E86' }}
          >
            Back to quests
          </button>
        </div>
      </div>
    );
  }

  const { quest, steps } = detail;
  const today = todayKey();
  const cons = consistency(quest, steps);
  const prog = pathwayProgress(steps);
  const weeks = groupStepsByWeek(steps);
  const rest = restDays(quest);
  const dueToday = isDueOn(quest, today);
  // TODAY IS THE ONLY DAY YOU CAN DO. A kid gets exactly today's
  // activity to act on; what's coming next is readable but locked, so
  // the plan stays a rhythm instead of something to binge and abandon.
  const todayStep = dueToday ? stepForDate(steps, today) : null;
  const upNext = nextScheduledAfter(steps, today);
  // Server is the authority (D13); this only decides what to render.
  const canAct = isParent
    || profile?.childId === kidId
    || profile?.role === 'helper';

  async function onPause() {
    if (!familyId) return;
    setBusy(true);
    // Default pause: one week. Long enough for a holiday or a flu.
    await pauseQuest(familyId, kidId, questId, addDays(today, 7)).catch(() => {});
    setBusy(false);
  }
  async function onResume() {
    if (!familyId) return;
    setBusy(true);
    await resumeQuest(familyId, kidId, questId).catch(() => {});
    setBusy(false);
  }
  async function onGraduateToggle() {
    if (!familyId) return;
    setBusy(true);
    await updateQuest(familyId, kidId, questId, {
      status: quest.status === 'graduated' ? 'active' : 'graduated',
    }).catch(() => {});
    setBusy(false);
  }
  async function onDelete() {
    if (!familyId) return;
    if (!confirm(`Delete "${quest.title}" and everything in it? This cannot be undone.`)) return;
    setBusy(true);
    await deleteQuest(familyId, kidId, questId).catch(() => {});
    router.push(`/sparks/${kidId}/quests`);
  }

  return (
    <>
      <AreaScreen
        kidId={kidId}
        kidName={kid.name}
        area="quest"
        subtitle={`${quest.emoji} ${quest.title}`}
      >
        {/* ── The goal ─────────────────────────────────────────────── */}
        <div
          className="rounded-[18px] p-4 text-white"
          style={{ background: `linear-gradient(135deg, ${quest.colour} 0%, #5AB7D6 140%)` }}
        >
          <div className="text-[10px] font-extrabold tracking-[1.5px] opacity-85 mb-1">🎯 THE GOAL</div>
          <p className="text-[14px] leading-relaxed m-0 font-semibold">{quest.goal}</p>
          <div className="text-[11.5px] opacity-90 mt-2">
            {quest.deadline ? `By ${toDisplayDate(quest.deadline)} · ` : ''}
            {DIFFICULTY_META[quest.difficulty].emoji} {DIFFICULTY_META[quest.difficulty].label}
          </div>
        </div>

        {/* ── 🎬 Step zero · the baseline, before anything else ────── */}
        {quest.status === 'active' && (
          <BaselineCallout
            quest={quest}
            readings={detail.readings}
            kidName={kid.name}
            isParent={isParent}
          />
        )}

        {/* ── Today's step — the daily loop, first thing on the page ── */}
        {quest.status === 'active' && (
          <div className="mt-3">
            {todayStep ? (
              <TodayStepCard
                familyId={familyId ?? ''}
                kidId={kidId}
                kidName={kid.name}
                quest={quest}
                step={todayStep}
                canAct={canAct}
                isToday
              />
            ) : dueToday ? (
              <div className="rounded-[18px] border border-[#ECE4D3] bg-[#FBF7EE] px-4 py-5 text-center">
                <div className="text-[13px] font-extrabold text-[#0F1F44]">
                  Nothing scheduled for today yet
                </div>
                <p className="text-[12px] text-[#5A6488] mt-1 mb-0 max-w-sm mx-auto leading-snug">
                  {isParent
                    ? 'Generate activities in the Library below, tick the ones you’ll allow, then schedule them onto the days.'
                    : 'A parent is still choosing today’s activity.'}
                </p>
              </div>
            ) : (
              <div className="rounded-[18px] border border-[#ECE4D3] bg-[#E7F5EC] px-4 py-4 text-center">
                <div className="text-[13px] font-extrabold text-[#2E7D34]">
                  😴 Rest day — nothing due, nothing lost
                </div>
              </div>
            )}

            {/* 🔒 What's next — readable, not doable. */}
            {upNext && (!todayStep || todayStep.done) && (
              <div className="mt-2 rounded-[16px] border border-dashed border-[#DFE3FB] bg-[#F7F9FF] px-4 py-3 flex items-center gap-2.5">
                <span className="text-[15px]" aria-hidden>🔒</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-extrabold tracking-[1px] text-[#5A6488] uppercase">
                    Up next · {toDisplayDate(upNext.date ?? '')}
                  </div>
                  <div className="text-[12.5px] font-bold text-[#0F1F44] leading-snug truncate">
                    {upNext.tone === 'fun' ? '🎈 ' : ''}{upNext.title}
                  </div>
                </div>
                <span className="text-[10.5px] text-[#8A8471] italic shrink-0 hidden sm:block">
                  not yet — that&apos;s for its day
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Streak (D10) ─────────────────────────────────────────── */}
        <div className="mt-3 rounded-[16px] border border-[#ECE4D3] bg-white p-3.5 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="font-display font-extrabold text-[13px] text-[#0F1F44]">
              🔥 {quest.streak?.current ?? 0} day{(quest.streak?.current ?? 0) === 1 ? '' : 's'} in a row
              {(quest.streak?.best ?? 0) > (quest.streak?.current ?? 0) && (
                <span className="text-[11.5px] text-[#5A6488] font-bold"> · best {quest.streak?.best}</span>
              )}
            </div>
            <div className="text-[11.5px] text-[#5A6488] mt-0.5">
              🛡️ {quest.streak?.shields ?? 0} shield{(quest.streak?.shields ?? 0) === 1 ? '' : 's'} left
              {(quest.streak?.shieldedDates?.length ?? 0) > 0 &&
                ` · ${quest.streak?.shieldedDates?.length} day(s) saved`}
              {quest.streak?.repairUsed ? ' · 🩹 repair spent' : ''}
            </div>
          </div>
          {isParent && !quest.streak?.repairUsed && (quest.streak?.best ?? 0) > (quest.streak?.current ?? 0) && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!familyId) return;
                setBusy(true);
                await repairStreak(familyId, kidId, questId).catch(() => {});
                setBusy(false);
              }}
              className="px-3 py-1.5 rounded-full border border-[#ECE4D3] bg-white text-[11.5px] font-extrabold text-[#5A6488]"
            >
              🩹 Repair the streak (once)
            </button>
          )}
        </div>

        {/* ── Rhythm + progress ────────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2 mt-3">
          <Panel title="🗓 Rhythm">
            <div className="text-[13px] font-bold text-[#0F1F44]">{rhythmLine(quest)}</div>
            {rest.length > 0 && (
              <div className="text-[11.5px] text-[#2E7D34] font-bold mt-1">
                😴 Rest: {rest.map(dayLabel).join(' · ')} — these never break a streak
              </div>
            )}
            {quest.status === 'paused' && quest.pausedUntil && (
              <div className="text-[11.5px] text-[#8A6800] font-bold mt-1">
                ⏸ Paused until {toDisplayDate(quest.pausedUntil)}
              </div>
            )}
          </Panel>

          <Panel title="📊 Consistency">
            <Bar percent={cons.percent} colour={quest.colour} />
            <div className="text-[11.5px] text-[#5A6488] mt-1.5 font-bold">
              {cons.done} of {cons.due} steps that were due · pathway {prog.done}/{prog.total}
            </div>
            <p className="text-[11px] text-[#5A6488] mt-1 leading-snug m-0">
              This is showing-up. Growth is measured separately, by the markers.
            </p>
          </Panel>
        </div>

        {/* ── 🎤 Coach Ear — AI that listens, not just reads ───────── */}
        {canAct && familyId && quest.status === 'active' && (
          <CoachEarCard
            familyId={familyId}
            kidId={kidId}
            kidName={isParent ? kid.name : 'you'}
            quest={quest}
          />
        )}

        {/* ── D9 · the GROWTH track, kept separate from consistency ── */}
        <MarkerPanel
          familyId={familyId ?? ''}
          kidId={kidId}
          kidName={kid.name}
          quest={quest}
          readings={detail.readings}
          isParent={isParent}
          canAct={canAct}
        />

        {/* ── D3 · parent-only starting point ──────────────────────── */}
        {isParent && detail.startingPoint && (
          <div className="mt-3 rounded-[16px] border-2 border-dashed border-[#E8D9B5] bg-[#FFFBF0] p-4">
            <div className="flex items-center gap-2 mb-1">
              <span aria-hidden>🔒</span>
              <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
                Starting point — parents only
              </div>
            </div>
            <p className="text-[12.5px] text-[#5A6488] leading-relaxed m-0">{detail.startingPoint}</p>
            <p className="text-[10.5px] text-[#8A8471] italic mt-2 m-0">
              {kid.name} never sees this. It isn&apos;t sent to their device at all.
            </p>
          </div>
        )}

        {/* ── 📚 The Library — where a parent runs the activities ──── */}
        {isParent && familyId && (
          <QuestLibrary
            familyId={familyId}
            kidId={kidId}
            kidName={kid.name}
            quest={quest}
            steps={steps}
          />
        )}

        {/* ── The plan so far ──────────────────────────────────────── */}
        <div className="mt-5">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="font-display font-extrabold text-[13px] text-[#0F1F44]">
              🗓 The plan so far
            </div>
            {isParent && (
              <button
                type="button"
                onClick={() => setBuilderOpen(true)}
                className="px-3 py-1.5 rounded-full text-[11.5px] font-extrabold border border-[#ECE4D3] bg-white text-[#5A6488]"
              >
                Bulk-plan by hand
              </button>
            )}
          </div>

          {weeks.length === 0 ? (
            <div className="bg-[#FBF7EE] rounded-2xl px-5 py-6 text-center">
              <p className="text-[12px] text-[#5A6488] m-0 leading-snug max-w-sm mx-auto">
                {isParent
                  ? 'Nothing is on the calendar yet. Approve activities in the Library above and schedule them — they’ll appear here, one a day.'
                  : 'A parent is still choosing the activities for this quest.'}
              </p>
            </div>
          ) : (
            <>
              {quest.pathwayApproved && quest.pathwayApprovedByName && (
                <div className="text-[11px] text-[#2E7D34] font-bold mb-2">
                  ✅ Approved by {quest.pathwayApprovedByName}
                  {quest.pathwayApprovedAt
                    ? ` · ${toDisplayDate(todayKey(new Date(quest.pathwayApprovedAt)))}`
                    : ''}
                </div>
              )}
              <div className="grid gap-3">
                {weeks.map((w) => (
                  <div key={w.label} className="rounded-[16px] border border-[#ECE4D3] bg-white overflow-hidden">
                    <div className="px-3.5 py-2 bg-[#FBF7EE] font-display font-extrabold text-[11.5px] text-[#5A6488] tracking-[0.5px] flex items-center justify-between">
                      <span>{w.label} · {w.steps[0]?.phase}</span>
                      <span>{w.steps.filter((s) => s.done).length}/{w.steps.length}</span>
                    </div>
                    <ul className="m-0 p-0 list-none">
                      {w.steps.map((s) => (
                        <li
                          key={s.id}
                          className={`px-3.5 py-2.5 border-t border-[#F3EEE2] flex items-start gap-2.5 ${
                            s.date === today ? 'bg-[#F2F4FE]' : ''
                          }`}
                        >
                          <span className="text-[13px] leading-5 shrink-0" aria-hidden>
                            {s.done ? '✅' : (s.date ?? '') < today ? '⚪️' : '⬜️'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12.5px] font-bold text-[#0F1F44] leading-snug">
                              {s.tone === 'fun' ? '🎈 ' : ''}{s.title}
                            </div>
                            <div className="text-[10.5px] text-[#5A6488] mt-0.5">
                              {toDisplayDate(s.date)} · {s.minutes} min
                              {s.date === today ? ' · today' : ''}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── 👥 Buddy · 🧭 weekly adapt · 🎓 graduation ───────────── */}
        {isParent && familyId && (
          <QuestFinishPanel
            familyId={familyId}
            kidId={kidId}
            kidName={kid.name}
            quest={quest}
          />
        )}

        {/* ── D11 · reminders, cut-off, extra recipients ───────────── */}
        {isParent && familyId && (
          <QuestRemindersPanel
            familyId={familyId}
            kidId={kidId}
            kidName={kid.name}
            quest={quest}
          />
        )}

        {/* ── D5 · nothing generated reaches a kid unapproved ──────── */}
        {isParent && <QuestPackQueue quest={quest} kidName={kid.name} />}

        {/* ── Parent controls ──────────────────────────────────────── */}
        {isParent && (
          <div className="mt-6 border-t border-[#ECE4D3] pt-4 flex flex-wrap gap-2">
            {quest.status === 'active' && (
              <Ctrl onClick={onPause} disabled={busy}>⏸ Pause a week</Ctrl>
            )}
            {quest.status === 'paused' && (
              <Ctrl onClick={onResume} disabled={busy}>▶️ Resume</Ctrl>
            )}
            {quest.status === 'graduated' && (
              <Ctrl onClick={onGraduateToggle} disabled={busy}>↩︎ Re-open</Ctrl>
            )}
            <Ctrl onClick={onDelete} disabled={busy} danger>🗑 Delete</Ctrl>
            {quest.updatedByName && (
              <span className="text-[10.5px] text-[#8A8471] self-center ml-auto">
                Last edited by {quest.updatedByName}
              </span>
            )}
          </div>
        )}
      </AreaScreen>

      {builderOpen && familyId && (
        <PathwayBuilder
          familyId={familyId}
          kidId={kidId}
          kidName={kid.name}
          quest={quest}
          onClose={() => setBuilderOpen(false)}
        />
      )}
    </>
  );
}

function Panel({ title, children, className = '' }: {
  title: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-[16px] border border-[#ECE4D3] bg-white p-3.5 ${className}`}>
      <div className="font-display font-extrabold text-[11.5px] tracking-[0.5px] text-[#5A6488] uppercase mb-1.5">
        {title}
      </div>
      {children}
    </div>
  );
}

function Bar({ percent, colour }: { percent: number; colour: string }) {
  return (
    <div className="h-2.5 rounded-full bg-[#F3EEE2] overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(2, percent)}%`, background: colour }}
      />
    </div>
  );
}

function Ctrl({ onClick, disabled, danger, children }: {
  onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3.5 py-2 rounded-xl border font-extrabold text-[12px] disabled:opacity-40 ${
        danger
          ? 'border-[#F5C6C6] text-[#D64550] bg-white'
          : 'border-[#ECE4D3] text-[#5A6488] bg-white'
      }`}
    >
      {children}
    </button>
  );
}
