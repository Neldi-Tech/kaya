'use client';

// Kaya Sparks · Treasures 2.0 — 🗄 Cupboard shared chrome.
//
// Every Cupboard screen (home, shelves, an item, settings) shares the
// same frame as the Treasures parent roll-up — back pill, a gradient
// hero, a phone-width column — plus the one thing the Cupboard adds to
// the Treasures identity: a warm-wood accent for FAMILY things, next to
// jade for a kid's own.

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  kindOf, gameMetaLine, bookMetaLine, type CupboardItem,
} from '@/lib/sparks/cupboard';
import { STATUS_CHIP, STATUS_LABEL } from '@/lib/sparks/treasures';

export const WOOD = '#8B5E34';
export const WOOD_DK = '#6E4624';
export const WOOD_BG = '#F6ECDF';
export const WOOD_BD = '#E4CDB2';
export const JADE = '#0E6B5E';
export const JADE_BG = '#E2F3EE';

export const HERO_BG = {
  wood: 'linear-gradient(135deg,#6E4624 0%,#8B5E34 100%)',
  jade: 'linear-gradient(135deg,#0E6B5E 0%,#3FA38F 100%)',
  navy: 'linear-gradient(135deg,#1F2A44 0%,#5B6B8C 100%)',
} as const;

/** The Cupboard frame. Phone-first (the approved design), and on a
 *  laptop it opens up: a wide banner hero, the same column widths as the
 *  Sparks hub, and — when a page passes `aside` — a two-column layout
 *  with a sticky right rail. On phones the aside simply follows the main
 *  column, so the mobile order is exactly the design's. */
export function CupboardFrame({
  back, hero, children, aside, actions,
}: {
  back: { href: string; label: string };
  hero: { tone: keyof typeof HERO_BG; eyebrow: string; title: string; sub: ReactNode };
  children: ReactNode;
  /** Desktop right rail (lg+). Renders after the main column on phones. */
  aside?: ReactNode;
  /** Buttons that sit inside the hero on desktop (right side). */
  actions?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#FFFBF5] pb-24">
      <div className="mx-auto max-w-md sm:max-w-2xl lg:max-w-5xl xl:max-w-6xl lg:px-6">
        <div className="px-4 pt-4 lg:pt-6">
          <Link
            href={back.href}
            className="inline-flex items-center gap-1.5 pl-2.5 pr-3.5 py-1.5 rounded-full bg-white border border-[#ECE4D3] text-[#0F1F44] font-display font-extrabold text-[12px] no-underline hover:border-[#8B5E34] transition-colors"
          >
            <span className="text-[13px] leading-none opacity-60" aria-hidden>‹</span>
            <span>{back.label}</span>
          </Link>
        </div>
        <div
          className="mx-4 mt-3 rounded-[18px] lg:rounded-[24px] p-4 lg:px-8 lg:py-7 text-white lg:flex lg:items-end lg:justify-between lg:gap-6 relative overflow-hidden"
          style={{ background: HERO_BG[hero.tone] }}
        >
          <div className="relative min-w-0">
            <div className="text-[10.5px] lg:text-[12px] font-extrabold opacity-85 tracking-[.4px]">{hero.eyebrow}</div>
            <div className="font-display text-[19px] lg:text-[30px] font-extrabold mt-0.5 leading-tight">{hero.title}</div>
            <div className="text-[11px] lg:text-[13.5px] opacity-90 mt-1 leading-snug">{hero.sub}</div>
          </div>
          {actions && <div className="hidden lg:flex flex-wrap gap-2 shrink-0 relative">{actions}</div>}
          <span aria-hidden className="hidden lg:block absolute -right-8 -bottom-10 text-[150px] leading-none opacity-[.08] select-none">🗄</span>
        </div>
        <div className={`px-4 mt-3 lg:mt-5 ${aside ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6 lg:items-start' : ''}`}>
          <div className="min-w-0">{children}</div>
          {aside && <div className="min-w-0 lg:sticky lg:top-4">{aside}</div>}
        </div>
      </div>
    </div>
  );
}

/** 🗄 family · 💎 Ayan's — who a shelf item belongs to. */
export function OwnerChip({ item, small }: { item: Pick<CupboardItem, 'ownerScope' | 'kidId' | 'ownerName'>; small?: boolean }) {
  const family = item.ownerScope === 'family' || item.kidId === 'family';
  const cls = `inline-block font-extrabold rounded-full ${small ? 'text-[9.5px] px-2 py-0.5' : 'text-[10px] px-2 py-1'}`;
  return family
    ? <span className={cls} style={{ background: WOOD_BG, color: WOOD_DK }}>🗄 family</span>
    : <span className={cls} style={{ background: JADE_BG, color: JADE }}>💎 {item.ownerName || 'a kid'}&rsquo;s</span>;
}

