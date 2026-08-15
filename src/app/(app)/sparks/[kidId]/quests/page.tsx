'use client';

// Kaya Sparks · Quests — the kid's list of running quests.
//
// D1 · 9th area, same AreaScreen shell as every other Sparks surface.
// D14 · at most two quests run at once; the third needs a pause first,
//       and the UI says so out loud rather than failing at save time.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import AreaScreen, { AddItemButton, AreaEmptyState } from '@/components/sparks/AreaScreen';
import NewQuestWizard from '@/components/sparks/NewQuestWizard';
import {
  subscribeToQuests, activeCount, rhythmLine, MAX_ACTIVE_QUESTS,
  type Quest,
} from '@/lib/sparks/quests';

export default function QuestsAreaPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId ?? '';
  const router = useRouter();
  const { profile } = useAuth();
  const { children, loading } = useFamily();

  const familyId = profile?.familyId;
  const isParent = profile?.role === 'parent';
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  const [quests, setQuests] = useState<Quest[] | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToQuests(familyId, kidId, setQuests);
  }, [familyId, kidId]);

  if (loading || !kid) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#0F1F44] text-sm">
        Loading…
      </div>
    );
  }

  const list = quests ?? [];
  const active = list.filter((q) => q.status === 'active');
  const paused = list.filter((q) => q.status === 'paused');
  const graduated = list.filter((q) => q.status === 'graduated');
  const slotsFull = activeCount(list) >= MAX_ACTIVE_QUESTS;

  const subtitle = quests === null
    ? 'Loading…'
    : [
        `${active.length} running`,
        paused.length ? `${paused.length} paused` : '',
        graduated.length ? `${graduated.length} graduated 🎓` : '',
      ].filter(Boolean).join(' · ');

  return (
    <>
      <AreaScreen
        kidId={kidId}
        kidName={kid.name}
        area="quest"
        subtitle={subtitle}
        action={isParent ? (
          <AddItemButton
            onClick={() => setWizardOpen(true)}
            label={slotsFull ? '2 of 2 running' : '+ New quest'}
          />
        ) : undefined}
      >
        {quests === null && (
          <div className="text-[13px] text-[#5A6488] py-6 text-center">Loading quests…</div>
        )}

        {quests !== null && list.length === 0 && (
          <AreaEmptyState
            emoji="🚀"
            title={isParent ? `Start ${kid.name}'s first quest` : 'No quests yet'}
            body={
              isParent
                ? 'Pick something you want them to get better at — speaking, reading, times tables, a sport. Kaya turns it into a pathway of small daily steps, and keeps the proof so you can both hear the difference later.'
                : 'When a parent sets you a quest, it will show up here with one small step a day.'
            }
            action={isParent ? (
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                className="inline-flex px-4 py-2.5 rounded-xl font-extrabold text-[13px] text-white"
                style={{ background: '#3B2E86' }}
              >
                🎯 Set a goal
              </button>
            ) : undefined}
          />
        )}

        {active.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {active.map((q) => <QuestCard key={q.id} quest={q} kidId={kidId} />)}
          </div>
        )}

        {slotsFull && isParent && (
          <p className="text-[11.5px] text-[#5A6488] mt-3 leading-snug">
            🧠 Two at a time is deliberate — a kid with three quests, a reflection, a revision and a
            workplan closes the app. Pause one to start another.
          </p>
        )}

        {paused.length > 0 && (
          <Section title="⏸ Paused">
            <div className="grid gap-3 sm:grid-cols-2">
              {paused.map((q) => <QuestCard key={q.id} quest={q} kidId={kidId} />)}
            </div>
          </Section>
        )}

        {graduated.length > 0 && (
          <Section title="🎓 Graduated">
            <div className="grid gap-3 sm:grid-cols-2">
              {graduated.map((q) => <QuestCard key={q.id} quest={q} kidId={kidId} />)}
            </div>
          </Section>
        )}
      </AreaScreen>

      {wizardOpen && familyId && (
        <NewQuestWizard
          familyId={familyId}
          kidId={kidId}
          kidName={kid.name}
          onClose={() => setWizardOpen(false)}
          onCreated={(id) => { setWizardOpen(false); router.push(`/sparks/${kidId}/quests/${id}`); }}
        />
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <div className="font-display font-extrabold text-[12px] tracking-[1px] text-[#5A6488] uppercase mb-2.5">
        {title}
      </div>
      {children}
    </div>
  );
}

function QuestCard({ quest, kidId }: { quest: Quest; kidId: string }) {
  const streak = quest.streak?.current ?? 0;
  const dim = quest.status !== 'active';
  return (
    <Link
      href={`/sparks/${kidId}/quests/${quest.id}`}
      className={`block bg-white rounded-[18px] border border-[#ECE4D3] p-4 no-underline hover:border-[#D4A847] transition-colors ${dim ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-11 h-11 rounded-[14px] grid place-items-center text-xl shrink-0"
          style={{ background: `${quest.colour}1A`, color: quest.colour }}
          aria-hidden
        >
          {quest.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-extrabold text-[14.5px] text-[#0F1F44] leading-tight">
            {quest.title}
          </div>
          <p className="text-[11.5px] text-[#5A6488] mt-1 leading-snug line-clamp-2 m-0">
            {quest.goal}
          </p>
        </div>
        {streak > 0 && (
          <span className="text-[11px] font-extrabold px-2 py-1 rounded-full bg-[#FFF1C9] text-[#8A6800] whitespace-nowrap">
            🔥{streak}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[#5A6488] font-bold">
        <span>{rhythmLine(quest)}</span>
        {!quest.pathwayApproved && quest.status === 'active' && (
          <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#FFF1C9] text-[#8A6800] whitespace-nowrap">
            Pathway to build
          </span>
        )}
        {quest.status === 'paused' && quest.pausedUntil && (
          <span className="whitespace-nowrap">Paused to {quest.pausedUntil}</span>
        )}
      </div>
    </Link>
  );
}
