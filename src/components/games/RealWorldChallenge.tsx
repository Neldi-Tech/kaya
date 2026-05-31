'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { uploadGameProof } from '@/lib/gameProofUpload';
import { submitChallenge } from '@/lib/gamesChallenge';
import type { GameDef } from '@/lib/gamesCatalog';

// Real-World challenge: do it IRL, add a photo, send it to a grown-up. It
// becomes a PENDING gamePlay the parent approves in /games/approvals — points
// land on approval (HP carries real value, so nothing self-credits).

const CHALLENGE_TEXT: Record<string, string> = {
  'build-a-fort': 'Build a cosy fort from cushions, chairs or blankets — then snap a photo of your hideout!',
  'family-workout': 'Do a mini family workout — star jumps, a dance, a quick run. Grab an action photo!',
  'plant-something': 'Plant a seed, a flower, or a little tree, and photograph your gardening!',
  'thank-you-note': 'Write a thank-you note to someone special, then take a photo of it.',
};

export default function RealWorldChallenge({ game }: { game: GameDef }) {
  const { profile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<'intro' | 'busy' | 'done' | 'error'>('intro');
  const [err, setErr] = useState('');
  const isKid = profile?.role === 'kid';

  const onFile = (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setErr('Please choose a photo.'); setPhase('error'); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setErr('');
    setPhase('intro');
  };

  const submit = async () => {
    if (!isKid) { setErr('Real-World challenges are for kids — points go to their account.'); setPhase('error'); return; }
    if (!file || !profile?.familyId) return;
    setPhase('busy'); setErr('');
    try {
      const childSeg = profile.childId || profile.uid;
      const url = await uploadGameProof(profile.familyId, childSeg, game.id, file);
      const res = await submitChallenge({ gameId: game.id, proofUrl: url });
      if (res.error || res.skipped) {
        setErr(res.skipped ? 'Sign in as a kid to earn points.' : 'Could not send it — try again.');
        setPhase('error');
        return;
      }
      setPhase('done');
    } catch {
      setErr('Upload failed — check your photo and try again.');
      setPhase('error');
    }
  };

  if (phase === 'done') {
    return (
      <div className="text-center pt-10 mx-auto" style={{ maxWidth: 320 }}>
        <div className="text-6xl mb-3">🎉</div>
        <p className="font-display text-xl font-extrabold text-games-ink mb-2">Sent for a ✓!</p>
        <p className="text-sm text-games-ink-soft mb-8">Your photo went to your grown-up. You&rsquo;ll get your points once they say yes.</p>
        <Link href="/games" className="inline-block bg-games-violet text-white font-extrabold text-sm px-6 py-3 rounded-full">Back to Games</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <div className="rounded-kaya-lg p-5 mb-4 text-white text-center bg-gradient-to-br from-games-violet to-games-coral">
        <div className="text-4xl mb-2">{game.icon}</div>
        <p className="font-display text-base font-extrabold leading-snug">
          {CHALLENGE_TEXT[game.id] || 'Do the challenge, then add a photo to prove it!'}
        </p>
      </div>

      {preview ? (
        <img src={preview} alt="Your proof" className="w-full max-h-64 object-cover rounded-kaya mb-3" />
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full border-2 border-dashed border-games-violet/30 rounded-kaya py-10 text-center text-games-violet font-extrabold mb-3"
        >
          📷 Add a photo
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0] || undefined)} />

      {err && <p className="text-games-coral text-sm font-bold mb-3 text-center">{err}</p>}

      <div className="flex gap-2.5">
        {preview && (
          <button type="button" onClick={() => fileRef.current?.click()} disabled={phase === 'busy'} className="bg-games-bg text-games-ink-soft font-extrabold px-4 py-3 rounded-full">
            Retake
          </button>
        )}
        <button type="button" onClick={submit} disabled={!file || phase === 'busy'} className="flex-1 bg-games-violet text-white font-extrabold py-3 rounded-full disabled:opacity-50">
          {phase === 'busy' ? 'Sending…' : 'Send to my parent'}
        </button>
      </div>
      <p className="text-center text-[11px] text-games-ink-soft mt-3">A grown-up checks your photo, then your points land.</p>
    </div>
  );
}
