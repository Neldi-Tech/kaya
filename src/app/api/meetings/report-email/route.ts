// POST { meetingId } — email ME this meeting's report (SM3.1 · #5a).
//
// Sends a one-page HTML report of a PAST meeting to the requesting parent's
// own email. Auth: Firebase ID token; requester must be a parent of the
// meeting's family. Admin SDK reads; Resend sends; no data is modified.
// Deliberately self-contained (separate from the live post-meeting Recap
// Book email, which needs presenter state).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { Resend } from 'resend';

export const runtime = 'nodejs';

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const resend = apiKey ? new Resend(apiKey) : null;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  const dow = DAY_ABBR[new Date(y, m - 1, d).getDay()];
  return `${dow} · ${String(d).padStart(2, '0')}-${MONTH_ABBR[m - 1]}-${y}`;
}

const OPENING_LABEL: Record<string, string> = {
  prayer: '🙏 Prayer', wisdom: '💡 Word of wisdom', verse: '📖 Verse', own: '🗣️ Own words',
};

function section(title: string, bodyHtml: string): string {
  if (!bodyHtml.trim()) return '';
  return `<div style="margin-top:16px"><div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#8a6d3b">${title}</div><div style="font-size:13.5px;color:#26303B;margin-top:4px;line-height:1.55">${bodyHtml}</div></div>`;
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });
  if (!resend) return NextResponse.json({ error: 'email-unconfigured' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: { meetingId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const meetingId = typeof body.meetingId === 'string' ? body.meetingId : '';
  if (!meetingId) return NextResponse.json({ error: 'bad-args' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; email?: string; displayName?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId || user?.role !== 'parent') return NextResponse.json({ error: 'parent-only' }, { status: 403 });
  const toEmail = user?.email;
  if (!toEmail) return NextResponse.json({ error: 'no-email' }, { status: 400 });

  const famRef = db.collection('families').doc(familyId);
  const meetingSnap = await famRef.collection('meetings').doc(meetingId).get();
  if (!meetingSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const m = meetingSnap.data() as Record<string, any>;

  // Name lookups — kids by children docs, adults by users.
  const [childrenSnap, usersSnap] = await Promise.all([
    famRef.collection('children').get(),
    db.collection('users').where('familyId', '==', familyId).get(),
  ]);
  const kidName = new Map<string, string>();
  childrenSnap.forEach((d) => kidName.set(d.id, String(d.data()?.name || 'Kiddo')));
  const adultName = new Map<string, string>();
  usersSnap.forEach((d) => adultName.set(d.id, String(d.data()?.displayName || 'Family member')));

  const kids = (Array.isArray(m.attendees) ? m.attendees : []).map((id: string) => kidName.get(id) || null).filter(Boolean);
  const parents = (Array.isArray(m.parentAttendees) ? m.parentAttendees : []).map((id: string) => adultName.get(id) || null).filter(Boolean);
  const guests = (Array.isArray(m.guestAttendees) ? m.guestAttendees : [])
    .map((g: { name?: string; relationship?: string }) => g?.name ? `${g.name}${g.relationship ? ` (${g.relationship})` : ''}` : null)
    .filter(Boolean);

  const perKid = (rec: Record<string, string> | undefined) =>
    Object.entries(rec || {})
      .filter(([, v]) => (v || '').trim())
      .map(([cid, v]) => `<div>• <b>${esc(kidName.get(cid) || 'Someone')}</b>: ${esc(v)}</div>`)
      .join('');

  const goalsHtml = Object.entries((m.goals || {}) as Record<string, string>)
    .filter(([, v]) => (v || '').trim())
    .map(([cid, v]) => {
      const done = (m.goalsDone || {})[cid] === true;
      return `<div>• <b>${esc(kidName.get(cid) || 'Someone')}</b>: ${esc(v)} ${done ? '<span style="color:#3E8E45;font-weight:800">✓ done</span>' : ''}</div>`;
    }).join('');

  const reflection = m.reflection || {};
  const reflectionHtml = (Array.isArray(reflection.modes) ? reflection.modes : [])
    .map((mode: string) => {
      const txt = (reflection.contents || {})[mode] || '';
      return `<div>• <b>${esc(mode)}</b>${txt ? `: ${esc(txt)}` : ''}</div>`;
    }).join('');

  const opening = m.openingWord
    ? `${OPENING_LABEL[m.openingWord.mode] || m.openingWord.mode}${m.openingWord.note ? ` — ${esc(m.openingWord.note)}` : ''}`
    : '';

  const html = `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:560px;margin:0 auto;padding:18px">
    <div style="border-radius:16px;padding:22px 18px;color:#fff;background:linear-gradient(135deg,#241a12,#3a2a18)">
      <div style="font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#E8B54A">📖 Kaya · Meeting Report</div>
      <div style="font-size:21px;font-weight:900;margin-top:4px">${esc(fmtDay(String(m.date || '')))}</div>
      <div style="font-size:12px;opacity:.85;margin-top:2px">${m.type === 'kid-led' ? '🧒 Kid-led' : '👨‍👩‍👧‍👦 Weekly'} · 🟢 held &amp; closed</div>
    </div>
    ${section('👋 Attendance', [
      kids.length ? `Kids: ${kids.map((k) => esc(String(k))).join(', ')}` : '',
      parents.length ? `Parents: ${parents.map((p) => esc(String(p))).join(', ')}` : '',
      guests.length ? `Guests: ${guests.map((g) => esc(String(g))).join(', ')}` : '',
    ].filter(Boolean).join('<br/>'))}
    ${section('🙏 Opening Word', opening)}
    ${section('🙏 Gratitude', perKid(m.gratitude))}
    ${section('💛 Appreciations', perKid(m.appreciations))}
    ${section('🎯 Goals set', goalsHtml)}
    ${section('✨ Closing reflection', reflectionHtml)}
    ${section('📝 Notes', m.notes ? esc(String(m.notes)) : '')}
    <div style="font-size:11px;color:#8a8f98;margin-top:22px;text-align:center">Sent to you by Kaya · requested from Past meetings</div>
  </div>`;

  await resend.emails.send({
    from: FROM,
    to: [toEmail],
    subject: `📖 Meeting Report — ${fmtDay(String(m.date || ''))}`,
    html,
  });

  return NextResponse.json({ ok: true });
}
