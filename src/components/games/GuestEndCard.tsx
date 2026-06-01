'use client';

import { useState, type ReactNode } from 'react';
import { auth } from '@/lib/firebase';
import { referralLink } from '@/lib/referral';

// The "bring Kaya home" card a guest sees when their game ends. Branches by who
// they said they were at join:
//   • Kid        → share your referral link with a grown-up (parent-led).
//   • Grown-up   → join the waitlist (email) with your referral code applied,
//                  OR "already on Kaya" → tag their @handle to save a pending
//                  family connection for the future.

export default function GuestEndCard({
  isKid, guestName, guestUid, referralCode, hostFamilyName, hostHandle, hostFamilyId,
}: {
  isKid: boolean;
  guestName: string;
  guestUid: string;
  referralCode?: string | null;
  hostFamilyName?: string;
  hostHandle?: string | null;
  hostFamilyId: string;
}) {
  const link = referralCode ? referralLink(referralCode) : 'https://www.ourkaya.com';
  const [member, setMember] = useState(false);
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'' | 'waitlist' | 'connected'>('');
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const data = { title: 'Kaya', text: `${hostFamilyName || 'A family'} invited you to Kaya 💜`, url: link };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard?.writeText(link); setCopied(true); } } catch { /* cancelled */ }
  };
  const copy = async () => { try { await navigator.clipboard?.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* noop */ } };

  const joinWaitlist = async () => {
    const e = email.trim();
    if (!e || busy) return;
    setBusy(true);
    try {
      await fetch('/api/waitlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: guestName, email: e, ref: referralCode || undefined, source: 'guest-play' }),
      });
      setDone('waitlist');
    } catch { /* show optimistic done anyway */ setDone('waitlist'); }
    finally { setBusy(false); }
  };

  const connect = async () => {
    const h = handle.trim().replace(/^@/, '');
    if (!h || busy) return;
    setBusy(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      await fetch('/api/games/guest/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ hostFamilyId, hostHandle, guestName, guestHandle: h, guestUid }),
      });
      setDone('connected');
    } catch { setDone('connected'); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-white flex items-center justify-center p-5">
      <div className="w-full max-w-sm text-center">
        <div className="text-5xl mb-1">🎉</div>
        <h1 className="font-display text-2xl font-black text-games-ink mb-1">That was fun, {guestName}!</h1>

        {/* ── KID ───────────────────────────────────────────────── */}
        {isKid ? (
          <>
            <div className="bg-gradient-to-b from-white to-games-bg border border-games-violet/20 rounded-kaya-lg p-5 my-4 shadow-[0_8px_22px_rgba(26,18,64,0.1)]">
              <div className="text-3xl">💜</div>
              <p className="font-display font-black text-lg text-games-ink mt-1 mb-1.5">Bring Kaya to your family</p>
              <p className="text-xs text-games-ink-soft mb-3">Your family&rsquo;s private world — chores, games, savings &amp; more. No ads, ever.</p>
              <div className="bg-games-bg border border-dashed border-games-violet/40 rounded-kaya px-3 py-2 font-display font-extrabold text-xs text-games-violet-deep break-all">{link}</div>
              <button type="button" onClick={share} className="w-full bg-games-teal text-white font-display font-extrabold py-3 rounded-full mt-3">💬 Share with my grown-up</button>
              <button type="button" onClick={copy} className="w-full bg-white border border-games-violet/20 text-games-violet-deep font-display font-extrabold py-3 rounded-full mt-2">{copied ? 'Copied ✓' : 'Copy link'}</button>
            </div>
            <p className="text-[11px] text-games-ink-soft">👨‍👩‍👧 A parent sets it up — they&rsquo;ll get you in safely.<br />{hostFamilyName ? <><b className="text-games-ink">{hostFamilyName}</b> invited you ✨</> : 'Invited via Kaya ✨'}</p>
          </>
        ) : done === 'waitlist' ? (
          <Confirm emoji="✅" title="You're on the list!" body={<>We&rsquo;ll email you early access. <b className="text-games-ink">{hostFamilyName || 'Your host'}</b> gets the referral credit 🎁</>} />
        ) : done === 'connected' ? (
          <Confirm emoji="🔗" title="Saved!" body={<>@{handle.trim().replace(/^@/, '')} ⇄ {hostFamilyName || 'their family'}. You&rsquo;ll both get a &ldquo;Connect?&rdquo; nudge when family links go live.</>} />
        ) : member ? (
          /* ── ALREADY A MEMBER ──────────────────────────────────── */
          <>
            <div className="bg-gradient-to-b from-white to-games-bg border border-games-violet/20 rounded-kaya-lg p-5 my-4 shadow-[0_8px_22px_rgba(26,18,64,0.1)]">
              <div className="text-3xl">👋</div>
              <p className="font-display font-black text-lg text-games-ink mt-1 mb-1.5">Connect with {hostFamilyName || 'this family'}?</p>
              <p className="text-xs text-games-ink-soft mb-3">Tag your handle — we&rsquo;ll link your families when Kaya opens <b className="text-games-ink">family connections</b>.</p>
              <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@yourhandle" autoCapitalize="none"
                className="w-full bg-white border border-games-violet/20 rounded-kaya px-3 py-2.5 text-center font-bold text-games-ink outline-none" />
              <button type="button" onClick={connect} disabled={busy} className="w-full bg-games-violet text-white font-display font-extrabold py-3 rounded-full mt-3 disabled:opacity-60">{busy ? 'Saving…' : '✨ Yes, connect us'}</button>
            </div>
            <button type="button" onClick={() => setMember(false)} className="text-[11px] font-bold text-games-ink-soft underline">← I&rsquo;m new to Kaya</button>
          </>
        ) : (
          /* ── GROWN-UP, NEW ─────────────────────────────────────── */
          <>
            <div className="bg-gradient-to-b from-white to-games-bg border border-games-violet/20 rounded-kaya-lg p-5 my-4 shadow-[0_8px_22px_rgba(26,18,64,0.1)]">
              <div className="text-3xl">💜</div>
              <p className="font-display font-black text-lg text-games-ink mt-1 mb-1.5">Get Kaya for your family</p>
              <p className="text-xs text-games-ink-soft mb-3">We&rsquo;re in early access — join the waitlist and <b className="text-games-ink">{hostFamilyName || 'your host'}</b>&rsquo;s invite bumps you to the front.</p>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@email.com" autoCapitalize="none"
                className="w-full bg-white border border-games-violet/20 rounded-kaya px-3 py-2.5 text-center font-bold text-games-ink outline-none" />
              <button type="button" onClick={joinWaitlist} disabled={busy} className="w-full bg-games-teal text-white font-display font-extrabold py-3 rounded-full mt-3 disabled:opacity-60">{busy ? 'Joining…' : 'Join the waitlist →'}</button>
              <div className="border-t border-games-bg mt-3 pt-2.5">
                <button type="button" onClick={() => setMember(true)} className="text-[11px] font-bold text-games-ink-soft">Already on Kaya? <span className="text-games-violet font-extrabold">Tap &ldquo;Yes&rdquo; →</span></button>
              </div>
            </div>
            <p className="text-[11px] text-games-ink-soft">When sign-up opens you come straight in — and <b className="text-games-ink">{hostFamilyName || 'your host'}</b> gets the referral credit 🎁</p>
          </>
        )}
      </div>
    </div>
  );
}

function Confirm({ emoji, title, body }: { emoji: string; title: string; body: ReactNode }) {
  return (
    <div className="bg-games-mint/40 border border-games-teal/30 rounded-kaya-lg p-6 my-4">
      <div className="text-4xl mb-1">{emoji}</div>
      <p className="font-display font-black text-lg text-games-ink mb-1.5">{title}</p>
      <p className="text-xs text-games-ink-soft">{body}</p>
      <a href="https://www.ourkaya.com" className="inline-block mt-4 text-xs font-extrabold text-games-violet">Learn more about Kaya →</a>
    </div>
  );
}
