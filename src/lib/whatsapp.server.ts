// 📲 WhatsApp Alerts — the server pipe (approved 15-Oct-2026, PR1).
//
// One module owns every WhatsApp side effect so the gateways, crons and
// the QA harness all run the same code:
//   • Twilio REST send (no SDK) + signature check for Twilio's callbacks
//   • per-parent links  families/{f}/whatsappLinks/{uid}   (Admin-only —
//     users/{uid} is readable by kids + helpers, so numbers never go there)
//   • indexes          whatsappNumbers/{digits} (STOP replies → links)
//                      whatsappMessages/{sid}   (status callbacks → trace)
//   • recipients (R1/R2/R6/R7), the daily limit (R9), quiet hours with a
//     re-check before sending (R8), the 📜 trace (R10), STOP (R11), the
//     kill switches (R13)
//
// Best-effort everywhere: nothing here may break a rating, an award or a
// reflection. Never writes `undefined` (Admin SDK rejects it).

import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { dayKeyInTZ } from './dates';
import { composeHeatFacts, composeAwardFacts, type HeatReportFacts } from './pointsEmail.server';
import {
  APP_ORIGIN, DEFAULT_WA_ALERTS, WA_DAILY_CAP, WA_STATUS_RANK, WA_TEMPLATES,
  displayWaNumber, firstName, inQuietHours, isHHMM, isValidWaNumber, maskWaNumber, minutesOf,
  normalizeWaNumber, renderWaTemplate, resolveWaRules, waErrorText,
  type WaAlertPrefs, type WaChannel, type WaFamilyRules, type WaLinkState, type WaRecipient,
  type WaStatus, type WaTemplateName, type WaTest, type WaView,
} from './whatsapp.shared';
export type { WaTest, WaView } from './whatsapp.shared';

type AdminDb = Firestore;

export const WA_TZ = process.env.SPARKS_REFLECTION_TZ || 'Africa/Dar_es_Salaam';
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || APP_ORIGIN).replace(/\/$/, '');
/** Overridable ONLY so the local QA harness can point at a mock. */
const API_BASE = (process.env.TWILIO_API_BASE || 'https://api.twilio.com').replace(/\/$/, '');

// ── Config + kill switch ─────────────────────────────────────────────────
interface WaConfig { sid: string; token: string; from?: string; service?: string }
export function waConfig(): WaConfig | null {
  if (process.env.WHATSAPP_DISABLED === '1') return null; // R13 server switch
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromRaw = process.env.TWILIO_WHATSAPP_FROM?.trim();
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  if (!sid || !token || (!fromRaw && !service)) return null;
  const from = fromRaw
    ? (fromRaw.startsWith('whatsapp:') ? fromRaw : `whatsapp:+${fromRaw.replace(/[^0-9]/g, '')}`)
    : undefined;
  return { sid, token, ...(from ? { from } : {}), ...(service ? { service } : {}) };
}
export function waConfigured(): boolean { return waConfig() !== null; }

// ── Family clock ─────────────────────────────────────────────────────────
export function familyDayKey(now: Date): string { return dayKeyInTZ(now, WA_TZ); }
export function familyMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: WA_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value || '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value || '0');
  return h * 60 + m;
}
/** Epoch ms of the next family-clock `hh:mm` at or after `now` (minute precision). */
export function nextFamilyTime(now: Date, hhmm: string): number {
  const delta = (minutesOf(hhmm) - familyMinutes(now) + 1440) % 1440;
  const base = now.getTime() - (now.getUTCSeconds() * 1000 + now.getUTCMilliseconds());
  return base + delta * 60_000;
}

// ── Twilio: send + verify ────────────────────────────────────────────────
export interface WaSendResult { ok: boolean; sid?: string; status: WaStatus; errorCode?: string; note?: string }

function mapTwilioStatus(s: string | undefined): WaStatus {
  switch (s) {
    case 'sent': return 'sent';
    case 'delivered': return 'delivered';
    case 'read': return 'read';
    case 'failed': case 'undelivered': case 'canceled': return 'failed';
    default: return 'queued'; // accepted · queued · sending · scheduled
  }
}

/** Send one approved template. Before Meta approves it (no Content SID in
 *  env) the same words go as plain text — that works inside WhatsApp's
 *  24-hour window and on the Twilio Sandbox, and fails honestly (63016)
 *  outside it. */
