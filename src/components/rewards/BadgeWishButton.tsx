'use client';

// 💭 "Wish for a badge" (BDG PR5 · B21, kid side) — a kid asks for the badge
// they want in their own words; it lands in the parent's 🪄 Badge Studio to
// shape and release. Same suggest-then-decide shape as 💡 Reward Ideas.
//
// Writes through /api/badges/wish (kids can't write family collections) with a
// small daily quota, so the Studio stays a signal rather than a firehose.

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function BadgeWishButton({ childId }: { childId: string | null }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const send = async () => {
    if (!user || !text.trim() || busy) return;
    setBusy(true); setMsg('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/badges/wish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: text.trim(), ...(childId ? { childId } : {}) }),
      });
      const j = await res.json() as { ok?: boolean; error?: string; quota?: number };
      if (j.ok) {
        setMsg('💭 Sent! Your grown-up will see it in the Badge Studio.');
        setText(''); setOpen(false);
      } else if (j.error === 'quota') {
        setMsg(`That's ${j.quota ?? 3} wishes for today — try again tomorrow!`);
      } else {
        setMsg('Could not send that just now. Try again in a moment.');
      }
    } catch {
      setMsg('Could not send that just now. Try again in a moment.');
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-4">
      {!open ? (
        <button
          type="button"
          onClick={() => { setOpen(true); setMsg(''); }}
          className="w-full rounded-kaya border border-dashed border-kaya-gold/60 bg-kaya-gold/5 px-4 py-3 text-[12.5px] font-extrabold text-kaya-gold-dark"
        >
          💭 Wish for a badge — tell your grown-up what you&apos;d love to earn
        </button>
      ) : (
        <div className="rounded-kaya border border-kaya-warm-dark bg-white p-3.5">
          <p className="text-[12.5px] font-bold mb-1.5">💭 What badge would you love?</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={240}
            placeholder="e.g. a badge for reading 10 books, or for helping Grandma every week"
            className="w-full rounded-kaya-sm border border-kaya-warm-dark px-3 py-2 text-[12.5px]"
          />
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              disabled={busy || !text.trim()}
              onClick={() => void send()}
              className="px-3.5 py-1.5 rounded-full text-[11.5px] font-black bg-kaya-gold text-white disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send my wish'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="px-3.5 py-1.5 rounded-full text-[11.5px] font-black bg-kaya-warm text-kaya-sand">
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && <p className="text-[11.5px] font-bold text-kaya-sand mt-2">{msg}</p>}
    </div>
  );
}
