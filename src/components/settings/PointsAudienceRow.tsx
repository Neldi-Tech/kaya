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
//
// 🔥 Points Emails 2.0 (approved 23-Aug-2026) — the rating row also hosts:
//   • REPORT DETAIL — 🔥 Heat Report (every task in colour + reasons +
//     this week; default) vs Totals only (today's card). Family tier only;
//     outside addresses always get totals.
//   • 🧒 KIDS SEE THE FEEDBACK — send kids their Heat Report (= the 🧒 chip)
//     · include your reasons · ask for their side · 📬 Feedback card in My
//     Stats. All default ON. The kid's ADDRESS still comes only from the
//     COPPA pointer in Household Setup.
//   • 👁️ Preview — composes the latest rating's emails server-side
//     (nothing sends) so a parent sees exactly what goes out.

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { updateFamily, getRecentRatings } from '@/lib/firestore';
import { auth as fbAuth } from '@/lib/firebase';

type AudienceType = 'rating' | 'award';
type Audience = { kidItsAbout?: boolean; groupIds?: string[]; emails?: string[] };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function PointsAudienceRow({ type }: { type: AudienceType }) {
  const { profile } = useAuth();
  const { family } = useFamily();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<null | { busy: boolean; error?: string; tier: 'family' | 'kid' | 'outside'; html?: { family: string; kid: string; outside: string }; subjects?: { family: string; kid: string; outside: string }; tiers?: { family: string[]; outside: string[]; kid: string | null } }>(null);

  if (!family?.id || !profile?.familyId) return null;
  const detail: 'heat' | 'totals' = family.pointsEmailDetail === 'totals' ? 'totals' : 'heat';
  const kf = family.kidFeedback || {};
  const kidFeedback = {
    includeReasons: kf.includeReasons !== false,
    askReflection: kf.askReflection !== false,
    inAppInbox: kf.inAppInbox !== false,
  };
  const saveDetail = async (d: 'heat' | 'totals') => {
    setSaving(true);
    try { await updateFamily(profile.familyId!, { pointsEmailDetail: d }); } finally { setSaving(false); }
  };
  const saveKidFeedback = async (patch: Partial<typeof kidFeedback>) => {
    setSaving(true);
    try { await updateFamily(profile.familyId!, { kidFeedback: { ...kidFeedback, ...patch } }); } finally { setSaving(false); }
  };
  const openPreview = async () => {
    setPreview({ busy: true, tier: 'family' });
    try {
      const recent = await getRecentRatings(profile.familyId!, 30);
      const latest = recent[0];
      if (!latest) { setPreview({ busy: false, tier: 'family', error: 'No routine rating yet — rate a routine first, then preview.' }); return; }
      const token = await fbAuth.currentUser?.getIdToken();
      const res = await fetch('/api/points/rating-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ratingId: latest.id, mode: 'preview' }),
      });
      const data = await res.json();
      if (!res.ok) { setPreview({ busy: false, tier: 'family', error: data?.error === 'admin-unavailable' ? 'Preview needs the server — try on ourkaya.com.' : (data?.error || 'Could not build the preview.') }); return; }
      setPreview({ busy: false, tier: 'family', html: data.html, subjects: data.subjects, tiers: data.tiers });
    } catch { setPreview({ busy: false, tier: 'family', error: 'Could not build the preview.' }); }
  };
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
      {type === 'rating' && (
        <div className="mt-3 pt-3 border-t border-dashed border-kaya-gold/50">
          <p className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-kaya-gold-dark mb-1.5">🔥 Report detail</p>
          <div className="flex rounded-kaya-sm border-2 border-kaya-warm-dark overflow-hidden bg-white">
            {([['heat', '🔥 Heat Report'], ['totals', 'Totals only']] as const).map(([k, l]) => (
              <button key={k} type="button" disabled={saving} onClick={() => saveDetail(k)} aria-pressed={detail === k}
                className={`flex-1 py-2 text-[11.5px] font-extrabold transition-colors ${detail === k ? 'bg-kaya-chocolate text-kaya-gold-light' : 'text-kaya-sand hover:bg-kaya-warm/40'}`}>
                {l}
              </button>
            ))}
          </div>
          <p className="text-[10.5px] text-kaya-sand leading-relaxed mt-1.5">
            Heat Report = every task in colour + the reasons + this week. Family only — outside addresses always get totals.
            <button type="button" onClick={openPreview} className="ml-1.5 font-extrabold text-kaya-gold-dark underline decoration-dotted">👁️ Preview with the latest rating</button>
          </p>

          <div className="mt-3 ml-2 pl-3 border-l-2 border-dashed border-kaya-gold/50">
            <p className="text-[9.5px] uppercase tracking-[0.14em] font-bold text-kaya-gold-dark mb-1.5">🧒 Kids see the feedback</p>
            {([
              { key: 'kid' as const, on: aud.kidItsAbout === true, label: 'Send kids their Heat Report', desc: 'Kid-voiced version of the same colours. Needs the kid’s email pointer (Setup → 👧👦).', onTap: toggleKid },
              { key: 'includeReasons' as const, on: kidFeedback.includeReasons, label: 'Include your reasons', desc: '“Diana’s note: …” on needs-work and excellent tasks. Off = colours only.', onTap: () => saveKidFeedback({ includeReasons: !kidFeedback.includeReasons }) },
              { key: 'askReflection' as const, on: kidFeedback.askReflection, label: 'Ask for their side', desc: '💭 button → their reflection lands in your next report + Reports.', onTap: () => saveKidFeedback({ askReflection: !kidFeedback.askReflection }) },
              { key: 'inAppInbox' as const, on: kidFeedback.inAppInbox, label: '📬 Feedback card in My Stats', desc: 'In-app list of every report — works even without email.', onTap: () => saveKidFeedback({ inAppInbox: !kidFeedback.inAppInbox }) },
            ]).map((t) => (
              <button key={t.key} type="button" disabled={saving} onClick={t.onTap} aria-pressed={t.on}
                className="w-full flex items-start gap-2.5 p-2 mb-1.5 rounded-kaya-sm border border-kaya-warm-dark bg-white hover:border-kaya-sand-light text-left transition-colors disabled:opacity-60">
                <div className={`w-9 h-5 rounded-full shrink-0 mt-0.5 relative transition-colors ${t.on ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'}`}>
                  <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all" style={{ left: t.on ? '18px' : '2px' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold">{t.label}</p>
                  <p className="text-[10.5px] text-kaya-sand leading-relaxed">{t.desc}</p>
                </div>
              </button>
            ))}
            <p className="text-[10.5px] text-kaya-sand leading-relaxed">
              Tone follows your Points mode (<b>{family.pointsMode === 'encouragement' ? 'Encouragement' : family.pointsMode === 'badges-only' ? 'Badges only' : 'Full'}</b>):
              {family.pointsMode === 'encouragement' ? ' 👎 becomes 🌱 Growing, no score.' : family.pointsMode === 'badges-only' ? ' colours + words, no numbers.' : ' kids see 🌟 👍 👎 and their points.'}
            </p>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[80] bg-black/50 flex items-end sm:items-center justify-center p-2 sm:p-6" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-kaya-lg w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-kaya-warm-dark">
              <p className="text-[12.5px] font-extrabold flex-1">👁️ Preview · latest rating · nothing is sent</p>
              <button type="button" onClick={() => setPreview(null)} className="text-[12px] font-extrabold text-kaya-sand px-2">✕</button>
            </div>
            {preview.busy ? (
              <p className="p-6 text-center text-[12.5px] text-kaya-sand">Composing…</p>
            ) : preview.error ? (
              <p className="p-6 text-center text-[12.5px] text-kaya-sand">{preview.error}</p>
            ) : preview.html ? (
              <>
                <div className="flex gap-1.5 px-3 py-2 border-b border-kaya-warm-dark overflow-x-auto">
                  {([['family', '👨‍👩‍👧 Family', preview.tiers?.family.length ?? 0], ['kid', '🧒 Kid', preview.tiers?.kid ? 1 : 0], ['outside', '✉️ Outside', preview.tiers?.outside.length ?? 0]] as const).map(([k, l, n]) => (
                    <button key={k} type="button" onClick={() => setPreview({ ...preview, tier: k })}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-extrabold whitespace-nowrap ${preview.tier === k ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'}`}>
                      {l} · {n}
                    </button>
                  ))}
                </div>
                <p className="px-3 py-1.5 text-[10.5px] text-kaya-sand border-b border-kaya-warm-dark">
                  <b>To:</b> {preview.tier === 'kid' ? (preview.tiers?.kid || 'no kid email pointer set') : (preview.tiers?.[preview.tier] || []).join(', ') || 'nobody (by current settings)'}<br />
                  <b>Subject:</b> {preview.subjects?.[preview.tier]}
                </p>
                <iframe title="Email preview" className="flex-1 w-full min-h-[60vh] bg-[#FDFBF7]" sandbox="" srcDoc={preview.html[preview.tier]} />
              </>
            ) : null}
          </div>
        </div>
      )}

      <p className="text-[10.5px] text-kaya-sand leading-relaxed mt-2">
        {type === 'rating'
          ? '🧒 Only the rated kid gets it (not siblings), riding the COPPA kid-email settings — kids without an approved email simply skip. ✉️ Custom emails get first name + points + counts only, no app links.'
          : '🧒 Rides the existing 🏅 kid reward emails + COPPA settings. ✉️ Custom emails get first name + points only — the award reason stays inside the family.'}
      </p>
    </div>
  );
}
