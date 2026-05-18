// Client-side web push helpers (FCM).
//
// Flow:
//   1. enablePush(uid)  — asks the browser for permission, retrieves an
//      FCM registration token, saves it under users/{uid}/fcmTokens/{token}.
//   2. disablePush(uid, token) — removes the token from Firestore and
//      asks FCM to forget it.
//   3. onForegroundMessage(cb) — fires when a push arrives while the
//      app is open. Background pushes are handled by the service worker.
//
// Everything is feature-detected; on browsers without push support
// (e.g. iOS Safari pre-16.4, or a non-installed PWA on iOS), the
// helpers no-op rather than throw. iOS specifically only delivers
// push to PWAs that have been added to the Home Screen.

import {
  getMessaging, getToken, deleteToken, onMessage,
  isSupported as isMessagingSupported,
  Messaging, MessagePayload,
} from 'firebase/messaging';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { app, db } from './firebase';

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || '';
const SW_PATH = '/firebase-messaging-sw.js';

let messagingPromise: Promise<Messaging | null> | null = null;

async function getMessagingInstance(): Promise<Messaging | null> {
  if (typeof window === 'undefined') return null;
  if (messagingPromise) return messagingPromise;
  messagingPromise = (async () => {
    try {
      const supported = await isMessagingSupported();
      if (!supported) return null;
      return getMessaging(app);
    } catch {
      return null;
    }
  })();
  return messagingPromise;
}

export async function pushSupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('Notification' in window)) return false;
  if (!('PushManager' in window)) return false;
  if (!VAPID_KEY) return false;
  try {
    return await isMessagingSupported();
  } catch {
    return false;
  }
}

export function getPermissionStatus(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  let reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!reg) {
    reg = await navigator.serviceWorker.register(SW_PATH);
  }
  await navigator.serviceWorker.ready;
  return reg;
}

export interface EnablePushResult {
  ok: boolean;
  token?: string;
  reason?: 'unsupported' | 'denied' | 'no-vapid' | 'error';
  error?: unknown;
}

export async function enablePush(uid: string): Promise<EnablePushResult> {
  if (!uid) return { ok: false, reason: 'error' };
  if (!(await pushSupported())) return { ok: false, reason: 'unsupported' };
  if (!VAPID_KEY) return { ok: false, reason: 'no-vapid' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const messaging = await getMessagingInstance();
    if (!messaging) return { ok: false, reason: 'unsupported' };
    const registration = await ensureRegistration();
    if (!registration) return { ok: false, reason: 'unsupported' };

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return { ok: false, reason: 'error' };

    await setDoc(
      doc(db, 'users', uid, 'fcmTokens', token),
      {
        createdAt: serverTimestamp(),
        userAgent: navigator.userAgent,
        platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || 'unknown',
      },
      { merge: true }
    );
    return { ok: true, token };
  } catch (error) {
    return { ok: false, reason: 'error', error };
  }
}

export async function disablePush(uid: string, token: string): Promise<boolean> {
  if (!uid || !token) return false;
  try {
    const messaging = await getMessagingInstance();
    if (messaging) {
      try { await deleteToken(messaging); } catch { /* ignore */ }
    }
    await deleteDoc(doc(db, 'users', uid, 'fcmTokens', token));
    return true;
  } catch {
    return false;
  }
}

export async function onForegroundMessage(
  callback: (payload: MessagePayload) => void
): Promise<() => void> {
  const messaging = await getMessagingInstance();
  if (!messaging) return () => {};
  return onMessage(messaging, callback);
}
