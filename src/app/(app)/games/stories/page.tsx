'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { localDateKey } from '@/lib/games';
import { toDisplayDate } from '@/lib/dates';
import { storyExpired, type SavedStory } from '@/lib/stories';

// Story Keepsakes gallery — any family member can re-read the collaborative
// stories saved from Story Builder, with the AI's warm score + a fun title.
// Stories past their retention window are hidden. Read-only (saving happens
// from the game's finished screen via the Admin route).

function displayDate(ms: number): string {
  if (!ms) return '';
  return toDisplayDate(localDateKey(ms, -new Date(ms).getTimezoneOffset()));
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] font-bold text-games-ink-soft mb-0.5">
        <span>{label}</span><span>{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-games-bg overflow-hidden">
        <div className="h-full bg-games-teal" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function StoryCard({ story }: { story: SavedStory }) {
  const [open, setOpen] = useState(false);
  const stars = story.score?.stars ?? 0;
  return (
    <div className="bg-games-card rounded-kaya p-4 shadow-[0_4px_12px_rgba(26,18,64,0.06)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display font-extrabold text-games-ink truncate">📖 {story.title}</p>
            <p className="text-[11px] text-games-ink-soft mt-0.5 truncate">
              {displayDate(story.createdAt)}
              {story.contributors.length > 0 && <> · {story.contributors.join(', ')}</>}
            </p>
          </div>
          {stars > 0 && (
            <span className="shrink-0 text-sm tracking-tight" aria-label={`${stars} stars`}>
              {'⭐'.repeat(stars)}
            </span>
          )}
        </div>
        {!open && <p className="text-xs text-games-ink-soft mt-2 line-clamp-2">{story.text}</p>}
      </button>

      {open && (
        <div className="mt-3">
          <div className="bg-games-bg rounded-kaya p-3 text-sm leading-relaxed text-games-ink">
            {story.sentences.map((s, i) => (
              <span key={i}><span className="text-games-violet font-bold">{s.name}:</span> {s.text}{' '}</span>
            ))}
          </div>

          {story.score ? (
            <div className="mt-3 bg-games-violet/8 border border-games-violet/15 rounded-kaya p-3">
              <p className="text-sm font-bold text-games-ink mb-2">✨ {story.score.praise}</p>
              <div className="grid grid-cols-3 gap-2.5">
                <Bar label="Creativity" value={story.score.creativity} />
                <Bar label="Teamwork" value={story.score.teamwork} />
                <Bar label="Imagination" value={story.score.imagination} />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-games-ink-soft">A lovely story you made together. 💜</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function StoryGalleryPage() {
  const { profile } = useAuth();
  const familyId = profile?.familyId;
  const [stories, setStories] = useState<SavedStory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!familyId) return;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'families', familyId, 'stories'),
          orderBy('createdAt', 'desc'),
        ));
        if (cancelled) return;
        const now = Date.now();
        const rows = snap.docs
          .map((d) => ({ ...(d.data() as SavedStory), id: d.id }))
          .filter((s) => !storyExpired(s, now));
        setStories(rows);
      } catch { /* gallery just shows empty */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [familyId]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-transparent">
      <div className="mx-auto max-w-md w-full px-4 pt-4 pb-28">
        <Link href="/games" className="text-sm font-bold text-games-ink-soft">&larr; Games</Link>

        <div className="rounded-kaya-lg p-5 my-4 text-white text-center bg-gradient-to-br from-games-violet to-[#9333EA]">
          <div className="text-4xl mb-1">📖</div>
          <h1 className="font-display text-2xl font-black">Story Gallery</h1>
          <p className="text-xs opacity-90 mt-1">Every story your family wrote together</p>
        </div>

        {loading ? (
          <p className="text-center text-sm text-games-ink-soft py-12">Loading…</p>
        ) : stories.length === 0 ? (
          <div className="text-center py-14">
            <p className="text-5xl mb-3">✍️</p>
            <p className="font-display text-lg font-extrabold text-games-ink mb-1">No saved stories yet</p>
            <p className="text-sm text-games-ink-soft mb-5">Play <b>Story Builder</b> together, then tap <b>Save &amp; score</b> when you finish.</p>
            <Link href="/games/story-builder" className="inline-block bg-games-violet text-white font-extrabold text-sm px-5 py-2.5 rounded-full">
              📖 Play Story Builder
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {stories.map((s) => <StoryCard key={s.id} story={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}
