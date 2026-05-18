'use client';

// Notifications card for the Settings page.
//
// Lets the signed-in user opt in to web push (FCM), see every device
// currently registered, copy a token for testing via Firebase Console,
// and remove a device when it's no longer wanted.
//
// Sending a push is intentionally NOT in this component yet — until
// firebase-admin is wired up server-side, tests go through the Firebase
// Console's "Send test message" flow (paste a token, click send).

import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import {
  pushSupported, getPermissionStatus, enablePush, disablePush, onForegroundMessage,
} from '@/lib/push';

type Status = 'loading' | 'unsupported' | 'default' | 'granted' | 'denied';

interface TokenDoc {
  id: string;
  userAgent?: string;
  platform?: string;
}

export default function NotificationSettings() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [tokens, setTokens] = useState<TokenDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = await pushSupported();
      if (cancelled) return;
      if (!supported) { setStatus('unsupported'); return; }
      const perm = getPermissionStatus();
      if (perm === 'unsupported') { setStatus('unsupported'); return; }
      setStatus(perm);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    const ref = collection(db, 'users', user.uid, 'fcmTokens');
    const unsub = onSnapshot(ref, (snap) => {
      setTokens(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TokenDoc, 'id'>) })));
    });
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (status !== 'granted') return;
    let unsub: () => void = () => {};
    (async () => {
      unsub = await onForegroundMessage((payload) => {
        const title = payload.notification?.title || payload.data?.title || 'Kaya';
        const body = payload.notification?.body || payload.data?.body || '';
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { body, icon: '/icon-192.png' });
        }
      });
    })();
    return () => unsub();
  }, [status]);

  async function handleEnable() {
    if (!user?.uid) return;
    setBusy(true);
    setError(null);
    const result = await enablePush(user.uid);
    setBusy(false);
    if (result.ok) {
      setStatus('granted');
    } else if (result.reason === 'denied') {
      setStatus('denied');
    } else if (result.reason === 'unsupported') {
      setStatus('unsupported');
    } else if (result.reason === 'no-vapid') {
      setError('Push is not configured (missing VAPID key). Contact support.');
    } else {
      setError('Could not enable notifications. Try again.');
    }
  }

  async function handleRemove(token: string) {
    if (!user?.uid) return;
    setBusy(true);
    await disablePush(user.uid, token);
    setBusy(false);
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch {
      setError('Could not copy. Long-press the token to copy manually.');
    }
  }

  function deviceLabel(t: TokenDoc): string {
    const ua = t.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone / iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    return t.platform || 'Unknown device';
  }

  if (status === 'loading') return null;

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
      <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-3">Device notifications</p>

      {status === 'unsupported' && (
        <p className="text-[11px] text-kaya-sand leading-relaxed">
          This browser doesn&apos;t support push notifications. On iPhone, install Kaya to your Home Screen first
          (Safari → Share → &quot;Add to Home Screen&quot;), then open from the icon and come back here.
        </p>
      )}

      {status === 'denied' && (
        <p className="text-[11px] text-kaya-sand leading-relaxed">
          Notifications are blocked for this site. Re-enable them in your browser&apos;s site settings, then reload.
        </p>
      )}

      {(status === 'default' || status === 'granted') && (
        <>
          <button
            onClick={handleEnable}
            disabled={busy}
            className="h-9 px-4 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40"
          >
            {busy
              ? 'Working…'
              : status === 'granted'
                ? (tokens.length > 0 ? 'Register this device again' : 'Register this device')
                : 'Enable notifications'}
          </button>
          <p className="text-[11px] text-kaya-sand-light mt-2 leading-relaxed">
            Tap once per device you want notifications on (phone, tablet, laptop).
          </p>

          {tokens.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider">
                Registered devices ({tokens.length})
              </p>
              {tokens.map((t) => (
                <div key={t.id} className="flex items-center gap-2 p-2 rounded-kaya-sm bg-kaya-cream">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold truncate">{deviceLabel(t)}</p>
                    <code className="text-[9px] font-mono text-kaya-sand block truncate" title={t.id}>
                      {t.id.slice(0, 28)}…
                    </code>
                  </div>
                  <button
                    onClick={() => copyToken(t.id)}
                    className="text-[10px] font-semibold text-kaya-gold shrink-0 px-2"
                  >
                    {copied === t.id ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={() => handleRemove(t.id)}
                    disabled={busy}
                    className="text-[10px] font-semibold text-red-500 shrink-0 px-2"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <p className="text-[10px] text-kaya-sand-light leading-relaxed">
                Test delivery: Firebase Console → Cloud Messaging → &quot;Send test message&quot; → paste a token above.
              </p>
            </div>
          )}

          {error && <p className="text-[11px] text-red-500 mt-2">{error}</p>}
        </>
      )}
    </div>
  );
}
