// Operator-only admin settings, persisted at /config/admin (Admin SDK only;
// never read by the client SDK, so no Firestore rules are needed). Defaults
// below are the fallback when the doc is missing.

export interface AdminSettings {
  /** A family with no recorded activity within this many days is flagged
   *  "dormant" on /admin/families so the operator can re-engage them.
   *  Clamped 1–365 on write. */
  activeWindowDays: number;
}

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  activeWindowDays: 7,
};
