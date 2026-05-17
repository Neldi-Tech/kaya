import Link from 'next/link';
import AuthControls from '@/components/auth/AuthControls';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-kaya-cream">
      {/* ── Brand panel ───────────────────────────────────────── */}
      <aside className="md:w-1/2 lg:w-[55%] bg-kaya-chocolate text-kaya-gold-light px-8 md:px-12 lg:px-20 py-10 md:py-16 flex flex-col justify-between relative overflow-hidden">
        {/* Decorative gold halo */}
        <div className="absolute -top-40 -right-40 w-[480px] h-[480px] rounded-full bg-kaya-gold/10 blur-3xl pointer-events-none" />

        <div className="relative">
          <div className="flex items-center gap-3 mb-12 md:mb-20">
            <div className="w-11 h-11 rounded-[12px] bg-kaya-gold text-kaya-chocolate font-display font-black text-xl flex items-center justify-center">K</div>
            <span className="font-display font-bold text-xl tracking-tight text-white">Kaya</span>
          </div>

          <span className="inline-block bg-kaya-gold-light/15 text-kaya-gold-light text-[11px] font-bold uppercase tracking-[0.16em] px-3 py-1.5 rounded-full mb-6">
            Now in early access
          </span>

          <h1 className="font-display font-extrabold text-white text-4xl md:text-5xl lg:text-[56px] leading-[1.05] tracking-tight mb-5 max-w-[520px]">
            Where families<br/>grow together.
          </h1>
          <p className="text-base md:text-lg text-kaya-sand-light leading-relaxed max-w-[440px]">
            Daily routines, points and weekly meetings — a calm rhythm that turns parenting chaos into a shared story your kids actually love.
          </p>
        </div>

        <div className="relative mt-12 md:mt-0">
          <div className="grid grid-cols-3 gap-3 max-w-[440px]">
            {[
              { n: '1', t: 'Rate routines' },
              { n: '2', t: 'Award the wins' },
              { n: '3', t: 'Meet weekly' },
            ].map((s) => (
              <div key={s.n} className="border-t border-kaya-gold-light/25 pt-3">
                <div className="text-kaya-gold font-display font-extrabold text-sm mb-1">0{s.n}</div>
                <div className="text-xs text-kaya-sand-light leading-snug">{s.t}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-kaya-sand-light/60 mt-8">
            @ourkaya.app · Made with love, by a family.
          </p>
        </div>
      </aside>

      {/* ── Auth panel ────────────────────────────────────────── */}
      <main className="md:w-1/2 lg:w-[45%] flex items-center justify-center px-6 py-12 md:py-16">
        <div className="w-full max-w-[380px]">
          <div className="md:hidden text-center mb-8">
            <div className="w-14 h-14 rounded-[14px] bg-kaya-chocolate text-kaya-gold font-display font-black text-2xl flex items-center justify-center mx-auto mb-3">K</div>
          </div>
          <div className="mb-7">
            <h2 className="font-display font-extrabold text-2xl tracking-tight mb-1.5">Welcome to Kaya</h2>
            <p className="text-sm text-kaya-sand">Sign in to start tracking your family&apos;s week.</p>
          </div>
          <AuthControls />

          {/* Helper sign-in entry point. A helper landing on this page
              has no email/password account — they sign in with the 3
              codes their family gave them. Small link, kept out of the
              way so it doesn't compete with the parent/kid auth flow. */}
          <div className="mt-8 pt-5 border-t border-kaya-warm-dark/40 text-center">
            <p className="text-xs text-kaya-sand">
              Helping a family with their kids?{' '}
              <Link href="/h/login" className="font-bold text-kaya-chocolate hover:underline">
                Helper sign-in →
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
