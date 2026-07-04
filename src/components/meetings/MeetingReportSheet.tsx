'use client';

// 📖 Meeting Report (SM3.1 · #5a) — tap a past meeting → the whole story on
// one sheet: attendance (kids · parents · guests), the Opening Word, per-kid
// gratitude/appreciations, goals with their later done-state, the closing
// reflection, notes — plus "📧 Email me this report" (sends to the requesting
// parent via /api/meetings/report-email). Read-only; renders whatever the
// meeting doc has, so old meetings simply show fewer sections.

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { getFamilyMembers, type Meeting, type Child } from '@/lib/firestore';

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtMeetingDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  return `${DAY_ABBR[new Date(y, m - 1, d).getDay()]} · ${String(d).padStart(2, '0')}-${MONTH_ABBR[m - 1]}-${y}`;
}

const OPENING_LABEL: Record<string, string> = {
  prayer: '🙏 Prayer', wisdom: '💡 Word of wisdom', verse: '📖 Verse', own: '🗣️ Own words',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-1.5">{title}</p>
      <div className="text-[13px] text-kaya-chocolate leading-relaxed space-y-1">{children}</div>
    </div>
  );
}

export default function MeetingReportSheet({ meeting, childrenList, familyId, onClose }: {
  meeting: Meeting;
  childrenList: Child[];
  familyId: string;
  onClose: () => void;
}) {
  const [parentNames, setParentNames] = useState<Record<string, string>>({});
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  useEffect(() => {
    let off = false;
    getFamilyMembers(familyId).then((members) => {
      if (off) return;
      const map: Record<string, string> = {};
      for (const m of members) map[m.uid] = m.displayName || 'Family member';
      setParentNames(map);
    }).catch(() => {});
    return () => { off = true; };
  }, [familyId]);

  const kidById = useMemo(() => {
    const m = new Map<string, Child>();
    for (const c of childrenList) m.set(c.id, c);
    return m;
  }, [childrenList]);

  const kids = (meeting.attendees || []).map((id) => kidById.get(id)).filter(Boolean) as Child[];
  const parents = (meeting.parentAttendees || []).map((uid) => parentNames[uid]).filter(Boolean);
  const guests = meeting.guestAttendees || [];

  const perKid = (rec?: Record<string, string>) =>
    Object.entries(rec || {}).filter(([, v]) => (v || '').trim());

  const goals = perKid(meeting.goals);
  const gratitude = perKid(meeting.gratitude);
  const appreciations = perKid(meeting.appreciations);
  const reflectionModes = meeting.reflection?.modes || (meeting.reflection?.mode ? [meeting.reflection.mode] : []);

  const emailMe = async () => {
    if (emailState === 'sending') return;
    setEmailState('sending');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/meetings/report-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ meetingId: meeting.id }),
      });
      setEmailState(res.ok ? 'sent' : 'error');
    } catch {
      setEmailState('error');
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end lg:items-center justify-center">
      <button type="button" aria-label="Close report" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <div className="relative w-full lg:max-w-xl max-h-[90vh] overflow-y-auto bg-kaya-cream rounded-t-kaya-lg lg:rounded-kaya-lg shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-br from-[#241a12] to-[#3a2a18] text-white px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[2px] text-kaya-gold">📖 Meeting Report</p>
            <p className="font-display font-black text-lg leading-tight mt-0.5">{fmtMeetingDay(meeting.date)}</p>
            <p className="text-[11px] opacity-80 mt-0.5">
              {meeting.type === 'kid-led' ? '🧒 Kid-led' : '👨‍👩‍👧‍👦 Weekly'} · <span className="text-emerald-300 font-bold">🟢 held &amp; closed</span>
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center text-lg font-black shrink-0">✕</button>
        </div>

        <div className="p-5">
          <Section title="👋 Attendance">
            {kids.length > 0 && (
              <p><span className="font-bold">Kids:</span> {kids.map((c) => `${c.avatarEmoji ?? ''} ${c.name}`.trim()).join(' · ')}</p>
            )}
            {parents.length > 0 && <p><span className="font-bold">Parents:</span> {parents.join(' · ')}</p>}
            {guests.length > 0 && (
              <p><span className="font-bold">Guests:</span> {guests.map((g) => `${g.name}${g.relationship ? ` (${g.relationship})` : ''}`).join(' · ')}</p>
            )}
            {kids.length === 0 && parents.length === 0 && guests.length === 0 && <p className="text-kaya-sand">Not recorded.</p>}
          </Section>

          {meeting.openingWord && (
            <Section title="🙏 Opening Word">
              <p>
                <span className="font-bold">{OPENING_LABEL[meeting.openingWord.mode] || meeting.openingWord.mode}</span>
                {meeting.openingWord.note ? <> — {meeting.openingWord.note}</> : null}
              </p>
            </Section>
          )}

          {gratitude.length > 0 && (
            <Section title="🙏 Gratitude">
              {gratitude.map(([cid, txt]) => (
                <p key={cid}>• <span className="font-bold">{kidById.get(cid)?.name || 'Someone'}:</span> {txt}</p>
              ))}
            </Section>
          )}

          {appreciations.length > 0 && (
            <Section title="💛 Appreciations">
              {appreciations.map(([cid, txt]) => (
                <p key={cid}>• <span className="font-bold">{kidById.get(cid)?.name || 'Someone'}:</span> {txt}</p>
              ))}
            </Section>
          )}

          {(meeting.presentation?.by || meeting.presentation?.topic) && (
            <Section title="🎤 Presentation">
              <p>{meeting.presentation?.by || 'Someone'}{meeting.presentation?.topic ? ` — ${meeting.presentation.topic}` : ''}</p>
            </Section>
          )}

          {goals.length > 0 && (
            <Section title="🎯 Goals set">
              {goals.map(([cid, txt]) => {
                const done = meeting.goalsDone?.[cid] === true;
                const promised = (meeting.pinkyPromised || []).includes(cid);
                return (
                  <p key={cid}>
                    • <span className="font-bold">{kidById.get(cid)?.name || 'Someone'}:</span> {txt}
                    {promised && <span title="Pinky-promised"> 🤝</span>}
                    {done && <span className="text-emerald-600 font-bold"> ✓ done</span>}
                  </p>
                );
              })}
            </Section>
          )}

          {reflectionModes.length > 0 && (
            <Section title="✨ Closing reflection">
              {reflectionModes.map((mode) => {
                const txt = meeting.reflection?.contents?.[mode] || (meeting.reflection?.mode === mode ? meeting.reflection?.content : '') || '';
                return <p key={mode}>• <span className="font-bold capitalize">{mode}</span>{txt ? ` — ${txt}` : ''}</p>;
              })}
            </Section>
          )}

          {meeting.notes && (
            <Section title="📝 Notes"><p>{meeting.notes}</p></Section>
          )}

          <button
            type="button"
            onClick={emailMe}
            disabled={emailState === 'sending' || emailState === 'sent'}
            className="w-full h-12 rounded-kaya bg-kaya-chocolate text-white font-display font-extrabold text-sm disabled:opacity-60 mt-1"
          >
            {emailState === 'sending' ? 'Sending…'
              : emailState === 'sent' ? '✓ Sent to your email'
              : emailState === 'error' ? 'Couldn’t send — tap to retry'
              : '📧 Email me this report'}
          </button>
        </div>
      </div>
    </div>
  );
}
