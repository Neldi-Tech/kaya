'use client';

// Kaya Wealth · vault lock (PR2 · 2026-06-01).
//
// Replaces PR1's session gate with real, server-verified TOTP 2FA. On mount
// it asks /api/wealth/vault/status which branch to show:
//   • not configured  → legacy session gate (any code unlocks; activates real
//     2FA once WEALTH_VAULT_ENC_KEY is set in the environment)
//   • configured, not enrolled → enrollment (QR + manual key + recovery codes)
//   • configured + enrolled    → unlock (6-digit TOTP, or a recovery code)
// On a verified unlock it calls onUnlock() — the page then holds the session
// open (sessionStorage) with idle auto-lock, exactly as before.

import { useEffect, useRef, useState } from 'react';
import { auth } from '@/lib/firebase';

type Phase = 'loading' | 'legacy' | 'unlock' | 'enroll' | 'enroll-show' | 'enroll-confirm';

type VaultResp = {
  ok?: boolean; cryptoConfigured?: boolean; enrolled?: boolean;
  qrDataUrl?: string; secret?: string; recoveryCodes?: string[]; error?: string;
} | null;

interface EnrollData { qrDataUrl: string; secret: string; recoveryCodes: string[] }

async function vaultFetch(path: string, body?: object): Promise<VaultResp> {
  const u = auth.currentUser;
  const token = u ? await u.getIdToken() : '';
  try {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await res.json()) as VaultResp;
  } catch {
    return null;
  }
}

const RING = (
  <div className="vault-ring"><svg viewBox="0 0 48 48"><path d="M24 3 L42 11 V24 C42 35 34 43 24 46 C14 43 6 35 6 24 V11 Z" fill="none" stroke="#D4A847" strokeWidth="2" /><rect x="18" y="22" width="12" height="11" rx="2" fill="#D4A847" /><path d="M20 22 V18 a4 4 0 0 1 8 0 V22" fill="none" stroke="#D4A847" strokeWidth="2" /></svg></div>
);

function CodeEntry({ onSubmit, busy, label }: { onSubmit: (code: string) => void; busy: boolean; label: string }) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const ready = digits.every((d) => d.length === 1);
  const onChange = (i: number, v: string) => {
    const c = v.replace(/\D/g, '').slice(-1);
    const next = [...digits]; next[i] = c;
    setDigits(next);
    if (c && refs.current[i + 1]) refs.current[i + 1]?.focus();
    // Auto-submit the moment all six digits are in — no Enter / button needed.
    if (next.every((d) => d.length === 1) && !busy) onSubmit(next.join(''));
  };
  return (
    <>
      <div className="otp">
        {digits.map((d, i) => (
          <input key={i} ref={(el) => { refs.current[i] = el; }} maxLength={1} inputMode="numeric" value={d}
            onChange={(e) => onChange(i, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ready && !busy) onSubmit(digits.join('')); }} />
        ))}
      </div>
      <button className="unlock-btn" disabled={!ready || busy} onClick={() => onSubmit(digits.join(''))}>
        {busy ? 'Checking…' : label}
      </button>
    </>
  );
}

