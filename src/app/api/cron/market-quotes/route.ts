// Kaya Business · Junior Investor price cache (server cron).
//
// Daily job that fetches REAL prices for the curated investor menu and writes
// them to the top-level `marketQuotes/{symbol}` (server-write only — clients
// read, never set, prices). Simulated mode = real prices, virtual money.
//
// Uses the Admin SDK so it bypasses rules. Safe to ship before configuration:
// no-ops cleanly when the Admin SDK or FINNHUB_API_KEY isn't set. Secured by
// CRON_SECRET when that env var is present (Vercel sends it as a Bearer token).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The curated menu's price recipes. Each menu symbol maps to one or more real
// tickers (averaged) — mirrors INVESTMENT_MENU in lib/business.ts. Synthetic
// baskets (LEGO_INDEX) average a couple of constituents; index proxies use a
// liquid ETF the free tier supports (S&P → SPY). Kept here so the cron stays
// self-contained (no client-SDK import server-side).
const MENU: { symbol: string; tickers: string[] }[] = [
  { symbol: 'LEGO_INDEX', tickers: ['HAS', 'MAT'] }, // toy-makers basket
  { symbol: 'DIS', tickers: ['DIS'] },
  { symbol: 'KO', tickers: ['KO'] },
  { symbol: 'SP500', tickers: ['SPY'] }, // S&P 500 via SPY ETF
  { symbol: 'BANKS_FUND', tickers: ['KBE'] }, // bank ETF
];

async function fetchPriceUsd(ticker: string, token: string): Promise<number | null> {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${token}`, {
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { c?: number };
    return typeof j.c === 'number' && j.c > 0 ? j.c : null;
  } catch {
    return null;
  }
}

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const token = process.env.FINNHUB_API_KEY;
  if (!token) return NextResponse.json({ skipped: true, reason: 'FINNHUB_API_KEY not set' });

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });

  const written: string[] = [];
  const missed: string[] = [];
  for (const { symbol, tickers } of MENU) {
    const prices: number[] = [];
    for (const t of tickers) {
      const p = await fetchPriceUsd(t, token);
      if (p !== null) prices.push(p);
    }
    if (prices.length === 0) { missed.push(symbol); continue; }
    const priceUsd = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100;
    try {
      await db.collection('marketQuotes').doc(symbol).set({ symbol, priceUsd, asOf: new Date() });
      written.push(symbol);
    } catch {
      missed.push(symbol);
    }
  }

  return NextResponse.json({ ok: true, written, missed });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
