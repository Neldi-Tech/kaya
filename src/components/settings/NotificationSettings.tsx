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
import { collection, onSnapshot, doc, getDoc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
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
  const { user, profile } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [tokens, setTokens] = useState<TokenDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Daily performance email digest — per-parent opt-in (2026-05-20).
  // Stored on the user's own doc (users/{uid}.perfDigestEmail), so one
  // parent enabling it doesn't affect the other. A daily Vercel cron
  // (/api/cron/perf-digest) emails opted-in parents each helper's score.
  const isParent = profile?.role === 'parent';
  const [digestEmail, setDigestEmail] = useState<boolean>(false);
  const [digestBusy, setDigestBusy] = useState(false);
  useEffect(() => {
    if (!user?.uid || !isParent) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!cancelled) setDigestEmail(snap.exists() && (snap.data() as { perfDigestEmail?: boolean }).perfDigestEmail === true);
      } catch { /* leave default off */ }
    })();
    return () => { cancelled = true; };
  }, [user?.uid, isParent]);

  async function toggleDigest() {
    if (!user?.uid) return;
    const next = !digestEmail;
    setDigestEmail(next); // optimistic
    setDigestBusy(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { perfDigestEmail: next });
    } catch {
      setDigestEmail(!next); // revert on failure
    } finally {
      setDigestBusy(false);
    }
  }

  // ── Payroll email notifications (2026-06-08) ──────────────────────
  // Up to 2 extra inboxes + per-event on/off, stored on the family doc.
  const { family } = useFamily();
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const [extraEmails, setExtraEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [pnEvents, setPnEvents] = useState({ salaryRaised: true, markPaidDue: true, approvals: false, salaryPaid: false });
  const [pnLoaded, setPnLoaded] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  // Load once when the family arrives (don't clobber in-progress edits).
  useEffect(() => {
    if (!family?.id || pnLoaded) return;
    const pn = family.payrollNotify;
    if (pn) {
      setExtraEmails(pn.extraEmails ?? []);
      setPnEvents({
        salaryRaised: pn.events?.salaryRaised ?? true,
        markPaidDue: pn.events?.markPaidDue ?? true,
        approvals: pn.events?.approvals ?? false,
        salaryPaid: pn.events?.salaryPaid ?? false,
      });
    }
    setPnLoaded(true);
  }, [family?.id, family?.payrollNotify, pnLoaded]);

  const savePayrollNotify = async (next: { extraEmails?: string[]; events?: typeof pnEvents }) => {
    if (!family?.id) return;
    const emails = next.extraEmails ?? extraEmails;
    const events = next.events ?? pnEvents;
    try {
      await updateDoc(doc(db, 'families', family.id), { payrollNotify: { extraEmails: emails, events } });
    } catch { /* best-effort; UI already optimistic */ }
  };
  const addEmail = () => {
    const e = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) { setTestMsg('Enter a valid email.'); return; }
    if (extraEmails.includes(e)) { setNewEmail(''); return; }
    if (extraEmails.length >= 2) { setTestMsg('Up to 2 extra emails.'); return; }
    const next = [...extraEmails, e];
    setExtraEmails(next); setNewEmail(''); setTestMsg(null);
    void savePayrollNotify({ extraEmails: next });
  };
  const removeEmail = (e: string) => {
    const next = extraEmails.filter((x) => x !== e);
    setExtraEmails(next);
    void savePayrollNotify({ extraEmails: next });
  };
  const toggleEvent = (k: keyof typeof pnEvents) => {
    const next = { ...pnEvents, [k]: !pnEvents[k] };
    setPnEvents(next);
    void savePayrollNotify({ events: next });
  };
  const sendTest = async () => {
    const to = Array.from(new Set([user?.email, profile?.email, ...extraEmails].filter(Boolean))) as string[];
    if (to.length === 0) { setTestMsg('No email on file.'); return; }
    setTestMsg('Sending…');
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'payroll-test', to, data: { familyName: family?.name } }),
      });
      const j = await res.json().catch(() => ({}));
      setTestMsg(j?.skipped ? 'Email isn’t switched on yet (operator sets the key) — saved your settings though.' : `Test sent to ${to.length} inbox${to.length === 1 ? '' : 'es'}.`);
    } catch { setTestMsg('Could not send — try again.'); }
  };

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

      {/* Daily performance email — per-parent opt-in (2026-05-20). */}
      {isParent && (
        <div className="mt-4 pt-4 border-t border-kaya-warm-dark/40">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-2">Email digest</p>
          <button
            type="button"
            onClick={toggleDigest}
            disabled={digestBusy}
            className="w-full flex items-center gap-3 text-left disabled:opacity-60"
          >
            <span
              className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                digestEmail ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  digestEmail ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-kaya-chocolate">Daily helper performance email</span>
              <span className="block text-[11px] text-kaya-sand leading-relaxed mt-0.5">
                Each evening, get an email summarising every helper&apos;s score. Just for you — the other parent decides separately.
              </span>
            </span>
          </button>
        </div>
      )}

      {/* Payroll emails — up to 2 extra inboxes + per-event prefs (2026-06-08). */}
      {isParent && family?.id && (
        <div className="mt-4 pt-4 border-t border-kaya-warm-dark/40">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-2">📧 Payroll emails</p>

          {/* Extra inboxes */}
          <p className="text-[11px] text-kaya-sand leading-relaxed mb-1.5">
            Emails go to your login email{extraEmails.length > 0 ? '' : ' — add up to 2 more inboxes for visibility'}.
          </p>
          <div className="space-y-1.5">
            {extraEmails.map((e) => (
              <div key={e} className="flex items-center gap-2 p-2 rounded-kaya-sm bg-kaya-cream">
                <span className="text-[11px] font-semibold flex-1 min-w-0 truncate">📩 {e}</span>
                <button onClick={() => removeEmail(e)} className="text-[10px] font-bold text-red-500 px-2">Remove</button>
              </div>
            ))}
          </div>
          {extraEmails.length < 2 && (
            <div className="flex items-center gap-2 mt-2">
              <input
                type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addEmail(); }}
                placeholder="another@email.com"
                className="flex-1 h-9 px-3 bg-white border border-kaya-warm-dark rounded-kaya-sm text-[12px] font-semibold focus:outline-none focus:border-kaya-chocolate"
              />
              <button onClick={addEmail} className="h-9 px-3 bg-kaya-chocolate text-white rounded-kaya-sm text-[11px] font-black">＋ Add</button>
            </div>
          )}

          {/* Per-event toggles */}
          <p className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider mt-3 mb-1.5">What emails you</p>
          <div className="space-y-1">
            {([
              ['salaryRaised', '💰 Salary raised (≈7 days before month-end)'],
              ['markPaidDue', '⏰ Time to mark salary paid (pay window opens)'],
              ['approvals', '✅ Approvals waiting'],
              ['salaryPaid', '🧾 Salary marked paid (receipt)'],
            ] as [keyof typeof pnEvents, string][]).map(([k, label]) => (
              <button key={k} type="button" onClick={() => toggleEvent(k)} className="w-full flex items-center justify-between gap-3 py-1.5 text-left">
                <span className="text-[12px] font-semibold text-kaya-chocolate min-w-0">{label}</span>
                <span className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${pnEvents[k] ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${pnEvents[k] ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                </span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-3">
            <button onClick={sendTest} className="h-9 px-3 bg-white border border-kaya-warm-dark rounded-kaya-sm text-[11px] font-black text-kaya-chocolate">✉️ Send test email</button>
            {testMsg && <span className="text-[10.5px] text-kaya-sand font-semibold">{testMsg}</span>}
          </div>
          <p className="text-[10px] text-kaya-sand-light leading-relaxed mt-2">Changes save automatically.</p>
        </div>
      )}
    </div>
  );
}
