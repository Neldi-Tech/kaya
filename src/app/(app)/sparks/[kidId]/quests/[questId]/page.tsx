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
import {
  subscribeToQuest, pauseQuest, resumeQuest, deleteQuest, updateQuest,
  consistency, pathwayProgress, groupStepsByWeek, rhythmLine, restDays,
  dayLabel, todayKey, addDays, DIFFICULTY_META,
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

        {/* ── Markers (defined; readings land in Q4) ───────────────── */}
        {quest.markers.length > 0 && (
          <Panel title="📈 Markers" className="mt-3">
            <ul className="m-0 pl-0 list-none grid gap-1.5">
              {quest.markers.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-[12.5px] text-[#0F1F44]">
                  <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-[#DFE3FB] text-[#3B2E86] whitespace-nowrap">
                    {m.kind === 'rubric' ? '0–100' : m.kind === 'stars' ? '⭐' : `#${m.unit ? ` ${m.unit}` : ''}`}
                  </span>
                  <span className="font-semibold">{m.label}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

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

        {/* ── The pathway ──────────────────────────────────────────── */}
        <div className="mt-5">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="font-display font-extrabold text-[13px] text-[#0F1F44]">
              🧭 The pathway
            </div>
            {isParent && (
              <button
                type="button"
                onClick={() => setBuilderOpen(true)}
                className="px-3 py-1.5 rounded-full text-[11.5px] font-extrabold text-white"
                style={{ background: '#3B2E86' }}
              >
                {steps.length ? 'Re-plan' : 'Build the pathway'}
              </button>
            )}
          </div>

          {steps.length === 0 ? (
            <div className="bg-[#FBF7EE] rounded-2xl px-5 py-7 text-center">
              <div className="text-3xl mb-2" aria-hidden>🧭</div>
              <div className="font-display font-extrabold text-[13.5px] text-[#0F1F44]">
                No pathway yet
              </div>
              <p className="text-[12px] text-[#5A6488] mt-1 mb-0 leading-snug max-w-sm mx-auto">
                {isParent
                  ? 'Write the handful of things you’d actually ask them to do. Kaya spreads them across the weeks so the whole plan exists up front — you approve it once, and then there’s simply a step each day.'
                  : 'A parent is still planning this one.'}
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
                            {s.done ? '✅' : s.date < today ? '⚪️' : '⬜️'}
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

        {/* ── Parent controls ──────────────────────────────────────── */}
        {isParent && (
          <div className="mt-6 border-t border-[#ECE4D3] pt-4 flex flex-wrap gap-2">
            {quest.status === 'active' && (
              <Ctrl onClick={onPause} disabled={busy}>⏸ Pause a week</Ctrl>
            )}
            {quest.status === 'paused' && (
              <Ctrl onClick={onResume} disabled={busy}>▶️ Resume</Ctrl>
            )}
            <Ctrl onClick={onGraduateToggle} disabled={busy}>
              {quest.status === 'graduated' ? '↩︎ Re-open' : '🎓 Mark graduated'}
            </Ctrl>
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
