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
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TZ = process.env.SPARKS_REFLECTION_TZ || 'Africa/Dar_es_Salaam';
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

/** Slice 8g · any emoji is a valid feeling: short, non-ASCII string.
 *  (The curated sets live client-side; the server just sanity-checks.) */
function validFeeling(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > 16) return null;
  // Reject plain ASCII words ("happy") — feelings are emoji.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]+$/.test(t)) return null;
  return t;
}

/** Slice 8g · infer a feeling emoji from page text. Best-effort with a
 *  hard 😐 fallback — never blocks a save. */
async function inferFeeling(text: string): Promise<string> {
  if (!anthropic || !text.trim()) return '😐';
  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 30,
      system: [{
        type: 'text',
        text: 'Read a child\'s diary text and answer with the ONE emoji that best matches the overall feeling. Prefer: 😊 😄 😐 🙁 😢 😠 😴 🤔 but any single fitting emoji is allowed. Return JSON: { "emoji": "x" }.',
        cache_control: { type: 'ephemeral' },
      }],
      output_config: { format: { type: 'json_schema', schema: {
        type: 'object', properties: { emoji: { type: 'string' } },
        required: ['emoji'], additionalProperties: false,
      } } },
      messages: [{ role: 'user', content: [{ type: 'text', text: text.slice(0, 800) }] }],
    });
    const t = r.content.find((b) => b.type === 'text');
    if (t && t.type === 'text') {
      const e = validFeeling((JSON.parse(t.text) as { emoji?: string }).emoji);
      if (e) return e;
    }
  } catch { /* fall through */ }
  return '😐';
}

