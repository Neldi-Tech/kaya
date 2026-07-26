'use client';

// 📜 Badge history (BDG PR4 · B16/B17) — every badge ever earned, with the
// date it landed, exactly like 📜 Redemption history. Kids see their own row
// set; parents see the whole family and can filter by kid. Rows come from the
// permanent `badgeLog` written at mint time, read through /api/badges/history
// (Admin gateway — badgeLog has no client read rule, and this needs zero
// rules deploys).
//
// Same component, two mounts: the kid's /badges page and Manage Rewards.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { BADGE_TIERS, BADGE_AREAS, type BadgeTier } from '@/lib/badgeLib';
import { toDisplayDate } from '@/lib/dates';

export interface BadgeLogRow {
  id: string;
  childId: string;
  badgeId: string;
  name: string;
  icon: string;
  tier: string;
  area: string;
  how: string;
  earnedAt: number | null;
}

function dateOf(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return toDisplayDate(key) || key;
}

/** Fetch the caller's visible badge history. Kids always get their own only —
 *  the route pins it to their childId regardless of what's asked. */
export async function fetchBadgeHistory(token: string, childId?: string | null): Promise<BadgeLogRow[]> {
  const qs = childId ? `?childId=${encodeURIComponent(childId)}` : '';
  const res = await fetch(`/api/badges/history${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json()) as { ok?: boolean; rows?: BadgeLogRow[] };
  return json.ok && Array.isArray(json.rows) ? json.rows : [];
}

export default function BadgeHistory({
  /** Kid mount: pin the list to this kid. Parent mount: leave null for the
   *  whole family (filter chips appear instead). */
  childId = null,
  compact = false,
}: { childId?: string | null; compact?: boolean }) {
  const { user, profile } = useAuth();
  const { children } = useFamily();
  const isKid = profile?.role === 'kid';

  const [rows, setRows] = useState<BadgeLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [kidFilter, setKidFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!user) return;
    let live = true;
    setLoading(true);
    user.getIdToken()
      .then((t) => fetchBadgeHistory(t, childId))
      .then((r) => { if (live) setRows(r); })
      .catch(() => { if (live) setRows([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [user, childId]);

  const nameOf = useMemo(() => {
    const m = new Map(children.map((c) => [c.id, { name: c.name, emoji: c.avatarEmoji || '🧒' }]));
    return (id: string) => m.get(id) || { name: 'Kid', emoji: '🧒' };
  }, [children]);

  const shown = kidFilter ? rows.filter((r) => r.childId === kidFilter) : rows;
  const capped = showAll ? shown : shown.slice(0, compact ? 5 : 12);
  // Kids who actually appear in the log — no dead filter chips.
  const kidsInLog = children.filter((c) => rows.some((r) => r.childId === c.id));

  if (loading) return <p className="text-[12px] text-kaya-sand py-3">Loading badge history…</p>;

  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] text-kaya-sand py-3">
        {isKid
          ? 'No badges yet — your first one is on its way. Check 🧭 Kaya Badge above to see what&apos;s closest!'
          : 'No badges earned yet. Release a few in 🏬 Badge Boutique and the first ones will land here with their dates.'}
      </p>
    );
  }

  return (
    <div>
      {/* Kid filter — parent mount only */}
      {!childId && kidsInLog.length > 1 && (
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
          <button
            onClick={() => setKidFilter(null)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-extrabold whitespace-nowrap border ${
              kidFilter === null ? 'bg-kaya-gold text-white border-transparent' : 'bg-white border-kaya-warm-dark text-kaya-sand'
            }`}
          >
            Everyone {rows.length}
          </button>
          {kidsInLog.map((c) => (
            <button
              key={c.id}
              onClick={() => setKidFilter(c.id)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-extrabold whitespace-nowrap border ${
                kidFilter === c.id ? 'text-white border-transparent' : 'bg-white border-kaya-warm-dark text-kaya-sand'
              }`}
              style={kidFilter === c.id ? { backgroundColor: c.houseColor } : {}}
            >
              {c.avatarEmoji || '🧒'} {c.name.split(' ')[0]} {rows.filter((r) => r.childId === c.id).length}
            </button>
          ))}
        </div>
      )}

      <ul className="divide-y divide-kaya-warm-dark/60">
        {capped.map((r) => {
          const who = nameOf(r.childId);
          const tier = BADGE_TIERS[(r.tier as BadgeTier)] || BADGE_TIERS.easy;
          const areaMeta = BADGE_AREAS.find((a) => a.id === r.area);
          return (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <span className="text-2xl shrink-0">{r.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold truncate">
                  {r.name}
                  <span className="ml-1.5 text-[10px] font-semibold text-kaya-sand">{tier.emoji} {tier.label}</span>
                </p>
                <p className="text-[11px] text-kaya-sand truncate">
                  {!childId && <>{who.emoji} {who.name.split(' ')[0]} · </>}
                  {areaMeta ? `${areaMeta.emoji} ${areaMeta.label} · ` : ''}{r.how}
                </p>
              </div>
              <span className="text-[11px] font-bold text-kaya-sand shrink-0 tabular-nums">{dateOf(r.earnedAt) || '—'}</span>
            </li>
          );
        })}
      </ul>

      {shown.length > capped.length && (
        <button onClick={() => setShowAll(true)} className="mt-2 text-[11.5px] font-extrabold text-kaya-gold">
          Show all {shown.length} →
        </button>
      )}
    </div>
  );
}
