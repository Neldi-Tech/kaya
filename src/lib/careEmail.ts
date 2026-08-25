// 💊 v5 — pure renderers for the Care watch-rail emails (approved design +
// Elia's refinement 25-Aug-2026: subjects carry the FULL context — kid,
// dose state, day-N — so parents triage from the inbox list without
// opening; attractive, never noisy). Three emails only:
//   · evening summary  💊 All 3 given ✅ — Earlnathan, day 2 of 7
//   · missed instant   🚨 Earlnathan's ☀️ 13:00 dose — not given yet
//   · course complete  🏁 Course complete! Earlnathan finished all 7 days 🛡
// Dependency-free beyond the pure reminders lib so the cron calls directly.

import {
  type ReminderEvent, type DoseEntry, doseKeyFor, careDayNumber, careTotalDays,
  slotIcon, formatTime,
} from './reminders';

function esc(s: string | undefined | null): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const HERO = 'linear-gradient(135deg,#1F2D3D 0%,#2E8C7E 70%,#D4A847 150%)';

function entryFor(ev: ReminderEvent, dateKey: string, i: number): DoseEntry | undefined {
  return (ev.doseLog || []).find((d) => d.key === doseKeyFor(dateKey, i));
}

function tickedTime(e?: DoseEntry): string {
  if (!e?.at) return '';
  const d = new Date(e.at);
  return formatTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
}

function kidName(ev: ReminderEvent): string {
  return ev.care?.forName || ev.title;
}

function dayPhrase(ev: ReminderEvent, dateKey: string): string {
  const n = careDayNumber(ev, dateKey);
  const t = careTotalDays(ev);
  return n ? `day ${n}${t ? ` of ${t}` : ''}` : 'today';
}

