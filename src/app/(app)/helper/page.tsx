'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { todayString, type HelperLink, type WorkplanItem, type WorkplanCompletion, type WorkplanPeriod } from '@/lib/firestore';
import { getHelperLink, isHelperSessionExpired, clearHelperSession } from '@/lib/helpers';
import {
  listWorkplanItems, itemsScheduledOn, groupItemsByPeriod, partitionByKind,
  getCompletion, toggleItemCompletion, setEodNote, dailyCompletionPct,
} from '@/lib/workplan';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import KidAvatar from '@/components/ui/KidAvatar';
import PerformanceCard from '@/components/helpers/PerformanceCard';
import { ShieldCheck, Lock, Check, ClipboardList } from 'lucide-react';
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

      {/* The helper's own performance — face emoji + today % + 7-day
          avg. Compact so it sits naturally between workplan + kids. */}
      {link && profile && profile.familyId && (
        <div className="mb-5 lg:mb-7">
          <PerformanceCard
            familyId={profile.familyId}
            helperUid={profile.uid}
            compact
            days={7}
          />
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

// ── Today's workplan card ─────────────────────────
// Icon-first checklist for the helper's day. Loads items + today's
// completion in parallel; tapping a tile toggles its presence in
// the day's completion doc. EoD note auto-saves on blur. Designed
// to work for low-literacy helpers — big emoji tiles, single tap
// to mark done, no nested menus.
function TodaysWorkplanCard({ familyId, helperUid }: {
  familyId: string;
  helperUid: string;
}) {
  const [items, setItems] = useState<WorkplanItem[] | null>(null);
  const [completion, setCompletion] = useState<WorkplanCompletion | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [its, comp] = await Promise.all([
        listWorkplanItems(familyId, helperUid),
        getCompletion(familyId, helperUid),
      ]);
      if (cancelled) return;
      setItems(its);
      setCompletion(comp);
      setNoteDraft(comp?.eodNote ?? '');
    })();
    return () => { cancelled = true; };
  }, [familyId, helperUid]);

  if (items === null) return null;
  const scheduled = itemsScheduledOn(items);
  if (scheduled.length === 0) return null; // nothing on today's plan

  // v4-final §04 Step 7 — partition adhoc one-offs out of the regular
  // morning/anytime/evening grid. Ad-hoc items render in their own
  // honey-tinted strip above the recurring sections so the helper
  // can't miss "the new thing the parent assigned today".
  const { adhoc: adhocToday, recurring: recurringToday } = partitionByKind(scheduled);
  const grouped = groupItemsByPeriod(recurringToday);
  const done = completion?.completedItemIds ?? [];
  // Percent + count include adhoc + recurring — they're equally weighted
  // since the helper has to do both.
  const pct = dailyCompletionPct(scheduled, completion);
  const doneCount = scheduled.filter((i) => done.includes(i.id)).length;

  const toggle = async (itemId: string) => {
    setBusyItem(itemId);
    try {
      await toggleItemCompletion(familyId, helperUid, itemId, helperUid);
      const next = await getCompletion(familyId, helperUid);
      setCompletion(next);
    } finally { setBusyItem(null); }
  };

  const saveNote = async () => {
    if (noteDraft === (completion?.eodNote ?? '')) return;
    setNoteSaving(true);
    try {
      await setEodNote(familyId, helperUid, noteDraft, helperUid);
      const next = await getCompletion(familyId, helperUid);
      setCompletion(next);
    } finally { setNoteSaving(false); }
  };

  return (
    <div className="mb-5 lg:mb-7 bg-white border border-kaya-warm-dark rounded-kaya-lg p-4 lg:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-kaya-sand inline-flex items-center gap-1.5">
            <ClipboardList size={13} /> Your workplan today
          </p>
          <p className="text-[11px] text-kaya-sand mt-0.5">
            {doneCount} of {scheduled.length} done · {pct}%
          </p>
        </div>
        {/* Big circular progress badge */}
        <div className={`flex items-center justify-center w-12 h-12 rounded-full font-display font-black text-sm flex-shrink-0 ${
          pct === 100
            ? 'bg-green-100 text-green-700 border-2 border-green-400'
            : pct >= 50
              ? 'bg-kaya-gold-light/40 text-kaya-chocolate border-2 border-kaya-gold'
              : 'bg-kaya-cream text-kaya-sand border-2 border-kaya-warm-dark'
        }`}>
          {pct}%
        </div>
      </div>

      {/* ── Ad-hoc one-offs ── parent-assigned tasks just for today,
          honey-tinted strip so the helper notices them. Each tile
          shows the optional note under the label. */}
      {adhocToday.length > 0 && (
        <div className="mb-3 -mx-1 px-3 py-2.5 bg-[#FFF3D9] border-2 border-hive-honey rounded-kaya">
          <p className="text-[10px] uppercase tracking-wider text-hive-honey-dk font-bold mb-2 inline-flex items-center gap-1.5">
            <span>✨ Ad-hoc · just for today</span>
            <span className="text-[9px] text-hive-muted normal-case font-normal">({adhocToday.length} one-off{adhocToday.length === 1 ? '' : 's'})</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {adhocToday.map((item) => {
              const isDone = done.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={busyItem === item.id}
                  onClick={() => toggle(item.id)}
                  className={`relative aspect-square flex flex-col items-center justify-center gap-0.5 p-2 rounded-kaya border-2 transition-all ${isDone
                    ? 'bg-green-50 border-green-400 hover:bg-green-100'
                    : 'bg-white border-hive-honey-dk hover:shadow-sm'
                  } ${busyItem === item.id ? 'opacity-50' : ''}`}
                  aria-pressed={isDone}
                >
                  <span className="absolute top-1 left-1 text-[8px] uppercase tracking-wider font-black bg-hive-honey-dk text-white px-1 rounded">
                    Ad-hoc
                  </span>
                  <span className="text-3xl lg:text-4xl mt-2">{item.icon}</span>
                  <span className={`text-[10px] lg:text-[11px] font-bold text-center leading-tight line-clamp-2 px-1 ${isDone ? 'text-green-800' : 'text-kaya-chocolate'}`}>
                    {item.label}
                  </span>
                  {item.note && (
                    <span className="text-[9px] italic text-kaya-sand text-center leading-tight line-clamp-2 px-1">
                      &ldquo;{item.note}&rdquo;
                    </span>
                  )}
                  {isDone && (
                    <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-green-500 text-white flex items-center justify-center">
                      <Check size={12} strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {(['morning', 'anytime', 'evening'] as WorkplanPeriod[]).map((period) => (
        grouped[period].length > 0 && (
          <div key={period} className="mb-3 last:mb-0">
            <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-2">
              {period === 'morning' ? '☀️ Morning' : period === 'evening' ? '🌙 Evening' : '⏱️ Anytime'}
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {grouped[period].map((item) => {
                const isDone = done.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={busyItem === item.id}
                    onClick={() => toggle(item.id)}
                    className={`relative aspect-square flex flex-col items-center justify-center gap-1 p-2 rounded-kaya border-2 transition-all ${isDone
                      ? 'bg-green-50 border-green-400 hover:bg-green-100'
                      : 'bg-white border-kaya-warm-dark hover:border-kaya-chocolate hover:shadow-sm'
                    } ${busyItem === item.id ? 'opacity-50' : ''}`}
                    aria-pressed={isDone}
                  >
                    <span className="text-3xl lg:text-4xl">{item.icon}</span>
                    <span className={`text-[10px] lg:text-[11px] font-bold text-center leading-tight line-clamp-2 ${isDone ? 'text-green-800' : 'text-kaya-chocolate'}`}>
                      {item.label}
                    </span>
                    {isDone && (
                      <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-green-500 text-white flex items-center justify-center">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )
      ))}

      {/* End-of-day note */}
      <div className="mt-4 pt-4 border-t border-kaya-warm-dark/40">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold inline-flex items-center gap-1.5">
            📝 End-of-day note
            {noteSaving && <span className="text-amber-600 font-bold normal-case">· Saving…</span>}
            {!noteSaving && completion?.eodNote && noteDraft === completion.eodNote && (
              <span className="text-green-700 font-bold normal-case inline-flex items-center gap-0.5">· <Check size={10} /> Saved</span>
            )}
          </span>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={saveNote}
            placeholder="Anything to flag from today? (optional)"
            rows={2}
            className="mt-1 w-full px-3 py-2 text-sm bg-kaya-cream border border-kaya-warm-dark rounded-kaya focus:outline-none focus:border-kaya-chocolate resize-none"
          />
        </label>
        <p className="text-[10px] text-kaya-sand mt-1">Saves when you tap outside the box.</p>
      </div>
    </div>
  );
}
