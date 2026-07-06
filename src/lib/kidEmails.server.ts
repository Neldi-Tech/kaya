// 📬 Kids' Email Updates — SERVER resolution (KID PR1).
//
// The prefs store a POINTER (kid-profile / parent / contact); this resolves
// the live address at send time (F9). The senders themselves land with
// their features: 🏅 reward emails (KID PR2), 🌞 morning digest (KID PR3) —
// both call resolveKidEmailAddress and log to the 📜 alertLog.

import type { KidEmailPrefs } from './kidEmails.shared';

type AdminDb = FirebaseFirestore.Firestore;

interface FamilyDataSlice {
  kidEmailUpdates?: Record<string, KidEmailPrefs>;
  externalContacts?: { id: string; name: string; email: string }[];
}

export interface ResolvedKidEmail {
  email: string;
  /** Where it resolved from — logged for the parent-facing trace. */
  sourceLabel: 'kid profile' | 'parent' | 'approved contact';
}

/** Resolve the live address for one kid, or null when the pointer is unset,
 *  dangling (contact removed, parent left) or the target has no email —
 *  in every null case NOTHING sends, silently (D1: default-off posture). */
export async function resolveKidEmailAddress(
  db: AdminDb,
  familyId: string,
  childId: string,
  famData: FamilyDataSlice | undefined,
): Promise<ResolvedKidEmail | null> {
  const source = famData?.kidEmailUpdates?.[childId]?.source;
  if (!source) return null;
  try {
    if (source.type === 'kid') {
      const kid = await db.collection('families').doc(familyId)
        .collection('children').doc(childId).get();
      const email = (kid.data() as { email?: string } | undefined)?.email;
      return email ? { email, sourceLabel: 'kid profile' } : null;
    }
    if (source.type === 'parent') {
      const user = await db.collection('users').doc(source.uid).get();
      const u = user.data() as { email?: string; familyId?: string; role?: string } | undefined;
      // The pointer must still be a parent OF THIS family — a departed or
      // re-roled account silently stops receiving (same safety posture as
      // the alert-emails resolver).
      if (!u?.email || u.familyId !== familyId || u.role !== 'parent') return null;
      return { email: u.email, sourceLabel: 'parent' };
    }
    const c = (famData?.externalContacts ?? []).find((x) => x.id === source.id);
    return c?.email ? { email: c.email, sourceLabel: 'approved contact' } : null;
  } catch {
    return null; // resolution is best-effort — never throws into a sender
  }
}

// ═══ 🏅 Reward emails (KID PR2) ═══════════════════════════════════════════
//
// One sender for every reward source — awards (giveAward pings the
// /api/kids/reward-email route) and server-side task approvals (the
// workplan proof-review route calls sendKidRewardEmail directly). All
// best-effort: a failed email never touches the reward itself (D4).
// Every send writes a kind:'kid_reward' entry to the 📜 alertLog with the
// facts + template version, so parents can read it as sent (D5/F9).

import { Resend } from 'resend';

const resendKey = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
const resend = resendKey ? new Resend(resendKey) : null;

/** Bump together with renderKidRewardEmail's markup AND the KidRewardTab
 *  renderer in /pantry/utility-meters/alerts (F9 discipline). */
export const KID_REWARD_TEMPLATE_VERSION = 1;

