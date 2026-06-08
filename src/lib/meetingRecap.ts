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

export async function sendMeetingRecapEmail({
  family, payload, submissions, householdParents, children, songLinkApprovedBy,
}: Args): Promise<void> {
  if (!family?.id) return;

  // Recipient list = parents (UserProfile.email) + any Family contacts
  // configured with an email. For MVP we read the parent emails via
  // getFamilyMembers — Family contacts hook-up is queued for a
  // follow-up (the design surfaces it; the contacts module already
  // has the email field).
  const members = await getFamilyMembers(family.id).catch(() => [] as UserProfile[]);
  const parentEmails = members
    .filter((m) => m.role === 'parent')
    .map((m) => m.email)
    .filter((e): e is string => !!e);

  const to = Array.from(new Set(parentEmails));
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

  const leader = family.nextMeetingLeader;
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
          leaderName: leader?.name,
          leaderEmoji: leader?.emoji,
          attendees,
          gratitudes,
          appreciations,
          goals,
          // beltChampion / starSummary / hpThisWeek deferred — populate
          // in a follow-up that fetches the meeting-review window.
          closing,
          openUrl: `${appUrl}/meetings`,
          includeSong,
        },
      },
    }),
  });
}

// Re-exported so callers don't need to know the module name.
export type { MeetingSubmission } from './meetingSubmissions';
