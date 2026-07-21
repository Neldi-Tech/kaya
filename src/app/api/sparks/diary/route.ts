// Kaya Sparks · Diary Admin-API gateway (Slice 8 · 2026-07-21).
//
// ALL diary reads + writes flow through here — the client never touches
// the `sparks_diary` collection directly. That's what makes the privacy
// model real: lock redaction, sibling denial, and (Slice 8d) knock /
// quiet-open enforcement all happen server-side with the Admin SDK.
// No firestore.rules changes needed for the diary at all.
//
// Access matrix (v1 · this slice):
//   · owner (kid or parent) → full read/write of their OWN diary
//   · parent reading a KID's diary → locked entries come back REDACTED
//     (blocks stripped · date + time + feeling survive — the meta is
//     never hidden). Full locked-page access lands with Slice 8d.
//   · siblings / other kids → 403. Always.
//   · parents never WRITE in a kid's diary — it's the kid's book.
//
// Storage: /families/{familyId}/sparks_diary/{entryId}.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { dayKeyInTZ } from '@/lib/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TZ = process.env.SPARKS_REFLECTION_TZ || 'Africa/Dar_es_Salaam';

type Action = 'list' | 'save' | 'lock' | 'delete';

const FEELINGS = ['😊', '😄', '😐', '🙁', '😢', '😠', '😴', '🤔'];

interface BlockIn { kind?: string; text?: string; url?: string }

function localTimeHHmm(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}

function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await adminAuth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: {
    action?: Action; ownerId?: string; entryId?: string; date?: string;
    feeling?: string; blocks?: BlockIn[]; locked?: boolean;
    linked_reflection_date?: string; max?: number;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const action: Action = (['list', 'save', 'lock', 'delete'] as const).includes(body.action as Action)
    ? (body.action as Action) : 'list';
  const ownerId = typeof body.ownerId === 'string' ? body.ownerId : '';
  if (!ownerId) return NextResponse.json({ error: 'bad-owner' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; childId?: string; email?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  const role = user?.role || '';
  const isParent = role === 'parent';

  // Owner resolution. A PARENT owns the diary whose ownerId === their
  // uid. A KID owns the diary whose ownerId === their childId — resolved
  // robustly (childId can be '' → fall back to child-doc uid/email match,
  // per the kid-owner rule).
  let isOwner = false;
  let ownerIsKid = false;
  if (isParent && ownerId === uid) {
    isOwner = true;
  } else {
    const childDoc = await db.collection('families').doc(familyId)
      .collection('children').doc(ownerId).get();
    if (childDoc.exists) {
      ownerIsKid = true;
      if (role === 'kid') {
        const child = childDoc.data() as { uid?: string; email?: string } | undefined;
        if (user?.childId && user.childId === ownerId) isOwner = true;
        else if (child && (
          (child.uid && child.uid === uid)
          || (child.email && user?.email && child.email.toLowerCase() === user.email.toLowerCase())
        )) isOwner = true;
      }
    }
  }

  // Access gate:
  //   owner → everything below
  //   parent + kid-owned diary → read-only (list) with redaction
  //   anything else → 403 (this is what makes siblings blind)
  const parentReadingKid = isParent && ownerIsKid && !isOwner;
  if (!isOwner && !parentReadingKid) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const col = db.collection('families').doc(familyId).collection('sparks_diary');
  const today = dayKeyInTZ(new Date(), TZ);

  // ── list ──────────────────────────────────────────────────────────
  if (action === 'list') {
    const max = Math.max(1, Math.min(732, Number(body.max) || 366));
    const snap = await col.where('ownerId', '==', ownerId).get();
    type Row = {
      id: string; ownerId?: string; ownerRole?: string; date?: string;
      time?: string; feeling?: string; blocks?: unknown[]; locked?: boolean;
      linked_reflection_date?: string; createdAt?: unknown;
    };
    const rows = snap.docs
      .map((d): Row => ({ id: d.id, ...(d.data() as Omit<Row, 'id'>) }))
      .sort((a, b) => {
        const ka = `${a.date ?? ''}${a.time ?? ''}`;
        const kb = `${b.date ?? ''}${b.time ?? ''}`;
        return ka < kb ? 1 : ka > kb ? -1 : 0; // newest first
      })
      .slice(0, max)
      .map((r) => {
        if (parentReadingKid && r.locked === true) {
          // Redact: content gone, meta survives. Slice 8d adds the
          // knock / quiet-open doors that lift this.
          return {
            id: r.id, ownerId: r.ownerId, ownerRole: r.ownerRole,
            date: r.date, time: r.time, feeling: r.feeling,
            locked: true, redacted: true, blocks: [],
          };
        }
        return r;
      });
    return NextResponse.json({ entries: rows });
  }

  // ── writes: owner only ────────────────────────────────────────────
  if (!isOwner) return NextResponse.json({ error: 'owner-only' }, { status: 403 });

  if (action === 'save') {
    const feeling = typeof body.feeling === 'string' && FEELINGS.includes(body.feeling)
      ? body.feeling : '';
    if (!feeling) return NextResponse.json({ error: 'feeling-required' }, { status: 400 });

    const rawBlocks = Array.isArray(body.blocks) ? body.blocks.slice(0, 12) : [];
    type CleanBlock = { kind: 'text' | 'ink' | 'scan'; text?: string; url?: string };
    const blocks: CleanBlock[] = [];
    for (const b of rawBlocks) {
      const kind: CleanBlock['kind'] = b?.kind === 'ink' || b?.kind === 'scan' ? b.kind : 'text';
      if (kind === 'text') {
        const text = String(b?.text ?? '').slice(0, 8000).trim();
        if (text) blocks.push({ kind, text });
      } else {
        const url = String(b?.url ?? '').slice(0, 2048);
        if (url.startsWith('https://')) blocks.push({ kind, url });
      }
    }
    if (blocks.length === 0) return NextResponse.json({ error: 'empty-entry' }, { status: 400 });

    let date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today;
    // Kids write the recent window only (today ±1 tolerates timezones);
    // parents may backfill their own diary freely. History is a story,
    // not an editing surface.
    if (ownerIsKid && Math.abs(dayDiff(date, today)) > 1) date = today;

    const doc: Record<string, unknown> = {
      ownerId,
      ownerRole: ownerIsKid ? 'kid' : 'parent',
      date,
      time: localTimeHHmm(new Date()),
      feeling,
      blocks,
      locked: body.locked === true,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: uid,
    };
    if (typeof body.linked_reflection_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.linked_reflection_date)) {
      doc.linked_reflection_date = body.linked_reflection_date;
    }
    const ref = await col.add(doc);
    return NextResponse.json({ id: ref.id });
  }

  if (action === 'lock' || action === 'delete') {
    const entryId = typeof body.entryId === 'string' ? body.entryId : '';
    if (!entryId) return NextResponse.json({ error: 'bad-entry' }, { status: 400 });
    const ref = col.doc(entryId);
    const snap = await ref.get();
    if (!snap.exists || (snap.data() as { ownerId?: string }).ownerId !== ownerId) {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    if (action === 'lock') {
      await ref.update({ locked: body.locked === true, updatedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ ok: true });
    }
    await ref.delete();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
}
