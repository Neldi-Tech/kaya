'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInHelperWithCodes } from '@/lib/helpers';
import { KeyRound } from 'lucide-react';

export default function HelperLoginPage() {
  const router = useRouter();
  const [familyCode, setFamilyCode] = useState('');
  const [helperCode, setHelperCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
              placeholder="ABCD"
              className="mt-1 w-full px-3 py-3 bg-kaya-cream border border-kaya-warm-dark rounded-kaya focus:outline-none focus:border-kaya-chocolate font-mono text-lg tracking-widest"
            />
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
              placeholder="AMINA"
              className="mt-1 w-full px-3 py-3 bg-kaya-cream border border-kaya-warm-dark rounded-kaya focus:outline-none focus:border-kaya-chocolate font-mono text-lg tracking-widest"
            />
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

        <p className="text-[11px] text-kaya-sand text-center mt-6 leading-relaxed">
          Don&apos;t have codes? Ask the parent in your family to add you in
          Settings → Helpers.
        </p>
      </div>
    </div>
  );
}
