'use client';

// Sunday Meeting · 🌟 Note of the Week (Timeline 2.0, design v2 #8).
//
// Kaya nominates up to three of the week's journal notes (reflection +
// unlocked diary — the gateways redact locked pages, so nothing private
// can ever be nominated), the family listens and crowns one, and the
// winner is minted as a 🌟-sealed Note Card straight into Moments.
// The pick lands on the meeting record via onRecord.

import { useEffect, useMemo, useState } from 'react';
import { listReflections } from '@/lib/sparks/reflection';
import { diaryApi, type DiaryEntry } from '@/lib/sparks/diary';
import {
  type NoteCardData, noteCardPngBlob, noteFilename, rememberedNoteTheme,
} from '@/lib/noteCards';
import { timelineDayLabel } from '@/components/sparks/TimelineViews';

export interface NoteOfWeekRecord {
  kidId: string;
  kidName: string;
  date: string;
  surface: 'reflection' | 'diary';
  excerpt: string;
  postId?: string;
  at: number;
}

interface Candidate {
  kidId: string; kidName: string; surface: 'reflection' | 'diary';
  date: string; text: string; feeling?: string;
}

export default function NoteOfWeekStep({
  familyId, meUid, meName, childrenList, record, onRecord, sw,
}: {
  familyId: string;
  meUid: string;
  meName: string;
  childrenList: Array<{ id: string; name: string }>;
  record: NoteOfWeekRecord | null;
  onRecord: (r: NoteOfWeekRecord) => void;
  sw: boolean;
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const weekAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const found: Candidate[] = [];
      for (const kid of childrenList) {
        const first = kid.name.split(' ')[0];
        try {
          const refl = await listReflections(familyId, kid.id, 14);
          for (const e of refl) {
            if (e.date >= weekAgo && e.text?.trim() && !e.origin) {
              found.push({ kidId: kid.id, kidName: first, surface: 'reflection', date: e.date, text: e.text.trim(), feeling: e.ai_read?.mood_emoji });
            }
          }
        } catch { /* kid without reflections */ }
        try {
          const res = await diaryApi<{ entries: DiaryEntry[] }>('list', { ownerId: kid.id, max: 40 });
          for (const e of res.entries ?? []) {
            if (e.date < weekAgo || e.locked || e.redacted) continue;
            const text = (e.blocks ?? []).filter((b) => b.kind === 'text' && b.text?.trim()).map((b) => (b.text as string).trim()).join(' ');
            if (text) found.push({ kidId: kid.id, kidName: first, surface: 'diary', date: e.date, text, feeling: e.feeling });
          }
        } catch { /* diary closed to us — skip */ }
      }
      if (!alive) return;
      // Nominate ≤3: kid-diverse first (best note per kid by length),
      // then longest remaining — deterministic, no dice to argue with.
      const byKid = new Map<string, Candidate[]>();
      for (const c of found) byKid.set(c.kidId, [...(byKid.get(c.kidId) ?? []), c]);
      const firsts = Array.from(byKid.values())
        .map((list) => list.sort((a, b) => b.text.length - a.text.length)[0])
        .sort((a, b) => b.text.length - a.text.length);
      const rest = found.filter((c) => !firsts.includes(c)).sort((a, b) => b.text.length - a.text.length);
      setCandidates([...firsts, ...rest].slice(0, 3));
    })();
    return () => { alive = false; };
  }, [familyId, childrenList, weekAgo]);

  const crown = async (c: Candidate) => {
    if (busy || record) return;
    setBusy(true); setError('');
    try {
      const card: NoteCardData = {
        kidName: c.kidName,
        surfaceLabel: `🌟 ${sw ? 'Kumbukumbu ya Wiki' : 'Note of the Week'}`,
        dateLabel: timelineDayLabel(c.date, sw),
        dateKey: c.date,
        feeling: c.feeling,
        text: c.text.slice(0, 2000),
        theme: rememberedNoteTheme(meUid),
      };
      let postId: string | undefined;
      try {
        const [{ reservePost, uploadProcessedPhoto, finalizePost }, { processPhotoForUpload }] = await Promise.all([
          import('@/lib/moments'), import('@/lib/photoUpload'),
        ]);
        const blob = await noteCardPngBlob(card);
        const file = new File([blob], noteFilename(card), { type: 'image/png' });
        const processed = await processPhotoForUpload(file);
        postId = await reservePost(familyId, meUid);
        const photo = await uploadProcessedPhoto(familyId, postId, processed);
        await finalizePost(familyId, postId, {
          authorUid: meUid,
          authorName: meName,
          caption: `🌟 ${sw ? 'Kumbukumbu ya Wiki' : 'Note of the Week'} · ${c.kidName} · ${card.dateLabel}`,
          photos: [photo],
          kidTags: [c.kidId],
          mentionedUids: [],
          visibility: 'family',
        });
      } catch {
        // Moments minting is best-effort — the crown itself still lands
        // on the meeting record below.
      }
      onRecord({
        kidId: c.kidId, kidName: c.kidName, date: c.date, surface: c.surface,
        excerpt: c.text.slice(0, 160), ...(postId ? { postId } : {}), at: Date.now(),
      });
    } catch (e) {
      setError((e as Error).message || 'Could not crown this note');
    } finally { setBusy(false); }
  };

  if (record) {
    return (
      <div className="text-center space-y-3">
        <div className="text-[46px]">🌟</div>
        <p className="text-[16px] font-bold text-white m-0">
          {sw
            ? `Kumbukumbu ya ${record.kidName} imevikwa taji!`
            : `${record.kidName}'s note wears the crown!`}
        </p>
        <p className="text-[13px] text-white/80 italic m-0">“{record.excerpt}”</p>
        <p className="text-[11.5px] text-white/60 m-0">
          {record.postId
            ? (sw ? '📸 Kadi ya 🌟 iko Moments sasa.' : '📸 The 🌟 card is in Moments now.')
            : (sw ? 'Imeandikwa kwenye kumbukumbu ya mkutano.' : 'Recorded on the meeting notes.')}
        </p>
      </div>
    );
  }

  if (candidates === null) {
    return <p className="text-center text-[13px] text-white/70">{sw ? 'Kaya anasoma wiki…' : 'Kaya is reading the week…'}</p>;
  }
  if (candidates.length === 0) {
    return (
      <div className="text-center space-y-2">
        <div className="text-[38px]">📔</div>
        <p className="text-[13.5px] text-white/80 m-0">
          {sw
            ? 'Hakuna kumbukumbu za wiki hii — wiki ijayo, andikeni kidogo kila siku!'
            : 'No journal notes this week — next week, a few lines a day and this stage is yours!'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-center text-[12px] text-white/70 m-0">
        {sw
          ? `Kaya ameteua ${candidates.length} — someni kwa sauti, kisha vikeni taji moja 🌟`
          : `Kaya nominated ${candidates.length} — read them aloud, then crown one 🌟`}
      </p>
      {candidates.map((c) => (
        <div key={`${c.kidId}-${c.surface}-${c.date}`} className="rounded-kaya-lg bg-white/10 border border-white/10 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-bold text-white">
              {c.feeling ?? '📝'} {c.kidName} · {c.surface === 'diary' ? '📔' : '🪞'} {timelineDayLabel(c.date, sw)}
            </span>
            <button type="button" disabled={busy} onClick={() => crown(c)}
              className="shrink-0 rounded-full bg-kaya-gold text-[#4A3200] px-3.5 py-1.5 text-[12px] font-black disabled:opacity-50">
              {busy ? '…' : `👑 ${sw ? 'Taji' : 'Crown it'}`}
            </button>
          </div>
          <p className="text-[13px] text-white/85 italic leading-relaxed mt-2 m-0 max-h-32 overflow-y-auto whitespace-pre-wrap">
            “{c.text.length > 600 ? `${c.text.slice(0, 600)}…` : c.text}”
          </p>
        </div>
      ))}
      {error && <p className="text-center text-[12px] text-red-300 m-0">{error}</p>}
    </div>
  );
}
