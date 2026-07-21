// Admin-SDK gateway for Kaya Sparks · Daily Reflection.
//
// WHY THIS EXISTS: the `sparks_reflections` Firestore rules block is in the
// repo (firestore.rules) but is NOT deployed to prod — the Firebase CLI auth
// is expired, so the rule that lets a kid write/read their own reflection
// never reached the live project. Result: kids hit "Missing or insufficient
// permissions" the moment they save a scanned reflection (the Storage upload
// of the scan succeeds — that path's rule IS deployed — but the Firestore
// write + the read subscriptions are denied). Rather than block on a rules
// deploy, this route does the read/write with the Admin SDK (bypasses rules)
// after verifying the caller's Firebase ID token — the same pattern Kaya
// already uses for group-chat resolve, birthdays, and reminders.
//
// Authorisation mirrors the intended firestore.rules:
//   • write (save / airead / feedback): a PARENT in the family, or the KID
//     who owns the reflection (kid-owner resolved robustly because childId
//     can be an empty string — see feedback_kid_owner_resolution). Kids may
//     only write a recent day (today ±1, timezone-tolerant) so older history
//     is locked; there is NO delete action, so logged history is always kept.
//   • read (get / list): the above, plus a sibling when the owner's
//     sparks_profiles.sibling_visibility is 'open'.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { dayKeyInTZ } from '@/lib/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Reference timezone for "what day is today" when locking kid history
// (matches Kaya Pulse's daily generators). Reflections are day-granular.
const TZ = 'Africa/Dar_es_Salaam';

type Action = 'get' | 'list' | 'save' | 'airead' | 'feedback' | 'rating' | 'aiscore' | 'refl-visibility-set';

/** Whole-day difference between two YYYY-MM-DD keys (a - b). */
function dayDiff(a: string, b: string): number {
  const pa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a);
  const pb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b);
  if (!pa || !pb) return 9999;
  const ta = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const tb = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.round((ta - tb) / 86_400_000);
}

/** Drop server Timestamps (the reflection UI only uses date/text/source/
 *  feedback/ai_read/scanUrl) so the JSON payload stays clean + serialisable. */
