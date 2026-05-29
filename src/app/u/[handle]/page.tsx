'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getFamilyByHandle, getChildren, Family, Child } from '@/lib/firestore';
import { formatFamilyHandle } from '@/lib/handles';
import { topBadge, effectiveCount, formatCharterNumber } from '@/lib/referral';
import { ReferralBadge } from '@/components/referral/ReferralBadge';

export default function PublicFamilyPage() {
  const params = useParams<{ handle: string }>();
  const router = useRouter();
  const handle = (params?.handle || '').toString();

  const [family, setFamily] = useState<Family | null>(null);
  const [kids, setKids] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!handle) return;
    (async () => {
      try {
        const f = await getFamilyByHandle(handle);
        if (!f) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setFamily(f);
        const c = await getChildren(f.id);
        setKids(c);
      } catch {
        setNotFound(true);
      }
      setLoading(false);
    })();
  }, [handle]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-kaya-cream">
        <p className="text-kaya-sand text-sm">Loading…</p>
      </div>
    );
  }

  if (notFound || !family) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-kaya-cream text-center px-6">
        <div className="text-5xl mb-3">🏡</div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight mb-2">No family with that handle</h1>
        <p className="text-sm text-kaya-sand max-w-sm mb-5">
          We couldn&apos;t find <strong>@{handle}</strong>. Maybe a typo, or they haven&apos;t picked a public handle yet.
        </p>
        <button
          onClick={() => router.push('/')}
          className="h-11 px-5 bg-kaya-gold text-white rounded-kaya font-bold text-sm hover:bg-kaya-gold-dark transition-colors"
        >
          Take me home
        </button>
      </div>
    );
  }

  const isFounding = !!family.isFoundingFamily;
  const refTotal = effectiveCount(family.referralCount || 0, family.compoundCredit || 0);
  const topBadgeEarned = topBadge(family.referralCount || 0, family.compoundCredit || 0);

  return (
    <div className="min-h-screen bg-kaya-cream">
      <header className="border-b border-kaya-warm-dark/60">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-5 lg:px-8 py-4">
          <a href="/" className="flex items-center gap-2.5 no-underline text-kaya-chocolate">
            <div className="w-9 h-9 rounded-[10px] bg-kaya-chocolate text-kaya-gold-light flex items-center justify-center font-display font-bold text-base">K</div>
            <span className="font-display font-bold text-lg tracking-tight">Kaya</span>
          </a>
          <button
            onClick={() => router.push('/login')}
            className="text-sm font-semibold border border-kaya-warm-dark px-4 py-2 rounded-kaya-sm hover:bg-white transition-colors"
          >
            Start your family
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 lg:px-8 py-12 lg:py-20">
        {/* Hero */}
        <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-6 lg:p-10 mb-6 flex flex-col sm:flex-row items-center sm:items-start gap-5 lg:gap-7">
          {family.photoUrl ? (
            <img
              src={family.photoUrl}
              alt={family.name}
              className="w-24 h-24 lg:w-32 lg:h-32 rounded-[24px] object-cover border border-kaya-warm-dark shrink-0"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-24 h-24 lg:w-32 lg:h-32 rounded-[24px] bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-kaya-gold-light flex items-center justify-center font-display font-black text-4xl lg:text-5xl shrink-0">
              {(family.name || 'K').replace(/^the\s+/i, '').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <p className="text-kaya-gold font-bold text-base mb-0.5">{formatFamilyHandle(family.handle)}</p>
            <h1 className="font-display font-extrabold text-2xl lg:text-4xl tracking-tight mb-3">{family.name}</h1>
            <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
              {isFounding && (
                <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-kaya-gold/10 text-kaya-gold-dark text-[12px] font-bold">
                  🤝 Charter Family{formatCharterNumber(family.charterNumber) ? ` · ${formatCharterNumber(family.charterNumber)}` : ''}
                </span>
              )}
              {topBadgeEarned && (
                <span className="inline-flex items-center gap-1.5 pl-1.5 pr-3 py-1 rounded-full bg-kaya-chocolate text-kaya-gold-light text-[12px] font-bold">
                  <ReferralBadge id={topBadgeEarned.id} size={20} />
                  {topBadgeEarned.name}{!topBadgeEarned.apex && <> · {refTotal} {refTotal === 1 ? 'referral' : 'referrals'}</>}
                </span>
              )}
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-kaya-warm/60 text-kaya-chocolate text-[12px] font-bold">
                {kids.length} {kids.length === 1 ? 'kid' : 'kids'}
              </span>
            </div>
          </div>
        </div>

        {/* CTA strip */}
        <div className="bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-white rounded-kaya-lg p-6 lg:p-8 text-center mb-6">
          <p className="font-display font-extrabold text-xl lg:text-2xl mb-2">Want a family rhythm like this?</p>
          <p className="text-sm text-kaya-sand-light mb-5 max-w-md mx-auto leading-relaxed">
            Daily routines, points, and a weekly family meeting — turn parenting chaos into a shared story your kids actually love.
          </p>
          <button
            onClick={() => router.push(family.referralCode ? `/?ref=${encodeURIComponent(family.referralCode)}` : '/')}
            className="bg-kaya-gold text-kaya-chocolate font-bold text-sm h-12 px-6 rounded-kaya hover:bg-kaya-gold-light transition-colors"
          >
            Get started — free
          </button>
        </div>

        <p className="text-center text-[12px] text-kaya-sand-light">
          Public profile · {family.name} chose to share their family identity. Private data (kid names, points, schedules) stays private.
        </p>
      </main>

      <footer className="border-t border-kaya-warm-dark/60">
        <div className="max-w-4xl mx-auto px-5 lg:px-8 py-6 text-center text-xs text-kaya-sand">
          Kaya · ourkaya.com · Made with love, by a family.
        </div>
      </footer>
    </div>
  );
}
