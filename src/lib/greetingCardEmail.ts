// ✉️ Greeting-card email (Reminders 2.0, approved Card Designs v2 §6).
// PURE renderer — the cron + the "Email now" action both call it. Table-
// based, inline styles, no remote assets except the optional card PNG the
// client uploaded. Hero carries the one-liner; body carries the card, the
// message, the co-sign lines, the signature; footer = Kaya signature +
// "About Kaya · join the waitlist" + "Stop these greetings" (R13).

import {
  cardHeadline, defaultMessage, defaultOneLiner, themePalette, typeEmoji, shortName, splitMessage,
  type GreetingCard,
} from './greetingCards';
import { toDisplayDate } from './dates';

export const GREETING_CARD_TEMPLATE_VERSION = 1;

function esc(s: string | undefined | null): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface RenderCardEmailArgs {
  card: GreetingCard;
  /** "Timotheo" — used in From/footer copy. */
  familyName: string;
  appUrl: string;
  /** Public no-login card page (null = no link yet). */
  publicUrl: string | null;
  /** Opt-out link for this contact (external honorees only). */
  stopUrl?: string | null;
  /** Belated variant copy. */
  belated?: boolean;
}

export function renderGreetingCardEmail(a: RenderCardEmailArgs): { subject: string; html: string; text: string } {
  const { card } = a;
  const lang = card.lang || 'en';
  const sw = lang === 'sw';
  const pal = themePalette(card.theme);
  const headline = cardHeadline(card.type, card.nth, lang, card.eventTitle);
  const first = shortName(card.honoree.name) || card.honoree.name;
  const oneLiner = card.oneLiner || defaultOneLiner(card);
  const message = card.message || defaultMessage(card, card.signatureLine);
  const { greeting, body } = splitMessage(message, card.signatureLine);
  const dateLabel = toDisplayDate(card.dateKey);
  const sig = card.signatureLine;
  const subject = a.belated
    ? (sw ? `${typeEmoji(card.type)} ${headline} (kwa kuchelewa kidogo), ${first} — kadi kutoka ${sig}` : `${typeEmoji(card.type)} Belated ${headline.toLowerCase()}, ${first} — a card from ${sig}`)
    : (sw ? `${typeEmoji(card.type)} ${headline}, ${first} — kadi kutoka ${sig}` : `${typeEmoji(card.type)} ${headline}, ${first} — a card from ${sig}`);

  const heroBg = `linear-gradient(135deg,#1F2D3D 0%,${pal.accent} 70%,#F39C2F 150%)`;
  const linesHtml = (card.lines || []).slice(0, 8).map((l) => `
    <tr><td style="padding:6px 0;border-bottom:1px dashed #EDE6D6;">
      <div style="font-size:11.5px;font-weight:800;color:#5C6975;">${esc(l.name)}</div>
      <div style="font-size:14px;${l.kid ? 'font-style:italic;font-weight:700;color:#6b4a1a;' : 'color:#3D241A;'}">${esc(l.text)}</div>
    </td></tr>`).join('');

  const cardBlock = card.imageUrl
    ? `<img src="${esc(card.imageUrl)}" alt="${esc(headline)} — ${esc(card.honoree.name)}" width="340" style="display:block;width:340px;max-width:100%;border-radius:16px;margin:0 auto 16px;box-shadow:0 14px 30px -16px rgba(0,0,0,.4);" />`
    : `<div style="max-width:340px;margin:0 auto 16px;border-radius:16px;background:${pal.bg};border:2px solid ${pal.frame};padding:26px 18px;text-align:center;">
         <div style="font-size:46px;line-height:1;">${typeEmoji(card.type)}</div>
         <div style="font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:22px;font-weight:900;color:${pal.dark ? pal.ink : pal.accent};margin-top:8px;">${esc(headline)}</div>
         <div style="font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:15px;font-weight:800;color:${pal.ink};margin-top:4px;">${esc(card.honoree.name)}</div>
         <div style="font-family:'Nunito',Helvetica,Arial,sans-serif;font-size:13.5px;font-style:italic;font-weight:700;color:${pal.ink};opacity:.9;margin-top:10px;">“${esc(oneLiner)}”</div>
         <div style="display:flex;justify-content:space-between;font-size:11px;color:${pal.ink};opacity:.85;margin-top:18px;"><span style="font-style:italic;font-weight:700;">${esc(sig)}</span><span style="font-weight:900;letter-spacing:.08em;">${sw ? 'kupitia KAYA' : 'via KAYA'}</span></div>
       </div>`;

  const openLabel = sw ? 'Fungua kadi 💌' : 'Open the card 💌';
  const thanksLabel = sw ? 'Tuma shukrani 🙏' : 'Send a thank-you 🙏';
  const buttons = a.publicUrl
    ? `<div style="text-align:center;margin-top:6px;">
         <a href="${esc(a.publicUrl)}" style="display:inline-block;background:#5B6CC8;color:#fff;font-family:'Nunito',Helvetica,Arial,sans-serif;font-weight:900;border-radius:10px;padding:11px 18px;font-size:13px;text-decoration:none;margin:4px;">${openLabel}</a>
         <a href="${esc(a.publicUrl)}#thanks" style="display:inline-block;background:#fff;color:#3E4DA0;border:2px solid #E7EAFA;font-family:'Nunito',Helvetica,Arial,sans-serif;font-weight:900;border-radius:10px;padding:9px 16px;font-size:13px;text-decoration:none;margin:4px;">${thanksLabel}</a>
       </div>` : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#FBF6EA;font-family:'Nunito',Helvetica,Arial,sans-serif;color:#1F2D3D;">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${esc(oneLiner)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6EA;padding:22px 10px;"><tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border:1px solid #E8DEC9;border-radius:16px;overflow:hidden;">
  <tr><td style="background:${heroBg};color:#fff;padding:24px 22px;text-align:center;">
    <div style="font-size:11px;font-weight:900;letter-spacing:.12em;opacity:.9;">KAYA · ${sw ? 'KADI KWA AJILI YAKO' : 'A CARD FOR YOU'}</div>
    <div style="font-size:23px;font-weight:900;margin:6px 0 2px;">${esc(headline)}, ${esc(first)} ${typeEmoji(card.type)}</div>
    <div style="font-size:14px;font-style:italic;font-weight:700;opacity:.95;">“${esc(oneLiner)}”</div>
    <div style="font-size:12.5px;opacity:.9;margin-top:6px;">${sw ? 'Kutoka' : 'From'} ${esc(sig)} · ${esc(dateLabel)}${a.belated ? (sw ? ' · kwa kuchelewa kidogo 🙈' : ' · a little late, with love 🙈') : ''}</div>
  </td></tr>
  <tr><td style="padding:22px 22px 8px;">
    ${cardBlock}
    ${greeting ? `<div style="font-size:17px;font-weight:900;color:#2b1d12;margin-bottom:6px;">${esc(greeting)}</div>` : ''}
    <div style="font-size:15px;font-weight:600;line-height:1.6;color:#3D241A;white-space:pre-wrap;">${esc(body)}</div>
    ${linesHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:1px dashed #E8DEC9;">${linesHtml}</table>` : ''}
    <div style="text-align:right;margin-top:18px;padding-top:12px;border-top:2px solid ${pal.accent}55;">
      <div style="font-size:12.5px;font-weight:700;color:#5C6975;">${esc(sw ? 'Kwa upendo,' : 'With love,')}</div>
      <div style="font-size:19px;font-style:italic;font-weight:800;color:#3D241A;">${esc(sig)}</div>
      ${card.signatureRoster ? `<div style="font-size:11.5px;color:#5C6975;">${esc(card.signatureRoster)}</div>` : ''}
    </div>
    ${buttons}
  </td></tr>
  <tr><td style="background:#1F2D3D;color:#FFF8EC;padding:14px 22px;text-align:center;font-size:11.5px;">
    ${sw ? 'Imetumwa kwa ❤️ kupitia' : 'Sent with ❤️ via'} <b>KAYA</b> — ${sw ? 'mtandao wa familia' : 'the family network'} · <a href="${esc(a.appUrl)}/?ref=card" style="color:#F39C2F;">${sw ? 'Kuhusu Kaya · jiunge na orodha' : 'About Kaya · join the waitlist'}</a>
    ${a.stopUrl ? `<div style="opacity:.7;font-size:10.5px;margin-top:6px;">${sw ? `Umepokea hii kwa sababu familia ya ${esc(a.familyName)} ilikuongeza kwenye Kaya.` : `You received this because the ${esc(a.familyName)} family added you on Kaya.`} <a href="${esc(a.stopUrl)}" style="color:#F39C2F;">${sw ? 'Sitisha salamu hizi' : 'Stop these greetings'}</a></div>` : ''}
  </td></tr>
</table>
</td></tr></table></body></html>`;

  const text = `${headline}, ${first}!\n“${oneLiner}”\n\n${message}\n\n— ${sig}${a.publicUrl ? `\n\nOpen the card: ${a.publicUrl}` : ''}\n\nSent with ❤️ via Kaya — the family network · ${a.appUrl}`;
  return { subject, html, text };
}

/** Short nudge email to parents: "Draft the card" (T-3) / "Still blank" (T-1). */
export function renderCardNudgeEmail(a: { honoreeName: string; headline: string; daysAway: number; appUrl: string; autoSend: boolean; hasDraft: boolean }): { subject: string; html: string } {
  const when = a.daysAway === 0 ? 'today' : a.daysAway === 1 ? 'tomorrow' : `in ${a.daysAway} days`;
  const subject = a.hasDraft
    ? `✉️ ${a.honoreeName}'s card is ${when} — ready to go?`
    : `✉️ Draft ${a.honoreeName}'s card — ${a.headline.toLowerCase()} ${when}`;
  const line = a.hasDraft
    ? `Your card for ${a.honoreeName} is drafted. ${a.autoSend ? 'Kaya will send it at 07:00 on the day — add a line or mark it ready.' : 'Tap to share it when you’re ready.'}`
    : `${a.honoreeName}'s ${a.headline.toLowerCase()} is ${when}. ${a.autoSend ? 'If you leave it, Kaya sends its default card at 07:00 on the day — make it yours in two minutes.' : 'Open the Card Studio to make something they’ll keep.'}`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#FBF6EA;font-family:'Nunito',Helvetica,Arial,sans-serif;color:#1F2D3D;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:22px 10px;"><tr><td align="center">
<table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;width:100%;background:#fff;border:1px solid #E8DEC9;border-radius:16px;overflow:hidden;">
  <tr><td style="background:linear-gradient(135deg,#1F2D3D 0%,#3E4DA0 70%,#D4A847 150%);color:#fff;padding:20px;text-align:center;">
    <div style="font-size:11px;font-weight:900;letter-spacing:.12em;opacity:.9;">✉️ KAYA · GREETING CARD</div>
    <div style="font-size:20px;font-weight:900;margin-top:6px;">${esc(a.honoreeName)} — ${esc(a.headline)} ${esc(when)}</div>
  </td></tr>
  <tr><td style="padding:20px;font-size:14.5px;line-height:1.5;">${esc(line)}
    <div style="text-align:center;margin-top:16px;"><a href="${esc(a.appUrl)}/reminders" style="display:inline-block;background:#D4A847;color:#3D2E08;font-weight:900;border-radius:999px;padding:12px 30px;text-decoration:none;">Open the Card Studio →</a></div>
  </td></tr>
  <tr><td style="background:#F7F4EC;padding:10px 20px;font-size:11px;color:#5C6975;text-align:center;">Kaya Reminders · ourkaya.com</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}
