// Create / update / delete a reminder, plus the kid-shared parent-nod
// (approve / decline). Admin SDK — no rules deploy needed (see lib/reminders
// header). One route, switched on `action`:
//   • save     — create (no id) or update (with id). Owner or a parent may
//                edit. A KID creating/flipping a SHARED event lands as
//                `pending_parent` (parents get a 🔔 to approve); private kid
//                events and anything an adult creates are `active`.
//   • delete   — owner or parent removes the event.
//   • approve  — parent flips a kid's pending shared event to active.
//   • decline  — parent reverts the share request to private (kept, not shared).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type {
  ReminderEvent, ReminderType, ReminderVisibility, RepeatRule,
  ReminderRecipient, ReminderChannels, ReminderStatus, MonthDay,
} from '@/lib/reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: ReminderType[] = ['birthday', 'anniversary', 'appointment', 'event', 'reminder'];
const FREQS = ['none', 'daily', 'weekly', 'monthly', 'yearly', 'custom'];

function clampStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function sanitizeRepeat(raw: unknown): RepeatRule {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const freq = FREQS.includes(r.freq as string) ? (r.freq as RepeatRule['freq']) : 'none';
  const out: RepeatRule = { freq };
  if (freq === 'weekly' && Array.isArray(r.weekdays)) {
    out.weekdays = (r.weekdays as unknown[]).map(Number).filter((n) => n >= 0 && n <= 6);
  }
  if (freq === 'monthly' && Array.isArray(r.monthDays)) {
    out.monthDays = (r.monthDays as unknown[])
      .map((d) => (d === 'last' ? 'last' : Number(d)))
      .filter((d) => d === 'last' || (typeof d === 'number' && d >= 1 && d <= 31)) as MonthDay[];
  }
  if (freq === 'custom') {
    out.customCount = Math.max(1, Math.min(30, Number(r.customCount) || 1));
    out.customPer = r.customPer === 'month' ? 'month' : 'week';
  }
  const end = (r.end && typeof r.end === 'object' ? r.end : {}) as Record<string, unknown>;
  const mode = ['never', 'on', 'after'].includes(end.mode as string) ? (end.mode as 'never' | 'on' | 'after') : 'never';
  if (mode === 'on' && /^\d{4}-\d{2}-\d{2}$/.test(String(end.onDate))) {
    out.end = { mode, onDate: String(end.onDate) };
  } else if (mode === 'after') {
    out.end = { mode, afterCount: Math.max(1, Math.min(999, Number(end.afterCount) || 1)) };
  } else {
    out.end = { mode: 'never' };
  }
  return out;
}

function sanitizeRecipients(raw: unknown): ReminderRecipient[] {
  if (!Array.isArray(raw)) return [];
  const re = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const out: ReminderRecipient[] = [];
  for (const item of raw.slice(0, 20)) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const email = clampStr(r.email, 160).trim().toLowerCase();
    if (!re.test(email)) continue;
    // Build with NO undefined fields — Firestore Admin .add()/.set() throws
    // on any undefined value ("Cannot use 'undefined' as a Firestore
    // value"), which 500'd every reminder with an external recipient (no
    // uid). Only include uid/name when present.
    const rec: ReminderRecipient = { kind: r.kind === 'member' ? 'member' : 'external', email };
    if (typeof r.uid === 'string' && r.uid) rec.uid = r.uid;
    const nm = clampStr(r.name, 80);
    if (nm) rec.name = nm;
    out.push(rec);
  }
  return out;
}

/** Recursively drop undefined values so nothing illegal reaches Firestore
 *  (.add()/.set() reject undefined). Preserves FieldValue sentinels +
 *  arrays. Belt-and-suspenders around the sanitizers above. */
function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => pruneUndefined(v)) as unknown as T;
  if (value && typeof value === 'object' && (value as object).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = pruneUndefined(v);
    }
    return out as unknown as T;
  }
  return value;
}

function sanitizeChannels(raw: unknown): ReminderChannels {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    inApp: c.inApp !== false,
    email: !!c.email,
    whatsapp: false, // designed-in, not yet live
  };
}

function sanitizeLeadDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [0];
  const days = Array.from(new Set(
    (raw as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 60),
  )).sort((a, b) => a - b);
  return days.length ? days : [0];
}

async function notify(
  db: FirebaseFirestore.Firestore,
  familyId: string,
  forUserId: string,
  payload: { type: string; title: string; message: string; link: string },
): Promise<void> {
  try {
    await db.collection('families').doc(familyId).collection('notifications').add({
      ...payload, read: false, forUserId, createdAt: FieldValue.serverTimestamp(),
    });
  } catch { /* swallow — bell is best-effort */ }
}

