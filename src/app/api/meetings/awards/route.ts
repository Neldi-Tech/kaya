// 🙋 Meeting awards gateway (Sunday Meeting upgrade · PR4 · approved design
// v2, 21-Sep-2026 · R11–R16, R19).
//
// WHY: award writes are parents-only in Firestore rules. When a kid ran the
// Sunday meeting the ⭐ Star / 🏆 Belt buttons called giveAward(), were
// denied, and just reset — no message. Now a kid's tap becomes a PROPOSAL
// that parents approve · adjust · decline; parents still award straight in.
//
// Collection `families/{f}/meetingAwardProposals/{slot}` — Admin-only, so
// ZERO rules / index deploys. One slot = one award, ever: a kid's proposal,
// a parent's approval and a parent's direct award all share the same doc id.
//
// Actions:
//   propose        (non-parents) { key, meetingDate, items:[{type,rank?,childId}] }
//                  → the SERVER recomputes the window + re-checks each winner
//                    from the real ratings with lib/meetingReview (the same
//                    math the screen showed), fixes the points to the
//                    family's set amounts, bells + pushes parents ONCE.
//   reserve-direct (parents) same payload, one item → 'resolving' + direct
//   list           (anyone)  { from, to } | { status:'pending' }
//   claim          (parents) { id } pending → resolving
//   release        (parents) { id } resolving → pending (direct → deleted)
//   finalize       (parents) { id, decision, finalPoints, awardId?, parentNote }
//                  — the note is required both ways (Elia's standing rule)
//                    and reaches the kids' 🔔 bell.
// The points themselves ride the normal award rail (client giveAward between
// claim and finalize — same safe pattern as Leader notes), so badges, the
// 🏅 kid emails and thresholds all behave exactly as today. No emails here.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore, getAdminMessaging } from '@/lib/firebaseAdmin';
import type { Child, DailyRating, Routine } from '@/lib/firestore';
import {
  computeWindowRange, kidWindowAllowed, verifyMeetingAward, meetingAwardPoints, meetingAwardSlot, awardTitle,
  type MeetingAwardProposal, type MeetingAwardType, type WindowKey,
} from '@/lib/meetingAwards.shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: MeetingAwardType[] = ['star', 'belt', 'ladder'];
const dateOk = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function parseKey(raw: unknown): WindowKey | null {
  const k = raw as { kind?: string; year?: number; month?: number; from?: string; to?: string } | null;
  if (!k || typeof k.kind !== 'string') return null;
  if (k.kind === 'today' || k.kind === 'lifetime' || k.kind === 'last7' || k.kind === 'last14' || k.kind === 'mtd') return { kind: k.kind };
  if (k.kind === 'month' && Number.isInteger(k.year) && Number.isInteger(k.month) && k.month! >= 1 && k.month! <= 12) return { kind: 'month', year: k.year!, month: k.month! };
  if (k.kind === 'custom' && dateOk(k.from) && dateOk(k.to)) return { kind: 'custom', from: k.from, to: k.to };
  return null;
}

