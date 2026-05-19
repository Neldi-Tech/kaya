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

export type HelperGrants = Set<string> | 'legacy' | null;

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
        const ids = new Set<string>();
        if (link.moduleAccess) {
          for (const [id, flags] of Object.entries(link.moduleAccess)) {
            if (flags.view) ids.add(id);
          }
        } else {
          for (const id of link.modules) ids.add(id);
        }
        setGrants(ids);
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
 *  chain. Accepts both bare ids ('moments') and composite keys
 *  ('household:purchase'). */
export function helperGrantsAllow(grants: HelperGrants, key: string): boolean {
  if (grants === null || grants === 'legacy') return true;
  if (grants.has(key)) return true;
  const colon = key.indexOf(':');
  if (colon > 0) {
    const parent = key.slice(0, colon);
    if (grants.has(parent)) return true;
  }
  return false;
}