export interface KidRewardFacts {
  kidName: string;
  emoji: string;      // 🏅 / 💎 / 👏
  headline: string;   // "+15 House Points!" / "Kudos!"
  detail: string;     // "Clean your room — from Dad"
  balance?: number;   // HP after the reward
  streak?: number;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderKidRewardEmail(f: KidRewardFacts): string {
  return `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:480px;margin:0 auto;padding:14px">
    <div style="border-radius:18px;overflow:hidden;border:1px solid #EFE4CC">
      <div style="background:linear-gradient(135deg,#F0A32A,#E58A1F);padding:22px 16px;color:#fff;text-align:center">
        <div style="font-size:40px;line-height:1">${esc(f.emoji)}</div>
        <div style="font-size:22px;font-weight:900;margin-top:6px">${esc(f.headline)}</div>
        <div style="font-size:13px;font-weight:800;opacity:.95;margin-top:3px">${esc(f.detail)}</div>
      </div>
      <div style="padding:16px;text-align:center;background:#fff">
        ${f.balance != null ? `
        <div style="font-size:12px;color:#5C6975;font-weight:700">Your balance</div>
        <div style="font-size:28px;font-weight:900;color:#1F2A44">${f.balance.toLocaleString('en-US')} HP</div>` : ''}
        ${f.streak && f.streak > 1 ? `<div style="font-size:12px;color:#2E7D4F;font-weight:800;margin-top:3px">🔥 ${f.streak}-day streak — keep it going!</div>` : ''}
        <a href="${APP_URL}/my-day" style="display:inline-block;background:#F0A32A;color:#3a2a08;font-weight:900;font-size:13px;border-radius:999px;padding:10px 26px;text-decoration:none;margin-top:12px">See my day →</a>
      </div>
      <div style="padding:9px 12px;font-size:10px;color:#8A8471;background:#FFFDF7;border-top:1px solid #EFE4CC">
        Sent because your parent switched on Reward emails · parents manage this in Household Setup.
      </div>
    </div>
  </div>`;
}

async function writeKidAlertLog(db: AdminDb, familyId: string, entry: Record<string, unknown>) {
  try {
    await db.collection('families').doc(familyId).collection('alertLog').add(entry);
  } catch { /* logging never blocks the reward */ }
}

/** Send one reward email to a kid IF the parent armed the stream. Silent
 *  no-op on: stream off, no/dangling address pointer, Resend missing. */
export async function sendKidRewardEmail(
  db: AdminDb,
  familyId: string,
  childId: string,
  reward: { emoji: string; headline: string; detail: string },
): Promise<void> {
  try {
    const famData = (await db.collection('families').doc(familyId).get()).data() as
      (FamilyDataSlice & Record<string, unknown>) | undefined;
    const prefs = famData?.kidEmailUpdates?.[childId];
    if (!prefs?.rewards) return;
    const resolved = await resolveKidEmailAddress(db, familyId, childId, famData);
    if (!resolved) return;

    const kid = (await db.collection('families').doc(familyId)
      .collection('children').doc(childId).get()).data() as
      { name?: string; totalPoints?: number; streak?: number } | undefined;
    const facts: KidRewardFacts = {
      kidName: kid?.name || 'you',
      emoji: reward.emoji,
      headline: reward.headline,
      detail: reward.detail,
      ...(kid?.totalPoints != null ? { balance: kid.totalPoints } : {}),
      ...(kid?.streak ? { streak: kid.streak } : {}),
    };
    const subject = `${reward.emoji} ${reward.headline} — ${reward.detail}`.slice(0, 140);

    let sent = false; let error: string | undefined;
    if (!resend) { error = 'resend-not-configured'; }
    else {
      try {
        await resend.emails.send({
          from: RESEND_FROM, to: [resolved.email], subject,
          html: renderKidRewardEmail(facts),
        });
        sent = true;
      } catch (e) { error = e instanceof Error ? e.message : 'send-failed'; }
    }

    await writeKidAlertLog(db, familyId, {
      kind: 'kid_reward',
      childId, childName: kid?.name || 'Kid',
      firedAt: Date.now(),
      trigger: 'reward',
      sourceLabel: resolved.sourceLabel,
      channels: {
        email: {
          on: true, sent,
          ...(error ? { error } : {}),
          to: [{ name: kid?.name || 'Kid', email: resolved.email }],
          subject,
          templateVersion: KID_REWARD_TEMPLATE_VERSION,
          kidFacts: facts,
        },
      },
    });
  } catch { /* never throws into a reward flow */ }
}
