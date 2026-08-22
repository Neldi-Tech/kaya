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
  subscribeToCupboard, liveItems, endedItems, books, games, dustItems, snoozeDust, DAY_LABEL,
  cupboardWeekStats,
  type CupboardShelf, type CupboardKind,
} from '@/lib/sparks/cupboard';
import { todayIso } from '@/lib/sparks/treasures';
import { CupboardFrame, Card, Pill, ShelfCard, WOOD, WOOD_DK, WOOD_BG, JADE, JADE_BG } from '@/components/sparks/CupboardShell';
import CupboardAddSheet from '@/components/sparks/CupboardAddSheet';
import CupboardScanSheet from '@/components/sparks/CupboardScanSheet';
import GameNightPicker from '@/components/sparks/GameNightPicker';

export default function CupboardHomePage() {
  const { profile } = useAuth();
  const router = useRouter();
  const familyId = profile?.familyId;
  const [shelf, setShelf] = useState<CupboardShelf | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState<CupboardKind | null>(null);
  /** C2 · 📷 Scan to add is the primary door; ⌨ typing is tier 4. */
  const [scanning, setScanning] = useState<CupboardKind | null>(null);
  /** C5 · 🎡 Game Night Picker + 🕸 dust snoozes. */
  const [picker, setPicker] = useState(false);
  const [snoozing, setSnoozing] = useState<string | null>(null);

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
              <Pill bg={WOOD} fg="#fff" onClick={() => setScanning('book')}>📷 Scan to add</Pill>
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
                <div className="flex justify-center gap-2 mt-3 flex-wrap">
                  <Pill bg={WOOD} fg="#fff" onClick={() => setScanning('book')}>📷 Scan a book</Pill>
                  <Pill bg={WOOD} fg="#fff" onClick={() => setScanning('game')}>📷 Scan a game</Pill>
                  <Pill bg={WOOD_BG} fg={WOOD_DK} onClick={() => setAdding('book')}>⌨ Type it</Pill>
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

            {/* 🐛 Bookworm Wall (N3) — coverage-first: everyone shows, nobody ranks */}
            {(() => {
              const s = cupboardWeekStats(live, todayIso());
              if (!s.readingNow.length && !s.pagesThisWeek && !s.finishedThisMonth.length && !s.playedThisWeek.length) return null;
              return (
                <Card tone="good">
                  <div className="font-display font-extrabold text-[12.5px] text-[#0E6B5E]">🐛 Bookworm Wall</div>
                  {s.readingNow.slice(0, 6).map((r) => {
                    const pct = r.pages ? Math.min(100, Math.round((r.currentPage / r.pages) * 100)) : 0;
                    return (
                      <Link key={`${r.treasureId}-${r.readerKidId}-${r.readerName}`} href={`/sparks/treasures/cupboard/${r.treasureId}`} className="block mt-1.5 no-underline">
                        <div className="text-[11px] font-bold text-[#2C4A44]">
                          {r.readerName} — <b>{r.name}</b>{r.pages ? ` p.${r.currentPage}/${r.pages}` : r.currentPage ? ` p.${r.currentPage}` : ''}{r.readNo > 1 ? ' 🔁' : ''}{r.togetherWith ? ` 🤝 with ${r.togetherWith}` : ''}
                        </div>
                        <div className="h-1.5 rounded-full bg-[#E4EDEA] overflow-hidden mt-1"><div className="h-full" style={{ width: `${pct}%`, background: JADE }} /></div>
                      </Link>
                    );
                  })}
                  <p className="text-[10.8px] font-bold text-[#2C4A44] mt-2 m-0 leading-snug">
                    This week <b>{s.pagesThisWeek} page{s.pagesThisWeek === 1 ? '' : 's'}</b>
                    {s.byReader.length ? ` (${s.byReader.map((b) => `${b.name.split(' ')[0]} ${b.pages}`).join(' · ')})` : ''}
                    {' · '}this month <b>{s.finishedThisMonth.length} book{s.finishedThisMonth.length === 1 ? '' : 's'} finished</b>
                    {s.playedThisWeek.length ? ` · 🎲 ${s.playedThisWeek.reduce((n, p) => n + p.times, 0)} game${s.playedThisWeek.reduce((n, p) => n + p.times, 0) === 1 ? '' : 's'} this week` : ''}
                    {' · '}everyone shows, nobody ranks
                  </p>
                </Card>
              );
            })()}

            {/* 🎲 Game Night (D38) */}
            {liveGames.length > 0 && shelf.settings.gameNight.enabled && (
              <div className="rounded-[13px] border border-[#EFD9A0] bg-[#FFF1C9] p-3 mb-2.5">
                <div className="text-[12px] font-extrabold text-[#8A6800]">
                  🎲 Family fun · {DAY_LABEL[shelf.settings.gameNight.dayOfWeek]} {String(shelf.settings.gameNight.hour).padStart(2, '0')}:{String(shelf.settings.gameNight.minute).padStart(2, '0')}
                </div>
                <p className="text-[10.5px] font-bold text-[#7a6320] mt-0.5 mb-0 leading-snug">
                  {(() => { const last = liveGames.filter((g) => g.lastPlayedOn).sort((a, b) => (b.lastPlayedOn || '').localeCompare(a.lastPlayedOn || ''))[0]; return last ? `Last played: ${last.name} (${last.lastPlayedOn})` : 'Nothing played yet'; })()}
                  {' · '}<button type="button" onClick={() => setPicker(true)} className="font-extrabold" style={{ color: '#8A6800' }}>Pick tonight&rsquo;s game →</button>
                </p>
              </div>
            )}

            {/* 🕸 Dust Detector (D40) — one gentle card per item */}
            {dustItems(live, shelf.settings.dustDays, todayIso()).slice(0, 3).map((d) => (
              <Card key={`dust-${d.id}`} tone="warn">
                <div className="font-display font-extrabold text-[12.5px] text-[#8A6800]">🕸 Gathering dust — {d.emoji} {d.name}</div>
                <p className="text-[10.8px] font-bold text-[#7a6320] mt-1 m-0">{d.categoryId === 'book' ? 'Not read' : 'Not played'} in {d.idleDays} days</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {d.categoryId === 'game'
                    ? <Pill bg="#D4A847" fg="#3D2E08" onClick={() => setPicker(true)}>🎡 Play it this week</Pill>
                    : <Pill bg="#D4A847" fg="#3D2E08" href={`/sparks/treasures/cupboard/${d.id}`}>💌 Invite someone to read it</Pill>}
                  <Pill bg="#fff" fg={JADE} href={`/sparks/treasures/cupboard/${d.id}`}>🤝 Pass it on</Pill>
                  <Pill bg="#EEF0F4" fg="#5B6B8C" disabled={snoozing === d.id} onClick={async () => { if (!familyId) return; setSnoozing(d.id); try { await snoozeDust(familyId, d.id, 90); } finally { setSnoozing(null); } }}>Keep · next quarter</Pill>
                </div>
              </Card>
            ))}

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
              {live.length > 0 && <Pill bg={WOOD_BG} fg={WOOD_DK} onClick={() => setAdding('book')}>⌨ Type one in</Pill>}
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

      {picker && familyId && shelf && (
        <GameNightPicker
          familyId={familyId}
          shelf={shelf}
          games={liveGames}
          onClose={() => setPicker(false)}
          onPlayed={() => { /* the shelf refreshes via the ping bus */ }}
        />
      )}
      {scanning && familyId && shelf && (
        <CupboardScanSheet
          familyId={familyId}
          shelf={shelf}
          defaultKind={scanning}
          onClose={() => setScanning(null)}
          onAdded={(ids) => { setScanning(null); if (ids.length === 1) router.push(`/sparks/treasures/cupboard/${ids[0]}`); }}
          onTypeInstead={() => { const k = scanning; setScanning(null); setAdding(k); }}
        />
      )}
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
