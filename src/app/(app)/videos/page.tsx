'use client';

import BackButton from '@/components/ui/BackButton';

export default function VideosPage() {
  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-6 lg:mb-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-kaya-gold mb-1">Coming soon</p>
        <h1 className="font-display text-2xl lg:text-[34px] font-black lg:font-extrabold tracking-tight">Videos</h1>
        <p className="text-sm lg:text-base text-kaya-sand mt-1 lg:mt-2 max-w-xl leading-relaxed">
          A safe video corner for the kids. Parents will curate a watch list — the kids see only what you&apos;ve added. Embedded in-app, no leaving Kaya.
        </p>
      </div>

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
