'use client';

import BackButton from '@/components/ui/BackButton';
import { MODULE_GUIDES, openModuleGuide } from '@/lib/moduleGuides';

export default function VideosPage() {
  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5 lg:mb-7">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-kaya-gold mb-1">Guides &amp; Videos</p>
        <h1 className="font-display text-2xl lg:text-[34px] font-black lg:font-extrabold tracking-tight">Guides &amp; Videos</h1>
        <p className="text-sm lg:text-base text-kaya-sand mt-1 lg:mt-2 max-w-xl leading-relaxed">
          Quick walk-throughs of how each part of Kaya works — and soon, a kid-safe video corner.
        </p>
      </div>

      {/* ── Module guides (live) ─────────────────────────────────────────── */}
      <h2 className="font-display text-lg font-extrabold mb-3 flex items-center gap-2">▶ How Kaya works</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        {MODULE_GUIDES.map((g) => (
          g.available ? (
            <button
              key={g.id}
              type="button"
              onClick={() => openModuleGuide(g.id)}
              className="flex items-center gap-3 bg-white border border-kaya-warm-dark/70 rounded-kaya p-3.5 text-left active:scale-[0.99] transition-transform hover:border-kaya-gold"
            >
              <span className="text-2xl shrink-0">{g.emoji}</span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{g.title}</span>
                <span className="block text-[12px] text-kaya-sand leading-snug truncate">{g.blurb}</span>
              </span>
              <span className="ml-auto text-[11px] font-extrabold text-kaya-gold shrink-0">▶ Watch</span>
            </button>
          ) : (
            <div key={g.id} className="flex items-center gap-3 bg-white/60 border border-kaya-warm-dark/50 rounded-kaya p-3.5 opacity-70">
              <span className="text-2xl shrink-0 grayscale">{g.emoji}</span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{g.title}</span>
                <span className="block text-[12px] text-kaya-sand leading-snug truncate">{g.blurb}</span>
              </span>
              <span className="ml-auto text-[10px] font-extrabold uppercase tracking-wide text-kaya-sand shrink-0">Soon</span>
            </div>
          )
        ))}
      </div>

      {/* ── Kid-safe video corner (coming soon) ──────────────────────────── */}
      <h2 className="font-display text-lg font-extrabold mb-3">📺 Video corner <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-kaya-gold align-middle ml-1">Coming soon</span></h2>
      <div className="bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-white rounded-kaya-lg p-6 lg:p-8 mb-6 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-kaya-gold/15 blur-2xl pointer-events-none" />
        <div className="relative">
          <div className="text-4xl lg:text-5xl mb-3">📺</div>
          <p className="font-display font-bold text-lg lg:text-2xl mb-2">Parent-curated, kid-safe</p>
          <p className="text-[13px] lg:text-sm text-kaya-sand-light leading-relaxed max-w-md">
            Paste any YouTube URL in Settings → Videos, and it appears here for your kids. Each kid&apos;s feed respects who in the family added what.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: '👨‍👩‍👧', title: 'You curate', body: 'Only videos parents add ever appear.' },
          { icon: '🎯', title: 'Per kid', body: 'Tag videos for specific kids or the whole family.' },
          { icon: '⏱️', title: 'Watch time-aware', body: 'Optional daily limit you set, kids see the budget.' },
        ].map((c) => (
          <div key={c.title} className="bg-white border border-kaya-warm-dark/70 rounded-kaya p-4">
            <div className="text-2xl mb-2">{c.icon}</div>
            <p className="text-sm font-bold mb-1">{c.title}</p>
            <p className="text-[12px] text-kaya-sand leading-snug">{c.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
