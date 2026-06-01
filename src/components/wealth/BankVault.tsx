'use client';

// Kaya Wealth · Bank Accounts vault (Phase 2 · PR5 · 2026-06-01).
//
// Personal-only, owner-only. Numbers are masked (•••• tail) until a fresh
// 2FA step-up reveals them (auto-re-hides after 30s). Add + remove also
// require a step-up. Reuses the mockup's bank styling from wealth.css.

import { useEffect, useRef, useState } from 'react';
import { auth } from '@/lib/firebase';
import { formatCents } from '@/components/pantry/format';
import { SUPPORTED_CURRENCIES } from '@/lib/fx';
import {
  subscribeBankAccounts, addBank, revealBank, deleteBank,
  BANK_TYPE_LABEL, type BankAccountMasked, type BankAccountType,
} from './bankVaultClient';
import { MoneyInput, moneyToCents } from './MoneyInput';

const groupDigits = (n: string) => n.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim();

function errText(code?: string): string {
  if (code === 'step-up-failed') return 'That 2FA code didn’t match. Try again.';
  if (code === 'vault-not-configured') return '2FA isn’t set up yet — enrol your authenticator first.';
  if (code === 'bad-number') return 'That account number looks too short.';
  return 'Something went wrong. Try again.';
}

export default function BankVault({ uid }: { uid: string }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<BankAccountMasked[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [stepUp, setStepUp] = useState<null | { kind: 'reveal' | 'delete'; acctId: string; bankName: string }>(null);
  const [addOpen, setAddOpen] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let off = false;
    (async () => {
      const u = auth.currentUser;
      const token = u ? await u.getIdToken() : '';
      try {
        const r = await fetch('/api/wealth/vault/status', { headers: { authorization: `Bearer ${token}` } });
        const s = await r.json();
        if (!off) setConfigured(!!s?.cryptoConfigured && !!s?.enrolled);
      } catch { if (!off) setConfigured(false); }
    })();
    return () => { off = true; };
  }, []);

  useEffect(() => { if (uid) return subscribeBankAccounts(uid, setAccounts); }, [uid]);

  const reveal = (id: string, number: string) => {
    setRevealed((p) => ({ ...p, [id]: number }));
    if (timers.current[id]) clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => setRevealed((p) => { const n = { ...p }; delete n[id]; return n; }), 30000);
  };
  const hide = (id: string) => setRevealed((p) => { const n = { ...p }; delete n[id]; return n; });

  if (configured === false) {
    return (
      <div className="personal-block">
        <div className="section-title"><h2>🏦 Bank Accounts <span className="pilltag">Personal · extra-protected</span></h2></div>
        <div className="card"><div className="empty"><div className="ee">🔒</div><div className="eh">Set up 2FA to use the bank vault</div>
          <div className="ep">Account numbers are encrypted and revealed only after a fresh 2FA check. Enrol your authenticator from the vault lock first.</div></div></div>
      </div>
    );
  }

  return (
    <div className="personal-block">
      <div className="section-title"><h2>🏦 Bank Accounts <span className="pilltag">Personal · extra-protected</span></h2><a onClick={() => setAddOpen(true)}>+ Add account</a></div>
      <div className="card">
        <div className="bankhead"><span className="protected">🔒 Sensitive — re-auth to reveal</span></div>
        {accounts.length === 0 && <div className="empty"><div className="ep">No accounts yet. Add one — the number is encrypted, and only you can reveal it with 2FA.</div></div>}
        {accounts.map((a) => (
          <div className="bankrow" key={a.id}>
            <div className="blogo">{a.bankName.slice(0, 3).toUpperCase()}</div>
            <div className="bi">
              <div className="bn">{a.bankName} <span className={`acctype ${a.type === 'operating' ? 'op' : ''}`}>{BANK_TYPE_LABEL[a.type]}</span></div>
              <div className="bm">{revealed[a.id] ? groupDigits(revealed[a.id]) : `•••• •••• ${a.tail}`}</div>
            </div>
            <div className="bv">
              {a.balanceCents != null && <div className="amt">{formatCents(a.balanceCents, a.currency)}</div>}
              {revealed[a.id]
                ? <button className="reveal" onClick={() => hide(a.id)}>Hide</button>
                : <button className="reveal" onClick={() => setStepUp({ kind: 'reveal', acctId: a.id, bankName: a.bankName })}>Reveal number</button>}
            </div>
            <div className="acts"><button className="iconbtn" title="Remove" onClick={() => setStepUp({ kind: 'delete', acctId: a.id, bankName: a.bankName })}>🗑️</button></div>
          </div>
        ))}
        <button className="addbtn" onClick={() => setAddOpen(true)}>+ Add bank account</button>
        <div className="bankguard">🛡️ <span><b>Extra protection:</b> numbers are encrypted and masked by default. Revealing, adding, or removing an account needs a fresh 2FA check — even inside an unlocked vault. Visible only to you.</span></div>
      </div>

      {stepUp && (
        <StepUpModal
          title={stepUp.kind === 'reveal' ? `Reveal · ${stepUp.bankName}` : `Remove ${stepUp.bankName}?`}
          confirmLabel={stepUp.kind === 'reveal' ? 'Reveal number' : 'Remove account'}
          danger={stepUp.kind === 'delete'}
          onClose={() => setStepUp(null)}
          onSubmit={async (code) => {
            if (stepUp.kind === 'reveal') {
              const r = await revealBank(stepUp.acctId, code);
              if (r.ok && r.number) { reveal(stepUp.acctId, r.number); setStepUp(null); return null; }
              return errText(r.error);
            }
            const r = await deleteBank(stepUp.acctId, code);
            if (r.ok) { setStepUp(null); return null; }
            return errText(r.error);
          }}
        />
      )}

      {addOpen && <AddBankModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}

// ── Step-up modal (enter a fresh 2FA code) ───────────────────────────

function StepUpModal({ title, confirmLabel, danger, onClose, onSubmit }: {
  title: string; confirmLabel: string; danger?: boolean;
  onClose: () => void; onSubmit: (code: string) => Promise<string | null>;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ready = /^\d{6}$/.test(code);
  const go = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr('');
    const e = await onSubmit(code);
    if (e) { setErr(e); setBusy(false); }
  };
  return (
    <div className="kw-modal-back" onClick={onClose}>
      <div className="kw-modal" onClick={(e) => e.stopPropagation()}>
        <h3>🔐 {title}</h3>
        <div className="msub">Enter the 6-digit code from your authenticator app.</div>
        <input className="v-recinput" style={{ color: '#0F1F44', borderColor: '#E7E0D0', background: '#fff' }}
          inputMode="numeric" maxLength={6} value={code} placeholder="••••••"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => { if (e.key === 'Enter') go(); }} autoFocus />
        {err && <div style={{ color: '#c0392b', fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>{err}</div>}
        <div className="kw-modal-actions">
          <button className="kw-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="kw-btn-primary" style={danger ? { background: '#E85C5C', color: '#fff' } : undefined} disabled={!ready || busy} onClick={go}>
            {busy ? 'Checking…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add-account modal (details + step-up code) ───────────────────────

function AddBankModal({ onClose }: { onClose: () => void }) {
  const [bankName, setBankName] = useState('');
  const [type, setType] = useState<BankAccountType>('operating');
  const [currency, setCurrency] = useState('TZS');
  const [fullNumber, setFullNumber] = useState('');
  const [balance, setBalance] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ready = bankName.trim().length > 0 && fullNumber.replace(/\D/g, '').length >= 4 && /^\d{6}$/.test(code) && !busy;

  const save = async () => {
    if (!ready) return;
    setBusy(true); setErr('');
    const r = await addBank({
      code, bankName: bankName.trim(), type, currency,
      balanceCents: balance ? moneyToCents(balance) : null,
      fullNumber,
    });
    if (r.ok) { onClose(); return; }
    setErr(errText(r.error)); setBusy(false);
  };

  return (
    <div className="kw-modal-back" onClick={onClose}>
      <div className="kw-modal" onClick={(e) => e.stopPropagation()}>
        <h3>🏦 Add bank account</h3>
        <div className="msub">Private to you. The number is encrypted; only the last 4 show until you reveal it.</div>
        <div className="kw-field"><label>Bank</label><input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="NMB" /></div>
        <div className="kw-row2">
          <div className="kw-field"><label>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as BankAccountType)}>
              <option value="operating">Operating</option><option value="savings">Savings</option><option value="fx">FX</option><option value="other">Other</option>
            </select>
          </div>
          <div className="kw-field"><label>Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </div>
        </div>
        <div className="kw-field"><label>Account number</label><input inputMode="numeric" value={fullNumber} onChange={(e) => setFullNumber(e.target.value)} placeholder="0000 0000 0000" /></div>
        <div className="kw-field"><label>Balance ({currency}) <span style={{ color: '#9a9a9a', fontWeight: 500 }}>(optional)</span></label><MoneyInput value={balance} onChange={setBalance} placeholder="0" /></div>
        <div className="kw-field" style={{ marginBottom: 6 }}><label>🔐 Your 2FA code (to save)</label><input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" /></div>
        {err && <div style={{ color: '#c0392b', fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>{err}</div>}
        <div className="kw-modal-actions">
          <button className="kw-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="kw-btn-primary" disabled={!ready} onClick={save}>{busy ? 'Saving…' : 'Add account'}</button>
        </div>
      </div>
    </div>
  );
}
