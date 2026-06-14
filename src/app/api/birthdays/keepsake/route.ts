// POST { familyId, byUid, personKey } — save the birthday as a keepsake.
//
// Creates ONE family Moment (a text post: the birthday + the wishes wall) and
// stamps keepsakeAt + keepsakePostId on family.birthdays[personKey]. Idempotent
// — a second tap returns the existing post. Admin SDK: the birthday person is
// often a KID who can't write posts/family doc directly, so this runs server
// side, family-membership gated (user OR children.uid). The post is authored as
// "Kaya 🎂" so it reads as an auto-curated family memory, kid-tagged so it lands
// on the birthday kid's profile strip, and feed-valid (pending:false + counters)
// so Memory Lane and the Moments feed both pick it up.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { ordinalAge, type BirthdayWishEntry } from '@/lib/birthdays';

export const runtime = 'nodejs';

const REACTION_EMOJIS = ['❤️', '👏', '😂', '🎉'];

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  let body: { familyId?: string; byUid?: string; personKey?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const familyId = typeof body.familyId === 'string' ? body.familyId : '';
  const byUid = typeof body.byUid === 'string' ? body.byUid : '';
  const personKey = typeof body.personKey === 'string' ? body.personKey : '';
  if (!familyId || !byUid || !personKey) return NextResponse.json({ error: 'bad-args' }, { status: 400 });

  const famRef = db.collection('families').doc(familyId);

  // Caller must belong to the family — as a user OR a kid (children.uid).
  const senderSnap = await db.collection('users').doc(byUid).get();
  let belongs = senderSnap.exists && senderSnap.data()?.familyId === familyId;
  if (!belongs) {
    const childMatch = await famRef.collection('children').where('uid', '==', byUid).limit(1).get();
    belongs = !childMatch.empty;
  }
  if (!belongs) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const famSnap = await famRef.get();
  if (!famSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const state = (famSnap.data()?.birthdays || {}) as Record<string, {
    name?: string; age?: number; wishes?: BirthdayWishEntry[]; keepsakeAt?: number; keepsakePostId?: string;
  }>;
  const day = state[personKey];
  if (!day) return NextResponse.json({ error: 'no-celebration' }, { status: 404 });
  if (day.keepsakeAt) return NextResponse.json({ ok: true, already: true, postId: day.keepsakePostId || null });

  const name = day.name || 'the birthday star';
  const age = typeof day.age === 'number' ? day.age : undefined;
  const wishes = Array.isArray(day.wishes) ? day.wishes : [];

  // kid? → tag the post to the kid's profile.
  const personId = personKey.includes('_') ? personKey.slice(0, personKey.lastIndexOf('_')) : personKey;
  const childSnap = await famRef.collection('children').doc(personId).get();
  const kidTags = childSnap.exists ? [personId] : [];

  // caption — the birthday + the wishes wall.
  const ageBit = age ? `${ordinalAge(age)} ` : '';
  let caption = `🎂 ${name}'s ${ageBit}birthday!`;
  if (wishes.length > 0) {
    caption += ` 💛 ${wishes.length} wish${wishes.length === 1 ? '' : 'es'} from the family:`;
    const lines = wishes.slice(0, 8).map((w) => `• “${w.text}” — ${w.name}`);
    caption += `\n${lines.join('\n')}`;
    if (wishes.length > 8) caption += `\n…and ${wishes.length - 8} more 🎈`;
  }
  caption = caption.slice(0, 1800);

  const postRef = await famRef.collection('posts').add({
    authorUid: 'kaya',
    authorName: 'Kaya 🎂',
    caption,
    photos: [],
    kidTags,
    visibility: 'family',
    pending: false,
    reactionCount: 0,
    reactionsByType: Object.fromEntries(REACTION_EMOJIS.map((e) => [e, 0])),
    commentCount: 0,
    createdAt: FieldValue.serverTimestamp(),
  });

  await famRef.set(
    { birthdays: { [personKey]: { keepsakeAt: Date.now(), keepsakePostId: postRef.id } } },
    { merge: true },
  );
  return NextResponse.json({ ok: true, postId: postRef.id });
}