export async function POST(req: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return NextResponse.json({ ok: false, error: 'admin-not-configured' }, { status: 503 });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ ok: false, error: 'invalid-token' }, { status: 401 }); }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || '');
  const familyId = String(body.familyId || '');
  if (!action || !familyId) return NextResponse.json({ ok: false, error: 'bad-args' }, { status: 400 });

  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.data() as { familyId?: string; role?: string; displayName?: string } | undefined;
  if (!user || user.familyId !== familyId) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  const isParent = user.role === 'parent';
  const myName = (user.displayName || '').trim().slice(0, 60) || (isParent ? 'A parent' : 'The leader');

  const famRef = db.collection('families').doc(familyId);
  const col = famRef.collection('meetingAwardProposals');

  const bell = async (forUserId: string, note: { type: string; title: string; message: string; link: string }) => {
    await famRef.collection('notifications').add({ ...note, forUserId, read: false, createdAt: new Date() }).catch(() => {});
  };
  const push = async (toUid: string, title: string, text: string, url: string, tag: string) => {
    const messaging = getAdminMessaging();
    if (!messaging) return;
    try {
      const snap = await db.collection('users').doc(toUid).collection('fcmTokens').get();
      const tokens = snap.docs.map((d) => d.id).filter(Boolean);
      if (tokens.length === 0) return;
      await messaging.sendEachForMulticast({
        tokens, data: { title, body: text, url, tag },
        webpush: { headers: { Urgency: 'high' }, fcmOptions: { link: url } },
      });
    } catch { /* push is a nudge — never fail the write over it */ }
  };
  const parentUids = async () =>
    (await db.collection('users').where('familyId', '==', familyId).where('role', '==', 'parent').get()).docs.map((d) => d.id);
  const kidLoginUid = async (childId: string): Promise<string | null> => {
    const s = await db.collection('users').where('familyId', '==', familyId).where('childId', '==', childId).limit(1).get();
    return s.empty ? null : s.docs[0].id;
  };

  try {
    // ── propose (kids) · reserve-direct (parents) ────────────────────
    if (action === 'propose' || action === 'reserve-direct') {
      const direct = action === 'reserve-direct';
      if (direct && !isParent) return NextResponse.json({ ok: false, error: 'parents-only' }, { status: 403 });
      if (!direct && isParent) return NextResponse.json({ ok: false, error: 'kids-propose' }, { status: 400 });

      const fam = ((await famRef.get()).data() || {}) as {
        routines?: Routine[]; meetingSetup?: { kidProposalsEnabled?: boolean }; pointSystem?: { diamondMinPoints?: number };
      };
      if (!direct && fam.meetingSetup?.kidProposalsEnabled === false) return NextResponse.json({ ok: false, error: 'kid-proposals-off' }, { status: 403 });

      const key = parseKey(body.key);
      const meetingDate = body.meetingDate;
      if (!key || !dateOk(meetingDate)) return NextResponse.json({ ok: false, error: 'bad-args' }, { status: 400 });
      const todayStr = new Date().toISOString().slice(0, 10);
      if (!direct && !kidWindowAllowed(key, meetingDate, todayStr)) return NextResponse.json({ ok: false, error: 'window-not-allowed' }, { status: 400 });
      const range = computeWindowRange(key, meetingDate);

      const rawItems = Array.isArray(body.items) ? body.items.slice(0, direct ? 1 : 6) : [];
      const items = rawItems
        .map((x) => x as { type?: string; rank?: number; childId?: string })
        .filter((x) => TYPES.includes(x.type as MeetingAwardType) && typeof x.childId === 'string' && x.childId)
        .map((x) => ({ type: x.type as MeetingAwardType, rank: x.type === 'star' ? Number(x.rank) : undefined, childId: String(x.childId) }));
      if (items.length === 0) return NextResponse.json({ ok: false, error: 'bad-args' }, { status: 400 });

      // The real ratings — so a proposal for someone who didn't win is refused (R13).
      const [kidsSnap, ratingsSnap] = await Promise.all([
        famRef.collection('children').get(),
        famRef.collection('ratings').where('date', '>=', range.from).where('date', '<=', range.to).get(),
      ]);
      const children = kidsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Child);
      const ratings = ratingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as DailyRating);
      const routines = Array.isArray(fam.routines) ? fam.routines : [];
      const diamondMin = Number(fam.pointSystem?.diamondMinPoints || 4);

      const bundleId = items.length > 1 ? `b-${Date.now().toString(36)}` : undefined;
      const results: Array<{ slot: string; ok: boolean; error?: string; proposal?: MeetingAwardProposal }> = [];
      for (const it of items) {
        const slot = meetingAwardSlot(it.type, it.rank, it.childId, range.from, range.to);
        const verdict = verifyMeetingAward({ type: it.type, rank: it.rank, childId: it.childId, children, routines, ratings, range });
        if (!verdict.ok) { results.push({ slot, ok: false, error: verdict.error }); continue; }
        const kid = children.find((c) => c.id === it.childId)!;
        const ref = col.doc(slot);
        const proposal: MeetingAwardProposal = {
          id: slot, slot, type: it.type, ...(it.rank ? { rank: it.rank as 1 | 2 | 3 } : {}),
          childId: kid.id, childName: kid.name, childEmoji: kid.avatarEmoji || '🧒',
          from: range.from, to: range.to, rangeLabel: range.label,
          points: meetingAwardPoints(it.type, it.rank, diamondMin),
          reason: verdict.reason, evidence: verdict.evidence,
          status: direct ? 'resolving' : 'pending', ...(direct ? { direct: true } : {}),
          proposedBy: uid, proposedByName: myName, ...(bundleId ? { bundleId } : {}),
          createdAt: Date.now(),
        };
        // One slot = one award, ever — decided inside a transaction.
        const taken = await db.runTransaction(async (tx) => {
          const cur = await tx.get(ref);
          if (cur.exists) {
            const st = (cur.data() as MeetingAwardProposal).status;
            return st === 'approved' || st === 'adjusted' ? 'already-awarded' : st === 'declined' ? 'already-decided' : 'already-proposed';
          }
          tx.set(ref, proposal);
          return '';
        });
        if (taken) results.push({ slot, ok: false, error: taken });
        else results.push({ slot, ok: true, proposal });
      }

      const made = results.filter((r) => r.ok && r.proposal).map((r) => r.proposal!);
      if (!direct && made.length > 0) {
        // R19 — ONE bundled bell + push per parent, never five pings.
        const who = myName.split(' ')[0];
        const title = made.length === 1 ? '🏆 A meeting award is waiting for you' : `🏆 ${made.length} meeting awards are waiting for you`;
        const message = made.length === 1
          ? `${who} proposed the ${awardTitle(made[0])} for ${made[0].childName.split(' ')[0]} · +${made[0].points}. Tap to decide — the family is watching 👀`
          : `${who} proposed ${made.map((m) => `${awardTitle(m)} → ${m.childName.split(' ')[0]} +${m.points}`).join(' · ')}. Tap to decide.`;
        for (const p of await parentUids()) {
          await bell(p, { type: 'meeting', title, message, link: '/meetings/awards' });
          await push(p, 'Kaya · Sunday Meeting', message, '/meetings/awards', 'meeting-awards');
        }
      }
      if (made.length === 0) return NextResponse.json({ ok: false, error: results[0]?.error || 'failed', results }, { status: 409 });
      return NextResponse.json({ ok: true, results, proposals: made });
    }

    // ── list ─────────────────────────────────────────────────────────
    if (action === 'list') {
      let docs;
      if (dateOk(body.from) && dateOk(body.to)) docs = (await col.where('from', '==', body.from).get()).docs.filter((d) => d.data().to === body.to);
      else docs = (await col.where('status', 'in', ['pending', 'resolving']).get()).docs;
      const proposals = docs.map((d) => ({ ...(d.data() as MeetingAwardProposal), id: d.id })).sort((a, b) => a.createdAt - b.createdAt);
      return NextResponse.json({ ok: true, proposals });
    }

    // Everything below decides a proposal → parents only.
    if (!isParent) return NextResponse.json({ ok: false, error: 'parents-only' }, { status: 403 });
    const id = String(body.id || '');
    if (!id) return NextResponse.json({ ok: false, error: 'bad-args' }, { status: 400 });
    const ref = col.doc(id);

    if (action === 'claim') {
      const out = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) return { error: 'not-found', status: 404 };
        const p = s.data() as MeetingAwardProposal;
        if (p.status !== 'pending') return { error: p.status === 'resolving' ? 'not-pending' : 'already-decided', status: 409 };
        tx.update(ref, { status: 'resolving', resolvedBy: uid, resolvedByName: myName, claimedAt: Date.now() });
        return { proposal: { ...p, id: s.id } };
      });
      if ('error' in out) return NextResponse.json({ ok: false, error: out.error }, { status: out.status });
      return NextResponse.json({ ok: true, proposal: out.proposal });
    }

    if (action === 'release') {
      const s = await ref.get();
      if (!s.exists) return NextResponse.json({ ok: true });
      const p = s.data() as MeetingAwardProposal;
      if (p.status !== 'resolving') return NextResponse.json({ ok: true });
      if (p.direct) await ref.delete(); // a direct award that never landed leaves nothing behind
      else await ref.update({ status: 'pending' });
      return NextResponse.json({ ok: true });
    }

    if (action === 'finalize') {
      const decision = body.decision === 'declined' ? 'declined' : body.decision === 'adjusted' ? 'adjusted' : 'approved';
      const parentNote = String(body.parentNote || '').trim().slice(0, 600);
      const s = await ref.get();
      if (!s.exists) return NextResponse.json({ ok: false, error: 'not-found' }, { status: 404 });
      const p = { ...(s.data() as MeetingAwardProposal), id: s.id };
      if (p.status === 'approved' || p.status === 'adjusted' || p.status === 'declined') return NextResponse.json({ ok: false, error: 'already-decided' }, { status: 409 });
      // A kid's proposal always gets a note back; a parent's own direct award needs none.
      if (!p.direct && parentNote.split(/\s+/).filter(Boolean).length < 2) return NextResponse.json({ ok: false, error: 'note-required' }, { status: 400 });
      const finalPoints = decision === 'declined' ? 0 : Math.max(1, Math.min(50, Math.round(Number(body.finalPoints) || p.points)));
      const status = decision === 'declined' ? 'declined' : (finalPoints !== p.points && !p.direct ? 'adjusted' : decision === 'adjusted' ? 'adjusted' : 'approved');
      const awardId = typeof body.awardId === 'string' ? body.awardId.slice(0, 80) : '';
      const now = Date.now();
      await ref.set({
        status, finalPoints, ...(awardId ? { awardId } : {}), ...(parentNote ? { parentNote } : {}),
        resolvedBy: uid, resolvedByName: myName, resolvedAt: now,
      }, { merge: true });

      if (!p.direct) {
        // The kids hear back — the proposer and the winner (once if the same child).
        const kidFirst = p.childName.split(' ')[0];
        const me = myName.split(' ')[0];
        const plain = parentNote.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/_([^_\n]+)_/g, '$1');
        const title = status === 'declined' ? `✕ ${awardTitle(p)} — not this time` : `✅ ${awardTitle(p)}: +${finalPoints} → ${kidFirst}`;
        const message = `${me} ${status === 'declined' ? 'declined' : status === 'adjusted' ? `adjusted it to +${finalPoints}` : 'approved it'}${plain ? ` — “${plain}”` : ''}`;
        const targets = new Set<string>();
        targets.add(p.proposedBy);
        const winnerUid = await kidLoginUid(p.childId);
        if (winnerUid) targets.add(winnerUid);
        targets.delete(uid);
        for (const t of targets) await bell(t, { type: status === 'declined' ? 'meeting' : 'reward', title, message, link: '/meetings/review' });
      }
      return NextResponse.json({ ok: true, status, finalPoints });
    }

    return NextResponse.json({ ok: false, error: 'bad-action' }, { status: 400 });
  } catch (e) {
    console.error('[meetings/awards] failed', action, e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
