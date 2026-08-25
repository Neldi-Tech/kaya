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
