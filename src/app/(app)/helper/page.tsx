'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { todayString, type HelperLink } from '@/lib/firestore';
import { getHelperLink, isHelperSessionExpired, clearHelperSession } from '@/lib/helpers';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import KidAvatar from '@/components/ui/KidAvatar';
import { ShieldCheck } from 'lucide-react';

const fmt = (n: number) => n.toLocaleString('en-US');

const PRESET_LABEL: Record<HelperLink['preset'], string> = {
  nanny: 'Nanny',
  tutor: 'Tutor',
  driver: 'Driver',
  grandparent: 'Grandparent',
  custom: 'Custom',
};

const FREQUENCY_LABEL: Record<NonNullable<HelperLink['expectedFrequency']>, string> = {
  morning: 'Mornings',
  evening: 'Evenings',
  both: 'Morning + Evening',
  flexible: 'Flexible',
};

export default function HelperPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { children, family } = useFamily();

  // Session-length enforcement. The family's `helperSessionDays`
  // (default 30) sets how long a helper stays signed in after their
  // last sign-in. We compare against the localStorage stamp written
  // by `signInHelperWithCodes`. Helpers from before the stamp was
  // introduced just keep going (no stamp = no expiry) until their
  // next sign-in writes one.
  useEffect(() => {
    if (!profile || profile.role !== 'helper' || !family) return;
    if (!isHelperSessionExpired(family.helperSessionDays)) return;
    (async () => {
      clearHelperSession();
      try { await signOut(auth); } catch { /* noop */ }
      router.replace('/h/login?expired=1');
    })();
  }, [profile, family, router]);

  // Per-helper scope. If a HelperLink doc exists for this user we
  // filter the kid list down to its `kidIds` and show their assigned
  // role on the dashboard. Helpers without a HelperLink (legacy
  // joiners pre-rollout) see the full family list — matches the
  // firestore.rules `isLegacyHelperWithoutLink` fallback.
  const [link, setLink] = useState<HelperLink | null>(null);
  const [scopeLoaded, setScopeLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profile || profile.role !== 'helper' || !profile.familyId) {
        if (!cancelled) { setScopeLoaded(true); }
        return;
      }
      try {
        const l = await getHelperLink(profile.familyId, profile.uid);
        if (!cancelled) {
          setLink(l);
          setScopeLoaded(true);
        }
      } catch {
        if (!cancelled) setScopeLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [profile]);

  const visibleChildren = link
    ? children.filter((c) => link.kidIds.includes(c.id))
    : children;
  const assignedKidNames = visibleChildren.map((c) => c.name).join(', ');

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const firstName = profile?.displayName?.split(' ')[0] || 'there';

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-5xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="mb-5 lg:mb-7">
        <p className="text-xs text-kaya-sand font-bold uppercase tracking-[0.14em]">{today}</p>
        <h1 className="font-display text-2xl lg:text-[34px] font-black lg:font-extrabold tracking-tight mt-0.5">
          Hello, {firstName} 🤝
        </h1>
        <p className="text-kaya-sand text-sm mt-1 lg:mt-2">Ready to rate the children&apos;s routines.</p>
      </div>

      {/* "Your access" panel — only when a HelperLink doc exists, so
          legacy helpers (full-family access) don't see a misleading
          summary. Builds trust by making the scope visible at a glance.
       */}
      {link && (
        <div className="mb-5 lg:mb-7 bg-white border border-kaya-warm-dark rounded-kaya p-3 lg:p-4 flex items-start gap-3">
          <ShieldCheck size={18} className="text-kaya-chocolate flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 text-xs lg:text-sm">
            <div>
              <span className="text-kaya-sand">Helping with </span>
              <span className="font-bold">{assignedKidNames || 'no kids yet'}</span>
              <span className="text-kaya-sand"> · </span>
              <span className="font-bold">{PRESET_LABEL[link.preset]}</span>
              <span className="text-kaya-sand"> role</span>
            </div>
            <div className="mt-1 text-[11px] text-kaya-sand">
              Expected today: <span className="font-bold text-kaya-chocolate">{FREQUENCY_LABEL[link.expectedFrequency ?? 'flexible']}</span>
            </div>
          </div>
        </div>
      )}

      {/* Children overview */}
      {scopeLoaded && visibleChildren.length === 0 && (
        <div className="bg-white border border-dashed border-kaya-warm-dark rounded-kaya-lg p-6 text-center mb-6">
          <p className="text-sm text-kaya-sand">
            No kids are assigned to you yet. Ask the parent in your family to give you access in Settings → Helpers.
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-4 mb-6 lg:mb-8">
        {visibleChildren.map((child) => (
          <div
            key={child.id}
            className="bg-white border border-kaya-warm-dark rounded-kaya lg:rounded-kaya-lg p-4 lg:p-5 flex items-center gap-3 lg:gap-4"
          >
            <KidAvatar child={child} size="lg" shape="circle" bgOpacity="20" />
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-base lg:text-lg truncate">{child.name}</p>
              <p className="text-[12px] text-kaya-sand truncate">
                {child.houseName} House · <span className="font-bold" style={{ color: child.houseColor }}>{fmt(child.totalPoints || 0)} pts</span>
              </p>
            </div>
            {(child.streak || 0) > 0 && (
              <span className="text-xs lg:text-sm font-bold whitespace-nowrap">🔥 {child.streak}</span>
            )}
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3 lg:gap-4 lg:max-w-2xl">
        <button
          onClick={() => router.push('/rate?period=morning')}
          className="flex flex-col items-center gap-2 lg:gap-3 p-5 lg:p-8 bg-white border border-kaya-warm-dark rounded-kaya lg:rounded-kaya-lg hover:shadow-md hover:-translate-y-0.5 transition-all"
        >
          <span className="text-3xl lg:text-5xl">☀️</span>
          <span className="text-sm lg:text-base font-bold">Morning rating</span>
          <span className="hidden lg:block text-[12px] text-kaya-sand">Rate today&apos;s wake-up routines</span>
        </button>
        <button
          onClick={() => router.push('/rate?period=evening')}
          className="flex flex-col items-center gap-2 lg:gap-3 p-5 lg:p-8 bg-white border border-kaya-warm-dark rounded-kaya lg:rounded-kaya-lg hover:shadow-md hover:-translate-y-0.5 transition-all"
        >
          <span className="text-3xl lg:text-5xl">🌙</span>
          <span className="text-sm lg:text-base font-bold">Evening rating</span>
          <span className="hidden lg:block text-[12px] text-kaya-sand">Rate today&apos;s wind-down routines</span>
        </button>
      </div>
    </div>
  );
}
