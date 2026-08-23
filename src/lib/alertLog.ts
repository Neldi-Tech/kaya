// 🔔 Alert log — shared types + client fetch (VIS PR1, approved design v2).
//
// Entries are WRITTEN by the server engine (lib/autoTopup.server) — one per
// fired low-balance alert, plus a closing 'recovered' entry per episode —
// and READ through /api/household/alert-log with a verified ID token. The
// `alertLog` subcollection itself is Admin-only: no Firestore-rules change.
//
// D8/F9: entries carry each channel's payload AS SENT — the email as
// structured facts + a templateVersion (the trace re-renders that exact
// version; we never snapshot HTML), the chat line and in-app card verbatim.

export interface AlertLogEmailFacts {
  label: string;
  balanceLine: string;
  requestLine?: string;
  ctaUrl: string;
  ctaLabel: string;
}

/** 📬 Kid reward email facts (KID PR2) — re-rendered by the trace with
 *  the entry's templateVersion, same F9 discipline as the meter emails. */
export interface KidRewardEmailFacts {
  kidName: string;
  emoji: string;
  headline: string;
  detail: string;
  balance?: number;
  streak?: number;
  /** 🔥 Kid Heat Report (Points Emails 2.0, template v2) — present on
   *  rating sends; the trace renders the heat view when it's there. */
  heat?: HeatEmailFacts & { includeReasons?: boolean; askReflection?: boolean };
  /** 🎖️ Award emails 2.0 — kid award card extras (template v2). */
  award?: { awardId: string; kind: string; reason: string; byFirst: string; category?: string };
}

/** 🔥 Heat Report facts (Points Emails 2.0, 2026-08-23) — compact copy of
 *  what the family/outside/kid rating emails rendered, for the as-sent
 *  trace. Tasks are EMPTY on the outside tier (privacy). */
export interface HeatEmailFacts {
  kidName: string; kidFirst: string; kidEmoji?: string;
  period: 'morning' | 'evening'; dateLabel: string; ratedByFirst: string;
  points: number; scorePct: number | null;
  tally: { ex: number; gd: number; bd: number; sk: number };
  tasks: { icon: string; label: string; value: 'excellent' | 'good' | 'bad' | 'skip'; pts: number; note?: string }[];
  comment?: string;
  focus?: { icon: string; label: string; line: string };
  pointsMode?: 'full' | 'badges-only' | 'encouragement';
}

/** 🌞 Kid morning-digest facts (KID PR3). */
export interface KidDigestEmailFacts {
  kidName: string;
  dateLabel: string;
  tasks: { icon: string; label: string; points?: number }[];
  yesterdayPoints: number;
  balance: number;
  streak: number;
}

export interface AlertLogChannels {
  email?: {
    on: boolean; sent: boolean; error?: string;
    to: { name: string; email: string }[];
    subject: string;
    templateVersion: number;
    /** Meter low-balance emails (kind 'alert'). */
    facts?: AlertLogEmailFacts;
    /** Kid reward emails (kind 'kid_reward'). */
    kidFacts?: KidRewardEmailFacts;
    /** Kid morning digests (kind 'kid_digest'). */
    kidDigestFacts?: KidDigestEmailFacts;
    /** 🔥 Family/outside rating emails (kind 'points_email'). */
    heatFacts?: HeatEmailFacts;
    /** 🎖️ Family/outside award emails (kind 'points_email', trigger 'award'). */
    awardFacts?: { kidName: string; kidFirst: string; points: number; kind: string; category: string; byFirst: string; dateLabel: string; reason: string; week: { emoji: string; label: string; points: number; category: string }[] };
    detail?: 'heat' | 'totals';
  };
  inapp?: {
    on: boolean; sent: boolean;
    to: { uid: string; name: string; role: string }[];
    /** The bell card verbatim (D8) — what each recipient saw. */
    title?: string; message?: string;
  };
  chat?: { on: boolean; sent: boolean; text: string };
  whatsapp?: { on: boolean; status?: string };
}

export interface AlertLogEntry {
  id: string;
  kind: 'alert' | 'recovered' | 'kid_reward' | 'kid_digest' | 'kid_statement' | 'storage_quota' | 'points_email'
    // HP2 (2026-08-23) — helper performance emails: weekly report,
    // daily digest, and a kid's review-done note to parents.
    | 'helper_weekly' | 'helper_daily' | 'kid_review';
  /** HP2 — ISO week key on helper_weekly / kid_review entries. */
  weekKey?: string;
  /** HP2 kid_review — which helper was reviewed. */
  helperName?: string;
  /** 🔥 Points Emails 2.0 — which audience tier a 'points_email' row was. */
  tier?: 'family' | 'outside';
  ratingId?: string;
  awardId?: string;
  // ── meter fields (kinds 'alert' / 'recovered') ──
  meterId?: string;
  meterLabel?: string;
  meterType?: string;
  unit?: string;
  firedAt: number;                       // ms epoch
  trigger: 'reading' | 'sweep' | 'reward' | 'digest' | 'statement' | 'system' | 'rating' | 'award';
  balance?: number;
  threshold?: number;
  // ── kid fields (kinds 'kid_reward' / 'kid_digest', KID PR2/PR3) ──
  childId?: string;
  childName?: string;
  /** Where the kid's address resolved from (kid profile / parent / contact). */
  sourceLabel?: string;
  daysLeft?: number | null;
  forecastDays?: number;
  requestId?: string;
  requestName?: string;
  amountCents?: number;
  currency?: string;
  /** Which cascade level resolved the recipients (D11). 'category'/'item'
   *  start appearing with the VIS PR3/PR4 recipient cascade. */
  resolvedBy?: 'global' | 'category' | 'item';
  channels?: AlertLogChannels;
}

/** Last ~120 entries, newest first. Parent-only (the route enforces it). */
export async function fetchAlertLog(token: string): Promise<AlertLogEntry[]> {
  const res = await fetch('/api/household/alert-log', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { entries?: AlertLogEntry[] };
  return data.entries ?? [];
}
