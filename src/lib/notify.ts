// Client-side helpers for the /api/notify endpoint. All calls are
// fire-and-forget — they never throw, so a notification failure can never
// block the user's actual write (rating, award, etc.).
//
// v4-final §04 Step 8 (2026-05-18): added Workplan ad-hoc notify helpers
// that fan out to (1) the in-app bell collection and (2) FCM web-push
// via the new `/api/push` route. The two are independent: the bell
// always writes (Firestore is reliable), push gracefully no-ops if
// admin creds aren't configured in the deployment env.

import { createNotification } from './firestore';

interface RatingNotify {
  to: string[];
  childName: string;
  actorName: string;
  points: number;
  period: 'morning' | 'evening';
}

interface AwardNotify {
  to: string[];
  childName: string;
  actorName: string;
  points: number;
  reason: string;
  isDiamond?: boolean;
}

interface InviteNotify {
  to: string[];
  kidName: string;
  familyName: string;
  inviterName: string;
}

async function post(payload: unknown): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Swallow — notifications are non-critical.
  }
}

export function notifyRating(args: RatingNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({
    type: 'rating',
    to: args.to,
    data: {
      childName: args.childName,
      actorName: args.actorName,
      points: args.points,
      period: args.period,
    },
  });
}

export function notifyAward(args: AwardNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({
    type: 'award',
    to: args.to,
    data: {
      childName: args.childName,
      actorName: args.actorName,
      points: args.points,
      reason: args.reason,
      isDiamond: !!args.isDiamond,
    },
  });
}

export function notifyInvite(args: InviteNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({
    type: 'invite',
    to: args.to,
    data: {
      childName: args.kidName,
      actorName: args.inviterName,
      points: 0,
      familyName: args.familyName,
    },
  });
}

interface BetaInviteNotify {
  to: string[];
  inviteEmail: string;   // the allowlisted address — they must sign up with it
}

/** Beta early-access invite. Unlike the other notify helpers (fire-and-
 *  forget), this awaits and returns the route result so the operator
 *  console can show whether the email actually sent or silently no-op'd
 *  because Resend isn't configured in the deployment env. */
export async function notifyBetaInvite(
  args: BetaInviteNotify,
): Promise<{ sent?: number; skipped?: boolean; error?: string }> {
  if (typeof window === 'undefined' || !args.to.length) return { skipped: true };
  try {
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'beta-invite', to: args.to, data: { inviteEmail: args.inviteEmail } }),
    });
    return await res.json();
  } catch {
    return { error: 'network' };
  }
}

// ── Moments notifications ────────────────────────────────────────

interface MomentReactionNotify {
  to: string[];
  authorName: string;
  reactorName: string;
  emoji: string;
  captionSnippet: string;
  postUrl: string;
}

interface MomentCommentNotify {
  to: string[];
  authorName: string;
  commenterName: string;
  commentSnippet: string;
  postUrl: string;
}

interface MomentMentionNotify {
  to: string[];
  mentionedName: string;
  fromName: string;
  context: 'caption' | 'comment';
  snippet: string;
  postUrl: string;
}

interface MomentNewPostNotify {
  to: string[];
  authorName: string;
  captionSnippet: string;
  photoCount: number;
  postUrl: string;
}

export function notifyMomentReaction(args: MomentReactionNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({ type: 'moment-reaction', to: args.to, data: args });
}

export function notifyMomentComment(args: MomentCommentNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({ type: 'moment-comment', to: args.to, data: args });
}

export function notifyMomentMention(args: MomentMentionNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({ type: 'moment-mention', to: args.to, data: args });
}

export function notifyMomentNewPost(args: MomentNewPostNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({ type: 'moment-new', to: args.to, data: args });
}

// ── Workplan ad-hoc notifications (v4-final §04 Step 8) ──────────
// Fan-out: (1) in-app bell doc on families/{f}/notifications and
// (2) FCM web-push via /api/push. Both are best-effort — the helper's
// next visit to /helper will surface the ad-hoc card via the workplan
// data regardless of whether the notification land.

/** Server-side route entrypoint for FCM push (fire-and-forget). */
async function pushToUid(args: { uid: string; title: string; body: string; url?: string; tag?: string }): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await fetch('/api/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
      keepalive: true,
    });
  } catch {
    // Swallow — push is non-critical; the in-app bell + the next
    // helper-home load both deliver the same information.
  }
}

