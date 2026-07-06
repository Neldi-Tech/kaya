// 📬 Kids' Email Updates — types + defaults (KID PR1, approved design v2).
//
// PURE module (zero imports) — safe for client + server, same split as
// lib/alertEmails.shared.
//
// COPPA posture (D1): everything defaults OFF, and the address is a POINTER
// to something a parent already registered — the kid's profile email
// (Child.email), a parent's login email, or an approved external contact.
// Never a free-text address, never collected from the kid (F1/F2), and the
// live value resolves at send time so a profile change follows automatically
// (F9 — no stale copies).
//
// Stored on the family doc (parents client-write; no rules change):
//   family.kidEmailUpdates = { [childId]: KidEmailPrefs }

export type KidEmailSource =
  | { type: 'kid' }                      // the kid's own profile email
  | { type: 'parent'; uid: string }      // a parent's login email
  | { type: 'contact'; id: string };     // an approved external contact

export interface KidEmailPrefs {
  source?: KidEmailSource;
  /** 🏅 instant reward emails (awards + approved tasks). Default OFF. */
  rewards?: boolean;
  /** 🌞 morning routine digest. Default OFF. */
  digest?: boolean;
  /** 'HH:MM' family-local send time for the digest. */
  digestTime?: string;
  /** Local day-key of the last digest sent — the cron's dedupe stamp
   *  (server-written). */
  lastDigestDayKey?: string;
}

export type KidEmailUpdatesConfig = Record<string, KidEmailPrefs>;

export const DEFAULT_DIGEST_TIME = '06:30';

/** Digest time choices offered in Setup — early-morning half-hours. */
export const DIGEST_TIME_CHOICES = ['05:30', '06:00', '06:30', '07:00', '07:30', '08:00'];
