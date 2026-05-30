// Operator-only admin settings, persisted at /config/admin (Admin SDK only;
// never read by the client SDK, so no Firestore rules are needed). Defaults
// below are the fallback when the doc is missing.

export type AddonBillingMode = 'request' | 'stripe' | 'auto';

export interface AdminSettings {
  /** A family with no recorded activity within this many days is flagged
   *  "dormant" on /admin/families so the operator can re-engage them.
   *  Clamped 1–365 on write. */
  activeWindowDays: number;
  /** How families acquire add-ons:
   *  - 'request' → request → operator approves (closed-beta default)
   *  - 'stripe'  → Stripe self-serve checkout (global flip to paid)
   *  - 'auto'    → 'request' for a family's first addonAutoSwitchMonths, then
   *                'stripe'. */
  addonBillingMode: AddonBillingMode;
  /** Months from a family's join date before 'auto' flips it to Stripe.
   *  Clamped 1–24 on write. */
  addonAutoSwitchMonths: number;
}

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  activeWindowDays: 7,
  addonBillingMode: 'request',
  addonAutoSwitchMonths: 3,
};

/** Resolve the effective add-on acquisition mode for one family ('request'
 *  or 'stripe'). 'auto' flips to Stripe once the family is older than the
 *  configured window. */
export function resolveAddonBillingMode(
  settings: Pick<AdminSettings, 'addonBillingMode' | 'addonAutoSwitchMonths'>,
  familyCreatedAtMs: number | null | undefined,
  nowMs: number,
): 'request' | 'stripe' {
  if (settings.addonBillingMode === 'stripe') return 'stripe';
  if (settings.addonBillingMode === 'request') return 'request';
  // 'auto' — request for the first N months from join, then Stripe.
  if (!familyCreatedAtMs) return 'request';
  const windowMs = settings.addonAutoSwitchMonths * 30 * 24 * 60 * 60 * 1000;
  return nowMs - familyCreatedAtMs >= windowMs ? 'stripe' : 'request';
}
