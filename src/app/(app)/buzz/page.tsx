'use client';

// Kaya Buzz — public surface (cream + bold palette per design HTML).
// Available to every signed-in family member regardless of tier.
//
// State is intentionally simple: one /api/buzz fetch driven by the
// chosen filter + sort, plus the always-loaded /api/buzz/settings to
// know whether to render the roadmap strip. Anonymity is enforced
// server-side; the client always trusts the doc shape returned.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  DEFAULT_BUZZ_SETTINGS,
  type Buzz, type BuzzCategory, type BuzzStatus, type BuzzSettings,
} from '@/lib/buzz';
import { listBuzz } from '@/lib/buzzClient';
import { Composer } from '@/components/buzz/Composer';
import { IdeaCard } from '@/components/buzz/IdeaCard';
import { RoadmapStrip } from '@/components/buzz/RoadmapStrip';

type FilterKey = 'all' | BuzzCategory | BuzzStatus;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'idea',     label: '✨ Ideas' },
  { key: 'soon',     label: '🔮 Coming Soon' },
  { key: 'building', label: '🛠 Building' },
  { key: 'live',     label: '✅ Released' },
  { key: 'bug',      label: '🐛 Bugs' },
  { key: 'help',     label: '❓ Help' },
];

const CATEGORY_KEYS = new Set<FilterKey>(['idea', 'bug', 'help', 'story']);
const STATUS_KEYS   = new Set<FilterKey>(['new', 'review', 'soon', 'building', 'live', 'reward']);

