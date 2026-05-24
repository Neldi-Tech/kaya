import Link from 'next/link';
import AuthControls from '@/components/auth/AuthControls';
import KayaIcon from '@/components/marketing/KayaIcon';

// /login — visual alignment to the real Kaya brand (honey/navy/cream,
// Nunito) per Kaya_Login-Page_Mockup_v2. Single-column layout: top bar →
// centered auth card → footer. Auth logic is untouched: <AuthControls />
// still owns Google / Email / waitlist / reset; this file only restyles the
// shell. Helper sign-in + trust strip kept.
export default function LoginPage() {
  return (
    <div className="font-nunito relative min-h-screen flex flex-col bg-brand-cream text-brand-ink">
      {/* Subtle honey dot texture for a premium feel. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: 'radial-gradient(rgba(243,156,47,0.05) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-5 sm:px-8 py-5">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <KayaIcon size={32} />
          <span className="font-nunito font-bold text-lg text-brand-navy tracking-tight">
            Kaya
          </span>
        </Link>
        <a href="#" className="text-[13px] font-semibold text-[#5C6975] hover:text-brand-navy no-underline">
          Need help?
        </a>
      </header>

      {/* ── Auth card ───────────────────────────────────────────── */}
      <main className="relative z-[1] flex-1 flex items-center justify-center px-6 pb-14 pt-2">
        <div className="w-full max-w-[440px]">
          <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-brand-honey mb-3">
            Sign In
          </div>
          <h1 className="font-nunito font-bold text-brand-navy text-[28px] sm:text-4xl tracking-tight leading-[1.15] mb-2.5">
            Welcome to Kaya.
          </h1>
          <p className="text-[#5C6975] text-base mb-9 leading-relaxed">
            Sign in to start tracking your family&apos;s week.
          </p>

          <AuthControls />

          {/* Helper sign-in entry point. A helper has no email/password
              account — they sign in with the 3 codes their family gave them.
              Kept distinct from the parent/kid flow. */}
          <div className="text-center text-[13px] text-[#5C6975] pt-6 mt-8 border-t border-brand-navy/10">
            Helping a family with their kids?{' '}
            <Link href="/h/login" className="font-bold text-brand-navy hover:text-brand-honey no-underline">
              Helper sign-in →
            </Link>
          </div>

          {/* Trust strip */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 justify-center mt-5 text-[11px] uppercase tracking-[0.08em] font-semibold text-[#5C6975]">
            <span className="inline-flex items-center gap-1">🔒 Private</span>
            <span className="inline-flex items-center gap-1">👨‍👩‍👧 No ads</span>
            <span className="inline-flex items-center gap-1">🌍 Built for families</span>
          </div>
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="relative z-10 flex flex-col sm:flex-row justify-between items-center gap-3 px-5 sm:px-8 py-6 text-[12px] text-[#5C6975]">
        <div className="flex gap-4">
          <a href="#" className="hover:text-brand-navy no-underline">Privacy</a>
          <a href="#" className="hover:text-brand-navy no-underline">Terms</a>
          <a href="#" className="hover:text-brand-navy no-underline">Help</a>
        </div>
        <div>© 2026 Kaya · Built on love, for families everywhere.</div>
      </footer>
    </div>
  );
}
