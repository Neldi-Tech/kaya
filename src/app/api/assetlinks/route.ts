// Digital Asset Links — the handshake that lets the Kaya Android app (a
// Trusted Web Activity) render www.ourkaya.com FULL-SCREEN instead of inside a
// Chrome tab with a URL bar.
//
// How the handshake works:
//   1. The Android app declares `asset_statements` pointing at this origin.
//   2. Chrome fetches https://www.ourkaya.com/.well-known/assetlinks.json.
//   3. If the SHA-256 fingerprint of the certificate that signed the installed
//      APK appears below, verification passes and the URL bar disappears.
//   Any mismatch fails *silently* — the app still works, it just shows the
//   address bar. That is the symptom to look for if this file drifts.
//
// Where the fingerprint comes from: Play App Signing re-signs every upload, so
// the fingerprint that matters is the one Google holds, NOT the local upload
// keystore. Read it from
//   Play Console → <app> → Test and release → Setup → App signing
//     → "App signing key certificate" → SHA-256 certificate fingerprint
// and set it as ANDROID_SHA256_FINGERPRINTS in Vercel (all environments).
//
// Multiple fingerprints are supported (comma- or newline-separated) — you need
// at least two in practice: the Play *app signing* key (production installs)
// and the local *upload* key (so a `bubblewrap build` sideload verifies too).
//
// Served at /.well-known/assetlinks.json via a rewrite in next.config.js —
// Next.js will not route a directory whose name begins with a dot, so the
// canonical path is mapped onto this handler rather than nested under app/.

export const dynamic = 'force-dynamic';

const DEFAULT_PACKAGE = 'com.ourkaya.app';

/** Normalise one fingerprint to Google's expected `AA:BB:…` upper-case form. */
function normalise(raw: string): string | null {
  // Tolerate lower-case, whitespace, and the colon-free form people paste from
  // `keytool` output or a spreadsheet cell.
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 64) return null; // SHA-256 = 32 bytes = 64 hex chars
  return (hex.match(/.{2}/g) as string[]).join(':');
}

export function GET() {
  const pkg = process.env.ANDROID_PACKAGE_NAME || DEFAULT_PACKAGE;

  const fingerprints = (process.env.ANDROID_SHA256_FINGERPRINTS || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalise)
    .filter((v): v is string => v !== null);

  // No fingerprint configured yet → serve a valid, EMPTY statement list rather
  // than a 500. Chrome reads it, finds no match, and falls back to showing the
  // URL bar. That is the correct pre-launch state: the endpoint is live and
  // well-formed, waiting for the key.
  const body = fingerprints.length
    ? [
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: pkg,
            sha256_cert_fingerprints: fingerprints,
          },
        },
      ]
    : [];

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      // Google's verifier requires application/json — a text/plain response
      // fails verification even when the bytes are identical.
      'Content-Type': 'application/json',
      // Public + short cache: Chrome re-verifies periodically, and we want a
      // fingerprint change to take effect within minutes, not a day.
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
