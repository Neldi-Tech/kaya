// 📲 WhatsApp Alerts — the Settings gateway (approved 15-Oct-2026, PR1).
//
// POST { action, ... } + Firebase ID token. PARENTS ONLY (R1): kids and
// helpers never get WhatsApp, so they never reach this card or route.
//   get                         → the card's view (my link + family rules)
//   link    { number, consent } → save number + consent, send the T0 test
//   test                        → send the T0 test again (also "turn back on")
//   alerts  { alerts }          → my 🪞 / 📉 / ➖ switches
//   off                         → turn WhatsApp off for me
//   family  { rules }           → family rules: line % · quiet hours · switch
// Numbers live in families/{f}/whatsappLinks (Admin-only) — users/{uid} is
// readable by the whole family, so a parent's number never goes there.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import {
  getWaView, linkWaNumber, sendWaTest, setWaAlerts, setWaOff, setWaFamilyRules,
} from '@/lib/whatsapp.server';
import type { WaAlertPrefs, WaFamilyRules } from '@/lib/whatsapp.shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; displayName?: string } | undefined;
  if (!user?.familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  if (user.role !== 'parent') return NextResponse.json({ error: 'parents-only' }, { status: 403 });
  const familyId = user.familyId;

  let body: { action?: string; number?: string; consent?: boolean; alerts?: Partial<WaAlertPrefs>; rules?: Partial<WaFamilyRules> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  try {
    switch (body.action) {
      case 'get':
        break;
      case 'link': {
        const r = await linkWaNumber(db, familyId, uid, user.displayName || '', String(body.number || '').slice(0, 40), body.consent === true);
        if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
        break;
      }
      case 'test':
        if (!(await sendWaTest(db, familyId, uid))) return NextResponse.json({ error: 'no-number' }, { status: 400 });
        break;
      case 'alerts':
        if (!(await setWaAlerts(db, familyId, uid, body.alerts || {}))) return NextResponse.json({ error: 'no-number' }, { status: 400 });
        break;
      case 'off':
        if (!(await setWaOff(db, familyId, uid))) return NextResponse.json({ error: 'no-number' }, { status: 400 });
        break;
      case 'family':
        await setWaFamilyRules(db, familyId, body.rules || {});
        break;
      default:
        return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, view: await getWaView(db, familyId, uid) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
