// Server-side FCM web-push dispatcher (v4-final §04 Step 8, 2026-05-18).
//
// First consumer: ad-hoc workplan assignments (`notifyAdhocAssigned` in
// `src/lib/notify.ts`). Designed to be generic so future flows can
// reuse it without per-event server code.
//
// Flow:
//   1. Client POSTs `{ uid, title, body, url?, tag? }`.
//   2. Server reads `users/{uid}/fcmTokens` via Admin Firestore.
//   3. Server sends multicast via Admin Messaging with a `data:` payload
//      (so the service worker — `public/firebase-messaging-sw.js` —
//      can render consistently across browsers).
//   4. Tokens that come back unregistered are pruned in the background.
//
// Failure policy:
//   • If Admin SDK has no credentials, return 200 with `delivered: false,
//     reason: 'no-admin-creds'`. The user's primary write (the assign)
//     already succeeded; missing push is not user-visible damage.
//   • If user has no tokens, same shape with `reason: 'no-tokens'`.
//   • If everything errors, return 500 with a short message — the
//     client treats it as fire-and-forget regardless.
//
// TODO(security): v2 — verify a Firebase ID token + assert the sender
// is a parent in the same family as the target uid. For v1 the call
// site is gated client-side; rules already prevent token-collection
// reads from anyone but the user themselves.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminMessaging, getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

interface PushBody {
  uid: string;
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export async function POST(req: NextRequest) {
  let parsed: PushBody;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }
  const { uid, title, body, url, tag } = parsed;
  if (!uid || !title || !body) {
    return NextResponse.json({ error: 'missing-fields' }, { status: 400 });
  }

  const messaging = getAdminMessaging();
  const firestore = getAdminFirestore();
  if (!messaging || !firestore) {
    return NextResponse.json({
      delivered: false,
      reason: 'no-admin-creds',
      hint: 'Set FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY env vars to enable web-push delivery.',
    });
  }

  // Read tokens. Each doc id IS the token; the doc body is metadata
  // (createdAt / userAgent / platform — see lib/push.ts).
  let tokens: string[] = [];
  try {
    const snap = await firestore.collection('users').doc(uid).collection('fcmTokens').get();
    tokens = snap.docs.map((d) => d.id).filter(Boolean);
  } catch (e) {
    return NextResponse.json({
      delivered: false,
      reason: 'firestore-read-failed',
      error: String(e),
    }, { status: 500 });
  }

  if (tokens.length === 0) {
    return NextResponse.json({ delivered: false, reason: 'no-tokens' });
  }

  // Send. We use `data:` so the service worker's onBackgroundMessage
  // can render consistently across browsers (some require user
  // interaction before auto-displaying `notification:` payloads).
  // The SW reads data.title / data.body / data.url / data.tag.
  let sent = 0;
  let failed = 0;
  const invalidTokens: string[] = [];

  try {
    const response = await messaging.sendEachForMulticast({
      tokens,
      data: {
        title,
        body,
        ...(url ? { url } : {}),
        ...(tag ? { tag } : {}),
      },
      webpush: {
        // Higher priority so Chrome surfaces it promptly on mobile.
        headers: { Urgency: 'high' },
        fcmOptions: url ? { link: url } : undefined,
      },
    });
    sent = response.successCount;
    failed = response.failureCount;
    response.responses.forEach((r, i) => {
      if (!r.success && r.error) {
        const code = r.error.code;
        // Token rot — prune so we don't keep trying to deliver to it.
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          invalidTokens.push(tokens[i]);
        }
      }
    });
  } catch (e) {
    return NextResponse.json({
      delivered: false,
      reason: 'send-failed',
      error: String(e),
    }, { status: 500 });
  }

  // Best-effort prune of dead tokens. Fire-and-forget — never blocks
  // the response on cleanup.
  if (invalidTokens.length > 0) {
    Promise.all(
      invalidTokens.map((t) =>
        firestore.collection('users').doc(uid).collection('fcmTokens').doc(t).delete().catch(() => undefined)
      )
    ).catch(() => undefined);
  }

  return NextResponse.json({
    delivered: sent > 0,
    sent,
    failed,
    pruned: invalidTokens.length,
  });
}
