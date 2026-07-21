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
  // ── 📬 Hive Statement Mail (HIVE PR4, approved v2 + Elia's additions) ──
  /** Recurring Hive/Business/Money/Points statement to the kid, parents
   *  always CC'd. Default OFF. */
  statement?: boolean;
  statementFreq?: 'weekly' | 'monthly';
  /** Weekly send day (ignored for monthly, which fires on the 1st). */
  statementDay?: StatementDay;
  /** 'HH:MM' family-local send time — Elia's time-window addition. */
  statementTime?: string;
  /** Extended CC (Elia's addition): approved external-contact ids… */
  statementCcContacts?: string[];
  /** …and parent-entered extra addresses (work email etc.), validated. */
  statementCcExtra?: string[];
  /** Fired-day stamp (server-written) — one send per scheduled day. */
  lastStatementKey?: string;
}

export type StatementDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type KidEmailUpdatesConfig = Record<string, KidEmailPrefs>;

export const DEFAULT_DIGEST_TIME = '06:30';

/** Digest time choices offered in Setup — early-morning half-hours. */
export const DIGEST_TIME_CHOICES = ['05:30', '06:00', '06:30', '07:00', '07:30', '08:00'];

export const DEFAULT_STATEMENT_TIME = '07:00';
export const DEFAULT_STATEMENT_DAY: StatementDay = 'sun';

/** Statement send-time window — morning + evening slots (Elia's addition). */
export const STATEMENT_TIME_CHOICES = ['06:30', '07:00', '07:30', '08:00', '17:00', '18:00', '19:00', '20:00'];

export const STATEMENT_DAYS: { key: StatementDay; label: string }[] = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

/** Light email shape check for the parent-entered extra CC addresses. */
export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}
