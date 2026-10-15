// 📲 WhatsApp Alerts — create the 4 approved templates (T0–T3) in Twilio's
// Content API and submit each to Meta for WhatsApp approval (UTILITY).
// The words come straight from src/lib/whatsapp.shared (one source of truth).
//
// Run once Kaya's Twilio keys exist:
//   TWILIO_ACCOUNT_SID=AC… TWILIO_AUTH_TOKEN=… npx tsx scripts/whatsapp-templates-2026-10-15.ts          # create + submit
//   TWILIO_ACCOUNT_SID=AC… TWILIO_AUTH_TOKEN=… npx tsx scripts/whatsapp-templates-2026-10-15.ts --status # approval status only
//   npx tsx scripts/whatsapp-templates-2026-10-15.ts --dry                                               # print what would be sent
//
// Then set in Vercel (Production) the printed Content SIDs:
//   TWILIO_TPL_WELCOME · TWILIO_TPL_REFLECTION · TWILIO_TPL_RATING · TWILIO_TPL_DEDUCTION
// Until a SID is set, Kaya sends the same words as plain text (works on the
// Twilio Sandbox and inside WhatsApp's 24-hour window only).
// Re-running skips templates whose friendly_name already exists.

import { WA_TEMPLATES, type WaTemplateName } from '../src/lib/whatsapp.shared';

const SID = process.env.TWILIO_ACCOUNT_SID?.trim() || '';
const TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim() || '';
const DRY = process.argv.includes('--dry');
const STATUS_ONLY = process.argv.includes('--status');
const API = 'https://content.twilio.com/v1';

// Sample blanks Meta reviewers see (realistic, no real child data).
const SAMPLES: Record<WaTemplateName, Record<string, string>> = {
  kaya_whatsapp_welcome: { 1: 'Timotheo' },
  kaya_reflection_missed: { 1: 'Daniella', 2: '3' },
  kaya_rating_low: { 1: 'Earlnathan', 2: 'evening', 3: '42', 4: '🦷 Brush teeth, 🎒 Pack bag', 5: 'Diana', 6: 'stats/me?kid=sample' },
  kaya_points_deducted: { 1: 'Daniella', 2: '5', 3: 'Behaviour', 4: 'Elia', 5: 'stats/me?kid=sample' },
};

function contentBody(name: WaTemplateName) {
  const t = WA_TEMPLATES[name];
  return {
    friendly_name: name,
    language: 'en',
    variables: SAMPLES[name],
    types: t.button
      ? { 'twilio/call-to-action': { body: t.body, actions: [{ type: 'URL', title: t.button.title, url: t.button.url }] } }
      : { 'twilio/text': { body: t.body } },
  };
}

async function api(path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`${API}${path}`, {
    method: init?.method || 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${path} → ${res.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j as Record<string, any>;
}

async function main() {
  const names = Object.keys(WA_TEMPLATES) as WaTemplateName[];
  if (DRY) { for (const n of names) console.log(JSON.stringify(contentBody(n), null, 2)); return; }
  if (!SID || !TOKEN) { console.error('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN first (or use --dry).'); process.exit(1); }

  const existing = new Map<string, string>();
  const list = await api('/Content?PageSize=200');
  for (const c of list.contents || []) existing.set(c.friendly_name, c.sid);

  for (const name of names) {
    let sid = existing.get(name);
    if (!sid && !STATUS_ONLY) {
      sid = (await api('/Content', { method: 'POST', body: contentBody(name) })).sid as string;
      await api(`/Content/${sid}/ApprovalRequests/whatsapp`, { method: 'POST', body: { name, category: 'UTILITY' } });
      console.log(`created + submitted ${name} → ${sid}`);
    }
    if (!sid) { console.log(`${name}: not created yet`); continue; }
    const appr = await api(`/Content/${sid}/ApprovalRequests`).catch(() => ({} as Record<string, any>));
    const wa = appr.whatsapp || {};
    console.log(`${WA_TEMPLATES[name].env}=${sid}   · WhatsApp: ${wa.status || 'not submitted'}${wa.rejection_reason ? ` (${wa.rejection_reason})` : ''}`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
