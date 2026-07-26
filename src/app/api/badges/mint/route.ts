// 🏅 Badge mint (BDG PR2 · B6/B8) — THE one way a badge is earned.
//
// Kids can't write their own child doc (rules), and client-side counts
// aren't trusted anyway: the caller only NOMINATES a badge; this route
// re-verifies the signal server-side, then — inside one transaction —
// adds the id to child.badges and writes the permanent badgeLog row
// (childId, badge facts, earnedAt) that powers 📜 badge history. A 🎉
// bell notification follows post-commit. Idempotent: already-earned
// badges no-op cleanly.
//
// Verified here: lifetime_points · streak_days · redemption_count ·
// goal_chipins · parent_confirm (parent callers only) and — since BDG PR3 —
// every counter-measured signal (quiz · award categories · diamonds ·
// meetings · conversions · workplan · family goals) read back off
// child.badgeCounters, which each area's own flow bumps as it happens.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  badgeById, badgeThreshold, counterKeyForSignal, isBadgeReleased, isBadgeInSeason,
  areaChaseSet, packForBadge, type BadgeConfig,
} from '@/lib/badgeLib';

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

  let body: { badgeId?: string; childId?: string; todayKey?: string };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const badgeId = (body.badgeId || '').trim();
  if (!badgeId) return NextResponse.json({ ok: false, error: 'missing-badgeId' }, { status: 400 });
  // The caller's LOCAL day (Kaya never reads day boundaries as UTC). Used only
  // for the 🎁 limited-time window; a missing/garbled value falls back to the
  // server's day rather than skipping the season check.
  const todayKey = /^\d{4}-\d{2}-\d{2}$/.test(body.todayKey || '')
    ? (body.todayKey as string)
    : new Date().toISOString().slice(0, 10);

  const profSnap = await db.collection('users').doc(uid).get();
  const prof = profSnap.data() as { role?: string; familyId?: string; childId?: string } | undefined;
  if (!prof?.familyId) return NextResponse.json({ ok: false, error: 'no-family' }, { status: 403 });
  const familyId = prof.familyId;
  const isParent = prof.role === 'parent';
  // Kids mint for THEMSELVES; parents may nominate any of their kids.
  const childId = isParent ? (body.childId || '').trim() : (prof.childId || '');
  if (!childId) return NextResponse.json({ ok: false, error: 'missing-childId' }, { status: 400 });

  try {
    const famRef = db.collection('families').doc(familyId);
    const childRef = famRef.collection('children').doc(childId);
    const famSnap = await famRef.get();
    const cfg = (famSnap.data() as { badgeConfig?: BadgeConfig } | undefined)?.badgeConfig;
    const def = badgeById(cfg, badgeId);
    if (!def) return NextResponse.json({ ok: false, error: 'unknown-badge' }, { status: 404 });
    if (!isBadgeReleased(cfg, def)) return NextResponse.json({ ok: false, error: 'not-released' }, { status: 400 });
    // 🎁 BDG PR5 — a limited-time pack badge is only mintable inside its
    // window. Enforced HERE, not just hidden in the UI, so the deadline is
    // real: miss the season, miss the badge.
    if (!isBadgeInSeason(badgeId, todayKey)) {
      const pack = packForBadge(badgeId);
      return NextResponse.json({ ok: false, error: 'out-of-season', pack: pack?.name }, { status: 400 });
    }
    const threshold = badgeThreshold(cfg, def);

    const minted = await db.runTransaction(async (tx) => {
      const cSnap = await tx.get(childRef);
      if (!cSnap.exists) throw new Error('child-not-found');
      const child = cSnap.data() as {
        badges?: string[]; totalPoints?: number; lifetimePoints?: number;
        streak?: number; name?: string; badgeCounters?: Record<string, number>;
      };
      if ((child.badges || []).includes(badgeId)) return false; // idempotent

      // BDG PR3 — every counter-measured signal (quiz · awards by category ·
      // diamonds · meetings · conversions · workplan · goals) verifies the
      // same way: read the tally the area's own flow wrote, compare to the
      // family's threshold. No client number is ever trusted.
      const counterKey = counterKeyForSignal(def.signal);
      if (counterKey) {
        if ((child.badgeCounters?.[counterKey] || 0) < threshold) return false;
        tx.update(childRef, { badges: FieldValue.arrayUnion(badgeId) });
        tx.set(famRef.collection('badgeLog').doc(), {
          childId, badgeId, name: def.name, icon: def.icon, tier: def.tier,
          area: def.area, how: def.how, earnedAt: FieldValue.serverTimestamp(),
        });
        return true;
      }

      // ── Server-side verification per signal ─────────────────────
      let met = false;
      switch (def.signal.kind) {
        case 'lifetime_points': {
          const lifetime = Math.max(child.lifetimePoints || 0, child.totalPoints || 0);
          met = lifetime >= threshold;
          // Lazy backfill so future checks are cheap + honest.
          if ((child.lifetimePoints || 0) < lifetime) tx.update(childRef, { lifetimePoints: lifetime });
          break;
        }
        case 'streak_days':
          met = (child.streak || 0) >= threshold;
          break;
        case 'redemption_count': {
          const reds = await db.collection('families').doc(familyId).collection('redemptions')
            .where('childId', '==', childId).limit(threshold + 5).get();
          met = reds.docs.filter((d) => (d.data() as { status?: string }).status !== 'rejected').length >= threshold;
          break;
        }
        case 'goal_chipins': {
          const goals = await famRef.collection('rewards').where('kind', '==', 'family').get();
          let n = 0;
          for (const g of goals.docs) {
            const c = (g.data() as { contributions?: Record<string, number> }).contributions?.[childId];
            if (c && c > 0) n++;
          }
          met = n >= threshold;
          break;
        }
        case 'area_complete': {
          // 💎 Collector — hold EVERY other released badge in the area. Read
          // off the same child.badges we're about to add to, so it can never
          // mint early.
          const chase = areaChaseSet(cfg, def.signal.area);
          const held = new Set(child.badges || []);
          met = chase.length > 0 && chase.every((b) => held.has(b.id));
          break;
        }
        case 'parent_confirm':
          met = isParent; // a parent's nomination IS the confirmation
          break;
        default:
          // saver_weeks is minted by the Hive saver card itself; anything
          // else unmeasurable is refused rather than trusted.
          return false;
      }
      if (!met) return false;

      tx.update(childRef, { badges: FieldValue.arrayUnion(badgeId) });
      tx.set(famRef.collection('badgeLog').doc(), {
        childId,
        badgeId,
        name: def.name,
        icon: def.icon,
        tier: def.tier,
        area: def.area,
        how: def.how,
        earnedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });

    if (minted) {
      // 🎉 ring the kid's bell (best-effort, post-commit).
      try {
        const kidUsers = await db.collection('users')
          .where('familyId', '==', familyId).where('childId', '==', childId).limit(3).get();
        for (const ku of kidUsers.docs) {
          await famRef.collection('notifications').add({
            type: 'badge',
            forUserId: ku.id,
            title: `🎉 Badge earned: ${def.icon} ${def.name}!`,
            message: def.how,
            read: false,
            link: '/badges',
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      } catch { /* bell is best-effort */ }
    }
    return NextResponse.json({ ok: true, minted });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'mint-failed' }, { status: 500 });
  }
}
