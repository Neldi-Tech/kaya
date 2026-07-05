'use client';

// ── Meeting Notes (approved design, 2026-06-21) ─────────────────────────
// The structured record of one past meeting — everything the family shared
// that night, readable any time: leadership (led / prayer / next), full
// attendance incl. guests, gratitude, appreciations (with tags), goals +
// their outcome today, the week's Points & Rewards snapshot, the closing
// (song + rating, prayer led-by), Moments earned, and the Kaya Founding
// sign-off. The 📤 Share sheet lands in the next PR; 🖨️ Print works now.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import BackButton from '@/components/ui/BackButton';
import { getMeeting, getFamilyMembers, type Meeting } from '@/lib/firestore';
import { toDisplayDate } from '@/lib/dates';
import { getSongLibrary, songIdFromUrl, type SongLibraryEntry } from '@/lib/meetingSongLibrary';
import { songThumbnailUrl } from '@/lib/songEmbed';

export default function MeetingNotesPage() {
  const params = useParams<{ id: string }>();
  const meetingId = params?.id;
  const { profile } = useAuth();
  const { children } = useFamily();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [parents, setParents] = useState<Array<{ uid: string; name: string }>>([]);
  const [song, setSong] = useState<SongLibraryEntry | null>(null);

  useEffect(() => {
    if (!profile?.familyId || !meetingId) return;
    let cancelled = false;
    Promise.all([
      getMeeting(profile.familyId, meetingId).catch(() => null),
      getFamilyMembers(profile.familyId).catch(() => []),
    ]).then(([m, members]) => {
      if (cancelled) return;
      setMeeting(m);
      setParents(members.filter((x) => x.role === 'parent').map((x) => ({ uid: x.uid, name: (x.displayName || 'Parent').split(' ')[0] })));
      // Resolve the closing song's library entry (title + family rating).
      const url = (m?.reflection?.contents?.songs || '').trim();
      if (url.startsWith('http') && profile.familyId) {
        getSongLibrary(profile.familyId)
          .then((rows) => { if (!cancelled) setSong(rows.find((s) => s.id === songIdFromUrl(url)) || null); })
          .catch(() => {});
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [profile?.familyId, meetingId]);

  const kidName = (id: string) => children.find((c) => c.id === id);

  // Attendance chips — kids, then parents, then guests.
  const attendance = useMemo(() => {
    if (!meeting) return [];
    const rows: Array<{ label: string }> = [];
    for (const id of meeting.attendees || []) {
      const c = kidName(id);
      if (c) rows.push({ label: `${c.avatarEmoji || '🧒'} ${c.name.split(' ')[0]}` });
    }
    for (const uid of meeting.parentAttendees || []) {
      const p = parents.find((x) => x.uid === uid);
      if (p) rows.push({ label: `👤 ${p.name}` });
    }
    for (const g of meeting.guestAttendees || []) {
      rows.push({ label: `🫂 ${g.name}${g.relationship ? ` · ${g.relationship}` : ''} · guest` });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting, parents, children]);

  // Moments — honest to what the record stores.
  const moments = useMemo(() => {
    if (!meeting) return [];
    const out: string[] = [];
    const goalKids = Object.keys(meeting.goals || {}).filter((k) => (meeting.goals?.[k] || '').trim());
    if (goalKids.length > 0 && goalKids.every((k) => meeting.goalsDone?.[k])) {
      out.push(`⚡ Family Combo ${goalKids.length}/${goalKids.length}`);
    }
    if ((meeting.pinkyPromised?.length ?? 0) > 0) {
      const names = (meeting.pinkyPromised || []).map((id) => kidName(id)?.name.split(' ')[0]).filter(Boolean).join(', ');
      out.push(`🤝 Pinky promises · ${names}`);
    }
    if (meeting.openingWord) out.push('🙏 Opening Word shared');
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting, children]);

  if (loading) {
    return <p className="text-center text-sm font-bold text-kaya-sand py-16">Loading meeting notes…</p>;
  }
  if (!meeting) {
    return (
      <div className="mx-auto max-w-md px-4 pt-8 text-center">
        <div className="text-4xl mb-2">📖</div>
        <p className="font-display font-black">Meeting not found</p>
        <Link href="/meetings" className="text-sm underline text-kaya-sand">← Back to meetings</Link>
      </div>
    );
  }

  const Section = ({ icon, title, children: kidsNode }: { icon: string; title: string; children: React.ReactNode }) => (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mt-3">
      <p className="font-display font-black text-[12px] uppercase tracking-[0.08em] text-kaya-gold-dark flex items-center gap-1.5 mb-1.5">
        <span>{icon}</span> {title}
      </p>
      {kidsNode}
    </div>
  );

  const Line = ({ emoji, name, text, extra }: { emoji: string; name: string; text: string; extra?: React.ReactNode }) => (
    <div className="flex gap-2 items-start mt-1.5">
      <span className="shrink-0 text-base leading-6">{emoji}</span>
      <p className="text-[13px] text-kaya-chocolate-light leading-relaxed">
        <b className="text-kaya-chocolate">{name}</b> — {text}{extra}
      </p>
    </div>
  );

  const songUrl = (meeting.reflection?.contents?.songs || '').trim();
  const thumb = songUrl.startsWith('http') ? songThumbnailUrl(songUrl) : null;

  return (
    <div className="mx-auto max-w-md lg:max-w-2xl w-full px-4 pt-4 pb-24 print:pt-0">
      <div className="print:hidden"><BackButton /></div>

      {/* Header */}
      <div className="rounded-kaya-lg p-5 text-kaya-gold-light mt-2" style={{ background: 'linear-gradient(150deg,#241509,#3d2712)' }}>
        <p className="font-display font-black text-lg text-white">📖 Meeting Notes · {toDisplayDate(meeting.date) || meeting.date}</p>
        <p className="text-[12px] opacity-75 mt-0.5">
          {meeting.type === 'kid-led' ? '🧒 Kid-led' : '👨‍👩‍👧‍👦 Weekly'} family meeting
        </p>
        {attendance.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {attendance.map((a, i) => (
              <span key={i} className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/10 border border-white/15">{a.label}</span>
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-4 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="h-10 px-4 rounded-kaya bg-white/10 border border-white/20 text-kaya-gold-light font-display font-extrabold text-[12px]"
          >
            🖨️ Print
          </button>
        </div>
      </div>

      {/* 🎤 Leadership */}
      {(meeting.ledByName || meeting.prayerLedBy || meeting.nextLeaderName) && (
        <Section icon="🎤" title="Leadership">
          {meeting.ledByName && <Line emoji="🎤" name={meeting.ledByName} text="led the meeting" />}
          {meeting.prayerLedBy && <Line emoji="🙏" name={meeting.prayerLedBy} text="led the family prayer" />}
          {meeting.nextLeaderName && <Line emoji="➡️" name={meeting.nextLeaderName} text="leads next week" />}
        </Section>
      )}

      {/* 🙏 Gratitude */}
      {Object.values((meeting.gratitude || {}) as Record<string, string>).some((v) => (v || '').trim()) && (
        <Section icon="🙏" title="Gratitude">
          {Object.entries((meeting.gratitude || {}) as Record<string, string>).map(([cid, txt]) => {
            const c = kidName(cid);
            return (txt || '').trim()
              ? <Line key={cid} emoji={c?.avatarEmoji || '🧒'} name={c?.name.split(' ')[0] || 'Kid'} text={txt} />
              : null;
          })}
        </Section>
      )}

      {/* 💛 Appreciations */}
      {Object.values((meeting.appreciations || {}) as Record<string, string>).some((v) => (v || '').trim()) && (
        <Section icon="💛" title="Appreciations">
          {Object.entries((meeting.appreciations || {}) as Record<string, string>).map(([cid, txt]) => {
            const c = kidName(cid);
            return (txt || '').trim()
              ? <Line key={cid} emoji={c?.avatarEmoji || '🧒'} name={c?.name.split(' ')[0] || 'Kid'} text={`“${txt}”`} />
              : null;
          })}
        </Section>
      )}

      {/* 🎯 Goals + outcomes */}
      {Object.values((meeting.goals || {}) as Record<string, string>).some((v) => (v || '').trim()) && (
        <Section icon="🎯" title="Goals set that night">
          {Object.entries((meeting.goals || {}) as Record<string, string>).map(([cid, goal]) => {
            if (!(goal || '').trim()) return null;
            const c = kidName(cid);
            const done = meeting.goalsDone?.[cid];
            return (
              <Line
                key={cid}
                emoji={c?.avatarEmoji || '🧒'}
                name={c?.name.split(' ')[0] || 'Kid'}
                text={goal}
                extra={
                  <span className={`ml-1.5 text-[10.5px] font-extrabold px-2 py-0.5 rounded-full align-middle ${
                    done ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>{done ? '✓ done' : '↻ carried'}</span>
                }
              />
            );
          })}
        </Section>
      )}

      {/* ⭐ Points & Rewards */}
      {meeting.pointsSummary && meeting.pointsSummary.kids.length > 0 && (
        <Section icon="⭐" title="Points & Rewards — that week">
          {meeting.pointsSummary.kids.map((k) => {
            const c = kidName(k.childId);
            const bits = [
              `+${k.hp} HP`,
              k.excellentDays > 0 ? `${k.excellentDays} Excellent day${k.excellentDays === 1 ? '' : 's'}` : null,
              k.stars > 0 ? `⭐ Star ×${k.stars}` : null,
              k.belt ? '🥋 Belt champion' : null,
            ].filter(Boolean).join(' · ');
            return <Line key={k.childId} emoji={c?.avatarEmoji || '🧒'} name={k.name.split(' ')[0]} text={bits} />;
          })}
          {(meeting.pointsSummary.redeemed || []).map((r, i) => (
            <Line key={`r${i}`} emoji="🎁" name="Redeemed" text={`${r.name} — ${r.reward} (${r.points} HP)`} />
          ))}
        </Section>
      )}

      {/* 🎵 Closing */}
      {(songUrl || meeting.reflection?.contents?.prayer || meeting.reflection?.contents?.story) && (
        <Section icon="🎵" title="Closing">
          {songUrl.startsWith('http') && (
            <a href={songUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-3 mt-1 group">
              <span
                className="shrink-0 relative w-[72px] aspect-video rounded-lg overflow-hidden bg-cover bg-center"
                style={thumb ? { backgroundImage: `url(${thumb})` } : { background: 'linear-gradient(150deg,#3a2710,#caa12f)' }}
              >
                {!thumb && <span className="absolute inset-0 grid place-items-center text-lg">🎬</span>}
              </span>
              <span>
                <span className="block text-[13px] font-extrabold text-kaya-chocolate group-hover:underline">
                  {song?.title?.trim() || 'The closing song'}
                </span>
                {song && song.ratingCount > 0 && (
                  <span className="block text-[11.5px] text-kaya-gold-dark font-bold">
                    {'★'.repeat(Math.round(song.avgRating))} {song.avgRating.toFixed(1)} · {song.ratingCount} rating{song.ratingCount === 1 ? '' : 's'}
                  </span>
                )}
              </span>
            </a>
          )}
          {(meeting.reflection?.contents?.prayer || '').trim() && (
            <Line emoji="🙏" name="Family prayer" text={meeting.prayerLedBy ? `led by ${meeting.prayerLedBy}` : 'said together'} />
          )}
          {(meeting.reflection?.contents?.story || '').trim() && (
            <Line emoji="📖" name="Story" text={(meeting.reflection!.contents!.story as string).slice(0, 140)} />
          )}
        </Section>
      )}

      {/* 🎁 Moments */}
      {moments.length > 0 && (
        <Section icon="🎁" title="Moments">
          <div className="flex flex-wrap gap-1.5 mt-1">
            {moments.map((m, i) => (
              <span key={i} className="text-[11px] font-extrabold px-2.5 py-1 rounded-full bg-kaya-gold/15 border border-kaya-gold/40 text-kaya-chocolate">{m}</span>
            ))}
          </div>
        </Section>
      )}

      {/* 💛 Kaya Founding sign-off */}
      <div className="mt-6 pt-5 text-center border-t-2 border-kaya-warm-dark">
        <div className="text-lg">💛</div>
        <p className="font-display font-extrabold text-[14px] text-kaya-chocolate mt-1">Responsible kids. Responsible parents.</p>
        <p className="text-[12px] text-kaya-sand italic">Built on love, for families everywhere.</p>
        <p className="text-[9.5px] text-kaya-sand mt-2 uppercase tracking-[0.14em] font-bold">— Kaya</p>
      </div>
    </div>
  );
}
