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

export interface AlertLogChannels {
  email?: {
    on: boolean; sent: boolean; error?: string;
    to: { name: string; email: string }[];
    subject: string;
    templateVersion: number;
    facts: AlertLogEmailFacts;
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
  kind: 'alert' | 'recovered';
  meterId: string;
  meterLabel: string;
  meterType?: string;
  unit?: string;
  firedAt: number;                       // ms epoch
  trigger: 'reading' | 'sweep';
  balance: number;
  threshold: number;
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
