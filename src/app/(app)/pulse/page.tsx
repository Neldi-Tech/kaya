'use client';

// /pulse — Kaya Pulse section hub. A light landing while the slice fills
// in: Task Setup is live; Today / Dashboard / Wealth arrive next.

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

const TILES: { href: string; emoji: string; title: string; desc: string; live: boolean }[] = [
  { href: '/pulse/admin', emoji: '⚙️', title: 'Trackables & tasks', desc: 'Enable meters, schedule reading tasks', live: true },
  { href: '/pulse', emoji: '📊', title: 'Dashboard', desc: 'Monthly spend by bucket', live: false },
  { href: '/pulse', emoji: '✅', title: 'Today', desc: "Each person's reading tasks", live: false },
  { href: '/pulse', emoji: '💎', title: 'Wealth', desc: 'Savings → pending deposit', live: false },
];

export default function PulseHubPage() {
  const { profile } = useAuth();
  const isParent = profile?.role === 'parent';

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="text-[10px] font-nunito font-black uppercase tracking-[2px] text-pulse-gold-dk">Kaya OS · Finance intelligence</div>
      <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight text-pulse-navy">Kaya Pulse</h1>
      <p className="text-hive-muted text-sm mt-1 mb-5">
        Turn household consumption into priced data — and drive the savings into Kaya Wealth.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {TILES.map((t) =>
          t.live && isParent ? (
            <Link key={t.title} href={t.href} className="bg-white border border-pulse-gold rounded-2xl p-4 block">
              <div className="text-2xl mb-1">{t.emoji}</div>
              <div className="font-nunito font-black text-pulse-navy text-sm">{t.title}</div>
              <div className="text-[11px] text-hive-muted mt-0.5 leading-snug">{t.desc}</div>
            </Link>
          ) : (
            <div key={t.title} className="bg-white/60 border border-pulse-gold/30 rounded-2xl p-4 opacity-70">
              <div className="text-2xl mb-1">{t.emoji}</div>
              <div className="font-nunito font-black text-pulse-navy text-sm flex items-center gap-1">
                {t.title}
                <span className="text-[8px] bg-pulse-gold/20 text-pulse-gold-dk font-black px-1.5 py-0.5 rounded uppercase tracking-wide">Soon</span>
              </div>
              <div className="text-[11px] text-hive-muted mt-0.5 leading-snug">{t.desc}</div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
