// Subscription receipt parsing (server) — Claude Sonnet.
//
// Reads an App Store / Google Play / direct-service receipt — as a
// pasted email body (text) OR a screenshot/PDF-page image — and
// extracts the recurring subscriptions it describes, so a parent can
// scan instead of typing each one. A human ALWAYS reviews the result
// before anything is written (the client enforces this).
//
// Powers Phase 1 of the subscription auto-detect (2026-05-30). Phase 2
// (Gmail read-only connect) reuses the SAME parser via lib/subscriptionReceiptParse.
//
// No-ops with { skipped: true } when ANTHROPIC_API_KEY is missing.
// Amounts come back as PLAIN NUMBERS in the receipt's currency; the
// client multiplies by 100 for cents.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  receiptParserClient,
  parseSubscriptionsFromText,
  parseSubscriptionsFromImage,
  ALLOWED_RECEIPT_MEDIA,
  type ImgMedia,
} from '@/lib/subscriptionReceiptParse';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ScanBody {
  /** One of imageBase64 / text is required. */
  imageBase64?: string;
  mediaType?: string;
  text?: string;
  currency?: string; // family currency, for context only
}

export async function POST(req: NextRequest) {
  if (!receiptParserClient) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: ScanBody;
  try {
    body = (await req.json()) as ScanBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const imageBase64 = (body?.imageBase64 || '').trim();
  const text = (body?.text || '').trim().slice(0, 12000);
  const mediaType: ImgMedia = (ALLOWED_RECEIPT_MEDIA as string[]).includes(body?.mediaType || '')
    ? (body!.mediaType as ImgMedia)
    : 'image/jpeg';
  const currency = (body?.currency || '').trim().slice(0, 8);
  if (!imageBase64 && !text) return NextResponse.json({ subscriptions: [] });

  try {
    const subscriptions = imageBase64
      ? await parseSubscriptionsFromImage(imageBase64, mediaType, currency)
      : await parseSubscriptionsFromText(text, currency);
    return NextResponse.json({ subscriptions });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Receipt parse failed' },
      { status: 500 },
    );
  }
}
