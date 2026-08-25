// Timeline 2.0 · 💌 Send-to-Someone client (design v2 innovation #6).
//
// Thin caller for POST /api/sparks/note-send. The server re-reads the
// note from the journal (client text is never trusted), checks the
// kid-approval pass, honours People-Book opt-outs, mints the /n/{token}
// reply link, emails via Resend and traces to alertLog.

async function idToken(): Promise<string> {
  const { auth } = await import('./firebase');
  const u = auth.currentUser;
  if (!u) throw new Error('Sign in first');
  return u.getIdToken();
}

export async function sendNoteToSomeone(payload: {
  kidId: string;
  surface: 'reflection' | 'diary';
  date: string;
  contactId: string;
  kidName: string;
  surfaceLabel: string;
  dateLabel: string;
  theme: string;
}): Promise<{ ok: true; to: string[]; publicUrl: string }> {
  const token = await idToken();
  const res = await fetch('/api/sparks/note-send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'send', ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `request-failed-${res.status}`);
  return data as { ok: true; to: string[]; publicUrl: string };
}

// ── 📖 Kaya Writes · Month Story ───────────────────────────────────

export interface MonthStoryResult {
  story: string | null;
  generatedAt?: number | null;
  skipped?: boolean;
  reason?: string;
}

async function monthStoryApi(payload: Record<string, unknown>): Promise<MonthStoryResult> {
  const token = await idToken();
  const res = await fetch('/api/sparks/ai/month-story', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `request-failed-${res.status}`);
  return data as MonthStoryResult;
}

/** Cached story only — never triggers a generation. */
export const getMonthStory = (p: { kidId: string; surface: 'reflection' | 'diary'; monthKey: string }) =>
  monthStoryApi({ action: 'get', ...p });

/** Generate (cache-first; `force` = parents-only regenerate). */
export const writeMonthStory = (p: {
  kidId: string; surface: 'reflection' | 'diary'; monthKey: string;
  lang?: 'en' | 'sw'; force?: boolean;
}) => monthStoryApi({ action: 'write', ...p });
