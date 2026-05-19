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
 *  helpers with concrete grants, requires the EXACT key in the grants
 *  set (or its legacy 'home' alias for 'kaya:*').
 *
 *  2026-05-19 v3 — Parent-grant fallback removed. Previously, a bare
 *  'household' grant in moduleAccess (or in the legacy `modules`
 *  array) auto-allowed every household:* sub, which was the actual
 *  root cause of the Drivers-leak Elia kept reporting: the deny-
 *  precedence fix in v2 only helped when the helper had an explicit
 *  per-sub deny written; helpers with a bare parent grant and no
 *  explicit sub-deny still leaked. Each sub must now be explicitly
 *  granted (matches what the settings UI writes — togglePresetSubs +
 *  toggleModuleTier both write specific sub keys, never bare
 *  parents). The 'home' → 'kaya:*' alias stays for the very old
 *  legacy join path. */
export function helperGrantsAllow(grants: HelperGrants, key: string): boolean {
  if (grants === null || grants === 'legacy') return true;
  // Explicit deny on this exact key wins over everything else.
  if (grants.denies.has(key)) return false;
  // Explicit grant on this exact key.
  if (grants.grants.has(key)) return true;
  // Legacy: a `kaya:*` key passes if the very-old 'home' alias was
  // granted (pre-Kaya-split helper docs). Same explicit-deny check.
  const colon = key.indexOf(':');
  if (colon > 0) {
    const parent = key.slice(0, colon);
    if (parent === 'kaya' && !grants.denies.has('home') && grants.grants.has('home')) return true;
  }
  return false;
}