type Action = 'list' | 'save' | 'lock' | 'delete'
  | 'privacy-get' | 'pin-set' | 'pin-reset' | 'quota-set'
  | 'knock' | 'knock-answer' | 'quiet-open' | 'visibility-set' | 'feeling-set';

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
    pin?: string; quota?: number; allow?: boolean; reason?: string;
    visibility?: string; sealed_until?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const ALL_ACTIONS: Action[] = ['list', 'save', 'lock', 'delete', 'privacy-get', 'pin-set', 'pin-reset', 'quota-set', 'knock', 'knock-answer', 'quiet-open', 'visibility-set', 'feeling-set'];
  const action: Action = ALL_ACTIONS.includes(body.action as Action)
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
  //   family member + PARENT-owned diary → list ONLY, and only when the
  //     owning parent set visibility='visible' (Slice 8e). Their locked
  //     pages are NEVER served to others — not even the meta.
  //   anything else → 403 (this is what makes siblings blind)
  const parentReadingKid = isParent && ownerIsKid && !isOwner;
  const ownerIsParentUser = !ownerIsKid && !!(await db.collection('users').doc(ownerId).get()).exists;
  let familyReadingParent = false;
  if (!isOwner && !parentReadingKid && ownerIsParentUser && action === 'list') {
    const ownerUser = (await db.collection('users').doc(ownerId).get()).data() as { familyId?: string; role?: string } | undefined;
    if (ownerUser?.familyId === familyId && ownerUser?.role === 'parent') {
      const priv = ((await db.collection('families').doc(familyId)
        .collection('sparks_diary_private').doc(ownerId).get()).data() ?? {}) as { visibility?: string };
      familyReadingParent = priv.visibility === 'visible';
    }
  }
  if (!isOwner && !parentReadingKid && !familyReadingParent) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const col = db.collection('families').doc(familyId).collection('sparks_diary');
  const today = dayKeyInTZ(new Date(), TZ);
  // Slice 8d · privacy store — Admin-only collection (no rules exist for
  // it → default deny for every client). Holds the kid PIN, per-parent
  // quiet-open quotas + usage, and the parents-only ledger.
  const privRef = db.collection('families').doc(familyId)
    .collection('sparks_diary_private').doc(ownerId);
  const monthKey = today.slice(0, 7); // YYYY-MM

  type PrivDoc = {
    pin?: string;
    quotas?: Record<string, number>;
    used?: Record<string, { month: string; count: number }>;
    ledger?: Array<Record<string, unknown>>;
  };

  const familyParents = async (): Promise<Array<{ uid: string; name: string }>> => {
    const us = await db.collection('users').where('familyId', '==', familyId).get();
    return us.docs
      .filter((u) => (u.data().role || '') === 'parent')
      .map((u) => ({ uid: u.id, name: (u.data().displayName as string | undefined) || 'Parent' }));
  };

  const notifyUser = async (forUserId: string, title: string, message: string) => {
    await db.collection('families').doc(familyId).collection('notifications').add({
      type: 'sparks-diary',
      title, message: message.slice(0, 160),
      read: false, forUserId, link: `/sparks/${ownerId}/diary`,
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
  };

  // ── Slice 8d · privacy actions ────────────────────────────────────
  if (action === 'privacy-get') {
    const priv = ((await privRef.get()).data() ?? {}) as PrivDoc & { visibility?: string; reflection_visibility?: string };
    if (isOwner && ownerIsKid) {
      return NextResponse.json({ hasPin: !!priv.pin });
    }
    if (isOwner && !ownerIsKid) {
      // A parent's OWN diary: hasPin + both visibility toggles. The PIN
      // itself is never echoed back — it's theirs alone, unrecoverable.
      const extra = priv as { reflection_visibility?: string };
      return NextResponse.json({
        hasPin: !!priv.pin,
        visibility: priv.visibility ?? 'personal',
        reflection_visibility: extra.reflection_visibility ?? 'personal',
      });
    }
    if (!parentReadingKid && !(isParent && ownerIsKid)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const parents = await familyParents();
    const myUsed = priv.used?.[uid];
    return NextResponse.json({
      pin: priv.pin ?? null,
      quota: priv.quotas?.[uid] ?? 3,
      usedThisMonth: myUsed && myUsed.month === monthKey ? myUsed.count : 0,
      ledger: (priv.ledger ?? []).slice(-50).reverse(),
      parentCount: parents.length,
    });
  }

  if (action === 'pin-set') {
    if (!isOwner) return NextResponse.json({ error: 'owner-only' }, { status: 403 });
    const pin = String(body.pin ?? '');
    if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: 'pin-4-digits' }, { status: 400 });
    await privRef.set({ pin }, { merge: true });
    return NextResponse.json({ ok: true });
  }

  if (action === 'pin-reset') {
    if (!isParent || !ownerIsKid) return NextResponse.json({ error: 'parent-only' }, { status: 403 });
    await privRef.set({ pin: FieldValue.delete() }, { merge: true });
    await notifyUser(ownerId, '🔑 Your Diary PIN was reset', 'A parent reset your PIN — set a fresh one next time you lock a page.');
    return NextResponse.json({ ok: true });
  }

  if (action === 'visibility-set') {
    if (!isOwner || ownerIsKid) return NextResponse.json({ error: 'parent-owner-only' }, { status: 403 });
    const visibility = body.visibility === 'visible' ? 'visible' : 'personal';
    await privRef.set({ visibility }, { merge: true });
    return NextResponse.json({ ok: true, visibility });
  }

  if (action === 'quota-set') {
    if (!isParent || !ownerIsKid) return NextResponse.json({ error: 'parent-only' }, { status: 403 });
    const quota = Math.max(0, Math.min(10, Math.round(Number(body.quota ?? 3))));
    await privRef.set({ quotas: { [uid]: quota } }, { merge: true });
    return NextResponse.json({ ok: true, quota });
  }

  if (action === 'knock') {
    if (!isParent || !ownerIsKid) return NextResponse.json({ error: 'parent-only' }, { status: 403 });
    const entryId = String(body.entryId ?? '');
    const eSnap = await col.doc(entryId).get();
    if (!eSnap.exists || (eSnap.data() as { ownerId?: string }).ownerId !== ownerId) {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    const me = (await familyParents()).find((pp) => pp.uid === uid);
    await col.doc(entryId).update({
      knock: { byUid: uid, byName: me?.name || 'Parent', status: 'pending', at: FieldValue.serverTimestamp() },
    });
    const d = (eSnap.data() as { date?: string }).date || '';
    await notifyUser(ownerId, '🚪 Knock knock…', `${me?.name || 'A parent'} would like to read your ${d} page. Open your diary to answer.`);
    return NextResponse.json({ ok: true });
  }

  if (action === 'knock-answer') {
    if (!isOwner || !ownerIsKid) return NextResponse.json({ error: 'kid-only' }, { status: 403 });
    const entryId = String(body.entryId ?? '');
    const eSnap = await col.doc(entryId).get();
    const eData = eSnap.data() as { ownerId?: string; date?: string; knock?: { byUid?: string; byName?: string } } | undefined;
    if (!eSnap.exists || eData?.ownerId !== ownerId || !eData?.knock) {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    const allow = body.allow === true;
    await col.doc(entryId).update({
      'knock.status': allow ? 'allowed' : 'denied',
      ...(allow ? { knock_open: true } : {}),
    });
    if (eData.knock.byUid) {
      await notifyUser(eData.knock.byUid,
        allow ? '💛 Knock allowed' : '🚪 Not yet',
        allow ? `Your knock on the ${eData.date} page was allowed.` : `The ${eData.date} page stays closed for now — that's okay.`);
    }
    return NextResponse.json({ ok: true });
  }

  if (action === 'quiet-open') {
    if (!isParent || !ownerIsKid) return NextResponse.json({ error: 'parent-only' }, { status: 403 });
    const entryId = String(body.entryId ?? '');
    const eSnap = await col.doc(entryId).get();
    const eData = eSnap.data() as Record<string, unknown> | undefined;
    if (!eSnap.exists || eData?.ownerId !== ownerId) {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    const priv = ((await privRef.get()).data() ?? {}) as PrivDoc;
    if (!priv.pin || String(body.pin ?? '') !== priv.pin) {
      return NextResponse.json({ error: 'wrong-pin' }, { status: 403 });
    }
    const parents = await familyParents();
    const quota = priv.quotas?.[uid] ?? 3;
    const usedRec = priv.used?.[uid];
    const used = usedRec && usedRec.month === monthKey ? usedRec.count : 0;
    const over = used >= quota;
    const reason = String(body.reason ?? '').trim().slice(0, 300);
    // Over-quota valve: multi-parent families require a typed reason +
    // co-parent ping. Single parent → quota + pause screen only.
    if (over && parents.length > 1 && !reason) {
      return NextResponse.json({ error: 'reason-required', used, quota }, { status: 428 });
    }
    const me = parents.find((pp) => pp.uid === uid);
    const ledgerRow: Record<string, unknown> = {
      by: uid, byName: me?.name || 'Parent',
      on: today, entryDate: (eData?.date as string) || '',
      overQuota: over,
      at: Date.now(),
    };
    if (over && reason) ledgerRow.reason = reason;
    await privRef.set({
      used: { [uid]: { month: monthKey, count: used + 1 } },
      ledger: FieldValue.arrayUnion(ledgerRow),
    }, { merge: true });
    if (over && parents.length > 1) {
      for (const pp of parents) {
        if (pp.uid === uid) continue;
        await notifyUser(pp.uid, '🔑 Over-quota quiet open',
          `${me?.name || 'Your co-parent'} opened a locked ${(eData?.date as string) || ''} page over quota. Reason: ${reason}`);
      }
    }
    // One-time read — the full entry returns in THIS response only.
    // Nothing persists on the entry; the kid is never notified (the
    // capability was disclosed once, at PIN setup).
    return NextResponse.json({ entry: { id: eSnap.id, ...eData }, used: used + 1, quota });
  }


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
      .filter((r) => !(familyReadingParent && r.locked === true))
      .map((r) => {
        // ⏳ Sealed and not yet due → content hidden from EVERYONE,
        // including the owner. Date + feeling + the seal date survive.
        const sealedUntil = (r as { sealed_until?: string }).sealed_until;
        if (sealedUntil && sealedUntil > today) {
          return {
            id: r.id, ownerId: r.ownerId, ownerRole: r.ownerRole,
            date: r.date, time: r.time, feeling: r.feeling,
            feeling_ai_guessed: (r as { feeling_ai_guessed?: boolean }).feeling_ai_guessed === true,
            locked: r.locked === true, sealed_until: sealedUntil,
            redacted: true, blocks: [],
          };
        }
        if (parentReadingKid && r.locked === true && (r as { knock_open?: boolean }).knock_open !== true) {
          // Redact: content gone, meta survives. Slice 8d adds the
          // knock / quiet-open doors that lift this.
          return {
            id: r.id, ownerId: r.ownerId, ownerRole: r.ownerRole,
            date: r.date, time: r.time, feeling: r.feeling,
            feeling_ai_guessed: (r as { feeling_ai_guessed?: boolean }).feeling_ai_guessed === true,
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
    // Slice 8g · feeling is now OPTIONAL and may be ANY emoji. Missing →
    // Kaya infers one from the typed text (😐 fallback) and stamps the
    // page ✨ ai-guessed so the owner can correct it with one tap.
    let feeling = validFeeling(body.feeling) ?? '';
    let feelingGuessed = false;
    if (!feeling) {
      const textForInfer = (Array.isArray(body.blocks) ? body.blocks : [])
        .filter((b) => b?.kind !== 'ink' && b?.kind !== 'scan' && typeof b?.text === 'string')
        .map((b) => String(b.text))
        .join('\n');
      feeling = await inferFeeling(textForInfer);
      feelingGuessed = true;
    }

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
      ...(feelingGuessed ? { feeling_ai_guessed: true } : {}),
      blocks,
      locked: body.locked === true,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: uid,
    };
    if (typeof body.linked_reflection_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.linked_reflection_date)) {
      doc.linked_reflection_date = body.linked_reflection_date;
    }
    // Slice 8f · ⏳ sealed pages — hidden from EVERYONE (owner included)
    // until the chosen date. Must be in the future; quiet-open still
    // works (safeguard beats gimmick).
    if (typeof body.sealed_until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.sealed_until) && body.sealed_until > today) {
      doc.sealed_until = body.sealed_until;
    }
    const ref = await col.add(doc);
    return NextResponse.json({ id: ref.id });
  }

  if (action === 'feeling-set') {
    if (!isOwner) return NextResponse.json({ error: 'owner-only' }, { status: 403 });
    const entryId = typeof body.entryId === 'string' ? body.entryId : '';
    const feeling = validFeeling(body.feeling);
    if (!entryId || !feeling) return NextResponse.json({ error: 'bad-args' }, { status: 400 });
    const ref = col.doc(entryId);
    const snap = await ref.get();
    if (!snap.exists || (snap.data() as { ownerId?: string }).ownerId !== ownerId) {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    await ref.update({ feeling, feeling_ai_guessed: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ ok: true });
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
      await ref.update({
        locked: body.locked === true,
        // Re-locking resets any knock grant — fresh lock, fresh privacy.
        ...(body.locked === true ? { knock_open: FieldValue.delete(), knock: FieldValue.delete() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: true });
    }
    await ref.delete();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
}
