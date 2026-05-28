// Kaya Guide · conversation persistence (client).
//
// Saves each Guide conversation under the family so a parent can later review
// what their kids (and anyone else) asked the helper. One document per opened
// session, rewritten as the conversation grows — guidance chats are short, so
// storing the whole transcript per save is cheap and keeps reads to one doc.
//
// Path: families/{familyId}/guideChats/{conversationId}
// See firestore.rules for who can read/write these.

import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type GuideRole = 'parent' | 'helper' | 'kid' | 'guest';
export interface GuideTurn { role: 'user' | 'assistant'; content: string }

export interface SaveGuideChatInput {
  familyId: string;
  conversationId: string;
  uid: string;
  displayName: string;
  role: GuideRole;
  /** Friendly name of the screen the conversation started on. */
  module: string;
  messages: GuideTurn[];
  /** True only on the first save of a session, so createdAt is written once. */
  isFirst?: boolean;
}

/** A simple, collision-resistant id for one conversation session. */
export function newConversationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Persist (create or overwrite) a Guide conversation. Best-effort: failures
 * are swallowed so a logging hiccup never blocks the chat UI. Guests have no
 * real family doc, so we skip persistence for them.
 */
export async function saveGuideChat(input: SaveGuideChatInput): Promise<void> {
  const { familyId, conversationId, uid, displayName, role, module, messages, isFirst } = input;
  if (!familyId || !conversationId || role === 'guest') return;
  try {
    const ref = doc(db, 'families', familyId, 'guideChats', conversationId);
    await setDoc(
      ref,
      {
        uid,
        displayName: displayName || '',
        role,
        module: module || '',
        // Cap stored transcript length defensively.
        messages: messages.slice(-40),
        messageCount: messages.length,
        updatedAt: serverTimestamp(),
        // createdAt is written once, on the first save of the session.
        ...(isFirst ? { createdAt: serverTimestamp() } : {}),
      },
      { merge: true },
    );
  } catch {
    /* non-fatal — review logging is a nicety, not a blocker */
  }
}
