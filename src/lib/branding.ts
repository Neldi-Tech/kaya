// Kaya Branding — operator-controlled copy + brand defaults.
//
// Lives at /config/branding (single doc). Read by useBranding() which
// any signed-in user can subscribe to live.
//
// Truly minimal for v1:
//   • Brand wordmark    — overrides "Kaya" in the AppShell title spots
//   • Announcement bar  — single-line message shown at the top of every
//                          app-shell page when `bannerEnabled` is true
//
// Broader theming (accent color, logo URL, fonts) is deferred to v1.1.
// The shape below leaves a forward-compatible seam — add fields, keep
// the existing ones untouched.

export interface BrandingConfig {
  /** Wordmark string shown in the sidebar header + nav title.
   *  Default 'Kaya'. */
  wordmark: string;
  /** Announcement bar visibility — when false, banner is hidden even
   *  if `bannerText` is non-empty. */
  bannerEnabled: boolean;
  /** Plain text shown in the banner. Trim to ~120 chars in the UI. */
  bannerText: string;
  /** Optional leading emoji rendered before the text. Empty string =
   *  no emoji. */
  bannerEmoji: string;
}

export const DEFAULT_BRANDING: BrandingConfig = {
  wordmark: 'Kaya',
  bannerEnabled: false,
  bannerText: '',
  bannerEmoji: '🎉',
};
