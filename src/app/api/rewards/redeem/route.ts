// 🎁 Rewards (RWD PR1 · R8) — kid instant redemption UNDER the family's
// auto-approve threshold. Kids can't deduct their own points client-side
// (rules, deliberately), so the small-reward fast path runs here with the
// Admin SDK inside ONE transaction: threshold + 🛡 floor re-checked, points +
// wallet mirror + 📜 statement line + history row (approvedBy: 'auto').

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

  let body: { rewardId?: string };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const rewardId = (body.rewardId || '').trim();
  if (!rewardId) return NextResponse.json({ ok: false, error: 'missing-rewardId' }, { status: 400 });

  // Caller must be a KID with a linked childId.
  const profSnap = await db.collection('users').doc(uid).get();
  const prof = profSnap.data() as { role?: string; familyId?: string; childId?: string } | undefined;
  if (!prof?.familyId || prof.role !== 'kid' || !prof.childId) {
    return NextResponse.json({ ok: false, error: 'not-a-linked-kid' }, { status: 403 });
  }
  const familyId = prof.familyId;
  const childId = prof.childId;

  try {
    const result = await db.runTransaction(async (tx) => {
      const famRef = db.collection('families').doc(familyId);
      const rewardRef = famRef.collection('rewards').doc(rewardId);
      const childRef = famRef.collection('children').doc(childId);
      const walletRef = childRef.collection('wallet').doc('balances');
      const [famSnap, rewardSnap, childSnap, walletSnap] = await Promise.all([
        tx.get(famRef), tx.get(rewardRef), tx.get(childRef), tx.get(walletRef),
      ]);
      if (!rewardSnap.exists) throw new Error('reward-not-found');
      const reward = rewardSnap.data() as { title?: string; pointsCost?: number; active?: boolean };
      if (reward.active === false) throw new Error('reward-retired');
      const cost = reward.pointsCost ?? 0;
      if (!Number.isInteger(cost) || cost <= 0) throw new Error('bad-reward');

      const cfg = (famSnap.data() as {
        rewardsConfig?: { minPointsFloor?: number; minPointsFloorPerKid?: Record<string, number>; autoApproveBelowPoints?: number };
      } | undefined)?.rewardsConfig;
      const autoBelow = cfg?.autoApproveBelowPoints ?? 0;
      if (!(autoBelow > 0 && cost <= autoBelow)) throw new Error('needs-parent-approval');
      const floor = cfg?.minPointsFloorPerKid?.[childId] ?? cfg?.minPointsFloor ?? 0;

      if (!childSnap.exists) throw new Error('child-not-found');
      const total = (childSnap.data() as { totalPoints?: number }).totalPoints ?? 0;
      if (total - cost < Math.max(0, floor)) throw new Error('under-floor');

      const now = FieldValue.serverTimestamp();
      tx.update(childRef, { totalPoints: total - cost });
      if (walletSnap.exists) {
        const hp = (walletSnap.data() as { housePoints?: number }).housePoints ?? 0;
        tx.update(walletRef, { housePoints: Math.max(0, hp - cost), updatedAt: now });
      }
      const ledgerRef = childRef.collection('hiveTransactions').doc();
      tx.set(ledgerRef, {
        layer: 'house_points', direction: 'out', amount: cost, category: 'spend',
        description: `🎁 ${reward.title || 'Reward'}`,
        status: 'completed', createdBy: uid, approvedBy: 'auto',
        createdAt: now, completedAt: now,
      });
      tx.set(famRef.collection('redemptions').doc(), {
        childId, rewardId,
        rewardTitle: reward.title || 'Reward',
        pointsSpent: cost,
        status: 'approved', approvedBy: 'auto',
        createdAt: now,
      });
      return { title: reward.title || 'Reward' };
    });
    return NextResponse.json({ ok: true, title: result.title });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'redeem-failed';
    const friendly: Record<string, string> = {
      'needs-parent-approval': 'This one needs a parent — send the request instead.',
      'under-floor': 'This would dip under your family’s 🛡 protected points.',
      'reward-retired': 'This reward is no longer available.',
    };
    return NextResponse.json({ ok: false, error: friendly[code] || code }, { status: 400 });
  }
}
