// Gmail-connect availability probe. The client hides the "Connect Gmail"
// entry point unless this returns { configured: true } — so the feature
// stays invisible until the operator sets the Google OAuth client env.

import { NextResponse } from 'next/server';
import { isGmailConfigured } from '@/lib/gmailSubscriptionScan';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ configured: isGmailConfigured() });
}
