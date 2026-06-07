'use client';

import { Suspense, useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInHelperWithCodes } from '@/lib/helpers';
import { KeyRound, Info, Clock } from 'lucide-react';

// Next 14 app-router requires `useSearchParams()` to live inside a
// <Suspense> boundary, otherwise the whole page bails out of static
// prerender and the build fails. The actual UI sits in `LoginForm`;
// this outer component just provides the boundary.
export default function HelperLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-kaya-cream" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const expired = search?.get('expired') === '1';
  const [familyCode, setFamilyCode] = useState('');
  const [helperCode, setHelperCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Autofocus the first empty field on mount so a helper landing on the
  // page can start typing without tapping.
  const fcRef = useRef<HTMLInputElement>(null);
  useEffect(() => { fcRef.current?.focus(); }, []);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!familyCode.trim() || !helperCode.trim() || !password.trim()) {
      setError('Fill in all three codes.');
      return;
    }
    setBusy(true);
    try {
      await signInHelperWithCodes(familyCode.trim(), helperCode.trim(), password);
      // Land on the existing helper dashboard. The /helper page already
      // shows kid tiles and rating actions; we filter them by the
      // helper's HelperLink.kidIds in that page's render path.
      router.replace('/helper');
    } catch (err: any) {
      const code = err?.code;
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        setError('Those codes don\'t match. Check the family code, helper code, and password.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many tries. Wait a few minutes and try again.');
      } else if (code === 'auth/network-request-failed') {
        setError('No internet. Check your connection and try again.');
      } else {
        setError(err?.message || 'Could not sign in. Try again.');
      }
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-kaya-cream flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Brand mark */}
        <div className="flex items-center justify-center mb-6">
          <div className="w-14 h-14 rounded-[14px] bg-kaya-chocolate text-kaya-gold font-display font-black text-2xl flex items-center justify-center">
            K
          </div>
        </div>

        <div className="text-center mb-7">
          <h1 className="font-display font-extrabold text-2xl tracking-tight">Helper sign-in</h1>
          <p className="text-sm text-kaya-sand mt-1.5">
            Enter the three codes your family gave you.
          </p>
        </div>

        {expired && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-kaya text-sm text-amber-900 flex items-start gap-2">
            <Clock size={16} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Your sign-in expired</p>
              <p className="text-xs mt-0.5">For safety, please enter your three codes again.</p>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 space-y-4">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider text-kaya-sand">Family code</span>
            <input
              ref={fcRef}
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              value={familyCode}
              onChange={(e) => setFamilyCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              placeholder="7K2Q"
              className="mt-1 w-full px-3 py-3 bg-kaya-cream border border-kaya-warm-dark rounded-kaya focus:outline-none focus:border-kaya-chocolate font-mono text-lg tracking-widest"
            />
            <p className="text-[11px] text-kaya-sand mt-1">The 4-character code shared with all helpers of this family, e.g. <span className="font-mono">7K2Q</span>.</p>
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider text-kaya-sand">Helper code</span>
            <input
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              value={helperCode}
              onChange={(e) => setHelperCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
              placeholder="K4P2"
              className="mt-1 w-full px-3 py-3 bg-kaya-cream border border-kaya-warm-dark rounded-kaya focus:outline-none focus:border-kaya-chocolate font-mono text-lg tracking-widest"
            />
            <p className="text-[11px] text-kaya-sand mt-1">Your personal sign-in code — letters &amp; numbers, e.g. <span className="font-mono">K4P2</span>. Not the family join code.</p>
          </label>

          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider text-kaya-sand">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className="mt-1 w-full px-3 py-3 bg-kaya-cream border border-kaya-warm-dark rounded-kaya focus:outline-none focus:border-kaya-chocolate font-mono text-lg tracking-widest"
            />
            <p className="text-[11px] text-kaya-sand mt-1">6 characters, sent to you by the family parent.</p>
          </label>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-kaya text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full px-4 py-3 bg-kaya-chocolate text-white rounded-kaya font-bold hover:bg-kaya-chocolate/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            <KeyRound size={16} />
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/* Inline guidance — explains where each code comes from
            without forcing the helper to read a wall of text up-front.
            Collapsed by default; expands on tap. */}
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          className="mt-6 w-full inline-flex items-center justify-center gap-1.5 text-xs text-kaya-sand hover:text-kaya-chocolate"
        >
          <Info size={14} />
          {showHelp ? 'Hide' : 'Where do I get these codes?'}
        </button>
        {showHelp && (
          <div className="mt-3 bg-white border border-kaya-warm-dark rounded-kaya p-4 text-xs leading-relaxed text-kaya-chocolate space-y-2">
            <p>
              <span className="font-bold">Family code</span> — 4 letters / numbers (e.g. <span className="font-mono">7K2Q</span>). One per family. The parent shares this with every helper they add.
            </p>
            <p>
              <span className="font-bold">Helper code</span> — your personal sign-in code (letters &amp; numbers, e.g. <span className="font-mono">K4P2</span>). The parent sets it when they add you, and can show it again any time in <span className="font-mono">Settings → Helpers</span>.
            </p>
            <p>
              <span className="font-bold">Password</span> — 6 characters, generated automatically. The parent sees it once and sends it to you (WhatsApp, in person, written down).
            </p>
            <p className="text-kaya-gold-dark">
              <span className="font-bold">Tip:</span> these three come from the parent&apos;s <span className="font-bold">Sign-in details</span> card — <span className="font-bold">not</span> the one-time code used to first join the family.
            </p>
            <p className="pt-1 border-t border-kaya-warm-dark/30">
              <span className="font-bold">Don&apos;t have codes yet?</span> Ask the parent in your family to open <span className="font-mono">Settings → Helpers → Add helper</span> in their Kaya app. They&apos;ll send you all three.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
