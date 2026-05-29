// Kaya · COPPA + Login — the split-panel auth shell (/login + /signup).
//
// Mirrors the live Kaya master skin: a chocolate brand panel (desktop only)
// + a cream form panel. The brand panel carries the real house-with-K
// logomark in its gold-light reverse colourway, an early-access pill (signup),
// the headline, and the 3-step "how Kaya works" strip. The form panel is a
// slot — <AuthControls> drops in. On mobile the brand panel collapses to a
// compact lockup above the form so the page stays single-column + tappable.

import Link from 'next/link';
import KayaMark from '@/components/brand/KayaMark';

interface AuthShellProps {
  mode: 'login' | 'signup';
  children: React.ReactNode;
}

const BRAND: Record<AuthShellProps['mode'], { pill?: string; heading: React.ReactNode; sub: string }> = {
  signup: {
    pill: 'Now in early access',
    heading: (
      <>
        Where families
        <br />
        grow together.
      </>
    ),
    sub: 'Daily routines, points and weekly meetings — a calm rhythm your kids actually love.',
  },
  login: {
    heading: <>Welcome back.</>,
    sub: 'The team is waiting — points to award, routines to rate, a week to run.',
  },
};

const STEPS = [
  { n: '01', t: 'Rate routines' },
  { n: '02', t: 'Award the wins' },
  { n: '03', t: 'Meet weekly' },
];

export default function AuthShell({ mode, children }: AuthShellProps) {
  const b = BRAND[mode];
  return (
    <div className="min-h-screen flex font-body bg-kaya-cream text-kaya-chocolate">
      {/* ── Brand panel (desktop) ───────────────────────────────── */}
      <div className="hidden lg:flex lg:flex-[0_0_46%] relative overflow-hidden bg-kaya-chocolate text-kaya-gold-light px-9 py-10 flex-col justify-between">
        {/* Warm gold halo bleed (top-right). */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-[150px] -right-[150px] w-[360px] h-[360px] rounded-full"
          style={{ background: 'rgba(212,160,23,0.14)', filter: 'blur(60px)' }}
        />
        <div className="relative">
          {/* Logo lockup → home. Wrapping in <Link> so tapping the
              mark / wordmark on /login + /signup takes the visitor
              back to the landing page instead of doing nothing. */}
          <Link
            href="/"
            aria-label="Go to Kaya home"
            className="inline-flex items-center gap-3 mb-7 hover:opacity-90 transition-opacity"
          >
            <KayaMark variant="reverse" size={38} title="Kaya" />
            <span className="font-display font-bold text-xl text-white">Kaya</span>
          </Link>
          {b.pill && (
            <span className="inline-block bg-[rgba(245,230,184,0.15)] text-kaya-gold-light text-[11px] font-extrabold uppercase tracking-[0.16em] px-[11px] py-[5px] rounded-full">
              {b.pill}
            </span>
          )}
          <h1
            className={`font-display font-extrabold text-white leading-[1.06] tracking-[-0.02em] ${
              mode === 'signup' ? 'text-[38px] mt-[18px] mb-3.5' : 'text-4xl mb-3.5'
            }`}
          >
            {b.heading}
          </h1>
          <p className="text-[13px] text-kaya-sand-light leading-relaxed max-w-[300px]">{b.sub}</p>
        </div>
        <div className="relative grid grid-cols-3 gap-3 max-w-[360px]">
          {STEPS.map((s) => (
            <div key={s.n} className="border-t border-[rgba(245,230,184,0.25)] pt-2.5">
              <div className="text-kaya-gold font-display font-extrabold text-[13px] mb-[3px]">{s.n}</div>
              <div className="text-[11px] text-kaya-sand-light leading-tight">{s.t}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Form panel ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col justify-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-[400px] mx-auto">
          {/* Compact brand lockup — mobile only (brand panel is hidden).
              Tappable so phone visitors can also get back to the
              landing page. */}
          <Link
            href="/"
            aria-label="Go to Kaya home"
            className="flex lg:hidden items-center gap-2.5 mb-8 hover:opacity-90 transition-opacity"
          >
            <KayaMark variant="dark" size={34} title="Kaya" />
            <span className="font-display font-bold text-lg text-kaya-chocolate">Kaya</span>
          </Link>
          {children}
        </div>
      </div>
    </div>
  );
}
