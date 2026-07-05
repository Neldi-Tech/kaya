// Meeting Recap Book — client-side sender (Sunday-Meeting v2 · b6).
//
// Composes a payload from the meeting that was just submitted + the
// family's pre-meeting submissions, then POSTs to /api/notify with
// type='meeting-recap'. The server route renders the HTML email and
// sends via Resend. Fire-and-forget — recap is a perk, not a barrier
// to finishing the meeting.
//
// MVP scope (this PR):
//   ✅ attendance, gratitudes, appreciations, goals, closing
//   ✅ leader pill in the cover
//   ✅ family-contact emails via Resend (capped at 10 by /api/notify)
//   ⬜ Belt / Star / HP summary (needs ratings-window query — follow-up)
//   ⬜ Week-in-Moments thumbnails (image links from Storage — follow-up)
//   ⬜ PDF attachment (toggle in the design but parked)

import type { Family, Child, Meeting, ReflectionMode, UserProfile } from './firestore';
import { getFamilyMembers } from './firestore';
import { toDisplayDate } from './dates';
import type { MeetingSubmission } from './meetingSubmissions';

type MeetingPayload = Omit<Meeting, 'id' | 'createdAt'>;

interface Args {
  family: Family | null | undefined;
  payload: MeetingPayload;
  submissions: MeetingSubmission[];
  householdParents: Array<{ uid: string; name: string; avatarEmoji?: string }>;
  children: Child[];
  songLinkApprovedBy: string | null;
}

interface RecapEntry { name: string; emoji: string; lines: string[] }

function entriesFromSubmissions(
  subs: MeetingSubmission[],
  key: 'gratitudes' | 'appreciations' | 'goals',
): RecapEntry[] {
  return subs
    .map((s) => ({ name: s.name, emoji: s.emoji || (s.role === 'kid' ? '🧒' : '👤'), lines: s[key] || [] }))
    .filter((e) => e.lines.length > 0);
}

function entriesFromPerKidMap(
  m: Record<string, string> | undefined,
  children: Child[],
): RecapEntry[] {
  if (!m) return [];
  const out: RecapEntry[] = [];
  for (const c of children) {
    const line = (m[c.id] || '').trim();
    if (!line) continue;
    out.push({ name: c.name, emoji: c.avatarEmoji || '🧒', lines: [line] });
  }
  return out;
}

/** Merge submitted + live entries by (name) — submission lines come
 *  first, live additions append. Keeps the order predictable. */
function mergeEntries(submitted: RecapEntry[], live: RecapEntry[]): RecapEntry[] {
  const byName = new Map<string, RecapEntry>();
  for (const e of submitted) byName.set(e.name, { ...e, lines: [...e.lines] });
  for (const e of live) {
    const existing = byName.get(e.name);
    if (existing) {
      existing.lines.push(...e.lines.filter((l) => !existing.lines.includes(l)));
    } else {
      byName.set(e.name, { ...e, lines: [...e.lines] });
    }
  }
  return Array.from(byName.values());
}

/** WHO gets the auto-sent notes (Meeting Notes, 2026-06-21). Back-compat:
 *  no recapBookRecipients → derive from the old on/off toggle. */
export function recapRecipientsMode(family: Family | null | undefined): 'off' | 'parents' | 'all' {
  const s = family?.meetingSetup;
  if (s?.recapBookRecipients) return s.recapBookRecipients;
  return (s?.recapBookEmailEnabled ?? true) ? 'parents' : 'off';
}

