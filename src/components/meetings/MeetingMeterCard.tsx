'use client';

// ── 📊 Meeting Meter card (approved 2026-07-20 · OF-5) ──────────────────
// After the meeting, every member rates the night from their OWN device —
// 4 faces, one tap. Shows for the most recent meeting (last 7 days) the
// viewer hasn't rated yet; after voting it shows the live family average
// and, when this night beats every rated meeting before it, a 🏆 best-yet
// celebration. Ratings live in gameMeta (family-writable) — see
// lib/meetingMeter.ts for why not the meeting doc itself.

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getMeetings, Meeting } from '@/lib/firestore';
import { toDisplayDate } from '@/lib/dates';
import {
  METER_FACES, subscribeMeter, rateMeeting, meterAverage, faceForAvg,
  isBestMeetingYet, type MeterDoc,
} from '@/lib/meetingMeter';

const RATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function parseLocalDay(s: string): number {
  const [y, mo, d] = (s || '').split('-').map(Number);
  if (!y || !mo || !d) return 0;
  return new Date(y, mo - 1, d).getTime();
}

export default function MeetingMeterCard({ className = '' }: { className?: string }) {
  const { profile } = useAuth();
  const { family } = useFamily();
  const familyId = family?.id;
  const uid = profile?.uid;

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [priorIds, setPriorIds] = useState<string[]>([]);
  const [meter, setMeter] = useState<MeterDoc | null>(null);
  const [justRated, setJustRated] = useState(false);
  const [bestYet, setBestYet] = useState(false);

  // Most recent meeting inside the window — the card's subject.
  useEffect(() => {
    if (!familyId) return;
    getMeetings(familyId).then((ms) => {
      const now = Date.now();
      const sorted = [...ms].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const recent = sorted.find((m) => {
        const t = parseLocalDay(m.date);
        return t > 0 && now - t < RATE_WINDOW_MS;
      }) || null;
      setMeeting(recent);
      if (recent) setPriorIds(sorted.filter((m) => m.id !== recent.id && (m.date || '') < recent.date).map((m) => m.id));
    }).catch(() => {});
  }, [familyId]);

  useEffect(() => {
    if (!familyId || !meeting?.id) return;
    const unsub = subscribeMeter(familyId, meeting.id, setMeter);
    return () => unsub();
  }, [familyId, meeting?.id]);

  if (!familyId || !uid || !meeting) return null;

  const myVote = meter?.ratings?.[uid];
  const avg = meterAverage(meter);
  // Card retires once voted UNLESS the member just voted this visit —
  // then it lingers to show the average + any best-yet cheer.
  if (myVote != null && !justRated) return null;

  const vote = async (score: number) => {
    try {
      await rateMeeting(familyId, meeting.id, meeting.date, uid, score);
      setJustRated(true);
      isBestMeetingYet(familyId, meeting.id, priorIds).then(setBestYet).catch(() => {});
    } catch {
      // Swallow — a failed vote just leaves the card up to try again.
    }
  };

  return (
    <div className={`bg-white border border-kaya-warm-dark rounded-kaya-lg p-4 lg:p-5 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display font-black text-[14px] lg:text-[15px] text-kaya-chocolate">
          📊 How was our meeting?
        </p>
        <span className="text-[10px] uppercase tracking-wider font-bold text-kaya-sand shrink-0">
          {toDisplayDate(meeting.date) || meeting.date}
        </span>
      </div>

      {justRated ? (
        <div className="mt-3 text-center">
          {bestYet && (
            <p className="font-display font-black text-[15px] text-kaya-gold-dark mb-1">
              🏆 Best meeting yet — new family record!
            </p>
          )}
          <p className="text-[13px] text-kaya-chocolate">
            Thanks for rating! {avg && (
              <>Family average so far: <b>{faceForAvg(avg.avg).emoji} {avg.avg.toFixed(1)} / 4</b> · {avg.count} {avg.count === 1 ? 'vote' : 'votes'}</>
            )}
          </p>
        </div>
      ) : (
        <>
          <p className="text-[12px] text-kaya-sand mt-0.5 mb-3">
            One tap — your vote joins the family&apos;s meter for the night.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {METER_FACES.map((f) => (
              <button
                key={f.score}
                type="button"
                onClick={() => vote(f.score)}
                className="flex flex-col items-center gap-1 py-2.5 rounded-kaya border-2 border-kaya-warm-dark bg-kaya-cream/50 hover:border-kaya-gold hover:bg-kaya-gold/10 transition-colors"
              >
                <span className="text-2xl">{f.emoji}</span>
                <span className="text-[10px] font-extrabold text-kaya-chocolate/70">{f.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
