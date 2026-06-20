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

  const Row = ({ emoji, label, lines, tags }: { emoji: string; label: string; lines: string[]; tags?: (string | null)[] }) => {
    if (!lines || lines.length === 0) return null;
    const hasTags = !!tags && tags.some(Boolean);
    return (
      <div className="flex gap-2 text-[12.5px] mb-1.5">
        <span className="font-black uppercase tracking-wide text-[9.5px] w-[78px] flex-shrink-0 pt-[2px]" style={{ color: '#9B8A72' }}>
          {emoji} {label}
        </span>
        <span className="flex-1" style={{ color: '#3D241A' }}>
          {hasTags ? (
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

  return (
    <div className="space-y-3">
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
          <Row emoji="🎯" label="Goal" lines={e.goals} />
        </div>
      ))}
    </div>
  );
}
