'use client';

// ── My Submissions (Sunday-Meeting v2 · PR F → shared 2026-06-14) ─────
// Read-only archive of what a member shared at past meetings — Gratitude
// / Appreciation (multi / "Everyone") / Goal per week, newest first. A
// keepsake anyone can look back on. Shared by the kids' My Workplan tab
// and the parent/everyone My Day "My Submissions" tab.

import { useEffect, useState } from 'react';
import {
  getMeetingSubmissionHistory, getAllMeetingSubmissionHistory,
  type SubmissionHistoryDoc,
} from '@/lib/meetingSubmissionHistory';
import { toDisplayDate } from '@/lib/dates';

const PURPLE = '#9B5DE5';

export default function SubmissionHistoryView({ familyId, uid }: { familyId: string; uid: string }) {
  const [doc, setDoc] = useState<SubmissionHistoryDoc | null>(null);
  const [loading, setLoading] = useState(true);

  // 🫙 Family Gratitude Jar. Pool of every gratitude with who/when.
  // Parents/helpers can read the whole family's; a kid can only read
  // their own (rules), so we try family-wide and fall back to own.
  const [jar, setJar] = useState<Array<{ text: string; who: string; date: string }>>([]);
  const [jarPick, setJarPick] = useState<{ text: string; who: string; date: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMeetingSubmissionHistory(familyId, uid)
      .then((d) => { if (!cancelled) setDoc(d); })
      .catch(() => { if (!cancelled) setDoc(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    getAllMeetingSubmissionHistory(familyId)
      .then((docs) => {
        if (cancelled) return;
        const pool: Array<{ text: string; who: string; date: string }> = [];
        for (const d of docs) for (const e of d.entries || []) for (const g of e.gratitudes || []) {
          if (g) pool.push({ text: g, who: d.name || '', date: e.date });
        }
        setJar(pool);
      })
      .catch(() => { /* kid: family read denied — jar fills from own below */ });
    return () => { cancelled = true; };
  }, [familyId, uid]);

  // Fall back to own gratitudes for the jar if the family-wide read was
  // denied (kid) or returned nothing.
  useEffect(() => {
    if (jar.length > 0 || !doc) return;
    const own: Array<{ text: string; who: string; date: string }> = [];
    for (const e of doc.entries || []) for (const g of e.gratitudes || []) {
      if (g) own.push({ text: g, who: doc.name || '', date: e.date });
    }
    if (own.length) setJar(own);
  }, [doc, jar.length]);

  const shake = () => {
    if (jar.length === 0) return;
    let next = jar[Math.floor(jar.length * Math.random())];
    if (jar.length > 1 && jarPick && next.text === jarPick.text) {
      next = jar[(jar.indexOf(next) + 1) % jar.length];
    }
    setJarPick(next);
  };

  if (loading) {
    return <p className="text-center text-[13px] font-extrabold py-8" style={{ color: PURPLE }}>Loading your submissions…</p>;
  }

  const entries = doc?.entries || [];
  if (entries.length === 0) {
    return (
      <div className="text-center py-12 px-4">
        <div className="text-4xl mb-2">📒</div>
        <p className="font-black text-[15px]" style={{ color: '#2D1B5E' }}>No submissions yet</p>
        <p className="text-[12px] mt-1" style={{ color: '#5C6975' }}>
          Fill your meeting prep — after each meeting it&apos;s saved here so you can always look back.
        </p>
      </div>
    );
  }

  const Row = ({ emoji, label, lines, tags, reflection }: {
    emoji: string; label: string; lines: string[];
    tags?: (string | null)[];
    reflection?: Array<{ text: string; done: boolean }>;
  }) => {
    if (!lines || lines.length === 0) return null;
    const hasTags = !!tags && tags.some(Boolean);
    const hasReflection = !!reflection && reflection.length > 0;
    return (
      <div className="flex gap-2 text-[12.5px] mb-1.5">
        <span className="font-black uppercase tracking-wide text-[9.5px] w-[78px] flex-shrink-0 pt-[2px]" style={{ color: '#9B8A72' }}>
          {emoji} {label}
        </span>
        <span className="flex-1" style={{ color: '#3D241A' }}>
          {hasReflection ? (
            lines.map((ln, i) => {
              const r = reflection?.[i];
              return (
                <span key={i} className="flex items-start gap-1.5 mb-0.5">
                  <span className={`shrink-0 mt-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black ${r?.done ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-500'}`}>
                    {r?.done ? '✓' : '↻'}
                  </span>
                  <span className={r?.done ? 'line-through text-[#9B8A72]' : ''}>{ln}</span>
                </span>
              );
            })
          ) : hasTags ? (
            lines.map((ln, i) => (
              <span key={i} className="block">
                {tags?.[i] && <span className="font-extrabold" style={{ color: PURPLE }}>💛 {tags[i]} · </span>}
                {ln}
              </span>
            ))
          ) : (
            lines.join(' · ')
          )}
        </span>
      </div>
    );
  };

  // Build the goal register: all past goals across all entries, newest first.
  const goalRegister = entries
    .flatMap((e) => (e.goals || []).map((g, i) => ({
      date: e.date,
      goal: g,
      done: e.goalsReflection?.[i]?.done,
    })))
    .filter((r) => r.goal);

  return (
    <div className="space-y-3">
      {/* 🎯 Goal Register — compact list of all past goals + accomplished status */}
      {goalRegister.length > 0 && (
        <div className="rounded-2xl border-2 p-4" style={{ borderColor: '#E8E0FF', background: 'linear-gradient(180deg,#F5F0FF,#fff)' }}>
          <p className="font-black text-[11px] uppercase tracking-wide mb-3" style={{ color: PURPLE }}>
            🎯 Goal Register
          </p>
          <div className="space-y-1.5">
            {goalRegister.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black ${
                  r.done === true ? 'bg-emerald-100 text-emerald-600' :
                  r.done === false ? 'bg-amber-100 text-amber-500' :
                  'bg-white/60 text-[#9B8A72] border border-dashed border-[#9B8A72]/40'
                }`}>
                  {r.done === true ? '✓' : r.done === false ? '↻' : '·'}
                </span>
                <div className="flex-1 min-w-0">
                  <span className={`text-[12.5px] leading-snug ${r.done ? 'line-through text-[#9B8A72]' : ''}`} style={{ color: r.done ? undefined : '#3D241A' }}>
                    {r.goal}
                  </span>
                  <span className="ml-1.5 text-[10px]" style={{ color: '#9B8A72' }}>
                    {toDisplayDate(r.date) || r.date}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px]" style={{ color: '#9B8A72' }}>
            ✓ accomplished · ↻ carried · · not yet reviewed
          </p>
        </div>
      )}

      {jar.length > 0 && (
        <div className="rounded-2xl border-2 p-4 text-center" style={{ borderColor: '#D4A017', background: 'linear-gradient(180deg,#FFF8E7,#fff)' }}>
          <p className="font-black text-[11px] uppercase tracking-wide" style={{ color: '#B8860B' }}>
            🫙 Family Gratitude Jar
          </p>
          {jarPick ? (
            <div className="mt-2">
              <p className="text-[14px] font-extrabold italic leading-snug" style={{ color: '#3D241A' }}>
                &ldquo;{jarPick.text}&rdquo;
              </p>
              <p className="text-[11px] font-bold mt-1" style={{ color: '#9B8A72' }}>
                — {jarPick.who || 'you'}{jarPick.date ? ` · ${toDisplayDate(jarPick.date) || jarPick.date}` : ''}
              </p>
            </div>
          ) : (
            <p className="text-[12px] mt-1" style={{ color: '#5C6975' }}>
              {jar.length} gratitude{jar.length === 1 ? '' : 's'} saved. Give it a shake! ✨
            </p>
          )}
          <button
            type="button"
            onClick={shake}
            className="mt-3 inline-flex items-center gap-1.5 h-10 px-5 rounded-full font-black text-[12.5px] text-white transition-colors"
            style={{ background: '#D4A017' }}
          >
            🫙 {jarPick ? 'Shake again' : 'Shake the jar'}
          </button>
        </div>
      )}

      {entries.map((e, i) => (
        <div key={`${e.date}-${i}`} className="rounded-2xl bg-white border-2 p-3.5" style={{ borderColor: '#F0E8FF' }}>
          <p className="font-black text-[11px] uppercase tracking-wide mb-2" style={{ color: '#B8860B' }}>
            🗓️ {toDisplayDate(e.date) || e.date}
          </p>
          <Row emoji="🙏" label="Grateful" lines={e.gratitudes} />
          <Row
            emoji="💛"
            label="Appreciate"
            lines={e.appreciations}
            tags={e.appreciationTagNames ?? (e.appreciationTagName ? [e.appreciationTagName] : [])}
          />
          <Row emoji="🎯" label="Goal" lines={e.goals} reflection={e.goalsReflection} />
        </div>
      ))}
    </div>
  );
}
