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

export interface MarketUpdate { quotes: DseQuote[]; asOf: string; commentary: string; ai: boolean; live: boolean }

const FALLBACK = 'The Dar es Salaam exchange (DSE) is your local market. As you add DSE holdings, Kaya will explain the moves here in plain language.';

// ── Live DSE read (dse.co.tz) ─────────────────────────────────────────
// The DSE publishes the day's prices as a server-rendered HTML table on its
// homepage. We parse it server-side (symbol · closing price · change%), cache
// it briefly, and fall back to the indicative levels above on ANY failure — so
// the markets card never breaks if the site is slow or changes its markup.

const DSE_NAMES: Record<string, string> = {
  CRDB: 'CRDB Bank', NMB: 'NMB Bank', DSE: 'DSE PLC', NICO: 'NICO', TBL: 'Tanzania Breweries',
  TCC: 'Tanzania Cigarette', TPCC: 'Twiga Cement', TOL: 'TOL Gases', SWIS: 'Swissport',
  DCB: 'DCB Commercial Bank', MCB: 'Mwalimu Commercial Bank', MUCOBA: 'Mucoba Bank',
  MKCB: 'Mkombozi Bank', KCB: 'KCB Group', JHL: 'Jubilee Holdings', NMG: 'Nation Media',
  EABL: 'East African Breweries', AFRIPRISE: 'Afriprise Investment', PAL: 'Maendeleo Bank',
  YETU: 'Yetu Microfinance', MBP: 'Mufindi Community Bank', VODA: 'Vodacom Tanzania',
};

let dseCache: { quotes: DseQuote[]; asOf: string; at: number } | null = null;
const DSE_TTL_MS = 15 * 60 * 1000;

function parseDseHtml(html: string): { quotes: DseQuote[]; asOf: string } | null {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  const raw: (DseQuote & { turnover: number })[] = [];
  for (const rm of rows) {
    const cells = [...rm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    if (cells.length < 7) continue;
    const symbol = cells[0];
    if (!/^[A-Z][A-Z0-9 ]{1,12}$/.test(symbol)) continue;          // first cell is a ticker
    const priceNum = parseInt(cells[3].replace(/[^\d]/g, ''), 10); // col 3 = closing price
    if (!priceNum) continue;
    const cm = cells[6].match(/(-?\d+(?:\.\d+)?)\s*$/);            // col 6 = "+▲ 0.72" / "-▼ -1.83"
    const changePct = cm ? parseFloat(cm[1]) : 0;
    const turnover = parseInt((cells[7] || '').replace(/[^\d]/g, ''), 10) || 0;
    raw.push({ symbol, name: DSE_NAMES[symbol] || symbol, price: `TZS ${priceNum.toLocaleString('en-US')}`, changePct, turnover });
  }
  if (raw.length < 3) return null; // parse almost certainly failed → fall back
  raw.sort((a, b) => b.turnover - a.turnover); // most active first
  const quotes: DseQuote[] = raw.slice(0, 12).map(({ symbol, name, price, changePct }) => ({ symbol, name, price, changePct }));
  const dm = html.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  return { quotes, asOf: dm ? `${dm[1]} ${dm[2].slice(0, 3)} ${dm[3]}` : '' };
}

async function fetchDseLive(): Promise<{ quotes: DseQuote[]; asOf: string } | null> {
  if (dseCache && Date.now() - dseCache.at < DSE_TTL_MS) return { quotes: dseCache.quotes, asOf: dseCache.asOf };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch('https://dse.co.tz/', {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const parsed = parseDseHtml(await r.text());
    if (parsed) dseCache = { ...parsed, at: Date.now() };
    return parsed;
  } catch { return null; }
}

export async function getMarketUpdate(familyId: string, asOfIso: string): Promise<MarketUpdate> {
  // Live from dse.co.tz; falls back to indicative levels on any failure.
  const live = await fetchDseLive();
  const quotes = live?.quotes ?? DSE_QUOTES;
  const isLive = !!live;
  const asOf = live?.asOf || asOfIso;

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

  if (!client) return { quotes, asOf, commentary: FALLBACK, ai: false, live: isLive };

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
          "You are Kaya's calm, plain-language family wealth assistant. Write ONE short, friendly paragraph (max 2 sentences) of market context for THIS family, tied to their DSE holdings and today's DSE levels. Plain language, no jargon, warm. This is general context, NOT financial advice — never recommend buying, selling, holding, or any trade, and never mention specific actions to take. If they hold nothing on the DSE, gently note the local market is here when they're ready.\n\n" +
          `Their DSE holdings: ${holdingsStr}.\nToday's DSE (${isLive ? 'live, from the Dar es Salaam Stock Exchange' : 'indicative daily close'}): ${quotesStr}.`,
      }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    const text = block && block.type === 'text' ? block.text.trim() : '';
    return { quotes, asOf, commentary: text || FALLBACK, ai: !!text, live: isLive };
  } catch {
    return { quotes, asOf, commentary: FALLBACK, ai: false, live: isLive };
  }
}
