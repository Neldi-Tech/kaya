'use client';

// Kaya · COPPA + Login — the kid redemption surface (/code).
//
// The ONLY login a child ever touches. By design it has NO email field, NO
// password field, and NO legal copy — their grown-up already agreed to the
// rules on their behalf. It also renders no Google button / analytics, so a
// child session loads no third-party trackers (Max-Privacy Mode).
//
// The kid types the code their grown-up gave them; we redeem it server-side
// for a custom token and sign them straight in.

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import KayaMark from '@/components/brand/KayaMark';
import { KAYA_CODE_PREFIX } from '@/lib/coppa/constants';

export default function KidCodePage() {
  const { signInWithKayaCode } = useAuth();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  const onChange = (v: string) => {
    // Kids type just the body; keep it to the unambiguous alphabet, uppercased.
    setBody(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12));
    if (status === 'error') setStatus('idle');
  };

  const submit = async () => {
    const code = `${KAYA_CODE_PREFIX}-${body}`;
    if (!body) { inputRef.current?.focus(); return; }
    setStatus('working');
    try {
      await signInWithKayaCode(code);
      router.push('/');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 py-10 font-body"
      style={{ background: 'linear-gradient(160deg, #F5E6B8 0%, #FDFBF7 55%, #F5E6B8 100%)' }}
    >
      <div className="w-full max-w-[420px] rounded-kaya-lg bg-kaya-cream border-2 border-kaya-chocolate shadow-[0_24px_60px_-28px_rgba(30,18,11,0.55)] px-7 py-10 sm:px-9 text-center">
        <div className="flex justify-center mb-5">
          <KayaMark variant="dark" size={58} title="Kaya" />
        </div>

        <h1 className="font-display font-extrabold text-kaya-chocolate text-[30px] leading-tight mb-1.5">
          Hi there!
        </h1>
        <p className="text-kaya-chocolate/70 text-base mb-7">
          Type the code your grown-up gave you
        </p>

        {/* Code entry — KAYA- prefix shown, kid fills the rest. Big, friendly,
            uppercase. No email, no password. */}
        <label htmlFor="kaya-code" className="sr-only">Your Kaya Code</label>
        <div
          className={`flex items-center gap-2 rounded-kaya bg-white border-2 px-3 py-3 transition-colors ${
            status === 'error' ? 'border-red-400' : 'border-kaya-gold'
          }`}
          onClick={() => inputRef.current?.focus()}
        >
          <span className="font-display font-extrabold text-kaya-gold-dark text-2xl tracking-tight select-none">
            {KAYA_CODE_PREFIX}-
          </span>
          <input
            id="kaya-code"
            ref={inputRef}
            value={body}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            placeholder="••••••••"
            className="flex-1 min-w-0 bg-transparent outline-none font-display font-extrabold text-kaya-chocolate text-2xl tracking-[0.18em] placeholder:text-kaya-chocolate/20"
          />
        </div>

        {status === 'error' && (
          <p className="text-red-500 text-sm font-semibold mt-3">
            Hmm, that code didn&apos;t work. Ask your grown-up to check it! 🙂
          </p>
        )}

        <button
          onClick={submit}
          disabled={status === 'working'}
          className="mt-6 w-full rounded-kaya bg-kaya-chocolate text-kaya-gold-light font-display font-extrabold text-lg py-3.5 transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {status === 'working' ? 'One sec…' : "Let's go!"}
        </button>

        {/* Reassurance — no legal copy, just warmth. */}
        <div className="mt-7 rounded-kaya bg-kaya-gold-light/50 border border-kaya-gold/30 px-4 py-3 text-[13px] text-kaya-chocolate/70 leading-relaxed">
          Your grown-up already agreed to the rules. We don&apos;t ask kids for an email or a password.
        </div>
      </div>
    </div>
  );
}
