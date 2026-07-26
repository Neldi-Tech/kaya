'use client';

// 🪄 Badge Studio (BDG PR5 · B21) — describe a badge in a sentence and Kaya
// proposes the whole thing: name, icon, tier, area, a fair threshold and WHICH
// tracker measures it. The parent edits anything, then taps Release — which
// writes it into badgeConfig.customs, so a Studio badge is minted by the same
// server-verified engine as a catalog one.
//
// 💭 Kid wishes land here too: a kid asks in their own words, the parent taps
// "shape it" to load the wish straight into the description box.

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { updateFamily } from '@/lib/firestore';
import { BADGE_AREAS, BADGE_TIERS, type BadgeArea, type BadgeTier, type BadgeConfig } from '@/lib/badgeLib';

interface Proposal {
  name: string; icon: string; tier: string; area: string; how: string;
  tracker: string; threshold: number; note: string;
}
interface Wish { id: string; childId: string; text: string; byName: string; createdAtMs: number }

/** How a tracker maps onto a stored custom badge. `points`/`streak` ride their
 *  own signals; everything else is a child_counter key; parent_confirm stores
 *  nothing and is minted by hand. */
function trackerToCustomFields(tracker: string, threshold: number): Record<string, number | string> {
  if (tracker === 'parent_confirm' || threshold <= 0) return {};
  if (tracker === 'lifetime_points') return { pointsThreshold: threshold };
  if (tracker === 'streak_days') return { streakDays: threshold };
  return { counterKey: tracker, threshold };
}

const TRACKER_LABEL: Record<string, string> = {
  lifetime_points: 'lifetime House Points',
  streak_days: 'daily-routine streak',
  quiz_correct: 'correct daily questions',
  workplan_done: 'workplan items done',
  meetings: 'family meetings attended',
  conversions: 'HP → 🍯 conversions',
  goals_reached: 'family goals reached',
  diamonds: 'Diamond awards',
  award_kindness: 'kindness awards',
  award_helping: 'helping awards',
  award_giving: 'giving awards',
  award_workplan: 'workplan awards',
  award_game: 'game awards',
  parent_confirm: 'awarded by a parent (Kaya can’t measure it)',
};

