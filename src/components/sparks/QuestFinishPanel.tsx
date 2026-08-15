'use client';

// Kaya Sparks · 👥 Quest Buddy, 🧭 the weekly adapt, 🎓 Graduation.
//
// Innovations 3, 4 and 5, on the quest's own page where the decisions
// actually get made.
//
// 👥 Buddy — a parent or sibling takes the quest ALONGSIDE the child and
//    they share one streak. The psychology is decisive: a kid who sees a
//    parent doing the hard thing stops experiencing practice as a
//    punishment.
// 🧭 Adapt — Kaya reads the week and proposes exactly ONE change, framed
//    for a five-second Sunday decision. It never applies anything on its
//    own; the parent stays the one who decides.
// 🎓 Graduation — the quest becomes a permanent 🏅 Achievement carrying
//    the baseline and the final proof, plus the points and a certificate.

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  setBuddy, weeklyAdapt, adaptPatch, graduateQuest, updateQuest,
  type Quest, type AdaptProposal, type GraduationResult,
} from '@/lib/sparks/quests';

const CHANGE_LABEL: Record<string, string> = {
  harder: '⬆️ Push harder',
  easier: '⬇️ Ease off',
  more_fun: '🎈 More fun',
  change_medium: '🔄 Change the medium',
  extend_deadline: '📅 Give it more time',
  keep: '✅ Keep it as it is',
};

