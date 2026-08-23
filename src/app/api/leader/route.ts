// 👑 Leader of the Week — Admin gateway (LW PR-L1…L4).
//
// ALL crown / term / 📒 Notebook reads+writes flow through here (Diary
// idiom): the Admin SDK bypasses client rules, so NO firestore.rules
// changes are needed for `leaderTerms` / `leaderNotes` — and a kid leader
// can write a note about a SIBLING (client rules only allow self-targeted
// approval requests). Authorisation happens in this file: Bearer ID token →
// users/{uid} must belong to the family; per-action role checks below.
//
// Points themselves NEVER move here for parent decisions: the parent
// client runs the existing `giveAward` rail (badges, 🏅 email, thresholds)
// between `note-claim` and `note-finalize`. The only server-side award is
// the small term bonus (same inline math as /api/meetings/finish roleAwards).

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, type Firestore, type DocumentReference } from 'firebase-admin/firestore';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { bumpBadgeCountersAdmin } from '@/lib/badgeCountersAdmin';
import {
  readLeaderConfig, computeTraits, styleFor, averageTraits, pickMission, localDayKey,
  noteBounds, coachWhisper, NOTE_CATEGORIES,
  type HouseLeader, type LeaderTerm, type LeaderNote, type LeaderTermCounts, type LeaderNoteKind,
  type LeaderTraits,
} from '@/lib/leaderWeek.shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Action =
  | 'handover' | 'appoint' | 'end-term'
  | 'notebook' | 'note-create' | 'note-list' | 'note-claim' | 'note-finalize' | 'note-release' | 'note-seen'
  | 'term-list' | 'advice-set' | 'term-celebrated';

const TZ = 'Africa/Dar_es_Salaam';

type ChildLite = { id: string; name: string; avatarEmoji?: string; birthday?: string; participationOverrides?: { notebook?: boolean; meetings?: boolean } };

function ageOf(birthday?: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday || '');
  if (!m) return null;
  const b = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const md = now.getMonth() - b.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < b.getDate())) age -= 1;
  return age < 0 ? null : age;
}

