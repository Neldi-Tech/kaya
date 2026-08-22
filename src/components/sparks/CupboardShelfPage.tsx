'use client';

// Kaya Sparks · Treasures 2.0 — a shelf (📚 Books · 🎲 Games).
//
// Design screens 3 + 10 (C1 = list/grid view; the spine view + reading
// filters arrive with C3/C6, the kind filters with C5's classify — the
// chips that exist here are the ones the data already supports).

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import GameNightPicker from './GameNightPicker';
import { useAuth } from '@/contexts/AuthContext';
import {
  subscribeToCupboard, liveItems, endedItems, books, games,
  type CupboardShelf, type CupboardKind, type CupboardItem,
} from '@/lib/sparks/cupboard';
import { GAME_KINDS, isFamilyOwned, liveReadings, finishedReadings, isFavouriteBook } from '@/lib/sparks/treasures';
import { CupboardFrame, Card, Pill, ShelfCard, WOOD, WOOD_DK, WOOD_BG } from './CupboardShell';
import CupboardAddSheet from './CupboardAddSheet';
import CupboardScanSheet from './CupboardScanSheet';

/** Books add the reading-state filters (D31 · design screen 3). */
type Who = 'all' | 'family' | 'kids' | 'reading' | 'unread' | 'finished' | 'fav';

/** N2 · the Book Shelf drawn as real spines — coloured by state: unread ·
 *  reading (fill = progress) · finished · 🔁 favourite. Tap a spine = open. */