export function Pill({ children, bg, fg, href, onClick, disabled }: {
  children: ReactNode; bg: string; fg: string; href?: string; onClick?: () => void; disabled?: boolean;
}) {
  const cls = 'inline-flex items-center px-3.5 py-2 rounded-full font-extrabold text-[12px] no-underline disabled:opacity-50';
  if (href) return <Link href={href} className={cls} style={{ background: bg, color: fg }}>{children}</Link>;
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls} style={{ background: bg, color: fg }}>
      {children}
    </button>
  );
}

export function Card({ children, tone = 'plain', className = '' }: {
  children: ReactNode; tone?: 'plain' | 'wood' | 'warn' | 'bad' | 'good' | 'sky'; className?: string;
}) {
  const tones: Record<string, string> = {
    plain: 'border-[#ECE4D3] bg-white',
    wood: 'border-[#E4CDB2] bg-[#F6ECDF]',
    warn: 'border-[#F3D3A6] bg-[#FFF9EF]',
    bad: 'border-[#F0C9CC] bg-[#FEF6F6]',
    good: 'border-[#BFE3D8] bg-[#F1FAF7]',
    sky: 'border-[#CCD6EA] bg-[#EEF2FA]',
  };
  return <div className={`rounded-[14px] border p-3 mb-2.5 ${tones[tone]} ${className}`}>{children}</div>;
}

/** The shelf tile — cover (lookup cover › family photo › emoji), name,
 *  meta line, owner chip, where it lives, and a status chip only when
 *  something is off. */
export function ShelfCard({ item }: { item: CupboardItem }) {
  const kind = kindOf(item);
  const cover = kind === 'book' ? item.book?.coverUrl : undefined;
  const img = cover || item.thumbUrl;
  const meta = kind === 'book' ? bookMetaLine(item.book) : gameMetaLine(item.game);
  const chip = STATUS_CHIP[item.status];
  const unusual = item.status !== 'kept';
  return (
    <Link
      href={`/sparks/treasures/cupboard/${item.id}`}
      className="block rounded-[13px] border border-[#ECE4D3] bg-white overflow-hidden no-underline hover:border-[#8B5E34] transition-colors"
    >
      <div className={`h-[86px] grid place-items-center text-[30px] bg-[#FBF4E4] ${item.status === 'lost' ? 'grayscale opacity-50' : ''}`}>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="w-full h-full object-cover" />
        ) : <span aria-hidden>{item.emoji}</span>}
      </div>
      <div className="px-2 py-1.5">
        <div className="font-display font-extrabold text-[11.5px] leading-tight text-[#0F1F44] line-clamp-2">
          {item.nameConfirmed === false ? '⚠ ' : ''}{item.name}
        </div>
        <div className="text-[9.5px] font-bold text-[#5B6B8C] mt-0.5 line-clamp-1">{meta || (item.whereKept ? `📍 ${item.whereKept}` : '—')}</div>
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          <OwnerChip item={item} small />
          {unusual && (
            <span className="inline-block text-[9.5px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: chip.bg, color: chip.fg }}>
              {chip.emoji} {STATUS_LABEL[item.status]}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block mb-2.5">
      <span className="block text-[10.5px] font-extrabold tracking-[.5px] uppercase text-[#8A8471] mb-1">{label}</span>
      {children}
    </label>
  );
}

export const inputCls = 'w-full rounded-[10px] border border-[#E8E0CF] bg-white px-3 py-2 text-[13px] text-[#0F1F44] outline-none focus:border-[#8B5E34]';

export function ChoiceChips<T extends string>({ value, options, onChange, tone = 'wood' }: {
  value: T | undefined; options: Array<{ id: T; label: string }>; onChange: (v: T) => void; tone?: 'wood' | 'jade';
}) {
  const on = tone === 'wood' ? { background: WOOD, color: '#fff', borderColor: WOOD } : { background: JADE, color: '#fff', borderColor: JADE };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id} type="button" onClick={() => onChange(o.id)}
          className="text-[11px] font-extrabold px-2.5 py-1.5 rounded-full border-[1.5px] border-[#E8E0CF] bg-white text-[#0F1F44]"
          style={value === o.id ? on : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