// Mission progress from the term's notes + facts (idea A).
function missionProgress(
  term: LeaderTerm,
  notes: LeaderNote[],
): { progress: number; target: number; done: boolean } {
  const m = term.mission;
  if (!m) return { progress: 0, target: 1, done: false };
  const live = notes.filter((n) => n.termId === term.id && n.status !== 'declined' && n.status !== 'expired');
  const decided = live.filter((n) => n.status === 'approved' || n.status === 'adjusted');
  const others = (arr: LeaderNote[]) => arr.filter((n) => n.targetChildId !== term.childId);
  let p = 0;
  switch (m.id) {
    case 'everyone-one': case 'two-siblings': {
      p = new Set(others(live).filter((n) => n.kind === 'shoutout').map((n) => n.targetChildId)).size; break;
    }
    case 'three-kind': p = others(live).filter((n) => n.kind === 'shoutout' && n.category === 'kindness').length; break;
    case 'five-shoutouts': case 'seven-stars': p = others(live).filter((n) => n.kind === 'shoutout').length; break;
    case 'help-not-hurt': p = others(decided).filter((n) => n.kind === 'headsup').length; break;
    case 'one-each-kind': p = (others(decided).some((n) => n.kind === 'headsup') && others(live).some((n) => n.kind === 'shoutout')) ? 1 : 0; break;
    case 'quiet-one': {
      const q = (term.mission as { quietOneId?: string }).quietOneId;
      p = q && others(live).some((n) => n.kind === 'shoutout' && n.targetChildId === q) ? 1 : 0; break;
    }
    case 'open-heart': p = term.openingWordDone ? 1 : 0; break;
    case 'four-days': p = new Set(live.map((n) => n.day)).size; break;
    case 'three-days': {
      const days = Array.from(new Set(live.map((n) => n.day))).sort();
      let best = 0; let run = 0; let prev: string | null = null;
      for (const d of days) {
        if (prev && (new Date(d).getTime() - new Date(prev).getTime()) === 86400000) run += 1; else run = 1;
        best = Math.max(best, run); prev = d;
      }
      p = best; break;
    }
    case 'honest-me': p = decided.filter((n) => n.kind === 'headsup' && n.targetChildId === term.childId).length; break;
    default: p = 0;
  }
  const target = m.target || 1;
  return { progress: Math.min(p, target), target, done: p >= target };
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ error: 'admin-sdk-not-configured' }, { status: 503 });

  let uid: string;
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    uid = (await adminAuth.verifyIdToken(token)).uid;
  } catch {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action as Action;
  const familyId = String(body.familyId || '');
  if (!action || !familyId) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.data() as { familyId?: string; role?: string; childId?: string; displayName?: string } | undefined;
  if (!user || user.familyId !== familyId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const isParent = user.role === 'parent';
  const isAdult = isParent || user.role === 'helper';
  const myChildId = user.role === 'kid' ? String(user.childId || '') : '';
  const famRef = db.collection('families').doc(familyId);
  const termsCol = famRef.collection('leaderTerms');
  const notesCol = famRef.collection('leaderNotes');

  const famSnap = await famRef.get();
  const fam = (famSnap.data() || {}) as {
    houseLeader?: HouseLeader | null;
    leaderConfig?: Record<string, unknown>;
    nextMeetingLeader?: { id: string; name: string; emoji: string; kind: 'parent' | 'kid' | 'helper' } | null;
    pointSystem?: { reducing?: { enabled?: boolean; max?: number }; diamondMinPoints?: number };
    leaderAppointPending?: { at: number; byName?: string } | null;
    weekTheme?: { setAt?: number };
  };
  const config = readLeaderConfig(fam as { leaderConfig?: Partial<import('@/lib/leaderWeek.shared').LeaderConfig> });
  const pointSystem = {
    reducing: { enabled: !!fam.pointSystem?.reducing?.enabled, max: Number(fam.pointSystem?.reducing?.max || 1) },
    diamondMinPoints: Number(fam.pointSystem?.diamondMinPoints || 4),
  };

  const loadChildren = async (): Promise<ChildLite[]> => {
    const s = await famRef.collection('children').get();
    return s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChildLite, 'id'>) }));
  };
  const kidLoginUid = async (childId: string): Promise<string | null> => {
    const s = await db.collection('users').where('familyId', '==', familyId).where('childId', '==', childId).limit(1).get();
    return s.empty ? null : s.docs[0].id;
  };
  const parentUids = async (): Promise<string[]> => {
    const s = await db.collection('users').where('familyId', '==', familyId).where('role', '==', 'parent').get();
    return s.docs.map((d) => d.id);
  };
  const bell = async (forUserId: string, note: { type: string; title: string; message: string; link: string }) => {
    await famRef.collection('notifications').add({ ...note, forUserId, read: false, createdAt: new Date() }).catch(() => {});
  };
  const termNotes = async (termId: string): Promise<LeaderNote[]> => {
    const s = await notesCol.where('termId', '==', termId).get();
    return s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LeaderNote, 'id'>) })).sort((a, b) => b.createdAt - a.createdAt);
  };
  const allTerms = async (): Promise<LeaderTerm[]> => {
    const s = await termsCol.orderBy('startAt', 'desc').limit(200).get();
    return s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LeaderTerm, 'id'>) }));
  };

  // ── Seal a term: counts → traits → style → bonus → counters ─────
  const sealTerm = async (
    termRef: DocumentReference,
    term: LeaderTerm,
    facts: { endReason: 'meeting' | 'parent' | 'replaced'; ledChildId?: string | null; openingWordDone?: boolean; themeSet?: boolean; rolesDealt?: boolean; endedBy: string },
    children: ChildLite[],
  ): Promise<LeaderTerm> => {
    const now = Date.now();
    const notes = await termNotes(term.id);
    // Expire anything still open (no effect on traits).
    const open = notes.filter((n) => n.status === 'pending' || n.status === 'resolving');
    for (const n of open) await notesCol.doc(n.id).update({ status: 'expired', resolvedAt: now }).catch(() => {});
    const others = children.filter((c) => c.id !== term.childId);
    const decided = notes.filter((n) => n.status === 'approved' || n.status === 'adjusted');
    const aboutOthers = (arr: LeaderNote[]) => arr.filter((n) => n.targetChildId !== term.childId);
    const counts: LeaderTermCounts = {
      shoutOuts: aboutOthers(decided).filter((n) => n.kind === 'shoutout').length,
      headsUps: aboutOthers(decided).filter((n) => n.kind === 'headsup').length,
      self: notes.filter((n) => n.targetChildId === term.childId).length,
      sent: notes.length,
      approved: notes.filter((n) => n.status === 'approved').length,
      adjusted: notes.filter((n) => n.status === 'adjusted').length,
      declined: notes.filter((n) => n.status === 'declined').length,
      expired: notes.filter((n) => n.status === 'expired').length + open.length,
      activeDays: new Set(notes.map((n) => n.day)).size,
      termDays: Math.max(1, Math.round((now - term.startAt) / 86400000)),
      siblingsNoticed: new Set(aboutOthers(decided).map((n) => n.targetChildId)).size,
      siblings: others.length,
    };
    // Leader's own 🔴 days during the term (daily ratings; range query on
    // `date` only — single-field auto index; childId filtered in code).
    let badDays = 0;
    try {
      const startDay = localDayKey(term.startAt, TZ);
      const rs = await famRef.collection('ratings').where('date', '>=', startDay).get();
      const bad = new Set<string>();
      for (const d of rs.docs) {
        const r = d.data() as { childId?: string; date?: string; ratings?: Record<string, string> };
        if (r.childId !== term.childId) continue;
        if (Object.values(r.ratings || {}).some((v) => v === 'bad')) bad.add(String(r.date));
      }
      badDays = bad.size;
    } catch { /* best-effort */ }
    const ledMeeting = facts.endReason === 'meeting' && facts.ledChildId === term.childId;
    const hostApplicable = facts.endReason === 'meeting' && term.source === 'meeting';
    const factsForTraits = {
      ledMeeting, openingWordDone: !!facts.openingWordDone, themeSet: !!facts.themeSet, rolesDealt: !!facts.rolesDealt, badDays,
    };
    const traits = computeTraits(factsForTraits, counts, hostApplicable);
    const style = styleFor(traits);
    const honest = decided.some((n) => n.kind === 'headsup' && n.targetChildId === term.childId);
    const mp = missionProgress({ ...term, openingWordDone: factsForTraits.openingWordDone }, notes);

    // Term bonus — only for terms that lasted ≥ 3 days (a replaced
    // same-night appointment earns nothing).
    let bonusAwardId: string | undefined;
    const termDaysReal = (now - term.startAt) / 86400000;
    if (config.termBonusPoints > 0 && termDaysReal >= 3) {
      const childRef = famRef.collection('children').doc(term.childId);
      const awardRef = famRef.collection('awards').doc();
      const ok = await db.runTransaction(async (tx) => {
        const snap = await tx.get(childRef);
        if (!snap.exists) return false;
        const c = snap.data() as { totalPoints?: number; weeklyPoints?: number; lifetimePoints?: number };
        const pts = config.termBonusPoints;
        tx.set(awardRef, {
          childId: term.childId, kind: 'regular', points: pts,
          reason: `👑 Leader of the Week — ${term.counts ? '' : ''}${style} (week of ${localDayKey(term.startAt, TZ)})`,
          category: 'leadership',
          awardedBy: 'system', awardedByName: 'Kaya', senderRole: 'parent',
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.update(childRef, {
          totalPoints: (c.totalPoints || 0) + pts,
          weeklyPoints: (c.weeklyPoints || 0) + pts,
          lifetimePoints: Math.max(c.lifetimePoints || 0, c.totalPoints || 0) + pts,
        });
        return true;
      }).catch(() => false);
      if (ok) bonusAwardId = awardRef.id;
    }
    await bumpBadgeCountersAdmin(db, familyId, term.childId, {
      leaderTerms: 1,
      leaderNotesApproved: counts.approved + counts.adjusted,
      ...(bonusAwardId ? { award_leadership: 1 } : {}),
    });

    const sealed: Partial<LeaderTerm> = {
      endAt: now, sealedAt: now, endedBy: facts.endedBy, endReason: facts.endReason,
      ledMeeting, openingWordDone: factsForTraits.openingWordDone, themeSet: factsForTraits.themeSet, rolesDealt: factsForTraits.rolesDealt, badDays,
      counts, traits, style, honest,
      ...(term.mission ? { mission: { ...term.mission, progress: mp.progress, target: mp.target, done: mp.done } } : {}),
      ...(bonusAwardId ? { bonusPoints: config.termBonusPoints, bonusAwardId } : {}),
    };
    await termRef.set(sealed, { merge: true });

    const kidUid = await kidLoginUid(term.childId);
    if (kidUid) {
      await bell(kidUid, {
        type: 'reward', title: '👑 Your week as leader is sealed',
        message: `${style} · ${counts.approved + counts.adjusted} notes made a difference${bonusAwardId ? ` · +${config.termBonusPoints} leader bonus` : ''}`,
        link: '/stats/me#leadership',
      });
    }
    return { ...term, ...sealed } as LeaderTerm;
  };

  // ── Open a term for a kid ─────────────────────────────────────────
  const openTerm = async (child: ChildLite, source: 'meeting' | 'appointed', setBy: string, children: ChildLite[]): Promise<LeaderTerm> => {
    const now = Date.now();
    const terms = await allTerms();
    const mine = terms.filter((t) => t.childId === child.id);
    const avg = averageTraits(mine);
    const others = children.filter((c) => c.id !== child.id);
    const picked = config.missionsOn ? pickMission(avg, mine.length, others.length) : null;
    // Coverage missions scale to the real sibling count ("everyone" = all of them).
    const mission = picked
      ? { ...picked, target: picked.metric === 'coverage' ? Math.max(1, picked.id === 'two-siblings' ? Math.min(2, others.length) : others.length) : picked.target }
      : null;
    // 👀 quiet one = sibling with the fewest approved notes about them so far.
    let quietOneId: string | undefined;
    if (mission?.id === 'quiet-one' && others.length) {
      const all = await notesCol.where('status', 'in', ['approved', 'adjusted']).get().catch(() => null);
      const tally: Record<string, number> = {};
      others.forEach((o) => { tally[o.id] = 0; });
      all?.docs.forEach((d) => { const n = d.data() as LeaderNote; if (n.targetChildId in tally) tally[n.targetChildId] += 1; });
      quietOneId = others.slice().sort((a, b) => tally[a.id] - tally[b.id])[0]?.id;
    }
    const termRef = termsCol.doc();
    const term: Omit<LeaderTerm, 'id'> = {
      childId: child.id, name: child.name, emoji: child.avatarEmoji || '🧒',
      startAt: now, endAt: null, source, setBy,
      ...(mission ? { mission: { id: mission.id, label: mission.label, done: false, progress: 0, target: mission.target, ...(quietOneId ? { quietOneId } : {}) } as LeaderTerm['mission'] } : {}),
    };
    await termRef.set(term);
    const houseLeader: HouseLeader = {
      childId: child.id, name: child.name, emoji: child.avatarEmoji || '🧒', termId: termRef.id, startAt: now, source, setBy,
    };
    await famRef.set({ houseLeader, leaderAppointPending: FieldValue.delete() }, { merge: true });
    // Bells: the new leader + siblings.
    const kidUid = await kidLoginUid(child.id);
    if (kidUid) {
      await bell(kidUid, { type: 'reward', title: '👑 You are Leader of the Week!', message: mission ? `Your mission: ${mission.emoji} ${mission.label}` : 'Lead the family this week — open your Notebook.', link: '/kid' });
    }
    for (const o of others) {
      const ou = await kidLoginUid(o.id);
      if (ou) await bell(ou, { type: 'reward', title: `👑 ${child.name.split(' ')[0]} is Leader of the Week`, message: 'Cheer them on — and show your best!', link: '/kid' });
    }
    return { id: termRef.id, ...term };
  };

  // Close the current term (if any) and clear the crown.
  const closeCurrent = async (
    facts: { endReason: 'meeting' | 'parent' | 'replaced'; ledChildId?: string | null; openingWordDone?: boolean; themeSet?: boolean; rolesDealt?: boolean },
    children: ChildLite[],
  ): Promise<LeaderTerm | null> => {
    const hl = fam.houseLeader;
    if (!hl?.termId) return null;
    const tRef = termsCol.doc(hl.termId);
    const tSnap = await tRef.get();
    if (!tSnap.exists) { await famRef.set({ houseLeader: null }, { merge: true }); return null; }
    const term = { id: tSnap.id, ...(tSnap.data() as Omit<LeaderTerm, 'id'>) };
    if (term.endAt) { await famRef.set({ houseLeader: null }, { merge: true }); return term; }
    const sealed = await sealTerm(tRef, term, { ...facts, endedBy: uid }, children);
    await famRef.set({ houseLeader: null }, { merge: true });
    return sealed;
  };

  try {
    switch (action) {
      // ── Meeting FINISH → handover (any family member who finished the meeting)
      case 'handover': {
        if (!config.enabled) return NextResponse.json({ ok: true, skipped: 'disabled' });
        const facts = (body.facts || {}) as { ledChildId?: string | null; openingWordDone?: boolean; themeSet?: boolean; rolesDealt?: boolean };
        const children = await loadChildren();
        const pick = fam.nextMeetingLeader;
        const hl = fam.houseLeader;
        // Idempotency: a second finish on the same night (double-tap /
        // retry) must not re-close + re-open.
        if (hl && Date.now() - hl.startAt < 6 * 3600 * 1000 && pick?.kind === 'kid' && pick.id === hl.childId) {
          return NextResponse.json({ ok: true, skipped: 'already-handed-over', houseLeader: hl });
        }
        const closed = await closeCurrent({ endReason: 'meeting', ...facts }, children);
        if (pick?.kind === 'kid') {
          const child = children.find((c) => c.id === pick.id);
          if (child) {
            const term = await openTerm(child, 'meeting', uid, children);
            return NextResponse.json({ ok: true, closed, opened: term });
          }
        }
        // Adult picked → parents get the "appoint" card.
        await famRef.set({ leaderAppointPending: { at: Date.now(), byName: pick?.name || '' } }, { merge: true });
        return NextResponse.json({ ok: true, closed, opened: null, appointPending: true });
      }

      case 'appoint': {
        if (!isParent) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const childId = String(body.childId || '');
        const children = await loadChildren();
        const child = children.find((c) => c.id === childId);
        if (!child) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        if (fam.houseLeader?.childId === childId) return NextResponse.json({ ok: true, skipped: 'same-leader', houseLeader: fam.houseLeader });
        const closed = await closeCurrent({ endReason: 'replaced' }, children);
        const term = await openTerm(child, 'appointed', uid, children);
        return NextResponse.json({ ok: true, closed, opened: term });
      }

      case 'end-term': {
        if (!isParent) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const children = await loadChildren();
        const closed = await closeCurrent({ endReason: 'parent' }, children);
        return NextResponse.json({ ok: true, closed });
      }

      // ── 📒 Notebook bundle (leader kid, or adults previewing) ───────
      case 'notebook': {
        const hl = fam.houseLeader;
        if (!hl) return NextResponse.json({ ok: true, term: null, notes: [], caps: null });
        if (!isAdult && myChildId !== hl.childId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const children = await loadChildren();
        const tSnap = await termsCol.doc(hl.termId).get();
        const term = tSnap.exists ? ({ id: tSnap.id, ...(tSnap.data() as Omit<LeaderTerm, 'id'>) }) : null;
        const notes = term ? await termNotes(term.id) : [];
        const today = localDayKey(Date.now(), TZ);
        const todays = notes.filter((n) => n.day === today);
        const selfToday = todays.filter((n) => n.targetChildId === hl.childId && n.kind === 'shoutout').length;
        const me = children.find((c) => c.id === hl.childId);
        const age = me ? ageOf(me.birthday) : null;
        const override = me?.participationOverrides?.notebook;
        const notebookAllowed = typeof override === 'boolean' ? override : (age === null ? true : age >= config.notebookMinAge);
        const others = children.filter((c) => c.id !== hl.childId);
        const byTarget: Record<string, number> = {};
        for (const n of notes) if (n.targetChildId !== hl.childId && n.status !== 'declined' && n.status !== 'expired') byTarget[n.targetChildId] = (byTarget[n.targetChildId] || 0) + 1;
        const whisper = config.coachNudgesOn ? coachWhisper({
          notesByTarget: byTarget,
          shoutOuts: notes.filter((n) => n.kind === 'shoutout' && n.targetChildId !== hl.childId).length,
          headsUps: notes.filter((n) => n.kind === 'headsup' && n.targetChildId !== hl.childId).length,
          lastNoteAt: notes.length ? notes[0].createdAt : null,
          startAt: hl.startAt, now: Date.now(),
          siblingNames: Object.fromEntries(others.map((o) => [o.id, o.name.split(' ')[0]])),
        }) : null;
        const mp = term ? missionProgress(term, notes) : null;
        // 🔑 idea B — the previous leader's advice line for THIS leader.
        let prevAdvice: { name: string; emoji: string; advice: string } | null = null;
        try {
          const prevSnap = await termsCol.orderBy('startAt', 'desc').limit(12).get();
          const prev = prevSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LeaderTerm, 'id'>) })).find((t) => t.id !== hl.termId && t.endAt && t.advice);
          if (prev) prevAdvice = { name: prev.name.split(' ')[0], emoji: prev.emoji, advice: String(prev.advice) };
        } catch { /* best-effort */ }
        return NextResponse.json({
          ok: true,
          term,
          notes,
          prevAdvice,
          mission: term?.mission ? { ...term.mission, ...mp } : null,
          whisper,
          notebookAllowed,
          caps: {
            dailyCap: config.dailyNoteCap, usedToday: todays.length,
            selfAllowed: config.allowSelfNotes, selfUsedToday: selfToday,
            shoutoutPoints: noteBounds('shoutout', pointSystem),
            headsupPoints: noteBounds('headsup', pointSystem),
          },
          targets: children.map((c) => ({ id: c.id, name: c.name, emoji: c.avatarEmoji || '🧒', self: c.id === hl.childId })),
          categories: NOTE_CATEGORIES,
          unseen: notes.filter((n) => (n.status === 'approved' || n.status === 'adjusted' || n.status === 'declined') && !n.seenByLeader).length,
        });
      }

      case 'note-create': {
        const hl = fam.houseLeader;
        if (!hl || !config.enabled) return NextResponse.json({ error: 'no-leader' }, { status: 409 });
        if (myChildId !== hl.childId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const kind = body.kind as LeaderNoteKind;
        const targetChildId = String(body.targetChildId || '');
        const reason = String(body.reason || '').trim().slice(0, 280);
        const category = String(body.category || 'other').slice(0, 30);
        const proposedPoints = Number(body.proposedPoints);
        if ((kind !== 'shoutout' && kind !== 'headsup') || !targetChildId || reason.split(/\s+/).filter(Boolean).length < 3) {
          return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        }
        const bounds = noteBounds(kind, pointSystem);
        if (!bounds.includes(proposedPoints)) return NextResponse.json({ error: 'points-out-of-bounds', bounds }, { status: 400 });
        const children = await loadChildren();
        const target = children.find((c) => c.id === targetChildId);
        if (!target) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        const me = children.find((c) => c.id === hl.childId);
        const age = me ? ageOf(me.birthday) : null;
        const override = me?.participationOverrides?.notebook;
        const allowed = typeof override === 'boolean' ? override : (age === null ? true : age >= config.notebookMinAge);
        if (!allowed) return NextResponse.json({ error: 'notebook-age' }, { status: 403 });
        const isSelf = targetChildId === hl.childId;
        if (isSelf && !config.allowSelfNotes) return NextResponse.json({ error: 'self-notes-off' }, { status: 403 });
        const notes = await termNotes(hl.termId);
        const today = localDayKey(Date.now(), TZ);
        const todays = notes.filter((n) => n.day === today);
        if (todays.length >= config.dailyNoteCap) return NextResponse.json({ error: 'daily-cap' }, { status: 429 });
        if (isSelf && kind === 'shoutout' && todays.some((n) => n.targetChildId === hl.childId && n.kind === 'shoutout')) {
          return NextResponse.json({ error: 'self-cap' }, { status: 429 });
        }
        const note: Omit<LeaderNote, 'id'> = {
          termId: hl.termId, leaderChildId: hl.childId, leaderName: hl.name,
          targetChildId, targetName: target.name, targetEmoji: target.avatarEmoji || '🧒',
          kind, proposedPoints, category, reason,
          ...(body.photoPath ? { photoPath: String(body.photoPath).slice(0, 300) } : {}),
          status: 'pending', day: today, createdAt: Date.now(), createdBy: uid,
        };
        const ref = await notesCol.add(note);
        // Parents' bell (the inbox banner picks it up live; the bell is the nudge).
        const first = hl.name.split(' ')[0];
        for (const p of await parentUids()) {
          await bell(p, {
            type: 'reward', title: `👑 ${first} took a note`,
            message: `${kind === 'shoutout' ? '⭐' : '📝'} ${isSelf ? 'about themselves' : `about ${target.name.split(' ')[0]}`} · ${proposedPoints > 0 ? `+${proposedPoints}` : proposedPoints} · ${reason.slice(0, 60)}`,
            link: '/parent/leader',
          });
        }
        return NextResponse.json({ ok: true, id: ref.id });
      }

      case 'note-list': {
        // Adults: by status or term; kid leader: own notes of own term(s).
        const status = body.status ? String(body.status) : '';
        const termId = body.termId ? String(body.termId) : '';
        let q: FirebaseFirestore.Query = notesCol;
        if (termId) q = q.where('termId', '==', termId);
        else if (status) q = q.where('status', '==', status);
        else q = q.orderBy('createdAt', 'desc').limit(100);
        const s = await q.get();
        let notes = s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LeaderNote, 'id'>) }));
        if (!isAdult) {
          // Kids: only notes THEY wrote (never pending notes about them).
          notes = notes.filter((n) => n.leaderChildId === myChildId);
        }
        notes.sort((a, b) => b.createdAt - a.createdAt);
        return NextResponse.json({ ok: true, notes });
      }

      case 'note-claim': {
        if (!isParent) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const ref = notesCol.doc(String(body.noteId || ''));
        const ok = await db.runTransaction(async (tx) => {
          const s = await tx.get(ref);
          if (!s.exists) return false;
          const n = s.data() as LeaderNote;
          if (n.status !== 'pending') return false;
          tx.update(ref, { status: 'resolving', resolvedBy: uid, resolvedAt: Date.now() });
          return true;
        });
        if (!ok) return NextResponse.json({ error: 'not-pending' }, { status: 409 });
        return NextResponse.json({ ok: true });
      }

      case 'note-release': {
        if (!isParent) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const ref = notesCol.doc(String(body.noteId || ''));
        const s = await ref.get();
        if (s.exists && (s.data() as LeaderNote).status === 'resolving') await ref.update({ status: 'pending' });
        return NextResponse.json({ ok: true });
      }

      case 'note-finalize': {
        if (!isParent) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const ref = notesCol.doc(String(body.noteId || ''));
        const decision = String(body.decision || '');
        if (!['approved', 'adjusted', 'declined'].includes(decision)) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        const s = await ref.get();
        if (!s.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
        const n = { id: s.id, ...(s.data() as Omit<LeaderNote, 'id'>) };
        if (n.status !== 'pending' && n.status !== 'resolving') return NextResponse.json({ error: 'already-resolved', note: n }, { status: 409 });
        const parentNote = String(body.parentNote || '').trim().slice(0, 280);
        if (decision === 'declined' && !parentNote) return NextResponse.json({ error: 'note-required' }, { status: 400 });
        const finalPoints = decision === 'declined' ? 0 : Number(body.finalPoints ?? n.proposedPoints);
        const patch: Partial<LeaderNote> = {
          status: decision as LeaderNote['status'], finalPoints, resolvedBy: uid,
          resolvedByName: String(user.displayName || 'Parent').split(' ')[0], resolvedAt: Date.now(), seenByLeader: false,
          ...(body.awardId ? { awardId: String(body.awardId) } : {}),
          ...(parentNote ? { parentNote } : {}),
        };
        await ref.set(patch, { merge: true });
        // Leader hears the outcome.
        const leaderUid = await kidLoginUid(n.leaderChildId);
        const who = n.targetChildId === n.leaderChildId ? 'yourself' : n.targetName.split(' ')[0];
        if (leaderUid) {
          const verb = decision === 'approved' ? '✅ approved' : decision === 'adjusted' ? '🔁 adjusted' : '❌ not this time';
          await bell(leaderUid, {
            type: 'reward', title: `📒 Your note about ${who} — ${verb}`,
            message: `${decision === 'declined' ? '' : `${finalPoints > 0 ? `+${finalPoints}` : finalPoints} · `}${patch.resolvedByName}${parentNote ? `: ${parentNote.slice(0, 80)}` : ''}`,
            link: '/kid/notebook',
          });
        }
        // Target kid hears only on approve/adjust (award + bell) — never on decline.
        if (decision !== 'declined' && n.targetChildId !== n.leaderChildId) {
          const tUid = await kidLoginUid(n.targetChildId);
          if (tUid) {
            const attributed = n.kind === 'shoutout' || config.headsUpAttribution === 'name';
            await bell(tUid, {
              type: 'reward',
              title: n.kind === 'shoutout' ? `⭐ ${attributed ? `👑 ${n.leaderName.split(' ')[0]} noticed you` : 'You were noticed'}` : `📝 ${attributed ? `👑 ${n.leaderName.split(' ')[0]}'s heads-up` : "👑 Leader's note"}`,
              message: `${finalPoints !== 0 ? `${finalPoints > 0 ? `+${finalPoints}` : finalPoints} · ` : ''}${n.reason.slice(0, 70)}${parentNote ? ` · ${patch.resolvedByName}: ${parentNote.slice(0, 60)}` : ''}`,
              link: '/kid',
            });
          }
        }
        return NextResponse.json({ ok: true });
      }

      case 'note-seen': {
        const ids = Array.isArray(body.noteIds) ? body.noteIds.slice(0, 50) : [];
        for (const id of ids) {
          const ref = notesCol.doc(String(id));
          const s = await ref.get();
          if (!s.exists) continue;
          const n = s.data() as LeaderNote;
          if (!isAdult && n.leaderChildId !== myChildId) continue;
          await ref.update({ seenByLeader: true }).catch(() => {});
        }
        return NextResponse.json({ ok: true });
      }

      case 'term-list': {
        const childId = body.childId ? String(body.childId) : '';
        if (!isAdult && childId && childId !== myChildId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        let terms = await allTerms();
        if (childId) terms = terms.filter((t) => t.childId === childId);
        // Lifetime per kid.
        const byKid: Record<string, { childId: string; name: string; emoji: string; selected: number; meetingsLed: number; notesApproved: number; avg: LeaderTraits | null; style: string; honest: number; missionsDone: number; lastAt: number }> = {};
        for (const t of terms) {
          const k = byKid[t.childId] || (byKid[t.childId] = { childId: t.childId, name: t.name, emoji: t.emoji, selected: 0, meetingsLed: 0, notesApproved: 0, avg: null, style: 'New Leader', honest: 0, missionsDone: 0, lastAt: 0 });
          k.selected += 1;
          if (t.ledMeeting) k.meetingsLed += 1;
          if (t.counts) k.notesApproved += t.counts.approved + t.counts.adjusted;
          if (t.honest) k.honest += 1;
          if (t.mission?.done) k.missionsDone += 1;
          k.lastAt = Math.max(k.lastAt, t.startAt);
        }
        for (const k of Object.values(byKid)) {
          k.avg = averageTraits(terms.filter((t) => t.childId === k.childId));
          k.style = styleFor(k.avg);
        }
        // Kids without kidSeesTraits: strip traits from their own view.
        if (!isAdult && !config.kidSeesTraits) {
          terms = terms.map((t) => ({ ...t, traits: undefined }));
          for (const k of Object.values(byKid)) k.avg = null;
        }
        return NextResponse.json({ ok: true, terms, lifetime: Object.values(byKid) });
      }

      case 'advice-set': {
        const termId = String(body.termId || '');
        const tRef = termsCol.doc(termId);
        const s = await tRef.get();
        if (!s.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
        const t = s.data() as LeaderTerm;
        if (!isParent && t.childId !== myChildId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const advice = String(body.advice || '').trim().slice(0, 200);
        const report = String(body.report || '').trim().slice(0, 600);
        await tRef.set({ ...(advice ? { advice } : {}), ...(report ? { report } : {}) }, { merge: true });
        return NextResponse.json({ ok: true });
      }

      case 'term-celebrated': {
        if (!isAdult) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        await termsCol.doc(String(body.termId || '')).set({ celebrated: true, celebratedAt: Date.now() }, { merge: true });
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: 'bad-action' }, { status: 400 });
    }
  } catch (e) {
    console.error('[api/leader]', action, e);
    return NextResponse.json({ error: 'server-error' }, { status: 500 });
  }
}
