// 📲 WhatsApp Alerts (approved 15-Oct-2026) — shared, PURE pieces.
//
// Imported by the server pipe (lib/whatsapp.server), the gateways, the
// Settings card and the 📜 Alert log trace. No Firebase imports here.
//
// Closed logic (Logic Test v1 + Design v1, D1–D6 as recommended):
//   R1  parents only · R2 per-parent alert toggles · R3 approved templates
//   only · R5 reflections at the family alert time, WhatsApp at N then every
//   +5 · R6 low rating below the family line, once per rating, ≤1/kid/day,
//   rater skipped · R7 deductions, giver skipped · R8 quiet hours hold +
//   re-check · R9 ≤6 per parent per day · R10 trace · R11 STOP · R13 kill
//   switch.

export type WaLinkState = 'pending' | 'connected' | 'failed' | 'stopped' | 'off';

export interface WaAlertPrefs { reflection: boolean; lowRating: boolean; deduction: boolean }
export const DEFAULT_WA_ALERTS: WaAlertPrefs = { reflection: true, lowRating: true, deduction: true };

/** Family rules (Design card G) — `family.whatsappAlerts`. */
export interface WaFamilyRules {
  /** R13 — the whole-family switch. */
  enabled: boolean;
  /** D1 — a rating is "low" below this score. */
  lowLinePct: 40 | 50 | 60;
  /** D4 — quiet hours, family clock, 'HH:MM'. */
  quietFrom: string;
  quietTo: string;
}
export const DEFAULT_WA_RULES: WaFamilyRules = { enabled: true, lowLinePct: 50, quietFrom: '21:00', quietTo: '07:00' };
export const WA_LOW_LINES: WaFamilyRules['lowLinePct'][] = [40, 50, 60];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function isHHMM(s: unknown): s is string { return typeof s === 'string' && HHMM.test(s); }

export function resolveWaRules(raw?: Partial<WaFamilyRules> | null): WaFamilyRules {
  const r = raw || {};
  return {
    enabled: r.enabled !== false,
    lowLinePct: WA_LOW_LINES.includes(r.lowLinePct as WaFamilyRules['lowLinePct']) ? (r.lowLinePct as WaFamilyRules['lowLinePct']) : DEFAULT_WA_RULES.lowLinePct,
    quietFrom: isHHMM(r.quietFrom) ? r.quietFrom : DEFAULT_WA_RULES.quietFrom,
    quietTo: isHHMM(r.quietTo) ? r.quietTo : DEFAULT_WA_RULES.quietTo,
  };
}

/** R9 — WhatsApps per parent per family day. */
export const WA_DAILY_CAP = 6;
/** D2 — default family alert time for the missed-reflection alert. */
export const REFLECTION_ALERT_DEFAULT = '18:00';
/** D3 — after the first WhatsApp, one more every N further missed days. */
export const REFLECTION_WA_REPEAT_DAYS = 5;

export function minutesOf(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
/** Is `nowMin` inside [from, to)? Wraps past midnight (21:00 → 07:00). */
export function inQuietHours(nowMin: number, from: string, to: string): boolean {
  const f = minutesOf(from); const t = minutesOf(to);
  if (f === t) return false;
  return f < t ? nowMin >= f && nowMin < t : nowMin >= f || nowMin < t;
}

// ── Status words (Design §4 legend — same words in the sheet + Settings) ──
export type WaStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'held' | 'dropped' | 'capped' | 'failed' | 'skipped';
/** Forward-only progression for Twilio callbacks (they can arrive out of order). */
export const WA_STATUS_RANK: Record<WaStatus, number> = {
  held: 0, queued: 1, sent: 2, delivered: 3, read: 4, failed: 5, dropped: 5, capped: 5, skipped: 5,
};
export const WA_STATUS_LABEL: Record<WaStatus, string> = {
  queued: '⏳ Queued', sent: '✓ Sent', delivered: '✓✓ Delivered', read: '✓✓ Read', held: '⏸ Held',
  dropped: '⊘ Dropped', capped: '⛔ Capped', failed: '❌ Failed', skipped: '— Skipped',
};

export interface WaRecipient {
  uid: string;
  name: string;
  /** "+255 7•• ••• 456" — never the full number in the log. */
  masked: string;
  status: WaStatus;
  at: number;
  sid?: string;
  /** Plain-words reason (failed) or why (held · dropped · skipped · capped). */
  note?: string;
  /** Held only — when it was put on hold. */
  heldAt?: number;
}

/** The Settings test (T0) — must reach ✓✓ before alerts start (F3). */
export interface WaTest { sid?: string; status: WaStatus | 'not-configured'; at: number; note?: string }

/** What /api/whatsapp/settings returns to the Settings card. */
export interface WaView {
  configured: boolean;
  cap: number;
  me: null | {
    state: WaLinkState;
    number: string;
    display: string;
    alerts: WaAlertPrefs;
    test?: WaTest;
    connectedAt?: number;
    stoppedAt?: number;
    todayCount: number;
  };
  family: { rules: WaFamilyRules; people: { uid: string; name: string; state: WaLinkState | 'none' }[] };
}

export type WaTemplateName = 'kaya_whatsapp_welcome' | 'kaya_reflection_missed' | 'kaya_rating_low' | 'kaya_points_deducted';

/** The 📲 channel on an alertLog entry (AlertLogChannels.whatsapp). */
export interface WaChannel {
  on: boolean;
  /** Any recipient accepted by Twilio (or held to go later). */
  sent: boolean;
  template: WaTemplateName;
  /** The template blanks AS SENT — the trace re-renders from these (F9). */
  vars: Record<string, string>;
  to: WaRecipient[];
  status?: string;
}

// ── The four approved templates (Logic Test §4, word for word) ──────────
export const APP_ORIGIN = 'https://www.ourkaya.com';

interface TemplateDef {
  /** Env var holding the Twilio Content SID once Meta approves it. */
  env: string;
  body: string;
  button?: { title: string; url: string };
}
export const WA_TEMPLATES: Record<WaTemplateName, TemplateDef> = {
  kaya_whatsapp_welcome: {
    env: 'TWILIO_TPL_WELCOME',
    body: '*Kaya ✅* WhatsApp alerts are now on for the {{1}} family. We’ll message you here when one of the kids needs a hand, like a missed reflection or a low rating. Reply STOP any time to turn these off.',
  },
  kaya_reflection_missed: {
    env: 'TWILIO_TPL_REFLECTION',
    body: '*Kaya · Daily Reflection ⚠️*\n{{1}} hasn’t written a reflection for {{2}} school days in a row. A quick check-in tonight usually saves the streak.',
    button: { title: 'Open Sparks', url: `${APP_ORIGIN}/sparks` },
  },
  kaya_rating_low: {
    env: 'TWILIO_TPL_RATING',
    body: '*Kaya · Routine rating 📉*\n{{1}}’s {{2}} routine scored {{3}}% today. Needs work: {{4}}. Rated by {{5}}, so tap below for the full report.',
    button: { title: 'See the report', url: `${APP_ORIGIN}/{{6}}` },
  },
  kaya_points_deducted: {
    env: 'TWILIO_TPL_DEDUCTION',
    body: '*Kaya · Points ➖*\n{{1}} lost {{2}} House Points for {{3}}, given by {{4}}. Tap below to read the note.',
    button: { title: 'Open in Kaya', url: `${APP_ORIGIN}/{{5}}` },
  },
};

function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{(\d+)\}\}/g, (_, k: string) => vars[k] ?? '');
}
/** The message exactly as the parent sees it — used by the freeform
 *  fallback (before Meta approves a template) and by the 📜 trace. */
