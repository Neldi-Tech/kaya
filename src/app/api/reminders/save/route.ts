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
  ReminderRecipient, ReminderChannels, ReminderStatus, MonthDay, GreetTo,
  CareInfo, CareSlot, CareDuration, CareDurationMode, DoseEntry, DoseStatus,
} from '@/lib/reminders';
import { normalizeWhatsapp, isCareType, slotIcon, addDaysKey } from '@/lib/reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: ReminderType[] = ['birthday', 'anniversary', 'appointment', 'event', 'reminder', 'medicine', 'routine'];
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

/** ✉️ 2.0 — the honoree. Only for 🎂/💍/🎉; built with NO undefined keys. */
function sanitizeGreetTo(raw: unknown, type: ReminderType): GreetTo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (type !== 'birthday' && type !== 'anniversary' && type !== 'event') return undefined;
  const g = raw as Record<string, unknown>;
  const name = clampStr(g.name, 80).trim();
  if (!name) return undefined;
  const rel = g.relationship === 'adult' || g.relationship === 'kid-friend' ? g.relationship : 'family';
  const out: GreetTo = { name, relationship: rel, autoSend: false, ccParents: rel !== 'family' && g.ccParents !== false };
  const cid = clampStr(g.contactId, 80); if (cid) out.contactId = cid;
  const mu = clampStr(g.memberUid, 128); if (mu) out.memberUid = mu;
  const ch = clampStr(g.childId, 128); if (ch) out.childId = ch;
  const email = clampStr(g.email, 160).trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) out.email = email;
  if (Array.isArray(g.emails)) {
    const re = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    const list = Array.from(new Set((g.emails as unknown[]).map((e) => clampStr(e, 160).trim().toLowerCase()).filter((e) => re.test(e)))).slice(0, 6);
    if (list.length) { out.emails = list; if (!out.email) out.email = list[0]; }
  }
  const wa = normalizeWhatsapp(clampStr(g.whatsapp, 32)); if (wa) out.whatsapp = wa;
  const tz = clampStr(g.timezone, 64); if (tz && /^[A-Za-z_]+\/[A-Za-z_\/+-]+$/.test(tz)) out.timezone = tz;
  // autoSend needs an email and an outside honoree.
  out.autoSend = rel !== 'family' && !!out.email && g.autoSend !== false;
  return out;
}

// ── 💊 v5 Care — sanitizer + dose-time helpers ─────────────────────────────

