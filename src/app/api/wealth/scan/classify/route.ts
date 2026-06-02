// POST /api/wealth/scan/classify — Claude Sonnet vision.
//
// Reads a scanned document image and guesses what it is (title deed, share
// certificate, vehicle logbook, insurance policy…) so the Wealth scanner can
// pre-pick the matching asset category + a sensible name. The user can always
// adjust — this is a suggestion, never authoritative. Stateless: it only
// classifies the image the client already holds (no Firestore access).
//
// No-ops gracefully (returns { skipped: true }) when ANTHROPIC_API_KEY is
// missing. Signed-in only.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { verifyBearer } from '@/lib/wealthVaultServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const ALLOWED_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const CLASSES = [
  'cash', 'public_markets', 'private_alt', 'investments', 'real_estate',
  'retirement', 'vehicles', 'valuables', 'receivables', 'insurance',
  'digital', 'liabilities',
] as const;

interface Body { imageBase64?: string; mediaType?: string }

const SYSTEM = `You classify a single scanned document for a family WEALTH vault — things a family owns or that prove ownership/value. Decide what the document is and which asset category it belongs to.

Return:
- "docType": a short human label for the document, e.g. "Title Deed", "Land Certificate", "Share Certificate", "Vehicle Logbook", "Insurance Policy", "Bank Statement", "Fixed Deposit Receipt", "Bond Certificate", "Pension Statement", "Loan Agreement", "Valuation Report". If unsure, "Document".
- "assetClass": the single best-matching category id from EXACTLY this list, or "" if none fits:
  cash (bank/mobile money/FX/stablecoins), public_markets (listed stocks/ETFs/bonds/T-bills), private_alt (private business/startup stakes), investments (ownership stakes, angel, funds, brokerage), real_estate (houses, plots, land, title deeds), retirement (NSSF/PSSSF/pension), vehicles (cars, machinery, logbooks), valuables (gold, jewelry, art), receivables (money owed/loans given), insurance (policies with cash value), digital (crypto, domains, IP), liabilities (mortgages, loans owed).
- "suggestedName": a concise name for the asset/document (e.g. "Plot — Title Deed", "NMB Bank Statement", "Toyota Logbook"). Max 50 chars.

Rules: choose real_estate for any land/plot/house title or survey. Choose vehicles for logbooks. Choose insurance for policies. Only use what you can actually read; if the image is unreadable, return docType "Document", assetClass "", suggestedName "".`;

const SCHEMA = {
  type: 'object',
  properties: {
    docType: { type: 'string' },
    assetClass: { type: 'string', enum: [...CLASSES, ''] },
    suggestedName: { type: 'string' },
  },
  required: ['docType', 'assetClass', 'suggestedName'],
  additionalProperties: false,
} as const;

const EMPTY = { docType: '', assetClass: '', suggestedName: '' };

export async function POST(req: NextRequest) {
  const who = await verifyBearer(req);
  if (!who) return NextResponse.json({ ...EMPTY, error: 'unauthenticated' }, { status: 401 });
  if (!client) return NextResponse.json({ ...EMPTY, skipped: true });

  let body: Body;
  try { body = (await req.json()) as Body; } catch { return NextResponse.json({ ...EMPTY, error: 'bad-json' }, { status: 400 }); }

  const imageBase64 = (body?.imageBase64 || '').trim();
  const mediaType: ImgMedia = (ALLOWED_MEDIA as string[]).includes(body?.mediaType || '')
    ? (body!.mediaType as ImgMedia) : 'image/jpeg';
  if (!imageBase64) return NextResponse.json(EMPTY);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: 'Classify this scanned wealth document.' },
        ],
      }],
    });
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json(EMPTY);
    const parsed = JSON.parse(text.text) as { docType?: string; assetClass?: string; suggestedName?: string };
    const assetClass = (CLASSES as readonly string[]).includes(parsed.assetClass || '') ? parsed.assetClass! : '';
    return NextResponse.json({
      docType: String(parsed.docType || '').trim().slice(0, 40),
      assetClass,
      suggestedName: String(parsed.suggestedName || '').trim().slice(0, 50),
    });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) return NextResponse.json({ ...EMPTY, error: e.message }, { status: e.status ?? 500 });
    return NextResponse.json({ ...EMPTY, error: e instanceof Error ? e.message : 'classify-failed' }, { status: 500 });
  }
}
