'use client';

// Kaya Reminders — the space under the Kaya nav group (approved v3 FINAL,
// 2026-06-13). Every user (parent · kid · helper) gets it. Events are 🔒
// private or 👨‍👩‍👧 shared; repeat on fixed days OR by an "N times a
// week/month" frequency; remind at a lead time via 🔔 in-app + 📧 email
// (with a recipient picker — family + add-your-own); and surface in My Day
// + a Home chip (PR B). All reads/writes route through the Admin-SDK
// /api/reminders/* endpoints — see lib/reminders header for why.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getFamilyMembers, type UserProfile } from '@/lib/firestore';
import { toDisplayDate, dayOfWeek } from '@/lib/dates';
import {
  fetchReminders, saveReminder, deleteReminder, decideReminder,
  occurrencesInRange, autoImportedEvents, isAutoImported,
  describeRepeat, formatTime, relativeDays, typeMeta,
  REMINDER_TYPES, WEEKDAY_LABELS, LEAD_PRESETS, todayKey,
  type ReminderEvent, type ReminderType, type ReminderVisibility,
  type RepeatRule, type RepeatFreq, type MonthDay, type ReminderRecipient,
} from '@/lib/reminders';
import GiftBrain from '@/components/reminders/GiftBrain';
import TimeCapsule from '@/components/reminders/TimeCapsule';

// Reminders accent (the approved indigo from the v3 mock). Scoped to this
// module via arbitrary values so it never touches the kaya-* palette.
const CAL = '#5B6CC8';
const CAL_DK = '#3E4DA0';
const CAL_SOFT = '#E7EAFA';

const MONTH_DAY_CHIPS: MonthDay[] = [1, 5, 10, 15, 20, 25, 'last'];

interface FormState {
  id?: string;
  type: ReminderType;
  title: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM or ''
  withWho: string;
  location: string;
  note: string;
  visibility: ReminderVisibility;
  freq: RepeatFreq;
  weekdays: number[];
  monthDays: MonthDay[];
  customCount: number;
  customPer: 'week' | 'month';
  endMode: 'never' | 'on' | 'after';
  endOn: string;
  endAfter: number;
  leadDays: number[];
  channelInApp: boolean;
  channelEmail: boolean;
  recipients: ReminderRecipient[];
}

function blankForm(): FormState {
  return {
    type: 'reminder', title: '', date: todayKey(), time: '', withWho: '', location: '', note: '',
    visibility: 'shared', freq: 'none', weekdays: [], monthDays: [], customCount: 3, customPer: 'week',
    endMode: 'never', endOn: '', endAfter: 10, leadDays: [1, 0], channelInApp: true, channelEmail: false,
    recipients: [],
  };
}

function formFromEvent(ev: ReminderEvent): FormState {
  const r = ev.repeat || { freq: 'none' };
  return {
    id: ev.id,
    type: ev.type, title: ev.title, date: ev.date, time: ev.time || '',
    withWho: ev.withWho || '', location: ev.location || '', note: ev.note || '',
    visibility: ev.visibility,
    freq: r.freq || 'none',
    weekdays: r.weekdays || [],
    monthDays: r.monthDays || [],
    customCount: r.customCount || 3,
    customPer: r.customPer || 'week',
    endMode: r.end?.mode || 'never',
    endOn: r.end?.onDate || '',
    endAfter: r.end?.afterCount || 10,
    leadDays: ev.leadDays?.length ? ev.leadDays : [0],
    channelInApp: ev.channels?.inApp !== false,
    channelEmail: !!ev.channels?.email,
    recipients: ev.emailRecipients || [],
  };
}

