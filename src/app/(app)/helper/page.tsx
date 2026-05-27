'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import type { HelperLink } from '@/lib/firestore';
import { getHelperLink, isHelperSessionExpired, clearHelperSession } from '@/lib/helpers';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import KidAvatar from '@/components/ui/KidAvatar';
import PerformanceCard from '@/components/helpers/PerformanceCard';
import TodaysWorkplanCard from '@/components/helpers/TodaysWorkplanCard';
import { ShieldCheck, Lock, Clock } from 'lucide-react';
import { getTodaysCheckIn, logCheckIn } from '@/lib/payCheckIns';
import type { PayCheckIn, PayBasis } from '@/lib/firestore';
import { KID_MODULES } from '@/lib/kidModules';
import { HELPER_MODULE_KEY_LABEL } from '@/lib/helperModules';

const fmt = (n: number) => n.toLocaleString('en-US');

// Label lookup that prefers the helper-vocabulary (composite keys
// included), with a kid-module fallback so legacy grants like
// `home` still render with a sensible label.
const KID_LABEL = Object.fromEntries(KID_MODULES.map((m) => [m.id, { label: m.label, icon: m.icon }]));
function labelFor(key: string): { label: string; icon: string } | null {
  return HELPER_MODULE_KEY_LABEL[key] ?? KID_LABEL[key] ?? null;
}

