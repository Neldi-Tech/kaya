'use client';

// useHelperGrants — small reusable hook that returns the helper's
// granted module-access set. (2026-05-19, extracted out of AppShell.)
//
// Three states:
//   • `null`     — still loading, OR caller isn't a helper (no gating
//                  applies; treat as "show everything" for parents/kids).
//   • `'legacy'` — helper with no HelperLink doc; pre-rollout join. The
//                  AppShell rule-fallback `isLegacyHelperWithoutLink`
//                  matches this. Callers should also treat as "show
//                  everything" so legacy helpers keep working.
//   • `Set<string>` — concrete grants. Keys include both bare module
//                  ids ('moments', 'hive') AND composite keys for
//                  modules with subs ('household:purchase',
//                  'household:outdoor', 'kaya:rate', etc.). A bare
//                  parent key in the set means "all subs granted" — see
//                  `helperGrantsAllow` for the matcher.

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getHelperLink } from './helpers';

/** 2026-05-19 v2 — Helper grants now carry BOTH the granted set AND
 *  the explicitly-denied set, so parent-level grants don't override
 *  per-sub denies. Previously: a HelperLink with
 *    moduleAccess['household']         = { view: true, act: true }
 *    moduleAccess['household:drivers'] = { view: false, act: false }
 *  collapsed to a single Set containing 'household' but not
 *  'household:drivers'. helperGrantsAllow('household:drivers') then
 *  fell back to the parent grant and returned true — Drivers tile
 *  showed up even though the parent had explicitly toggled it off.
 *  Deny-precedence fixes that. */
export type HelperGrants =
  | { grants: Set<string>; denies: Set<string> }
  | 'legacy'
  | null;

export function useHelperGrants(): HelperGrants {
  const { profile } = useAuth();
  const role = profile?.role;
  const familyId = profile?.familyId;
  const uid = profile?.uid;

  const [grants, setGrants] = useState<HelperGrants>(null);

  useEffect(() => {
    let cancelled = false;
    if (role !== 'helper' || !familyId || !uid) {
      setGrants(null);
      return;
    }
    (async () => {
      try {
        const link = await getHelperLink(familyId, uid);
        if (cancelled) return;
        if (!link) { setGrants('legacy'); return; }
        const granted = new Set<string>();
        const denied = new Set<string>();
        if (link.moduleAccess) {
          for (const [id, flags] of Object.entries(link.moduleAccess)) {
            if (flags.view) granted.add(id);
            else denied.add(id);
          }
        } else {
          for (const id of link.modules) granted.add(id);
        }
        setGrants({ grants: granted, denies: denied });
      } catch {
        if (!cancelled) setGrants('legacy');
      }
    })();
    return () => { cancelled = true; };
  }, [role, familyId, uid]);

  return grants;
}

/** Predicate for "does this helper see this module?". Returns true for
 *  non-helpers (no gating) and legacy helpers (show everything). For
 *  helpers with concrete grants, walks the composite/parent fallback
 *  chain with DENY PRECEDENCE — an explicit `view: false` on a sub
 *  wins over a parent-level grant. Accepts both bare ids ('moments')
 *  and composite keys ('household:purchase'). */
export function helperGrantsAllow(grants: HelperGrants, key: string): boolean {
  if (grants === null || grants === 'legacy') return true;
  // Explicit deny on this exact key wins over everything else.
  if (grants.denies.has(key)) return false;
  // Explicit grant on this exact key.
  if (grants.grants.has(key)) return true;
  // Composite key — fall back to the parent grant, but only if the
  // parent itself isn't explicitly denied.
  const colon = key.indexOf(':');
  if (colon > 0) {
    const parent = key.slice(0, colon);
    if (grants.denies.has(parent)) return false;
    if (grants.grants.has(parent)) return true;
  }
  return false;
}
