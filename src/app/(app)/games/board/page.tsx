'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { FUN_LABEL, FUN_EMOJI } from '@/lib/gamesFun';
import { Page, DataRows, DATA_ROW } from '@/components/layout/Page';

// Games Leaderboard — three tabs:
//   ✨ Fun Points — the universal gaming score (every game, kids AND parents),
//      from gameStats.funPoints. The Kids-only toggle filters to kids.
//   🏆 Wins — multi-device wins from gameStats (kids + parents).
//   ⭐ HP — House Points earned ONLY from mind games (sum of approved
//      gamePlays). HP is a kid currency, so this board is always kids.
// Fun + Wins read gameStats (Admin-written, family-readable); HP reads gamePlays.

const MEDALS = ['🥇', '🥈', '🥉'];
type Tab = 'fun' | 'wins' | 'points';
type Stat = { uid: string; name: string; role: string; wins: number; streak: number; best: number; funPoints: number; funWeekly: number };

export default function GamesBoardPage() {
  const { profile } = useAuth();
  const { children, loading } = useFamily();
  const [tab, setTab] = useState<Tab>('fun');
  const [gamePts, setGamePts] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<Stat[]>([]);
  const [kidsOnly, setKidsOnly] = useState(false);
  const myUid = profile?.uid;
  const myChildId = profile?.childId;
  const familyId = profile?.familyId;

  // ⭐ HP = sum of APPROVED game plays per kid (mind games only).
  useEffect(() => {
    let cancelled = false;
    if (!familyId) return;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'families', familyId, 'gamePlays'),
          where('status', '==', 'approved'),
        ));
        if (cancelled) return;
        const acc: Record<string, number> = {};
        snap.forEach((d) => {
          const p = d.data() as { kidId?: string; pointsAwarded?: number };
          if (p.kidId) acc[p.kidId] = (acc[p.kidId] || 0) + (Number(p.pointsAwarded) || 0);
        });
        setGamePts(acc);
      } catch { /* board still works on the other tabs */ }
    })();
    return () => { cancelled = true; };
  }, [familyId]);

  // ✨ Fun + 🏆 Wins = per-player gameStats (parents + kids, keyed by auth uid).
  useEffect(() => {
    let cancelled = false;
    if (!familyId) return;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'families', familyId, 'gameStats'));
        if (cancelled) return;
        const rows: Stat[] = [];
        snap.forEach((d) => {
          const s = d.data() as Partial<Stat>;
          rows.push({
            uid: s.uid || d.id,
            name: s.name || 'Player',
            role: s.role || 'parent',
            wins: Number(s.wins) || 0,
            streak: Number(s.streak) || 0,
            best: Number(s.best) || 0,
            funPoints: Number(s.funPoints) || 0,
            funWeekly: Number(s.funWeekly) || 0,
          });
        });
        setStats(rows);
      } catch { /* Fun + Wins tabs simply show empty */ }
    })();
    return () => { cancelled = true; };
  }, [familyId]);

  // Match a stat to a kid avatar by name (kids are usually uniquely named);
  // fall back to a role glyph so parents/helpers still get a face.
  const avatarFor = (s: Stat): string => {
    const kid = children.find((c) => c.name.trim().toLowerCase() === s.name.trim().toLowerCase());
    if (kid?.avatarEmoji) return kid.avatarEmoji;
    return s.role === 'kid' ? '🧒' : s.role === 'helper' ? '🧑' : '👤';
  };

  const pointsRanked = useMemo(() => (
    [...children].sort((a, b) => (gamePts[b.id] || 0) - (gamePts[a.id] || 0))
  ), [children, gamePts]);

  const filteredStats = useMemo(() => (
    [...stats].filter((s) => (kidsOnly ? s.role === 'kid' : true))
  ), [stats, kidsOnly]);

  const funRanked = useMemo(() => (
    [...filteredStats].sort((a, b) => b.funPoints - a.funPoints)
  ), [filteredStats]);

  const winsRanked = useMemo(() => (
    [...filteredStats].sort((a, b) => b.wins - a.wins || b.best - a.best)
  ), [filteredStats]);

  const Card = ({ rank, avatar, name, roleTag, me, children: right }: {
    rank: number; avatar: string; name: string; roleTag?: string; me: boolean; children: ReactNode;
  }) => (
    <div className={`flex items-center gap-3 rounded-kaya p-3 shadow-[0_4px_12px_rgba(26,18,64,0.06)] lg:px-4 ${DATA_ROW} ${
      me ? 'bg-games-violet/10 ring-2 ring-games-violet lg:ring-inset' : 'bg-games-card'
    }`}>
      <span className="w-7 text-center font-display font-black text-games-ink-soft text-lg shrink-0">{rank < 3 ? MEDALS[rank] : rank + 1}</span>
      <span className="text-2xl shrink-0">{avatar}</span>
      <span className="flex-1 font-display font-extrabold text-games-ink truncate">
        {name}
        {roleTag && <span className="text-[10px] font-bold text-games-ink-soft ml-1.5">{roleTag}</span>}
        {me && <span className="text-[10px] font-bold text-games-violet ml-1.5">you</span>}
      </span>
      {right}
    </div>
  );

  // Web-Fit (2026-08-23): content tier. Desktop: tabs + the Kids-only
  // filter share one toolbar row, ranked lists render as dense rows
  // (DataRows). Mobile markup/order unchanged (the toolbar wrapper is a
  // plain block below `lg`).
  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-transparent">
      <Page width="content" className="pb-28">
        <Link href="/games" className="text-sm font-bold text-games-ink-soft">&larr; Games</Link>

        <div className="rounded-kaya-lg p-5 my-4 text-white text-center bg-gradient-to-br from-games-violet to-[#9333EA]">
          <div className="text-4xl mb-1">🏆</div>
          <h1 className="font-display text-2xl font-black">Games Leaderboard</h1>
        </div>

        <div className="lg:flex lg:items-center lg:justify-between lg:gap-4 lg:mb-4">
        <div className="flex gap-1 mb-3 bg-games-bg rounded-full p-1 lg:mb-0 lg:w-[420px]">
          {([['fun', `${FUN_EMOJI} Fun`], ['wins', '🏆 Wins'], ['points', '⭐ HP']] as const).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-full text-sm font-extrabold transition-colors ${
                tab === t ? 'bg-games-violet text-white' : 'text-games-ink-soft'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Kids-only filter — for Fun + Wins (both include parents). HP is
            always kids (parents never earn House Points). */}
        {tab !== 'points' && (
          <button
            type="button"
            onClick={() => setKidsOnly((v) => !v)}
            className={`mb-4 lg:mb-0 inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-1.5 rounded-full border transition-colors ${
              kidsOnly
                ? 'bg-games-violet text-white border-games-violet'
                : 'bg-games-card text-games-ink-soft border-games-ink-soft/20'
            }`}
          >
            {kidsOnly ? '🧒 Kids only' : '👨‍👩‍👧 Everyone'}
          </button>
        )}
        </div>

        {tab === 'fun' ? (
          funRanked.length === 0 ? (
            <p className="text-center text-sm text-games-ink-soft py-10">No {FUN_LABEL} yet — play any game!</p>
          ) : (
            <DataRows tone="kaya">
              {funRanked.map((s, i) => (
                <Card key={s.uid} rank={i} avatar={avatarFor(s)} name={s.name} me={!!myUid && s.uid === myUid}
                  roleTag={s.role !== 'kid' ? (s.role === 'helper' ? 'helper' : 'parent') : undefined}>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {s.funWeekly > 0 && (
                      <span className="bg-games-mint text-games-ink text-[10px] font-black px-2 py-0.5 rounded-full">+{s.funWeekly.toLocaleString()} wk</span>
                    )}
                    <span className="font-display font-black text-games-violet">
                      {s.funPoints.toLocaleString()} <span aria-hidden>{FUN_EMOJI}</span>
                    </span>
                  </span>
                </Card>
              ))}
            </DataRows>
          )
        ) : tab === 'wins' ? (
          winsRanked.length === 0 ? (
            <p className="text-center text-sm text-games-ink-soft py-10">No wins yet — play a multi-device game!</p>
          ) : (
            <DataRows tone="kaya">
              {winsRanked.map((s, i) => (
                <Card key={s.uid} rank={i} avatar={avatarFor(s)} name={s.name} me={!!myUid && s.uid === myUid}
                  roleTag={s.role !== 'kid' ? (s.role === 'helper' ? 'helper' : 'parent') : undefined}>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="font-display font-black text-games-violet">
                      {s.wins}<span className="text-[10px] font-bold text-games-ink-soft ml-0.5">{s.wins === 1 ? 'win' : 'wins'}</span>
                    </span>
                    {s.streak > 0 && (
                      <span className="bg-[#FFEDE0] text-[#C2410C] text-[10px] font-black px-2 py-0.5 rounded-full">🔥 {s.streak}</span>
                    )}
                  </span>
                </Card>
              ))}
            </DataRows>
          )
        ) : (
          loading ? (
            <p className="text-center text-sm text-games-ink-soft py-10">Loading…</p>
          ) : pointsRanked.length === 0 ? (
            <p className="text-center text-sm text-games-ink-soft py-10">No kids in the family yet.</p>
          ) : (
            <DataRows tone="kaya">
              {pointsRanked.map((c, i) => (
                <Card key={c.id} rank={i} avatar={c.avatarEmoji || '🙂'} name={c.name} me={!!myChildId && c.id === myChildId}>
                  <span className="font-display font-black text-games-violet shrink-0">
                    {(gamePts[c.id] || 0).toLocaleString()}<span className="text-[10px] font-bold text-games-ink-soft ml-0.5">HP</span>
                  </span>
                </Card>
              ))}
            </DataRows>
          )
        )}

        <p className="text-center text-[11px] text-games-ink-soft mt-4">
          {tab === 'fun'
            ? `${FUN_LABEL} — earned from every game (kids + parents). Just for fun, no real value.`
            : tab === 'wins'
              ? 'Wins from multi-device games — parents who play count too.'
              : 'House Points — only from mind-strengthening games, after a parent approves.'}
        </p>
      </Page>
    </div>
  );
}
