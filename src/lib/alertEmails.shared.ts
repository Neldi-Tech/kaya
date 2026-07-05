// 🔔 Alert emails — the Global → Category → Item recipient cascade
// (VIS PR3, approved design v2 D9/D10).
//
// PURE module: types + the resolver only, zero imports — safe for BOTH the
// client (Household Setup card) and the server engine (lib/autoTopup.server).
// Client read/write helpers live in lib/alertEmails.ts.
//
// Stored on the family doc (parents client-write it; no rules change):
//   family.alertEmails = {
//     global?:        string[]   // parent uids; ABSENT = all parents
//     utilities?:     string[]   // ABSENT = inherit global; present = custom (detached)
//     vehicles?:      string[]
//     subscriptions?: string[]
//   }
// Item-level overrides live on the item itself (meter.alertRecipientUids,
// VIS PR4) and win over everything.
//
// Scope: EMAIL only. In-app reaches all parents + the helper of record (D2);
// family chat is the family thread. Neither is filtered by this cascade.

export type AlertCategory = 'utilities' | 'vehicles' | 'subscriptions';

export interface AlertEmailsConfig {
  global?: string[];
  utilities?: string[];
  vehicles?: string[];
  subscriptions?: string[];
}

export type AlertResolveLevel = 'item' | 'category' | 'global';

export const ALERT_CATEGORIES: { key: AlertCategory; emoji: string; label: string }[] = [
  { key: 'utilities', emoji: '⚡', label: 'Utilities' },
  { key: 'vehicles', emoji: '🚗', label: 'Vehicles' },
  { key: 'subscriptions', emoji: '📄', label: 'Subscriptions' },
];

/** Resolve who gets the EMAIL for an alert in `category`.
 *  Precedence: item > category > global > all parents (F10). Every level is
 *  safety-floored (F1): a level that names nobody — or only people who are
 *  no longer parents — falls through to the next, so the alarm always has
 *  ears. */
export function resolveAlertRecipients(
  cfg: AlertEmailsConfig | undefined,
  category: AlertCategory,
  allParentUids: string[],
  itemOverride?: string[],
): { uids: string[]; level: AlertResolveLevel } {
  const valid = (arr?: string[]): string[] | null => {
    if (!arr || arr.length === 0) return null;
    const r = arr.filter((u) => allParentUids.includes(u));
    return r.length > 0 ? r : null;
  };
  const item = valid(itemOverride);
  if (item) return { uids: item, level: 'item' };
  const cat = valid(cfg?.[category]);
  if (cat) return { uids: cat, level: 'category' };
  const g = valid(cfg?.global);
  if (g) return { uids: g, level: 'global' };
  return { uids: allParentUids, level: 'global' };
}
