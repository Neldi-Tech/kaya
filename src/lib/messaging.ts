// Kaya · In-app messaging (family group + direct threads).
//
// Identity: everything keys by the auth `uid`. Messageable members are the
// family's user accounts (parents, helpers, login-enabled kids) — see
// getFamilyMembers in firestore.ts. A kid without a login isn't messageable
// (they can't read messages either), which is the correct boundary.
//
// Threads:
//   families/{f}/threads/{threadId}
//     - group  : one per family, id = 'group', memberUids = all members
//     - direct : 1:1, id = `dm_{sortedUidA}_{sortedUidB}`
//   families/{f}/threads/{threadId}/messages/{messageId}
//
// Reads are array-contains-only (no composite index) — the thread list sorts
// client-side by lastAt. Parent oversight (reading a DM they're not in) is a
// rules-level read grant, not part of the list query.

import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, deleteField,
  Timestamp, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import { getFamilyMembers, type Role, type Child } from './firestore';

/** Per-user messaging privacy choices (on UserProfile.messagingPrivacy).
 *  Undefined fields default to true (share). */
export interface MessagingPrivacy {
  showPresence?: boolean;   // share online + last-seen
  showTyping?: boolean;     // share "typing…"
  showReceipts?: boolean;   // share read receipts ("Seen")
}
/** "Online" if active within this window. */
export const ONLINE_WINDOW_MS = 50_000;
/** "Typing" if the marker is newer than this. */
const TYPING_WINDOW_MS = 6_000;

export type ThreadKind = 'group' | 'direct';
export type AttachmentKind = 'photo' | 'video' | 'voice' | 'document';

export interface Attachment {
  kind: AttachmentKind;
  url: string;
  name?: string;         // original filename (documents)
  mime?: string;
  sizeBytes?: number;
  durationSec?: number;  // voice / video
}

export interface ThreadMember {
  uid: string;
  name: string;
  role: Role;
  avatar?: string;       // emoji or photo URL
}