export default function BuzzPage() {
  const { user, profile } = useAuth();
  const { family } = useFamily();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<'hot' | 'new'>('hot');
  const [buzz, setBuzz] = useState<Buzz[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<BuzzSettings>(DEFAULT_BUZZ_SETTINGS);
  const [isOperator, setIsOperator] = useState(false);

  const familyDisplayName = family?.name ?? 'My Family';
  const initials = useMemo(() => {
    if (!family?.name) return 'K';
    const words = family.name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }, [family?.name]);

  // Live settings subscription — clients are allowed to read /config/buzz.
  useEffect(() => {
    if (!user) return;
    const ref = doc(db, 'config', 'buzz');
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setSettings({ ...DEFAULT_BUZZ_SETTINGS, ...(snap.data() as Partial<BuzzSettings>) });
      } else {
        setSettings(DEFAULT_BUZZ_SETTINGS);
      }
    }, () => { /* keep defaults on rule errors */ });
    return () => unsub();
  }, [user]);

  // Operator detection (mirrors /admin pattern).
  useEffect(() => {
    if (!user?.email) { setIsOperator(false); return; }
    const ref = doc(db, 'operators', user.email.toLowerCase());
    const unsub = onSnapshot(ref, (snap) => setIsOperator(snap.exists()), () => setIsOperator(false));
    return () => unsub();
  }, [user?.email]);

  const fetchBuzz = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const opts: Parameters<typeof listBuzz>[0] = { sort };
      if (CATEGORY_KEYS.has(filter)) opts.category = filter as BuzzCategory;
      else if (STATUS_KEYS.has(filter)) opts.status = filter as BuzzStatus;
      const list = await listBuzz(opts);
      setBuzz(list);
    } catch (e) {
      // Surface load failures on the empty state so they're discoverable.
      console.warn('[buzz] list failed', e);
      setBuzz([]);
    } finally {
      setLoading(false);
    }
  }, [user, filter, sort]);

  useEffect(() => { fetchBuzz(); }, [fetchBuzz]);

  const kidDefaultAnon = profile?.role === 'kid' && settings.kidsDefaultAnonymous;
  const counts = useMemo(() => countByFilter(buzz), [buzz]);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#F2EEE3] text-[#1A2238] font-body py-10 px-4 sm:px-7 pb-24">
      <div className="max-w-[1240px] mx-auto">
        <header className="mb-8">
          <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-[#0F1F44] tracking-tight m-0">Kaya Buzz</h1>
          <p className="text-[#6E7791] text-sm mt-1">Ideas &amp; help — for every invited family on Kaya</p>
        </header>

        <section className="bg-[#FBF7EE] rounded-[32px] p-5 sm:p-9 shadow-[0_24px_60px_rgba(15,31,68,0.08)] relative overflow-hidden">
          {/* Decorative blobs */}
          <span className="pointer-events-none absolute w-[280px] h-[280px] rounded-full -top-20 -right-16 z-0"
                style={{ background: 'radial-gradient(circle,#FFE8E5 0%,transparent 70%)' }} />
          <span className="pointer-events-none absolute w-[220px] h-[220px] rounded-full -bottom-14 -left-10 z-0"
                style={{ background: 'radial-gradient(circle,#E5F7EF 0%,transparent 70%)' }} />

          {/* Title + CTA-less header (Composer is inline below the filters) */}
          <div className="flex items-center justify-between gap-4 mb-6 flex-wrap relative z-[1]">
            <div className="flex items-center gap-3.5">
              <div
                className="w-12 h-12 rounded-[14px] grid place-items-center text-white shadow-[0_8px_22px_rgba(232,92,92,0.35)]"
                style={{ background: 'linear-gradient(135deg,#E85C5C,#FFC857)' }}
                aria-hidden
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <div>
                <h2 className="font-display font-extrabold text-2xl text-[#0F1F44] m-0 tracking-tight">Light up Kaya.</h2>
                <p className="text-[13px] text-[#6E7791] mt-0.5">Share an idea, vote on others, get help — your buzz becomes our next feature.</p>
              </div>
            </div>
          </div>

          {/* Filter pills + sort */}
          <div className="flex gap-2 flex-wrap mb-5 relative z-[1]">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`px-3.5 py-2 rounded-full text-[13px] font-semibold border ${
                  filter === f.key
                    ? 'bg-[#0F1F44] text-white border-[#0F1F44]'
                    : 'bg-white text-[#0F1F44] border-[rgba(15,31,68,0.08)]'
                }`}
              >
                {f.label}
                <span className="font-bold opacity-70 ml-1.5">{counts[f.key] ?? 0}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSort(sort === 'hot' ? 'new' : 'hot')}
              className="ml-auto bg-white border border-[rgba(15,31,68,0.08)] text-[#0F1F44] px-3.5 py-2 rounded-full text-[13px] font-semibold"
              title="Toggle sort order"
            >
              Sort: {sort === 'hot' ? '🔥 Hot' : '🕒 New'}
            </button>
          </div>

          {/* Roadmap strip (gated by settings.showRoadmap) */}
          {settings.showRoadmap && <RoadmapStrip buzz={buzz} />}

          {/* Composer */}
          <Composer
            familyDisplayName={familyDisplayName}
            initials={initials}
            defaultAnonymous={kidDefaultAnon}
            storiesEnabled={settings.showStoriesCategory}
            onPosted={fetchBuzz}
          />

          {/* Idea grid */}
          {loading && buzz.length === 0 ? (
            <div className="text-[#6E7791] text-sm py-12 text-center relative z-[1]">Loading…</div>
          ) : buzz.length === 0 ? (
            <div className="text-[#6E7791] text-sm py-12 text-center relative z-[1]">
              No buzz here yet. Be the first to share an idea ✨
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 relative z-[1]">
              {buzz.map((s) => (
                <IdeaCard key={s.id} buzz={s} isOperator={isOperator} onChange={fetchBuzz} />
              ))}
            </div>
          )}

          {/* Reward strip */}
          <div
            className="mt-6 rounded-[20px] px-5 py-4 flex items-center justify-between flex-wrap gap-3.5 relative z-[1]"
            style={{ background: 'linear-gradient(135deg,#FFF4D6 0%,#FFE8E5 100%)' }}
          >
            <div>
              <strong className="font-display text-[#0F1F44] text-lg">Got an idea we ship?</strong>
              <div className="text-[#6E7791] text-[13px] mt-0.5">
                You earn the Buzz Badge, {settings.honeyCoinsPerShippedIdea} Honey Coins, and a thank-you in the changelog.
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Chip>🌟 Buzz Badge</Chip>
              <Chip>🍯 {settings.honeyCoinsPerShippedIdea} Honey Coins</Chip>
              <Chip>📜 Changelog mention</Chip>
              <Chip>☕ Founder coffee (top {settings.founderCoffeeTopN} / quarter)</Chip>
            </div>
          </div>

          {/* Help row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 relative z-[1]">
            <div className="bg-white rounded-[20px] p-5 border border-[rgba(15,31,68,0.08)] md:col-span-2">
              <h4 className="font-display font-bold text-lg text-[#0F1F44] m-0 mb-2.5 flex items-center gap-2">🧭 Need help right now?</h4>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { emoji: '🏠', label: 'Getting started' },
                  { emoji: '👨‍👩‍👧‍👦', label: 'Invite family' },
                  { emoji: '🍯', label: 'Honey Coin rates' },
                  { emoji: '🛠', label: 'Add a new chore' },
                  { emoji: '💳', label: 'Billing & tiers' },
                  { emoji: '🔒', label: 'Access controls' },
                ].map((h) => (
                  <div key={h.label} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#FBF7EE] text-[13px] text-[#0F1F44] font-semibold">
                    <span className="text-lg">{h.emoji}</span> {h.label}
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-[#0F1F44] text-white rounded-[20px] p-5 flex flex-col gap-2.5">
              <h4 className="font-display font-bold text-lg m-0 mb-1">Still stuck?</h4>
              <div className="text-[13px] text-white/85">📧 hello@ourkaya.com</div>
              <div className="text-[13px] text-white/85">💬 In-app chat — weekdays 9am–6pm EAT</div>
              <div className="text-[13px] text-white/85">📖 Help library — coming soon</div>
              <a
                href="mailto:hello@ourkaya.com"
                className="mt-1.5 bg-[#D4A847] text-[#0F1F44] px-3.5 py-2.5 rounded-xl font-bold text-[13px] text-center"
              >
                Email the team →
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-white px-3 py-1.5 rounded-full text-[12px] font-semibold text-[#0F1F44] border border-[rgba(15,31,68,0.08)]">
      {children}
    </span>
  );
}

function countByFilter(buzz: Buzz[]): Partial<Record<FilterKey, number>> {
  const out: Partial<Record<FilterKey, number>> = { all: buzz.length };
  for (const s of buzz) {
    out[s.category] = (out[s.category] ?? 0) + 1;
    out[s.status]   = (out[s.status]   ?? 0) + 1;
  }
  return out;
}
