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
  query, where, orderBy, limit, onSnapshot,
  Timestamp, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import { getFamilyMembers, type Role, type Child } from './firestore';

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
  title?: string;                       // group only
  memberUids: string[];
  members?: ThreadMember[];             // denormalised for the list/header
  lastText?: string;
  lastKind?: 'text' | AttachmentKind | 'event';
  lastSenderUid?: string;
  lastAt?: Timestamp;
  reads?: Record<string, Timestamp>;    // uid → last-read time
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
/** Create/refresh the family group thread (all members). Idempotent. */
export async function ensureGroupThread(familyId: string, members: ThreadMember[]): Promise<string> {
  if (isGuestActive() || members.length === 0) return GROUP_THREAD_ID;
  const ref = threadDoc(familyId, GROUP_THREAD_ID);
  const snap = await getDoc(ref);
  await setDoc(ref, {
    kind: 'group',
    title: 'Family Group',
    memberUids: members.map((m) => m.uid),
    members,
    ...(snap.exists() ? {} : { createdAt: serverTimestamp() }),
    updatedAt: snap.exists() ? (snap.data().updatedAt ?? serverTimestamp()) : serverTimestamp(),
  }, { merge: true });
  return GROUP_THREAD_ID;
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

/** Mark a thread read for a user (called when they open it). */
export async function markThreadRead(familyId: string, threadId: string, uid: string): Promise<void> {
  if (isGuestActive() || !uid) return;
  try {
    await updateDoc(threadDoc(familyId, threadId), { [`reads.${uid}`]: serverTimestamp() });
  } catch { /* thread may not exist yet — harmless */ }
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

/** Read-receipt: who (other than the sender) has read up to `at`. Uses the
 *  per-thread `reads` map (last-read time per uid) — so it's "read this message
 *  or later", the usual lastRead-based receipt. Returns their uids. */
export function seenByUids(thread: MessageThread, at: Timestamp | undefined, senderUid: string): string[] {
  if (!at || !thread.reads) return [];
  const cutoff = ms(at);
  return (thread.memberUids || []).filter((u) => u !== senderUid && ms(thread.reads?.[u]) >= cutoff);
}

/** Read time for a specific member (for "Seen 6:14 PM" on direct threads). */
export function readAtFor(thread: MessageThread, uid: string): Timestamp | undefined {
  return thread.reads?.[uid];
}

/** Title + avatar for a thread row, from my POV. */
export function threadHeader(thread: MessageThread, uid: string): { title: string; avatar: string } {
  if (thread.kind === 'group') return { title: thread.title || 'Family Group', avatar: '🐝' };
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
