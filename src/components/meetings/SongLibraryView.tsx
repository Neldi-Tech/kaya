'use client';

// ── Meeting Song Library (Sunday-Meeting v4 · 2026-06-21) ───────────────
// Every song used to close a meeting is saved here. The family rates each
// (1–5★) and the highest-average rise to the top so favourites are one tap
// away. Used inside the Meetings hub song-setter ("📚 Pick from Library")
// and reusable as a standalone browse.
//
// Two modes:
//   • onUse provided → each row shows a "Use tonight" button (sets today's
//     closing song); used by the hub picker (parent/leader only).
//   • onUse absent → read/rate-only browse.

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  subscribeSongLibrary, rateSong, type SongLibraryEntry,
} from '@/lib/meetingSongLibrary';
import { toDisplayDate } from '@/lib/dates';

const GOLD = '#D4A017';
const PURPLE = '#9B5DE5';

export default function SongLibraryView({
  familyId, onUse, compact,
}: {
  familyId: string;
  onUse?: (entry: SongLibraryEntry) => void;
  compact?: boolean;
}) {
  const { profile } = useAuth();
  const uid = profile?.uid;
  const [songs, setSongs] = useState<SongLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'rated' | 'recent'>('rated');

  useEffect(() => {
    if (!familyId) return;
    const unsub = subscribeSongLibrary(familyId, (rows) => { setSongs(rows); setLoading(false); });
    return () => unsub();
  }, [familyId]);

  const ordered = sort === 'rated'
    ? songs // already sorted top-rated by the lib
    : [...songs].sort((a, b) => (b.lastPlayedAt || b.addedAt || 0) - (a.lastPlayedAt || a.addedAt || 0));

  const labelFor = (s: SongLibraryEntry) =>
    s.title?.trim()
    || (s.provider === 'youtube' ? 'YouTube song'
      : s.provider === 'spotify' ? 'Spotify track'
      : 'Closing song');

  const rate = (s: SongLibraryEntry, n: number) => {
    if (familyId && uid) rateSong(familyId, s.id, uid, n).catch(() => {});
  };

  if (loading) {
    return <p className="text-center text-[12.5px] font-extrabold py-6" style={{ color: PURPLE }}>Loading the library…</p>;
  }
  if (songs.length === 0) {
    return (
      <div className="text-center py-8 px-4">
        <div className="text-3xl mb-1">🎵</div>
        <p className="font-black text-[14px]" style={{ color: '#2D1B5E' }}>No songs yet</p>
        <p className="text-[12px] mt-1" style={{ color: '#5C6975' }}>
          Songs you play to close a meeting are saved here — rate them and your favourites rise to the top.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* sort toggle */}
      <div className="flex gap-1.5 rounded-full p-1 mb-3" style={{ background: '#F0EBE3' }}>
        {([['rated', '⭐ Top rated'], ['recent', '🕑 Recent']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSort(key)}
            className="flex-1 text-center font-black text-[12px] py-1.5 rounded-full transition-colors"
            style={sort === key
              ? { background: '#fff', color: '#1E120B', boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }
              : { color: '#9B8A72' }}
          >{label}</button>
        ))}
      </div>

      <div className="space-y-2">
        {ordered.map((s, idx) => {
          const mine = uid ? s.ratings?.[uid] : undefined;
          return (
            <div key={s.id} className="flex items-center gap-2.5 bg-white border rounded-2xl p-2.5" style={{ borderColor: '#E8E0D4' }}>
              {sort === 'rated' && (
                <div className="shrink-0 w-6 text-center font-black text-[15px]" style={{ color: '#B8860B' }}>
                  {idx === 0 ? '①' : idx === 1 ? '②' : idx === 2 ? '③' : idx + 1}
                </div>
              )}
              <div className="shrink-0 w-11 h-11 rounded-xl grid place-items-center text-[20px]"
                style={{ background: 'linear-gradient(150deg,#3a2710,#caa12f)', boxShadow: 'inset 0 0 0 1.5px rgba(245,230,184,.4)' }}>
                🎬
              </div>
              <div className="flex-1 min-w-0">
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="block font-black text-[13.5px] truncate" style={{ color: '#2D1B5E' }}>
                  {labelFor(s)}
                </a>
                <div className="text-[10.5px]" style={{ color: '#9B8A72' }}>
                  {s.addedByName ? `Added by ${s.addedByName} · ` : ''}played {s.playCount || 1}×
                  {s.lastPlayedAt ? ` · ${toDisplayDate(new Date(s.lastPlayedAt).toISOString().slice(0, 10)) || ''}` : ''}
                </div>
                {/* interactive stars — the whole family can rate */}
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => rate(s, n)}
                        aria-label={`Rate ${n} stars`}
                        className="text-[14px] leading-none transition-transform hover:scale-110"
                        style={{ color: n <= (mine ?? Math.round(s.avgRating)) ? GOLD : '#E8E0D4' }}
                      >★</button>
                    ))}
                  </div>
                  <span className="text-[10.5px] font-bold" style={{ color: '#9B8A72' }}>
                    {s.ratingCount ? `${s.avgRating.toFixed(1)} · ${s.ratingCount}` : 'unrated'}
                  </span>
                </div>
              </div>
              {onUse ? (
                <button
                  type="button"
                  onClick={() => onUse(s)}
                  className="shrink-0 h-9 px-3 rounded-full text-white font-black text-[11.5px]"
                  style={{ background: '#1E120B' }}
                >Use tonight</button>
              ) : (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Play"
                  className="shrink-0 w-9 h-9 rounded-full grid place-items-center text-[13px] text-white"
                  style={{ background: '#1E120B' }}
                >▶</a>
              )}
            </div>
          );
        })}
      </div>
      {!compact && (
        <p className="mt-3 text-[10px] text-center" style={{ color: '#9B8A72' }}>
          ⭐ Tap stars to rate — the family average sorts the list.
        </p>
      )}
    </div>
  );
}
