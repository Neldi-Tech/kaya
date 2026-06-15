// Kaya Pulse · Per-parent daily morning brief settings + pure helpers.
// PR 5 / v2. Settings live on the user's own doc under `pulseBrief`:
//   { enabled, time: 'HH:MM' (24h), channels: [...], includes: [...] }
// The cron at /api/cron/pulse-brief reads them every 30 minutes, dispatches
// to whichever parents are due, and idempotently logs the firing.

export type PulseBriefChannel = 'email' | 'push' | 'whatsapp';
export type PulseBriefIncludeKey =
  | 'lowBalances'
  | 'allBalances'
  | 'todayAllowance'
  | 'vsLastMonth'
  | 'askKaya'
  | 'pendingApprovals';

export interface PulseBriefSettings {
  enabled: boolean;
  /** 24-hour HH:MM (Africa/Dar_es_Salaam) — when the brief fires. */
  time: string;
  channels: PulseBriefChannel[];
  includes: PulseBriefIncludeKey[];
  /** Audit + idempotency for the cron — last successful firing dayKey. */
  lastFiredOn?: string;
  updatedAt?: number;
}

export const DEFAULT_BRIEF_SETTINGS: PulseBriefSettings = {
  enabled: false,
  time: '08:00',
  channels: ['email', 'push'],
  includes: ['lowBalances', 'allBalances', 'todayAllowance', 'vsLastMonth', 'askKaya'],
};

export const QUICK_TIMES = ['06:30', '07:00', '08:00', '12:00', '21:00'] as const;

export const INCLUDE_META: Record<PulseBriefIncludeKey, { emoji: string; label: string }> = {
  lowBalances: { emoji: '🔋', label: 'Low unit balances (1-2 days)' },
  allBalances: { emoji: '⚡', label: 'All meter balances' },
  todayAllowance: { emoji: '💰', label: "Today's allowance pocket" },
  vsLastMonth: { emoji: '📈', label: 'vs last month at this point' },
  askKaya: { emoji: '🤖', label: '1-line Ask Kaya nudge' },
  pendingApprovals: { emoji: '📋', label: 'Pending approvals' },
};

export const CHANNEL_META: Record<PulseBriefChannel, { emoji: string; label: string }> = {
  email: { emoji: '✉️', label: 'Email' },
  push: { emoji: '🔔', label: 'Push' },
  whatsapp: { emoji: '💬', label: 'WhatsApp' },
};

/** "08:00" → 480 (minutes since midnight). Returns NaN for bad input. */
export function timeStrToMinutes(hhmm: string): number {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return NaN;
  const [h, m] = hhmm.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return NaN;
  return h * 60 + m;
}

/** Returns true when this minute-of-day is within [target, target + windowMin).
 *  Used by the 30-minute cron so a target like 08:15 is caught by the 08:00 run. */
export function withinFiringWindow(targetMin: number, nowMin: number, windowMin: number): boolean {
  if (!Number.isFinite(targetMin)) return false;
  return nowMin >= targetMin && nowMin < targetMin + windowMin;
}

/** Render "08:00" → "8:00 AM" for display. */
export function formatTime12h(hhmm: string): string {
  const min = timeStrToMinutes(hhmm);
  if (!Number.isFinite(min)) return hhmm;
  const h = Math.floor(min / 60);
  const m = min % 60;
  const am = h < 12;
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
}
