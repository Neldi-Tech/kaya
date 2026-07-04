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
  nthFor, displayTitle, ordinal, anniversaryMilestone,
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

/** Person's name for the greeting band — strips a trailing "'s birthday" /
 *  "birthday" / "anniversary" from the stored title. Null when the title is
 *  just the event word (e.g. auto "Anniversary") → generic copy instead. */
function personFor(event: ReminderEvent): string | null {
  const word = event.type === 'birthday' ? 'birthday' : 'anniversary';
  const p = event.title
    .replace(new RegExp(`['’]s?\\s+${word}\\s*$`, 'i'), '')
    .replace(new RegExp(`\\s*${word}\\s*$`, 'i'), '')
    .trim();
  return p && p.toLowerCase() !== word ? p : null;
}

/** v4 — the single celebratory line above the event card (approved email
 *  template, 04-Jul-2026). Gold on the day, indigo for advance reminders.
 *  Only renders when the Nth is known; otherwise the email is exactly v3. */
function greetingBand(event: ReminderEvent, occurrenceKey: string, lead: number): string {
  const n = nthFor(event, occurrenceKey);
  if (!n) return '';
  const person = personFor(event);
  const weekday = dayOfWeek(occurrenceKey);
  const onDay = lead <= 0;
  let text: string;
  if (event.type === 'birthday') {
    text = onDay
      ? `Happy ${ordinal(n)} Birthday${person ? `, ${esc(person)}` : ''}! 🎂🎈`
      : `${person ? esc(person) : 'Someone special'} turns ${n} on ${esc(weekday)} 🎈 Time to plan!`;
  } else {
    const ms = anniversaryMilestone(event, occurrenceKey);
    text = onDay
      ? `Happy ${ordinal(n)} Anniversary! 💍${ms ? ` ${n} beautiful years ${ms.emoji}✨` : ''}`
      : `${person ? `${esc(person)} celebrate` : 'Celebrating'} ${n} years on ${esc(weekday)} 💍`;
  }
  const tone = onDay
    ? 'background:#F5E9D2;border:1px solid #E8C989;color:#3D2E08;'
    : 'background:#E7EAFA;border:1px solid #C9D0F0;color:#3E4DA0;';
  return `<div style="${tone}border-radius:12px;padding:12px 16px;text-align:center;font-size:15px;font-weight:900;margin-bottom:12px;">${text}</div>`;
}

/** v4 — small hero pill on classic anniversary years (🥈 Silver · 🥇 Golden
 *  · 💎 Diamond…). Empty on non-milestone years so they stay clean. */
function milestonePill(event: ReminderEvent, occurrenceKey: string): string {
  const ms = anniversaryMilestone(event, occurrenceKey);
  if (!ms) return '';
  return `<div style="display:inline-block;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.4);border-radius:999px;padding:4px 14px;font-size:12px;font-weight:900;color:#fff;margin-top:8px;">${ms.emoji} ${esc(ms.label)} Anniversary · ${ms.n} years</div>`;
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

  // v4 — the spoken title ("Daniella's 8th Birthday") flows into the subject,
  // preheader and hero. No originDate → identical to the stored title (v3).
  const spokenTitle = displayTitle(event, occurrenceKey);
  const subjectWhen = lead <= 0 ? 'Today' : lead === 1 ? 'Tomorrow' : `In ${lead} days`;
  const subject = `${meta.icon} ${subjectWhen}: ${spokenTitle}${timeLabel ? `, ${timeLabel}` : ''}`;

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
  <span style="display:none!important;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(when)} — ${esc(spokenTitle)}${timeLabel ? `, ${esc(timeLabel)}` : ''}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FBF6EA;">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="440" style="max-width:440px;background:#fff;border:1px solid #E8DEC9;border-radius:16px;overflow:hidden;">
          <!-- hero -->
          <tr>
            <td style="background:linear-gradient(135deg,${meta.heroFrom} 0%,${meta.heroMid} 70%,${meta.heroTo} 150%);padding:26px 18px 22px;text-align:center;">
              <div style="font-size:11px;font-weight:900;letter-spacing:2px;color:#fff;opacity:.85;">🏠 KAYA · REMINDER</div>
              <div style="font-size:34px;line-height:1;margin-top:10px;">${meta.icon}</div>
              <div style="font-size:20px;font-weight:900;color:#fff;margin-top:8px;">${esc(spokenTitle)}</div>${milestonePill(event, occurrenceKey)}
              <div style="font-size:12.5px;color:#fff;opacity:.92;margin-top:${anniversaryMilestone(event, occurrenceKey) ? '6px' : '4px'};">${esc(when)} · ${esc(whenLine)}</div>
            </td>
          </tr>
          <!-- body -->
          <tr>
            <td style="padding:18px;">
              ${greetingBand(event, occurrenceKey, lead)}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #E8DEC9;border-radius:12px;border-collapse:separate;overflow:hidden;">
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
