'use client';

import BackButton from '@/components/ui/BackButton';

export default function GamesPage() {
  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-6 lg:mb-8">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-kaya-gold mb-1">Coming soon</p>
        <h1 className="font-display text-2xl lg:text-[34px] font-black lg:font-extrabold tracking-tight">Games</h1>
        <p className="text-sm lg:text-base text-kaya-sand mt-1 lg:mt-2 max-w-xl leading-relaxed">
          A curated games corner — solo, with siblings, or as a family. Plus a Family Game Night section with offline prompts (charades, gratitude jar, story builder).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-white rounded-kaya-lg p-6 relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-kaya-gold/15 blur-2xl pointer-events-none" />
          <div className="relative">
            <div className="text-4xl mb-3">🎮</div>
            <p className="font-display font-bold text-lg mb-2">Curated kid games</p>
            <p className="text-[13px] text-kaya-sand-light leading-relaxed">
              ~30 hand-picked browser games. Categorised Solo · Siblings · Learning · Active.
            </p>
          </div>
        </div>
        <div className="bg-gradient-to-br from-kaya-gold to-kaya-gold-dark text-kaya-chocolate rounded-kaya-lg p-6 relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/20 blur-2xl pointer-events-none" />
          <div className="relative">
            <div className="text-4xl mb-3">👨‍👩‍👧‍👦</div>
            <p className="font-display font-bold text-lg mb-2">Family Game Night</p>
            <p className="text-[13px] text-kaya-chocolate/80 leading-relaxed">
              Offline prompts: charades, Pictionary, story-builder, gratitude jar. No screens needed.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: '🛡️', title: 'Kid-safe', body: 'Only games we vetted personally — no popups, no ads chasing them around.' },
          { icon: '🏷️', title: 'Categorised', body: 'Pick by mood: solo focus, sibling play, family activity, learning.' },
          { icon: '📲', title: 'No accounts', body: 'Click and play. No sign-ups, no installs, no payments.' },
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
