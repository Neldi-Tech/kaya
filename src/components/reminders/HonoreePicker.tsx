'use client';

// ✉️ Honoree picker (Reminders 2.0, approved 22-Aug-2026) — "Who's being
// celebrated?" inside the reminder editor. Picks a People-Book contact or a
// family member; sets "Let Kaya send it" + "CC parents". Shown for 🎂/💍
// always and for 🎉 once "this celebrates someone" is on (R2). Kids pick
// only — parents can add a contact inline (COPPA: no kid-typed addresses).

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updateFamily, type UserProfile, type Child } from '@/lib/firestore';
import {
  formatWhatsapp, type GreetTo, type FamilyContact, type ReminderType,
} from '@/lib/reminders';
import { ContactForm, blankContactDraft, contactFromDraft, type ContactDraft } from '@/components/settings/PeopleBookCard';

const CAL = '#5B6CC8';
const CAL_DK = '#3E4DA0';
const CAL_SOFT = '#E7EAFA';

export default function HonoreePicker({ value, onChange, type, members, kids, contacts, familyId, ownUid }: {
  value: GreetTo | null;
  onChange: (g: GreetTo | null) => void;
  type: ReminderType;
  members: UserProfile[];
  kids: Child[];
  contacts: FamilyContact[];
  familyId: string;
  ownUid: string;
}) {
  const { profile } = useAuth();
  const isParent = profile?.role === 'parent';
  const [open, setOpen] = useState(type !== 'event' || !!value);
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  // Family people: login members (parents/helpers/kids) + kid profiles without a login.
  const loginKidIds = new Set(members.filter((m) => m.role === 'kid' && m.childId).map((m) => m.childId as string));
  const familyPeople: Array<{ key: string; name: string; make: () => GreetTo }> = [
    ...members.filter((m) => m.uid !== ownUid).map((m) => ({
      key: `m:${m.uid}`, name: m.displayName,
      make: (): GreetTo => ({ memberUid: m.uid, name: m.displayName, ...(m.email ? { email: m.email } : {}), relationship: 'family', autoSend: false, ccParents: false }),
    })),
    ...kids.filter((k) => !loginKidIds.has(k.id)).map((k) => ({
      key: `k:${k.id}`, name: k.name,
      make: (): GreetTo => ({ childId: k.id, name: k.name, relationship: 'family', autoSend: false, ccParents: false }),
    })),
  ];

  function pickContact(c: FamilyContact) {
    if (c.optOut) return;
    const g: GreetTo = {
      contactId: c.id, name: c.name, relationship: c.relationship,
      autoSend: !!c.email, ccParents: true,
    };
    if (c.email) g.email = c.email;
    if (c.whatsapp) g.whatsapp = c.whatsapp;
    if (c.timezone) g.timezone = c.timezone;
    onChange(g);
  }

  const selectedKey = value?.contactId ? `c:${value.contactId}` : value?.memberUid ? `m:${value.memberUid}` : value?.childId ? `k:${value.childId}` : '';

  async function saveContact() {
    if (!draft || !profile) return;
    const r = contactFromDraft(draft, profile.uid);
    if ('error' in r) { setErr(r.error); return; }
    setSaving(true); setErr('');
    try {
      await updateFamily(familyId, { contacts: [...contacts, r.contact] });
      pickContact(r.contact);
      setDraft(null);
    } catch { setErr('Could not save — try again'); }
    setSaving(false);
  }

  if (type === 'event' && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="w-full rounded-kaya border border-dashed px-3 py-2.5 text-[12.5px] font-extrabold text-left" style={{ borderColor: CAL, color: CAL_DK, background: '#fff' }}>
        🎉 This celebrates someone → pick them (unlocks a greeting card)
      </button>
    );
  }

  const chip = (key: string, label: string, onClick: () => void, disabled = false) => (
    <button key={key} type="button" onClick={onClick} disabled={disabled}
      className="rounded-full px-3 py-1.5 text-[12px] font-extrabold border disabled:opacity-40"
      style={selectedKey === key ? { background: CAL, borderColor: CAL, color: '#fff' } : { background: '#fff', borderColor: '#E8DEC9', color: '#5C6975' }}>
      {label}
    </button>
  );

  return (
    <div className="space-y-2">
      {contacts.length > 0 && (
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-kaya-sand mb-1">📒 People Book</div>
          <div className="flex flex-wrap gap-1.5">
            {contacts.map((c) => chip(`c:${c.id}`, `${c.relationship === 'kid-friend' ? '🧒' : '👤'} ${c.name}${c.optOut ? ' (opted out)' : ''}`, () => pickContact(c), !!c.optOut))}
          </div>
        </div>
      )}
      {familyPeople.length > 0 && (
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-wide text-kaya-sand mb-1">👨‍👩‍👧 Family</div>
          <div className="flex flex-wrap gap-1.5">
            {familyPeople.map((p) => chip(p.key, p.name, () => onChange(p.make())))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {isParent && !draft && (
          <button type="button" onClick={() => { setDraft(blankContactDraft()); setErr(''); }}
            className="rounded-full px-3 py-1.5 text-[12px] font-extrabold border border-dashed" style={{ borderColor: CAL, color: CAL_DK, background: '#fff' }}>
            ＋ New person
          </button>
        )}
        {value && (
          <button type="button" onClick={() => onChange(null)} className="rounded-full px-3 py-1.5 text-[12px] font-bold text-kaya-sand bg-kaya-warm">✕ No one</button>
        )}
        {!isParent && contacts.length === 0 && familyPeople.length === 0 && (
          <span className="text-[11px] text-kaya-sand">Ask a parent to add people to the People Book.</span>
        )}
      </div>
      {draft && (
        <ContactForm draft={draft} setDraft={setDraft} error={err} saving={saving} onSave={saveContact} onCancel={() => setDraft(null)} compact />
      )}

      {value && (
        <div className="rounded-kaya border px-3 py-2.5" style={{ borderColor: CAL, background: CAL_SOFT }}>
          <div className="flex items-center gap-2">
            <span className="text-base">{value.relationship === 'kid-friend' ? '🧒' : value.relationship === 'adult' ? '👤' : '🏠'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-extrabold text-kaya-chocolate truncate">{value.name}</div>
              <div className="text-[10.5px] text-kaya-sand truncate">
                {value.relationship === 'family' ? 'In the family — card goes to chat + Moments, never a separate email'
                  : [value.email && `📧 ${value.email}`, value.whatsapp && `💬 ${formatWhatsapp(value.whatsapp)}`].filter(Boolean).join(' · ') || 'No channel — you can still make + share a card'}
              </div>
            </div>
          </div>
          {value.relationship !== 'family' && (
            <div className="mt-2 space-y-1.5">
              <button type="button" disabled={!value.email} onClick={() => onChange({ ...value, autoSend: !value.autoSend })}
                className="w-full flex items-center gap-2 bg-white border border-kaya-warm-dark rounded-kaya px-3 py-2 text-left disabled:opacity-60">
                <span className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center text-[10px] font-extrabold text-white shrink-0"
                  style={value.autoSend && value.email ? { background: CAL } : { background: '#fff', border: '1.5px solid #E8DEC9' }}>{value.autoSend && value.email ? '✓' : ''}</span>
                <span className="text-[12.5px] font-bold text-kaya-chocolate">✨ Let Kaya send it at 07:00 on the day</span>
                {!value.email && <span className="ml-auto text-[9px] font-extrabold uppercase bg-kaya-warm text-kaya-sand rounded px-1.5 py-0.5">needs email</span>}
              </button>
              {!value.email && value.whatsapp && <div className="text-[10.5px] text-kaya-sand px-1">WhatsApp is tap-to-send on the day — Kaya will prompt you.</div>}
              <button type="button" onClick={() => onChange({ ...value, ccParents: !value.ccParents })}
                className="w-full flex items-center gap-2 bg-white border border-kaya-warm-dark rounded-kaya px-3 py-2 text-left">
                <span className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center text-[10px] font-extrabold text-white shrink-0"
                  style={value.ccParents ? { background: CAL } : { background: '#fff', border: '1.5px solid #E8DEC9' }}>{value.ccParents ? '✓' : ''}</span>
                <span className="text-[12.5px] font-bold text-kaya-chocolate">👨‍👩‍👧 Parents in copy</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
