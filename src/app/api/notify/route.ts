// Server-side notification dispatcher.
//
// Receives a small payload from the client (event type + recipient emails +
// data needed to render the template), then renders an inline-styled HTML
// email and sends it via Resend.
//
// Safe to ship before Resend is configured: if RESEND_API_KEY is missing the
// route returns a no-op response so the app keeps working.
//
// TODO(security): for v2, verify a Firebase ID token + use the Admin SDK to
// look up recipient emails from the user collection rather than trusting the
// client. For v1 (small private family product), trust the client + cap the
// recipient list at 10.

import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

export const runtime = 'nodejs';

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';

const resend = apiKey ? new Resend(apiKey) : null;

type NotifyType =
  | 'rating'
  | 'award'
  | 'invite'
  | 'beta-invite'
  | 'moment-reaction'
  | 'moment-comment'
  | 'moment-mention'
  | 'moment-new'
  | 'utility-bill-due'
  | 'perf-digest'
  | 'meeting-recap'
  | 'payroll-test'
  | 'payroll-raised'
  | 'mark-paid-due'
  | 'salary-paid';

/** One helper's line in the daily performance digest email. */
interface DigestHelper {
  name: string;
  scorePct: number | null;
  faceEmoji: string;
  faceLabel: string;
  /** One-line summary, e.g. "Workplan 88% · Ratings 12/14 · on budget". */
  line: string;
}

// ── Sunday-Meeting v2 (b6): Meeting Recap Book ────────────────────────
// One-page emailed recap that lands in parents' + family contacts'
// inboxes after a meeting is submitted. The client composes the payload
// from the meeting + family + the active submissions; we render an
// inline-styled HTML "book" with sections for attendance, gratitudes,
// appreciations, points, goals, and closing.

interface RecapAttendee { name: string; emoji: string; isGuest?: boolean }
interface RecapEntry { name: string; emoji: string; lines: string[] }
interface RecapClosing { prayer?: string; story?: string; songUrl?: string; songApprovedBy?: string }
interface MeetingRecapData {
  familyName: string;
  /** Formatted display date (DD-Mmm-YYYY). */
  dateLabel: string;
  /** Leader display name + emoji. Optional if no queued leader. */
  leaderName?: string;
  leaderEmoji?: string;
  attendees: RecapAttendee[];
  gratitudes: RecapEntry[];
  appreciations: RecapEntry[];
  goals: RecapEntry[];
  /** Points-this-week summary. Strings so the server doesn't re-derive. */
  beltChampion?: { name: string; emoji: string; perfectDays: number };
  starSummary?: string;             // e.g. "Diella ×3 · Earlnathan ×2"
  hpThisWeek?: Array<{ name: string; emoji: string; pts: number }>;
  closing?: RecapClosing;
  /** Where "Open in Kaya" should land. */
  openUrl: string;
  /** Caller-controlled toggles — match the family's settings card. */
  includeSong?: boolean;
}

interface NotifyData {
  // Rating / award / invite fields (legacy)
  childName?: string;
  actorName?: string;
  points?: number;
  period?: 'morning' | 'evening';
  reason?: string;
  isDiamond?: boolean;
  houseColor?: string;
  familyName?: string;
  // Beta early-access invite
  inviteEmail?: string;
  // Moments fields
  authorName?: string;
  reactorName?: string;
  commenterName?: string;
  mentionedName?: string;
  fromName?: string;
  emoji?: string;
  captionSnippet?: string;
  commentSnippet?: string;
  snippet?: string;
  context?: 'caption' | 'comment';
  photoCount?: number;
  postUrl?: string;
  // Utility bill-due fields
  billName?: string;
  amountFormatted?: string;
  accountRef?: string;
  dueLabel?: string;
  requestUrl?: string;
  // Performance digest fields
  parentName?: string;
  dateLabel?: string;
  digestHelpers?: DigestHelper[];
  // Meeting recap book (b6)
  recap?: MeetingRecapData;
  // Payroll notifications (2026-06-08)
  monthLabel?: string;
  payWindowLabel?: string;
  totalFormatted?: string;
  salaries?: { name: string; amount: string }[];
}

