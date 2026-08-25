// Timeline 2.0 · 💌 Send-to-Someone email (design v2 innovation #6).
//
// Pure renderer — no firebase imports, safe for server routes. The
// email IS the note card: feeling, name, date, the note verbatim, a
// "Send back a 💛" CTA to the public reply page, and the People-Book
// stop link in the footer. House style: table-based, inline CSS,
// 520px, warm cream page. Facts + templateVersion go to alertLog
// (never snapshot HTML — the F9 doctrine).

export const NOTE_EMAIL_TEMPLATE_VERSION = 1;

export interface NoteEmailFacts {
  kidName: string;
  surfaceLabel: string;
  dateLabel: string;
  feeling?: string;
  text: string;
  familyName: string;
  publicUrl: string;
  stopUrl: string | null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderNoteEmail(f: NoteEmailFacts): { subject: string; html: string; text: string } {
  const subject = `💌 A note from ${f.kidName} · ${f.dateLabel}`;
  const preheader = `${f.feeling ?? '📝'} ${f.kidName} wrote something and wanted you to see it.`;
  const noteHtml = esc(f.text).replace(/\n/g, '<br>');

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#FBF6EA;">
<span style="display:none;max-height:0;overflow:hidden;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6EA;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <tr><td style="background:linear-gradient(120deg,#7A2E5C,#C05299);border-radius:18px 18px 0 0;padding:22px 28px;font-family:'Nunito','Avenir Next',Arial,sans-serif;color:#ffffff;">
    <div style="font-size:13px;opacity:.9;">${esc(f.familyName)} family · via Kaya</div>
    <div style="font-size:21px;font-weight:900;margin-top:2px;">💌 A note from ${esc(f.kidName)}</div>
  </td></tr>
  <tr><td style="background:#FFFBF5;border:1px solid #EADFCB;border-top:0;padding:26px 28px;font-family:'Nunito','Avenir Next',Arial,sans-serif;">
    <div style="font-size:30px;line-height:1;">${esc(f.feeling ?? '📝')}</div>
    <div style="font-size:15px;font-weight:900;color:#7A2E5C;margin-top:8px;">${esc(f.kidName)} · ${esc(f.surfaceLabel)}</div>
    <div style="font-size:12px;font-weight:700;color:#5A6488;margin-top:2px;">${esc(f.dateLabel)}</div>
    <div style="height:3px;width:120px;background:#F5B301;border-radius:2px;margin:14px 0;"></div>
    <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:16px;line-height:1.8;color:#0F1F44;">“${noteHtml}”</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;"><tr>
      <td style="background:#C05299;border-radius:12px;">
        <a href="${f.publicUrl}" style="display:inline-block;padding:12px 22px;font-family:'Nunito',Arial,sans-serif;font-size:14px;font-weight:900;color:#ffffff;text-decoration:none;">Send back a 💛</a>
      </td>
    </tr></table>
    <div style="font-size:11.5px;color:#5A6488;margin-top:10px;">One tap — ${esc(f.kidName)} will see your reply on that very page of their journal.</div>
  </td></tr>
  <tr><td style="background:#1F2D3D;border-radius:0 0 18px 18px;padding:16px 28px;font-family:'Nunito',Arial,sans-serif;font-size:11px;color:#9FB0C3;">
    Made with <span style="color:#F5B301;font-weight:900;">Kaya</span> 💛 · <a href="https://www.ourkaya.com" style="color:#9FB0C3;">ourkaya.com</a>
    ${f.stopUrl ? ` · <a href="${f.stopUrl}" style="color:#9FB0C3;">Stop these notes</a>` : ''}
  </td></tr>
</table>
</td></tr></table></body></html>`;

  const text = `A note from ${f.kidName} · ${f.dateLabel}\n\n"${f.text}"\n\nSend back a 💛: ${f.publicUrl}\n\nMade with Kaya · ourkaya.com${f.stopUrl ? `\nStop these notes: ${f.stopUrl}` : ''}`;

  return { subject, html, text };
}
