// Kaya Games — multi-device room sessions (Firestore). A host creates a
// session with a 4-letter code; family members join by code; turn-based
// state syncs through the session doc via onSnapshot. Low write-frequency
// (turn-based games), so Firestore is a fine fit — no RTDB needed.
//
// Requires the `gameSessions` rule in firestore.rules to be DEPLOYED;
// until then create/join fail with permission-denied (handled in the UI).

import { db } from '@/lib/firebase';
import {
  collection, doc, addDoc, getDocs, query, where,
  onSnapshot, updateDoc, serverTimestamp, arrayUnion,
} from 'firebase/firestore';

// No I/O/L — avoids confusion with 1/0/L when read aloud or typed.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_TTL_MS = 10 * 60 * 1000;

export function genCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export interface SessionPlayer { uid: string; name: string }
export type SessionStatus = 'lobby' | 'playing' | 'done';

export interface GameSession {
  id: string;
  code: string;
  gameId: string;
  hostUid: string;
  status: SessionStatus;
  players: SessionPlayer[];
  state: Record<string, unknown>;
  winnerUid?: string;
  expiresAt?: number;
}

function colRef(familyId: string) {
  return collection(db, 'families', familyId, 'gameSessions');
}
function docRef(familyId: string, sessionId: string) {
  return doc(db, 'families', familyId, 'gameSessions', sessionId);
}

export async function createSession(
  familyId: string, hostUid: string, hostName: string, gameId: string,
  initialState: Record<string, unknown> = {},
): Promise<{ id: string; code: string }> {
  const code = genCode();
  const ref = await addDoc(colRef(familyId), {
    code, gameId, hostUid, status: 'lobby',
    players: [{ uid: hostUid, name: hostName }],
    state: initialState,
    createdAt: serverTimestamp(),
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return { id: ref.id, code };
}

/** Most-recent live (non-done, unexpired) session matching a code. */
export async function findSessionByCode(familyId: string, code: string): Promise<GameSession | null> {
  const snap = await getDocs(query(colRef(familyId), where('code', '==', code.trim().toUpperCase())));
  const now = Date.now();
  const live = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<GameSession, 'id'>) }))
    .filter((s) => s.status !== 'done' && (!s.expiresAt || s.expiresAt > now));
  return live[0] ?? null;
}

export async function joinSession(familyId: string, sessionId: string, uid: string, name: string): Promise<void> {
  await updateDoc(docRef(familyId, sessionId), { players: arrayUnion({ uid, name }) });
}

export function subscribeSession(
  familyId: string, sessionId: string, cb: (s: GameSession | null) => void,
): () => void {
  return onSnapshot(docRef(familyId, sessionId), (d) =>
    cb(d.exists() ? ({ id: d.id, ...(d.data() as Omit<GameSession, 'id'>) }) : null),
  );
}

export async function updateSession(
  familyId: string, sessionId: string, patch: Partial<Omit<GameSession, 'id'>>,
): Promise<void> {
  await updateDoc(docRef(familyId, sessionId), patch as Record<string, unknown>);
}

/** Dot-notation field write (e.g. `state.roundAnswers.<uid>`) so concurrent
 *  players update their own slice without clobbering the whole doc. */
export async function updateSessionFields(
  familyId: string, sessionId: string, fields: Record<string, unknown>,
): Promise<void> {
  await updateDoc(docRef(familyId, sessionId), fields);
}
