// PATCH /api/buzz/[id]/transition — operator-only: change a buzz's
// status and optionally credit the Hive reward when it ships.
//
// Body: { status: BuzzStatus, comingSoonTargetWindow?, confirmReward?: boolean }
//
// When transitioning to 'live' or 'reward':
//   • Requires `confirmReward: true` from the client (admin saw the
//     confirm dialog).
//   • Splits `honeyCoinsPerShippedIdea` (from /config/buzz settings)
//     evenly across the contributing family's kids — one Hive
//     transaction per kid + the wallet's honeyCoins denorm bumped.
//   • Anonymous posts: still credit coins if settings.anonymousEarnsCoins
//     is true (default).
//   • Sets shippedAt + rewardedHoneyCoins on the buzz.
//
// If the family has no kids the reward is recorded as 0 (no wallet to
// credit). The status change still lands.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import {
  resolveAuth, loadBuzzSettings,
  VALID_STATUSES, VALID_TARGET_WINDOWS,
  type RawBuzz,
} from '@/lib/buzzServer';
import type { BuzzStatus, BuzzTargetWindow } from '@/lib/buzz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx: auth } = r;
  if (!auth.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });

  let body: { status?: string; comingSoonTargetWindow?: string | null; confirmReward?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const nextStatus = body.status as BuzzStatus;
  if (!VALID_STATUSES.has(nextStatus)) return NextResponse.json({ error: 'bad-status' }, { status: 400 });

  const window = (body.comingSoonTargetWindow ?? null) as BuzzTargetWindow;
  if (!VALID_TARGET_WINDOWS.includes(window)) return NextResponse.json({ error: 'bad-window' }, { status: 400 });

  const buzzRef = db.collection('buzz').doc(ctx.params.id);
  const snap = await buzzRef.get();
  if (!snap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const raw = snap.data() as RawBuzz;

  const settings = await loadBuzzSettings(db);
  const isShipping = (nextStatus === 'live' || nextStatus === 'reward') &&
                     (raw.status !== 'live' && raw.status !== 'reward');

  if (isShipping && body.confirmReward !== true) {
    return NextResponse.json({ error: 'reward-not-confirmed' }, { status: 409 });
  }

  // Status update (always applied).
  const patch: Record<string, unknown> = {
    status: nextStatus,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (nextStatus === 'soon') patch.comingSoonTargetWindow = window ?? 'No date yet';
  else patch.comingSoonTargetWindow = window ?? null;

  let rewardCredited = 0;
  if (isShipping) {
    patch.shippedAt = FieldValue.serverTimestamp();
    const shouldPay = !raw.postedAnonymously || settings.anonymousEarnsCoins;
    if (shouldPay) {
      rewardCredited = await creditBuzzReward(
        db,
        raw.authorFamilyId,
        settings.honeyCoinsPerShippedIdea,
        ctx.params.id,
        raw.title,
        auth.uid,
      );
    }
    patch.rewardedHoneyCoins = rewardCredited;
  }

  await buzzRef.update(patch);
  return NextResponse.json({ ok: true, rewardCredited: isShipping ? rewardCredited : undefined });
}

/** Split totalHoney evenly across the family's kids; round down per kid
 *  and give the remainder to the first kid so total credited equals
 *  the budget. Each kid gets one HiveTransaction (layer=honey,
 *  direction=in, category=gift). Wallet doc's honeyCoins is bumped via
 *  an atomic increment so we don't need a transaction here. Returns the
 *  total honey actually credited (0 if family has no kids). */
async function creditBuzzReward(
  db: Firestore,
  familyId: string,
  totalHoney: number,
  buzzId: string,
  buzzTitle: string,
  operatorUid: string,
): Promise<number> {
  if (totalHoney <= 0) return 0;
  const kidsSnap = await db.collection('families').doc(familyId).collection('children').get();
  const kidIds = kidsSnap.docs.map((d) => d.id);
  if (kidIds.length === 0) return 0;

  const base = Math.floor(totalHoney / kidIds.length);
  const remainder = totalHoney - base * kidIds.length;

  const batch = db.batch();
  for (let i = 0; i < kidIds.length; i += 1) {
    const kidId = kidIds[i];
    const honey = base + (i === 0 ? remainder : 0);
    if (honey <= 0) continue;

    const walletRef = db.collection('families').doc(familyId)
      .collection('kids').doc(kidId)
      .collection('wallet').doc('balances');
    const txRef = db.collection('families').doc(familyId)
      .collection('kids').doc(kidId)
      .collection('hiveTransactions').doc(`buzz-${buzzId}-${kidId}`);

    batch.set(walletRef, {
      honeyCoins: FieldValue.increment(honey),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    batch.set(txRef, {
      layer: 'honey',
      direction: 'in',
      amount: honey,
      category: 'gift',
      description: `Buzz reward: "${buzzTitle.slice(0, 80)}"`,
      status: 'completed',
      createdBy: operatorUid,
      approvedBy: operatorUid,
      createdAt: FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return totalHoney;
}
