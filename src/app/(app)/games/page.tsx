'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import BackButton from '@/components/ui/BackButton';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getChildren, type Child } from '@/lib/firestore';
import { resolveGamesConfig, gamePointsValue, type GamesConfig } from '@/lib/games';
import {
  GAME_WORLDS, gamesByWorld, getGame, DAILY_PICK_ID,
  ageLabel, type GameDef, type GameTone, type DeviceMode, type GameWorld,
} from '@/lib/gamesCatalog';

// Icon-tile gradients — light tints of the scoped games-* palette, taken
// straight from the approved LaunchDay design.
const TONE_TILE: Record<GameTone, string> = {
  violet: 'from-[#EDE9FE] to-[#C4B5FD]',
  coral:  'from-[#FFE4E4] to-[#FFB4B4]',
  teal:   'from-[#CCFBF1] to-[#5EEAD4]',
  gold:   'from-[#FEF3C7] to-[#FBBF24]',
  sky:    'from-[#DBEAFE] to-[#93C5FD]',
  pink:   'from-[#FCE7F3] to-[#F9A8D4]',
};

const DEVICE_TAG: Record<DeviceMode, { cls: string; label: string } | null> = {
  solo: null,
  same: { cls: 'bg-[#DBEAFE] text-[#1E40AF]', label: '📱 Same' },
  multi: { cls: 'bg-[#DCFCE7] text-[#166534]', label: '📲 Multi' },
  both: { cls: 'bg-[#FEF3C7] text-[#92400E]', label: '📱📲 Both' },
};

function metaLine(g: GameDef): string {
  if (g.world === 'realworld') return 'This week · ★ Photo proof';
  if (g.world === 'family') return `${g.players ?? '2+'} players · ${g.minutes} min`;
  return `${ageLabel(g.minAge)} · ${g.minutes} min`;
}