export async function sendMeetingRecapEmail({
  family, payload, submissions, householdParents, children, songLinkApprovedBy,
}: Args): Promise<void> {
  if (!family?.id) return;

  const mode = recapRecipientsMode(family);
  if (mode === 'off') return;

  // Recipients — 'parents' (default, today's behaviour) or 'all': every
  // ATTENDEE with an email on file (kids included) plus the parents.
  const members = await getFamilyMembers(family.id).catch(() => [] as UserProfile[]);
  const parentEmails = members
    .filter((m) => m.role === 'parent')
    .map((m) => m.email)
    .filter((e): e is string => !!e);

  const kidEmails = mode === 'all'
    ? children
        .filter((c) => (payload.attendees || []).includes(c.id))
        .map((c) => ((c as { email?: string; emailLower?: string }).email || (c as { emailLower?: string }).emailLower || '').trim())
        .filter(Boolean)
    : [];

  const to = Array.from(new Set([...parentEmails, ...kidEmails]));
  if (to.length === 0) return;

  // Compose RecapEntry arrays — submissions first (read in advance),
  // then merge any per-kid additions the leader typed live tonight.
  const gratitudes = mergeEntries(
    entriesFromSubmissions(submissions, 'gratitudes'),
    entriesFromPerKidMap(payload.gratitude, children),
  );
  const appreciations = mergeEntries(
    entriesFromSubmissions(submissions, 'appreciations'),
    entriesFromPerKidMap(payload.appreciations, children),
  );
  const goals = mergeEntries(
    entriesFromSubmissions(submissions, 'goals'),
    entriesFromPerKidMap(payload.goals, children),
  );

  // Attendance — kids first (matching the meeting flow), then parents,
  // then guests. Names + emoji snapshot so the email reads cleanly.
  const attendees: Array<{ name: string; emoji: string; isGuest?: boolean }> = [];
  for (const c of children) {
    if (payload.attendees.includes(c.id)) {
      attendees.push({ name: c.name, emoji: c.avatarEmoji || '🧒' });
    }
  }
  for (const p of householdParents) {
    if (payload.parentAttendees?.includes(p.uid)) {
      attendees.push({ name: p.name, emoji: p.avatarEmoji || '👤' });
    }
  }
  for (const g of payload.guestAttendees || []) {
    attendees.push({ name: g.name, emoji: '🫂', isGuest: true });
  }

  // Closing snapshot — pulled straight from reflection.contents, capped
  // at 140 chars by the server template so the email stays a recap, not
  // a transcript.
  const contents = payload.reflection?.contents || {};
  const closing: {
    prayer?: string;
    story?: string;
    songUrl?: string;
    songApprovedBy?: string;
  } = {};
  const prayer = (contents.prayer || '').trim();
  const story = (contents.story || '').trim();
  const songsRaw = (contents.songs || '').trim();
  if (prayer) closing.prayer = prayer;
  if (story) closing.story = story;
  if (songsRaw.startsWith('http')) {
    closing.songUrl = songsRaw;
    if (songLinkApprovedBy) closing.songApprovedBy = songLinkApprovedBy;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
  const includeSong = family.meetingSetup?.recapBookIncludeSong ?? true;

  await fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'meeting-recap',
      to,
      data: {
        recap: {
          familyName: family.name || 'Your family',
          dateLabel: toDisplayDate(payload.date) || payload.date,
          // Meeting Notes (2026-06-21): tonight's leader is snapshotted on
          // the payload (ledByName) — family.nextMeetingLeader has already
          // moved on to NEXT week's pick by finish time.
          leaderName: payload.ledByName || family.nextMeetingLeader?.name,
          leaderEmoji: payload.ledByName ? undefined : family.nextMeetingLeader?.emoji,
          attendees,
          gratitudes,
          appreciations,
          goals,
          ...pointsFieldsFrom(payload, children),
          ...(payload.prayerLedBy ? { prayerLedBy: payload.prayerLedBy } : {}),
          ...(payload.nextLeaderName ? { nextLeaderName: payload.nextLeaderName } : {}),
          closing,
          openUrl: `${appUrl}/meetings`,
          includeSong,
        },
      },
    }),
  });
}

/** Map the meeting's pointsSummary snapshot (PR1) onto the email's
 *  belt/star/HP/redeemed fields. Shared by the finish-time recap and the
 *  any-past-meeting share sender. */
interface RecapPointsFields {
  beltChampion?: { name: string; emoji: string; perfectDays: number };
  starSummary?: string;
  hpThisWeek?: Array<{ name: string; emoji: string; pts: number }>;
  redeemedSummary?: string;
}