interface AdhocAssignedNotify {
  familyId: string;
  helperUid: string;        // the assignee
  parentName: string;       // who assigned (display name)
  taskLabel: string;        // e.g. "Buy extra chicken"
  taskIcon: string;         // emoji
  note?: string;            // optional parent note
  scheduledLabel: string;   // human-readable date(s) e.g. "today" / "today + 2 more"
}

/** Notify a helper that they've been assigned a one-off task. Writes
 *  to the in-app bell (always) + fires a web-push to the helper's
 *  registered devices (gracefully no-ops if admin creds aren't set in
 *  the deployment env). Both surfaces deep-link to /helper. */
export async function notifyAdhocAssigned(args: AdhocAssignedNotify): Promise<void> {
  const title = `${args.taskIcon} New work from ${args.parentName}`;
  const bodyBase = `${args.taskLabel} · ${args.scheduledLabel}`;
  const body = args.note ? `${bodyBase} — “${args.note}”` : bodyBase;

  // 1) In-app bell — reliable, always-on.
  try {
    await createNotification(args.familyId, {
      type: 'workplan-adhoc-assigned',
      title,
      message: body,
      read: false,
      forUserId: args.helperUid,
      link: '/helper',
      // createdAt is set by the writer.
    } as Parameters<typeof createNotification>[1]);
  } catch {
    // Swallow — not the end of the world; helper still sees the ad-hoc
    // tile on /helper next visit.
  }

  // 2) FCM web push — best-effort.
  await pushToUid({
    uid: args.helperUid,
    title,
    body,
    url: '/helper',
    tag: 'workplan-adhoc',
  });
}

interface PurchaseSharedNotify {
  familyId: string;
  requestId: string;
  recipientUids: string[];   // family members the sharer picked
  senderName: string;
  /** e.g. "PNT-0057" — the audit serial, for a scannable title. */
  refLabel: string;
  /** "Shopping List" / "Request for Quote" / "Approved Order". */
  kindLabel: string;
  /** which print mode to open (shop | quote | record). */
  mode: 'shop' | 'quote' | 'record';
  note?: string;
}

/** Share an approved purchase's printable form with family members via
 *  Kaya — in-app bell (always) + web push (best-effort). Fire-and-forget;
 *  never throws. Deep-links straight to the print/share view in the
 *  chosen mode so the recipient can print, save, or shop from it. */
export async function notifyPurchaseShared(args: PurchaseSharedNotify): Promise<void> {
  const recipients = Array.from(new Set(args.recipientUids)).filter(Boolean);
  if (recipients.length === 0) return;
  const title = `🧾 ${args.senderName} shared a ${args.kindLabel}`;
  const bodyBase = `${args.refLabel} · tap to print or shop`;
  const body = args.note ? `${bodyBase} — “${args.note}”` : bodyBase;
  const link = `/pantry/purchase/${args.requestId}/print?mode=${args.mode}`;
  for (const uid of recipients) {
    try {
      await createNotification(args.familyId, {
        type: 'purchase-shared',
        title,
        message: body,
        read: false,
        forUserId: uid,
        link,
      } as Parameters<typeof createNotification>[1]);
    } catch { /* swallow — bell is best-effort */ }
    await pushToUid({ uid, title, body, url: link, tag: `purchase-share-${args.requestId}` });
  }
}

interface NewMessageNotify {
  familyId: string;
  threadId: string;
  recipientUids: string[];   // everyone in the thread except the sender
  senderName: string;
  preview: string;           // message text or an attachment label
  isGroup: boolean;
  groupTitle?: string;
}

/** Notify the OTHER members of a chat thread about a new message — in-app bell
 *  (always) + web push (best-effort). Fire-and-forget; never throws. */
export async function notifyNewMessage(args: NewMessageNotify): Promise<void> {
  const recipients = Array.from(new Set(args.recipientUids)).filter(Boolean);
  if (recipients.length === 0) return;
  const heading = args.isGroup ? `${args.senderName} · ${args.groupTitle || 'Family Group'}` : args.senderName;
  const title = `💬 ${heading}`;
  const body = args.preview || 'New message';
  const link = `/messages/${args.threadId}`;
  for (const uid of recipients) {
    try {
      await createNotification(args.familyId, {
        type: 'message',
        title,
        message: body,
        read: false,
        forUserId: uid,
        link,
      } as Parameters<typeof createNotification>[1]);
    } catch { /* swallow — bell is best-effort */ }
    await pushToUid({ uid, title, body, url: link, tag: `msg-${args.threadId}` });
  }
}

