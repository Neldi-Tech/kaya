'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getFamilyByReferralCode } from '@/lib/firestore';

const REF_STORAGE_KEY = 'kaya.ref';

function ReferralCapture({ onReferrer }: { onReferrer: (name: string | null) => void }) {
  const searchParams = useSearchParams();
  const refCode = searchParams.get('ref');

  useEffect(() => {
    if (!refCode) return;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(REF_STORAGE_KEY, refCode.toUpperCase());
    }
    (async () => {
      const family = await getFamilyByReferralCode(refCode);
      if (family) onReferrer(family.name);
    })();
  }, [refCode, onReferrer]);

  return null;
}

export default function LandingPage() {
  const { user, profile, loading, isGuest, enterGuestMode } = useAuth();
  const router = useRouter();
  const [referrerName, setReferrerName] = useState<string | null>(null);
  const [showReferralBanner, setShowReferralBanner] = useState(true);

  // Logged-in users (not guest) skip the landing page.
  useEffect(() => {
    if (loading || isGuest) return;
    if (user && profile?.familyId) router.replace('/dashboard');
    else if (user && !profile?.familyId) router.replace('/onboarding');
  }, [user, profile, loading, isGuest, router]);

  const handleGuest = () => {
    enterGuestMode();
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen bg-kaya-cream text-kaya-chocolate">
      <Suspense fallback={null}>
        <ReferralCapture onReferrer={setReferrerName} />
      </Suspense>

      {referrerName && showReferralBanner && (
        <div className="bg-gradient-to-r from-kaya-gold-light to-kaya-warm border-b border-kaya-warm-dark">
          <div className="max-w-7xl mx-auto px-5 py-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-kaya-gold flex items-center justify-center text-2xl shrink-0">🎁</div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-kaya-chocolate">
                You were invited by <span className="text-[#7A5C0A]">{referrerName}</span>
              </p>
              <p className="text-[12px] text-kaya-chocolate/70 mt-0.5">
                When you finish setup, both your families unlock a bonus house color.
              </p>
            </div>
            <button
              onClick={() => setShowReferralBanner(false)}
              className="text-[11px] text-kaya-chocolate/60 hover:text-kaya-chocolate font-semibold whitespace-nowrap"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {/* ── Top nav ─────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-kaya-warm-dark/60">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-[10px] bg-kaya-chocolate text-kaya-gold-light flex items-center justify-center font-display font-bold text-base">K</div>
          <span className="font-display font-bold text-lg tracking-tight">Kaya</span>
        </div>
        <button
          onClick={() => router.push('/login')}
          className="text-sm font-semibold border border-kaya-warm-dark px-4 py-2 rounded-kaya-sm hover:bg-white transition-colors"
        >
          Sign in
        </button>
      </header>

      {/* ── Hero ────────────────────────────────────── */}
      <section className="px-5 pt-12 pb-8 text-center">
        <span className="inline-block bg-kaya-gold-light text-[#7A5C0A] text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-5">
          Now in early access
        </span>
        <h1 className="font-display font-extrabold text-[40px] leading-[1.05] tracking-tight mb-3">
          Where families<br/>grow together.
        </h1>
        <p className="text-[15px] text-kaya-sand max-w-[360px] mx-auto leading-relaxed mb-7">
          Daily routines, points and weekly meetings — a calm rhythm that turns parenting chaos into a shared story your kids actually love.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-sm mx-auto">
          <button
            onClick={() => router.push('/login')}
            className="bg-kaya-gold text-white h-[52px] px-6 rounded-kaya font-bold text-sm hover:bg-kaya-gold-dark transition-colors"
          >
            Get started — free
          </button>
          <button
            onClick={handleGuest}
            className="border border-kaya-chocolate text-kaya-chocolate h-[52px] px-6 rounded-kaya font-bold text-sm hover:bg-white transition-colors"
          >
            Try as a guest →
          </button>
        </div>
        <p className="text-xs text-kaya-sand-light mt-3">
          No card. No sign-up. Walk through a sample family in 30 seconds.
        </p>
      </section>

      {/* ── Guest panel ─────────────────────────────── */}
      <section className="px-5 pb-8">
        <div className="bg-kaya-chocolate text-kaya-gold-light rounded-kaya-lg p-5 sm:p-6 max-w-2xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="font-display font-bold text-base text-white mb-1">Just looking?</div>
            <div className="text-sm text-kaya-sand-light leading-relaxed">
              Enter as a guest with a demo family — rate routines, award points, run a meeting. Nothing saves.
            </div>
          </div>
          <button
            onClick={handleGuest}
            className="bg-kaya-gold text-kaya-chocolate font-bold text-sm px-5 py-3 rounded-kaya-sm whitespace-nowrap hover:bg-kaya-gold-light transition-colors"
          >
            Start tour
          </button>
        </div>
      </section>

      {/* ── How it works ───────────────────────────── */}
      <section className="px-5 py-8 max-w-3xl mx-auto">
        <h2 className="font-display font-bold text-xl mb-5">How Kaya works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { n: '1', title: 'Rate the routine', body: 'Morning and evening tasks scored Excellent / Good / Bad in seconds.' },
            { n: '2', title: 'Award the wins', body: 'Bonus points for kindness, courage, hard work — anything worth catching.' },
            { n: '3', title: 'Meet weekly', body: 'A 6-step family meeting flow with gratitude, goals and reward redemption.' },
          ].map((c) => (
            <div key={c.n} className="bg-white border border-kaya-warm-dark/60 rounded-kaya p-5">
              <div className="w-9 h-9 rounded-[10px] bg-kaya-gold-light text-[#7A5C0A] font-bold flex items-center justify-center mb-3">{c.n}</div>
              <div className="font-bold text-[15px] mb-1">{c.title}</div>
              <div className="text-[13px] text-kaya-sand leading-relaxed">{c.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Houses (no children named) ─────────────── */}
      <section className="px-5 py-8 max-w-3xl mx-auto">
        <h2 className="font-display font-bold text-xl mb-2">Children compete in houses</h2>
        <p className="text-sm text-kaya-sand mb-5 max-w-xl">
          Each child belongs to a house. Points stack, streaks climb, and the leaderboard turns chores into a friendly rivalry.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { name: 'Golden House', color: '#D4A017', tag: 'Bold · brave' },
            { name: 'White House',  color: '#7B9DB7', tag: 'Calm · clear' },
            { name: 'Silver House', color: '#9B8EC4', tag: 'Curious · creative' },
          ].map((h) => (
            <div key={h.name} className="bg-white border border-kaya-warm-dark/60 rounded-kaya p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full" style={{ background: h.color }} />
              <div>
                <div className="font-bold text-[14px]">{h.name}</div>
                <div className="text-xs text-kaya-sand">{h.tag}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────── */}
      <footer className="border-t border-kaya-warm-dark/60 mt-8">
        <div className="px-5 py-6 max-w-3xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-kaya-sand">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-[7px] bg-kaya-chocolate text-kaya-gold-light flex items-center justify-center font-display font-bold text-[11px]">K</div>
            <span>Kaya · ourkaya.com</span>
          </div>
          <div className="text-center sm:text-right">
            @ourkaya.app · Made with love, by a family
          </div>
        </div>
      </footer>
    </div>
  );
}