function shell(heroTop: string, heroBig: string, bodyHtml: string, appUrl: string, footNote: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kaya Care</title></head>
<body style="margin:0;padding:0;background:#FBF6EA;font-family:'Nunito',Helvetica,Arial,sans-serif;color:#1F2D3D;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FBF6EA;">
    <tr><td align="center" style="padding:28px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="440" style="max-width:440px;background:#fff;border:1px solid #E8DEC9;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:${HERO};padding:24px 18px 20px;text-align:center;">
            <div style="font-size:11px;font-weight:900;letter-spacing:2px;color:#fff;opacity:.85;">🏠 KAYA · CARE</div>
            <div style="font-size:12.5px;color:#fff;opacity:.92;margin-top:8px;">${heroTop}</div>
            <div style="font-size:19px;font-weight:900;color:#fff;margin-top:6px;">${heroBig}</div>
          </td>
        </tr>
        <tr><td style="padding:18px;">${bodyHtml}
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr><td align="center" style="padding-top:16px;">
              <a href="${esc(appUrl)}/reminders" style="display:inline-block;background:#D4A847;color:#3D2E08;font-weight:900;font-size:14px;border-radius:999px;padding:12px 34px;text-decoration:none;">Open in Kaya →</a>
            </td></tr>
          </table>
        </td></tr>
        <tr>
          <td style="padding:14px 18px;border-top:1px solid #E8DEC9;text-align:center;font-size:11px;color:#5C6975;line-height:1.5;">
            ${footNote}<br>Always follow your doctor’s instructions · <b style="color:#1F2D3D;">ourkaya.com</b>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function slotLines(ev: ReminderEvent, dateKey: string): string {
  const care = ev.care!;
  const rows = care.slots.map((s, i) => {
    const e = entryFor(ev, dateKey, i);
    const icon = s.icon || slotIcon(s.time);
    const label = e?.status === 'given' ? `✓ ${tickedTime(e)}${e.byName ? ` · ${esc(e.byName)}` : ''}`
      : e?.status === 'late' ? `✓ late ${tickedTime(e)}${e.byName ? ` · ${esc(e.byName)}` : ''}`
      : e?.status === 'skipped' ? '⏭ skipped'
      : e?.status === 'missed' ? '✕ missed'
      : '⏳ pending';
    const color = e?.status === 'given' || e?.status === 'late' ? '#3E8E5A'
      : e?.status === 'missed' ? '#C0392B' : '#5C6975';
    return `<tr>
      <td style="padding:9px 14px;border-bottom:1px solid #F1EBDD;font-size:13px;color:#5C6975;font-weight:700;">${icon} ${esc(s.time)}</td>
      <td style="padding:9px 14px;border-bottom:1px solid #F1EBDD;font-size:13px;font-weight:800;text-align:right;color:${color};">${label}</td>
    </tr>`;
  }).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #E8DEC9;border-radius:12px;border-collapse:separate;overflow:hidden;">${rows}</table>`;
}

/** Evening summary — one email, the whole day at a glance. */
export function renderCareSummaryEmail(args: { event: ReminderEvent; dateKey: string; appUrl: string }): { subject: string; html: string } {
  const { event: ev, dateKey, appUrl } = args;
  const care = ev.care!;
  const kid = kidName(ev);
  const day = dayPhrase(ev, dateKey);
  const total = care.slots.length;
  const given = care.slots.filter((_, i) => {
    const s = entryFor(ev, dateKey, i)?.status;
    return s === 'given' || s === 'late';
  }).length;
  const missedSlots = care.slots
    .map((s, i) => ({ s, i, st: entryFor(ev, dateKey, i)?.status }))
    .filter((x) => x.st === 'missed');
  const icon = ev.type === 'medicine' ? '💊' : '🔁';
  const subject = given === total
    ? `${icon} All ${total} given ✅ — ${kid}, ${day}`
    : missedSlots.length
      ? `${icon} ${given} of ${total} given — ${kid} missed ${missedSlots.map((m) => `${m.s.icon || slotIcon(m.s.time)} ${m.s.time}`).join(' + ')} (${day})`
      : `${icon} ${given} of ${total} given so far — ${kid}, ${day}`;
  const heroBig = given === total ? `All ${total} given today ✅` : `${given} of ${total} given`;
  const body = `<div style="font-size:13.5px;font-weight:800;margin-bottom:10px;">${esc(ev.title)} · ${esc(care.dose)}${care.withFood ? ' · with food 🍽' : ''}</div>${slotLines(ev, dateKey)}`;
  return {
    subject,
    html: shell(`${esc(kid)} · ${esc(day)}`, heroBig, body, appUrl, 'Your evening care summary — one email a day, only while a schedule is active.'),
  };
}

/** Missed-dose instant — only when the ladder tops out (+90 min). */
export function renderCareMissedEmail(args: { event: ReminderEvent; dateKey: string; slotIndex: number; appUrl: string }): { subject: string; html: string } {
  const { event: ev, dateKey, slotIndex, appUrl } = args;
  const care = ev.care!;
  const kid = kidName(ev);
  const slot = care.slots[slotIndex];
  const icon = slot.icon || slotIcon(slot.time);
  const subject = `🚨 ${kid}'s ${icon} ${slot.time} dose — not given yet`;
  const body = `<div style="background:#FBE9E7;border:1px solid #F0C6BF;border-radius:12px;padding:12px 16px;text-align:center;font-size:14px;font-weight:900;color:#C0392B;margin-bottom:12px;">The ${icon} ${esc(slot.time)} dose wasn’t ticked within 90 minutes.</div>
  <div style="font-size:13px;color:#5C6975;text-align:center;">${esc(ev.title)} · ${esc(care.dose)} · ${esc(dayPhrase(ev, dateKey))}.<br>It’s recorded as <b>missed</b> — a late ✓ from the giver will correct it honestly.</div>`;
  return {
    subject,
    html: shell(`${esc(kid)} · ${esc(dayPhrase(ev, dateKey))}`, 'A dose needs attention', body, appUrl, 'You get this only when a dose stays unticked after three reminders.'),
  };
}

/** Course complete — the 🏁 celebration. */
export function renderCareCompleteEmail(args: { event: ReminderEvent; dateKey: string; appUrl: string }): { subject: string; html: string } {
  const { event: ev, dateKey, appUrl } = args;
  const kid = kidName(ev);
  const total = careTotalDays(ev);
  const subject = `🏁 Course complete! ${kid} finished all ${total ?? ''} days 🛡`;
  const body = `<div style="background:#F5E9D2;border:1px solid #E8C989;border-radius:12px;padding:14px 16px;text-align:center;font-size:15px;font-weight:900;color:#3D2E08;margin-bottom:12px;">🏁 ${esc(kid)} finished the whole course! 🎉</div>
  <div style="font-size:13px;color:#5C6975;text-align:center;">${esc(ev.title)} · ${total ? `${total} days` : 'course'} done${dateKey ? ` · ${esc(dateKey)}` : ''}.<br>The 🛡 <b>Course Champion</b> badge is on its way — and the full trail is in Reminders.</div>`;
  return {
    subject,
    html: shell(`${esc(kid)}`, 'Course complete 🏁', body, appUrl, 'A course email arrives once — when the last day is done.'),
  };
}