/** Care block for medicine/routine. Built with NO undefined keys. */
function sanitizeCare(raw: unknown, type: ReminderType): CareInfo | undefined {
  if (!isCareType(type)) return undefined;
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const slots: CareSlot[] = [];
  for (const s of (Array.isArray(c.slots) ? c.slots : []).slice(0, 6)) {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const t = clampStr(o.time, 5);
    if (/^\d{2}:\d{2}$/.test(t)) slots.push({ time: t, icon: slotIcon(t) });
  }
  if (!slots.length) slots.push({ time: '07:00', icon: slotIcon('07:00') });
  slots.sort((a, b) => (a.time < b.time ? -1 : 1));

  const d = (c.duration && typeof c.duration === 'object' ? c.duration : {}) as Record<string, unknown>;
  const mode: CareDurationMode = d.mode === 'until' || d.mode === 'ongoing' ? d.mode : 'days';
  let duration: CareDuration;
  if (mode === 'ongoing') duration = { mode: 'ongoing' };
  else if (mode === 'until' && /^\d{4}-\d{2}-\d{2}$/.test(String(d.until))) duration = { mode: 'until', until: String(d.until) };
  else duration = { mode: 'days', days: Math.max(1, Math.min(365, Math.round(Number(d.days)) || 7)) };

  const forKind = c.forKind === 'self' ? 'self' as const : 'kid' as const;
  const out: CareInfo = {
    dose: clampStr(c.dose, 80).trim() || (type === 'medicine' ? '1 dose' : 'once'),
    slots, duration, forKind,
    giverUids: Array.isArray(c.giverUids)
      ? Array.from(new Set((c.giverUids as unknown[]).filter((u): u is string => typeof u === 'string' && !!u))).slice(0, 6)
      : [],
    watchInApp: c.watchInApp !== false,
    watchSummaryEmail: c.watchSummaryEmail !== false,
    watchMissedEmail: c.watchMissedEmail !== false,
  };
  const childId = clampStr(c.forChildId, 128);
  if (forKind === 'kid' && childId) out.forChildId = childId;
  const forName = clampStr(c.forName, 80).trim();
  if (forName) out.forName = forName;
  if (c.withFood === true) out.withFood = true;
  const photo = clampStr(c.photoUrl, 1024);
  if (/^https:\/\//.test(photo)) out.photoUrl = photo;
  const label = clampStr(c.labelName, 120).trim();
  if (label) out.labelName = label;
  const pack = Math.round(Number(c.packCount));
  if (Number.isFinite(pack) && pack >= 1 && pack <= 999) out.packCount = pack;
  return out;
}

/** Care schedules drive the existing recurrence engine: daily, ending with
 *  the course (so day-8 of a 7-day course simply never occurs). */
function careRepeat(date: string, care: CareInfo): RepeatRule {
  const d = care.duration;
  if (d.mode === 'ongoing') return { freq: 'daily', end: { mode: 'never' } };
  const last = d.mode === 'until' && d.until ? d.until : addDaysKey(date, Math.max(1, d.days || 1) - 1);
  return { freq: 'daily', end: { mode: 'on', onDate: last } };
}

/** Kaya's reference TZ (matches the reminders cron) — dose lateness is
 *  measured in local family time, never UTC. */
const CARE_TZ = 'Africa/Dar_es_Salaam';
function nowInTZ(tz: string): { dayKey: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  const hour = parseInt(get('hour'), 10) % 24; // 'en-CA' may emit "24" at midnight
  return { dayKey: `${get('year')}-${get('month')}-${get('day')}`, minutes: hour * 60 + parseInt(get('minute'), 10) };
}
const slotMinutes = (t: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
};
/** Grace window after a slot before a tick counts as "late". */
const LATE_AFTER_MIN = 60;
/** Rolling cap on the dose trail (~90 days × 3 slots). */
const DOSE_LOG_CAP = 270;

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
  const user = userSnap.data() as { familyId?: string; role?: string; displayName?: string; childId?: string } | undefined;
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

  // ── 💊 dose — tick a care slot (v5) ───────────────────────────────────
  // Giver/parent records given|skipped (server stamps late honestly, local
  // family time); a kid may only add a 💪 brave tap — never the record.
  if (action === 'dose') {
    const b = body as unknown as { id?: string; dateKey?: string; slotIndex?: unknown; status?: string; brave?: unknown };
    const id = clampStr(b.id, 200);
    const dateKey = clampStr(b.dateKey, 10);
    const slotIndex = Math.max(0, Math.min(9, Math.round(Number(b.slotIndex)) || 0));
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return NextResponse.json({ error: 'bad-dose' }, { status: 400 });
    const ref = col.doc(id);
    const cur = (await ref.get()).data() as ReminderEvent | undefined;
    if (!cur || !cur.care || !isCareType(cur.type)) return NextResponse.json({ error: 'not-care' }, { status: 404 });
    if (slotIndex >= cur.care.slots.length) return NextResponse.json({ error: 'bad-slot' }, { status: 400 });

    const key = `${dateKey}:${slotIndex}`;
    const log: DoseEntry[] = (cur.doseLog || []).slice();
    const idx = log.findIndex((d) => d.key === key);

    if (b.brave === true) {
      if (role !== 'kid' || !user?.childId || cur.care.forChildId !== user.childId) {
        return NextResponse.json({ error: 'brave-is-for-the-kid' }, { status: 403 });
      }
      const entry: DoseEntry = idx >= 0 ? { ...log[idx] } : { key };
      entry.braveUids = Array.from(new Set([...(entry.braveUids || []), uid]));
      if (idx >= 0) log[idx] = entry; else log.push(entry);
      await ref.update({ doseLog: log.slice(-DOSE_LOG_CAP), updatedAt: Date.now() });
      return NextResponse.json({ ok: true, entry });
    }

    const isGiver = role === 'parent' || (cur.care.giverUids || []).includes(uid);
    if (!isGiver) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const raw: DoseStatus = b.status === 'skipped' ? 'skipped' : 'given';
    const now = nowInTZ(CARE_TZ);
    const late = raw === 'given'
      && (dateKey < now.dayKey || (dateKey === now.dayKey && now.minutes > slotMinutes(cur.care.slots[slotIndex].time) + LATE_AFTER_MIN));
    const entry: DoseEntry = {
      ...(idx >= 0 ? log[idx] : {}),
      key,
      status: raw === 'given' ? (late ? 'late' : 'given') : 'skipped',
      byUid: uid,
      byName: user?.displayName || '',
      at: Date.now(),
    };
    if (idx >= 0) log[idx] = entry; else log.push(entry);
    await ref.update({ doseLog: log.slice(-DOSE_LOG_CAP), updatedAt: Date.now() });

    // 👀 Watch rail — real-time in-app tick to the (other) parents.
    if (cur.care.watchInApp !== false && cur.care.forKind === 'kid') {
      const slot = cur.care.slots[slotIndex];
      const who = cur.care.forName || cur.title;
      const line = entry.status === 'skipped'
        ? `⏭ ${slot.icon || ''} dose skipped — ${who}`
        : `✓ ${slot.icon || ''} dose ${entry.status === 'late' ? 'given late' : 'given'} — ${who}`;
      for (const pid of await parentUids(db, familyId)) {
        if (pid === uid) continue;
        await notify(db, familyId, pid, {
          type: 'reminder', title: line,
          message: `${cur.care.dose} · by ${user?.displayName || 'a caregiver'}`,
          link: '/reminders',
        });
      }
    }
    return NextResponse.json({ ok: true, entry });
  }

  // ── save (create or update) ──────────────────────────────────────────
  const ev = (body.event && typeof body.event === 'object' ? body.event : {}) as Record<string, unknown>;
  const title = clampStr(ev.title, 120).trim();
  const date = clampStr(ev.date, 10);
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'title + valid date required' }, { status: 400 });
  }
  const type = TYPES.includes(ev.type as ReminderType) ? (ev.type as ReminderType) : 'reminder';

  // 💊 v5 — care types are parent-authored, carry a care block, and DERIVE
  // their repeat (daily, course-bounded) + visibility (self → private by
  // default; kid → shared-with-caregivers) + channels (dose engine owns
  // notifications, not the classic email rail).
  const care = sanitizeCare(ev.care, type);
  if (isCareType(type)) {
    if (role !== 'parent') return NextResponse.json({ error: 'care-is-parents-only' }, { status: 403 });
    if (care!.forKind === 'kid' && !care!.forChildId) {
      return NextResponse.json({ error: 'care-for-child-required' }, { status: 400 });
    }
  }

  const visibility: ReminderVisibility = isCareType(type)
    ? (care!.forKind === 'self' ? (ev.visibility === 'shared' ? 'shared' : 'private') : 'shared')
    : (ev.visibility === 'private' ? 'private' : 'shared');
  const repeat = isCareType(type) ? careRepeat(date, care!) : sanitizeRepeat(ev.repeat);
  const channels = isCareType(type) ? { inApp: true, email: false, whatsapp: false } : sanitizeChannels(ev.channels);
  const emailRecipients = channels.email ? sanitizeRecipients(ev.emailRecipients) : [];
  const leadDays = isCareType(type) ? [0] : sanitizeLeadDays(ev.leadDays);
  const timeRaw = clampStr(ev.time, 5);
  const time = /^\d{2}:\d{2}$/.test(timeRaw) ? timeRaw : undefined;
  // v4 — optional origin date (DOB / wedding day) powering "Nth Birthday".
  // Only meaningful on birthday/anniversary; silently dropped elsewhere.
  const originRaw = clampStr(ev.originDate, 10);
  const originDate = (type === 'birthday' || type === 'anniversary') && /^\d{4}-\d{2}-\d{2}$/.test(originRaw)
    ? originRaw
    : undefined;
  const greetTo = sanitizeGreetTo(ev.greetTo, type);

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
    // ✉️ 2.0 honoree — same create-vs-edit contract.
    ...(greetTo ? { greetTo } : {}),
    // 💊 v5 care block — same create-vs-edit contract.
    ...(care ? { care } : {}),
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
      pruneUndefined({ ...base, ...(time ? {} : { time: FieldValue.delete() }), ...(originDate ? {} : { originDate: FieldValue.delete() }), ...(greetTo ? {} : { greetTo: FieldValue.delete() }), ...(care || !cur.care ? {} : { care: FieldValue.delete(), doseLog: FieldValue.delete() }), status: nextStatus, firedKeys: cur.firedKeys || [] }),
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