function SpineShelf({ items }: { items: CupboardItem[] }) {
  const state = (t: CupboardItem) => {
    if (isFavouriteBook(t)) return 'fav' as const;
    if (liveReadings(t).length) return 'reading' as const;
    if (finishedReadings(t).length) return 'done' as const;
    return 'unread' as const;
  };
  const colour = { unread: '#B9C3D2', reading: '#0E6B5E', done: '#8B5E34', fav: '#D4A847' };
  const fg = { unread: '#2c3a52', reading: '#fff', done: '#fff', fav: '#3D2E08' };
  const progress = (t: CupboardItem) => {
    const r = liveReadings(t)[0];
    return r?.pages ? Math.min(100, Math.round((r.currentPage / r.pages) * 100)) : 0;
  };
  const width = (t: CupboardItem) => {
    const p = t.book?.pages || 200;
    return Math.max(22, Math.min(40, Math.round(18 + p / 25)));
  };
  return (
    <div>
      <div className="flex flex-wrap items-end gap-1 px-2 pb-1.5 rounded-b-[4px]" style={{ minHeight: 140, borderBottom: '8px solid #8B5E34', background: 'linear-gradient(#fff,#F6ECDF)' }}>
        {items.map((t) => {
          const s = state(t);
          const pct = s === 'reading' ? progress(t) : 0;
          return (
            <Link key={t.id} href={`/sparks/treasures/cupboard/${t.id}`} title={`${t.name}${t.book?.author ? ` · ${t.book.author}` : ''}${t.book?.summary && !t.book.summaryHidden ? ` — ${t.book.summary}` : ''}`}
              className="relative overflow-hidden no-underline rounded-t-[3px]"
              style={{ width: width(t), height: 120, background: colour[s], color: fg[s] }}>
              {pct > 0 && <span className="absolute left-0 right-0 bottom-0" style={{ height: `${pct}%`, background: 'rgba(255,255,255,.35)' }} aria-hidden />}
              <span className="absolute inset-0 grid place-items-center text-[8.5px] font-extrabold leading-none px-0.5 text-center" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                {t.nameConfirmed === false ? '⚠ ' : ''}{t.name.slice(0, 26)}
              </span>
            </Link>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2.5 text-[9.5px] font-extrabold text-[#5B6B8C] mt-1.5">
        <span><i className="inline-block w-2 h-2 rounded-[2px] mr-1 align-middle" style={{ background: colour.unread }} />unread</span>
        <span><i className="inline-block w-2 h-2 rounded-[2px] mr-1 align-middle" style={{ background: colour.reading }} />reading (fill = progress)</span>
        <span><i className="inline-block w-2 h-2 rounded-[2px] mr-1 align-middle" style={{ background: colour.done }} />finished</span>
        <span><i className="inline-block w-2 h-2 rounded-[2px] mr-1 align-middle" style={{ background: colour.fav }} />🔁 read 2×+</span>
      </div>
    </div>
  );
}

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
  const [scanning, setScanning] = useState(false);
  /** C5 · 🎡 the Game Night Picker — `?pick=1` (the cron's push link) opens it. */
  const search = useSearchParams();
  const [picker, setPicker] = useState(false);
  useEffect(() => { if (kind === 'game' && search?.get('pick') === '1') setPicker(true); }, [kind, search]);
  /** C6 · N2 — the Book Shelf draws as spines by default; ≡ list view toggles. */
  const [view, setView] = useState<'spines' | 'grid'>(kind === 'book' ? 'spines' : 'grid');

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
    if (who === 'reading' && liveReadings(t).length === 0) return false;
    if (who === 'unread' && (t.readings ?? []).length > 0) return false;
    if (who === 'finished' && finishedReadings(t).length === 0) return false;
    if (who === 'fav' && !isFavouriteBook(t)) return false;
    if (kind === 'game' && gameKind !== 'all' && t.game?.gameKind !== gameKind) return false;
    return true;
  });

  const title = kind === 'book' ? '📚 Book Shelf' : '🎲 Game Shelf';
  const noun = kind === 'book' ? 'book' : 'game';
  const sub = shelf === null ? 'Loading…'
    : `${live.length} ${noun}${live.length === 1 ? '' : 's'} · ${famN} family · ${live.length - famN} kids’`;

  return (
    <>
      <CupboardFrame
        back={{ href: '/sparks/treasures/cupboard', label: 'Cupboard' }}
        hero={{ tone: 'wood', eyebrow: '🗄 The Family Cupboard', title, sub }}
        actions={shelf ? (
          <>
            <Pill bg="#fff" fg={WOOD_DK} onClick={() => setScanning(true)}>📷 Scan a {noun}</Pill>
            <Pill bg="rgba(255,255,255,.18)" fg="#fff" onClick={() => setAdding(true)}>⌨ Type it</Pill>
            {kind === 'game' && live.length > 0 && <Pill bg="#D4A847" fg="#3D2E08" onClick={() => setPicker(true)}>🎡 Pick tonight&rsquo;s game</Pill>}
            <Pill bg="rgba(255,255,255,.18)" fg="#fff" href={kind === 'book' ? '/sparks/treasures/cupboard/games' : '/sparks/treasures/cupboard/books'}>{kind === 'book' ? '🎲 Game Shelf' : '📚 Book Shelf'}</Pill>
          </>
        ) : undefined}
      >
        {err === 'forbidden' && <Card tone="warn"><div className="text-[12px] font-extrabold text-[#8A6800]">The Cupboard is for the family — a parent can open it to a helper.</div></Card>}
        {shelf === null && !err && <p className="text-[13px] text-[#5A6488] text-center py-6">Loading the shelf…</p>}

        {shelf && (
          <>
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {(([['all', 'All'], ['family', '🗄 Family'], ['kids', '💎 Kids’']] as Array<[Who, string]>)
                .concat(kind === 'book' ? [['reading', '📖 Reading'], ['unread', 'Unread'], ['finished', '🏁 Finished'], ['fav', '🔁 Favourites']] as Array<[Who, string]> : [])
              ).map(([id, label]) => (
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
                <div className="flex justify-center gap-2 mt-3 flex-wrap">
                  <Pill bg={WOOD} fg="#fff" onClick={() => setScanning(true)}>📷 Scan a {noun}</Pill>
                  <Pill bg={WOOD_BG} fg={WOOD_DK} onClick={() => setAdding(true)}>⌨ Type it</Pill>
                </div>
              </Card>
            ) : visible.length === 0 ? (
              <p className="text-[12px] font-bold text-[#5A6488] text-center py-6">Nothing matches those filters.</p>
            ) : (
              view === 'spines' && kind === 'book' ? (
                <SpineShelf items={visible} />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 lg:gap-3">
                  {visible.map((t: CupboardItem) => <ShelfCard key={t.id} item={t} />)}
                </div>
              )
            )}
            {kind === 'book' && live.length > 0 && (
              <div className="flex justify-end mt-2">
                <button type="button" onClick={() => setView((v) => (v === 'spines' ? 'grid' : 'spines'))} className="text-[10.5px] font-extrabold" style={{ color: WOOD_DK }}>
                  {view === 'spines' ? '≡ list view' : '📚 spine view'}
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-4">
              <Pill bg={WOOD} fg="#fff" onClick={() => setScanning(true)}>📷 Scan a {noun}</Pill>
              <Pill bg={WOOD_BG} fg={WOOD_DK} onClick={() => setAdding(true)}>⌨ Type it</Pill>
              {kind === 'game' && live.length > 0 && <Pill bg="#D4A847" fg="#3D2E08" onClick={() => setPicker(true)}>🎡 Pick tonight&rsquo;s game</Pill>}
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
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 lg:gap-3 opacity-70">
                    {ended.map((t) => <ShelfCard key={t.id} item={t} />)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CupboardFrame>

      {picker && familyId && shelf && kind === 'game' && (
        <GameNightPicker
          familyId={familyId}
          shelf={shelf}
          games={live}
          onClose={() => setPicker(false)}
          onPlayed={() => { /* the shelf refreshes via the ping bus */ }}
        />
      )}
      {scanning && familyId && shelf && (
        <CupboardScanSheet
          familyId={familyId}
          shelf={shelf}
          defaultKind={kind}
          onClose={() => setScanning(false)}
          onAdded={(ids) => { setScanning(false); if (ids.length === 1) router.push(`/sparks/treasures/cupboard/${ids[0]}`); }}
          onTypeInstead={() => { setScanning(false); setAdding(true); }}
        />
      )}
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
