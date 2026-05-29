'use client';

// Kaya · COPPA + Login — the re-consent gate (/accept).
//
// Shown to a signed-in ADULT whose last-accepted policy version is older than
// ACTIVE_POLICY_VERSION (a material change). One affirmative tap records an
// `accept_gate` acceptance into the immutable audit and lets them back into
// the app. Notes:
//   • Kids never reach here — the (app) gate excludes role 'kid', and a child
//     never sees legal copy.
//   • Lives OUTSIDE the (app) route group so the app-entry gate can't loop on
//     it (the group layout is what redirects *to* here).
//   • The moment the adult taps, we set a session flag so a best-effort audit
//     hiccup can never trap them in a redirect loop — one tap always proceeds.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import KayaMark from '@/components/brand/KayaMark';
import { recordAcceptance } from '@/lib/coppa/client';
import { ACTIVE_POLICY_VERSION, ACCEPT_SESSION_KEY } from '@/lib/coppa/constants';
import { toDisplayDate } from '@/lib/dates';

export default function AcceptGatePage() {
  const { user, loading, refreshProfile, signOut } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // No session → the clickwrap on /login records acceptance instead.
  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  const agree = async () => {
    if (!user || busy) return;
    setBusy(true);
    // Loop-breaker first: once they've deliberately tapped, they're through for
    // this session regardless of whether the audit write round-trips.
    try { sessionStorage.setItem(ACCEPT_SESSION_KEY, ACTIVE_POLICY_VERSION); } catch { /* private mode */ }
    await recordAcceptance(user, 'accept_gate', '/accept'); // best-effort, never throws
    await refreshProfile(); // pick up the mirrored acceptedPolicyVersion
    router.replace('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10 font-body bg-kaya-cream text-kaya-chocolate">
      <div className="w-full max-w-[440px] rounded-kaya-lg bg-white border border-kaya-warm-dark shadow-[0_24px_60px_-30px_rgba(30,18,11,0.4)] px-7 py-9 sm:px-9">
        <div className="flex items-center gap-2.5 mb-6">
          <KayaMark variant="dark" size={34} title="Kaya" />
          <span className="font-display font-bold text-lg text-kaya-chocolate">Kaya</span>
        </div>

        <h1 className="font-display font-extrabold text-kaya-chocolate text-2xl mb-2">
          We’ve updated our terms
        </h1>
        <p className="text-[14px] leading-relaxed text-kaya-chocolate/80 mb-5">
          We’ve made some changes to keep Kaya clear and safe for your family. Please review and accept the latest version to continue.
        </p>

        <div className="rounded-kaya bg-kaya-gold-light/40 border border-kaya-gold-light px-4 py-3.5 mb-6 text-[13px] leading-relaxed text-kaya-chocolate/80">
          By continuing, you agree to Kaya’s{' '}
          <Link href="/legal/terms" className="text-kaya-gold-dark font-bold underline underline-offset-2">Terms</Link>,{' '}
          <Link href="/legal/privacy" className="text-kaya-gold-dark font-bold underline underline-offset-2">Privacy Policy</Link>{' '}and{' '}
          <Link href="/legal/childrens-privacy" className="text-kaya-gold-dark font-bold underline underline-offset-2">Children’s Privacy Notice</Link>, including your responsibility, as parent or guardian, for any child using a Kaya Code you create.
          <span className="block mt-2 text-kaya-sand">Version {ACTIVE_POLICY_VERSION} · Effective {toDisplayDate(ACTIVE_POLICY_VERSION)}</span>
        </div>

        <button
          onClick={agree}
          disabled={busy}
          className="w-full h-12 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm transition-all enabled:hover:bg-kaya-gold-dark enabled:hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? 'One sec…' : 'I agree and continue'}
        </button>

        <button
          onClick={() => signOut()}
          className="w-full mt-3 text-[13px] font-semibold text-kaya-sand hover:text-kaya-chocolate"
        >
          Not now — log out
        </button>
      </div>
    </div>
  );
}
