'use client';

// ── Rate the closing song (Sunday-Meeting v4.6) ─────────────────────────
// After the meeting, the song only got rated on the presenter device. This
// card lets EVERY family member (kids + parents) rate it from their own My
// Day / Workplan — so the Song Library's family average is real.
//
// Shows the most-recently-PLAYED song (revealedAt within the last 7 days)
// that this viewer hasn't rated yet. Once they rate, it thanks them and
// fades out. Self-contained — resolves identity from context.

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { subscribeSongLibrary, rateSong, type SongLibraryEntry } from '@/lib/meetingSongLibrary';
import { songThumbnailUrl } from '@/lib/songEmbed';

const RATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export default function RateClosingSongCard({ className = '' }: { className?: string }) {
  const { profile } = useAuth();
  const { family } = useFamily();
  const familyId = family?.id;
  const uid = profile?.uid;

  const [song, setSong] = useState<SongLibraryEntry | null>(null);
  const [justRated, setJustRated] = useState(0);

  useEffect(() => {
    if (!familyId || !uid) return;
    const unsub = subscribeSongLibrary(familyId, (rows) => {
      const now = Date.now();
      const candidate = rows
        .filter((s) => s.revealedAt && (now - s.revealedAt) < RATE_WINDOW_MS && !(s.ratings && s.ratings[uid] != null))
        .sort((a, b) => (b.revealedAt || 0) - (a.revealedAt || 0))[0] || null;
      setSong(candidate);
    });
    return () => unsub();
  }, [familyId, uid]);

  if (!familyId || !uid || !song) return null;

  const thumb = songThumbnailUrl(song.url);
  const title = song.title?.trim() || 'the closing song';

  const rate = (n: number) => {
    setJustRated(n);
    rateSong(familyId, song.id, uid, n).catch(() => {});
  };

  return (
    <div className={`bg-kaya-chocolate/5 border border-kaya-gold/30 rounded-kaya-lg p-4 ${className}`}>
      <div className="flex items-center gap-3">
        <a
          href={song.url}
          target="_blank"
          rel="noreferrer noopener"
          className="shrink-0 relative w-[72px] aspect-video rounded-lg overflow-hidden bg-cover bg-center"
          style={thumb ? { backgroundImage: `url(${thumb})` } : { background: 'linear-gradient(150deg,#3a2710,#caa12f)' }}
          title="Replay the song"
        >
          {!thumb && <span className="absolute inset-0 grid place-items-center text-xl">🎬</span>}
        </a>
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-extrabold text-kaya-chocolate leading-tight">
            🎵 How was {title}?
          </p>
          <p className="text-[11px] text-kaya-chocolate/60 mt-0.5">
            {justRated ? 'Thanks — saved to your family Song Library! 🎶' : 'Rate the family’s closing song from the meeting.'}
          </p>
          <div className="flex gap-1 mt-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => rate(n)}
                aria-label={`Rate ${n} stars`}
                className="text-[22px] leading-none transition-transform hover:scale-110"
                style={{ color: n <= justRated ? '#D4A017' : '#E8E0D4' }}
              >★</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
