'use client';

// ✍️ Greeting signature (Reminders 2.0, approved 22-Aug-2026) — how cards to
// ADULTS are signed (R9). Presets: "{P1} & {P2}'s Family" (default) · "The
// {Family} Family" · "{P1}, {P2}, {kids}" · custom, plus "add kids' names"
// roster line. Kids' friends + in-family cards are signed by rule, not by
// this setting. Also hosts the Kaya Writes (AI drafting) family switch.
// Stored on the family doc — parent-writable, no rules change.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getFamilyMembers, updateFamily, type UserProfile } from '@/lib/firestore';
import { buildSignature, type GreetingSignature, type SignaturePreset } from '@/lib/reminders';

const CAL = '#5B6CC8';
const CAL_DK = '#3E4DA0';
const CAL_SOFT = '#E7EAFA';

const PRESETS: Array<{ id: SignaturePreset; label: string }> = [
  { id: 'parents', label: 'Parents’ names' },
  { id: 'family', label: 'Family name' },
  { id: 'everyone', label: 'Everyone' },
  { id: 'custom', label: 'Custom' },
];

export default function GreetingSignatureCard() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const familyId = profile?.familyId;
  const isParent = profile?.role === 'parent';

  const [members, setMembers] = useState<UserProfile[]>([]);
  const [saving, setSaving] = useState(false);
  const [customDraft, setCustomDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!familyId) return;
    getFamilyMembers(familyId).then(setMembers).catch(() => setMembers([]));
  }, [familyId]);

  const sig: GreetingSignature = useMemo(() => family?.greetingSignature || { preset: 'parents' }, [family?.greetingSignature]);
  const kayaWrites = family?.greetingConfig?.kayaWrites !== false;

  const parentNames = members.filter((m) => m.role === 'parent').map((m) => m.displayName);
  const kidNames = children.map((c) => c.name);
  const ctx = { parentNames, familyName: family?.name || '', kidNames, authorName: profile?.displayName || '', relationship: 'adult' as const };
  const previewEn = buildSignature({ ...ctx, signature: { ...sig, ...(customDraft !== null ? { custom: customDraft } : {}) }, lang: 'en' });
  const previewSw = buildSignature({ ...ctx, signature: { ...sig, ...(customDraft !== null ? { custom: customDraft } : {}) }, lang: 'sw' });

  async function persist(next: GreetingSignature) {
    if (!familyId || saving) return;
    setSaving(true);
    try { await updateFamily(familyId, { greetingSignature: next }); } catch { /* context re-renders */ }
    setSaving(false);
  }
  async function setKayaWrites(on: boolean) {
    if (!familyId || saving) return;
    setSaving(true);
    try { await updateFamily(familyId, { greetingConfig: { ...(family?.greetingConfig || {}), kayaWrites: on } }); } catch { /* noop */ }
    setSaving(false);
  }

  if (!familyId || !isParent) return null;

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">✍️</span>
        <h2 className="font-display font-extrabold text-kaya-chocolate">Family signature</h2>
      </div>
      <p className="text-[12px] text-kaya-sand mb-3">
        How greeting cards to adults outside the family are signed. Cards to a kid’s friend sign “From {'{'}Kid{'}'} &amp; the family”; cards inside the family are signed by whoever writes them.
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" disabled={saving}
            onClick={() => { setCustomDraft(p.id === 'custom' ? (sig.custom || '') : null); persist({ ...sig, preset: p.id }); }}
            className="rounded-full px-3.5 py-2 text-[12.5px] font-extrabold border"
            style={sig.preset === p.id ? { background: CAL, borderColor: CAL, color: '#fff' } : { background: '#fff', borderColor: '#E8DEC9', color: '#5C6975' }}>
            {p.label}
          </button>
        ))}
      </div>

      {sig.preset === 'custom' && (
        <div className="flex gap-2 mb-3">
          <input value={customDraft ?? sig.custom ?? ''} onChange={(e) => setCustomDraft(e.target.value)} placeholder="e.g. With love from the Timotheos"
            className="flex-1 rounded-kaya-sm border border-kaya-warm-dark bg-white px-2.5 py-1.5 text-xs font-medium text-kaya-chocolate" maxLength={60} />
          <button type="button" disabled={saving || customDraft === null} onClick={() => { persist({ ...sig, custom: (customDraft || '').trim() }); setCustomDraft(null); }}
            className="rounded-kaya-sm px-3 py-1.5 text-xs font-extrabold text-white disabled:opacity-60" style={{ background: CAL }}>Save</button>
        </div>
      )}

      <div className="rounded-kaya border border-dashed px-3 py-2.5 mb-3" style={{ borderColor: CAL, background: CAL_SOFT }}>
        <div className="text-[10px] font-extrabold uppercase tracking-wide mb-1" style={{ color: CAL_DK }}>Signs as</div>
        <div className="font-display italic font-extrabold text-[15px] text-kaya-chocolate">{previewEn.line}</div>
        {previewEn.roster && <div className="text-[11px] text-kaya-sand">{previewEn.roster}</div>}
        <div className="text-[11px] text-kaya-sand mt-1">Kiswahili cards: <span className="italic font-bold">{previewSw.line}</span></div>
      </div>

      <button type="button" disabled={saving} onClick={() => persist({ ...sig, includeKids: !sig.includeKids })}
        className="w-full flex items-center gap-3 p-3 rounded-kaya-sm border border-kaya-warm-dark text-left mb-2">
        <div className={`w-10 h-6 rounded-full shrink-0 relative transition-colors ${sig.includeKids ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'}`}>
          <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all" style={{ left: sig.includeKids ? '18px' : '2px' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Add the kids’ names</p>
          <p className="text-[11px] text-kaya-sand leading-relaxed">Prints everyone’s first name under the signature.</p>
        </div>
      </button>

      <button type="button" disabled={saving} onClick={() => setKayaWrites(!kayaWrites)}
        className="w-full flex items-center gap-3 p-3 rounded-kaya-sm border border-kaya-warm-dark text-left">
        <div className={`w-10 h-6 rounded-full shrink-0 relative transition-colors ${kayaWrites ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'}`}>
          <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all" style={{ left: kayaWrites ? '18px' : '2px' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">✨ Kaya Writes</p>
          <p className="text-[11px] text-kaya-sand leading-relaxed">Kaya drafts the one-liner + message (warm · funny · formal, English or Kiswahili). You always edit before it goes.</p>
        </div>
      </button>
    </div>
  );
}
