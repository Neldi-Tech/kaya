'use client';

// Kaya Sparks · Treasures 2.0 — a shelf (📚 Books · 🎲 Games).
//
// Design screens 3 + 10 (C1 = list/grid view; the spine view + reading
// filters arrive with C3/C6, the kind filters with C5's classify — the
// chips that exist here are the ones the data already supports).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  subscribeToCupboard, liveItems, endedItems, books, games,
  type CupboardShelf, type CupboardKind, type CupboardItem,
} from '@/lib/sparks/cupboard';
import { GAME_KINDS, isFamilyOwned } from '@/lib/sparks/treasures';
import { CupboardFrame, Card, Pill, ShelfCard, WOOD, WOOD_DK } from './CupboardShell';
import CupboardAddSheet from './CupboardAddSheet';

type Who = 'all' | 'family' | 'kids';

export default function CupboardShelfPage({ kind }: { kind: CupboardKind }) {
  const { profile } = useAuth();
  const router = useRouter();
  const familyId = profile?.familyId;
  const [shelf, setShelf] = useState<CupboardShelf | null>(null);
  const [err, setErr] = useState('');
  const [who, setWho] = useState<Who>('all');
  const [gameKind, setGameKind] = useState<string>('all');
  const [showEnded, setShowEnded] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!familyId) return;
    return subscribeToCupboard(familyId, (s, e) => { setShelf(s); setErr(e || ''); });
  }, [familyId]);

  const all = useMemo(() => {
    const list = shelf?.items ?? [];
    return kind === 'book' ? books(list) : games(list);
  }, [shelf, kind]);
  const live = liveItems(all);
  const ended = endedItems(all);
  const famN = live.filter(isFamilyOwned).length;

  const kindsPresent = useMemo(() => {
    if (kind !== 'game') return [];
    const ids = new Set(live.map((t) => t.game?.gameKind).filter(Boolean));
    return GAME_KINDS.filter((k) => ids.has(k.id));
  }, [kind, live]);

  const visible = live.filter((t) => {
    if (who === 'family' && !isFamilyOwned(t)) return false;
    if (who === 'kids' && isFamilyOwned(t)) return false;
    if (kind === 'game' && gameKind !== 'all' && t.game?.gameKind !== gameKind) return false;
    return true;
  });

  const title = kind === 'book' ? '📚 Book Shelf' : '🎲 Game Shelf';
  const noun = kind === 'book' ? 'book' : 'game';
  const sub = shelf === null ? 'Loading…'
    : `${live.length} ${noun}${live.length === 1 ? '' : 's'} · ${famN} family · ${live.length - famN} kids’`;

  return (
    <>
      <CupboardFrame back={{ href: '/sparks/treasures/cupboard', label: 'Cupboard' }} hero={{ tone: 'wood', eyebrow: '🗄 The Family Cupboard', title, sub }}>
        {err === 'forbidden' && <Card tone="warn"><div className="text-[12px] font-extrabold text-[#8A6800]">The Cupboard is for the family — a parent can open it to a helper.</div></Card>}
        {shelf === null && !err && <p className="text-[13px] text-[#5A6488] text-center py-6">Loading the shelf…</p>}

        {shelf && (
          <>
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {([['all', 'All'], ['family', '🗄 Family'], ['kids', '💎 Kids’']] as Array<[Who, string]>).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setWho(id)}
                  className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full border border-[#E8E0CF]"
                  style={who === id ? { background: WOOD, color: '#fff', borderColor: WOOD } : { background: '#fff', color: '#5B6B8C' }}>
                  {label}
                </button>
              ))}
              {kindsPresent.length > 0 && <span className="w-px bg-[#E8E0CF] mx-0.5" aria-hidden />}
              {kindsPresent.length > 0 && (
                <button type="button" onClick={() => setGameKind('all')}
                  className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full border border-[#E8E0CF]"
                  style={gameKind === 'all' ? { background: WOOD, color: '#fff', borderColor: WOOD } : { background: '#fff', color: '#5B6B8C' }}>
                  Any kind
                </button>
              )}
              {kindsPresent.map((k) => (
                <button key={k.id} type="button" onClick={() => setGameKind(k.id)}
                  className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full border border-[#E8E0CF]"
                  style={gameKind === k.id ? { background: WOOD, color: '#fff', borderColor: WOOD } : { background: '#fff', color: '#5B6B8C' }}>
                  {k.emoji} {k.label}
                </button>
              ))}
            </div>

            {live.length === 0 ? (
              <Card tone="wood">
                <div className="text-[28px] leading-none text-center">{kind === 'book' ? '📚' : '🎲'}</div>
                <p className="text-[13px] font-extrabold text-[#0F1F44] mt-1.5 mb-0 text-center">Nothing on this shelf yet</p>
                <p className="text-[11.5px] text-[#5A6488] mt-1.5 leading-snug text-center">
                  {kind === 'book' ? 'Add the books the family shares — a title is enough.' : 'Add the games you play together — the box has everything Kaya needs.'}
                </p>
                <div className="flex justify-center mt-3"><Pill bg={WOOD} fg="#fff" onClick={() => setAdding(true)}>➕ Add a {noun}</Pill></div>
              </Card>
            ) : visible.length === 0 ? (
              <p className="text-[12px] font-bold text-[#5A6488] text-center py-6">Nothing matches those filters.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {visible.map((t: CupboardItem) => <ShelfCard key={t.id} item={t} />)}
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-4">
              <Pill bg={WOOD} fg="#fff" onClick={() => setAdding(true)}>➕ Add a {noun}</Pill>
              <Pill bg="#fff" fg={WOOD_DK} href={kind === 'book' ? '/sparks/treasures/cupboard/games' : '/sparks/treasures/cupboard/books'}>
                {kind === 'book' ? '🎲 Game Shelf' : '📚 Book Shelf'}
              </Pill>
            </div>

            {ended.length > 0 && (
              <div className="mt-6">
                <button type="button" onClick={() => setShowEnded((v) => !v)}
                  className="font-display font-extrabold text-[12px] tracking-[1px] text-[#5A6488] uppercase inline-flex items-center gap-1.5">
                  🕰 Memory Shelf · {ended.length} <span className="text-[10px] opacity-60">{showEnded ? '▲' : '▼'}</span>
                </button>
                <p className="text-[11px] text-[#8A8471] leading-snug mt-1 mb-2.5">Handed on, donated or retired. Nothing is ever deleted.</p>
                {showEnded && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 opacity-70">
                    {ended.map((t) => <ShelfCard key={t.id} item={t} />)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CupboardFrame>

      {adding && familyId && shelf && (
        <CupboardAddSheet
          familyId={familyId}
          shelf={shelf}
          defaultKind={kind}
          onClose={() => setAdding(false)}
          onAdded={(id) => { setAdding(false); router.push(`/sparks/treasures/cupboard/${id}`); }}
        />
      )}
    </>
  );
}
