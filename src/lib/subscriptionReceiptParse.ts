// Subscription receipt parser — shared server logic (Claude Sonnet).
//
// Single source of truth for turning receipt text/images into
// subscription drafts. Used by:
//   • /api/subscriptions/scan-receipt  (paste / upload — Phase 1)
//   • /api/subscriptions/gmail/callback (Gmail scan — Phase 2)
//
// Server-only (imports the Anthropic SDK + reads ANTHROPIC_API_KEY).

import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;
export const receiptParserClient = apiKey ? new Anthropic({ apiKey }) : null;

export type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
export const ALLOWED_RECEIPT_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface ParsedSubDraft {
  name: string;
  amount: number;
  currency: string;
  cadence: 'monthly' | 'annual' | 'quarterly' | 'weekly' | 'semi_annual' | 'one_off';
  platform: 'ios' | 'android' | 'web';
  nextBilling: string;
  vendor: string;
}

export const RECEIPT_SYSTEM = `You read a receipt or billing email from the Apple App Store, Google Play, or a subscription service (Netflix, Spotify, YouTube, iCloud, a gym, a SaaS tool) for a family budgeting app, and extract the RECURRING subscriptions it describes so a parent doesn't have to type them.

Return JSON: {
  "subscriptions": [ one entry per distinct recurring subscription found:
    {
      "name":        the product / service name as printed (e.g. "Netflix Premium", "iCloud+ 200GB", "YouTube Premium"). 2-6 words, no store boilerplate.
      "amount":      the per-cycle price as a PLAIN number in the receipt currency (e.g. 9.99 or 1800). Numbers only — no symbols, spaces, or thousands separators.
      "currency":    ISO code if readable ("USD", "TZS", "AED", "KES"), else "".
      "cadence":     one of "monthly" | "annual" | "quarterly" | "weekly" | "semi_annual" | "one_off" — best fit from the receipt wording. Default "monthly" when a recurring charge has no period.
      "platform":    "ios" if it's an Apple receipt, "android" if Google Play, else "web".
      "nextBilling": next renewal date as ISO "YYYY-MM-DD" if the receipt states one, else "".
      "vendor":      the billing vendor if distinct from name (e.g. "Apple", "Google"), else "".
    }
  ]
}

Rules:
- ONLY include recurring subscriptions. EXCLUDE one-off app purchases, in-app consumables, taxes, and order totals.
- If a single receipt lists several subs (an Apple monthly statement often does), return one entry each.
- De-duplicate: if the same service appears multiple times (consecutive months), return it ONCE with the most recent price + next billing date.
- Never invent a subscription, price, or date you cannot actually read.
- If the input isn't a recognisable receipt / billing email, return an empty list.`;

export const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    subscriptions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: 'number' },
          currency: { type: 'string' },
          cadence: { type: 'string', enum: ['monthly', 'annual', 'quarterly', 'weekly', 'semi_annual', 'one_off'] },
          platform: { type: 'string', enum: ['ios', 'android', 'web'] },
          nextBilling: { type: 'string' },
          vendor: { type: 'string' },
        },
        required: ['name', 'amount', 'currency', 'cadence', 'platform', 'nextBilling', 'vendor'],
        additionalProperties: false,
      },
    },
  },
  required: ['subscriptions'],
  additionalProperties: false,
} as const;

/** Normalise + clamp the model output into clean drafts. */
export function normaliseDrafts(raw: Array<Record<string, unknown>> | undefined): ParsedSubDraft[] {
  return (raw ?? [])
    .filter((s) => s && typeof s.name === 'string' && (s.name as string).trim())
    .map((s) => ({
      name: String(s.name).trim().slice(0, 80),
      amount: Math.max(0, Number(s.amount) || 0),
      currency: String(s.currency || '').trim().slice(0, 8),
      cadence: (['monthly', 'annual', 'quarterly', 'weekly', 'semi_annual', 'one_off'].includes(String(s.cadence))
        ? String(s.cadence) : 'monthly') as ParsedSubDraft['cadence'],
      platform: (['ios', 'android', 'web'].includes(String(s.platform)) ? String(s.platform) : 'web') as ParsedSubDraft['platform'],
      nextBilling: /^\d{4}-\d{2}-\d{2}$/.test(String(s.nextBilling)) ? String(s.nextBilling) : '',
      vendor: String(s.vendor || '').trim().slice(0, 40),
    }))
    .slice(0, 30);
}

/** Run one parse pass over a user-content block + return clean drafts.
 *  Returns [] when the AI key is missing (caller treats as skipped). */
async function runParse(content: Anthropic.MessageParam['content']): Promise<ParsedSubDraft[]> {
  if (!receiptParserClient) return [];
  const response = await receiptParserClient.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2500,
    system: [{ type: 'text', text: RECEIPT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema: RECEIPT_SCHEMA } },
    messages: [{ role: 'user', content }],
  });
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return [];
  try {
    const parsed = JSON.parse(block.text) as { subscriptions?: Array<Record<string, unknown>> };
    return normaliseDrafts(parsed.subscriptions);
  } catch {
    return [];
  }
}

/** Parse a single block of receipt text → subscription drafts. */
export async function parseSubscriptionsFromText(text: string, currency?: string): Promise<ParsedSubDraft[]> {
  if (!text.trim()) return [];
  const ctxLine = currency ? `The family's currency is ${currency}. ` : '';
  return runParse([
    { type: 'text', text: `${ctxLine}Here is one or more receipt / billing emails. Extract the recurring subscriptions, de-duplicated.\n\n---\n${text.slice(0, 14000)}\n---` },
  ]);
}

/** Parse a receipt screenshot / PDF-page image → subscription drafts. */
export async function parseSubscriptionsFromImage(
  imageBase64: string, mediaType: ImgMedia, currency?: string,
): Promise<ParsedSubDraft[]> {
  if (!imageBase64.trim()) return [];
  const ctxLine = currency ? `The family's currency is ${currency}. ` : '';
  return runParse([
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
    { type: 'text', text: `${ctxLine}Read this receipt image and extract the recurring subscriptions.` },
  ]);
}

/** De-duplicate drafts across many parse passes (Gmail returns one body
 *  per email — the same service often recurs month to month). Keeps the
 *  first seen (callers pass newest-first) and de-dupes case-insensitively
 *  on name + platform. */
export function dedupeDrafts(drafts: ParsedSubDraft[]): ParsedSubDraft[] {
  const seen = new Set<string>();
  const out: ParsedSubDraft[] = [];
  for (const d of drafts) {
    const key = `${d.name.toLowerCase()}|${d.platform}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out.slice(0, 30);
}