function serialize(data: FirebaseFirestore.DocumentData | undefined): Record<string, unknown> {
  if (!data) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'createdAt' || k === 'updatedAt') continue;
    out[k] = v;
  }
  return out;
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

  let body: {
    action?: Action; kidId?: string; date?: string; text?: string;
    source?: string; scanUrl?: string; feedback?: unknown; ai_read?: unknown;
    ai_score?: unknown; max?: number;
    rating?: {
      stars?: number; soundness_percent?: number; handwriting_percent?: number;
      notes?: string; ratedByName?: string;
    };
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const action: Action = (['get', 'list', 'save', 'airead', 'feedback', 'rating', 'aiscore', 'refl-visibility-set'] as const).includes(body.action as Action) ? (body.action as Action) : 'get';
  const kidId = typeof body.kidId === 'string' ? body.kidId : '';
  if (!kidId) return NextResponse.json({ error: 'bad-kid' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; childId?: string; email?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  const role = user?.role || '';
  const isParent = role === 'parent';

  // Resolve kid ownership robustly — childId can be empty-string, so fall
  // back to matching the child doc by uid / email.
  let isOwnerKid = false;
  if (role === 'kid') {
    if (user?.childId && user.childId === kidId) {
      isOwnerKid = true;
    } else {
      const child = (await db.collection('families').doc(familyId).collection('children').doc(kidId).get()).data() as
        { uid?: string; email?: string } | undefined;
      if (child && (
        (child.uid && child.uid === uid)
        || (child.email && user?.email && child.email.toLowerCase() === user.email.toLowerCase())
      )) isOwnerKid = true;
    }
  }

  const col = db.collection('families').doc(familyId).collection('sparks_reflections');

  // ── Writes (parent or owner kid; rating is parent-only) ────────────────
  if (action === 'save' || action === 'airead' || action === 'feedback' || action === 'rating' || action === 'aiscore') {
    // Slice 8e · a parent-owned reflection is a single-user surface:
    // only that parent writes it; nobody rates it.
    const preOwnerUser = (await db.collection('users').doc(kidId).get()).data() as
      { role?: string; familyId?: string } | undefined;
    if (preOwnerUser?.role === 'parent' && preOwnerUser?.familyId === familyId) {
      if (kidId !== uid) return NextResponse.json({ error: 'owner-only' }, { status: 403 });
      if (action === 'rating') return NextResponse.json({ error: 'not-ratable' }, { status: 403 });
    } else if (action === 'rating') {
      if (!isParent) return NextResponse.json({ error: 'parent-only' }, { status: 403 });
    } else if (!isParent && !isOwnerKid) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : '';
    if (!date) return NextResponse.json({ error: 'bad-date' }, { status: 400 });

    // History is LOCKED for kids: a kid may only write a recent day (today
    // ±1 to tolerate worldwide timezones — the client always sends its own
    // local day). Older entries are immutable. Parents may backfill any date.
    if (!isParent && Math.abs(dayDiff(date, dayKeyInTZ(new Date(), TZ))) > 1) {
      return NextResponse.json({ error: 'history-locked' }, { status: 403 });
    }

    const ref = col.doc(`${kidId}_${date}`);

    if (action === 'feedback') {
      const fb = body.feedback && typeof body.feedback === 'object' ? body.feedback : null;
      if (!fb) return NextResponse.json({ error: 'bad-feedback' }, { status: 400 });
      await ref.set({ feedback: fb, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    if (action === 'airead') {
      const air = body.ai_read && typeof body.ai_read === 'object' ? body.ai_read : null;
      if (!air) return NextResponse.json({ error: 'bad-airead' }, { status: 400 });
      await ref.set({ ai_read: air, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    if (action === 'aiscore') {
      const raw = body.ai_score && typeof body.ai_score === 'object'
        ? body.ai_score as { soundness?: unknown; rationale?: unknown } : null;
      const soundness = raw && typeof raw.soundness === 'number' && isFinite(raw.soundness)
        ? Math.max(0, Math.min(100, Math.round(raw.soundness))) : null;
      if (soundness === null) return NextResponse.json({ error: 'bad-aiscore' }, { status: 400 });
      const rationale = typeof raw?.rationale === 'string' ? raw.rationale.trim().slice(0, 400) : '';
      await ref.set(
        { ai_score: { soundness, rationale }, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      return NextResponse.json({ ok: true });
    }

    if (action === 'rating') {
      const r = body.rating || {};
      const stars = typeof r.stars === 'number' && r.stars >= 1 && r.stars <= 5
        ? Math.round(r.stars) : undefined;
      const pct = (v: unknown): number | undefined =>
        typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : undefined;
      const soundness_percent = pct(r.soundness_percent);
      const handwriting_percent = pct(r.handwriting_percent);
      const notes = typeof r.notes === 'string' ? r.notes.trim().slice(0, 800) : '';
      const ratedByName = typeof r.ratedByName === 'string' && r.ratedByName.trim().length > 0
        ? r.ratedByName.trim().slice(0, 80) : 'Parent';
      if (stars === undefined && soundness_percent === undefined
          && handwriting_percent === undefined && notes.length === 0) {
        return NextResponse.json({ error: 'empty-rating' }, { status: 400 });
      }
      const parent_rating: Record<string, unknown> = {
        ratedBy: uid,
        ratedByName,
        ratedAt: FieldValue.serverTimestamp(),
      };
      if (stars !== undefined)              parent_rating.stars = stars;
      if (soundness_percent !== undefined)  parent_rating.soundness_percent = soundness_percent;
      if (handwriting_percent !== undefined) parent_rating.handwriting_percent = handwriting_percent;
      if (notes.length > 0)                 parent_rating.notes = notes;
      await ref.set({ parent_rating, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    // save
    const existing = await ref.get();
    const prev = existing.data() as { createdBy?: string; createdAt?: unknown } | undefined;
    const data: Record<string, unknown> = {
      kidId,
      date,
      text: String(body.text || '').slice(0, 4000).trim(),
      source: body.source === 'typed' ? 'typed' : 'scan',
      ...(typeof (body as { polished?: string }).polished === 'string' && (body as { polished?: string }).polished!.trim()
        ? { polished: (body as { polished?: string }).polished!.trim().slice(0, 8000) }
        : { polished: FieldValue.delete() }),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: prev?.createdBy || uid,
      createdAt: prev?.createdAt || FieldValue.serverTimestamp(),
    };
    if (typeof body.scanUrl === 'string' && body.scanUrl) data.scanUrl = body.scanUrl;
    await ref.set(data, { merge: true });
    return NextResponse.json({ ok: true });
  }

  // ── Reads (parent · owner kid · sibling when owner visibility 'open') ──
  let canRead = isParent || isOwnerKid;
  if (!canRead && role === 'kid') {
    const prof = (await db.collection('families').doc(familyId).collection('sparks_profiles').doc(kidId).get()).data() as
      { sibling_visibility?: string } | undefined;
    if ((prof?.sibling_visibility || 'open') === 'open') canRead = true;
  }
  if (!canRead) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if (action === 'refl-visibility-set') {
    // Owner parent toggles their reflection between personal / visible.
    const ownerUser2 = (await db.collection('users').doc(kidId).get()).data() as
      { role?: string; familyId?: string } | undefined;
    if (!(ownerUser2?.role === 'parent' && ownerUser2?.familyId === familyId && kidId === uid)) {
      return NextResponse.json({ error: 'parent-owner-only' }, { status: 403 });
    }
    const vis = (body as { visibility?: string }).visibility === 'visible' ? 'visible' : 'personal';
    await db.collection('families').doc(familyId)
      .collection('sparks_diary_private').doc(uid)
      .set({ reflection_visibility: vis }, { merge: true });
    return NextResponse.json({ ok: true, visibility: vis });
  }

  if (action === 'get') {
    const date = typeof body.date === 'string' ? body.date : '';
    const snap = await col.doc(`${kidId}_${date}`).get();
    return NextResponse.json({ entry: snap.exists ? serialize(snap.data()) : null });
  }

  // list
  const snap = await col.where('kidId', '==', kidId).get();
  const rows = snap.docs.map((d) => serialize(d.data()) as { date?: string });
  rows.sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : (a.date || '') > (b.date || '') ? -1 : 0));
  const max = Math.max(1, Math.min(366, Number(body.max) || 60));
  return NextResponse.json({ entries: rows.slice(0, max) });
}