function buildRepeat(f: FormState): RepeatRule {
  const rule: RepeatRule = { freq: f.freq };
  if (f.freq === 'weekly') rule.weekdays = f.weekdays;
  if (f.freq === 'monthly') rule.monthDays = f.monthDays;
  if (f.freq === 'custom') { rule.customCount = f.customCount; rule.customPer = f.customPer; }
  if (f.freq !== 'none') {
    if (f.endMode === 'on') rule.end = { mode: 'on', onDate: f.endOn };
    else if (f.endMode === 'after') rule.end = { mode: 'after', afterCount: f.endAfter };
    else rule.end = { mode: 'never' };
  }
  return rule;
}

export default function RemindersPage() {
  const { user, profile } = useAuth();
  const { children, family } = useFamily();
  const uid = profile?.uid || '';
  const role = profile?.role;

  const [events, setEvents] = useState<ReminderEvent[]>([]);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user || !profile?.familyId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const [evs, mems] = await Promise.all([
        fetchReminders(token),
        getFamilyMembers(profile.familyId).catch(() => [] as UserProfile[]),
      ]);
      setEvents(evs);
      setMembers(mems.filter((m) => !!m.email));
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [user, profile?.familyId]);

  useEffect(() => { load(); }, [load]);

  // Auto-imported family birthdays/anniversary surface alongside manual
  // events (read-only mirrors). Children come from the family context.
  const autoEvents = useMemo(() => {
    if (!profile?.familyId) return [] as ReminderEvent[];
    const people = (children || []).map((c) => ({ id: c.id, name: c.name, birthday: c.birthday, kind: 'kid' as const }));
    return autoImportedEvents(profile.familyId, people, family || undefined);
  }, [children, family, profile?.familyId]);

  const allEvents = useMemo(() => [...events, ...autoEvents], [events, autoEvents]);

  const occurrences = useMemo(
    () => occurrencesInRange(allEvents, uid, role, { horizonDays: 60 }),
    [allEvents, uid, role],
  );
  const today = todayKey();
  const todays = occurrences.filter((o) => o.dateKey === today);
  const upcoming = occurrences.filter((o) => o.dateKey > today).slice(0, 20);

  const pending = useMemo(
    () => (role === 'parent' ? events.filter((e) => e.status === 'pending_parent') : []),
    [events, role],
  );

  function openNew() { setForm(blankForm()); setError(''); setEditorOpen(true); }
  function openEdit(ev: ReminderEvent) {
    if (isAutoImported(ev)) return; // mirrors aren't editable
    setForm(formFromEvent(ev)); setError(''); setEditorOpen(true);
  }

  async function handleSave() {
    if (!user) return;
    if (!form.title.trim()) { setError('Give it a name'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) { setError('Pick a date'); return; }
    setSaving(true); setError('');
    try {
      const token = await user.getIdToken();
      await saveReminder(token, {
        id: form.id,
        type: form.type,
        title: form.title.trim(),
        date: form.date,
        time: form.time || undefined,
        withWho: form.withWho.trim(),
        location: form.location.trim(),
        note: form.note.trim(),
        visibility: form.visibility,
        repeat: buildRepeat(form),
        leadDays: form.leadDays.length ? form.leadDays : [0],
        channels: { inApp: form.channelInApp, email: form.channelEmail },
        emailRecipients: form.channelEmail ? form.recipients : [],
      });
      setEditorOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!user || !form.id) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      await deleteReminder(token, form.id);
      setEditorOpen(false);
      await load();
    } catch {
      setError('Could not delete');
    } finally {
      setSaving(false);
    }
  }

  async function decide(ev: ReminderEvent, decision: 'approve' | 'decline') {
    if (!user) return;
    const token = await user.getIdToken();
    await decideReminder(token, ev.id, decision).catch(() => {});
    await load();
  }

  return (
    <div className="px-4 lg:px-8 py-6 max-w-3xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-display font-extrabold text-kaya-chocolate flex items-center gap-2">
            <span>📅</span> Reminders
          </h1>
          <p className="text-sm text-kaya-sand mt-1">
            Birthdays, anniversaries, appointments &amp; special days — private or shared with the family.
          </p>
        </div>
        <button
          onClick={openNew}
          className="shrink-0 rounded-kaya px-4 py-2.5 text-white font-bold text-sm shadow-sm"
          style={{ background: CAL }}
        >
          + New
        </button>
      </div>

      {/* Parent approvals */}
      {pending.length > 0 && (
        <div className="rounded-kaya border border-dashed p-4 mb-5" style={{ borderColor: CAL, background: CAL_SOFT }}>
          <div className="text-xs font-extrabold uppercase tracking-wide mb-2" style={{ color: CAL_DK }}>
            👶 Share requests
          </div>
          {pending.map((ev) => (
            <div key={ev.id} className="flex items-center gap-2 py-1.5">
              <span className="text-lg">{typeMeta(ev.type).icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-kaya-chocolate truncate">{ev.title}</div>
                <div className="text-[11px] text-kaya-sand">{ev.ownerName || 'A kid'} wants to share with the family</div>
              </div>
              <button onClick={() => decide(ev, 'approve')} className="rounded-kaya-sm px-3 py-1.5 text-xs font-bold text-white" style={{ background: CAL }}>Approve</button>
              <button onClick={() => decide(ev, 'decline')} className="rounded-kaya-sm px-3 py-1.5 text-xs font-bold text-kaya-sand bg-white border border-kaya-warm-dark">Keep private</button>
            </div>
          ))}
        </div>
      )}

      {/* 🎁 Gift Brain — parents only (never spoil the surprise). */}
      {role === 'parent' && <GiftBrain occurrences={occurrences} children={children} />}

      {/* 📮 Time Capsule — everyone can seal a future message. */}
      {profile?.familyId && <TimeCapsule members={members} ownUid={uid} familyId={profile.familyId} />}

      {loading ? (
        <div className="text-center text-kaya-sand py-16 text-sm">Loading your reminders…</div>
      ) : (
        <>
          {/* Today */}
          {todays.length > 0 && (
            <Section label="Today">
              {todays.map((o) => <Row key={`${o.event.id}-${o.dateKey}`} o={o} onTap={() => openEdit(o.event)} />)}
            </Section>
          )}

          {/* Coming up */}
          <Section label="Coming up">
            {upcoming.length === 0 && todays.length === 0 ? (
              <EmptyState onNew={openNew} />
            ) : upcoming.length === 0 ? (
              <div className="text-sm text-kaya-sand px-1 py-2">Nothing else on the horizon. 🌤️</div>
            ) : (
              upcoming.map((o) => <Row key={`${o.event.id}-${o.dateKey}`} o={o} onTap={() => openEdit(o.event)} />)
            )}
          </Section>
        </>
      )}

      {editorOpen && (
        <Editor
          form={form}
          setForm={setForm}
          members={members}
          ownUid={uid}
          saving={saving}
          error={error}
          onClose={() => setEditorOpen(false)}
          onSave={handleSave}
          onDelete={form.id ? handleDelete : undefined}
        />
      )}
    </div>
  );
}

