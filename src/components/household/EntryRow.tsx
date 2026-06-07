'use client';

// Single-row renderer shared by the Contributions list (P2) and the
// Subscriptions list (P3). Generic over the row content so each module
// composes its own labels.

import Link from 'next/link';
import { ReactNode } from 'react';

export interface EntryRowProps {
  href: string;
  emoji: string;
  title: string;
  subtitle?: ReactNode;          // "Faith · Tithe" or "Memberships · Gym"
  rightTop: ReactNode;           // amount string
  rightBottom?: ReactNode;       // date / next-bill / "monthly" hint
  badges?: ReactNode;            // <StatusBadge>...</StatusBadge> instances
  dimmed?: boolean;              // greyed treatment for held / stopped rows
}

export function EntryRow({
  href, emoji, title, subtitle, rightTop, rightBottom, badges, dimmed = false,
}: EntryRowProps) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-kaya bg-white border border-pulse-navy/10 px-4 py-3 hover:border-pulse-gold/60 hover:shadow-sm transition-shadow ${dimmed ? 'opacity-60' : ''}`}
    >
      <div className="text-2xl shrink-0">{emoji}</div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-display font-extrabold text-pulse-navy truncate">{title}</span>
          {badges}
        </div>
        {subtitle != null && (
          <div className="mt-0.5 text-xs font-semibold text-pulse-navy/60 truncate">{subtitle}</div>
        )}
      </div>

      <div className="text-right shrink-0">
        <div className="font-display font-extrabold text-pulse-navy">{rightTop}</div>
        {rightBottom != null && (
          <div className="mt-0.5 text-xs font-semibold text-pulse-navy/55">{rightBottom}</div>
        )}
      </div>
    </Link>
  );
}
