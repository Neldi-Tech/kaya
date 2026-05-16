'use client';

// ComingSoonHero · shared teaser layout for the four unshipped modules
// (Kaya Business, Wealth, Wellness, Chef). Each module's page passes in
// its own emoji, title, tagline, descriptive paragraphs, and a small
// bullet list of "what's coming." Below the bullets is a single
// optional "Notify me" affordance — wired today as a mailto so we
// don't need a waitlist endpoint to ship the teaser.

import Link from 'next/link';
import BackButton from './BackButton';

export type ComingSoonBullet = { emoji: string; title: string; desc: string };

type Props = {
  /** Big emoji that anchors the hero card. */
  emoji: string;
  /** Module display name — "Kaya Business", "Kaya Wealth", etc. */
  title: string;
  /** One-line promise. Shown directly under the title. */
  tagline: string;
  /** Two or three short paragraphs of plain-English explanation. */
  paragraphs: string[];
  /** "What's coming" list — 3–5 punchy items. */
  bullets: ComingSoonBullet[];
  /** Optional mailto subject for the "Notify me" CTA. */
  notifySubject?: string;
};

export default function ComingSoonHero({
  emoji, title, tagline, paragraphs, bullets, notifySubject,
}: Props) {
  const mailto = notifySubject
    ? `mailto:hello@ourkaya.com?subject=${encodeURIComponent(notifySubject)}`
    : null;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-24">
      <div className="lg:hidden"><BackButton /></div>

      {/* Hero card */}
      <div className="bg-gradient-to-br from-kaya-gold-light to-white border border-kaya-gold/40 rounded-kaya-lg p-7 lg:p-10 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] px-2 py-1 rounded-full bg-kaya-chocolate text-kaya-gold-light">
            Coming soon
          </span>
        </div>
        <div className="text-5xl lg:text-6xl mb-3" aria-hidden="true">{emoji}</div>
        <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tight mb-2">{title}</h1>
        <p className="text-base lg:text-lg text-kaya-chocolate-light font-semibold">{tagline}</p>
      </div>

      {/* Explanation */}
      <div className="space-y-3 text-[15px] leading-relaxed text-kaya-chocolate mb-7">
        {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>

      {/* What's coming */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-5 lg:p-6 mb-7">
        <h2 className="font-display text-sm font-black uppercase tracking-[0.14em] text-kaya-sand mb-4">
          What's coming
        </h2>
        <ul className="space-y-3">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-kaya-sm bg-kaya-warm flex items-center justify-center text-lg shrink-0">
                {b.emoji}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-display font-black text-[14px] leading-tight">{b.title}</div>
                <div className="text-[13px] text-kaya-sand mt-0.5 leading-snug">{b.desc}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* CTAs */}
      <div className="flex flex-col lg:flex-row gap-3">
        {mailto && (
          <a
            href={mailto}
            className="flex-1 h-12 lg:h-14 rounded-kaya bg-kaya-chocolate text-kaya-gold-light font-display font-extrabold text-sm flex items-center justify-center hover:bg-kaya-chocolate-light transition-colors"
          >
            🔔 Notify me when it ships
          </a>
        )}
        <Link
          href="/dashboard"
          className="flex-1 h-12 lg:h-14 rounded-kaya bg-white border-2 border-kaya-warm-dark text-kaya-chocolate font-display font-extrabold text-sm flex items-center justify-center hover:bg-kaya-warm transition-colors"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