function pointsFieldsFrom(
  m: Pick<Meeting, 'pointsSummary'>,
  children: Child[],
): RecapPointsFields {
  const ps = m.pointsSummary;
  if (!ps || ps.kids.length === 0) return {};
  const emojiOf = (childId: string) => children.find((c) => c.id === childId)?.avatarEmoji || '🧒';
  const out: RecapPointsFields = {};
  const belt = ps.kids.find((k) => k.belt);
  if (belt && belt.excellentDays > 0) {
    out.beltChampion = { name: belt.name, emoji: emojiOf(belt.childId), perfectDays: belt.excellentDays };
  }
  const starKids = ps.kids.filter((k) => k.stars > 0);
  if (starKids.length > 0) out.starSummary = starKids.map((k) => `${k.name} ×${k.stars}`).join(' · ');
  out.hpThisWeek = ps.kids.map((k) => ({ name: k.name, emoji: emojiOf(k.childId), pts: k.hp }));
  if (ps.redeemed && ps.redeemed.length > 0) {
    out.redeemedSummary = ps.redeemed.map((r) => `${r.name} — ${r.reward} (${r.points} HP)`).join(' · ');
  }
  return out;
}

/**
 * Share the notes of ANY saved meeting to an explicit recipient list —
 * powers the 📤 Share sheet on the Meeting Notes page (Just me / All
 * participants / Choose members / Other emails). Composes from the saved
 * Meeting doc (per-kid maps) rather than live submissions. Throws on
 * failure so the sheet can surface the error.
 */
export async function sendMeetingNotesEmailTo(args: {
  family: Family;
  meeting: Meeting;
  children: Child[];
  parents: Array<{ uid: string; name: string; avatarEmoji?: string }>;
  to: string[];
}): Promise<void> {
  const { family, meeting, children, parents, to } = args;
  const recipients = Array.from(new Set(to.map((e) => e.trim()).filter(Boolean)));
  if (recipients.length === 0) throw new Error('No recipients');

  const attendees: Array<{ name: string; emoji: string; isGuest?: boolean }> = [];
  for (const c of children) {
    if ((meeting.attendees || []).includes(c.id)) attendees.push({ name: c.name, emoji: c.avatarEmoji || '🧒' });
  }
  for (const p of parents) {
    if ((meeting.parentAttendees || []).includes(p.uid)) attendees.push({ name: p.name, emoji: p.avatarEmoji || '👤' });
  }
  for (const g of meeting.guestAttendees || []) attendees.push({ name: g.name, emoji: '🫂', isGuest: true });

  const contents = meeting.reflection?.contents || {};
  const closing: { prayer?: string; story?: string; songUrl?: string } = {};
  if ((contents.prayer || '').trim()) closing.prayer = (contents.prayer as string).trim();
  if ((contents.story || '').trim()) closing.story = (contents.story as string).trim();
  if ((contents.songs || '').trim().startsWith('http')) closing.songUrl = (contents.songs as string).trim();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
  const res = await fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'meeting-recap',
      to: recipients,
      data: {
        recap: {
          familyName: family.name || 'Your family',
          dateLabel: toDisplayDate(meeting.date) || meeting.date,
          leaderName: meeting.ledByName,
          attendees,
          gratitudes: entriesFromPerKidMap(meeting.gratitude, children),
          appreciations: entriesFromPerKidMap(meeting.appreciations, children),
          goals: entriesFromPerKidMap(meeting.goals, children),
          ...pointsFieldsFrom(meeting, children),
          ...(meeting.prayerLedBy ? { prayerLedBy: meeting.prayerLedBy } : {}),
          ...(meeting.nextLeaderName ? { nextLeaderName: meeting.nextLeaderName } : {}),
          closing,
          openUrl: `${appUrl}/meetings/notes/${meeting.id}`,
          includeSong: family.meetingSetup?.recapBookIncludeSong ?? true,
        },
      },
    }),
  });
  if (!res.ok) throw new Error('Could not send — please try again.');
}

// Re-exported so callers don't need to know the module name.
export type { MeetingSubmission } from './meetingSubmissions';