interface NotifyBody {
  type: NotifyType;
  to: string[];
  data: NotifyData;
}

export async function POST(req: NextRequest) {
  if (!resend) {
    // Resend not configured — return success so the client doesn't error.
    return NextResponse.json({ skipped: true, reason: 'RESEND_API_KEY not set' });
  }

  let body: NotifyBody;
  try {
    body = (await req.json()) as NotifyBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { type, to, data } = body || ({} as NotifyBody);
  if (!type || !Array.isArray(to) || !data) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const recipients = Array.from(new Set(
    to
      .filter((e) => typeof e === 'string')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
  )).slice(0, 10);

  if (recipients.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'No valid recipients' });
  }

  let subject: string;
  let html: string;

  if (type === 'rating') {
    const period = data.period === 'evening' ? 'evening' : 'morning';
    subject = `${data.childName} earned ${data.points} pts this ${period} ⭐`;
    html = renderEmail({
      preheader: `${data.actorName} rated ${data.childName}'s ${period} routine`,
      body: ratingBody({ ...data, period } as RatingRender),
    });
  } else if (type === 'award') {
    const diamond = data.isDiamond ? '💎' : '🎖️';
    subject = `${esc(data.actorName)} awarded ${esc(data.childName)} +${data.points} pts ${diamond}`;
    html = renderEmail({
      preheader: `${data.actorName} awarded bonus points to ${data.childName}`,
      body: awardBody(data as AwardRender),
    });
  } else if (type === 'invite') {
    const familyDisplay = data.familyName || 'Their family';
    subject = `${data.actorName} invited ${data.childName} to Kaya`;
    html = renderEmail({
      preheader: `${data.actorName} from ${familyDisplay} is inviting ${data.childName} to join Kaya`,
      body: inviteBody({ ...data, familyName: familyDisplay } as InviteRender),
    });
  } else if (type === 'beta-invite') {
    const signupEmail = data.inviteEmail || recipients[0];
    subject = `You're invited to Kaya — early access 🎉`;
    html = renderEmail({
      preheader: `You've got early access to Kaya — sign up with ${signupEmail} to create your family.`,
      body: betaInviteBody(signupEmail),
    });
  } else if (type === 'moment-reaction') {
    subject = `${data.reactorName} reacted ${data.emoji} to your moment`;
    html = renderEmail({
      preheader: `${data.reactorName} reacted ${data.emoji} to your photo${data.captionSnippet ? `: "${data.captionSnippet}"` : ''}`,
      body: momentReactionBody(data),
    });
  } else if (type === 'moment-comment') {
    subject = `${data.commenterName} commented on your moment`;
    html = renderEmail({
      preheader: `"${data.commentSnippet || ''}"`,
      body: momentCommentBody(data),
    });
  } else if (type === 'moment-mention') {
    const where = data.context === 'comment' ? 'a comment' : 'a moment';
    subject = `${data.fromName} mentioned you in ${where}`;
    html = renderEmail({
      preheader: data.snippet ? `"${data.snippet}"` : `${data.fromName} mentioned you`,
      body: momentMentionBody(data),
    });
  } else if (type === 'moment-new') {
    const photoLabel = (data.photoCount || 0) === 1 ? '1 photo' : `${data.photoCount} photos`;
    subject = `${data.authorName} shared ${photoLabel} 📸`;
    html = renderEmail({
      preheader: data.captionSnippet || `${data.authorName} posted a new moment`,
      body: momentNewBody(data),
    });
  } else if (type === 'utility-bill-due') {
    subject = `💡 ${data.billName} is due — ${data.amountFormatted}`;
    html = renderEmail({
      preheader: `${data.billName} ${data.dueLabel || 'is due'} — ${data.amountFormatted}. Kaya created the payment request.`,
      body: utilityBillDueBody(data),
    });
  } else if (type === 'perf-digest') {
    const n = data.digestHelpers?.length ?? 0;
    subject = `📊 Daily helper update${data.dateLabel ? ` · ${data.dateLabel}` : ''}`;
    html = renderEmail({
      preheader: n === 0
        ? 'Your daily helper performance summary'
        : `${n} helper${n === 1 ? '' : 's'} · how today went`,
      body: perfDigestBody(data),
    });
  } else if (type === 'meeting-recap') {
    if (!data.recap) {
      return NextResponse.json({ error: 'recap data missing' }, { status: 400 });
    }
    const r = data.recap;
    subject = `📖 ${r.familyName} · meeting recap · ${r.dateLabel}`;
    html = renderEmail({
      preheader: `${r.leaderName ? r.leaderName + ' led · ' : ''}gratitudes, appreciations, goals & this week's points`,
      body: meetingRecapBody(r),
    });
  } else if (type === 'payroll-test') {
    subject = `✅ Kaya payroll email — test`;
    html = renderEmail({
      preheader: 'This confirms Kaya can email this inbox for payroll updates.',
      body: `<p style="margin:0 0 12px">This is a <b>test email</b> from Kaya.</p>
        <p style="margin:0;color:#5C6975">If you received this, payroll reminders will reach this inbox. Manage them in Settings → Notifications.</p>`,
    });
  } else if (type === 'payroll-raised' || type === 'mark-paid-due') {
    const list = (data.salaries ?? [])
      .map((s) => `<tr><td style="padding:3px 0">${esc(s.name)}</td><td style="padding:3px 0;text-align:right;font-weight:700">${esc(s.amount)}</td></tr>`)
      .join('');
    const isRaise = type === 'payroll-raised';
    subject = isRaise
      ? `💰 ${data.monthLabel ?? 'This month'} salaries are ready`
      : `⏰ Time to mark ${data.monthLabel ?? 'this month'} salaries paid`;
    html = renderEmail({
      preheader: isRaise
        ? `Kaya booked ${data.monthLabel ?? 'the month'}'s salaries to budget — total ${data.totalFormatted ?? ''}.`
        : `The pay window is open${data.payWindowLabel ? ` (${data.payWindowLabel})` : ''} — mark salaries paid.`,
      body: `<p style="margin:0 0 10px">${isRaise
          ? `Kaya raised <b>${data.monthLabel ?? "the month"}</b>'s salaries and booked them to budget as <b>Processing</b>:`
          : `The pay window${data.payWindowLabel ? ` (<b>${esc(data.payWindowLabel)}</b>)` : ''} is open. Mark these salaries paid:`}</p>
        <table style="width:100%;border-collapse:collapse;margin:6px 0 12px">${list}</table>
        ${data.totalFormatted ? `<p style="margin:0 0 12px"><b>Total: ${esc(data.totalFormatted)}</b>${data.payWindowLabel ? ` · Pay window ${esc(data.payWindowLabel)}` : ''}</p>` : ''}
        <p style="margin:0"><a href="${APP_URL}/pantry/payroll" style="display:inline-block;background:#F39C2F;color:#231;font-weight:800;border-radius:8px;padding:9px 16px;text-decoration:none">Open Payroll →</a></p>`,
    });
  } else if (type === 'salary-paid') {
    subject = `🧾 Salary marked paid — ${data.monthLabel ?? ''}`.trim();
    html = renderEmail({
      preheader: `A salary was marked paid${data.totalFormatted ? ` (${data.totalFormatted})` : ''}.`,
      body: `<p style="margin:0 0 10px">A salary was marked <b>paid</b>${data.monthLabel ? ` for <b>${esc(data.monthLabel)}</b>` : ''}.</p>
        <table style="width:100%;border-collapse:collapse;margin:6px 0 12px">${(data.salaries ?? []).map((s) => `<tr><td style="padding:3px 0">${esc(s.name)}</td><td style="padding:3px 0;text-align:right;font-weight:700">${esc(s.amount)}</td></tr>`).join('')}</table>
        <p style="margin:0;color:#5C6975">Recorded in the payroll history.</p>`,
    });
  } else {
    return NextResponse.json({ error: 'Unknown notification type' }, { status: 400 });
  }

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: recipients,
      subject,
      html,
    });
    return NextResponse.json({ sent: recipients.length, id: result.data?.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Send failed' }, { status: 500 });
  }
}

// ── Rendering ───────────────────────────────────────────────────

function esc(s: string | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderEmail({ preheader, body }: { preheader: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Kaya</title>
</head>
<body style="margin:0;padding:0;background:#FDFBF7;font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;color:#1A1412;-webkit-font-smoothing:antialiased;">
  <span style="display:none!important;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FDFBF7;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="540" style="max-width:540px;background:#fff;border:1px solid #E8E0D4;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:18px 24px;background:#FDFBF7;border-bottom:1px solid #E8E0D4;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:10px;">
                    <div style="width:32px;height:32px;background:#1E120B;color:#F5E6B8;border-radius:8px;font-weight:bold;font-size:14px;text-align:center;line-height:32px;">K</div>
                  </td>
                  <td style="vertical-align:middle;font-weight:700;font-size:16px;letter-spacing:-0.02em;">Kaya</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px;">${body}</td>
          </tr>
          <tr>
            <td style="padding:16px 24px;background:#FDFBF7;border-top:1px solid #E8E0D4;font-size:12px;color:#9B8A72;text-align:center;">
              <a href="${APP_URL}/dashboard" style="color:#D4A017;text-decoration:none;font-weight:600;">Open dashboard →</a>
              <div style="margin-top:8px;color:#C4B89A;">@ourkaya.app · Made with love, by a family.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Render-time types — each template reads a subset of NotifyData. We
// cast at the call site (the dispatcher above) so each render fn can
// document exactly what fields it expects.
type RatingRender = NotifyData & { period: 'morning' | 'evening' };
type AwardRender = NotifyData;
type InviteRender = NotifyData & { familyName: string };

function ratingBody(d: RatingRender): string {
  const periodLabel = d.period === 'morning' ? 'morning ☀️' : 'evening 🌙';
  return `
    <p style="margin:0 0 16px;font-size:14px;color:#9B8A72;line-height:1.5;">
      <strong style="color:#1A1412;">${esc(d.actorName)}</strong> rated
      <strong style="color:#1A1412;">${esc(d.childName)}</strong>'s ${periodLabel} routine.
    </p>
    <div style="background:linear-gradient(135deg,#1E120B,#3D241A);color:#fff;padding:28px 24px;border-radius:16px;text-align:center;">
      <div style="font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:48px;font-weight:900;line-height:1;">+${esc(String(d.points))}</div>
      <div style="margin-top:6px;font-size:11px;color:#C4B89A;text-transform:uppercase;letter-spacing:0.14em;font-weight:700;">points earned</div>
      <div style="margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,0.1);font-size:14px;color:#F5E6B8;font-weight:600;">${esc(d.childName)} · ${periodLabel} routine</div>
    </div>
    <p style="margin:18px 0 0;font-size:12px;color:#C4B89A;text-align:center;">Open the app to see the breakdown per task.</p>
  `;
}

function inviteBody(d: InviteRender): string {
  return `
    <p style="margin:0 0 16px;font-size:14px;color:#9B8A72;line-height:1.5;">
      Hi <strong style="color:#1A1412;">${esc(d.childName)}</strong> 👋
    </p>
    <p style="margin:0 0 18px;font-size:14px;color:#1A1412;line-height:1.55;">
      <strong>${esc(d.actorName)}</strong> from <strong>${esc(d.familyName)}</strong> is inviting you to join your family on Kaya — where you can see your points, badges, streaks, and rewards.
    </p>
    <div style="background:linear-gradient(135deg,#1E120B,#3D241A);color:#fff;padding:24px;border-radius:16px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;color:#C4B89A;text-transform:uppercase;letter-spacing:0.14em;font-weight:700;">Sign in with this email</p>
      <p style="margin:0;font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;">Open ourkaya.com/login → use email sign-up</p>
    </div>
    <p style="margin:18px 0 0;font-size:12px;color:#9B8A72;line-height:1.55;">
      Once you sign up, your kid profile will be linked automatically — your parent has already set everything up.
    </p>
  `;
}

function betaInviteBody(signupEmail: string): string {
  const signupUrl = `${APP_URL}/signup`;
  return `
    <p style="margin:0 0 8px;font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:18px;font-weight:800;color:#1A1412;">You're in — welcome to Kaya 🎉</p>
    <p style="margin:0 0 18px;font-size:14px;color:#1A1412;line-height:1.55;">
      You've been given early access to <strong>Kaya</strong> — the family operating system for kids' routines, points, rewards, chores and allowances. We'd love you to take it for a spin.
    </p>
    <div style="background:linear-gradient(135deg,#1E120B,#3D241A);color:#fff;padding:24px;border-radius:16px;text-align:center;">
      <p style="margin:0 0 6px;font-size:11px;color:#C4B89A;text-transform:uppercase;letter-spacing:0.14em;font-weight:700;">Sign up with this email</p>
      <p style="margin:0 0 18px;font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#F5E6B8;word-break:break-all;">${esc(signupEmail)}</p>
      <a href="${signupUrl}" style="display:inline-block;background:#D4A017;color:#1A1412;text-decoration:none;font-weight:800;font-size:14px;padding:12px 28px;border-radius:10px;">Create your family →</a>
    </div>
    <p style="margin:18px 0 0;font-size:12px;color:#9B8A72;line-height:1.55;">
      Use <strong>this exact email address</strong> when you sign up — it's how Kaya recognises your early-access invite. See you inside!
    </p>
  `;
}

function awardBody(d: AwardRender): string {
  const isDiamond = !!d.isDiamond;
  const cardBg = isDiamond
    ? 'linear-gradient(135deg,#7C3AED,#5B21B6)'
    : 'linear-gradient(135deg,#1E120B,#3D241A)';
  const accent = isDiamond ? '#E9D5FF' : '#F5E6B8';
  const muted = isDiamond ? '#C4B5FD' : '#C4B89A';
  const label = isDiamond ? 'diamond points' : 'bonus points';
  return `
    <p style="margin:0 0 16px;font-size:14px;color:#9B8A72;line-height:1.5;">
      <strong style="color:#1A1412;">${esc(d.actorName)}</strong> awarded
      <strong style="color:#1A1412;">${esc(d.childName)}</strong> bonus points.
    </p>
    <div style="background:${cardBg};color:#fff;padding:28px 24px;border-radius:16px;text-align:center;">
      <div style="font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:48px;font-weight:900;line-height:1;">+${esc(String(d.points))}${isDiamond ? ' 💎' : ''}</div>
      <div style="margin-top:6px;font-size:11px;color:${muted};text-transform:uppercase;letter-spacing:0.14em;font-weight:700;">${label}</div>
      ${d.reason ? `<div style="margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,0.1);font-size:14px;color:${accent};font-weight:600;font-style:italic;">"${esc(d.reason)}"</div>` : ''}
    </div>
  `;
}

// ── Moments templates ──────────────────────────────────────────────

function momentReactionBody(d: NotifyData): string {
  const openLink = d.postUrl ? `<a href="${esc(d.postUrl)}" style="color:#D4A017;text-decoration:none;font-weight:600;">Open moment →</a>` : '';
  return `
    <p style="margin:0 0 16px;font-size:14px;color:#9B8A72;line-height:1.5;">
      <strong style="color:#1A1412;">${esc(d.reactorName)}</strong> reacted to your moment.
    </p>
    <div style="background:linear-gradient(135deg,#1E120B,#3D241A);color:#fff;padding:28px 24px;border-radius:16px;text-align:center;">
      <div style="font-size:64px;line-height:1;">${esc(d.emoji)}</div>
      ${d.captionSnippet ? `<div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.1);font-size:13px;color:#F5E6B8;font-style:italic;">"${esc(d.captionSnippet)}"</div>` : ''}
    </div>
    ${openLink ? `<p style="margin:18px 0 0;font-size:12px;text-align:center;">${openLink}</p>` : ''}
  `;
}

function momentCommentBody(d: NotifyData): string {
  const openLink = d.postUrl ? `<a href="${esc(d.postUrl)}" style="color:#D4A017;text-decoration:none;font-weight:600;">Open moment →</a>` : '';
  return `
    <p style="margin:0 0 16px;font-size:14px;color:#9B8A72;line-height:1.5;">
      <strong style="color:#1A1412;">${esc(d.commenterName)}</strong> commented on your moment.
    </p>
    <div style="background:#FDFBF7;border:1px solid #E8E0D4;padding:18px 20px;border-radius:12px;font-size:14px;color:#1A1412;line-height:1.55;">
      "${esc(d.commentSnippet || '')}"
    </div>
    ${openLink ? `<p style="margin:18px 0 0;font-size:12px;text-align:center;">${openLink}</p>` : ''}
  `;
}

function momentMentionBody(d: NotifyData): string {
  const where = d.context === 'comment' ? 'a comment' : 'a caption';
  const openLink = d.postUrl ? `<a href="${esc(d.postUrl)}" style="color:#D4A017;text-decoration:none;font-weight:600;">Open moment →</a>` : '';
  return `
    <p style="margin:0 0 16px;font-size:14px;color:#9B8A72;line-height:1.5;">
      <strong style="color:#1A1412;">${esc(d.fromName)}</strong> mentioned
      <strong style="color:#1A1412;">${esc(d.mentionedName)}</strong> in ${where}.
    </p>
    ${d.snippet ? `<div style="background:#FDFBF7;border:1px solid #E8E0D4;padding:18px 20px;border-radius:12px;font-size:14px;color:#1A1412;line-height:1.55;">"${esc(d.snippet)}"</div>` : ''}
    ${openLink ? `<p style="margin:18px 0 0;font-size:12px;text-align:center;">${openLink}</p>` : ''}
  `;
}

function momentNewBody(d: NotifyData): string {
  const count = d.photoCount || 0;
  const photoLabel = count === 1 ? '1 photo' : `${count} photos`;
  const openLink = d.postUrl ? `<a href="${esc(d.postUrl)}" style="color:#D4A017;text-decoration:none;font-weight:600;">View on the feed →</a>` : '';
  return `
    <p style="margin:0 0 16px;font-size:14px;color:#9B8A72;line-height:1.5;">
      <strong style="color:#1A1412;">${esc(d.authorName)}</strong> shared a new moment.
    </p>
    <div style="background:linear-gradient(135deg,#1E120B,#3D241A);color:#fff;padding:24px;border-radius:16px;text-align:center;">
      <div style="font-size:11px;color:#C4B89A;text-transform:uppercase;letter-spacing:0.14em;font-weight:700;">${esc(photoLabel)}</div>
      ${d.captionSnippet ? `<div style="margin-top:14px;font-size:14px;color:#F5E6B8;font-style:italic;line-height:1.55;">"${esc(d.captionSnippet)}"</div>` : ''}
    </div>
    ${openLink ? `<p style="margin:18px 0 0;font-size:12px;text-align:center;">${openLink}</p>` : ''}
  `;
}

function perfDigestBody(d: NotifyData): string {
  const helpers = d.digestHelpers ?? [];
  const greeting = d.parentName ? `Hi ${esc(d.parentName)} 👋` : 'Hi 👋';
  if (helpers.length === 0) {
    return `
      <p style="margin:0 0 16px;font-size:14px;color:#9B8A72;line-height:1.5;">${greeting}</p>
      <p style="margin:0;font-size:14px;color:#1A1412;line-height:1.55;">No active helpers to report on yet. Add a helper in Settings → Helpers and you'll see their daily summary here.</p>
    `;
  }
  const rows = helpers.map((h) => {
    const scoreColor = h.scorePct === null ? '#9B8A72'
      : h.scorePct >= 70 ? '#3FAF6C'
      : h.scorePct >= 50 ? '#D4A017' : '#E36F6F';
    const scoreText = h.scorePct === null ? '—' : `${h.scorePct}%`;
    return `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #F0EAE0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="vertical-align:middle;font-size:24px;width:34px;">${esc(h.faceEmoji)}</td>
              <td style="vertical-align:middle;">
                <div style="font-size:14px;font-weight:700;color:#1A1412;">${esc(h.name)}</div>
                <div style="font-size:12px;color:#9B8A72;margin-top:2px;">${esc(h.line)}</div>
              </td>
              <td style="vertical-align:middle;text-align:right;white-space:nowrap;">
                <div style="font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:22px;font-weight:900;color:${scoreColor};line-height:1;">${esc(scoreText)}</div>
                <div style="font-size:10px;color:#C4B89A;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-top:2px;">${esc(h.faceLabel)}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');
  return `
    <p style="margin:0 0 6px;font-size:14px;color:#9B8A72;line-height:1.5;">${greeting}</p>
    <p style="margin:0 0 18px;font-size:14px;color:#1A1412;line-height:1.55;">
      Here's how your ${helpers.length === 1 ? 'helper' : 'team'} did${d.dateLabel ? ` over the last few days (as of ${esc(d.dateLabel)})` : ''}.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
    <p style="margin:18px 0 0;font-size:12px;color:#C4B89A;text-align:center;">
      Scores cover settled days (today in progress is excluded). Manage this email in Settings → Notifications.
    </p>
  `;
}

function utilityBillDueBody(d: NotifyData): string {
  const openLink = d.requestUrl
    ? `<a href="${esc(d.requestUrl)}" style="display:inline-block;background:#3FAF6C;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:11px 22px;border-radius:10px;">Open the payment request →</a>`
    : '';
  return `
    <p style="margin:0 0 16px;font-size:14px;color:#9B8A72;line-height:1.5;">
      Your recurring bill <strong style="color:#1A1412;">${esc(d.billName)}</strong> ${esc(d.dueLabel || 'is due')}.
      Kaya created the payment request — approve it in the app, then pay.
    </p>
    <div style="background:linear-gradient(135deg,#FFF3D9,#FCD9A0);padding:28px 24px;border-radius:16px;text-align:center;">
      <div style="font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:42px;font-weight:900;line-height:1;color:#1A1412;">${esc(d.amountFormatted)}</div>
      <div style="margin-top:6px;font-size:11px;color:#D17F1A;text-transform:uppercase;letter-spacing:0.14em;font-weight:700;">due${d.accountRef ? ` · a/c ${esc(d.accountRef)}` : ''}</div>
    </div>
    ${openLink ? `<p style="margin:20px 0 0;text-align:center;">${openLink}</p>` : ''}
    <p style="margin:16px 0 0;font-size:11px;color:#C4B89A;text-align:center;">Sent to parents · you'll get one per bill, per due date.</p>
  `;
}

// ── Meeting Recap Book renderer (Sunday-Meeting v2 · b6) ─────────────
// A one-page "book" emailed to parents + family contacts after the
// meeting submits. Inline styles only — most clients still strip <style>
// blocks. Layout matches the v2 design mockup (cover, attendance,
// gratitudes, appreciations, points/belt/stars/HP, goals, closing,
// footer "From your Kaya family ❤️"). Moments thumbnails + PDF
// attachment are deferred to a follow-up.

function recapSection(title: string, kicker: string, body: string, opts?: { tint?: 'cream' | 'lilac' | 'amber' }): string {
  const tint = opts?.tint || 'cream';
  const bg = tint === 'lilac' ? '#FAF5FF'
    : tint === 'amber' ? '#FFF7E5'
    : '#FDFBF7';
  const border = tint === 'lilac' ? '#9B5DE5'
    : tint === 'amber' ? '#D4A017'
    : '#E8E0D4';
  return `
    <div style="margin:0 0 14px 0;background:${bg};border:1px solid ${border}55;border-radius:12px;padding:12px 14px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800;color:${border};margin-bottom:6px;">${esc(kicker)}</div>
      <div style="font-size:12.5px;color:#3D241A;line-height:1.55;">
        ${body}
      </div>
      ${title ? '' : ''}
    </div>
  `;
}

function meetingRecapBody(r: MeetingRecapData): string {
  const attendance = r.attendees.length === 0 ? ''
    : recapSection('attendance', 'Who was there',
        r.attendees.map((a) =>
          `<span style="white-space:nowrap;">${esc(a.emoji)} ${esc(a.name)}${a.isGuest ? ' <span style="color:#9B8A72;">(guest)</span>' : ''}</span>`
        ).join(' &nbsp;·&nbsp; '),
      );

  const gratitudes = r.gratitudes.length === 0 ? ''
    : recapSection('gratitudes', '🙏 Gratitudes',
        r.gratitudes.map((e) =>
          e.lines.map((line) =>
            `<div style="font-style:italic;">&ldquo;${esc(line)}&rdquo; <span style="color:#9B8A72;font-style:normal;font-weight:600;">— ${esc(e.name)}</span></div>`
          ).join(''),
        ).join(''),
      );

  const appreciations = r.appreciations.length === 0 ? ''
    : recapSection('appreciations', '💛 Appreciations',
        r.appreciations.map((e) =>
          e.lines.map((line) =>
            `<div><b>${esc(e.name)}</b> → ${esc(line)}</div>`
          ).join(''),
        ).join(''),
        { tint: 'lilac' },
      );

  const pointsBits: string[] = [];
  if (r.beltChampion && r.beltChampion.perfectDays > 0) {
    pointsBits.push(`🏆 <b>Belt Champion</b> — ${esc(r.beltChampion.emoji)} <b>${esc(r.beltChampion.name)}</b> · ${r.beltChampion.perfectDays} perfect day${r.beltChampion.perfectDays === 1 ? '' : 's'}`);
  }
  if (r.starSummary) {
    pointsBits.push(`⭐ <b>Stars of the Day</b> — ${esc(r.starSummary)}`);
  }
  if (r.hpThisWeek && r.hpThisWeek.length > 0) {
    pointsBits.push(`📈 <b>House Points earned</b> — ${r.hpThisWeek.map((h) => `${esc(h.emoji)} ${esc(h.name)} ${h.pts} HP`).join(' · ')}`);
  }
  const points = pointsBits.length === 0 ? ''
    : recapSection('points', '📊 Points this week', pointsBits.join('<br>'));

  const goals = r.goals.length === 0 ? ''
    : recapSection('goals', '🎯 Goals for the week',
        r.goals.map((e) =>
          e.lines.map((line) =>
            `<div>${esc(e.emoji)} <b>${esc(e.name)}</b> — ${esc(line)}</div>`
          ).join(''),
        ).join(''),
      );

  const closingBits: string[] = [];
  if (r.closing?.prayer) closingBits.push(`Prayer: <span style="font-style:italic;">${esc(r.closing.prayer.slice(0, 140))}${r.closing.prayer.length > 140 ? '…' : ''}</span>`);
  if (r.closing?.story) closingBits.push(`Story: <span style="font-style:italic;">${esc(r.closing.story.slice(0, 140))}${r.closing.story.length > 140 ? '…' : ''}</span>`);
  if (r.closing?.songUrl && r.includeSong !== false) {
    closingBits.push(`🎵 Closing song — <a href="${esc(r.closing.songUrl)}" style="color:#B8860B;font-weight:700;">▶ Open in new tab</a>${r.closing.songApprovedBy ? ' <span style="color:#3FAF6C;font-weight:700;">· parent OK ✓</span>' : ''}`);
  }
  const closing = closingBits.length === 0 ? ''
    : recapSection('closing', '🌙 Closing', closingBits.join('<br>'), { tint: 'amber' });

  return `
    <!-- cover -->
    <div style="text-align:center;border-bottom:2px solid #D4A017;padding-bottom:14px;margin-bottom:14px;">
      <div style="font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:10px;text-transform:uppercase;letter-spacing:3px;font-weight:800;color:#B8860B;">Family Meeting · Recap</div>
      <div style="font-family:'Outfit',Helvetica,Arial,sans-serif;font-size:22px;font-weight:900;color:#1E120B;margin-top:4px;">${esc(r.familyName)}</div>
      <div style="font-size:12px;color:#9B8A72;margin-top:2px;">
        ${esc(r.dateLabel)}${r.leaderName ? ` · led by ${esc(r.leaderEmoji || '')} ${esc(r.leaderName)} ✨` : ''}
      </div>
    </div>
    ${attendance}
    ${gratitudes}
    ${appreciations}
    ${points}
    ${goals}
    ${closing}
    <div style="text-align:center;font-size:11px;color:#9B8A72;margin-top:18px;border-top:1px solid #E8E0D4;padding-top:10px;">
      From your <b>Kaya</b> family ❤️ &nbsp;·&nbsp; <a href="${esc(r.openUrl)}" style="color:#B8860B;font-weight:700;text-decoration:none;">Open in Kaya →</a>
    </div>
  `;
}
