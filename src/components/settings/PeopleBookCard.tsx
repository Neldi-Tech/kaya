'use client';

// 📒 People Book (Reminders 2.0, approved 22-Aug-2026) — parent-managed
// contacts outside the family: grandparents, uncles, kids' friends (via
// their parent). Honorees for greeting cards are picked from here; kids
// PICK, never type addresses (COPPA). Lives on the family doc
// (`family.contacts`, parent-writable like emailGroups — no rules change).

import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { updateFamily } from '@/lib/firestore';
import {
  normalizeWhatsapp, formatWhatsapp, TIMEZONE_CHOICES, FAMILY_TZ_DEFAULT,
  type FamilyContact,
} from '@/lib/reminders';
import { toDisplayDate } from '@/lib/dates';

const CAL = '#5B6CC8';
const CAL_DK = '#3E4DA0';
const CAL_SOFT = '#E7EAFA';
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const RELATION_PRESETS = ['Grandmother', 'Grandfather', 'Aunt', 'Uncle', 'Cousin', 'Godparent', 'Family friend', 'Best friend', 'Classmate', 'Teacher'];

function newId(): string {
  return `c_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export interface ContactDraft {
  id: string;
  name: string;
  relationship: 'adult' | 'kid-friend';
  relation: string;
  email: string;
  whatsapp: string;
  timezone: string;
  birthday: string;
  lang: 'en' | 'sw';
}

export function blankContactDraft(): ContactDraft {
  return { id: newId(), name: '', relationship: 'adult', relation: '', email: '', whatsapp: '', timezone: FAMILY_TZ_DEFAULT, birthday: '', lang: 'en' };
}

function toDraft(c: FamilyContact): ContactDraft {
  return {
    id: c.id, name: c.name, relationship: c.relationship, relation: c.relation || '',
    email: c.email || '', whatsapp: c.whatsapp ? `+${c.whatsapp}` : '', timezone: c.timezone || FAMILY_TZ_DEFAULT,
    birthday: c.birthday || '', lang: c.lang || 'en',
  };
}

/** Validate + build a FamilyContact from a draft. Returns an error string or the contact. */
export function contactFromDraft(d: ContactDraft, addedBy: string, prev?: FamilyContact): { error: string } | { contact: FamilyContact } {
  const name = d.name.trim();
  if (!name) return { error: 'Give them a name' };
  const email = d.email.trim().toLowerCase();
  if (email && !EMAIL_RX.test(email)) return { error: 'That email doesn’t look right' };
  const wa = normalizeWhatsapp(d.whatsapp);
  if (d.whatsapp.trim() && !wa) return { error: 'WhatsApp number needs a country code, e.g. +255 712 345 678' };
  if (!email && !wa) return { error: 'Add an email or a WhatsApp number (or both)' };
  const c: FamilyContact = {
    id: d.id, name, relationship: d.relationship,
    addedBy: prev?.addedBy || addedBy, addedAt: prev?.addedAt || Date.now(),
  };
  const rel = d.relation.trim(); if (rel) c.relation = rel;
  if (email) c.email = email;
  if (wa) c.whatsapp = wa;
  if (d.timezone) c.timezone = d.timezone;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.birthday)) c.birthday = d.birthday;
  if (d.lang === 'sw') c.lang = 'sw';
  if (prev?.optOut) { c.optOut = true; if (prev.optOutAt) c.optOutAt = prev.optOutAt; }
  return { contact: c };
}

/** The shared contact form (also used inline from the reminder editor). */
export function ContactForm({ draft, setDraft, error, saving, onSave, onCancel, compact }: {
  draft: ContactDraft;
  setDraft: (d: ContactDraft) => void;
  error: string;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  compact?: boolean;
}) {
  const set = <K extends keyof ContactDraft>(k: K, v: ContactDraft[K]) => setDraft({ ...draft, [k]: v });
  const input = 'w-full rounded-kaya-sm border border-kaya-warm-dark bg-white px-2.5 py-1.5 text-xs font-medium text-kaya-chocolate';
  return (
    <div className="rounded-kaya border p-3 space-y-2.5" style={{ borderColor: CAL, background: '#FDFCFA' }}>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Name · e.g. Mama Rose" className={input} autoFocus />
        </div>
        <div className="col-span-2 flex gap-1.5">
          {([['adult', '👵 Adult'], ['kid-friend', '🧒 A kid’s friend']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => set('relationship', k)}
              className="rounded-full px-3 py-1.5 text-[11.5px] font-extrabold border"
              style={draft.relationship === k ? { background: CAL, borderColor: CAL, color: '#fff' } : { background: '#fff', borderColor: '#E8DEC9', color: '#5C6975' }}>{l}</button>
          ))}
        </div>
        <div className="col-span-2">
          <input value={draft.relation} onChange={(e) => set('relation', e.target.value)} list="kaya-relation-presets"
            placeholder={draft.relationship === 'adult' ? 'Relation · Grandmother, Uncle…' : 'Relation · Best friend, Classmate…'} className={input} />
          <datalist id="kaya-relation-presets">{RELATION_PRESETS.map((r) => <option key={r} value={r} />)}</datalist>
        </div>
        <input value={draft.email} onChange={(e) => set('email', e.target.value)} placeholder={draft.relationship === 'kid-friend' ? 'Their parent’s email' : 'Email'} className={input} inputMode="email" />
        <input value={draft.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} placeholder="WhatsApp · +255 7…" className={input} inputMode="tel" />
        {!compact && (
          <>
            <select value={draft.timezone} onChange={(e) => set('timezone', e.target.value)} className={input}>
              {TIMEZONE_CHOICES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <input type="date" value={draft.birthday} onChange={(e) => set('birthday', e.target.value)} className={input} title="Birthday (optional)" />
            <div className="col-span-2 flex items-center gap-1.5">
              <span className="text-[11px] text-kaya-sand font-bold mr-1">Card language</span>
              {([['en', 'English'], ['sw', 'Kiswahili']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => set('lang', k)}
                  className="rounded-full px-2.5 py-1 text-[11px] font-extrabold border"
                  style={draft.lang === k ? { background: CAL_SOFT, borderColor: CAL, color: CAL_DK } : { background: '#fff', borderColor: '#E8DEC9', color: '#5C6975' }}>{l}</button>
              ))}
            </div>
          </>
        )}
      </div>
      {draft.relationship === 'kid-friend' && (
        <div className="text-[10.5px] text-kaya-sand">Cards to a kid’s friend always go to the friend’s parent, with you in copy.</div>
      )}
      {error && <div className="text-[12px] text-red-600 font-bold">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="rounded-kaya-sm px-3 py-1.5 text-xs font-bold text-kaya-sand bg-white border border-kaya-warm-dark">Cancel</button>
        <button type="button" onClick={onSave} disabled={saving} className="rounded-kaya-sm px-3.5 py-1.5 text-xs font-extrabold text-white disabled:opacity-60" style={{ background: CAL }}>
          {saving ? 'Saving…' : 'Save contact'}
        </button>
      </div>
    </div>
  );
}

export default function PeopleBookCard() {
  const { profile } = useAuth();
  const { family } = useFamily();
  const familyId = profile?.familyId;
  const isParent = profile?.role === 'parent';

  const contacts: FamilyContact[] = useMemo(() => family?.contacts || [], [family?.contacts]);
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function persist(next: FamilyContact[]) {
    if (!familyId || saving) return;
    setSaving(true);
    try { await updateFamily(familyId, { contacts: next }); } catch { /* context re-renders */ }
    setSaving(false);
  }

  async function save() {
    if (!draft || !profile) return;
    const prev = contacts.find((c) => c.id === draft.id);
    const r = contactFromDraft(draft, profile.uid, prev);
    if ('error' in r) { setError(r.error); return; }
    setError('');
    const next = prev ? contacts.map((c) => (c.id === r.contact.id ? r.contact : c)) : [...contacts, r.contact];
    await persist(next);
    setDraft(null);
  }

  async function remove(id: string) {
    await persist(contacts.filter((c) => c.id !== id));
  }

  async function clearOptOut(id: string) {
    await persist(contacts.map((c) => (c.id === id ? { ...c, optOut: false } : c)));
  }

  if (!familyId || !isParent) return null;

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">📒</span>
        <h2 className="font-display font-extrabold text-kaya-chocolate">People Book</h2>
        {contacts.length > 0 && <span className="ml-auto text-[11px] font-bold text-kaya-sand">{contacts.length}</span>}
      </div>
      <p className="text-[12px] text-kaya-sand mb-3">
        The people outside Kaya your family celebrates — grandparents, uncles, the kids’ friends. Greeting cards and auto-greetings go to them; kids pick from this list, they never type an address.
      </p>

      {contacts.length > 0 && (
        <div className="space-y-2 mb-3">
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 rounded-kaya border border-kaya-warm-dark px-3 py-2.5">
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0 font-extrabold" style={{ background: CAL_SOFT, color: CAL_DK }}>
                {c.relationship === 'kid-friend' ? '🧒' : (c.name.trim()[0] || '👤').toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-extrabold text-kaya-chocolate truncate flex items-center gap-1.5">
                  {c.name}
                  {c.relation && <span className="text-[9px] font-extrabold rounded px-1.5 py-0.5" style={{ background: CAL_SOFT, color: CAL_DK }}>{c.relation.toUpperCase()}</span>}
                  {c.optOut && <span className="text-[9px] font-extrabold rounded px-1.5 py-0.5 bg-red-50 text-red-500">OPTED OUT</span>}
                </div>
                <div className="text-[11px] text-kaya-sand truncate">
                  {[c.email && `📧 ${c.email}`, c.whatsapp && `💬 ${formatWhatsapp(c.whatsapp)}`, c.birthday && `🎂 ${toDisplayDate(c.birthday)}`].filter(Boolean).join(' · ') || 'No channel yet'}
                </div>
              </div>
              {c.optOut && <button onClick={() => clearOptOut(c.id)} disabled={saving} className="rounded-kaya-sm px-2 py-1.5 text-[11px] font-bold text-kaya-sand bg-kaya-warm shrink-0" title="They asked Kaya to stop — only clear this if they asked you to">↺</button>}
              <button onClick={() => { setDraft(toDraft(c)); setError(''); }} className="rounded-kaya-sm px-2.5 py-1.5 text-[11px] font-bold text-kaya-sand bg-kaya-warm shrink-0">✏️ Edit</button>
              <button onClick={() => remove(c.id)} disabled={saving} className="rounded-kaya-sm px-2 py-1.5 text-[11px] font-bold text-red-500 bg-white border border-red-200 shrink-0">🗑️</button>
            </div>
          ))}
        </div>
      )}

      {draft ? (
        <ContactForm draft={draft} setDraft={setDraft} error={error} saving={saving} onSave={save} onCancel={() => { setDraft(null); setError(''); }} />
      ) : (
        <button onClick={() => { setDraft(blankContactDraft()); setError(''); }}
          className="w-full rounded-kaya border border-dashed px-3 py-2.5 text-[12.5px] font-extrabold" style={{ borderColor: CAL, color: CAL_DK, background: '#fff' }}>
          ＋ Add someone
        </button>
      )}
      <div className="text-[10.5px] text-kaya-sand mt-2">Every greeting carries a “stop these” link — if someone taps it, Kaya stops auto-sending to them and tells you.</div>
    </div>
  );
}
