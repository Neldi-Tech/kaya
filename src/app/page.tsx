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

const HOUSES = [
  { name: 'Golden',   color: '#D4A017', tag: 'Bold · brave' },
  { name: 'White',    color: '#7B9DB7', tag: 'Calm · clear' },
  { name: 'Silver',   color: '#9B8EC4', tag: 'Curious · creative' },
  { name: 'Ruby',     color: '#C0392B', tag: 'Warm · loyal' },
  { name: 'Emerald',  color: '#27AE60', tag: 'Patient · steady' },
  { name: 'Sapphire', color: '#2980B9', tag: 'Bright · honest' },
];

export default function LandingPage() {
  const { user, profile, loading, isGuest, enterGuestMode } = useAuth();
  const router = useRouter();
  const [referrerName, setReferrerName] = useState<string | null>(null);
  const [showReferralBanner, setShowReferralBanner] = useState(true);

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
          <div className="max-w-7xl mx-auto px-5 lg:px-8 py-4 flex items-center gap-4">
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
      <header className="border-b border-kaya-warm-dark/60">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-5 lg:px-8 py-4">
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
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────── */}
      <section className="px-5 lg:px-8">
        <div className="max-w-7xl mx-auto pt-12 lg:pt-20 pb-10 lg:pb-24 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-center">
          {/* Copy */}
          <div className="lg:col-span-7 text-center lg:text-left">
            <span className="inline-block bg-kaya-gold-light text-[#7A5C0A] text-[11px] font-bold uppercase tracking-[0.16em] px-3 py-1.5 rounded-full mb-5">
              Now in early access
            </span>
            <h1 className="font-display font-extrabold text-[40px] md:text-5xl lg:text-[72px] leading-[1.02] tracking-tight mb-4 lg:mb-5">
              Where families<br/>grow together.
            </h1>
            <p className="text-[15px] lg:text-lg text-kaya-sand max-w-[420px] lg:max-w-[520px] mx-auto lg:mx-0 leading-relaxed mb-7 lg:mb-9">
              Daily routines, points and weekly meetings — a calm rhythm that turns parenting chaos into a shared story your kids actually love.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start max-w-sm mx-auto lg:max-w-none lg:mx-0">
              <button
                onClick={() => router.push('/login')}
                className="bg-kaya-gold text-white h-[52px] px-7 rounded-kaya font-bold text-sm hover:bg-kaya-gold-dark transition-colors"
              >
                Get started — free
              </button>
              <button
                onClick={handleGuest}
                className="border border-kaya-chocolate text-kaya-chocolate h-[52px] px-7 rounded-kaya font-bold text-sm hover:bg-white transition-colors"
              >
                Try as a guest →
              </button>
            </div>
            <p className="text-xs text-kaya-sand-light mt-3 text-center lg:text-left">
              No card. No sign-up. Walk through a sample family in 30 seconds.
            </p>

            {/* Inline social proof — visible on lg+ only to keep mobile tight */}
            <div className="hidden lg:flex items-center gap-6 mt-10 pt-8 border-t border-kaya-warm-dark/60 text-[12px] text-kaya-sand">
              <div>
                <div className="font-display font-extrabold text-xl text-kaya-chocolate">12</div>
                <div className="leading-tight">Default routines<br/>(English + Swahili)</div>
              </div>
              <div className="w-px h-10 bg-kaya-warm-dark/60" />
              <div>
                <div className="font-display font-extrabold text-xl text-kaya-chocolate">8</div>
                <div className="leading-tight">Milestone badges<br/>kids unlock</div>
              </div>
              <div className="w-px h-10 bg-kaya-warm-dark/60" />
              <div>
                <div className="font-display font-extrabold text-xl text-kaya-chocolate">6</div>
                <div className="leading-tight">Step weekly<br/>meeting flow</div>
              </div>
            </div>
          </div>

          {/* Visual — preview of the dashboard family card */}
          <div className="lg:col-span-5">
            <div className="relative max-w-[420px] mx-auto">
              <div className="absolute -inset-6 bg-kaya-gold/15 blur-3xl rounded-full pointer-events-none" />
              <div className="relative bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light rounded-kaya-lg p-6 text-white shadow-2xl shadow-kaya-chocolate/20 overflow-hidden">
                <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-kaya-gold/20 blur-2xl pointer-events-none" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-kaya-gold text-[11px] font-bold uppercase tracking-[0.14em]">Family score · this week</span>
                    <span className="text-[10px] bg-white/10 text-kaya-gold-light px-2 py-1 rounded-full font-bold">PREVIEW</span>
                  </div>
                  <p className="font-display font-black text-6xl mb-1">1,259</p>
                  <p className="text-[12px] text-kaya-sand-light mb-6">🦁 Amani leads · +95 pts</p>

                  <div className="space-y-3 pt-4 border-t border-white/10">
                    {[
                      { emoji: '🦁', name: 'Amani',  pts: 482, w: 38, color: '#D4A017', streak: 5 },
                      { emoji: '🦋', name: 'Zuri',   pts: 421, w: 33, color: '#7B9DB7', streak: 3 },
                      { emoji: '🐉', name: 'Kito',   pts: 356, w: 28, color: '#9B8EC4', streak: 2 },
                    ].map((k) => (
                      <div key={k.name} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm" style={{ backgroundColor: `${k.color}30` }}>{k.emoji}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold">{k.name}</span>
                            <span className="text-xs text-kaya-gold font-bold">{k.pts}</span>
                          </div>
                          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${k.w}%`, backgroundColor: k.color }} />
                          </div>
                        </div>
                        <span className="text-xs">🔥{k.streak}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 pt-4 border-t border-white/10 grid grid-cols-3 gap-2">
                    {[
                      { i: '☀️', l: 'Morning' },
                      { i: '🎖️', l: 'Award' },
                      { i: '👨‍👩‍👧‍👦', l: 'Meet' },
                    ].map((q) => (
                      <div key={q.l} className="text-center bg-white/5 rounded-lg py-2 text-[10px] text-kaya-sand-light font-semibold uppercase tracking-wider">
                        <div className="text-base mb-0.5">{q.i}</div>{q.l}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Guest panel (mobile-prominent, hidden on lg since the hero CTAs cover it) ─ */}
      <section className="px-5 lg:px-8 pb-8 lg:hidden">
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
      <section className="px-5 lg:px-8 py-10 lg:py-20 border-t border-kaya-warm-dark/60">
        <div className="max-w-7xl mx-auto">
          <div className="text-center lg:text-left lg:max-w-xl mb-8 lg:mb-12">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-kaya-gold mb-2">The rhythm</p>
            <h2 className="font-display font-extrabold text-[28px] lg:text-[44px] leading-tight tracking-tight mb-3">How Kaya works</h2>
            <p className="text-sm lg:text-base text-kaya-sand leading-relaxed">
              Three repeatable actions. Daily, weekly, and one quick recognition in between.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
            {[
              { n: '1', emoji: '📋', title: 'Rate the routine',    body: 'Morning and evening tasks scored Excellent / Good / Bad in seconds.', accent: '#D4A017' },
              { n: '2', emoji: '🎖️', title: 'Award the wins',     body: 'Bonus points for kindness, courage, hard work — anything worth catching.', accent: '#27AE60' },
              { n: '3', emoji: '👨‍👩‍👧‍👦', title: 'Meet weekly',     body: 'A 6-step family meeting flow with gratitude, goals and reward redemption.', accent: '#7B9DB7' },
            ].map((c) => (
              <div key={c.n} className="bg-white border border-kaya-warm-dark/60 rounded-kaya-lg p-6 lg:p-7 hover:border-kaya-chocolate transition-colors">
                <div className="flex items-baseline gap-3 mb-4">
                  <div className="w-10 h-10 rounded-[12px] bg-kaya-gold-light text-[#7A5C0A] font-display font-extrabold text-lg flex items-center justify-center">{c.n}</div>
                  <span className="text-2xl">{c.emoji}</span>
                </div>
                <div className="font-display font-bold text-lg lg:text-xl mb-2">{c.title}</div>
                <div className="text-[13px] lg:text-sm text-kaya-sand leading-relaxed">{c.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Houses ──────────────────────────────────── */}
      <section className="px-5 lg:px-8 py-10 lg:py-20 border-t border-kaya-warm-dark/60 bg-white/40">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-kaya-gold mb-2">The competition</p>
            <h2 className="font-display font-extrabold text-[28px] lg:text-[44px] leading-tight tracking-tight mb-3">Children compete in houses</h2>
            <p className="text-sm lg:text-base text-kaya-sand leading-relaxed mb-5">
              Each child belongs to a house. Points stack, streaks climb, and the leaderboard turns chores into a friendly rivalry — without the parent having to play referee.
            </p>
            <p className="text-[12px] lg:text-[13px] text-kaya-sand-light leading-relaxed">
              Three houses ship by default. Three more unlock when you refer your first family. All twelve when you reach the Tribe tier.
            </p>
          </div>
          <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {HOUSES.map((h, i) => (
              <div key={h.name} className={`bg-white border border-kaya-warm-dark/60 rounded-kaya p-4 flex items-center gap-3 ${i >= 3 ? 'opacity-70' : ''}`}>
                <div className="w-10 h-10 rounded-full shrink-0" style={{ background: h.color }} />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-[13px] lg:text-[14px] truncate">{h.name} House</div>
                  <div className="text-[11px] text-kaya-sand truncate">{h.tag}</div>
                </div>
                {i >= 3 && (
                  <span className="text-[9px] text-kaya-sand-light font-bold uppercase tracking-wider">Locked</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ─────────────────────────────── */}
      <section className="px-5 lg:px-8 py-12 lg:py-20 border-t border-kaya-warm-dark/60">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-display font-extrabold text-[28px] lg:text-[40px] leading-tight tracking-tight mb-3">Ready to try a calmer week?</h2>
          <p className="text-sm lg:text-base text-kaya-sand max-w-xl mx-auto mb-7 leading-relaxed">
            Sign up free or walk through a guest tour first — no card needed.
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
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────── */}
      <footer className="border-t border-kaya-warm-dark/60">
        <div className="max-w-7xl mx-auto px-5 lg:px-8 py-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-kaya-sand">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-[7px] bg-kaya-chocolate text-kaya-gold-light flex items-center justify-center font-display font-bold text-[11px]">K</div>
            <span>Kaya · ourkaya.com</span>
          </div>
          <div className="text-center sm:text-right">
            @ourkaya.app · Made with love, by a family.
          </div>
        </div>
      </footer>
    </div>
  );
}
