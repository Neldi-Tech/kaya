'use client';

// /redeem?code=HOME-X4K9B2 — deep link from the code email. Auto-fills
// the input, lets the family confirm with one tap, then routes them to
// /settings/subscription where their new plan is rendered.

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { isProbablyTierCode } from '@/lib/tierCodes';

const NAVY = '#0F1F44';
const GOLD = '#D4A847';
const MUTED = '#6E7791';
const CREAM = '#FBF7EE';

export default function RedeemPage() {
  const search = useSearchParams();
  const router = useRouter();
  const initial = (search.get('code') ?? '').toUpperCase();
  const [code, setCode] = useState(initial);
  const [state, setState] = useState<'idle' | 'redeeming' | 'ok' | 'err'>('idle');
  const [message, setMessage] = useState('');

  const formatted = code.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const valid = isProbablyTierCode(formatted);

  const submit = async () => {
    setState('redeeming'); setMessage('');
    try {
      const u = auth.currentUser;
      if (!u) {
        setState('err');
        setMessage('Please sign in to redeem this code, then come back to this link.');
        return;
      }
      const token = await u.getIdToken();
      const res = await fetch('/api/tier-codes/redeem', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ code: formatted }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState('err');
        setMessage(data.message ?? data.error ?? 'Redeem failed.');
        return;
      }
      setState('ok');
      setMessage(`Welcome to ${String(data.tier ?? '').toUpperCase()} — your new plan is live!`);
      // After 2 s, route to /settings/subscription so they see their new plan.
      setTimeout(() => router.push('/settings/subscription'), 1800);
    } catch (e) {
      setState('err');
      setMessage(String(e instanceof Error ? e.message : e));
    }
  };

  // If the URL had a valid code, auto-redeem on mount.
  useEffect(() => {
    if (valid && state === 'idle' && initial) {
      submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-12" style={{ background: CREAM }}>
      <div
        className="w-full max-w-[440px] rounded-[28px] p-7 sm:p-9 text-center"
        style={{ background: 'white', border: '1.5px solid rgba(15,31,68,0.07)', boxShadow: '0 28px 72px rgba(15,31,68,0.1)' }}
      >
        <div
          className="w-16 h-16 rounded-2xl grid place-items-center mx-auto mb-4 text-3xl"
          style={{ background: 'linear-gradient(135deg,#FFF4D6,#FFE8E5)' }}
          aria-hidden
        >
          {state === 'ok' ? '🎉' : '🎟'}
        </div>
        <h1 className="font-display font-extrabold text-2xl m-0" style={{ color: NAVY }}>
          {state === 'ok'   ? 'You\'re in.'
           : state === 'err' ? 'Hmm — that didn\'t work.'
           : 'Redeem your Kaya code'}
        </h1>
        <p className="text-[14px] mt-2 leading-relaxed font-semibold" style={{ color: MUTED }}>
          {state === 'ok' ? message
           : state === 'err' ? message
           : 'Confirm the code below to unlock your new plan.'}
        </p>

        {state !== 'ok' && (
          <div className="mt-6">
            <input
              value={formatted}
              onChange={(e) => { setCode(e.target.value); setState('idle'); setMessage(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && valid && state !== 'redeeming') submit(); }}
              placeholder="HOME-X4K9B2"
              className="w-full bg-[#FBF7EE] border-[1.5px] rounded-xl px-3 py-3 outline-none font-mono text-center text-[18px] font-extrabold tracking-widest uppercase"
              style={{ borderColor: 'rgba(15,31,68,0.1)', color: NAVY }}
              maxLength={11}
            />
            <button
              onClick={submit}
              disabled={!valid || state === 'redeeming'}
              className="block w-full mt-3 text-[14px] font-black py-3 rounded-xl disabled:opacity-40"
              style={{ background: GOLD, color: NAVY }}
            >
              {state === 'redeeming' ? 'Redeeming…' : 'Redeem now →'}
            </button>
            <a
              href="/settings/subscription"
              className="block mt-3 text-[12px] font-semibold"
              style={{ color: MUTED }}
            >
              ← Back to plans
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