function GameCard({ g, cfg }: { g: GameDef; cfg: GamesConfig }) {
  const tag = DEVICE_TAG[g.device];
  const value = gamePointsValue(cfg, g.id);
  const base = 'relative block bg-games-card rounded-kaya p-3.5 shadow-[0_4px_12px_rgba(26,18,64,0.06)]';
  const inner = (
    <>
      {/* reward / state badge — shows the PARENT-set value (default 0). A
          valued game pops in gold; a 0-value game is a muted "Fun" tag. */}
      {!g.built ? (
        <span className="absolute top-2.5 right-2.5 bg-games-coral text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-md">
          Soon
        </span>
      ) : value > 0 ? (
        <span className="absolute top-2.5 right-2.5 bg-games-gold text-games-ink text-[9px] font-extrabold px-1.5 py-0.5 rounded-md">
          +{value}
        </span>
      ) : (
        <span className="absolute top-2.5 right-2.5 bg-games-bg text-games-ink-soft text-[9px] font-extrabold px-1.5 py-0.5 rounded-md">
          Fun
        </span>
      )}
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${TONE_TILE[g.tone]} flex items-center justify-center text-xl mb-2`}>
        {g.icon}
      </div>
      <p className="font-display text-[13px] font-extrabold leading-tight text-games-ink mb-1">{g.name}</p>
      <p className="text-[10px] font-semibold text-games-ink-soft flex items-center gap-1 flex-wrap">
        <span>{metaLine(g)}</span>
        {tag && <span className={`${tag.cls} text-[9px] font-extrabold px-1.5 py-0.5 rounded`}>{tag.label}</span>}
      </p>
    </>
  );
  return g.built ? (
    <Link href={`/games/${g.id}`} className={`${base} active:scale-95 transition-transform`}>{inner}</Link>
  ) : (
    <div className={`${base} opacity-60`}>{inner}</div>
  );
}

function WorldSection({ world, cfg }: { world: GameWorld; cfg: GamesConfig }) {
  const meta = GAME_WORLDS.find((w) => w.id === world)!;
  const games = gamesByWorld(world);
  return (
    <section className="mb-7">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-base lg:text-lg font-extrabold text-games-ink flex items-center gap-2">
          <span>{meta.emoji}</span>
          <span>{meta.label}</span>
        </h2>
        <span className="text-[11px] font-semibold text-games-ink-soft">{meta.countLabel}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {games.map((g) => (
          <GameCard key={g.id} g={g} cfg={cfg} />
        ))}
      </div>
    </section>
  );
}

export default function GamesPage() {
  const { profile } = useAuth();
  const { family } = useFamily();
  const cfg = resolveGamesConfig(family?.gamesConfig);
  const [child, setChild] = useState<Child | null>(null);
  const isKid = profile?.role === 'kid';

  useEffect(() => {
    let cancelled = false;
    const familyId = profile?.familyId;
    const childId = profile?.childId;
    const email = profile?.email?.toLowerCase() ?? '';
    if (!isKid || !familyId) { setChild(null); return; }
    (async () => {
      try {
        const kids = await getChildren(familyId);
        if (cancelled) return;
        const byId = childId ? kids.find((k) => k.id === childId) : undefined;
        const byEmail = !byId && email
          ? kids.find((k) => (k.emailLower || k.email?.toLowerCase() || '') === email)
          : undefined;
        setChild(byId || byEmail || null);
      } catch {
        if (!cancelled) setChild(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isKid, profile?.familyId, profile?.childId, profile?.email]);

  const firstName = child?.name || profile?.displayName?.split(' ')[0] || 'there';
  const pick = getGame(DAILY_PICK_ID);
  const pickValue = pick ? gamePointsValue(cfg, pick.id) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-transparent">
      <div className="mx-auto max-w-md w-full lg:max-w-4xl px-4 lg:px-8 pt-4 lg:pt-8 pb-28">
        <div className="lg:hidden"><BackButton /></div>

        {/* Header — greeting + points (kids) */}
        <div className="flex items-center justify-between mb-5 mt-1">
          <div>
            <p className="text-[13px] font-semibold text-games-ink-soft">Karibu, 👋</p>
            <h1 className="font-display text-2xl lg:text-[32px] font-black tracking-tight text-games-ink">
              {isKid ? firstName : 'Kaya Games'}
            </h1>
          </div>
          {isKid ? (
            <div className="bg-gradient-to-br from-games-gold to-[#FB923C] px-3.5 py-2 rounded-full flex items-center gap-1.5 font-extrabold text-sm text-games-ink shadow-[0_4px_12px_rgba(251,191,36,0.3)]">
              <span>⭐</span>
              <span>{(child?.totalPoints ?? 0).toLocaleString()}</span>
              <span className="text-[10px] font-bold opacity-70">pts</span>
            </div>
          ) : (
            <span className="text-[28px]">🎮</span>
          )}
        </div>

        {!isKid && (
          <div className="mb-4 -mt-2">
            <p className="text-sm text-games-ink-soft max-w-xl leading-relaxed">
              Your family&rsquo;s play hub — 22 games across 4 worlds, no ads, House Points that feed the
              same Kaya economy. This is the kids&rsquo; view.
            </p>
            {profile?.role === 'parent' && (
              <div className="flex flex-wrap gap-2 mt-3">
                <Link
                  href="/games/controls"
                  className="inline-flex items-center gap-1.5 bg-games-ink text-white text-xs font-extrabold px-4 py-2 rounded-full"
                >
                  🛡️ Games controls
                </Link>
                <Link
                  href="/games/approvals"
                  className="inline-flex items-center gap-1.5 bg-games-violet text-white text-xs font-extrabold px-4 py-2 rounded-full"
                >
                  ✅ Approvals
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Leaderboard entry */}
        <Link
          href="/games/board"
          className="inline-flex items-center gap-1.5 mb-5 bg-games-card text-games-violet-deep text-xs font-extrabold px-4 py-2 rounded-full shadow-[0_4px_12px_rgba(26,18,64,0.06)]"
        >
          🏆 Family leaderboard
        </Link>
        <Link
          href="/games/lab"
          className="inline-flex items-center gap-1.5 mb-5 ml-2 bg-games-card text-games-violet-deep text-xs font-extrabold px-4 py-2 rounded-full shadow-[0_4px_12px_rgba(26,18,64,0.06)]"
        >
          🧪 Kaya Lab
        </Link>

        {/* Daily Pick */}
        {pick && (
          <div className="relative overflow-hidden rounded-kaya-lg p-5 mb-7 text-white bg-gradient-to-br from-games-violet to-games-coral">
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-games-gold/30 blur-2xl pointer-events-none" />
            <div className="relative">
              <span className="inline-block bg-white/25 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-2">
                Today&rsquo;s Family Pick
              </span>
              <h3 className="font-display text-xl lg:text-2xl font-extrabold leading-tight mb-1">{pick.name}</h3>
              <p className="text-xs opacity-90 mb-3.5">
                {pick.players ?? '2+'} players · {pick.minutes} min · {pickValue > 0 ? `+${pickValue} pts` : 'just for fun'}
              </p>
              <span className="inline-flex items-center gap-1.5 bg-white text-games-violet-deep px-4 py-2 rounded-full font-extrabold text-[13px]">
                ▶ Start together
              </span>
            </div>
          </div>
        )}

        {/* The four worlds */}
        <WorldSection world="quick" cfg={cfg} />
        <WorldSection world="family" cfg={cfg} />
        <WorldSection world="calm" cfg={cfg} />
        <WorldSection world="realworld" cfg={cfg} />

        <p className="text-center text-[11px] text-games-ink-soft/80 mt-2">
          🎮 More games light up every week · No ads, ever
        </p>
      </div>
    </div>
  );
}
