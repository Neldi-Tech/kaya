// 👑 Leader of the Week — client callers for the /api/leader gateway
// (LW PR-L1). Diary idiom: Bearer ID token, JSON in/out.

import { auth } from './firebase';
import type { LeaderTerm, LeaderNote, LeaderNoteKind, LeaderTraits } from './leaderWeek.shared';

export type { LeaderTerm, LeaderNote, LeaderNoteKind, LeaderTraits };

async function idToken(): Promise<string> {
  const u = auth.currentUser;
  if (!u) throw new Error('Not signed in.');
  return u.getIdToken();
}

export async function leaderApi<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const token = await idToken();
  const res = await fetch('/api/leader', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || 'Request failed.') as Error & { code?: string; data?: unknown };
    err.code = (data as { error?: string }).error;
    err.data = data;
    throw err;
  }
  return data as T;
}

export interface NotebookBundle {
  ok: true;
  term: LeaderTerm | null;
  notes: LeaderNote[];
  mission: { id: string; label: string; done: boolean; progress: number; target: number } | null;
  whisper: string | null;
  prevAdvice: { name: string; emoji: string; advice: string } | null;
  notebookAllowed: boolean;
  caps: {
    dailyCap: number; usedToday: number; selfAllowed: boolean; selfUsedToday: number;
    shoutoutPoints: number[]; headsupPoints: number[];
  } | null;
  targets: Array<{ id: string; name: string; emoji: string; self: boolean }>;
  categories: ReadonlyArray<{ id: string; icon: string; label: string }>;
  unseen: number;
}

export interface LeaderLifetime {
  childId: string; name: string; emoji: string;
  selected: number; meetingsLed: number; notesApproved: number;
  avg: LeaderTraits | null; style: string; honest: number; missionsDone: number; lastAt: number;
}

export const loadNotebook = (familyId: string) => leaderApi<NotebookBundle>('notebook', { familyId });
export const createLeaderNote = (familyId: string, p: { targetChildId: string; kind: LeaderNoteKind; proposedPoints: number; category: string; reason: string; photoPath?: string }) =>
  leaderApi<{ ok: true; id: string }>('note-create', { familyId, ...p });
export const listLeaderNotes = (familyId: string, p: { status?: string; termId?: string } = {}) =>
  leaderApi<{ ok: true; notes: LeaderNote[] }>('note-list', { familyId, ...p });
export const claimLeaderNote = (familyId: string, noteId: string) => leaderApi<{ ok: true }>('note-claim', { familyId, noteId });
export const releaseLeaderNote = (familyId: string, noteId: string) => leaderApi<{ ok: true }>('note-release', { familyId, noteId });
export const finalizeLeaderNote = (familyId: string, p: { noteId: string; decision: 'approved' | 'adjusted' | 'declined'; finalPoints?: number; parentNote?: string; awardId?: string }) =>
  leaderApi<{ ok: true }>('note-finalize', { familyId, ...p });
export const markLeaderNotesSeen = (familyId: string, noteIds: string[]) => leaderApi<{ ok: true }>('note-seen', { familyId, noteIds });
export const listLeaderTerms = (familyId: string, childId?: string) =>
  leaderApi<{ ok: true; terms: LeaderTerm[]; lifetime: LeaderLifetime[] }>('term-list', { familyId, ...(childId ? { childId } : {}) });
export const appointLeader = (familyId: string, childId: string) =>
  leaderApi<{ ok: true; opened?: LeaderTerm; closed?: LeaderTerm | null }>('appoint', { familyId, childId });
export const endLeaderTerm = (familyId: string) => leaderApi<{ ok: true; closed: LeaderTerm | null }>('end-term', { familyId });
export const leaderHandover = (familyId: string, facts: { ledChildId?: string | null; openingWordDone?: boolean; themeSet?: boolean; rolesDealt?: boolean }) =>
  leaderApi<{ ok: true; opened?: LeaderTerm | null; closed?: LeaderTerm | null; appointPending?: boolean }>('handover', { familyId, facts });
export const setLeaderAdvice = (familyId: string, termId: string, p: { advice?: string; report?: string }) =>
  leaderApi<{ ok: true }>('advice-set', { familyId, termId, ...p });
export const markTermCelebrated = (familyId: string, termId: string) => leaderApi<{ ok: true }>('term-celebrated', { familyId, termId });

/** Friendly copy for gateway error codes. */
export function leaderErrorText(code?: string): string {
  switch (code) {
    case 'daily-cap': return 'You\'ve used all your notes for today — tomorrow is a new day 👀';
    case 'self-cap': return 'One shout-out about yourself per day — leaders get noticed by others 🙂';
    case 'self-notes-off': return 'Notes about yourself are switched off in your family.';
    case 'notebook-age': return 'The Notebook opens when you\'re a little older — you still wear the crown 👑';
    case 'no-leader': return 'Only the Leader of the Week can take notes.';
    case 'points-out-of-bounds': return 'Pick one of the point options shown.';
    case 'not-pending': return 'Another parent is already deciding this note.';
    case 'already-resolved': return 'This note was already decided.';
    case 'note-required': return 'Add a short note for the kids when you decline.';
    default: return 'Something went wrong — please try again.';
  }
}

/** Template draft of the Leader's Report (idea B) — no AI needed. */
export function draftLeaderReport(term: LeaderTerm, notes: LeaderNote[], names: Record<string, string>): string {
  const mine = notes.filter((n) => n.termId === term.id && n.status !== 'declined' && n.status !== 'expired');
  const byKid: Record<string, { s: number; h: number }> = {};
  for (const n of mine) {
    if (n.targetChildId === term.childId) continue;
    const k = byKid[n.targetChildId] || (byKid[n.targetChildId] = { s: 0, h: 0 });
    if (n.kind === 'shoutout') k.s += 1; else k.h += 1;
  }
  const noticed = Object.entries(byKid).map(([id, v]) => `${names[id] || 'someone'} ${v.s ? `doing great ${v.s}×` : ''}${v.s && v.h ? ' and ' : ''}${v.h ? `needing a hand ${v.h}×` : ''}`.trim());
  const selfH = mine.find((n) => n.targetChildId === term.childId && n.kind === 'headsup');
  const line1 = noticed.length ? `This week I noticed ${noticed.join(', ')}.` : 'This week I kept my eyes open for good things at home.';
  const line2 = selfH ? `One thing I can do better: ${selfH.reason}.` : 'One thing I can do better: notice something every single day.';
  return `${line1} ${line2}`;
}