const PRESET_LABEL: Record<HelperLink['preset'], string> = {
  nanny: 'Nanny',
  tutor: 'Tutor',
  driver: 'Driver',
  gardener: 'Gardener',
  security: 'Security',
  cleaner: 'Cleaner',
  cook: 'Cook',
  handyman: 'Handyman',
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
        <p className="text-kaya-sand text-sm mt-1 lg:mt-2">Your day in one place — performance, work, pay, kids.</p>
      </div>

      {/* Hero · helper performance. (2026-05-19 — Elia's home-card
          revamp: the helper's own score belongs at the top, not buried
          between Workplan + Kids. Kids ratings still appear further
          down. Full-size — drops the `compact` prop the inline version
          had.) */}
      {link && profile && profile.familyId && (
        <div className="mb-5 lg:mb-7">
          <PerformanceCard
            familyId={profile.familyId}
            helperUid={profile.uid}
            days={7}
          />
        </div>
      )}

      {/* "Your access" panel — only when a HelperLink doc exists, so
          legacy helpers (full-family access) don't see a misleading
          summary. Lists the assigned kids, role, expected frequency,
          and groups granted areas by access tier (Add+Edit vs View
          only) so the helper sees exactly what they can and can't do. */}
      {link && (() => {
        // Resolve current per-module access. Prefer moduleAccess
        // (canonical); fall back to legacy `modules` array as view+act.
        const access: Record<string, { view: boolean; act: boolean }> = {};
        if (link.moduleAccess) {
          Object.assign(access, link.moduleAccess);
        } else {
          for (const id of link.modules) access[id] = { view: true, act: true };
        }
        const actEntries = Object.entries(access).filter(([, f]) => f.act);
        const viewOnlyEntries = Object.entries(access).filter(([, f]) => f.view && !f.act);
        return (
          <div className="mb-5 lg:mb-7 bg-white border border-kaya-warm-dark rounded-kaya p-3 lg:p-4">
            <div className="flex items-start gap-3">
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
            {(actEntries.length > 0 || viewOnlyEntries.length > 0) && (
              <div className="mt-3 pt-3 border-t border-kaya-warm-dark/40 space-y-2">
                {actEntries.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1.5">You can add &amp; edit</p>
                    <div className="flex flex-wrap gap-1.5">
                      {actEntries.map(([id]) => {
                        const m = labelFor(id); if (!m) return null;
                        return (
                          <span key={id} className="px-2 py-1 text-[11px] bg-kaya-chocolate text-white rounded-full font-bold">
                            <span className="mr-1">{m.icon}</span>{m.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
                {viewOnlyEntries.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1.5">You can view only</p>
                    <div className="flex flex-wrap gap-1.5">
                      {viewOnlyEntries.map(([id]) => {
                        const m = labelFor(id); if (!m) return null;
                        return (
                          <span key={id} className="px-2 py-1 text-[11px] bg-kaya-cream border border-kaya-warm-dark rounded-full">
                            <span className="mr-1">{m.icon}</span>{m.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Today's workplan — only when a HelperLink doc exists and
          the helper has been given a workplan. Tap-to-check tiles
          grouped by morning / anytime / evening. EoD note auto-saves
          on blur. Icon-first so low-literacy helpers can use it. */}
      {link && profile && profile.familyId && (
        <TodaysWorkplanCard
          familyId={profile.familyId}
          helperUid={profile.uid}
        />
      )}

      {/* Pay check-in (v3 — 2026-05-19). Only renders for helpers
          on hourly or daily payroll basis. Self-log per day; parent
          approves on /pantry/workplan. */}
      {link && profile && profile.familyId &&
        (link.payrollConfig?.basis === 'hourly' || link.payrollConfig?.basis === 'daily') && (
        <CheckInCard
          familyId={profile.familyId}
          helperUid={profile.uid}
          basis={link.payrollConfig.basis}
        />
      )}

      {/* Performance card now renders as the hero card at the top of
          the page — see above. The previous mid-page placement was
          retired 2026-05-19 per Elia's home-card revamp. */}

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

      {/* Quick actions — only shown when the helper can ACT on the
          `home` module (rating is a write). Prefer moduleAccess (canonical);
          fall back to legacy `modules` array. Helpers without home-act
          see a small "no access" hint so they understand why no rating
          buttons appear. Legacy helpers (no link doc) get the buttons by
          default — matches the rule fallback. */}
      {(() => {
        if (!link) return true; // legacy helper without link doc
        if (link.moduleAccess) {
          return link.moduleAccess['kaya:rate']?.act === true
              || link.moduleAccess['kaya']?.act === true
              || link.moduleAccess['home']?.act === true;  // legacy alias
        }
        return link.modules.includes('kaya:rate')
            || link.modules.includes('kaya')
            || link.modules.includes('home');
      })() ? (
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
      ) : (
        <div className="bg-white border border-dashed border-kaya-warm-dark rounded-kaya-lg p-5 flex items-start gap-3">
          <Lock size={18} className="text-kaya-sand flex-shrink-0 mt-0.5" />
          <div className="text-xs lg:text-sm text-kaya-sand leading-relaxed">
            <p className="font-bold text-kaya-chocolate">No rating access today</p>
            <p>You aren&apos;t set up to log routines for this family. Ask the parent to enable <span className="font-bold">Kaya → Rate routines</span> for you in Settings → Helpers.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pay check-in card (v3 — 2026-05-19) ──────────────────────────
// Renders on the helper home when their payrollConfig.basis is
// 'hourly' or 'daily'. One-tap "Log today" for daily, or hours input
// for hourly. Re-tapping updates + clears any prior parent approval
// (so the parent re-reviews the new number).
function CheckInCard({
  familyId, helperUid, basis,
}: { familyId: string; helperUid: string; basis: PayBasis }) {
  const [today, setToday] = useState<PayCheckIn | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hoursDraft, setHoursDraft] = useState<number>(8);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getTodaysCheckIn(familyId, helperUid);
        if (!cancelled) {
          setToday(t);
          if (t?.hours) setHoursDraft(t.hours);
        }
      } catch { /* swallow */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [familyId, helperUid]);

  const log = async (hours: number) => {
    setSaving(true);
    try {
      await logCheckIn(familyId, helperUid, { hours });
      const t = await getTodaysCheckIn(familyId, helperUid);
      setToday(t);
      setEditing(false);
    } finally { setSaving(false); }
  };

  if (!loaded) return null;

  const approved = !!today?.approvedBy;
  const ringClass = approved
    ? 'bg-green-50 border-green-400'
    : today
      ? 'bg-kaya-gold-light/30 border-kaya-gold'
      : 'bg-white border-kaya-warm-dark';

  return (
    <div className={`mb-5 lg:mb-7 border-2 rounded-kaya-lg p-4 ${ringClass}`}>
      <div className="flex items-center gap-3">
        <Clock size={20} className="text-kaya-chocolate flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-kaya-sand">
            Today's pay check-in · {basis === 'hourly' ? 'Hours' : 'Day'}
          </p>
          {today ? (
            <p className="text-[13px] font-bold mt-0.5">
              Logged <strong>{today.hours} {basis === 'hourly' ? 'h' : (today.hours === 1 ? 'day' : 'days')}</strong>
              {approved
                ? <span className="ml-2 text-green-700 font-extrabold">✓ Approved by parent</span>
                : <span className="ml-2 text-kaya-sand italic">waiting for parent's nod</span>}
            </p>
          ) : (
            <p className="text-[13px] text-kaya-sand mt-0.5 italic">
              Not logged yet today.
            </p>
          )}
        </div>
      </div>

      {basis === 'daily' && !editing && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => log(1)}
            className="bg-kaya-chocolate text-white font-bold text-sm rounded-kaya py-2.5 disabled:opacity-50"
          >
            {today ? 'Re-log: full day' : 'Log full day'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => log(0.5)}
            className="bg-white border-2 border-kaya-warm-dark text-kaya-chocolate font-bold text-sm rounded-kaya py-2.5 disabled:opacity-50"
          >
            {today ? 'Re-log: half day' : 'Log half day'}
          </button>
        </div>
      )}

      {basis === 'hourly' && (
        editing || !today ? (
          <div className="mt-3 flex items-center gap-2">
            <label className="text-[11px] text-kaya-sand font-bold">Hours:</label>
            <input
              type="number" min={0} step="0.25"
              value={hoursDraft}
              onChange={(e) => setHoursDraft(parseFloat(e.target.value) || 0)}
              className="w-20 h-9 px-2 bg-white border border-kaya-warm-dark rounded-kaya-sm text-center font-bold focus:outline-none focus:border-kaya-chocolate"
            />
            <button
              type="button"
              disabled={saving || hoursDraft <= 0}
              onClick={() => log(hoursDraft)}
              className="flex-1 bg-kaya-chocolate text-white font-bold text-sm rounded-kaya py-2 disabled:opacity-50"
            >
              {saving ? 'Logging…' : today ? 'Update hours' : 'Log hours'}
            </button>
            {today && (
              <button
                type="button"
                onClick={() => { setEditing(false); setHoursDraft(today.hours); }}
                className="text-[11px] text-kaya-sand font-bold"
              >Cancel</button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-2 text-[11px] font-bold text-kaya-chocolate underline"
          >
            ✏️ Re-log hours
          </button>
        )
      )}
    </div>
  );
}