export async function sendWaTemplate(toDigits: string, template: WaTemplateName, vars: Record<string, string>): Promise<WaSendResult> {
  const cfg = waConfig();
  if (!cfg) return { ok: false, status: 'failed', errorCode: 'not-configured', note: waErrorText('not-configured') };
  const p = new URLSearchParams();
  p.set('To', `whatsapp:+${toDigits}`);
  if (cfg.service) p.set('MessagingServiceSid', cfg.service);
  if (cfg.from) p.set('From', cfg.from);
  const contentSid = process.env[WA_TEMPLATES[template].env]?.trim();
  if (contentSid) {
    p.set('ContentSid', contentSid);
    p.set('ContentVariables', JSON.stringify(vars));
  } else {
    const r = renderWaTemplate(template, vars);
    p.set('Body', r.button ? `${r.text}\n\n${r.button.title}: ${r.button.url}` : r.text);
  }
  p.set('StatusCallback', `${APP_URL}/api/whatsapp/status`);
  try {
    const res = await fetch(`${API_BASE}/2010-04-01/Accounts/${encodeURIComponent(cfg.sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.sid}:${cfg.token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: p.toString(),
    });
    const j = (await res.json().catch(() => ({}))) as {
      sid?: string; status?: string; code?: number; message?: string; error_code?: number | null; error_message?: string | null;
    };
    if (!res.ok) {
      return { ok: false, status: 'failed', errorCode: String(j.code ?? res.status), note: waErrorText(j.code, j.message || `HTTP ${res.status}`) };
    }
    const status = mapTwilioStatus(j.status);
    if (status === 'failed') {
      return { ok: false, ...(j.sid ? { sid: j.sid } : {}), status, errorCode: String(j.error_code ?? ''), note: waErrorText(j.error_code, j.error_message || undefined) };
    }
    return { ok: true, ...(j.sid ? { sid: j.sid } : {}), status };
  } catch (e) {
    return { ok: false, status: 'failed', errorCode: 'network', note: waErrorText(null, e instanceof Error ? e.message : 'network') };
  }
}

/** X-Twilio-Signature check: base64(HMAC-SHA1(token, url + sorted k+v)).
 *  `urls` = the public URL(s) Twilio may have called. */
export function verifyTwilioSignature(urls: string[], params: Record<string, string>, signature: string | null): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!token || !signature) return false;
  const tail = Object.keys(params).sort().map((k) => k + params[k]).join('');
  const given = Buffer.from(signature);
  return urls.some((url) => {
    const expected = Buffer.from(crypto.createHmac('sha1', token).update(Buffer.from(url + tail, 'utf-8')).digest('base64'));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  });
}
/** The public URLs a Twilio webhook for `path` may arrive on. */
export function webhookUrls(path: string, search = ''): string[] {
  const set = new Set([`${APP_URL}${path}${search}`, `${APP_ORIGIN}${path}${search}`, `https://ourkaya.com${path}${search}`]);
  return Array.from(set);
}

// ── Links (one per parent) ───────────────────────────────────────────────
export interface WaLinkDoc {
  uid: string;
  name: string;
  number: string;
  state: WaLinkState;
  consentAt: number;
  alerts: WaAlertPrefs;
  test?: WaTest;
  connectedAt?: number;
  stoppedAt?: number;
  offAt?: number;
  updatedAt: number;
  /** R9 — WhatsApps accepted today (family day). */
  day?: { key: string; count: number };
}

const famRef = (db: AdminDb, familyId: string) => db.collection('families').doc(familyId);
const linksCol = (db: AdminDb, familyId: string) => famRef(db, familyId).collection('whatsappLinks');

async function familyParents(db: AdminDb, familyId: string): Promise<{ uid: string; name: string }[]> {
  const snap = await db.collection('users').where('familyId', '==', familyId).get();
  return snap.docs
    .filter((d) => (d.data().role || '') === 'parent')
    .map((d) => ({ uid: d.id, name: firstName(d.data().displayName as string | undefined, 'Parent') }));
}

function cleanFamilyName(name: string | undefined): string {
  const n = (name || '').trim().replace(/\s+family$/i, '').replace(/^the\s+/i, '').trim();
  return n || 'Kaya';
}

export async function getWaView(db: AdminDb, familyId: string, uid: string, now = new Date()): Promise<WaView> {
  const [famSnap, linksSnap, parents] = await Promise.all([famRef(db, familyId).get(), linksCol(db, familyId).get(), familyParents(db, familyId)]);
  const links = new Map(linksSnap.docs.map((d) => [d.id, d.data() as WaLinkDoc]));
  const mine = links.get(uid);
  const today = familyDayKey(now);
  return {
    configured: waConfigured(),
    cap: WA_DAILY_CAP,
    me: mine ? {
      state: mine.state,
      number: mine.number,
      display: displayWaNumber(mine.number),
      alerts: { ...DEFAULT_WA_ALERTS, ...(mine.alerts || {}) },
      ...(mine.test ? { test: mine.test } : {}),
      ...(mine.connectedAt ? { connectedAt: mine.connectedAt } : {}),
      ...(mine.stoppedAt ? { stoppedAt: mine.stoppedAt } : {}),
      todayCount: mine.day?.key === today ? mine.day.count : 0,
    } : null,
    family: {
      rules: resolveWaRules((famSnap.data() || {}).whatsappAlerts as Partial<WaFamilyRules> | undefined),
      people: parents.map((p) => ({ uid: p.uid, name: p.name, state: links.get(p.uid)?.state ?? 'none' })),
    },
  };
}

/** Save (or change) a parent's number + consent, then send the welcome test. */
export async function linkWaNumber(
  db: AdminDb, familyId: string, uid: string, displayName: string, raw: string, consent: boolean, now = new Date(),
): Promise<{ ok: true } | { ok: false; error: 'bad-number' | 'consent-required' }> {
  const digits = normalizeWaNumber(raw);
  if (!isValidWaNumber(digits)) return { ok: false, error: 'bad-number' };
  if (!consent) return { ok: false, error: 'consent-required' };
  const ref = linksCol(db, familyId).doc(uid);
  const prev = (await ref.get()).data() as WaLinkDoc | undefined;
  if (prev?.number && prev.number !== digits) {
    await db.collection('whatsappNumbers').doc(prev.number)
      .set({ links: FieldValue.arrayRemove({ familyId, uid }) }, { merge: true }).catch(() => {});
  }
  const t = now.getTime();
  const doc: WaLinkDoc = {
    uid, name: firstName(displayName, 'Parent'), number: digits, state: 'pending', consentAt: t,
    alerts: { ...DEFAULT_WA_ALERTS, ...(prev?.alerts || {}) }, updatedAt: t,
    ...(prev?.day ? { day: prev.day } : {}),
  };
  await ref.set(doc); // full replace: clears an old test / stop / connection
  await db.collection('whatsappNumbers').doc(digits)
    .set({ links: FieldValue.arrayUnion({ familyId, uid }), updatedAt: t }, { merge: true });
  await sendWaTest(db, familyId, uid, now);
  return { ok: true };
}

/** T0 welcome — the test that has to arrive before alerts start (F3). */
export async function sendWaTest(db: AdminDb, familyId: string, uid: string, now = new Date()): Promise<WaTest | null> {
  const ref = linksCol(db, familyId).doc(uid);
  const link = (await ref.get()).data() as WaLinkDoc | undefined;
  if (!link) return null;
  const t = now.getTime();
  if (!waConfigured()) {
    const test: WaTest = { status: 'not-configured', at: t, note: waErrorText('not-configured') };
    await ref.set({ state: 'pending', test, updatedAt: t }, { merge: true });
    return test;
  }
  const fam = (await famRef(db, familyId).get()).data() || {};
  const r = await sendWaTemplate(link.number, 'kaya_whatsapp_welcome', { '1': cleanFamilyName(fam.name as string | undefined) });
  if (r.sid) await db.collection('whatsappMessages').doc(r.sid).set({ familyId, uid, kind: 'test', at: t });
  const test: WaTest = { status: r.status, at: t, ...(r.sid ? { sid: r.sid } : {}), ...(r.note ? { note: r.note } : {}) };
  // A re-test of a connected number keeps it connected; anything else waits for the tick.
  const state: WaLinkState = !r.ok ? 'failed' : link.state === 'connected' ? 'connected' : 'pending';
  await ref.set({ state, test, updatedAt: t }, { merge: true });
  return test;
}

export async function setWaAlerts(db: AdminDb, familyId: string, uid: string, prefs: Partial<WaAlertPrefs>): Promise<boolean> {
  const ref = linksCol(db, familyId).doc(uid);
  const link = (await ref.get()).data() as WaLinkDoc | undefined;
  if (!link) return false;
  const alerts: WaAlertPrefs = { ...DEFAULT_WA_ALERTS, ...(link.alerts || {}) };
  for (const k of ['reflection', 'lowRating', 'deduction'] as const) if (typeof prefs[k] === 'boolean') alerts[k] = prefs[k] as boolean;
  await ref.set({ alerts, updatedAt: Date.now() }, { merge: true });
  return true;
}

export async function setWaOff(db: AdminDb, familyId: string, uid: string): Promise<boolean> {
  const ref = linksCol(db, familyId).doc(uid);
  if (!(await ref.get()).exists) return false;
  const t = Date.now();
  await ref.set({ state: 'off', offAt: t, updatedAt: t }, { merge: true });
  return true;
}

export async function setWaFamilyRules(db: AdminDb, familyId: string, patch: Partial<WaFamilyRules>): Promise<WaFamilyRules> {
  const ref = famRef(db, familyId);
  const cur = resolveWaRules(((await ref.get()).data() || {}).whatsappAlerts as Partial<WaFamilyRules> | undefined);
  const next: WaFamilyRules = resolveWaRules({
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : cur.enabled,
    lowLinePct: patch.lowLinePct ?? cur.lowLinePct,
    quietFrom: isHHMM(patch.quietFrom) ? patch.quietFrom : cur.quietFrom,
    quietTo: isHHMM(patch.quietTo) ? patch.quietTo : cur.quietTo,
  });
  await ref.set({ whatsappAlerts: next }, { merge: true });
  return next;
}

// ── Twilio callbacks ─────────────────────────────────────────────────────
/** Status callback (sent → delivered → read · failed) → the test or the trace. */
export async function applyWaStatus(db: AdminDb, params: Record<string, string>): Promise<'test' | 'alert' | 'unknown'> {
  const sid = params.MessageSid || params.SmsSid || '';
  if (!sid) return 'unknown';
  const idx = (await db.collection('whatsappMessages').doc(sid).get()).data() as
    { familyId?: string; uid?: string; kind?: 'test' | 'alert'; logId?: string } | undefined;
  if (!idx?.familyId || !idx.uid) return 'unknown';
  const status = mapTwilioStatus(params.MessageStatus || params.SmsStatus);
  const code = params.ErrorCode || '';
  const note = status === 'failed' ? waErrorText(code || null, params.ErrorMessage || undefined) : undefined;
  const t = Date.now();

  if (idx.kind === 'test') {
    const ref = linksCol(db, idx.familyId).doc(idx.uid);
    await db.runTransaction(async (tx) => {
      const link = (await tx.get(ref)).data() as WaLinkDoc | undefined;
      if (!link?.test || link.test.sid !== sid) return; // an older test
      const cur = link.test.status === 'not-configured' ? 'queued' : link.test.status;
      if (WA_STATUS_RANK[status] <= WA_STATUS_RANK[cur]) return;
      const test: WaTest = { ...link.test, status, at: t, ...(note ? { note } : {}) };
      const upd: Record<string, unknown> = { test, updatedAt: t };
      if ((status === 'delivered' || status === 'read') && link.state !== 'stopped' && link.state !== 'off') {
        upd.state = 'connected';
        if (!link.connectedAt || link.state !== 'connected') upd.connectedAt = t;
      }
      if (status === 'failed' && link.state === 'pending') upd.state = 'failed';
      tx.set(ref, upd, { merge: true });
    });
    return 'test';
  }
  if (idx.kind === 'alert' && idx.logId) {
    await updateWaRecipient(db, idx.familyId, idx.logId, idx.uid, { status, at: t, sid, ...(note ? { note } : {}) });
    return 'alert';
  }
  return 'unknown';
}

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
/** Incoming WhatsApp message — R11: STOP turns that parent off. */
export async function applyWaInbound(db: AdminDb, params: Record<string, string>): Promise<'stopped' | 'ignored'> {
  const digits = normalizeWaNumber((params.From || '').replace(/^whatsapp:/, '').trim().replace(/^(?!\+)/, '+'));
  const word = (params.Body || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!digits || !STOP_WORDS.has(word)) return 'ignored';
  const idx = (await db.collection('whatsappNumbers').doc(digits).get()).data() as { links?: { familyId: string; uid: string }[] } | undefined;
  const t = Date.now();
  let hit = false;
  for (const l of idx?.links || []) {
    const ref = linksCol(db, l.familyId).doc(l.uid);
    const link = (await ref.get()).data() as WaLinkDoc | undefined;
    if (!link || link.number !== digits) continue;
    await ref.set({ state: 'stopped', stoppedAt: t, updatedAt: t }, { merge: true });
    hit = true;
  }
  return hit ? 'stopped' : 'ignored';
}

// ── The trace (R10) ──────────────────────────────────────────────────────
export async function updateWaRecipient(
  db: AdminDb, familyId: string, logId: string, uid: string,
  patch: { status: WaStatus; at: number; sid?: string; note?: string },
): Promise<void> {
  const ref = famRef(db, familyId).collection('alertLog').doc(logId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const ch = (snap.data()?.channels?.whatsapp || null) as WaChannel | null;
    if (!ch?.to) return;
    const i = ch.to.findIndex((r) => r.uid === uid && (!patch.sid || !r.sid || r.sid === patch.sid));
    if (i < 0) return;
    const cur = ch.to[i];
    if (WA_STATUS_RANK[patch.status] <= WA_STATUS_RANK[cur.status]) return;
    const to = ch.to.slice();
    to[i] = { ...cur, status: patch.status, at: patch.at, ...(patch.sid ? { sid: patch.sid } : {}), ...(patch.note ? { note: patch.note } : {}) };
    tx.update(ref, { 'channels.whatsapp.to': to, 'channels.whatsapp.sent': to.some(liveStatus) });
  });
}
function liveStatus(r: WaRecipient): boolean {
  return r.status === 'queued' || r.status === 'sent' || r.status === 'delivered' || r.status === 'read' || r.status === 'held';
}

// ── Recipients + dispatch ────────────────────────────────────────────────
export type WaAlertKind = 'reflection_miss' | 'low_rating' | 'deduction';
const PREF_OF: Record<WaAlertKind, keyof WaAlertPrefs> = { reflection_miss: 'reflection', low_rating: 'lowRating', deduction: 'deduction' };
const TEMPLATE_OF: Record<WaAlertKind, WaTemplateName> = { reflection_miss: 'kaya_reflection_missed', low_rating: 'kaya_rating_low', deduction: 'kaya_points_deducted' };

interface Candidate { link: WaLinkDoc; eligible: boolean; note?: string }
async function waCandidates(
  db: AdminDb, familyId: string, kind: WaAlertKind, skipUid?: string, skipNote?: string,
): Promise<{ rules: WaFamilyRules; list: Candidate[] } | null> {
  const [famSnap, linksSnap, parents] = await Promise.all([famRef(db, familyId).get(), linksCol(db, familyId).get(), familyParents(db, familyId)]);
  const rules = resolveWaRules((famSnap.data() || {}).whatsappAlerts as Partial<WaFamilyRules> | undefined);
  if (!rules.enabled) return null;
  const parentName = new Map(parents.map((p) => [p.uid, p.name]));
  const pref = PREF_OF[kind];
  const list: Candidate[] = [];
  for (const d of linksSnap.docs) {
    const link = d.data() as WaLinkDoc;
    if (!parentName.has(link.uid)) continue; // R1 — parents only, still in this family
    const l = { ...link, name: parentName.get(link.uid) || link.name };
    if (skipUid && l.uid === skipUid) { list.push({ link: l, eligible: false, note: skipNote || 'gave this one' }); continue; }
    if (l.state !== 'connected') {
      list.push({ link: l, eligible: false, note: l.state === 'stopped' ? 'replied STOP' : l.state === 'off' ? 'switched off' : 'not connected' });
      continue;
    }
    if (!{ ...DEFAULT_WA_ALERTS, ...(l.alerts || {}) }[pref]) { list.push({ link: l, eligible: false, note: 'switched this alert off' }); continue; }
    list.push({ link: l, eligible: true });
  }
  list.sort((a, b) => a.link.name.localeCompare(b.link.name));
  return { rules, list };
}

/** Send to one connected parent, inside the daily limit (R9). */
async function sendToLink(
  db: AdminDb, familyId: string, link: WaLinkDoc, template: WaTemplateName, vars: Record<string, string>, logId: string, now: Date,
): Promise<WaRecipient> {
  const base = { uid: link.uid, name: link.name, masked: maskWaNumber(link.number), at: now.getTime() };
  const ref = linksCol(db, familyId).doc(link.uid);
  const today = familyDayKey(now);
  const fresh = ((await ref.get()).data() as WaLinkDoc | undefined) || link;
  const count = fresh.day?.key === today ? fresh.day.count : 0;
  if (count >= WA_DAILY_CAP) return { ...base, status: 'capped', note: `over ${WA_DAILY_CAP} today, so bell + email only` };
  const r = await sendWaTemplate(link.number, template, vars);
  if (r.sid) await db.collection('whatsappMessages').doc(r.sid).set({ familyId, uid: link.uid, kind: 'alert', logId, at: now.getTime() });
  if (r.ok) await ref.set({ day: { key: today, count: count + 1 } }, { merge: true });
  return { ...base, status: r.status, ...(r.sid ? { sid: r.sid } : {}), ...(r.note ? { note: r.note } : {}) };
}

export interface WaOutboxRef { childId: string; ratingId?: string; awardId?: string; dayKey?: string }
export interface WaDispatchArgs {
  kind: WaAlertKind;
  /** The alertLog doc id the caller will write this channel into. */
  logId: string;
  vars: Record<string, string>;
  skipUid?: string;
  skipNote?: string;
  ref: WaOutboxRef;
  now?: Date;
}

/** R1–R10 in one place. Returns the 📲 channel for the caller's alertLog
 *  entry, or null when nothing goes by WhatsApp (not configured · family
 *  switch off · nobody connected for this alert) — then no 📲 trace. */
export async function dispatchWa(db: AdminDb, familyId: string, a: WaDispatchArgs): Promise<WaChannel | null> {
  if (!waConfigured()) return null;
  const c = await waCandidates(db, familyId, a.kind, a.skipUid, a.skipNote);
  if (!c) return null;
  const eligible = c.list.filter((x) => x.eligible);
  if (eligible.length === 0) return null;
  const now = a.now || new Date();
  const t = now.getTime();
  const template = TEMPLATE_OF[a.kind];
  const quiet = inQuietHours(familyMinutes(now), c.rules.quietFrom, c.rules.quietTo);
  const to: WaRecipient[] = [];
  for (const x of c.list) {
    const base = { uid: x.link.uid, name: x.link.name, masked: maskWaNumber(x.link.number), at: t };
    if (!x.eligible) { to.push({ ...base, status: 'skipped', note: x.note || 'skipped' }); continue; }
    if (quiet) { to.push({ ...base, status: 'held', note: 'quiet hours', heldAt: t }); continue; }
    to.push(await sendToLink(db, familyId, x.link, template, a.vars, a.logId, now));
  }
  if (quiet) {
    await famRef(db, familyId).collection('whatsappOutbox').add({
      kind: a.kind, logId: a.logId, vars: a.vars, ref: cleanRef(a.ref),
      uids: eligible.map((x) => x.link.uid), state: 'held', createdAt: t,
      sendAfter: nextFamilyTime(now, c.rules.quietTo),
    });
  }
  return { on: true, sent: to.some(liveStatus), template, vars: a.vars, to };
}
function cleanRef(r: WaOutboxRef): WaOutboxRef {
  return { childId: r.childId, ...(r.ratingId ? { ratingId: r.ratingId } : {}), ...(r.awardId ? { awardId: r.awardId } : {}), ...(r.dayKey ? { dayKey: r.dayKey } : {}) };
}

// ── Message blanks per alert (Logic Test §4) ─────────────────────────────
export function reflectionVars(kidName: string, misses: number): Record<string, string> {
  return { '1': firstName(kidName, 'Your child'), '2': String(misses) };
}
export function lowRatingVars(f: HeatReportFacts): Record<string, string> {
  const bad = f.tasks.filter((t) => t.value === 'bad');
  const pick = bad.length ? bad : f.tasks.filter((t) => t.value === 'good');
  const names = pick.slice(0, 3).map((t) => `${t.icon && t.icon !== '•' ? `${t.icon} ` : ''}${t.label}`.trim());
  const more = pick.length > 3 ? ` +${pick.length - 3} more` : '';
  return {
    '1': f.kidFirst || 'Your child',
    '2': f.period,
    '3': String(f.scorePct ?? 0),
    '4': names.length ? `${names.join(', ')}${more}` : 'a few tasks',
    '5': f.ratedByFirst || 'Family',
    '6': `stats/me?kid=${encodeURIComponent(f.childId)}`,
  };
}
function niceCategory(c: string): string {
  const s = c.replace(/[-_]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'a reason';
}
export function deductionVars(f: { kidFirst: string; points: number; category: string; byFirst: string; childId: string }): Record<string, string> {
  return {
    '1': f.kidFirst || 'Your child',
    '2': String(Math.abs(f.points)),
    '3': niceCategory(f.category),
    '4': f.byFirst || 'Family',
    '5': `stats/me?kid=${encodeURIComponent(f.childId)}`,
  };
}

// ── The three alerts (hooks call these) ──────────────────────────────────
/** 📉 R6 — a saved rating below the family line. Called by the rating gateway. */
export async function runLowRatingWa(db: AdminDb, familyId: string, ratingId: string, now = new Date()): Promise<'sent' | 'skipped'> {
  if (!waConfigured()) return 'skipped';
  const ratingRef = famRef(db, familyId).collection('ratings').doc(ratingId);
  const composed = await composeHeatFacts(db, familyId, ratingId);
  if (!composed) return 'skipped';
  const { facts, fam, rating } = composed;
  const rules = resolveWaRules((fam as { whatsappAlerts?: Partial<WaFamilyRules> }).whatsappAlerts);
  if (!rules.enabled || facts.scorePct === null || facts.scorePct >= rules.lowLinePct) return 'skipped';
  const today = familyDayKey(now);
  if (rating.date !== today) return 'skipped'; // "scored … today" — no back-filled ratings
  // Once per rating, once per kid per day — claimed atomically.
  const capsRef = famRef(db, familyId).collection('whatsappState').doc('caps');
  const claimed = await db.runTransaction(async (tx) => {
    const [r, caps] = await Promise.all([tx.get(ratingRef), tx.get(capsRef)]);
    if ((r.data() as { whatsappAt?: number } | undefined)?.whatsappAt) return false;
    if (((caps.data() || {}).lowRating || {})[facts.childId] === today) return false;
    tx.set(ratingRef, { whatsappAt: now.getTime() }, { merge: true });
    tx.set(capsRef, { lowRating: { [facts.childId]: today } }, { merge: true });
    return true;
  });
  if (!claimed) return 'skipped';
  const logRef = famRef(db, familyId).collection('alertLog').doc();
  const ch = await dispatchWa(db, familyId, {
    kind: 'low_rating', logId: logRef.id, vars: lowRatingVars(facts),
    skipUid: rating.ratedBy, skipNote: 'gave this rating', ref: { childId: facts.childId, ratingId }, now,
  });
  if (!ch) return 'skipped';
  await logRef.set({
    kind: 'low_rating', trigger: 'rating', firedAt: now.getTime(),
    childId: facts.childId, childName: facts.kidName, ratingId, period: facts.period,
    scorePct: facts.scorePct, linePct: rules.lowLinePct, ratedByFirst: facts.ratedByFirst,
    channels: { whatsapp: ch },
  });
  return 'sent';
}

/** ➖ R7 — points taken off. Called by the award gateway. */
export async function runDeductionWa(db: AdminDb, familyId: string, awardId: string, now = new Date()): Promise<'sent' | 'skipped'> {
  if (!waConfigured()) return 'skipped';
  const awardRef = famRef(db, familyId).collection('awards').doc(awardId);
  const raw = (await awardRef.get()).data() as { kind?: string; points?: number } | undefined;
  if (!raw || (raw.kind !== 'reducing' && (raw.points ?? 0) >= 0)) return 'skipped'; // cheap exit for every positive award
  const composed = await composeAwardFacts(db, familyId, awardId);
  if (!composed) return 'skipped';
  const { facts, award } = composed;
  if (facts.kind !== 'reducing' || facts.points >= 0) return 'skipped';
  const claimed = await db.runTransaction(async (tx) => {
    const s = await tx.get(awardRef);
    if ((s.data() as { whatsappAt?: number } | undefined)?.whatsappAt) return false;
    tx.set(awardRef, { whatsappAt: now.getTime() }, { merge: true });
    return true;
  });
  if (!claimed) return 'skipped';
  const logRef = famRef(db, familyId).collection('alertLog').doc();
  const ch = await dispatchWa(db, familyId, {
    kind: 'deduction', logId: logRef.id, vars: deductionVars(facts),
    skipUid: award.awardedBy, skipNote: 'took these points off', ref: { childId: facts.childId, awardId }, now,
  });
  if (!ch) return 'skipped';
  await logRef.set({
    kind: 'deduction', trigger: 'award', firedAt: now.getTime(),
    childId: facts.childId, childName: facts.kidName, awardId,
    points: Math.abs(facts.points), category: niceCategory(facts.category), byFirst: facts.byFirst,
    channels: { whatsapp: ch },
  });
  return 'sent';
}

/** 🪞 R5 — the WhatsApp leg of the missed-reflection alert. The reflection
 *  cron decides WHEN (D2 time · D3 rounds) and writes the alertLog entry
 *  with its bell + email channels; this returns the 📲 channel for it. */
export async function dispatchReflectionWa(
  db: AdminDb, familyId: string, a: { logId: string; childId: string; kidName: string; misses: number; now: Date },
): Promise<WaChannel | null> {
  return dispatchWa(db, familyId, {
    kind: 'reflection_miss', logId: a.logId, vars: reflectionVars(a.kidName, a.misses),
    ref: { childId: a.childId, dayKey: familyDayKey(a.now) }, now: a.now,
  });
}

// ── Quiet-hours outbox + pending tests (the 30-min flush cron) ───────────
interface OutboxDoc { kind: WaAlertKind; logId: string; vars: Record<string, string>; ref: WaOutboxRef; uids: string[]; state: 'held' | 'done'; sendAfter: number }

/** R8 — is the held alert still true at 07:00? */
async function recheckHeld(db: AdminDb, familyId: string, d: OutboxDoc, rules: WaFamilyRules): Promise<{ keep: boolean; note?: string; vars?: Record<string, string> }> {
  if (d.kind === 'low_rating' && d.ref.ratingId) {
    const composed = await composeHeatFacts(db, familyId, d.ref.ratingId);
    if (!composed) return { keep: false, note: 'rating removed' };
    const pct = composed.facts.scorePct;
    if (pct === null || pct >= rules.lowLinePct) return { keep: false, note: `now ${pct ?? '—'}%` };
    return { keep: true, vars: lowRatingVars(composed.facts) };
  }
  if (d.kind === 'deduction' && d.ref.awardId) {
    const snap = await famRef(db, familyId).collection('awards').doc(d.ref.awardId).get();
    return snap.exists ? { keep: true } : { keep: false, note: 'deduction removed' };
  }
  if (d.kind === 'reflection_miss') {
    const since = d.ref.dayKey || '';
    const snap = await famRef(db, familyId).collection('sparks_reflections').where('kidId', '==', d.ref.childId).get();
    const wrote = snap.docs.some((r) => String(r.data().date || '') >= since);
    return wrote ? { keep: false, note: 'reflection written' } : { keep: true };
  }
  return { keep: false, note: 'unknown alert' };
}

/** `onlyFamilyId` scopes a run to one family (the QA harness — so a test
 *  run can never flush a real family's held messages into a mock). */
export async function flushWa(db: AdminDb, now = new Date(), onlyFamilyId?: string): Promise<{ families: number; flushed: number; dropped: number; tests: number }> {
  const out = { families: 0, flushed: 0, dropped: 0, tests: 0 };
  const configured = waConfigured();
  if (!configured) return out; // held items wait; pending tests wait for the keys
  const fams = onlyFamilyId
    ? [await db.collection('families').doc(onlyFamilyId).get()].filter((d) => d.exists)
    : (await db.collection('families').get()).docs;
  for (const fam of fams) {
    out.families++;
    try {
      const famId = fam.id;
      // (1) Numbers saved before Kaya's keys existed — send their welcome test now.
      const pending = await linksCol(db, famId).where('state', '==', 'pending').get();
      for (const p of pending.docs) {
        const link = p.data() as WaLinkDoc;
        if (link.test?.status === 'not-configured') { await sendWaTest(db, famId, link.uid, now); out.tests++; }
      }
      // (2) Quiet-hours outbox.
      const held = await famRef(db, famId).collection('whatsappOutbox').where('state', '==', 'held').get();
      if (held.empty) continue;
      const rules = resolveWaRules((fam.data() || {}).whatsappAlerts as Partial<WaFamilyRules> | undefined);
      for (const h of held.docs) {
        const d = h.data() as OutboxDoc;
        if (d.sendAfter > now.getTime() + 60_000) continue;
        const check = await recheckHeld(db, famId, d, rules);
        const c = await waCandidates(db, famId, d.kind);
        const vars = check.vars || d.vars;
        if (check.vars) {
          await famRef(db, famId).collection('alertLog').doc(d.logId).update({ 'channels.whatsapp.vars': check.vars }).catch(() => {});
        }
        for (const uid of d.uids) {
          const cand = c?.list.find((x) => x.link.uid === uid);
          const t = now.getTime();
          if (!check.keep || !cand || !cand.eligible) {
            await updateWaRecipient(db, famId, d.logId, uid, { status: 'dropped', at: t, note: !check.keep ? (check.note || 'no longer true') : (cand?.note || (c ? 'not connected' : 'WhatsApp switched off for the family')) });
            out.dropped++;
            continue;
          }
          const r = await sendToLink(db, famId, cand.link, TEMPLATE_OF[d.kind], vars, d.logId, now);
          await updateWaRecipient(db, famId, d.logId, uid, { status: r.status, at: t, ...(r.sid ? { sid: r.sid } : {}), ...(r.note ? { note: r.note } : {}) });
          out.flushed++;
        }
        await h.ref.update({ state: 'done', doneAt: now.getTime() });
      }
    } catch { continue; }
  }
  return out;
}
