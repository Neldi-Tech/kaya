// Kaya Wealth · DSE markets + AI commentary — server-only (Phase 2 · PR9).
//
// Local market first (Non-Negotiable #15): the Dar es Salaam exchange (DSE),
// with plain-language AI updates tied to the family's own holdings. DSE has no
// clean real-time public API, so per Elia's call we show DAILY-CLOSE indicative
// levels (the real near-live feed is an operator/paid upgrade later) + the AI
// commentary, which is the real value.
//
// Safety (Non-Negotiable #16): the AI gives READ-ONLY context, never trade
// advice; global markets + live trading stay locked behind the paid Phase-3
// tier — nothing here ever places a trade.

import Anthropic from '@anthropic-ai/sdk';
import { getAdminFirestore } from './firebaseAdmin';

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

export interface DseQuote { symbol: string; name: string; price: string; changePct: number }

// Indicative DSE levels (daily-close style). Representative, not a live feed —
// the UI labels them honestly. Swappable for an operator-maintained store or a
// paid feed without touching the rest of the module.
export const DSE_QUOTES: DseQuote[] = [
  { symbol: 'DSEI', name: 'DSE All-Share Index', price: '2,114', changePct: 0.8 },
  { symbol: 'CRDB', name: 'CRDB Bank',           price: 'TZS 640',    changePct: 2.4 },
  { symbol: 'NMB',  name: 'NMB Bank',            price: 'TZS 4,300',  changePct: 1.1 },
  { symbol: 'TBL',  name: 'Tanzania Breweries',  price: 'TZS 10,900', changePct: -1.1 },
];

export interface MarketUpdate { quotes: DseQuote[]; asOf: string; commentary: string; ai: boolean }

const FALLBACK = 'The Dar es Salaam exchange (DSE) is your local market. As you add DSE holdings, Kaya will explain the moves here in plain language.';

export async function getMarketUpdate(familyId: string, asOfIso: string): Promise<MarketUpdate> {
  const quotes = DSE_QUOTES;

  // The family's public-markets (DSE) holdings, for the AI context.
  let holdings: { name: string; value: number; currency: string }[] = [];
  const db = getAdminFirestore();
  if (db) {
    try {
      const snap = await db.collection('families').doc(familyId).collection('wealth_assets')
        .where('class', '==', 'public_markets').get();
      holdings = snap.docs
        .map((d) => d.data() as { name?: string; valueCents?: number; currency?: string; archivedAt?: unknown })
        .filter((a) => a.name && !a.archivedAt)
        .map((a) => ({ name: a.name as string, value: (a.valueCents ?? 0) / 100, currency: a.currency ?? 'TZS' }));
    } catch { /* holdings stay empty */ }
  }

  if (!client) return { quotes, asOf: asOfIso, commentary: FALLBACK, ai: false };

  try {
    const holdingsStr = holdings.length
      ? holdings.map((h) => `${h.name} (${h.currency} ${Math.round(h.value).toLocaleString()})`).join(', ')
      : 'none on the DSE yet';
    const quotesStr = quotes.map((q) => `${q.symbol} ${q.price} ${q.changePct >= 0 ? '+' : ''}${q.changePct}%`).join('; ');
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 220,
      messages: [{
        role: 'user',
        content:
          "You are Kaya's calm, plain-language family wealth assistant. Write ONE short, friendly paragraph (max 2 sentences) of market context for THIS family, tied to their DSE holdings and today's indicative DSE levels. Plain language, no jargon, warm. This is general context, NOT financial advice — never recommend buying, selling, holding, or any trade, and never mention specific actions to take. If they hold nothing on the DSE, gently note the local market is here when they're ready.\n\n" +
          `Their DSE holdings: ${holdingsStr}.\nToday's DSE (indicative, daily close): ${quotesStr}.`,
      }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim() : '';
    return { quotes, asOf: asOfIso, commentary: text || FALLBACK, ai: !!text };
  } catch {
    return { quotes, asOf: asOfIso, commentary: FALLBACK, ai: false };
  }
}
