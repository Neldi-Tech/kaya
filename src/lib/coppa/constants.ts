// Kaya · COPPA + Login — shared constants (policy versioning, Max-Privacy,
// Kaya Code format).
//
// The legal source of truth (the Terms + Privacy docx) lives WITH ELIA, not
// in this repo. ACTIVE_POLICY_VERSION is the in-code pointer the acceptance
// audit pins against. Bump it whenever a MATERIAL policy change ships — that
// forces every parent back through the /accept gate on their next entry.

export const ACTIVE_POLICY_VERSION = '2026-05-29';

// sessionStorage key the /accept gate sets the moment an adult taps "I agree
// and continue". The app-entry gate treats it as "accepted this session", so a
// best-effort audit-write hiccup can NEVER trap a user in an /accept redirect
// loop — one deliberate tap always gets them through. Cleared on a new session.
export const ACCEPT_SESSION_KEY = 'kaya_accept_ok';

// Stamp marking when ENFORCED Max-Privacy Mode shipped. Referenced by the CI
// smoke test (PR h) so a regression that strips the child-session guards is
// caught before deploy. Never remove.
export const MAX_PRIVACY_MODE_SHIPPED_AT = '2026-05-29';

// Child activity logs are deleted after this many days (Max-Privacy Mode —
// 30-day rolling retention). Enforced by the scheduled cleanup (PR h).
export const CHILD_LOG_RETENTION_DAYS = 30;

// ── Kaya Code format ──────────────────────────────────────────────
// A redeemable child login code. Human prefix + random body. The PLAINTEXT
// is NEVER stored server-side — only a bcrypt hash. It is shown to the parent
// once (held in component state / the HTTP response) for ~60s, then gone.
export const KAYA_CODE_PREFIX = 'KAYA';
// Random body length. (Final length + dash grouping is reconciled against the
// kid-entry tiles in PR(g) — the mockup shows an illustrative KAYA-7M2P.)
export const KAYA_CODE_BODY_LEN = 8;
// Unambiguous alphabet — no 0/O/1/I/L — so kid entry is error-free.
export const KAYA_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// How long the plaintext preview stays valid after generation.
export const KAYA_CODE_PREVIEW_TTL_MS = 60_000;