export interface MessageThread {
  id: string;
  kind: ThreadKind;
  title?: string;                       // group only (custom name; empty = use default)
  memberUids: string[];
  members?: ThreadMember[];             // denormalised for the list/header
  /** Marks the family-wide group (id === GROUP_THREAD_ID). Lets the UI show
   *  the "[Surname] Family" / "Family Chat" default when `title` is empty,
   *  without depending on the magic doc id. Set by ensureGroupThread. */
  isFamilyChat?: boolean;
  /** Custom groups (created via /messages/new) carry the creator's uid so
   *  the kid who started one can rename their own thread. Absent on the
   *  family chat + direct threads. */
  createdByUid?: string;
  createdByRole?: Role;
  lastText?: string;
  lastKind?: 'text' | AttachmentKind | 'event';
  lastSenderUid?: string;
  lastAt?: Timestamp;
  reads?: Record<string, Timestamp>;    // uid → last-read time (PRIVATE; drives unread)
  seen?: Record<string, Timestamp>;     // uid → last-read time SHARED for receipts (gated by showReceipts)
  typing?: Record<string, Timestamp>;   // uid → last typing heartbeat
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Message {
  id: string;
  senderUid: string;
  senderName: string;
  senderRole: Role;
  senderAvatar?: string;
  text?: string;
  attachments?: Attachment[];
  createdAt?: Timestamp;
}

export interface MessageInput {
  text?: string;
  attachments?: Attachment[];
}

// ── Path helpers ──────────────────────────────────────────────────
const threadsCol = (familyId: string) => collection(db, 'families', familyId, 'threads');
const threadDoc = (familyId: string, threadId: string) => doc(db, 'families', familyId, 'threads', threadId);
const messagesCol = (familyId: string, threadId: string) =>
  collection(db, 'families', familyId, 'threads', threadId, 'messages');

export const GROUP_THREAD_ID = 'group';

/** Deterministic id for a 1:1 thread — order-independent. */
export function directThreadId(a: string, b: string): string {
  return `dm_${[a, b].sort().join('_')}`;
}

const roleEmoji = (role: Role): string =>
  role === 'parent' ? '🧑‍🍼' : role === 'helper' ? '🤝' : '🧒';

const avatarFor = (p: { avatarPhoto?: string; photoURL?: string; role: Role }): string =>
  p.avatarPhoto || p.photoURL || roleEmoji(p.role);

// ── Members ───────────────────────────────────────────────────────
/** Family members who can message — every user account in the family. Kid
 *  avatars are enriched from their Child record when available. */
export async function messageableMembers(familyId: string, children: Child[] = []): Promise<ThreadMember[]> {
  if (isGuestActive()) return [];
  const users = await getFamilyMembers(familyId);
  const kidAvatar = new Map(children.map((c) => [c.id, c.avatarPhoto || c.avatarEmoji]));
  return users.map((u) => ({
    uid: u.uid,
    name: u.displayName || 'Member',
    role: u.role,
    avatar: (u.role === 'kid' && u.childId && kidAvatar.get(u.childId)) || avatarFor(u),
  }));
}

/** The current user as a ThreadMember (for sending + thread membership). */
export function selfMember(
  profile: { uid: string; displayName?: string; role: Role; childId?: string; avatarPhoto?: string; photoURL?: string },
  children: Child[] = [],
): ThreadMember {
  const kid = profile.role === 'kid' && profile.childId ? children.find((c) => c.id === profile.childId) : undefined;
  return {
    uid: profile.uid,
    name: profile.displayName || 'Me',
    role: profile.role,
    avatar: (kid?.avatarPhoto || kid?.avatarEmoji) || avatarFor(profile),
  };
}

// ── Threads ───────────────────────────────────────────────────────
/** Create/refresh the family group thread (all members). Idempotent.
 *  After 2026-05-27: only sets `title` on first creation (so a custom rename
 *  via setThreadTitle isn't overwritten by the periodic membership refresh).
 *  Always stamps `isFamilyChat: true` so the UI can show the auto default. */
export async function ensureGroupThread(familyId: string, members: ThreadMember[]): Promise<string> {
  if (isGuestActive() || members.length === 0) return GROUP_THREAD_ID;
  const ref = threadDoc(familyId, GROUP_THREAD_ID);
  const snap = await getDoc(ref);
  const exists = snap.exists();
  const patch: Record<string, unknown> = {
    kind: 'group',
    isFamilyChat: true,
    memberUids: members.map((m) => m.uid),
    members,
    updatedAt: exists ? (snap.data().updatedAt ?? serverTimestamp()) : serverTimestamp(),
  };
  // First creation only — seed an empty title so the UI can show the default
  // "[Surname] Family" / "Family Chat" name (controlled by familyChatDisplayName).
  if (!exists) {
    patch.createdAt = serverTimestamp();
    patch.title = '';
  }
  await setDoc(ref, patch, { merge: true });
  return GROUP_THREAD_ID;
}

/** Rename a group thread. Used by both the family-chat ⚙ sheet and the
 *  group-edit sheet for custom groups. Trims + empties allowed (empty title
 *  on the family chat reverts to the auto default — by design). */
export async function setThreadTitle(familyId: string, threadId: string, title: string): Promise<void> {
  if (isGuestActive()) return;
  await setDoc(threadDoc(familyId, threadId), {
    title: title.trim().slice(0, 60),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/** Create a fresh custom group chat. Used by:
 *   • parents directly from /messages/new
 *   • the approval resolver when a kid's create_group_chat request is approved.
 *  Title is required (max 60 chars, trimmed); the creator is added to
 *  memberUids defensively in case the caller forgot. */
export async function createGroupThread(
  familyId: string,
  creator: ThreadMember,
  title: string,
  members: ThreadMember[],
): Promise<string> {
  if (isGuestActive()) return '';
  const clean = title.trim().slice(0, 60);
  if (!clean) throw new Error('Group name is required.');
  // Defensive: ensure the creator is in the member set. Dedupe by uid.
  const merged: ThreadMember[] = [];
  const seen = new Set<string>();
  for (const m of [creator, ...members]) {
    if (!m?.uid || seen.has(m.uid)) continue;
    seen.add(m.uid);
    merged.push(m);
  }
  const ref = doc(threadsCol(familyId));
  await setDoc(ref, {
    kind: 'group',
    title: clean,
    memberUids: merged.map((m) => m.uid),
    members: merged,
    createdByUid: creator.uid,
    createdByRole: creator.role,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Default display name for the family chat when its title is empty.
 *  Picks the family surname from `familyName` (e.g. "The Timotheo Family"
 *  → "Timotheo Family") if available, else falls back to "Family Chat". */
export function familyChatDisplayName(thread: Pick<MessageThread, 'title' | 'isFamilyChat'> | null, familyName?: string | null): string {
  if (!thread) return 'Messages';
  if (thread.title && thread.title.trim()) return thread.title.trim();
  if (!thread.isFamilyChat) return 'Group';
  // Strip a leading "The " (case-insensitive) + a trailing "Family" (so "The
  // Timotheo Family" → "Timotheo") and re-suffix " Family" for a consistent
  // shape. Falls back to "Family Chat" if nothing usable.
  if (familyName && familyName.trim()) {
    const surname = familyName.trim().replace(/^the\s+/i, '').replace(/\s+family$/i, '').trim();
    if (surname) return `${surname} Family`;
  }
  return 'Family Chat';
}

/** Create/refresh a 1:1 thread between two members. Returns its id. */
export async function ensureDirectThread(familyId: string, me: ThreadMember, other: ThreadMember): Promise<string> {
  if (isGuestActive()) return directThreadId(me.uid, other.uid);
  const id = directThreadId(me.uid, other.uid);
  const ref = threadDoc(familyId, id);
  const snap = await getDoc(ref);
  await setDoc(ref, {
    kind: 'direct',
    memberUids: [me.uid, other.uid],
    members: [me, other],
    ...(snap.exists() ? {} : { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
  }, { merge: true });
  return id;
}

/** One thread (header + membership). */
export async function getThread(familyId: string, threadId: string): Promise<MessageThread | null> {
  if (isGuestActive()) return null;
  const snap = await getDoc(threadDoc(familyId, threadId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as MessageThread) : null;
}

/** Live thread doc — header + membership + `reads` (drives read receipts). */
export function subscribeThread(
  familyId: string,
  threadId: string,
  cb: (thread: MessageThread | null) => void,
): () => void {
  if (isGuestActive()) { cb(null); return () => {}; }
  return onSnapshot(threadDoc(familyId, threadId), (s) =>
    cb(s.exists() ? ({ id: s.id, ...s.data() } as MessageThread) : null));
}

/** Threads the user belongs to, newest-activity first (sorted client-side so
 *  no composite index is needed for the array-contains filter). */
export function subscribeThreads(
  familyId: string,
  uid: string,
  cb: (threads: MessageThread[]) => void,
): () => void {
  if (isGuestActive() || !uid) { cb([]); return () => {}; }
  const q = query(threadsCol(familyId), where('memberUids', 'array-contains', uid));
  return onSnapshot(q, (s) => {
    const rows = s.docs.map((d) => ({ id: d.id, ...d.data() } as MessageThread));
    rows.sort((a, b) => ms(b.lastAt ?? b.updatedAt) - ms(a.lastAt ?? a.updatedAt));
    cb(rows);
  });
}

/** Messages in a thread, oldest→newest (single-field order — no index). */
export function subscribeMessages(
  familyId: string,
  threadId: string,
  cb: (messages: Message[]) => void,
  max = 200,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const q = query(messagesCol(familyId, threadId), orderBy('createdAt', 'asc'), limit(max));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as Message))));
}

/** Send a message + bump the thread's last-activity + mark it read for the sender. */
export async function sendMessage(
  familyId: string,
  threadId: string,
  input: MessageInput,
  sender: ThreadMember,
): Promise<void> {
  if (isGuestActive()) return;
  const text = input.text?.trim() || '';
  const attachments = (input.attachments || []).filter((a) => a.url);
  if (!text && attachments.length === 0) return;

  // Note: we deliberately don't denormalise senderAvatar onto each message
  // (avatars can be data URLs — that would bloat every message doc). The
  // bubble UI shows the sender's name; the thread header carries the avatar.
  const msg: Record<string, unknown> = {
    senderUid: sender.uid,
    senderName: sender.name,
    senderRole: sender.role,
    createdAt: serverTimestamp(),
  };
  if (text) msg.text = text;
  if (attachments.length) msg.attachments = attachments;
  await addDoc(messagesCol(familyId, threadId), msg);

  const lastKind: MessageThread['lastKind'] = text ? 'text' : (attachments[0]?.kind ?? 'text');
  await updateDoc(threadDoc(familyId, threadId), {
    lastText: text || attachmentLabel(attachments[0]?.kind),
    lastKind,
    lastSenderUid: sender.uid,
    lastAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    [`reads.${sender.uid}`]: serverTimestamp(),
  });
}

/** Mark a thread read for a user (called when they open it). `reads` is always
 *  written (PRIVATE — drives the unread badge); `seen` is written only when the
 *  user shares read receipts, and removed when they opt out — so the "Seen"
 *  others see respects the choice while the unread badge keeps working. */
export async function markThreadRead(familyId: string, threadId: string, uid: string, shareReceipts = true): Promise<void> {
  if (isGuestActive() || !uid) return;
  const patch: Record<string, unknown> = { [`reads.${uid}`]: serverTimestamp() };
  patch[`seen.${uid}`] = shareReceipts ? serverTimestamp() : deleteField();
  try { await updateDoc(threadDoc(familyId, threadId), patch); } catch { /* thread may not exist yet — harmless */ }
}

// ── Typing + presence ─────────────────────────────────────────────
/** Set/clear my typing marker on a thread (gated by showTyping at the caller). */
export async function setTyping(familyId: string, threadId: string, uid: string, isTyping: boolean): Promise<void> {
  if (isGuestActive() || !uid) return;
  try {
    await updateDoc(threadDoc(familyId, threadId), { [`typing.${uid}`]: isTyping ? serverTimestamp() : deleteField() });
  } catch { /* harmless */ }
}

/** Heartbeat my presence (write my own user doc's lastActiveAt). */
export async function heartbeatPresence(uid: string): Promise<void> {
  if (isGuestActive() || !uid) return;
  try { await updateDoc(doc(db, 'users', uid), { lastActiveAt: serverTimestamp() }); } catch { /* harmless */ }
}

/** Live presence for one user (their lastActiveAt + whether they share it). */
export function subscribePresence(uid: string, cb: (p: { lastActiveAt?: Timestamp; showPresence: boolean }) => void): () => void {
  if (isGuestActive() || !uid) { cb({ showPresence: false }); return () => {}; }
  return onSnapshot(doc(db, 'users', uid), (s) => {
    const d = s.data() as { lastActiveAt?: Timestamp; messagingPrivacy?: MessagingPrivacy } | undefined;
    cb({ lastActiveAt: d?.lastActiveAt, showPresence: d?.messagingPrivacy?.showPresence !== false });
  });
}

/** Persist a user's messaging privacy choices. */
export async function setMessagingPrivacy(uid: string, prefs: MessagingPrivacy): Promise<void> {
  if (isGuestActive() || !uid) return;
  await updateDoc(doc(db, 'users', uid), { messagingPrivacy: prefs });
}

// ── Pure helpers ──────────────────────────────────────────────────
const ms = (t?: Timestamp): number => (t as Timestamp | undefined)?.toMillis?.() ?? 0;

/** A thread is unread for me if its last message is newer than my last read
 *  and I'm not the one who sent it. */
export function isUnread(thread: MessageThread, uid: string): boolean {
  if (!thread.lastAt || thread.lastSenderUid === uid) return false;
  return ms(thread.lastAt) > ms(thread.reads?.[uid]);
}

/** The other member's display info for a direct thread (from my POV). */
export function otherMember(thread: MessageThread, uid: string): ThreadMember | undefined {
  return thread.members?.find((m) => m.uid !== uid);
}

/** Read-receipt: who (other than the sender) has shared that they read up to
 *  `at`. Uses the SHARED `seen` map (only set when a member shares receipts),
 *  so opting out hides you from receipts. Returns their uids. */
export function seenByUids(thread: MessageThread, at: Timestamp | undefined, senderUid: string): string[] {
  if (!at || !thread.seen) return [];
  const cutoff = ms(at);
  return (thread.memberUids || []).filter((u) => u !== senderUid && ms(thread.seen?.[u]) >= cutoff);
}

/** Shared read time for a member (for "Seen 6:14 PM" on direct threads). */
export function readAtFor(thread: MessageThread, uid: string): Timestamp | undefined {
  return thread.seen?.[uid];
}

/** Names of OTHER members currently typing (marker within the typing window). */
export function typingNames(thread: MessageThread, uid: string, now: number = Date.now()): string[] {
  if (!thread.typing) return [];
  const byUid = new Map((thread.members || []).map((m) => [m.uid, m.name]));
  return Object.entries(thread.typing)
    .filter(([u, t]) => u !== uid && now - ms(t) < TYPING_WINDOW_MS)
    .map(([u]) => byUid.get(u) || 'Someone');
}

/** "online" check from a lastActiveAt timestamp. */
export function isOnline(lastActiveAt?: Timestamp, now: number = Date.now()): boolean {
  return !!lastActiveAt && now - ms(lastActiveAt) < ONLINE_WINDOW_MS;
}

/** "Active now" / "last seen 5m ago" / "last seen 24-May" — '' if unknown. */
export function lastSeenText(lastActiveAt?: Timestamp, now: number = Date.now()): string {
  const t = ms(lastActiveAt);
  if (!t) return '';
  if (now - t < ONLINE_WINDOW_MS) return 'Active now';
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 60) return `last seen ${mins || 1}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `last seen ${hrs}h ago`;
  const d = new Date(t);
  return `last seen ${d.getDate()}-${d.toLocaleString('en', { month: 'short' })}`;
}

/** Title + avatar for a thread row, from my POV. */
export function threadHeader(thread: MessageThread, uid: string, familyName?: string | null): { title: string; avatar: string } {
  if (thread.kind === 'group') {
    return {
      title: familyChatDisplayName(thread, familyName) || 'Group',
      avatar: thread.isFamilyChat ? '🐝' : '👥',
    };
  }
  const other = otherMember(thread, uid);
  return { title: other?.name || 'Direct message', avatar: other?.avatar || '💬' };
}

function attachmentLabel(kind?: AttachmentKind): string {
  switch (kind) {
    case 'photo': return '📷 Photo';
    case 'video': return '🎬 Video';
    case 'voice': return '🎤 Voice note';
    case 'document': return '📄 Document';
    default: return '';
  }
}

/** Short preview of a message for notifications / the thread list. */
export function messagePreview(text?: string, attachments?: Attachment[]): string {
  const t = (text || '').trim();
  if (t) return t;
  return attachmentLabel(attachments?.[0]?.kind) || 'New message';
}