// ── Household → Purchase request notifications (2026-05-19) ──────
// Three events fan out across the request lifecycle:
//   1. Helper sends draft for approval  → parents notified
//   2. Parent approves                  → helper (creator) notified
//   3. Helper closes reconcile          → parents notified
//
// Same fan-out shape as workplan-adhoc: in-app bell first (always),
// then best-effort FCM web-push. All notifications deep-link to
// /pantry/purchase/{requestId}.

interface PurchaseApprovalRequestedNotify {
  familyId: string;
  requestId: string;
  requesterName: string;       // helper display name (or 'Parent' if a parent sent it)
  requestName: string;         // request.name (e.g. `PNT-0042 · 180526`)
  estimatedLabel: string;      // formatted total e.g. "TZS 42,500"
  module: string;              // 'pantry' | 'outdoor' | 'drivers' | 'utility' | 'payroll'
  parentUids: string[];        // recipients
}

/** Helper just sent a draft for approval. Parents need to nod. */
export async function notifyPurchaseApprovalRequested(args: PurchaseApprovalRequestedNotify): Promise<void> {
  if (args.parentUids.length === 0) return;
  const moduleEmoji = purchaseModuleEmoji(args.module);
  const title = `${moduleEmoji} Approval needed — ${args.requesterName}`;
  const body = `${args.requestName} · ~${args.estimatedLabel}. Open to approve or reject.`;
  const link = `/pantry/purchase/${args.requestId}`;
  await Promise.all(
    args.parentUids.map(async (uid) => {
      try {
        await createNotification(args.familyId, {
          type: 'purchase-approval-requested',
          title,
          message: body,
          read: false,
          forUserId: uid,
          link,
        } as Parameters<typeof createNotification>[1]);
      } catch { /* swallow */ }
      await pushToUid({ uid, title, body, url: link, tag: `purchase-${args.requestId}-pending` });
    }),
  );
}

interface PurchaseApprovedNotify {
  familyId: string;
  requestId: string;
  creatorUid: string;          // helper who originally sent the request
  approverName: string;        // parent who approved
  requestName: string;
  module: string;
}

/** Parent approved — the original helper / creator should know. */
export async function notifyPurchaseApproved(args: PurchaseApprovedNotify): Promise<void> {
  if (!args.creatorUid) return;
  const moduleEmoji = purchaseModuleEmoji(args.module);
  const title = `✅ ${args.approverName} approved your ${moduleLabel(args.module)} request`;
  const body = `${args.requestName} ${moduleEmoji} — you can go shop now. Reconcile after.`;
  const link = `/pantry/purchase/${args.requestId}`;
  try {
    await createNotification(args.familyId, {
      type: 'purchase-approved',
      title,
      message: body,
      read: false,
      forUserId: args.creatorUid,
      link,
    } as Parameters<typeof createNotification>[1]);
  } catch { /* swallow */ }
  await pushToUid({ uid: args.creatorUid, title, body, url: link, tag: `purchase-${args.requestId}-approved` });
}

interface PurchaseRejectedNotify {
  familyId: string;
  requestId: string;
  creatorUid: string;          // helper who created the request
  rejecterName: string;        // parent who rejected
  requestName: string;
  module: string;
  /** Force-reject = parent course-corrected after approving. Changes
   *  the copy so the helper understands "you might've already started
   *  on this — stop." Normal reject = the request never got approved. */
  variant: 'normal' | 'force';
  /** Optional parent note (free-text reason from the reject dialog). */
  note?: string;
}

/** Parent rejected (or force-rejected) — the original helper must know
 *  before they spend any time / money on the request. */
export async function notifyPurchaseRejected(args: PurchaseRejectedNotify): Promise<void> {
  if (!args.creatorUid) return;
  const link = `/pantry/purchase/${args.requestId}`;
  const moduleEmoji = purchaseModuleEmoji(args.module);
  const title = args.variant === 'force'
    ? `⚠ ${args.rejecterName} cancelled your approved ${moduleLabel(args.module)} request`
    : `↩ ${args.rejecterName} rejected your ${moduleLabel(args.module)} request`;
  const reason = args.note?.trim()
    ? ` — "${args.note.trim()}"`
    : '';
  const body = args.variant === 'force'
    ? `${args.requestName} ${moduleEmoji} — do NOT shop on this. The approval was undone${reason}.`
    : `${args.requestName} ${moduleEmoji}${reason || ' — open to see the parent note.'}`;
  try {
    await createNotification(args.familyId, {
      type: 'purchase-rejected',
      title,
      message: body,
      read: false,
      forUserId: args.creatorUid,
      link,
    } as Parameters<typeof createNotification>[1]);
  } catch { /* swallow */ }
  await pushToUid({ uid: args.creatorUid, title, body, url: link, tag: `purchase-${args.requestId}-rejected` });
}

