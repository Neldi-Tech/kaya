'use client';

// 🔐 Security & privacy (SET PR4 · M11–M13, M15–M16) — every active login
// channel, the right reset for each; approved v2 design 22-Jul-2026.
//
//   • Your login first — email shown, change-in-place (re-auth) or reset mail.
//   • 👶 Kids mini-section — active channel chips (✉️ email / 🔑 Kaya Code);
//     email resets offer default-password-by-mail OR set-your-own link (both
//     via the parent-only /api/security/kid-login route); 🔑 New code via the
//     existing COPPA generate-code route (plaintext shown once).
//   • 🧹 Helpers — only the channels each actually has; stored password with
//     the 👁 reveal (readable by design) + reset via /api/helpers/reset-password.
//   • Privacy links + 🩺 checkup strip + "Sign out everywhere" (Bonus A).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { listHelpers } from '@/lib/helpers';
import type { HelperLink } from '@/lib/firestore';
import { generateChildCode } from '@/lib/coppa/client';
import { useEffect } from 'react';

type Msg = { tone: 'ok' | 'err'; text: string } | null;

export default function SecurityPrivacyCard() {
  const { user, profile } = useAuth();
  const { family, children: kids } = useFamily();
  const familyId = profile?.familyId;

  const [helpers, setHelpers] = useState<HelperLink[]>([]);
  useEffect(() => {
    if (!familyId) return;
    listHelpers(familyId).then(setHelpers).catch(() => setHelpers([]));
  }, [familyId]);

  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // ── Your login ──────────────────────────────────────────────────────
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const changeMyPassword = async () => {
    if (!auth.currentUser?.email || busy) return;
    if (newPw.length < 6) { setMsg({ tone: 'err', text: 'New password needs at least 6 characters.' }); return; }
    setBusy('me');
    try {
      await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, curPw));
      await updatePassword(auth.currentUser, newPw);
      setPwOpen(false); setCurPw(''); setNewPw('');
      setMsg({ tone: 'ok', text: '✓ Your password is changed.' });
    } catch {
      setMsg({ tone: 'err', text: 'Could not change it — check your current password.' });
    } finally { setBusy(null); }
  };
  const emailMyReset = async () => {
    if (!auth.currentUser?.email || busy) return;
    setBusy('me');
    try { await sendPasswordResetEmail(auth, auth.currentUser.email); setMsg({ tone: 'ok', text: `✓ Reset email sent to ${auth.currentUser.email}.` }); }
    catch { setMsg({ tone: 'err', text: 'Could not send the reset email.' }); }
    finally { setBusy(null); }
  };

  // ── Kids ────────────────────────────────────────────────────────────
  const [resetOpenFor, setResetOpenFor] = useState<string | null>(null);
  const [freshCode, setFreshCode] = useState<{ childId: string; code: string } | null>(null);

  const kidEmailReset = async (childId: string, mode: 'default-password' | 'reset-link') => {
    if (!user || busy) return;
    setBusy(childId);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/security/kid-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ childId, mode }),
      });
      const data = (await res.json()) as { ok?: boolean; sentTo?: string; error?: string };
      setMsg(data.ok
        ? { tone: 'ok', text: mode === 'default-password' ? `✓ A default password is on its way to ${data.sentTo}. They'll be asked to change it.` : `✓ A set-your-own link is on its way to ${data.sentTo}.` }
        : { tone: 'err', text: data.error === 'kid-has-not-signed-in-yet' ? 'This kid has never signed in with email yet — share a Kaya Code instead.' : 'Reset failed — try again.' });
    } catch { setMsg({ tone: 'err', text: 'Reset failed — try again.' }); }
    finally { setBusy(null); setResetOpenFor(null); }
  };

  const newKidCode = async (childId: string) => {
    if (!user || busy) return;
    setBusy(childId);
    try {
      const res = await generateChildCode(user, { childId });
      if (res.ok && res.code) { setFreshCode({ childId, code: res.code }); setMsg({ tone: 'ok', text: '✓ New Kaya Code issued — the old one stopped working.' }); }
      else setMsg({ tone: 'err', text: 'Could not issue a new code.' });
    } finally { setBusy(null); setResetOpenFor(null); }
  };

  // ── Helpers ─────────────────────────────────────────────────────────
  const [revealFor, setRevealFor] = useState<string | null>(null);
  const resetHelper = async (helperUid: string) => {
    if (!user || !familyId || busy) return;
    setBusy(helperUid);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/helpers/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ familyId, helperUid }),
      });
      const data = (await res.json()) as { ok?: boolean; password?: string };
      if (data.ok && data.password) {
        setHelpers((hs) => hs.map((h) => (h.uid === helperUid ? { ...h, password: data.password } : h)));
        setRevealFor(helperUid);
        setMsg({ tone: 'ok', text: '✓ New helper password set — hand it over below (👁).' });
      } else setMsg({ tone: 'err', text: 'Helper reset failed.' });
    } catch { setMsg({ tone: 'err', text: 'Helper reset failed.' }); }
    finally { setBusy(null); }
  };

  // ── 🩺 Checkup (M16) — honest findings from data we actually have ───
  const findings = useMemo(() => {
    const out: { icon: string; text: string }[] = [];
    for (const k of kids) {
      if (k.email && k.loginEnabled === false) out.push({ icon: '⚠️', text: `${k.name.split(' ')[0]} has an email saved but email sign-in is OFF` });
      if (!k.email && k.loginEnabled) out.push({ icon: '⚠️', text: `${k.name.split(' ')[0]} has email sign-in ON but no email saved` });
    }
    for (const h of helpers) {
      if (!h.password) out.push({ icon: '⚠️', text: `${h.displayName} has no stored password yet — reset to set one` });
    }
    return out;
  }, [kids, helpers]);
  const score = Math.max(1, 5 - findings.length);

  const [signoutConfirm, setSignoutConfirm] = useState(false);
  const signOutEverywhere = async () => {
    if (!user || busy) return;
    setBusy('signout');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/security/signout-all', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json()) as { ok?: boolean; revoked?: number };
      setMsg(data.ok ? { tone: 'ok', text: `✓ ${data.revoked} account(s) signed out everywhere (live sessions end within the hour).` } : { tone: 'err', text: 'Could not sign everyone out.' });
    } finally { setBusy(null); setSignoutConfirm(false); }
  };

  const label = 'text-[11px] font-bold uppercase tracking-wide text-kaya-sand';
  const btn = 'px-2.5 py-1.5 rounded-kaya-sm border border-kaya-warm-dark text-[11.5px] font-extrabold hover:border-kaya-gold transition disabled:opacity-50';

  return (
    <div className="space-y-4">
      {/* 🩺 checkup strip */}
      <div className="rounded-kaya border border-kaya-warm-dark/60 bg-kaya-cream p-3">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">🩺</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-extrabold">Security: {findings.length === 0 ? 'Great' : findings.length === 1 ? 'Good' : 'Needs a look'} · {score}/5</p>
            <p className="text-[11px] text-kaya-sand font-semibold">{findings.length === 0 ? 'Everything looks healthy ✓' : `${findings.length} thing${findings.length === 1 ? '' : 's'} to tidy up`}</p>
          </div>
          {signoutConfirm ? (
            <span className="flex gap-1.5">
              <button type="button" className={`${btn} bg-hive-rose text-white border-hive-rose`} disabled={busy === 'signout'} onClick={signOutEverywhere}>Yes, everyone</button>
              <button type="button" className={btn} onClick={() => setSignoutConfirm(false)}>Cancel</button>
            </span>
          ) : (
            <button type="button" className={btn} onClick={() => setSignoutConfirm(true)}>Sign out everywhere</button>
          )}
        </div>
        {findings.map((f, i) => (
          <p key={i} className="text-[11px] font-semibold mt-1.5 pl-1">{f.icon} {f.text}</p>
        ))}
      </div>

      {msg && (
        <p className={`text-[12px] font-bold rounded-kaya-sm px-3 py-2 ${msg.tone === 'ok' ? 'bg-[#E7F5EC] text-pantry-leaf-dk' : 'bg-[#FCEAEA] text-hive-rose'}`}>{msg.text}</p>
      )}

      {/* Your login */}
      <div>
        <p className={label}>Your login</p>
        <div className="flex items-center gap-2.5 py-2">
          <span className="w-8 h-8 rounded-full bg-kaya-warm flex items-center justify-center text-[15px] shrink-0">👤</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold truncate">{profile?.displayName || 'You'}</p>
            <p className="text-[11px] text-kaya-sand truncate">✉️ {profile?.email}</p>
          </div>
          <button type="button" className={btn} onClick={() => setPwOpen((o) => !o)}>Change…</button>
          <button type="button" className={btn} disabled={busy === 'me'} onClick={emailMyReset}>Reset ✉️</button>
        </div>
        {pwOpen && (
          <div className="rounded-kaya-sm border border-dashed border-kaya-warm-dark p-3 space-y-2">
            <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder="Current password" className="w-full rounded-kaya-sm border border-kaya-warm-dark/70 px-3 py-2 text-[13px]" />
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password (6+ characters)" className="w-full rounded-kaya-sm border border-kaya-warm-dark/70 px-3 py-2 text-[13px]" />
            <button type="button" className={`${btn} bg-kaya-gold text-white border-kaya-gold-dark`} disabled={busy === 'me'} onClick={changeMyPassword}>Save new password</button>
          </div>
        )}
      </div>

      {/* 👶 Kids */}
      <div>
        <p className={label}>👶 Kids</p>
        {kids.map((k) => {
          const emailActive = !!k.email && k.loginEnabled !== false && !!k.loginEnabled;
          const first = k.name.split(' ')[0];
          return (
            <div key={k.id} className="border-b border-dashed border-kaya-warm-dark/60 last:border-b-0 py-2">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-full bg-kaya-warm flex items-center justify-center text-[15px] shrink-0">{k.avatarEmoji || '🧒'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold truncate">{k.name}</p>
                  <p className="text-[11px] text-kaya-sand truncate">
                    {emailActive && <span className="mr-1.5">✉️ Email</span>}
                    <span>🔑 Kaya Code</span>
                    {!emailActive && <span> · no email login</span>}
                  </p>
                </div>
                {emailActive ? (
                  <button type="button" className={btn} disabled={busy === k.id} onClick={() => setResetOpenFor(resetOpenFor === k.id ? null : k.id)}>Reset ▾</button>
                ) : (
                  <button type="button" className={btn} disabled={busy === k.id} onClick={() => newKidCode(k.id)}>New code</button>
                )}
              </div>
              {resetOpenFor === k.id && (
                <div className="mt-2 rounded-kaya-sm border border-dashed border-kaya-gold/60 bg-kaya-gold-light/40 p-3 space-y-1.5">
                  <p className="text-[11px] font-extrabold text-kaya-gold-dark uppercase tracking-wide">Reset {first}&rsquo;s login</p>
                  <button type="button" className={`${btn} w-full text-left`} onClick={() => kidEmailReset(k.id, 'default-password')}>📮 Send a <b>default password</b> to their email — they change it at next sign-in</button>
                  <button type="button" className={`${btn} w-full text-left`} onClick={() => kidEmailReset(k.id, 'reset-link')}>🔗 Send a link so they <b>set their own</b></button>
                  <button type="button" className={`${btn} w-full text-left`} onClick={() => newKidCode(k.id)}>🔑 <b>New Kaya Code</b> — the old one stops working</button>
                </div>
              )}
              {freshCode?.childId === k.id && (
                <p className="mt-2 text-[12px] font-black tracking-[3px] text-center bg-kaya-cream border border-kaya-gold/50 rounded-kaya-sm py-2">
                  {freshCode.code}
                  <span className="block text-[10px] font-bold tracking-normal text-kaya-sand mt-0.5">share it now — it won&rsquo;t be shown again</span>
                </p>
              )}
            </div>
          );
        })}
        {kids.length === 0 && <p className="text-[11px] text-kaya-sand py-1">No kids yet.</p>}
      </div>

      {/* 🧹 Helpers */}
      <div>
        <p className={label}>🧹 Helpers</p>
        {helpers.map((h) => (
          <div key={h.uid} className="flex items-center gap-2.5 py-2 border-b border-dashed border-kaya-warm-dark/60 last:border-b-0">
            <span className="w-8 h-8 rounded-full bg-kaya-warm flex items-center justify-center text-[15px] shrink-0">🧹</span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold truncate">{h.displayName}</p>
              <p className="text-[11px] text-kaya-sand truncate">
                🔑 {family?.familyCode || '····'} · {h.helperCode} · {revealFor === h.uid ? (h.password || 'not set') : '•••••'}
                <button type="button" className="ml-1 align-middle" aria-label="Reveal password" onClick={() => setRevealFor(revealFor === h.uid ? null : h.uid)}>👁</button>
              </p>
            </div>
            <button type="button" className={btn} disabled={busy === h.uid} onClick={() => resetHelper(h.uid)}>Reset</button>
          </div>
        ))}
        {helpers.length === 0 && <p className="text-[11px] text-kaya-sand py-1">No helpers yet.</p>}
      </div>

      {/* Privacy (M15) */}
      <div>
        <p className={label}>Privacy</p>
        <p className="text-[12px] font-semibold mt-1 leading-relaxed">
          <Link href="/pantry/setup" className="text-kaya-gold-dark hover:underline">📬 Kids&rsquo; email updates &amp; statement mail ›</Link>
          <br />
          <Link href="/family/codes" className="text-kaya-gold-dark hover:underline">🛡 Kaya Codes &amp; COPPA consent ›</Link>
        </p>
      </div>
    </div>
  );
}