// ── List bits ──────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="text-[11px] font-extrabold uppercase tracking-wider text-kaya-sand mb-2 px-1">{label}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ o, onTap }: { o: ReturnType<typeof occurrencesInRange>[number]; onTap: () => void }) {
  const ev = o.event;
  const meta = typeMeta(ev.type);
  const sub = [ev.withWho && `with ${ev.withWho}`, ev.location].filter(Boolean).join(' · ');
  const auto = isAutoImported(ev);
  return (
    <button
      onClick={onTap}
      className="w-full text-left flex items-center gap-3 bg-white rounded-kaya border border-kaya-warm-dark px-3 py-2.5 hover:border-[#5B6CC8]"
    >
      <span className="w-9 h-9 rounded-kaya-sm flex items-center justify-center text-lg shrink-0" style={{ background: CAL_SOFT }}>{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-kaya-chocolate truncate flex items-center gap-1.5">
          {ev.title}
          {ev.visibility === 'shared'
            ? <span className="text-[8.5px] font-extrabold rounded px-1.5 py-0.5" style={{ background: '#E1F3E8', color: '#3FAF6C' }}>FAMILY</span>
            : <span className="text-[8.5px] font-extrabold rounded px-1.5 py-0.5" style={{ background: '#EFEAFB', color: '#6B4FC0' }}>PRIVATE</span>}
          {auto && <span className="text-[8.5px] font-extrabold rounded px-1.5 py-0.5 text-kaya-sand bg-kaya-warm">AUTO</span>}
        </div>
        <div className="text-[11px] text-kaya-sand truncate">
          {sub || describeRepeat(ev.repeat)}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-extrabold" style={{ color: CAL_DK }}>{relativeDays(o.daysAway, o.dateKey)}</div>
        {ev.time && <div className="text-[11px] text-kaya-sand">{formatTime(ev.time)}</div>}
      </div>
    </button>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="text-center py-12">
      <div className="text-4xl mb-2">📅</div>
      <div className="font-bold text-kaya-chocolate">No reminders yet</div>
      <div className="text-sm text-kaya-sand mt-1 mb-4">Never miss a birthday, appointment or special day.</div>
      <button onClick={onNew} className="rounded-kaya px-5 py-2.5 text-white font-bold text-sm" style={{ background: CAL }}>+ Add your first reminder</button>
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────

function Editor({
  form, setForm, members, ownUid, saving, error, onClose, onSave, onDelete,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  members: UserProfile[];
  ownUid: string;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const toggleArr = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // Recipient checklist state derived from members + the saved external list.
  const memberEmails = new Set(members.map((m) => (m.email || '').toLowerCase()));
  const externals = form.recipients.filter((r) => r.kind === 'external' || !memberEmails.has(r.email.toLowerCase()));
  const isMemberChecked = (email: string) => form.recipients.some((r) => r.email.toLowerCase() === email.toLowerCase());

  function toggleMember(m: UserProfile) {
    const email = (m.email || '').toLowerCase();
    if (!email) return;
    setForm((f) => {
      const has = f.recipients.some((r) => r.email.toLowerCase() === email);
      if (has) return { ...f, recipients: f.recipients.filter((r) => r.email.toLowerCase() !== email) };
      return { ...f, recipients: [...f.recipients, { kind: 'member', email, uid: m.uid, name: m.displayName }] };
    });
  }

  const [extInput, setExtInput] = useState('');
  function addExternal() {
    const email = extInput.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    setForm((f) => (f.recipients.some((r) => r.email.toLowerCase() === email)
      ? f
      : { ...f, recipients: [...f.recipients, { kind: 'external', email }] }));
    setExtInput('');
  }
  function removeRecipient(email: string) {
    setForm((f) => ({ ...f, recipients: f.recipients.filter((r) => r.email.toLowerCase() !== email.toLowerCase()) }));
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-kaya-cream w-full sm:max-w-lg rounded-t-kaya-lg sm:rounded-kaya-lg max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-kaya-cream border-b border-kaya-warm-dark px-4 py-3 flex items-center justify-between z-10">
          <div className="font-display font-extrabold text-kaya-chocolate">{form.id ? 'Edit reminder' : 'New reminder'}</div>
          <button onClick={onClose} className="text-kaya-sand text-xl leading-none px-2">✕</button>
        </div>

        <div className="p-4 space-y-5">
          {/* Type */}
          <Field label="Type">
            <div className="flex flex-wrap gap-2">
              {REMINDER_TYPES.map((t) => (
                <Chip key={t.id} on={form.type === t.id} onClick={() => set('type', t.id)}>
                  {t.icon} {t.label}
                </Chip>
              ))}
            </div>
          </Field>

          {/* Title */}
          <Field label="What's it for?">
            <input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. Nathan's dentist · Grandma's birthday"
              className="w-full rounded-kaya border border-kaya-warm-dark bg-white px-3 py-2.5 text-sm font-medium text-kaya-chocolate"
            />
          </Field>

          {/* Date + time */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)}
                className="w-full rounded-kaya border border-kaya-warm-dark bg-white px-3 py-2.5 text-sm font-medium text-kaya-chocolate" />
              {form.date && <div className="text-[11px] text-kaya-sand mt-1">{dayOfWeek(form.date)} · {toDisplayDate(form.date)}</div>}
            </Field>
            <Field label="Time (optional)">
              <input type="time" value={form.time} onChange={(e) => set('time', e.target.value)}
                className="w-full rounded-kaya border border-kaya-warm-dark bg-white px-3 py-2.5 text-sm font-medium text-kaya-chocolate" />
            </Field>
          </div>

          {/* With / Where */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="With (optional)">
              <input value={form.withWho} onChange={(e) => set('withWho', e.target.value)} placeholder="e.g. Mum"
                className="w-full rounded-kaya border border-kaya-warm-dark bg-white px-3 py-2.5 text-sm font-medium text-kaya-chocolate" />
            </Field>
            <Field label="Where (optional)">
              <input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Dr. Mvungi, Masaki"
                className="w-full rounded-kaya border border-kaya-warm-dark bg-white px-3 py-2.5 text-sm font-medium text-kaya-chocolate" />
            </Field>
          </div>

          {/* Note */}
          <Field label="Note (optional)">
            <input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="e.g. Bring the referral form"
              className="w-full rounded-kaya border border-kaya-warm-dark bg-white px-3 py-2.5 text-sm font-medium text-kaya-chocolate" />
          </Field>

          {/* Visibility */}
          <Field label="Who can see it?">
            <div className="flex gap-2">
              <Chip on={form.visibility === 'private'} onClick={() => set('visibility', 'private')}>🔒 Private</Chip>
              <Chip on={form.visibility === 'shared'} onClick={() => set('visibility', 'shared')}>👨‍👩‍👧 Shared</Chip>
            </div>
          </Field>

          {/* Repeats */}
          <Field label="Repeats">
            <div className="flex flex-wrap gap-2">
              {(['none', 'daily', 'weekly', 'monthly', 'yearly', 'custom'] as RepeatFreq[]).map((fq) => (
                <Chip key={fq} on={form.freq === fq} onClick={() => set('freq', fq)}>
                  {fq === 'none' ? "Doesn't" : fq === 'custom' ? 'Custom ✦' : fq[0].toUpperCase() + fq.slice(1)}
                </Chip>
              ))}
            </div>

            {form.freq === 'weekly' && (
              <div className="mt-3">
                <div className="flex gap-1.5">
                  {WEEKDAY_LABELS.map((lab, i) => (
                    <button key={i} onClick={() => set('weekdays', toggleArr(form.weekdays, i))}
                      className="w-9 h-9 rounded-full text-xs font-extrabold border transition"
                      style={form.weekdays.includes(i)
                        ? { background: CAL, borderColor: CAL_DK, color: '#fff' }
                        : { background: '#fff', borderColor: '#E8DEC9', color: '#5C6975' }}>
                      {lab}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {form.freq === 'monthly' && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {MONTH_DAY_CHIPS.map((d) => (
                  <button key={String(d)} onClick={() => set('monthDays', toggleArr(form.monthDays, d))}
                    className="min-w-[34px] h-8 px-2 rounded-kaya-sm text-xs font-bold border transition"
                    style={form.monthDays.includes(d)
                      ? { background: CAL, borderColor: CAL_DK, color: '#fff' }
                      : { background: '#fff', borderColor: '#E8DEC9', color: '#5C6975' }}>
                    {d === 'last' ? 'Last' : d}
                  </button>
                ))}
              </div>
            )}

            {form.freq === 'custom' && (
              <div className="mt-3">
                <div className="flex items-center gap-2 bg-white border border-kaya-warm-dark rounded-kaya px-3 py-2 text-sm font-bold text-kaya-chocolate">
                  Remind me
                  <input type="number" min={1} max={30} value={form.customCount}
                    onChange={(e) => set('customCount', Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 1)))}
                    className="w-14 text-center rounded-kaya-sm px-1 py-1 font-extrabold" style={{ background: CAL_SOFT, color: CAL_DK }} />
                  ×  per
                  <select value={form.customPer} onChange={(e) => set('customPer', e.target.value as 'week' | 'month')}
                    className="rounded-kaya-sm px-2 py-1 font-extrabold" style={{ background: CAL_SOFT, color: CAL_DK }}>
                    <option value="week">week</option>
                    <option value="month">month</option>
                  </select>
                </div>
                <div className="text-[11px] mt-2 rounded-kaya-sm px-2.5 py-1.5 inline-block font-bold" style={{ background: CAL_SOFT, color: CAL_DK }}>
                  ↪ {form.customCount}× a {form.customPer} — Kaya spreads them, no fixed day
                </div>
              </div>
            )}

            {form.freq !== 'none' && (
              <div className="mt-3">
                <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-kaya-sand mb-1.5">Ends</div>
                <div className="flex flex-wrap gap-2 items-center">
                  <Chip on={form.endMode === 'never'} onClick={() => set('endMode', 'never')}>Never</Chip>
                  <Chip on={form.endMode === 'on'} onClick={() => set('endMode', 'on')}>On a date</Chip>
                  <Chip on={form.endMode === 'after'} onClick={() => set('endMode', 'after')}>After N times</Chip>
                  {form.endMode === 'on' && (
                    <input type="date" value={form.endOn} onChange={(e) => set('endOn', e.target.value)}
                      className="rounded-kaya-sm border border-kaya-warm-dark bg-white px-2 py-1.5 text-sm" />
                  )}
                  {form.endMode === 'after' && (
                    <input type="number" min={1} value={form.endAfter} onChange={(e) => set('endAfter', Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-16 rounded-kaya-sm border border-kaya-warm-dark bg-white px-2 py-1.5 text-sm text-center" />
                  )}
                </div>
              </div>
            )}
          </Field>

          {/* Remind me — lead times */}
          <Field label="Remind me">
            <div className="flex flex-wrap gap-2">
              {LEAD_PRESETS.map((p) => (
                <Chip key={p.days} on={form.leadDays.includes(p.days)} onClick={() => set('leadDays', toggleArr(form.leadDays, p.days))}>
                  {p.label}
                </Chip>
              ))}
            </div>
          </Field>

          {/* Channels */}
          <Field label="Notify by">
            <div className="space-y-2">
              <ChannelRow on={form.channelInApp} onToggle={() => set('channelInApp', !form.channelInApp)} label="🔔 In-app notification" />
              <ChannelRow on={form.channelEmail} onToggle={() => set('channelEmail', !form.channelEmail)} label="📧 Email" />
              <div className="flex items-center gap-2.5 bg-white border border-kaya-warm-dark rounded-kaya px-3 py-2.5 opacity-60">
                <span className="w-[18px] h-[18px] rounded-[5px] border-[1.5px] border-kaya-warm-dark shrink-0" />
                <span className="text-sm font-bold text-kaya-chocolate">💬 WhatsApp</span>
                <span className="ml-auto text-[9px] font-extrabold uppercase tracking-wide bg-kaya-warm text-kaya-sand rounded px-1.5 py-0.5">Coming later</span>
              </div>
            </div>
          </Field>

          {/* Email recipients */}
          {form.channelEmail && (
            <Field label="Email to — pick + add">
              <div className="bg-white border border-kaya-warm-dark rounded-kaya px-3 py-2.5">
                {members.length === 0 && <div className="text-[11px] text-kaya-sand py-1">No family emails on file yet.</div>}
                {members.map((m) => {
                  const email = (m.email || '').toLowerCase();
                  const checked = isMemberChecked(email);
                  return (
                    <button key={m.uid} onClick={() => toggleMember(m)} className="w-full flex items-center gap-2 py-1.5 text-left">
                      <span className="w-[17px] h-[17px] rounded-[5px] flex items-center justify-center text-[10px] font-extrabold text-white shrink-0"
                        style={checked ? { background: CAL } : { background: '#fff', border: '1.5px solid #E8DEC9' }}>
                        {checked ? '✓' : ''}
                      </span>
                      <span className="text-[12.5px] font-bold text-kaya-chocolate">
                        {roleEmoji(m.role)} {m.displayName}{m.uid === ownUid ? ' (you)' : ''}
                      </span>
                      <span className="ml-auto text-[10.5px] text-kaya-sand truncate max-w-[42%]">{m.email}</span>
                    </button>
                  );
                })}
                <div className="flex gap-2 mt-2 border-t border-dashed border-kaya-warm-dark pt-2.5">
                  <input value={extInput} onChange={(e) => setExtInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExternal(); } }}
                    placeholder="grandma@example.com"
                    className="flex-1 rounded-kaya-sm border border-kaya-warm-dark px-2.5 py-1.5 text-xs font-medium text-kaya-chocolate" />
                  <button onClick={addExternal} className="rounded-kaya-sm px-3 py-1.5 text-xs font-extrabold text-white" style={{ background: CAL }}>+ Add</button>
                </div>
                {externals.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {externals.map((r) => (
                      <span key={r.email} className="inline-flex items-center gap-1.5 text-[11px] font-bold rounded-full px-2.5 py-1" style={{ background: CAL_SOFT, color: CAL_DK }}>
                        ✉️ {r.email}
                        <button onClick={() => removeRecipient(r.email)} className="opacity-60 hover:opacity-100">✕</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-[11px] text-kaya-sand mt-1.5">Tick family members (their Kaya email is pre-filled) and add any outside address. Saved on this reminder for re-use.</div>
            </Field>
          )}

          {error && <div className="text-sm text-red-600 font-medium">{error}</div>}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {onDelete && (
              <button onClick={onDelete} disabled={saving} className="rounded-kaya px-4 py-2.5 text-sm font-bold text-red-600 bg-white border border-red-200">
                Delete
              </button>
            )}
            <div className="flex-1" />
            <button onClick={onClose} className="rounded-kaya px-4 py-2.5 text-sm font-bold text-kaya-sand bg-white border border-kaya-warm-dark">Cancel</button>
            <button onClick={onSave} disabled={saving} className="rounded-kaya px-6 py-2.5 text-sm font-extrabold text-white disabled:opacity-60" style={{ background: CAL }}>
              {saving ? 'Saving…' : form.id ? 'Save' : 'Add reminder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-kaya-sand mb-2">{label}</div>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="text-xs font-bold rounded-kaya-sm px-3 py-2 border transition"
      style={on ? { background: CAL_SOFT, borderColor: CAL, color: CAL_DK } : { background: '#fff', borderColor: '#E8DEC9', color: '#5C6975' }}>
      {children}
    </button>
  );
}

function ChannelRow({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-2.5 bg-white border border-kaya-warm-dark rounded-kaya px-3 py-2.5 text-left">
      <span className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center text-[11px] font-extrabold text-white shrink-0"
        style={on ? { background: '#3FAF6C' } : { background: '#fff', border: '1.5px solid #E8DEC9' }}>
        {on ? '✓' : ''}
      </span>
      <span className="text-sm font-bold text-kaya-chocolate">{label}</span>
    </button>
  );
}

function roleEmoji(role: string | undefined): string {
  switch (role) {
    case 'parent': return '👨';
    case 'helper': return '🤝';
    case 'kid': return '🧒';
    default: return '👤';
  }
}