interface PurchaseReconciledNotify {
  familyId: string;
  requestId: string;
  helperName: string;          // who closed the reconcile
  requestName: string;
  actualLabel: string;         // formatted actual total e.g. "TZS 45,200"
  module: string;
  parentUids: string[];        // recipients (typically all parents in family)
}

/** Helper closed the reconcile — budget just got posted. */
export async function notifyPurchaseReconciled(args: PurchaseReconciledNotify): Promise<void> {
  if (args.parentUids.length === 0) return;
  const moduleEmoji = purchaseModuleEmoji(args.module);
  const title = `${moduleEmoji} Reconciled — ${args.helperName} closed a shop`;
  const body = `${args.requestName} · actual ${args.actualLabel}. Posted to budget.`;
  const link = `/pantry/purchase/${args.requestId}`;
  await Promise.all(
    args.parentUids.map(async (uid) => {
      try {
        await createNotification(args.familyId, {
          type: 'purchase-reconciled',
          title,
          message: body,
          read: false,
          forUserId: uid,
          link,
        } as Parameters<typeof createNotification>[1]);
      } catch { /* swallow */ }
      await pushToUid({ uid, title, body, url: link, tag: `purchase-${args.requestId}-closed` });
    }),
  );
}

// ── Utility top-up reminder (2026-05-20) ───────────────────────────
// Reminder-ONLY nudge to helpers when a regular top-up's reminder day
// arrives — so the helper launches a request. Unlike recurring bills,
// this NEVER auto-creates a request (top-up amounts are variable). In-
// app notification + FCM push to each helper.
interface UtilityTopupReminderNotify {
  familyId: string;
  meterId: string;
  meterLabel: string;
  helperUids: string[];
  estimatedLabel?: string;
}
export async function notifyUtilityTopupDue(args: UtilityTopupReminderNotify): Promise<void> {
  if (args.helperUids.length === 0) return;
  const title = `⚡ Top-up due — ${args.meterLabel}`;
  const body = args.estimatedLabel
    ? `Time to top up ${args.meterLabel} (≈ ${args.estimatedLabel}). Open Utility to launch a request.`
    : `Time to top up ${args.meterLabel}. Open Utility to launch a request.`;
  const link = '/pantry/utility';
  await Promise.all(
    args.helperUids.map(async (uid) => {
      try {
        await createNotification(args.familyId, {
          type: 'utility-topup-reminder',
          title,
          message: body,
          read: false,
          forUserId: uid,
          link,
        } as Parameters<typeof createNotification>[1]);
      } catch { /* swallow */ }
      await pushToUid({ uid, title, body, url: link, tag: `topup-${args.meterId}` });
    }),
  );
}

// ── Utility bill-due email (Utilities v2, 2026-05-20) ──────────────
// Fired by the recurring-bill generator when it auto-creates a payment
// request. Email-only (Resend) — the in-app notification is the request
// itself landing in the parent's approval queue. No-ops if no
// recipients / Resend unconfigured.
interface UtilityBillDueNotify {
  to: string[];
  billName: string;
  amountFormatted: string;
  accountRef?: string;
  dueLabel: string;
  requestUrl: string;
}
export function notifyUtilityBillDue(args: UtilityBillDueNotify): Promise<void> {
  if (!args.to.length) return Promise.resolve();
  return post({
    type: 'utility-bill-due',
    to: args.to,
    data: {
      billName: args.billName,
      amountFormatted: args.amountFormatted,
      accountRef: args.accountRef,
      dueLabel: args.dueLabel,
      requestUrl: args.requestUrl,
    },
  });
}

// Locale-light label helpers — kept here so notify.ts doesn't drag in
// the whole purchase.ts type tree (and so the wording stays in one
// place across in-app + push).
function purchaseModuleEmoji(m: string): string {
  switch (m) {
    case 'pantry':  return '🧾';
    case 'outdoor': return '🌿';
    case 'drivers': return '🚗';
    case 'utility': return '⚡';
    case 'payroll': return '🤝';
    case 'dineOut': return '🍽️';
    case 'home':    return '🛋️';
    default:        return '🧾';
  }
}
function moduleLabel(m: string): string {
  switch (m) {
    case 'pantry':  return 'Pantry';
    case 'outdoor': return 'Outdoor';
    case 'drivers': return 'Drivers';
    case 'utility': return 'Utility';
    case 'payroll': return 'Payroll';
    case 'dineOut': return 'Dine Out';
    case 'home':    return 'Home';
    default:        return 'household';
  }
}
