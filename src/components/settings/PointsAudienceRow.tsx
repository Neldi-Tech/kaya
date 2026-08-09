'use client';

// 📮 Points Email Audience (approved design 2026-08-09) — the "Also send
// these to…" row under each email-notification toggle in Settings.
//
// Per type (rating / award) the family saves EXTRA recipients:
//   🧒 the kid it's about — rides the COPPA kid-email pointers (a kid
//      without a parent-set pointer silently skips; no new email entry)
//   👥 saved Email groups — one-tap chips, exactly as the groups card
//      promises ("wherever you pick email recipients")
//   ✉️ custom emails — outside addresses that get the privacy-trimmed
//      template (first name + points, no app links)
//
// Family-level + parent-only (mount is gated by the caller). Personal
// member toggles + Family contacts are untouched — this only ADDS.

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { updateFamily } from '@/lib/firestore';

type AudienceType = 'rating' | 'award';
type Audience = { kidItsAbout?: boolean; groupIds?: string[]; emails?: string[] };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function PointsAudienceRow({ type }: { type: AudienceType }) {
  const { profile } = useAuth();
  const { family } = useFamily();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  if (!family?.id || !profile?.familyId) return null;
  const aud: Audience = family.pointsEmailAudience?.[type] || {};
  const groups = family.emailGroups || [];

  const save = async (next: Audience) => {
    setSaving(true);
    try {
      await updateFamily(profile.familyId!, {
        pointsEmailAudience: {
          ...(family.pointsEmailAudience || {}),
          [type]: {
            kidItsAbout: next.kidItsAbout === true,
            groupIds: next.groupIds || [],
            emails: next.emails || [],
          },
        },
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleKid = () => save({ ...aud, kidItsAbout: !aud.kidItsAbout });
  const toggleGroup = (id: string) => {
    const cur = new Set(aud.groupIds || []);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    save({ ...aud, groupIds: Array.from(cur) });
  };
  const removeEmail = (e: string) => save({ ...aud, emails: (aud.emails || []).filter((x) => x !== e) });
  const addEmail = () => {
    const e = draft.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) return;
    if (!(aud.emails || []).includes(e)) save({ ...aud, emails: [...(aud.emails || []), e] });
    setDraft('');
    setAdding(false);
  };

  const chip = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-extrabold border-2 transition-colors disabled:opacity-50 ${
      on ? 'bg-kaya-chocolate text-kaya-gold-light border-kaya-chocolate' : 'bg-white text-kaya-chocolate border-kaya-warm-dark hover:border-kaya-sand'
    }`;

  return (
    <div className="mx-2 mb-1 -mt-1 rounded-b-kaya-sm border border-t-0 border-dashed border-kaya-gold/60 bg-kaya-gold/5 px-3 pt-2.5 pb-3">
      <p className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-kaya-gold-dark mb-2">📮 Also send these to…</p>
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-full px-3 py-1.5 text-[11.5px] font-extrabold border-2 border-kaya-warm-dark bg-kaya-warm/50 text-kaya-sand">
          👤 Me · always
        </span>
        <button type="button" disabled={saving} onClick={toggleKid} className={chip(aud.kidItsAbout === true)} aria-pressed={aud.kidItsAbout === true}>
          🧒 The kid it&apos;s about{aud.kidItsAbout ? ' ✓' : ''}
        </button>
        {groups.map((g) => (
          <button key={g.id} type="button" disabled={saving} onClick={() => toggleGroup(g.id)}
            className={chip((aud.groupIds || []).includes(g.id))} aria-pressed={(aud.groupIds || []).includes(g.id)}>
            {g.emoji || '👥'} {g.name}{(aud.groupIds || []).includes(g.id) ? ' ✓' : ''}
          </button>
        ))}
        {(aud.emails || []).map((e) => (
          <button key={e} type="button" disabled={saving} onClick={() => removeEmail(e)} title="Tap to remove" className={chip(true)}>
            ✉️ {e} <span className="opacity-60 font-normal">×</span>
          </button>
        ))}
        {adding ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } if (e.key === 'Escape') { setAdding(false); setDraft(''); } }}
              placeholder="grandma@example.com"
              className="h-8 w-44 rounded-full border-2 border-kaya-gold/70 bg-white px-3 text-[11.5px] focus:outline-none focus:ring-2 focus:ring-kaya-gold/50"
            />
            <button type="button" onClick={addEmail} disabled={!EMAIL_RE.test(draft.trim().toLowerCase())}
              className="h-8 px-2.5 rounded-full bg-kaya-gold text-kaya-chocolate text-[11px] font-black disabled:opacity-40">Add</button>
          </span>
        ) : (
          <button type="button" onClick={() => setAdding(true)}
            className="inline-flex items-center rounded-full px-3 py-1.5 text-[11.5px] font-extrabold border-2 border-dashed border-kaya-sand text-kaya-sand hover:border-kaya-gold-dark hover:text-kaya-gold-dark transition-colors">
            ＋ Add email…
          </button>
        )}
      </div>
      <p className="text-[10.5px] text-kaya-sand leading-relaxed mt-2">
        {type === 'rating'
          ? '🧒 Only the rated kid gets it (not siblings), riding the COPPA kid-email settings — kids without an approved email simply skip. ✉️ Custom emails get first name + points only, no app links.'
          : '🧒 Rides the existing 🏅 kid reward emails + COPPA settings. ✉️ Custom emails get first name + points only — the award reason stays inside the family.'}
      </p>
    </div>
  );
}