export default function QuestFinishPanel({ familyId, kidId, kidName, quest }: {
  familyId: string;
  kidId: string;
  kidName: string;
  quest: Quest;
}) {
  const { children } = useFamily();
  const { profile } = useAuth();

  const [busy, setBusy] = useState(false);
  const [adapt, setAdapt] = useState<AdaptProposal | null>(null);
  const [grad, setGrad] = useState<GraduationResult | null>(null);
  const [error, setError] = useState('');

  // "Me" is the option that matters — the parent reading this screen
  // taking the quest on themselves. Siblings come next.
  const buddyOptions = [
    ...(profile?.uid
      ? [{ uid: profile.uid, label: `Me (${(profile.displayName || 'Parent').split(' ')[0]})`, emoji: '🧑' }]
      : []),
    ...children.filter((c) => c.id !== kidId).map((c) => ({ uid: c.id, label: c.name, emoji: '🧒' })),
  ];

  async function runAdapt() {
    setBusy(true); setError('');
    try { setAdapt(await weeklyAdapt(quest.id)); }
    catch (e) {
      const err = e as Error & { hint?: string };
      setError(err.hint || 'Kaya couldn’t review this week just now.');
    }
    setBusy(false);
  }

  async function applyAdapt() {
    if (!adapt) return;
    const patch = adaptPatch(adapt.change, quest);
    if (!patch) return;
    setBusy(true);
    await updateQuest(familyId, kidId, quest.id, patch).catch(() => {});
    setAdapt(null);
    setBusy(false);
  }

  async function graduate() {
    if (!confirm(`Graduate "${quest.title}"? This awards the points and writes it into ${kidName}'s Achievements for good.`)) return;
    setBusy(true); setError('');
    try { setGrad(await graduateQuest(familyId, kidId, quest.id)); }
    catch { setError('Couldn’t graduate the quest. Try again.'); }
    setBusy(false);
  }

  // ── 🎓 the certificate, once it's done ────────────────────────────
  if (grad || quest.status === 'graduated') {
    return (
      <div
        className="mt-5 rounded-[18px] p-5 text-white text-center"
        style={{ background: `linear-gradient(135deg, ${quest.colour} 0%, #D4A847 160%)` }}
      >
        <div className="text-[10px] font-extrabold tracking-[2px] opacity-85">
          KAYA QUESTS · CERTIFICATE
        </div>
        <div className="text-4xl mt-2" aria-hidden>🎓</div>
        <div className="font-display font-extrabold text-[19px] mt-1.5 leading-tight">
          {kidName} finished {quest.title}
        </div>
        <p className="text-[12.5px] opacity-90 mt-1.5 mb-0 leading-snug max-w-sm mx-auto">
          {quest.goal}
        </p>
        {grad && (
          <div className="text-[12px] opacity-90 mt-2.5">
            {grad.doneCount} steps · best streak {grad.streakBest} days
            {grad.pointsAwarded ? ` · +${grad.pointsAwarded} points` : ''}
          </div>
        )}
        <div className="text-[11px] opacity-85 mt-3">
          Saved into 🏅 Achievements — with the recording from day one.
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-3">
      {/* ── 👥 Buddy ─────────────────────────────────────────────── */}
      <div className="rounded-[16px] border border-[#ECE4D3] bg-white p-3.5">
        <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
          👥 Quest Buddy
        </div>
        <p className="text-[11.5px] text-[#5A6488] mt-0.5 mb-2.5 leading-snug">
          {quest.buddyName
            ? `${quest.buddyName} is doing this alongside ${kidName}. They share one streak — either of them keeping the day alive keeps it alive for both.`
            : `Someone can take this quest alongside ${kidName} and share the streak. A kid who sees a parent doing the hard thing stops experiencing practice as a punishment.`}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {buddyOptions.map((b) => (
            <button
              key={b.uid}
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await setBuddy(familyId, kidId, quest.id, quest.buddyUid === b.uid ? '' : b.uid).catch(() => {});
                setBusy(false);
              }}
              className={`px-3 py-1.5 rounded-full text-[11.5px] font-extrabold border disabled:opacity-40 ${
                quest.buddyUid === b.uid
                  ? 'border-[#3B2E86] bg-[#DFE3FB] text-[#3B2E86]'
                  : 'border-[#ECE4D3] bg-white text-[#5A6488]'
              }`}
            >
              {b.emoji} {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 🧭 The weekly adapt ──────────────────────────────────── */}
      <div className="rounded-[16px] border border-[#ECE4D3] bg-white p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
              🧭 Coach Kaya · this week
            </div>
            <p className="text-[11.5px] text-[#5A6488] mt-0.5 mb-0 leading-snug">
              One adjustment, not a list — the kind of thing you decide in five seconds on a Sunday.
            </p>
          </div>
          <button
            type="button"
            onClick={runAdapt}
            disabled={busy}
            className="px-3 py-1.5 rounded-full text-[11.5px] font-extrabold text-white disabled:opacity-50 shrink-0"
            style={{ background: 'linear-gradient(135deg, #A66CFF 0%, #4ECDC4 100%)' }}
          >
            {busy ? '…' : 'Review'}
          </button>
        </div>

        {adapt && (
          <div className="mt-3 rounded-[14px] bg-[#F7F9FF] border border-[#DFE3FB] p-3">
            <div className="text-[12.5px] font-bold text-[#0F1F44] leading-snug">{adapt.verdict}</div>
            <div className="text-[11px] text-[#5A6488] mt-1">
              {adapt.week.done} of {adapt.week.due} steps this week
            </div>
            <div className="mt-2 text-[12px] font-extrabold text-[#3B2E86]">
              {CHANGE_LABEL[adapt.change] ?? adapt.change}
            </div>
            <p className="text-[12.5px] text-[#0F1F44] mt-1 mb-0 leading-relaxed">{adapt.proposal}</p>
            <p className="text-[11.5px] text-[#5A6488] mt-1 mb-0 leading-snug">{adapt.why}</p>
            <div className="flex flex-wrap gap-2 mt-2.5">
              {adaptPatch(adapt.change, quest) && (
                <button
                  type="button"
                  onClick={applyAdapt}
                  disabled={busy}
                  className="px-3.5 py-2 rounded-xl text-[12px] font-extrabold text-white disabled:opacity-40"
                  style={{ background: quest.colour }}
                >
                  Approve
                </button>
              )}
              <button
                type="button"
                onClick={() => setAdapt(null)}
                className="px-3.5 py-2 rounded-xl text-[12px] font-extrabold border border-[#ECE4D3] bg-white text-[#5A6488]"
              >
                Keep as is
              </button>
              {(adapt.change === 'more_fun' || adapt.change === 'change_medium') && (
                <span className="text-[10.5px] text-[#8A8471] self-center leading-snug">
                  This one is a re-plan — use “Re-plan” on the pathway below.
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 🎓 Graduate ──────────────────────────────────────────── */}
      <div className="rounded-[16px] border border-[#ECE4D3] bg-white p-3.5 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
            🎓 Graduate this quest
          </div>
          <p className="text-[11.5px] text-[#5A6488] mt-0.5 mb-0 leading-snug">
            Awards the points and writes it into {kidName}&apos;s 🏅 Achievements for good — with the
            recording from day one attached.
          </p>
        </div>
        <button
          type="button"
          onClick={graduate}
          disabled={busy}
          className="px-4 py-2 rounded-xl text-[12.5px] font-extrabold text-white disabled:opacity-40"
          style={{ background: '#2E7D34' }}
        >
          🎓 Graduate
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-[#FDE8E8] border border-[#F5C6C6] px-3.5 py-2.5 text-[12px] text-[#8B2130]">
          {error}
        </div>
      )}
    </div>
  );
}
