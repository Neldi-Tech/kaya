'use client';

// Kaya Sparks · Treasures 2.0 — 🗄 The Family Cupboard (home).
//
// Design screen 2. Two shelves the whole family shares — 📚 Books and
// 🎲 Games — inside Treasures, never a separate module (D24). Parents,
// every kid, and the helpers a parent selected (D26) all land here.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  subscribeToCupboard, liveItems, endedItems, books, games,
  type CupboardShelf, type CupboardKind,
} from '@/lib/sparks/cupboard';
import { CupboardFrame, Card, Pill, ShelfCard, WOOD, WOOD_DK, WOOD_BG, JADE, JADE_BG } from '@/components/sparks/CupboardShell';
import CupboardAddSheet from '@/components/sparks/CupboardAddSheet';

export default function CupboardHomePage() {
  const { profile } = useAuth();
  const router = useRouter();
  const familyId = profile?.familyId;
  const [shelf, setShelf] = useState<CupboardShelf | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState<CupboardKind | null>(null);

  useEffect(() => {
    if (!familyId) return;
    return subscribeToCupboard(familyId, (s, e) => { setShelf(s); setErr(e || ''); });
  }, [familyId]);

  const back = useMemo(() => {
    if (profile?.role === 'kid' && profile.childId) return { href: `/sparks/${profile.childId}/treasures`, label: 'Treasures' };
    if (profile?.role === 'parent') return { href: '/sparks/treasures', label: 'Treasures' };
    return { href: '/sparks', label: 'Sparks' };
  }, [profile?.role, profile?.childId]);

  if (err === 'forbidden') {
    return (
      <CupboardFrame back={back} hero={{ tone: 'wood', eyebrow: 'Sparks › Treasures', title: '🗄 The Family Cupboard', sub: 'Ours, together' }}>
        <Card tone="warn">
          <div className="font-display font-extrabold text-[12.5px] text-[#8A6800]">The Cupboard is for the family</div>
          <p className="text-[11px] font-bold text-[#7a6320] mt-1 m-0 leading-snug">A parent can open it to a helper in Cupboard settings.</p>
        </Card>
      </CupboardFrame>
    );
  }

  const items = shelf?.items ?? [];
  const live = liveItems(items);
  const liveBooks = books(live);
  const liveGames = games(live);
  const ended = endedItems(items);
  const missing = live.filter((t) => t.status === 'lost');
  const lent = live.filter((t) => t.status === 'lent');
  const unconfirmed = live.filter((t) => t.nameConfirmed === false);
  const recent = live.slice(0, 6);
  const famCount = (list: typeof live) => list.filter((t) => t.ownerScope === 'family' || t.kidId === 'family').length;

  const sub = shelf === null
    ? 'Loading…'
    : `Ours, together · 📚 ${liveBooks.length} book${liveBooks.length === 1 ? '' : 's'} · 🎲 ${liveGames.length} game${liveGames.length === 1 ? '' : 's'}`;

  return (
    <>
      <CupboardFrame back={back} hero={{ tone: 'wood', eyebrow: 'Sparks › Treasures', title: '🗄 The Family Cupboard', sub }}>
        {shelf === null && !err && <p className="text-[13px] text-[#5A6488] text-center py-6">Opening the cupboard…</p>}
        {err && err !== 'forbidden' && <p className="text-[11.5px] text-[#C0392B] font-bold">Could not load the Cupboard ({err}).</p>}

        {shelf && (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              <Pill bg={WOOD} fg="#fff" onClick={() => setAdding('book')}>➕ Add to the shelf</Pill>
              <Pill bg="#fff" fg={WOOD_DK} href="/sparks/treasures/cupboard/books">📚 Books</Pill>
              <Pill bg="#fff" fg={WOOD_DK} href="/sparks/treasures/cupboard/games">🎲 Games</Pill>
            </div>

            {live.length === 0 && (
              <Card tone="wood">
                <div className="text-[30px] leading-none text-center">🗄</div>
                <p className="text-[13px] font-extrabold text-[#0F1F44] mt-1.5 mb-0 text-center">The shelves are empty</p>
                <p className="text-[11.5px] text-[#5A6488] mt-1.5 leading-snug text-center">
                  Add the books and games the family shares. Anyone can add — a name is enough.
                </p>
                <div className="flex justify-center gap-2 mt-3">
                  <Pill bg={WOOD} fg="#fff" onClick={() => setAdding('book')}>📚 Add a book</Pill>
                  <Pill bg={WOOD_BG} fg={WOOD_DK} onClick={() => setAdding('game')}>🎲 Add a game</Pill>
                </div>
              </Card>
            )}

            {/* What needs someone — missing · lent · names to confirm */}
            {missing.length > 0 && (
              <Card tone="bad">
                <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">❓ Missing from the Cupboard · {missing.length}</div>
                {missing.slice(0, 4).map((t) => (
                  <Link key={t.id} href={`/sparks/treasures/cupboard/${t.id}`} className="block text-[11px] font-bold text-[#5B6B8C] mt-1 no-underline">
                    {t.emoji} {t.name}{t.lastSeenWhere ? ` · last seen ${t.lastSeenWhere}` : ''}
                  </Link>
                ))}
              </Card>
            )}
            {lent.length > 0 && (
              <Card tone="sky">
                <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">🤝 Lent out · {lent.length}</div>
                {lent.slice(0, 4).map((t) => (
                  <Link key={t.id} href={`/sparks/treasures/cupboard/${t.id}`} className="block text-[11px] font-bold text-[#5B6B8C] mt-1 no-underline">
                    {t.emoji} {t.name} → {t.borrow?.toName}{t.borrow?.dueOn ? ` · back by ${t.borrow.dueOn}` : ''}
                  </Link>
                ))}
              </Card>
            )}
            {shelf.me.canManage && unconfirmed.length > 0 && (
              <Card tone="warn">
                <div className="font-display font-extrabold text-[12.5px] text-[#8A6800]">⚠ {unconfirmed.length} name{unconfirmed.length === 1 ? '' : 's'} to confirm</div>
                <p className="text-[10.8px] font-bold text-[#7a6320] mt-1 m-0 leading-snug">Typed by hand — open each one to confirm the title so it never drifts.</p>
                {unconfirmed.slice(0, 4).map((t) => (
                  <Link key={t.id} href={`/sparks/treasures/cupboard/${t.id}`} className="block text-[11px] font-extrabold text-[#8A6800] mt-1 no-underline">
                    {t.emoji} {t.name} →
                  </Link>
                ))}
              </Card>
            )}

            {live.length > 0 && (
              <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                <Link href="/sparks/treasures/cupboard/books" className="rounded-[14px] border border-[#E4CDB2] bg-[#F6ECDF] p-3 no-underline">
                  <div className="text-[22px] leading-none">📚</div>
                  <div className="font-display font-extrabold text-[13px] text-[#0F1F44] mt-1.5">Book Shelf</div>
                  <div className="text-[10.8px] font-bold text-[#5B6B8C] mt-0.5 leading-snug">
                    {liveBooks.length} book{liveBooks.length === 1 ? '' : 's'} · {famCount(liveBooks)} family · {liveBooks.length - famCount(liveBooks)} kids&rsquo;
                  </div>
                </Link>
                <Link href="/sparks/treasures/cupboard/games" className="rounded-[14px] border border-[#E4CDB2] bg-[#F6ECDF] p-3 no-underline">
                  <div className="text-[22px] leading-none">🎲</div>
                  <div className="font-display font-extrabold text-[13px] text-[#0F1F44] mt-1.5">Game Shelf</div>
                  <div className="text-[10.8px] font-bold text-[#5B6B8C] mt-0.5 leading-snug">
                    {liveGames.length} game{liveGames.length === 1 ? '' : 's'} · {famCount(liveGames)} family · {liveGames.length - famCount(liveGames)} kids&rsquo;
                  </div>
                </Link>
              </div>
            )}

            {recent.length > 0 && (
              <>
                <div className="font-display font-extrabold text-[11px] tracking-[1.2px] text-[#5A6488] uppercase mb-2 mt-1">Recently added</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {recent.map((t) => <ShelfCard key={t.id} item={t} />)}
                </div>
              </>
            )}

            <div className="flex flex-wrap gap-2 mt-4">
              <Pill bg={JADE_BG} fg={JADE} href="/sparks/treasures/lost-found">🔍 Lost &amp; Found{missing.length ? ` · ${missing.length}` : ''}</Pill>
              {shelf.me.canManage && <Pill bg="#EEF0F4" fg="#5B6B8C" href="/sparks/treasures/cupboard/settings">⚙️ Cupboard settings</Pill>}
            </div>

            {ended.length > 0 && (
              <p className="text-[11px] text-[#8A8471] leading-snug mt-4">
                🕰 {ended.length} thing{ended.length === 1 ? '' : 's'} handed on, donated or retired live on the shelves&rsquo; Memory Shelf — nothing is ever deleted.
              </p>
            )}

            <p className="text-[10.5px] text-[#8A8471] italic leading-snug mt-3">
              {shelf.me.role === 'helper'
                ? 'You can see, add and log here — a parent opened the Cupboard to you.'
                : 'Anyone in the family may add. Titles come from a scan or a lookup when they can — typed ones wait for a parent.'}
            </p>
          </>
        )}
      </CupboardFrame>

      {adding && familyId && shelf && (
        <CupboardAddSheet
          familyId={familyId}
          shelf={shelf}
          defaultKind={adding}
          onClose={() => setAdding(null)}
          onAdded={(id) => { setAdding(null); router.push(`/sparks/treasures/cupboard/${id}`); }}
        />
      )}
    </>
  );
}
