'use client';

// Kaya · 🎊 Arrival Celebration hero (2026-07-26, Elia-approved design §3).
//
// When a new member joins the family (child.arrivedAt within the family's
// celebrationDays — default 14), everyone's Home carries this animated
// card: gold shimmer sweep, gently floating stars & hearts, softly pulsing
// avatar, and a day counter. Tap → the kid's profile. CSS-only animation,
// battery-friendly, honours prefers-reduced-motion. Renders nothing when
// no celebration is active — zero cost on ordinary days.

import Link from 'next/link';
import { useMemo } from 'react';
import { useFamily } from '@/contexts/FamilyContext';
import { toDisplayDate } from '@/lib/dates';
import { isLittleStar } from '@/lib/participation';

const FLOATERS = ['✨', '💛', '⭐', '✨', '💛', '⭐'];

function daysSince(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  return d < 0 ? null : d;
}

export default function ArrivalHero() {
  const { family, children } = useFamily();
  const celebrationDays = Math.max(0, Math.min(60, Number((family as { celebrationDays?: number } | null)?.celebrationDays ?? 14)));

  const star = useMemo(() => {
    if (!celebrationDays) return null;
    const candidates = children
      .map((c) => ({ c, arrived: (c as { arrivedAt?: string }).arrivedAt || '' }))
      .filter((x) => x.arrived)
      .map((x) => ({ ...x, day: daysSince(x.arrived) }))
      .filter((x): x is typeof x & { day: number } => x.day !== null && x.day < celebrationDays)
      .sort((a, b) => b.arrived.localeCompare(a.arrived));
    return candidates[0] || null;
  }, [children, celebrationDays]);

  if (!star) return null;
  const { c, day } = star;

  return (
    <Link href="/profiles" className="block no-underline mb-4">
      <div className="relative overflow-hidden rounded-kaya-lg border-[1.5px] border-kaya-gold p-4 bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-white arrival-hero">
        <style>{`
          .arrival-hero::before{content:'';position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(245,230,184,.16) 48%,transparent 62%);animation:arr-shimmer 3.2s ease-in-out infinite}
          @keyframes arr-shimmer{0%{transform:translateX(-70%)}60%,100%{transform:translateX(70%)}}
          .arr-float{position:absolute;bottom:-14px;font-size:12px;opacity:0;animation:arr-up 4.5s linear infinite;pointer-events:none}
          @keyframes arr-up{0%{transform:translateY(0) rotate(0);opacity:0}12%{opacity:.85}85%{opacity:.4}100%{transform:translateY(-110px) rotate(35deg);opacity:0}}
          .arr-face{animation:arr-pulse 2.4s ease-in-out infinite}
          @keyframes arr-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
          @media (prefers-reduced-motion: reduce){.arrival-hero::before,.arr-float,.arr-face{animation:none}}
        `}</style>
        {FLOATERS.map((f, i) => (
          <span key={i} className="arr-float" style={{ left: `${8 + i * 15}%`, animationDelay: `${(i * 0.7) % 2.1}s` }}>{f}</span>
        ))}
        <div className="relative flex items-center gap-3.5">
          <div className="arr-face w-12 h-12 rounded-full grid place-items-center text-2xl shrink-0" style={{ background: '#F5E6B8' }}>
            {c.avatarEmoji || '👶'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-kaya-gold-light opacity-90">
              🎊 A new star has joined the family!
            </p>
            <p className="font-display font-black text-lg leading-tight mt-0.5">Welcome, {c.name}</p>
            <p className="text-[11.5px] opacity-75 mt-0.5">
              {c.birthday ? `Born ${toDisplayDate(c.birthday)} · ` : ''}{c.houseName}
              {isLittleStar(c, family) ? ' · 🌟 Little Star' : ''}
            </p>
          </div>
          <span className="shrink-0 font-black text-lg text-kaya-gold-light" aria-hidden>→</span>
        </div>
        <p className="relative text-[10px] font-bold text-kaya-gold-light opacity-80 mt-2.5">
          Day {day + 1} of {celebrationDays} · celebrating ✨
        </p>
      </div>
    </Link>
  );
}