export default function VaultLock({ onUnlock }: { onUnlock: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [enroll, setEnroll] = useState<EnrollData | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [recCode, setRecCode] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await vaultFetch('/api/wealth/vault/status');
      if (cancelled) return;
      if (!s || !s.cryptoConfigured) setPhase('legacy');
      else if (s.enrolled) setPhase('unlock');
      else setPhase('enroll');
    })();
    return () => { cancelled = true; };
  }, []);

  const doUnlock = async (code: string) => {
    setBusy(true); setError('');
    const r = await vaultFetch('/api/wealth/vault/unlock', { code });
    setBusy(false);
    if (r?.ok) onUnlock(); else setError('That code didn’t work. Try again, or use a recovery code.');
  };
  const startEnroll = async () => {
    setBusy(true); setError('');
    const r = await vaultFetch('/api/wealth/vault/enroll', {});
    setBusy(false);
    if (r && r.ok && r.qrDataUrl && r.secret && r.recoveryCodes) {
      setEnroll({ qrDataUrl: r.qrDataUrl, secret: r.secret, recoveryCodes: r.recoveryCodes });
      setPhase('enroll-show');
    } else setError('Couldn’t start setup. Please try again.');
  };
  const confirmEnroll = async (code: string) => {
    setBusy(true); setError('');
    const r = await vaultFetch('/api/wealth/vault/enroll-verify', { code });
    setBusy(false);
    if (r?.ok) onUnlock(); else setError('That code didn’t match. Check your authenticator and try again.');
  };

  // ── Loading ──
  if (phase === 'loading') {
    return <div className="lockbox">{RING}<h2>Kaya <span>Vault</span></h2><div className="v-spin">Checking your vault…</div></div>;
  }

  // ── Enrollment intro ──
  if (phase === 'enroll') {
    return (
      <div className="lockbox">
        {RING}
        <h2>Secure your <span>Vault</span></h2>
        <p>Protect your family&apos;s wealth with two-factor authentication. You&apos;ll use any authenticator app to unlock it.</p>
        <div className="authrow">
          <span className="authchip">🔵 Google Authenticator</span>
          <span className="authchip">🟦 Microsoft Authenticator</span>
          <span className="authchip">Authy · 1Password</span>
        </div>
        <button className="unlock-btn" disabled={busy} onClick={startEnroll}>{busy ? 'Setting up…' : 'Set up 2FA'}</button>
        {error && <div className="lock-err">{error}</div>}
      </div>
    );
  }

  // ── Enrollment: show QR + manual key + recovery codes ──
  if (phase === 'enroll-show' && enroll) {
    return (
      <div className="lockbox">
        <h2>Scan to <span>enrol</span></h2>
        <p>Scan this with your authenticator app, or type the key in by hand.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="v-qr" src={enroll.qrDataUrl} alt="Vault 2FA QR code" />
        <div className="v-label">Manual key</div>
        <div className="v-secret">{enroll.secret}</div>
        <div className="v-label">Recovery codes</div>
        <div className="v-reco">{enroll.recoveryCodes.map((c) => <span key={c}>{c}</span>)}</div>
        <div className="v-warn">⚠️ Save these somewhere safe. Each works once and is your only way in if you lose your phone.</div>
        <button className="unlock-btn" onClick={() => { setError(''); setPhase('enroll-confirm'); }}>I&apos;ve saved my codes — continue</button>
      </div>
    );
  }

  // ── Enrollment: confirm with a live code ──
  if (phase === 'enroll-confirm') {
    return (
      <div className="lockbox">
        {RING}
        <h2>Confirm <span>setup</span></h2>
        <p>Enter the 6-digit code your authenticator shows now.</p>
        <CodeEntry onSubmit={confirmEnroll} busy={busy} label="Confirm & unlock" />
        {error && <div className="lock-err">{error}</div>}
        <button className="v-link" onClick={() => { setError(''); setPhase('enroll-show'); }}>← Back to the QR code</button>
      </div>
    );
  }

  // ── Unlock (enrolled) ──
  if (phase === 'unlock') {
    return (
      <div className="lockbox">
        {RING}
        <h2>Kaya <span>Vault</span></h2>
        {!recovery ? (
          <>
            <p>Enter the 6-digit code from your authenticator app.</p>
            <CodeEntry onSubmit={doUnlock} busy={busy} label="Unlock Vault" />
            {error && <div className="lock-err">{error}</div>}
            <button className="v-link" onClick={() => { setError(''); setRecovery(true); }}>Use a recovery code instead</button>
          </>
        ) : (
          <>
            <p>Enter one of your saved recovery codes.</p>
            <input className="v-recinput" value={recCode} placeholder="XXXXX-XXXXX"
              onChange={(e) => setRecCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) doUnlock(recCode); }} />
            <button className="unlock-btn" disabled={busy || !recCode} onClick={() => doUnlock(recCode)}>{busy ? 'Checking…' : 'Unlock with recovery code'}</button>
            {error && <div className="lock-err">{error}</div>}
            <button className="v-link" onClick={() => { setError(''); setRecovery(false); }}>← Use my authenticator</button>
          </>
        )}
        <div className="lock-meta">🔒 Any TOTP app works · Auto-locks after 5 min idle</div>
      </div>
    );
  }

  // ── Legacy session gate (2FA not yet configured) ──
  return (
    <div className="lockbox">
      {RING}
      <h2>Kaya <span>Vault</span></h2>
      <p>Enter any 6-digit code to open the vault.</p>
      <CodeEntry onSubmit={() => onUnlock()} busy={false} label="Unlock Vault" />
      <button className="bio" onClick={() => onUnlock()}>👤 Use Face ID instead</button>
      <div className="lock-meta">🔒 2FA activates once your vault key is set · Auto-locks after 5 min idle</div>
    </div>
  );
}
