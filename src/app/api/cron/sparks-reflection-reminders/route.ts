// Slice 7m · Daily Reflection reminders + parent miss alerts.
//
// Hourly sweep:
//   · For every family · every kid with reflection_reminders.kid_reminders_enabled:
//       - if today is an active day, the picked hour:minute window matches "now",
//         and today's sparks_reflections doc is missing → write a 🔔 in-app
//         notification to the kid's user doc.
//   · For every family · every kid with reflection_reminders.parent_alert_enabled:
//       - walk back active days counting consecutive misses; if missed ≥ N
//         and we haven't already alerted today (lastParentAlertOn ≠ today) →
//         🔔 in-app + 📧 email to every parent in the family.
//
// 📲 WhatsApp Alerts (approved 15-Oct-2026, PR2):
//   · D2 — the parent alert goes out at the FAMILY alert time
//     (family.reflectionParentAlertAt, default 18:00) instead of the first
//     sweep after midnight, and not at all once the kid has written today.
//   · D3 — WhatsApp rides the same alert: once when the gap reaches N, then
//     every +5 missed days (sparks_profiles.waReflection tracks the gap).
//     Bell + email keep their daily reminder.
//   · F11 — every parent alert now leaves a 📜 alertLog entry
//     (kind 'reflection_miss') with all three channels as sent.
//
// Admin SDK throughout (bypasses rules). Secured by CRON_SECRET when set.
// TZ-aware via TZ env (default Africa/Dar_es_Salaam) for the "today" key.
//
// The core lives in lib/sparks/reflectionReminders.server (testable).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { runReflectionReminders } from '@/lib/sparks/reflectionReminders.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });

  const result = await runReflectionReminders(db, new Date());
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
