'use client';

// Kaya · COPPA + Login — the COPPA-critical screen (/family/add-child).
//
// Issuing a Kaya Code for a child is the moment verifiable parental consent
// applies (16 C.F.R. § 312.5(b)). Two locks, both required, exactly as the
// approved design + non-negotiables specify:
//   1. A consent checkbox that is UNTICKED by default.
//   2. A password re-authentication — the parent proving presence right now.
// "Generate Kaya Code" stays disabled until BOTH are satisfied. On submit we
// re-auth (fresh auth_time), create the child, then record consent + mint the
// code atomically server-side, and hand the plaintext to the code screen once.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup } from 'firebase/auth';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { addChild } from '@/lib/firestore';
import { generateChildCode } from '@/lib/coppa/client';
import AvatarEmojiPicker from '@/components/ui/AvatarEmojiPicker';
import { stashFreshCode } from '@/lib/coppa/freshCode';

const PRESETS = [
  { color: '#D4A017', emoji: '🏅' },
  { color: '#7B9DB7', emoji: '🤍' },
  { color: '#9B8EC4', emoji: '🥈' },
  { color: '#C0392B', emoji: '❤️' },
  { color: '#27AE60', emoji: '💚' },
  { color: '#2980B9', emoji: '💙' },
];

export default function AddChildPage() {
  const { user, profile } = useAuth();
  const { children, refresh } = useFamily();
  const router = useRouter();

  const [firstName, setFirstName] = useState('');
  const [dob, setDob] = useState(''); // YYYY-MM-DD from the date input
  const [presetIdx, setPresetIdx] = useState(0);
  // Avatar picker (approved 2026-07-20) — 144 curated + type-your-own.
  const [avatarEmoji, setAvatarEmoji] = useState('🏅');
  const [consent, setConsent] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isPasswordUser = !!user?.providerData?.some((p) => p.providerId === 'password');
  const canSubmit = consent && firstName.trim() && (isPasswordUser ? password.length > 0 : true) && !busy;

  // Parents only — codes are a parental act. Helpers/kids never see this.
  if (profile && profile.role !== 'parent') {
    return (
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <p className="text-kaya-chocolate/70 text-sm">Only a parent can create a Kaya Code.</p>
      </div>
    );
  }

  const submit = async () => {
    if (!user || !profile?.familyId || !canSubmit) return;
    setBusy(true); setError('');
    try {
      // 1 · Re-authenticate — the COPPA verification mechanism. Updates the
      //     token's auth_time, which the server checks is fresh.
      if (isPasswordUser) {
        const cred = EmailAuthProvider.credential(user.email || '', password);
        await reauthenticateWithCredential(user, cred);
      } else {
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      }

      // 2 · Create the child (reuses the existing, rules-governed write).
      const idx = children.length % PRESETS.length;
      const preset = PRESETS[presetIdx] ?? PRESETS[idx];
      const childId = await addChild(profile.familyId, {
        name: firstName.trim(),
        houseName: `House ${children.length + 1}`,
        houseColor: preset.color,
        avatarEmoji: avatarEmoji.trim() || preset.emoji,
        ...(dob ? { birthday: dob } : {}),
        totalPoints: 0,
        weeklyPoints: 0,
        streak: 0,
        badges: [],
      } as Parameters<typeof addChild>[1]);

      // 3 · Record consent + mint the code (atomic, server-side, Admin SDK).
      const res = await generateChildCode(user, {
        childId,
        childFirstName: firstName.trim(),
        childDateOfBirth: dob,
        recordConsent: true,
        forceFresh: true,
      });
      if (!res.ok || !res.code) {
        setError(res.error === 'reauth-required' ? 'Please re-enter your password and try again.' : 'Could not create the code. Please try again.');
        setBusy(false);
        return;
      }

      // 4 · Hand the one-time plaintext to the code screen (sessionStorage,
      //     cleared on read — never persisted server-side).
      stashFreshCode(childId, { code: res.code, expiresAt: res.expiresAt, name: firstName.trim() });
      await refresh();
      router.push(`/family/codes/${childId}`);
    } catch (e) {
      const code = (e as { code?: string })?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') setError('That password didn’t match. Please try again.');
      else if (code === 'auth/too-many-requests') setError('Too many attempts. Please wait a moment and try again.');
      else if (code === 'auth/popup-closed-by-user') setError('');
      else setError('Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-8 py-6 font-body">
      {/* Page header */}
      <div className="mb-6">
        <div className="text-xs text-kaya-chocolate/50 font-semibold">Family · Add a child</div>
        <h1 className="font-display font-extrabold text-kaya-chocolate text-2xl">Create a Kaya Code</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left: child details ─────────────────────────────────── */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-kaya-chocolate/60 uppercase tracking-wider mb-1.5">
              Child&apos;s first name or nickname
            </label>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="e.g. Asha"
              className="w-full h-12 px-4 bg-white border border-kaya-gold/40 rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 focus:border-kaya-gold"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-kaya-chocolate/60 uppercase tracking-wider mb-1.5">
              Date of birth
            </label>
            <input
              type="date"
              value={dob}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDob(e.target.value)}
              className="w-full h-12 px-4 bg-white border border-kaya-gold/40 rounded-kaya-sm text-sm text-kaya-chocolate focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 focus:border-kaya-gold"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-kaya-chocolate/60 uppercase tracking-wider mb-1.5">
              House colour
            </label>
            <div className="flex gap-2.5 flex-wrap">
              {PRESETS.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPresetIdx(i)}
                  className={`w-11 h-11 rounded-kaya-sm flex items-center justify-center text-lg transition-all ${
                    presetIdx === i ? 'ring-2 ring-kaya-gold ring-offset-1' : ''
                  }`}
                  style={{ background: `${p.color}30` }}
                  aria-label={`House colour ${i + 1}`}
                >
                  <span className="w-5 h-5 rounded-full" style={{ background: p.color }} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-kaya-chocolate/60 uppercase tracking-wider mb-1.5">
              Avatar — {avatarEmoji}
            </label>
            {/* Approved 2026-07-20: 8 categories · 144 choices + type-your-own. */}
            <AvatarEmojiPicker value={avatarEmoji} onChange={setAvatarEmoji} compact />
          </div>
        </div>

        {/* ── Right: consent panel (the COPPA lock) ───────────────── */}
        <div className="bg-white border-[1.5px] border-kaya-gold-light rounded-kaya p-5">
          <h2 className="font-display font-extrabold text-kaya-chocolate text-[15px] mb-2">Before we issue the code</h2>
          <ul className="text-[13px] text-kaya-chocolate/80 leading-relaxed space-y-1.5 mb-4 list-disc pl-4">
            <li>Only first name, date of birth &amp; avatar are collected.</li>
            <li>No advertising. No profiling. No third-party trackers.</li>
            <li>No precise location. No AI model training on child data.</li>
            <li>Pause, revoke, or delete from your dashboard any time.</li>
          </ul>

          <label className="flex items-start gap-2.5 mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 w-[18px] h-[18px] accent-kaya-gold flex-shrink-0"
            />
            <span className="text-xs text-kaya-chocolate/80 leading-relaxed">
              I am the parent / legal guardian. I have read the{' '}
              <a href="/legal/childrens-privacy" target="_blank" rel="noopener" className="text-kaya-gold-dark font-semibold underline-offset-2 hover:underline">
                Children&apos;s Privacy Notice
              </a>{' '}
              and give verifiable consent.
            </span>
          </label>

          {isPasswordUser ? (
            <div className="mb-3">
              <label className="block text-xs font-semibold text-kaya-chocolate/60 uppercase tracking-wider mb-1.5">
                Confirm with your Kaya password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-12 px-4 bg-white border border-kaya-gold/40 rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 focus:border-kaya-gold"
              />
            </div>
          ) : (
            <p className="text-xs text-kaya-chocolate/60 mb-3 leading-relaxed">
              You&apos;ll confirm it&apos;s you with Google when you tap below.
            </p>
          )}

          {error && <p className="text-red-500 text-xs bg-red-50 rounded-kaya-sm px-3 py-2 mb-3">{error}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="w-full h-12 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm transition-all enabled:hover:bg-kaya-gold-dark enabled:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Creating…' : 'Generate Kaya Code'}
          </button>
          <p className="text-[11px] text-kaya-chocolate/50 mt-2 text-center">
            Enabled once the box is ticked <strong>and</strong> a password is entered.
          </p>
        </div>
      </div>
    </div>
  );
}
