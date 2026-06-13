// Pure renderer for the Reminders email — the Kaya-branded reminder that
// lands in the inbox (approved v3 FINAL mock, 2026-06-13): a navy→indigo→
// gold hero (themed per event type — birthday confetti, anniversary
// elegant), an event card (When / With / Where / Note), a gold "Open in
// Kaya →" CTA, and a "why you're getting this" footer.
//
// No deps beyond the pure reminders lib + date helpers, so the firing cron
// (server, Admin SDK) can call it directly and pass the result to Resend.

import {
  type ReminderEvent, type ReminderTypeMeta, typeMeta, formatTime,
} from './reminders';
import { toDisplayDate, dayOfWeek } from './dates';

function esc(s: string | undefined | null): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Lead → human "When" framing for the subject + hero subtitle. */
function leadPhrase(lead: number): string {
  if (lead <= 0) return 'Today';
  if (lead === 1) return 'Tomorrow';
  if (lead === 7) return 'In a week';
  return `In ${lead} days`;
}

export interface RenderReminderArgs {
  event: ReminderEvent;
  /** YYYY-MM-DD the event occurs on. */
  occurrenceKey: string;
  /** Days before the occurrence this reminder is for (0 = on the day). */
  lead: number;
  /** Where "Open in Kaya" lands (defaults to the reminders page). */
  appUrl: string;
}

export function renderReminderEmail(args: RenderReminderArgs): { subject: string; html: string } {
  const { event, occurrenceKey, lead, appUrl } = args;
  const meta = typeMeta(event.type);
  const when = leadPhrase(lead);
  const timeLabel = formatTime(event.time);
  const dayLabel = dayOfWeek(occurrenceKey);
  const dateLabel = toDisplayDate(occurrenceKey);
  const whenLine = `${dayLabel} ${dateLabel}${timeLabel ? ` · ${timeLabel}` : ''}`;

  const subjectWhen = lead <= 0 ? 'Today' : lead === 1 ? 'Tomorrow' : `In ${lead} days`;
  const subject = `${meta.icon} ${subjectWhen}: ${event.title}${timeLabel ? `, ${timeLabel}` : ''}`;

  const rows: Array<[string, string]> = [['When', whenLine]];
  if (event.withWho) rows.push(['With', event.withWho]);
  if (event.location) rows.push(['Where', event.location]);
  if (event.note) rows.push(['Note', event.note]);

  const cardRows = rows.map(([k, v], i) => `
    <tr>
      <td style="padding:11px 16px;border-bottom:${i === rows.length - 1 ? 'none' : '1px solid #E8DEC9'};font-size:13px;color:#5C6975;font-weight:700;">${esc(k)}</td>
      <td style="padding:11px 16px;border-bottom:${i === rows.length - 1 ? 'none' : '1px solid #E8DEC9'};font-size:13px;color:#1F2D3D;font-weight:800;text-align:right;">${esc(v)}</td>
    </tr>`).join('');

  const ctaUrl = `${appUrl}/reminders`;
  const visLabel = event.visibility === 'shared' ? 'shared family' : 'private';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Kaya Reminder</title>
</head>
<body style="margin:0;padding:0;background:#FBF6EA;font-family:'Nunito',Helvetica,Arial,sans-serif;color:#1F2D3D;-webkit-font-smoothing:antialiased;">
  <span style="display:none!important;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(when)} — ${esc(event.title)}${timeLabel ? `, ${esc(timeLabel)}` : ''}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FBF6EA;">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="440" style="max-width:440px;background:#fff;border:1px solid #E8DEC9;border-radius:16px;overflow:hidden;">
          <!-- hero -->
          <tr>
            <td style="background:linear-gradient(135deg,${meta.heroFrom} 0%,${meta.heroMid} 70%,${meta.heroTo} 150%);padding:26px 18px 22px;text-align:center;">
              <div style="font-size:11px;font-weight:900;letter-spacing:2px;color:#fff;opacity:.85;">🏠 KAYA · REMINDER</div>
              <div style="font-size:34px;line-height:1;margin-top:10px;">${meta.icon}</div>
              <div style="font-size:20px;font-weight:900;color:#fff;margin-top:8px;">${esc(event.title)}</div>
              <div style="font-size:12.5px;color:#fff;opacity:.92;margin-top:4px;">${esc(when)} · ${esc(whenLine)}</div>
            </td>
          </tr>
          <!-- body -->
          <tr>
            <td style="padding:18px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #E8DEC9;border-radius:12px;border-collapse:separate;overflow:hidden;">
                ${cardRows}
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr><td align="center" style="padding-top:16px;">
                  <a href="${esc(ctaUrl)}" style="display:inline-block;background:#D4A847;color:#3D2E08;font-weight:900;font-size:14px;border-radius:999px;padding:12px 34px;text-decoration:none;">Open in Kaya →</a>
                </td></tr>
              </table>
            </td>
          </tr>
          <!-- footer -->
          <tr>
            <td style="padding:14px 18px;border-top:1px solid #E8DEC9;text-align:center;font-size:11px;color:#5C6975;line-height:1.5;">
              You're getting this because it's a <b style="color:#1F2D3D;">${esc(visLabel)}</b> reminder in Kaya.<br>
              Manage who's notified in Reminders · <b style="color:#1F2D3D;">ourkaya.com</b>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

export type { ReminderTypeMeta };