export default function BadgeStudio() {
  const { user, profile } = useAuth();
  const { family, children, refresh } = useFamily();
  const cfg: BadgeConfig | undefined = family?.badgeConfig;

  const [desc, setDesc] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const [p, setP] = useState<Proposal | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [wishes, setWishes] = useState<Wish[]>([]);

  // 💭 the kids' asks waiting to be shaped.
  useEffect(() => {
    if (!user || profile?.role !== 'parent') return;
    let live = true;
    user.getIdToken()
      .then((t) => fetch('/api/badges/wish', { headers: { Authorization: `Bearer ${t}` } }))
      .then((r) => r.json())
      .then((j: { ok?: boolean; rows?: Wish[] }) => { if (live && j.ok && j.rows) setWishes(j.rows); })
      .catch(() => {});
    return () => { live = false; };
  }, [user, profile?.role]);

  const propose = async () => {
    if (!user || !desc.trim() || thinking) return;
    setThinking(true); setError(''); setP(null); setSaved('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/badges/studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ description: desc.trim() }),
      });
      const j = await res.json() as { ok?: boolean; skipped?: boolean; proposal?: Proposal; error?: string };
      if (j.skipped) { setError('Kaya’s badge designer is not switched on for this app yet — you can still create a badge by hand below the shelves.'); return; }
      if (!j.ok || !j.proposal) { setError(j.error || 'Could not draft that one — try describing it a little differently.'); return; }
      setP(j.proposal);
    } catch {
      setError('Could not reach Kaya’s badge designer. Try again in a moment.');
    } finally { setThinking(false); }
  };

  const release = async () => {
    if (!p || !profile?.familyId || saving) return;
    setSaving(true);
    try {
      const id = `custom-${p.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}-${Math.abs(hash(p.how)) % 997}`;
      const custom = {
        id,
        name: p.name.trim() || 'New Badge',
        icon: p.icon.trim() || '🏅',
        tier: (['easy', 'medium', 'hard', 'legendary'].includes(p.tier) ? p.tier : 'medium') as BadgeTier,
        area: (BADGE_AREAS.some((a) => a.id === p.area) ? p.area : 'family') as BadgeArea,
        how: p.how.trim() || 'Awarded by a parent',
        source: 'studio' as const,
        ...trackerToCustomFields(p.tracker, p.threshold),
      };
      await updateFamily(profile.familyId, {
        badgeConfig: {
          ...(cfg ?? {}),
          customs: [...(cfg?.customs ?? []), custom],
          released: { ...(cfg?.released ?? {}), [id]: true },
        },
      } as any);
      await refresh?.();
      setSaved(`${custom.icon} ${custom.name} is live — your kids can start chasing it.`);
      setP(null); setDesc('');
    } finally { setSaving(false); }
  };

  const resolveWish = async (id: string, status: 'granted' | 'dismissed') => {
    if (!user) return;
    setWishes((w) => w.filter((x) => x.id !== id));
    try {
      const token = await user.getIdToken();
      await fetch('/api/badges/wish', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, status }),
      });
    } catch { /* the row stays open on failure; the list refreshes on reload */ }
  };

  const nameOf = (childId: string) => children.find((c) => c.id === childId);

  const field = 'w-full rounded-lg px-2.5 py-1.5 text-[12.5px] font-bold text-white';
  const fieldStyle = { background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.3)' };

  return (
    <div className="mt-4 rounded-2xl p-3.5" style={{ background: 'rgba(255,255,255,.07)', border: '1px dashed rgba(240,163,42,.55)' }}>
      <p className="text-[12.5px] font-black" style={{ color: '#F0A32A' }}>🪄 Badge Studio</p>
      <p className="text-[11px] font-bold mt-0.5 mb-2" style={{ color: '#d9c89a' }}>
        Describe the badge you want — in any language — and Kaya works out the name, icon, tier and what to track.
      </p>

      {/* 💭 kid wishes */}
      {wishes.length > 0 && (
        <div className="mb-3 rounded-xl p-2.5" style={{ background: 'rgba(255,255,255,.08)' }}>
          <p className="text-[11px] font-black mb-1.5" style={{ color: '#f3e7c8' }}>💭 Badge wishes from your kids</p>
          <ul className="space-y-1.5">
            {wishes.slice(0, 4).map((w) => {
              const kid = nameOf(w.childId);
              return (
                <li key={w.id} className="flex items-start gap-2">
                  <span className="text-[13px] shrink-0">{kid?.avatarEmoji || '🧒'}</span>
                  <p className="text-[11.5px] font-bold flex-1 min-w-0" style={{ color: '#f3e7c8' }}>
                    {w.text}
                    <span className="block text-[10px] font-semibold" style={{ color: '#c9b789' }}>
                      — {kid?.name.split(' ')[0] || w.byName}
                    </span>
                  </p>
                  <button
                    onClick={() => { setDesc(w.text); void resolveWish(w.id, 'granted'); }}
                    className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black"
                    style={{ background: '#F0A32A', color: '#241a0e' }}
                  >
                    shape it
                  </button>
                  <button
                    onClick={() => void resolveWish(w.id, 'dismissed')}
                    className="shrink-0 text-[11px] font-black"
                    style={{ color: '#c9b789' }}
                    aria-label="Dismiss this wish"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        rows={2}
        placeholder='e.g. "a badge for reading 10 books this term" · "kwa kusaidia bibi kila wiki"'
        className={field}
        style={fieldStyle}
      />
      <button
        type="button"
        disabled={thinking || !desc.trim()}
        onClick={() => void propose()}
        className="mt-2 px-3 py-1.5 rounded-full text-[11.5px] font-black disabled:opacity-50"
        style={{ background: '#F0A32A', color: '#241a0e' }}
      >
        {thinking ? '🪄 Designing…' : '🪄 Design it'}
      </button>

      {error && <p className="text-[11px] font-bold mt-2" style={{ color: '#ffc9c9' }}>{error}</p>}
      {saved && <p className="text-[11.5px] font-black mt-2" style={{ color: '#b8e6c4' }}>✓ {saved}</p>}

      {/* The proposal — every field editable before it goes live */}
      {p && (
        <div className="mt-3 rounded-xl p-3" style={{ background: 'rgba(0,0,0,.25)', border: '1px solid rgba(240,163,42,.4)' }}>
          <div className="flex items-center gap-2 mb-2">
            <input
              value={p.icon}
              onChange={(e) => setP({ ...p, icon: e.target.value })}
              className="w-12 rounded-lg px-2 py-1 text-center text-[18px]"
              style={fieldStyle}
              aria-label="Badge icon"
            />
            <input
              value={p.name}
              onChange={(e) => setP({ ...p, name: e.target.value })}
              className={field}
              style={fieldStyle}
              aria-label="Badge name"
            />
          </div>
          <input
            value={p.how}
            onChange={(e) => setP({ ...p, how: e.target.value })}
            className={`${field} mb-2`}
            style={fieldStyle}
            aria-label="How it's earned"
          />
          <div className="flex flex-wrap gap-2 mb-2">
            <select value={p.tier} onChange={(e) => setP({ ...p, tier: e.target.value })} className="rounded-lg px-2 py-1 text-[11.5px] font-bold text-white" style={fieldStyle} aria-label="Tier">
              {(Object.keys(BADGE_TIERS) as BadgeTier[]).map((t) => (
                <option key={t} value={t} style={{ color: '#241a0e' }}>{BADGE_TIERS[t].emoji} {BADGE_TIERS[t].label}</option>
              ))}
            </select>
            <select value={p.area} onChange={(e) => setP({ ...p, area: e.target.value })} className="rounded-lg px-2 py-1 text-[11.5px] font-bold text-white" style={fieldStyle} aria-label="Area">
              {BADGE_AREAS.map((a) => (
                <option key={a.id} value={a.id} style={{ color: '#241a0e' }}>{a.emoji} {a.label}</option>
              ))}
            </select>
            {p.tracker !== 'parent_confirm' && (
              <input
                type="number"
                min={1}
                value={p.threshold || ''}
                onChange={(e) => setP({ ...p, threshold: parseInt(e.target.value, 10) || 0 })}
                className="w-24 rounded-lg px-2 py-1 text-[11.5px] font-black text-right text-white"
                style={fieldStyle}
                aria-label="Threshold"
              />
            )}
          </div>
          <p className="text-[10.5px] font-bold" style={{ color: '#d9c89a' }}>
            📊 Tracks: {TRACKER_LABEL[p.tracker] || p.tracker}
            {p.tracker !== 'parent_confirm' && p.threshold > 0 ? ` · target ${p.threshold.toLocaleString('en-US')}` : ''}
          </p>
          {p.note && <p className="text-[10.5px] mt-1" style={{ color: '#c9b789' }}>{p.note}</p>}
          <div className="flex gap-2 mt-2.5">
            <button
              type="button"
              disabled={saving}
              onClick={() => void release()}
              className="px-3 py-1.5 rounded-full text-[11.5px] font-black disabled:opacity-50"
              style={{ background: '#F0A32A', color: '#241a0e' }}
            >
              {saving ? 'Releasing…' : '＋ Release to family'}
            </button>
            <button type="button" onClick={() => setP(null)} className="px-3 py-1.5 rounded-full text-[11.5px] font-black" style={{ background: 'rgba(255,255,255,.15)', color: '#f3e7c8' }}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tiny stable hash so two badges with the same name don't collide on id. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