export function renderWaTemplate(name: WaTemplateName, vars: Record<string, string>): { text: string; button?: { title: string; url: string } } {
  const t = WA_TEMPLATES[name];
  return { text: fill(t.body, vars), ...(t.button ? { button: { title: t.button.title, url: fill(t.button.url, vars) } } : {}) };
}

// ── Numbers ─────────────────────────────────────────────────────────────
// Same normalisation as lib/directory.normalizePhone (TZ 0xxx → 255xxx).
const TZ_CC = '255';
export function normalizeWaNumber(raw: string | undefined | null): string {
  if (!raw) return '';
  const plus = raw.trim().startsWith('+');
  let d = raw.replace(/[^0-9]/g, '');
  if (!d) return '';
  if (!plus) {
    if (d.length === 10 && d.startsWith('0')) d = TZ_CC + d.slice(1);
    else if (d.length === 9 && /^[67]/.test(d)) d = TZ_CC + d;
  }
  return d;
}
/** Plausible international number: 10–15 digits, no leading 0. */
export function isValidWaNumber(digits: string): boolean {
  return /^[1-9]\d{9,14}$/.test(digits);
}
export function displayWaNumber(digits: string): string {
  if (digits.startsWith(TZ_CC) && digits.length === 12) return `+${TZ_CC} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  if (digits.startsWith('1') && digits.length === 11) return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return digits ? `+${digits}` : '';
}
export function maskWaNumber(digits: string): string {
  if (digits.startsWith(TZ_CC) && digits.length === 12) return `+${TZ_CC} ${digits[3]}•• ••• ${digits.slice(9)}`;
  if (digits.length < 7) return '+•••';
  return `+${digits.slice(0, digits.length - 9 > 0 ? digits.length - 9 : 1)} ••• ••• ${digits.slice(-3)}`;
}

// ── Twilio error codes → plain words (Design state D) ─────────────────────
export function waErrorText(code?: string | number | null, fallback?: string): string {
  const c = String(code ?? '');
  switch (c) {
    case '63003': case '63024': case '21211': case '21614':
      return 'This number doesn’t seem to be on WhatsApp. Check it and try again.';
    case '63016':
      return 'WhatsApp needs the approved message template first. Waiting for Meta to approve it.';
    case '63032': case '63049':
      return 'WhatsApp declined to deliver this message to that number.';
    case '63018': case '20429':
      return 'Too many messages at once. Kaya will try again with the next alert.';
    case '63007': case '63112':
      return 'Kaya’s WhatsApp sender isn’t ready yet (Twilio / Meta setup).';
    case '21408': case '21612':
      return 'Kaya can’t send WhatsApp to this country yet.';
    case 'not-configured':
      return 'WhatsApp isn’t switched on for Kaya yet.';
    default:
      return fallback ? `WhatsApp couldn’t deliver this (${fallback}).` : c ? `WhatsApp couldn’t deliver this (code ${c}).` : 'WhatsApp couldn’t deliver this.';
  }
}

/** First name for message blanks — never empty (Meta rejects empty params). */
export function firstName(s: string | undefined | null, fallback = 'Family'): string {
  const f = (s || '').trim().split(/\s+/)[0];
  return f || fallback;
}
