'use client';

// 🎁 Sunday Surprise (SM3.1 · #7) — the final presenter step: one shared
// moment to end the night, picked (seeded by the date, leader can swap)
// from whatever the family enabled in settings. Photo/video surprises
// auto-post to Moments AND stamp the meeting record; live surprises stamp
// a note. Secret Mission runs a two-week loop: sealed tonight, checked in
// FIRST thing next Sunday before a new surprise plays.

import { useMemo, useRef, useState } from 'react';
import { useEffect } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  reservePost, finalizePost, uploadProcessedPhoto, uploadProcessedVideo,
  type Post, type PhotoRef,
} from '@/lib/moments';
import { processPhotoForUpload, processVideoForUpload, MAX_PHOTO_BYTES } from '@/lib/photoUpload';
import {
  enabledSurprises, seededIndex, PHOTO_PROMPTS, VIDEO_PROMPTS, MISSIONS,
  type SurpriseDef,
} from '@/lib/meetingSurprises';
import { updateMeeting, type Meeting, type Child } from '@/lib/firestore';

export interface SurpriseRecord {
  id: string;
  promptText?: string;
  note?: string;
  postId?: string;
  missions?: Record<string, string>;
}

interface OldPost { id: string; caption: string; date: string; imageUrl: string }

export default function SundaySurpriseStep({
  familyId, meUid, meName, childrenList, presentPeople, guestSuggestion,
  surpriseOverrides, goldenTickets, dateKey, record, onRecord,
  missionMeeting, meetingsForQuiz,
}: {
  familyId: string;
  meUid: string;
  meName: string;
  childrenList: Child[];
  /** Everyone marked present tonight — display names (kids + parents). */
  presentPeople: Array<{ key: string; name: string }>;
  guestSuggestion?: string;
  surpriseOverrides?: Record<string, boolean>;
  goldenTickets?: string[];
  dateKey: string;                       // today, YYYY-MM-DD — the pick seed
  record: SurpriseRecord | null;         // tonight's captured surprise (parent state)
  onRecord: (r: SurpriseRecord | null) => void;
  /** A PAST meeting whose Secret Missions were never checked → check-in first. */
  missionMeeting?: Meeting | null;
  meetingsForQuiz: Meeting[];
}) {
  const defs = useMemo(() => enabledSurprises(surpriseOverrides), [surpriseOverrides]);
  const [swap, setSwap] = useState(0);
  const def: SurpriseDef | undefined = defs.length > 0
    ? defs[(seededIndex(dateKey, defs.length) + swap) % defs.length]
    : undefined;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  // ── Secret Mission check-in (the two-week loop) ────────────────────
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [checkinDone, setCheckinDone] = useState(false);
  const missionsToCheck = missionMeeting?.surprise?.missions || {};
  const needsCheckin = !!missionMeeting && Object.keys(missionsToCheck).length > 0 && !checkinDone;
  const nameForKey = (key: string) =>
    childrenList.find((c) => c.id === key)?.name
    || presentPeople.find((p) => p.key === key)?.name
    || 'Someone';
  const saveCheckin = async () => {
    if (!missionMeeting) return;
    setBusy(true);
    try {
      await updateMeeting(familyId, missionMeeting.id, {
        surprise: { ...(missionMeeting.surprise || { id: 'mission' }), checkedMissions: checked },
      } as Partial<Meeting>);
      setCheckinDone(true);
    } catch { setErr('Couldn’t save the mission check-in — you can continue anyway.'); setCheckinDone(true); }
    finally { setBusy(false); }
  };

  // ── Media capture → Moments ────────────────────────────────────────
  const promptText = useMemo(() => {
    if (def?.id === 'photo') return PHOTO_PROMPTS[seededIndex(dateKey + swap, PHOTO_PROMPTS.length)];
    if (def?.id === 'video') return VIDEO_PROMPTS[seededIndex(dateKey + swap, VIDEO_PROMPTS.length)];
    return undefined;
  }, [def?.id, dateKey, swap]);

  const onMediaFile = async (file: File) => {
    if (!def) return;
    setBusy(true); setErr('');
    let postId: string | null = null;
    try {
      postId = await reservePost(familyId, meUid);
      let ref: PhotoRef;
      if (def.id === 'video' && file.type.startsWith('video/')) {
        const v = await processVideoForUpload(file);
        ref = await uploadProcessedVideo(familyId, postId, {
          poster: v.poster, videoBlob: v.videoBlob, contentType: v.contentType, durationSec: v.durationSec,
        });
      } else {
        if (file.size > MAX_PHOTO_BYTES) throw new Error('That photo is too large.');
        const p = await processPhotoForUpload(file);
        ref = await uploadProcessedPhoto(familyId, postId, p);
      }
      const postData: Omit<Post, 'id' | 'reactionCount' | 'reactionsByType' | 'commentCount' | 'createdAt' | 'updatedAt'> = {
        authorUid: meUid,
        authorName: meName,
        caption: `🎁 Sunday Surprise — ${promptText || def.name}`,
        photos: [ref],
        kidTags: childrenList.map((c) => c.id),
        visibility: 'family',
        eventTag: { id: 'custom', emoji: '🎁', label: 'Family Meeting' },
      };
      await finalizePost(familyId, postId, postData);
      onRecord({ id: def.id, promptText, postId });
    } catch (e) {
      // A failed reserved post stays pending:true — invisible in the feed,
      // so no cleanup needed here.
      setErr(e instanceof Error ? e.message : 'Upload failed — try again.');
    } finally { setBusy(false); }
  };

  // ── 🎤 Compliment Shower ───────────────────────────────────────────
  const showerTarget = presentPeople.length > 0
    ? presentPeople[seededIndex(dateKey + swap, presentPeople.length)]
    : undefined;
  const [timer, setTimer] = useState<number | null>(null);
  useEffect(() => {
    if (timer === null || timer <= 0) return;
    const t = setTimeout(() => setTimer((v) => (v === null ? null : v - 1)), 1000);
    return () => clearTimeout(t);
  }, [timer]);

  // ── 🕰️ Time Machine ────────────────────────────────────────────────
  const [oldPost, setOldPost] = useState<OldPost | null | 'none'>(null);
  const [tmRevealed, setTmRevealed] = useState(false);
  useEffect(() => {
    if (def?.id !== 'timemachine' || oldPost !== null) return;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'families', familyId, 'posts'), orderBy('createdAt', 'asc'), limit(40)));
        const cutoff = Date.now() - 180 * 86400000;
        type RawPost = {
          createdAt?: { toMillis?: () => number };
          photos?: Array<{ feedUrl?: string; kind?: string }>;
          caption?: string;
          pending?: boolean;
        };
        const cands = snap.docs
          .map((d) => ({ id: d.id, data: d.data() as RawPost }))
          .filter(({ data }) => {
            const at = data.createdAt?.toMillis?.() || 0;
            return at > 0 && at < cutoff && !!data.photos?.[0]?.feedUrl && data.photos[0]?.kind !== 'video' && data.pending !== true;
          });
        if (cands.length === 0) { setOldPost('none'); return; }
        const pick = cands[seededIndex(dateKey, cands.length)];
        const at = pick.data.createdAt!.toMillis!();
        const d = new Date(at);
        setOldPost({
          id: pick.id,
          caption: String(pick.data.caption || ''),
          date: d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
          imageUrl: pick.data.photos![0].feedUrl!,
        });
      } catch { setOldPost('none'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def?.id, familyId, dateKey]);

  // ── 🧩 Flash Quiz — three questions from the family's own data ─────
  const quiz = useMemo(() => {
    const qs: Array<{ q: string; options: string[]; correct: number }> = [];
    // Q1 — meeting count this year (from the record on hand).
    const year = String(new Date().getFullYear());
    const count = meetingsForQuiz.filter((m) => m.date.startsWith(year)).length;
    if (count > 0) {
      const opts = [count, count + 2, Math.max(1, count - 2)];
      qs.push({ q: `How many family meetings have we held in ${year}?`, options: opts.map(String), correct: 0 });
    }
    // Q2 — whose birthday comes next (needs ≥2 kids with birthdays).
    const withBd = childrenList.filter((c) => !!c.birthday);
    if (withBd.length >= 2) {
      const days = (b: string) => {
        const [, m, d] = b.split('-').map(Number);
        const now = new Date();
        const next = new Date(now.getFullYear(), (m || 1) - 1, d || 1);
        if (next < now) next.setFullYear(next.getFullYear() + 1);
        return Math.round((next.getTime() - now.getTime()) / 86400000);
      };
      const sorted = [...withBd].sort((a, b) => days(a.birthday!) - days(b.birthday!));
      qs.push({
        q: 'Whose birthday comes next? 🎂',
        options: sorted.slice(0, 3).map((c) => c.name),
        correct: 0,
      });
    }
    // Q3 — last meeting's goal (needs a past meeting with ≥2 goals).
    const lastWithGoals = meetingsForQuiz.find((m) => Object.values(m.goals || {}).filter((g) => (g || '').trim()).length >= 2);
    if (lastWithGoals) {
      const entries = Object.entries(lastWithGoals.goals).filter(([, g]) => (g || '').trim()).slice(0, 3);
      const [cid] = entries[0];
      const kid = childrenList.find((c) => c.id === cid)?.name || 'Someone';
      qs.push({ q: `Which goal did ${kid} commit to at that meeting?`, options: entries.map(([, g]) => g), correct: 0 });
    }
    // Shuffle options per question, tracking the right answer.
    return qs.slice(0, 3).map((qq) => {
      const correctText = qq.options[qq.correct];
      const opts = [...qq.options].sort(() => Math.random() - 0.5);
      return { q: qq.q, options: opts, correct: opts.indexOf(correctText) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingsForQuiz, childrenList]);
  const [quizPicks, setQuizPicks] = useState<Record<number, number>>({});

  // ── 🤫 Secret Mission (assign tonight) ─────────────────────────────
  const assignedMissions = useMemo(() => {
    const out: Record<string, string> = {};
    presentPeople.forEach((p, i) => {
      out[p.key] = MISSIONS[(seededIndex(dateKey, MISSIONS.length) + i) % MISSIONS.length];
    });
    return out;
  }, [presentPeople, dateKey]);
  const [peeked, setPeeked] = useState<Set<string>>(new Set());

  // ── 🍬 Golden Ticket ───────────────────────────────────────────────
  const ticket = (goldenTickets || []).length > 0
    ? (goldenTickets || [])[seededIndex(dateKey + swap, (goldenTickets || []).length)]
    : undefined;
  const [ticketOpen, setTicketOpen] = useState(false);

  const doneCard = record && (
    <div className="rounded-kaya bg-kaya-gold/10 border border-kaya-gold/50 p-4 text-center">
      <p className="font-display font-extrabold text-kaya-gold-light">
        ✓ Tonight&rsquo;s surprise is in the book{record.postId ? ' — and in Moments 📸' : ''}.
      </p>
      <p className="text-[12px] text-white/60 mt-1">It&rsquo;ll shine in the meeting report and Memories.</p>
    </div>
  );

  if (!def) {
    return (
      <div className="max-w-2xl mx-auto w-full text-center text-white/60 text-sm">
        All surprises are switched off in Meeting settings — flip some on to end the night with one 🎁
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto w-full">
      {/* 🤫 Mission check-in FIRST — last week's sealed missions come due. */}
      {needsCheckin ? (
        <div className="rounded-kaya bg-white/5 border border-white/15 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-gold mb-1">🤫 Secret Mission check-in — from last meeting</p>
          <p className="text-[12.5px] text-white/70 mb-3">Reveal each mission — did they pull it off?</p>
          <div className="space-y-2">
            {Object.entries(missionsToCheck).map(([key, mission]) => (
              <div key={key} className="flex items-center gap-2 bg-black/20 rounded-kaya-sm p-3">
                <span className="flex-1 text-[13px] text-white/85">
                  <b>{nameForKey(key)}</b>: {mission}
                </span>
                <button type="button" onClick={() => setChecked((p) => ({ ...p, [key]: true }))}
                  className={`h-8 px-3 rounded-full text-[12px] font-black ${checked[key] === true ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/70'}`}>✓ Did it</button>
                <button type="button" onClick={() => setChecked((p) => ({ ...p, [key]: false }))}
                  className={`h-8 px-3 rounded-full text-[12px] font-black ${checked[key] === false ? 'bg-rose-500/80 text-white' : 'bg-white/10 text-white/70'}`}>Next time</button>
              </div>
            ))}
          </div>
          <button type="button" disabled={busy} onClick={saveCheckin}
            className="mt-3 w-full h-11 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm disabled:opacity-60">
            {busy ? 'Saving…' : 'Save check-in → tonight’s surprise'}
          </button>
        </div>
      ) : record ? doneCard : (
        <>
          <div className="text-center mb-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-gold">Tonight&rsquo;s surprise</p>
            <p className="font-display font-black text-2xl text-white mt-1">{def.emoji} {def.name}</p>
            <p className="text-[12.5px] text-white/60 mt-1">{def.blurb}</p>
            {defs.length > 1 && (
              <button type="button" onClick={() => setSwap((s) => s + 1)}
                className="mt-2 text-[11px] font-bold text-white/45 hover:text-white/80 underline underline-offset-2">
                🔄 Leader&rsquo;s call — show another
              </button>
            )}
          </div>

          {(def.id === 'photo' || def.id === 'video') && (
            <div className="rounded-kaya bg-white/5 border border-white/15 p-4 text-center">
              <p className="font-display font-extrabold text-kaya-gold-light text-lg">“{promptText}”</p>
              <input
                ref={fileRef}
                type="file"
                accept={def.id === 'video' ? 'video/*' : 'image/*'}
                capture="environment"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onMediaFile(f); e.target.value = ''; }}
              />
              <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
                className="mt-4 w-full h-12 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm disabled:opacity-60">
                {busy ? 'Uploading…' : def.id === 'video' ? '🎬 Record the video (15–30s)' : '📸 Take the picture'}
              </button>
              <p className="text-[11px] text-white/45 mt-2">Posts to Moments + saved on tonight&rsquo;s meeting.</p>
            </div>
          )}

          {def.id === 'song' && (
            <div className="rounded-kaya bg-white/5 border border-white/15 p-4 text-center">
              <p className="text-[13.5px] text-white/85">🎶 Thirty seconds of joy — sing one together. Loud counts more than perfect.</p>
              <button type="button" onClick={() => onRecord({ id: 'song', note: 'We sang together 🎶' })}
                className="mt-4 w-full h-12 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm">
                ✓ We sang it!
              </button>
            </div>
          )}

          {def.id === 'shower' && showerTarget && (
            <div className="rounded-kaya bg-white/5 border border-white/15 p-4 text-center">
              <p className="text-[13.5px] text-white/85">Tonight the compliments rain on…</p>
              <p className="font-display font-black text-3xl text-kaya-gold-light my-2">{showerTarget.name} 🎤</p>
              {timer === null ? (
                <button type="button" onClick={() => setTimer(30)}
                  className="w-full h-12 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm">
                  ▶ Start the 30-second shower
                </button>
              ) : timer > 0 ? (
                <p className="font-display font-black text-5xl text-white">{timer}</p>
              ) : (
                <button type="button" onClick={() => onRecord({ id: 'shower', note: `Compliment shower for ${showerTarget.name}` })}
                  className="w-full h-12 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm">
                  ✓ {showerTarget.name} is glowing — done!
                </button>
              )}
            </div>
          )}

          {def.id === 'timemachine' && (
            <div className="rounded-kaya bg-white/5 border border-white/15 p-4 text-center">
              {oldPost === null && <p className="text-white/60 text-sm">Spinning up the time machine…</p>}
              {oldPost === 'none' && (
                <>
                  <p className="text-white/70 text-sm">Not enough old Moments yet — the machine needs 6+ months of memories.</p>
                  <button type="button" onClick={() => setSwap((s) => s + 1)} className="mt-3 text-[12px] font-bold text-kaya-gold underline">Pick another surprise →</button>
                </>
              )}
              {oldPost !== null && oldPost !== 'none' && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={oldPost.imageUrl} alt="A memory" className="rounded-kaya max-h-64 mx-auto object-contain" />
                  {!tmRevealed ? (
                    <button type="button" onClick={() => setTmRevealed(true)}
                      className="mt-3 w-full h-11 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm">
                      🕰️ When was this? Tap to reveal
                    </button>
                  ) : (
                    <>
                      <p className="text-[13px] text-white/85 mt-3"><b>{oldPost.date}</b>{oldPost.caption ? ` — “${oldPost.caption}”` : ''}</p>
                      <button type="button" onClick={() => onRecord({ id: 'timemachine', note: `Time-machined to ${oldPost.date}` })}
                        className="mt-3 w-full h-11 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm">
                        ✓ Story told — done
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {def.id === 'flashquiz' && (
            <div className="rounded-kaya bg-white/5 border border-white/15 p-4">
              {quiz.length === 0 ? (
                <p className="text-white/70 text-sm text-center">Not enough Kaya history for a quiz yet — pick another surprise 🔄</p>
              ) : (
                <>
                  {quiz.map((qq, qi) => (
                    <div key={qi} className="mb-3">
                      <p className="text-[13px] font-display font-extrabold text-white/90 mb-1.5">Q{qi + 1} · {qq.q}</p>
                      <div className="space-y-1.5">
                        {qq.options.map((opt, oi) => {
                          const pickd = quizPicks[qi];
                          const show = pickd !== undefined;
                          return (
                            <button key={oi} type="button" disabled={show}
                              onClick={() => setQuizPicks((p) => ({ ...p, [qi]: oi }))}
                              className={`w-full text-left px-3 py-2 rounded-kaya-sm border text-[12.5px] font-semibold ${
                                show && oi === qq.correct ? 'border-emerald-400/80 bg-emerald-500/15 text-emerald-100'
                                : show && pickd === oi ? 'border-rose-400/80 bg-rose-500/10 text-rose-100'
                                : 'border-white/15 bg-black/20 text-white/80'
                              }`}>
                              {String.fromCharCode(65 + oi)} · {opt}{show && oi === qq.correct ? ' ✓' : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {Object.keys(quizPicks).length >= quiz.length && (
                    <button type="button" onClick={() => onRecord({ id: 'flashquiz', note: `Flash quiz — ${quiz.length} questions` })}
                      className="w-full h-11 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm">
                      ✓ Quiz done!
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {def.id === 'mission' && (
            <div className="rounded-kaya bg-white/5 border border-white/15 p-4">
              <p className="text-[12.5px] text-white/70 mb-3 text-center">Pass the screen around — each person peeks at THEIR mission only 🤫 Checked next Sunday.</p>
              <div className="space-y-2">
                {presentPeople.map((p) => (
                  <div key={p.key} className="flex items-center gap-2 bg-black/20 rounded-kaya-sm p-3">
                    <span className="flex-1 text-[13px] font-bold text-white/85">{p.name}</span>
                    {peeked.has(p.key) ? (
                      <span className="text-[12px] text-kaya-gold-light">{assignedMissions[p.key]}</span>
                    ) : (
                      <button type="button" onClick={() => setPeeked((prev) => new Set(prev).add(p.key))}
                        className="h-8 px-3 rounded-full bg-white/10 text-white/80 text-[12px] font-black">👀 Peek</button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => onRecord({ id: 'mission', missions: assignedMissions, note: 'Missions sealed 🤫' })}
                className="mt-3 w-full h-11 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm">
                🤫 Seal the missions — see you next Sunday
              </button>
            </div>
          )}

          {def.id === 'call' && (
            <div className="rounded-kaya bg-white/5 border border-white/15 p-4 text-center">
              <p className="text-[13.5px] text-white/85">📞 Two minutes on speakerphone to say goodnight{guestSuggestion ? <> — how about <b className="text-kaya-gold-light">{guestSuggestion}</b>?</> : ' to a grandparent or someone you love.'}</p>
              <button type="button" onClick={() => onRecord({ id: 'call', note: guestSuggestion ? `Called ${guestSuggestion}` : 'Family call made' })}
                className="mt-4 w-full h-12 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm">
                ✓ We called!
              </button>
            </div>
          )}

          {def.id === 'ticket' && (
            <div className="rounded-kaya bg-white/5 border border-white/15 p-4 text-center">
              {!ticket ? (
                <p className="text-white/70 text-sm">The Golden Ticket jar is empty — stock treats in ⚙ Meeting settings, then this surprise comes alive 🍬</p>
              ) : !ticketOpen ? (
                <button type="button" onClick={() => setTicketOpen(true)}
                  className="w-full h-14 rounded-kaya bg-gradient-to-r from-kaya-gold to-amber-400 text-kaya-chocolate font-display font-black text-base">
                  🍬 Open tonight&rsquo;s Golden Ticket…
                </button>
              ) : (
                <>
                  <p className="font-display font-black text-xl text-kaya-gold-light">🎉 {ticket}</p>
                  <button type="button" onClick={() => onRecord({ id: 'ticket', note: ticket })}
                    className="mt-4 w-full h-11 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm">
                    ✓ Ticket claimed!
                  </button>
                </>
              )}
            </div>
          )}

          {err && <p className="text-rose-300 text-[12px] font-bold mt-3 text-center">{err}</p>}
          <p className="text-center mt-4">
            <button type="button" onClick={() => onRecord(null)}
              className="text-[11px] font-bold text-white/40 hover:text-white/70 underline underline-offset-2">
              Skip tonight&rsquo;s surprise
            </button>
          </p>
        </>
      )}
    </div>
  );
}
