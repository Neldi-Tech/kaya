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
  | 'moment-reaction'
  | 'moment-comment'
  | 'moment-mention'
  | 'moment-new';

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
