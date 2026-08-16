'use client';

// Kaya Sparks · Treasures — the kid's shelf.
//
// D1 · 10th area, same AreaScreen shell as every other Sparks surface.
// D8 · the Care ring leads, because the behaviour is the point — not the
//      count and never the value.
// D5 · a sibling reaching this page sees only promoted treasures (the
//      gateway filters; the UI never renders a flash of the rest).

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { toDisplayDate } from '@/lib/dates';
import { useFamily } from '@/contexts/FamilyContext';
import AreaScreen, { AddItemButton, AreaEmptyState } from '@/components/sparks/AreaScreen';
import AddTreasureWizard from '@/components/sparks/AddTreasureWizard';
import { openModuleGuide } from '@/lib/moduleGuides';
import {
  subscribeToTreasures, computeCareScore, liveTreasures, memoryShelf,
  missingItems, lentItems, giverLine, daysBetween, todayIso,
  fetchTreasuresToday, CADENCE_LABEL,
  STATUS_CHIP, STATUS_LABEL, type Treasure, type TreasuresToday,
} from '@/lib/sparks/treasures';

export default function TreasuresAreaPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId ?? '';
  const router = useRouter();
  const { profile } = useAuth();
  const { children, loading } = useFamily();

  const familyId = profile?.familyId;
  const isKid = profile?.role === 'kid';
  const isParent = profile?.role === 'parent';
  const isOwner = !!profile?.childId && profile.childId === kidId;
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  const [list, setList] = useState<Treasure[] | null>(null);
  const [today0, setToday0] = useState<TreasuresToday | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [showMemory, setShowMemory] = useState(false);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToTreasures(familyId, kidId, (ts) => {
      setList(ts);
      // The check's due-state is computed server-side from the parent's
      // cadence (D23) — the client never re-derives it.
      fetchTreasuresToday(kidId).then(setToday0).catch(() => setToday0(null));
    });
  }, [familyId, kidId]);

  if (loading || !kid) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#0F1F44] text-sm">
        Loading…
      </div>
    );
  }

  const all = list ?? [];
  const live = liveTreasures(all);
  const shelved = memoryShelf(all);
  const missing = missingItems(all);
  const lent = lentItems(all);
  const care = computeCareScore(all, isKid ? 'You' : kid.name);
  const today = todayIso();

  const subtitle = list === null
    ? 'Loading…'
    : [
        `${live.length} thing${live.length === 1 ? '' : 's'} you look after`,
        lent.length ? `${lent.length} lent` : '',
        missing.length ? `${missing.length} missing` : '',
      ].filter(Boolean).join(' · ');

  return (
    <>
      <AreaScreen
        kidId={kidId}
        kidName={kid.name}
        area="treasure"
        subtitle={subtitle}
        action={<AddItemButton onClick={() => setWizardOpen(true)} label="+ Add a treasure" />}
      >
        {/* ▶ The instruction manual. The pieces on screen never explain
            the ORDER they go in, which is the part that actually
            confuses a new family. */}
        <button
          type="button"
          onClick={() => openModuleGuide('treasures')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#BFE3D8] bg-[#F1FAF7] text-[#0E6B5E] text-[11.5px] font-extrabold mb-3"
        >
          ▶ How Treasures works
        </button>

        {list === null && (
          <div className="text-[13px] text-[#5A6488] py-6 text-center">Loading treasures…</div>
        )}

        {list !== null && all.length === 0 && (
          <AreaEmptyState
            emoji="💎"
            title={isOwner ? 'Start with ten things' : `${kid.name} hasn't added anything yet`}
            body={
              isOwner
                ? 'Add the ten things you would be saddest to lose. A photo and a name is enough — you can fill in who gave it and why it matters any time.'
                : 'Treasures is where they keep a record of the things they own — what it is, who gave it, and what has happened to it since.'
            }
            action={(
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                className="inline-flex px-4 py-2.5 rounded-xl font-extrabold text-[13px] text-white"
                style={{ background: '#0E6B5E' }}
              >
                💎 Add the first one
              </button>
            )}
          />
        )}

        {list !== null && all.length > 0 && (
          <>
            {/* D8 · the ring leads. Never a grade, never compared across
                children — the line under it is growth-voice, always. */}
            <div className="flex items-center gap-3 rounded-[14px] border border-[#BFE3D8] bg-[#F1FAF7] p-3">
              <div
                className="w-[62px] h-[62px] rounded-full grid place-items-center shrink-0"
                style={{
                  background: `conic-gradient(#0E6B5E 0 ${care.score}%, #E4EDEA ${care.score}% 100%)`,
                }}
                aria-hidden
              >
                <span className="w-[48px] h-[48px] rounded-full bg-white grid place-items-center font-display font-extrabold text-[14px] text-[#0E6B5E]">
                  {care.score}%
                </span>
              </div>
              <div className="min-w-0">
                <div className="font-display font-extrabold text-[12.5px] text-[#0E6B5E]">
                  🔑 Keeper Score · {care.score}%
                </div>
                <p className="text-[11px] font-bold text-[#2C4A44] leading-snug mt-0.5 m-0">
                  {care.line}
                </p>
              </div>
            </div>

            {/* D23 · the ritual, surfaced where the child already is.
                Amber when it's due, red once it's slipping — the words
                never change, only the urgency. */}
            {today0?.check.due && (
              <div
                className={`rounded-[13px] border p-3 mt-3 ${
                  today0.check.overdueDays >= 1
                    ? 'border-[#F0C9CC] bg-[#FEF6F6]'
                    : 'border-[#EFD9A0] bg-[#FFF1C9]'
                }`}
              >
                <div
                  className="font-display font-extrabold text-[12px]"
                  style={{ color: today0.check.overdueDays >= 1 ? '#8B2830' : '#8A6800' }}
                >
                  🔑 Keeper Check is due
                  {today0.check.overdueDays >= 1
                    ? ` · ${today0.check.overdueDays} day${today0.check.overdueDays === 1 ? '' : 's'} ago`
                    : ' today'}
                </div>
                <p className="text-[10.5px] font-bold mt-1 m-0 leading-snug" style={{ color: '#7a6320' }}>
                  {today0.check.items} thing{today0.check.items === 1 ? '' : 's'} to tap · about 30 seconds
                </p>
                <Link
                  href={`/sparks/${kidId}/treasures/check`}
                  className="inline-flex mt-2 px-4 py-2 rounded-full font-extrabold text-[12px] no-underline"
                  style={{ background: '#D4A847', color: '#3D2E08' }}
                >
                  Start the check
                </Link>
              </div>
            )}

            {today0 && !today0.check.due && today0.check.enabled && today0.check.items > 0 && (
              <p className="text-[11px] font-bold text-[#8A8471] mt-3 mb-0">
                🔑 Next Keeper Check: {toDisplayDate(today0.check.dueOn)} ·{' '}
                {CADENCE_LABEL[today0.check.cadence].toLowerCase()}
                {isParent && (
                  <>
                    {' · '}
                    <Link href={`/sparks/${kidId}/treasures/setup`} className="text-[#0E6B5E] font-extrabold">
                      change
                    </Link>
                  </>
                )}
              </p>
            )}

            {missing.length > 0 && (
              <div className="mt-3">
                {missing.map((t) => (
                  <Link
                    key={t.id}
                    href={`/sparks/${kidId}/treasures/${t.id}`}
                    className="block rounded-[14px] border border-[#F0C9CC] bg-[#FEF6F6] p-3 mb-2 no-underline"
                  >
                    <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
                      ❓ {t.name} · missing{' '}
                      {t.lostSince ? `${daysBetween(t.lostSince, today)} day${daysBetween(t.lostSince, today) === 1 ? '' : 's'}` : ''}
                    </div>
                    <p className="text-[10.8px] font-bold text-[#5B6B8C] mt-1 m-0 leading-snug">
                      {t.lastSeenWhere ? `Last seen: ${t.lastSeenWhere}` : 'Tap to say where you had it last'}
                      {t.sightings?.length ? ` · ${t.sightings.length} looking` : ''}
                    </p>
                  </Link>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 mt-3">
              {live.map((t) => <TreasureCard key={t.id} t={t} kidId={kidId} />)}
            </div>

            {/* 🧳 Trip Mode (pathway 6) — the highest-practical-value
                idea in the whole module, because it prevents loss
                instead of recording it. Going somewhere? Here is the
                list, and the question that matters is the one on the
                way BACK. */}
            {live.some((t) => t.travels) && (
              <div className="rounded-[13px] border border-[#DFE3FB] bg-[#F7F9FF] p-3 mt-3">
                <div className="font-display font-extrabold text-[12px] text-[#3B2E86]">
                  🧳 Travels with you · {live.filter((t) => t.travels).length}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {live.filter((t) => t.travels).map((t) => (
                    <span
                      key={t.id}
                      className="text-[11px] font-extrabold px-2.5 py-1 rounded-full bg-white border border-[#C9D2F5] text-[#3B2E86]"
                    >
                      {t.emoji} {t.name}
                    </span>
                  ))}
                </div>
                <p className="text-[10.5px] font-bold text-[#5B6B8C] mt-2 m-0 leading-snug">
                  Pack these when you go away — then run a Keeper Check the day you get back, while
                  you can still remember where you left things.
                </p>
              </div>
            )}

            {/* The two rails that actually prevent loss (D10 · D11). */}
            <div className="flex flex-wrap gap-2 mt-4">
              <Link
                href="/sparks/treasures/lost-found"
                className="px-3.5 py-2 rounded-full font-extrabold text-[12px] no-underline bg-[#E2F3EE] text-[#0E6B5E]"
              >
                🔍 Lost &amp; Found{missing.length ? ` · ${missing.length}` : ''}
              </Link>
              {lent.length > 0 && (
                <span className="px-3.5 py-2 rounded-full font-extrabold text-[12px] bg-[#EFE8FF] text-[#5A3CB8]">
                  🤝 {lent.length} lent out
                </span>
              )}
              <Link
                href={`/sparks/${kidId}/treasures/wishes`}
                className="px-3.5 py-2 rounded-full font-extrabold text-[12px] no-underline bg-[#FFF1C9] text-[#8A6800]"
              >
                ✨ Wish Shelf
              </Link>
              {isParent && (
                <Link
                  href={`/sparks/${kidId}/treasures/setup`}
                  className="px-3.5 py-2 rounded-full font-extrabold text-[12px] no-underline bg-[#EEF0F4] text-[#5B6B8C]"
                >
                  ⚙️ Check settings
                </Link>
              )}
            </div>

            {shelved.length > 0 && (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => setShowMemory((v) => !v)}
                  className="font-display font-extrabold text-[12px] tracking-[1px] text-[#5A6488] uppercase inline-flex items-center gap-1.5"
                >
                  🕰 Memory Shelf · {shelved.length}
                  <span className="text-[10px] opacity-60">{showMemory ? '▲' : '▼'}</span>
                </button>
                <p className="text-[11px] text-[#8A8471] leading-snug mt-1 mb-2.5">
                  Nothing is ever deleted. Things you handed on, gave away or grew out of live here.
                </p>
                {showMemory && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                    {shelved.map((t) => <TreasureCard key={t.id} t={t} kidId={kidId} dim />)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </AreaScreen>

      {wizardOpen && familyId && (
        <AddTreasureWizard
          familyId={familyId}
          kidId={kidId}
          kidName={kid.name}
          onClose={() => setWizardOpen(false)}
          onCreated={(id) => {
            setWizardOpen(false);
            router.push(`/sparks/${kidId}/treasures/${id}`);
          }}
        />
      )}
    </>
  );
}

function TreasureCard({ t, kidId, dim }: { t: Treasure; kidId: string; dim?: boolean }) {
  const chip = STATUS_CHIP[t.status];
  return (
    <Link
      href={`/sparks/${kidId}/treasures/${t.id}`}
      className={`block rounded-[13px] border border-[#ECE4D3] bg-white overflow-hidden no-underline hover:border-[#3FA38F] transition-colors ${dim ? 'opacity-70' : ''}`}
    >
      <div
        className={`h-[68px] grid place-items-center text-[28px] bg-[#FBF4E4] ${
          t.status === 'lost' ? 'grayscale opacity-50' : ''
        }`}
      >
        {t.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.thumbUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span aria-hidden>{t.emoji}</span>
        )}
      </div>
      <div className="px-2 py-1.5">
        <div className="font-display font-extrabold text-[11.5px] leading-tight text-[#0F1F44] line-clamp-2">
          {t.name}
        </div>
        <div className="text-[9.5px] font-bold text-[#5B6B8C] mt-0.5 line-clamp-1">
          {giverLine(t) || '—'}
        </div>
        <span
          className="inline-block mt-1.5 text-[9.5px] font-extrabold px-2 py-0.5 rounded-full"
          style={{ background: chip.bg, color: chip.fg }}
        >
          {chip.emoji} {STATUS_LABEL[t.status]}
        </span>
      </div>
    </Link>
  );
}