async function parentUids(db: FirebaseFirestore.Firestore, familyId: string): Promise<string[]> {
  const snap = await db.collection('users').where('familyId', '==', familyId).where('role', '==', 'parent').get();
  return snap.docs.map((d) => d.id);
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: { action?: string; event?: Record<string, unknown>; id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const action = body.action || 'save';

  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.data() as { familyId?: string; role?: string; displayName?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  const role = (user?.role || 'parent') as 'parent' | 'helper' | 'kid';
  const col = db.collection('families').doc(familyId).collection('reminders');

  // ── delete ──────────────────────────────────────────────────────────
  if (action === 'delete') {
    const id = clampStr(body.id, 200);
    if (!id) return NextResponse.json({ error: 'bad-id' }, { status: 400 });
    const ref = col.doc(id);
    const cur = (await ref.get()).data() as ReminderEvent | undefined;
    if (!cur) return NextResponse.json({ ok: true });
    if (cur.ownerUid !== uid && role !== 'parent') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    await ref.delete();
    return NextResponse.json({ ok: true });
  }

  // ── approve / decline (parent only) ──────────────────────────────────
  if (action === 'approve' || action === 'decline') {
    if (role !== 'parent') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const id = clampStr(body.id, 200);
    const ref = col.doc(id);
    const cur = (await ref.get()).data() as ReminderEvent | undefined;
    if (!cur) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    if (action === 'approve') {
      await ref.update({ status: 'active' as ReminderStatus, updatedAt: Date.now() });
      await notify(db, familyId, cur.ownerUid, {
        type: 'reminder', title: '✅ Reminder shared',
        message: `A parent approved sharing "${cur.title}" with the family.`, link: '/reminders',
      });
    } else {
      await ref.update({ visibility: 'private' as ReminderVisibility, status: 'active' as ReminderStatus, updatedAt: Date.now() });
      await notify(db, familyId, cur.ownerUid, {
        type: 'reminder', title: 'Reminder kept private',
        message: `"${cur.title}" stays just for you — a parent didn't share it family-wide.`, link: '/reminders',
      });
    }
    return NextResponse.json({ ok: true });
  }

  // ── save (create or update) ──────────────────────────────────────────
  const ev = (body.event && typeof body.event === 'object' ? body.event : {}) as Record<string, unknown>;
  const title = clampStr(ev.title, 120).trim();
  const date = clampStr(ev.date, 10);
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'title + valid date required' }, { status: 400 });
  }
  const type = TYPES.includes(ev.type as ReminderType) ? (ev.type as ReminderType) : 'reminder';
  const visibility: ReminderVisibility = ev.visibility === 'private' ? 'private' : 'shared';
  const repeat = sanitizeRepeat(ev.repeat);
  const channels = sanitizeChannels(ev.channels);
  const emailRecipients = channels.email ? sanitizeRecipients(ev.emailRecipients) : [];
  const leadDays = sanitizeLeadDays(ev.leadDays);
  const timeRaw = clampStr(ev.time, 5);
  const time = /^\d{2}:\d{2}$/.test(timeRaw) ? timeRaw : undefined;
  // v4 — optional origin date (DOB / wedding day) powering "Nth Birthday".
  // Only meaningful on birthday/anniversary; silently dropped elsewhere.
  const originRaw = clampStr(ev.originDate, 10);
  const originDate = (type === 'birthday' || type === 'anniversary') && /^\d{4}-\d{2}-\d{2}$/.test(originRaw)
    ? originRaw
    : undefined;

  const base = {
    type, title, date,
    // Only set `time` when present. NEVER put FieldValue.delete() here — it's
    // illegal inside .add() (create) and throws a 500 when creating an event
    // with no time. Clearing a previously-set time on EDIT is handled in the
    // update branch below.
    ...(time ? { time } : {}),
    // Same create-vs-edit contract as `time`: only set when present here;
    // clearing on edit is a FieldValue.delete() in the update branch.
    ...(originDate ? { originDate } : {}),
    withWho: clampStr(ev.withWho, 120),
    location: clampStr(ev.location, 160),
    note: clampStr(ev.note, 500),
    visibility,
    repeat,
    leadDays,
    channels,
    emailRecipients,
    updatedAt: Date.now(),
  };

  // Kid creating/flipping a SHARED event → needs a parent nod.
  const needsNod = role === 'kid' && visibility === 'shared';
  const status: ReminderStatus = needsNod ? 'pending_parent' : 'active';

  const editId = clampStr(body.id || (ev.id as string), 200);
  if (editId) {
    const ref = col.doc(editId);
    const cur = (await ref.get()).data() as ReminderEvent | undefined;
    if (!cur) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    if (cur.ownerUid !== uid && role !== 'parent') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    // Preserve owner; recompute status only when the editor is the kid owner.
    const nextStatus = (cur.ownerRole === 'kid' && cur.ownerUid === uid) ? status : (cur.status || 'active');
    // Clear a previously-set time when the editor removed it (legal on a
    // merge:true set, unlike create).
    await ref.set(
      pruneUndefined({ ...base, ...(time ? {} : { time: FieldValue.delete() }), ...(originDate ? {} : { originDate: FieldValue.delete() }), status: nextStatus, firedKeys: cur.firedKeys || [] }),
      { merge: true },
    );
    if (nextStatus === 'pending_parent') {
      for (const pid of await parentUids(db, familyId)) {
        await notify(db, familyId, pid, {
          type: 'reminder', title: '👶 Share request',
          message: `${user?.displayName || 'Your kid'} wants to share "${title}" with the family. Approve in Reminders.`,
          link: '/reminders',
        });
      }
    }
    return NextResponse.json({ event: { id: editId, ...base, status: nextStatus }, pending: nextStatus === 'pending_parent' });
  }

  // Create
  const doc = await col.add(pruneUndefined({
    ...base,
    ownerUid: uid,
    ownerName: user?.displayName || '',
    ownerRole: role,
    status,
    firedKeys: [],
    createdAt: Date.now(),
  }));
  if (status === 'pending_parent') {
    for (const pid of await parentUids(db, familyId)) {
      await notify(db, familyId, pid, {
        type: 'reminder', title: '👶 Share request',
        message: `${user?.displayName || 'Your kid'} wants to share "${title}" with the family. Approve in Reminders.`,
        link: '/reminders',
      });
    }
  }
  return NextResponse.json({ event: { id: doc.id, ...base, ownerUid: uid, ownerRole: role, status }, pending: status === 'pending_parent' });
}
