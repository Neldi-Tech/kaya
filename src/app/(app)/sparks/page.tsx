'use client';

// Kaya Sparks · module landing (/sparks).
//
// Parent / helper hero + rich pitch. Kids skip the page entirely —
// they auto-redirect to their own /sparks/[kidId].
//
// Surface (Premium aesthetic per spec § 7 — navy / gold / cream):
//
//   1. Hero — what Sparks is, in plain English, with the breadth front
//      and centre (education + talent + PTM + 5 areas + AI companion).
//   2. Plan strip — current Sparks tier + AI status.
//   3. Pick a child — kid selector tiles (Slice 1 surface, kept intact).
//   4. What's inside — the 5 area-block deep-dives + the "Kid Profile"
//      backbone card. Lifts the mockup's Step 3 1:1.
//   5. Your AI companion — navy → purple → mint gradient block with 4
//      AI cards (reminders / pattern / talent / term summary).
//   6. Scan once. AI does the labelling — 3 scan capability cards + the
//      end-to-end 5-step flow strip. Pulls in the pre-submission
//      highlights pitch.
//   7. How Sparks works — 4 principles cards.
//   8. Setup link.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useSparksFeatures } from '@/lib/sparks/gating';
import {
  SPARKS_AREA_META, SPARKS_AREA_ORDER, type SparksArea,
} from '@/lib/sparks/schema';
import KidAvatar from '@/components/ui/KidAvatar';
import SparksIcon from '@/components/brand/SparksIcon';

// ── Marketing copy data ──────────────────────────────────────────────
// Pulled from `Kaya-Sparks_Mockup_2026-05-27.html` § Step 3. Each area
// gets the same badge / purpose / feature-list / AI tag / workplan tag
// shape the mockup designs around. Keep edits in lockstep with the
// mockup so the parent landing stays faithful.

type Badge = '01 · Capture' | '02 · Capture + Action' | '03 · Capture' | '04 · Action' | '05 · Action' | '06 · Practice Loop';

const AREA_PITCH: Record<SparksArea, {
  badge: Badge;
  badgeBg: string;
  badgeFg: string;
  cornerBg: string;
  purpose: string;
  features: string[];
  aiTag: string;
  workplanTag?: string;
}> = {
  school_project: {
    badge: '01 · Capture',
    badgeBg: '#FFE7E0', badgeFg: '#E85C5C', cornerBg: '#FF6B6B',
    purpose: 'A permanent home for the artwork, models, and designs kids bring back from school. No more shelved and forgotten.',
    features: [
      'Photo + description + date + subject',
      'Upcoming projects (assigned by teachers)',
      'Searchable gallery per child, per year',
      "Year-end “best of” auto-collection",
    ],
    aiTag: '✨ AI auto-tags subject + skill',
    workplanTag: '📅 Upcoming → Workplan',
  },
  home_project: {
    badge: '02 · Capture + Action',
    badgeBg: '#FFF1C9', badgeFg: '#8A6800', cornerBg: '#FFD93D',
    purpose: 'Capture creativity at home — paper planes, invented games, drawings, builds — plus parent-assigned home projects with optional rating.',
    features: [
      'Quick photo upload with one-tap categorisation',
      "“Helper” badges (Mage, Jacky, sibling who helped)",
      'Parent assigns a project with a due date',
      'Rate this project · ⭐ / % / Both / Custom',
      'Dated projects flow into the daily workplan',
    ],
    aiTag: '✨ AI spots talent patterns',
    workplanTag: '📅 Dated → Workplan',
  },
  achievement: {
    badge: '03 · Capture',
    badgeBg: '#DDF5DF', badgeFg: '#2E7D34', cornerBg: '#6BCB77',
    purpose: 'Every certificate, medal, and award — visible to the kid, the family, and time. Recognition stays alive long after the assembly ends.',
    features: [
      'Scan / photo certificates & awards',
      'Issuer, date, category auto-extracted',
      'Achievement wall (share-ready for relatives)',
      'Streaks & firsts highlighted (first sport medal, etc.)',
    ],
    aiTag: '✨ AI extracts text from scans',
  },
  academic: {
    badge: '04 · Action',
    badgeBg: '#E5D6FF', badgeFg: '#5A3CB8', cornerBg: '#A66CFF',
    purpose: 'The most load-bearing area. Term results, behaviour tracker, and Parent-Teacher Meeting notes — with every follow-up tracked to closure.',
    features: [
      'Subjects (configurable) + per-term grade history',
      'Behaviour tracker — flags from teachers',
      'PTM notes per term → each follow-up becomes a tracked task',
      'Cadence: daily / weekly / monthly progress check-ins',
      'Follow-up stays open until parent marks closed',
    ],
    aiTag: '✨ AI summarises term + flags drops',
    workplanTag: '📅 Follow-ups → Workplan',
  },
  sports_subscription: {
    badge: '05 · Action',
    badgeBg: '#C9F0EC', badgeFg: '#1E7873', cornerBg: '#4ECDC4',
    purpose: 'Track every extracurricular subscription — start to end, frequency, expiry, fees — so renewals never sneak up and progression stays visible.',
    features: [
      'Activity name, coach, location, schedule',
      'Subscription window + auto-expiry alerts',
      'Fee tracking (per term / per month)',
      'Sessions attended → progress %',
      'Notes & recommendations from coaches',
    ],
    aiTag: '✨ AI suggests renewal & new activities',
    workplanTag: '📅 Sessions → Workplan',
  },
  revision: {
    badge: '06 · Practice Loop',
    badgeBg: '#E0D7FF', badgeFg: '#1B1547', cornerBg: '#5A3CB8',
    purpose: 'The practice engine. Kid does a homework revision, snaps it, Claude scores + identifies subject + suggests next questions. Parent reviews and awards Kaya Points. Built fun — designed to make kids actually want to revise.',
    features: [
      'Multi-photo capture · same upload pipeline as the rest of Sparks',
      'Claude identifies subject + grade level + per-question scoring',
      'AI generates 3 next questions tuned to what they got wrong',
      'Confetti on qualifying submit · earns Kaya Points',
      'Parent reviews + sets the bar in /sparks/setup',
    ],
    aiTag: '✨ AI scores + tailors next round',
    workplanTag: '🎉 Earns Kaya Points',
  },
};

const PRINCIPLES: Array<{ accent: string; title: string; body: string }> = [
  { accent: '#E85C5C', title: 'One child at a time',  body: 'Switching kids is one tap. No cross-child dashboards on landing — each child gets full focus.' },
  { accent: '#5A3CB8', title: 'Five areas, no more',  body: "Resist scope creep. Talents and hobbies live in Kaya Grow; long-term aspirations in Kaya Dreams." },
  { accent: '#1E7873', title: 'AI is always at the bottom', body: 'A persistent strip that summarises what needs your attention. Never an interruption — always a quiet nudge.' },
  { accent: '#2E7D34', title: 'Memory + action',      body: 'Half of this module is a keepsake. The other half generates tasks into the family workplan.' },
];

const AI_CARDS: Array<{ icon: string; title: string; body: string; quote: string }> = [
  { icon: '⏰', title: 'Follow-up reminders', body: 'Every PTM note, every coach recommendation, every renewal — reminded at the right time, in the right cadence.',                                       quote: '"Reading practice with Earlnathan is due — week 2 of 4."' },
  { icon: '🔍', title: 'Pattern spotting',    body: 'Reads across school, home, and sports to spot emerging talents and early warning signs.',                                                            quote: '"Diella has built 6 things this month. Worth exploring an engineering class?"' },
  { icon: '🌱', title: 'Talent nurturing',    body: 'Suggests activities, projects, and conversations that grow what’s already showing up.',                                                            quote: "\"Daniella’s drawings this term lean architectural — try the LEGO Architecture set?\"" },
  { icon: '📊', title: 'Term summary',        body: 'End of each term, AI generates a one-page narrative for the family — and a script for the next PTM.',                                                quote: "\"Ask Mrs. Mwakasege about Earlnathan’s Social Studies drop and her reading plan.\"" },
];

const SCAN_CARDS: Array<{
  label: string; labelFg: string; borderTop: string;
  emoji: string; title: string; body: string;
  whoBg: string; whoFg: string; who: string;
  items: string[];
  darkVariant?: boolean;
}> = [
  {
    label: 'SCAN 01', labelFg: '#E85C5C', borderTop: '#FF6B6B',
    emoji: '📸', title: 'Past projects backfill',
    body: "Bulk upload years of old artwork, builds, and homework photos. AI auto-dates, auto-labels, and assigns to the right kid’s profile.",
    whoBg: '#FFE7E0', whoFg: '#E85C5C', who: 'Kids (new work) + Parents (the backlog)',
    items: [
      'Auto-date from photo metadata or visible markers',
      'Auto-label: art / build / homework / craft',
      "Auto-assign to the correct child’s profile",
    ],
  },
  {
    label: 'SCAN 02', labelFg: '#5A3CB8', borderTop: '#A66CFF',
    emoji: '📜', title: 'Results & Achievements',
    body: 'Snap a report card or certificate. AI extracts subjects, grades, issuer, date, category — auto-fills the records.',
    whoBg: '#E5D6FF', whoFg: '#5A3CB8', who: 'Mostly parents — report cards + school awards',
    items: [
      'OCR: subject names, grades, percentages, teacher notes',
      'Auto-extract: issuer, date, award category',
      'Flag drops vs. last term — surface as PTM follow-up',
    ],
  },
  {
    label: 'SCAN 03', labelFg: '#FFD93D', borderTop: '#FFD93D',
    emoji: '✨', title: 'Auto-suggestions to parents',
    body: 'After each scan, AI surfaces a suggestion in the parent view — what to celebrate, what to follow up, what talent is emerging.',
    whoBg: 'rgba(255,217,61,0.18)', whoFg: '#9C7A1D', who: 'Parent view only — never noisy for kids',
    items: [
      "\"Just scanned: 3rd swimming certificate this year. Worth a celebration post?\"",
    ],
    darkVariant: true,
  },
];

const FLOW_STEPS: Array<{ emoji: string; step: string; label: string; dark?: boolean }> = [
  { emoji: '📸', step: 'STEP 1', label: 'Snap or upload' },
  { emoji: '🤖', step: 'STEP 2', label: 'AI extracts' },
  { emoji: '🏷️', step: 'STEP 3', label: 'Auto-label' },
  { emoji: '👤', step: 'STEP 4', label: 'Assign to kid' },
  { emoji: '✨', step: 'STEP 5', label: 'Suggest to parent', dark: true },
];

// Header chips spelling out the breadth (education, talent, PTM, …)
// — surfaces the "and so much more" Elia called out.
const HERO_CHIPS = [
  { emoji: '📚', label: 'Education' },
  { emoji: '🌱', label: 'Talent' },
  { emoji: '🎓', label: 'PTM' },
  { emoji: '🏆', label: 'Achievements' },
  { emoji: '⚽', label: 'Sports' },
  { emoji: '🎨', label: 'Creativity' },
  { emoji: '🗓', label: 'Workplan-wired' },
  { emoji: '✨', label: 'AI companion' },
];

// ── Page ─────────────────────────────────────────────────────────────

export default function SparksLandingPage() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const router = useRouter();
  const features = useSparksFeatures();
  const isKid = profile?.role === 'kid';

  useEffect(() => {
    if (isKid && profile?.childId) router.replace(`/sparks/${profile.childId}`);
  }, [isKid, profile?.childId, router]);

  const visibleKids = useMemo(() => {
    if (!features.multiKid) return children.slice(0, 1);
    return children;
  }, [children, features.multiKid]);

  if (isKid) return null;

  return (
    <div className="min-h-[80vh] bg-[#FBF7EE] text-[#0F1F44]">
      <div className="mx-auto max-w-3xl lg:max-w-5xl xl:max-w-6xl px-5 lg:px-10 pt-8 pb-16">
        {/* 1 · HERO ─────────────────────────────────────────────── */}
        <Hero plan={features.plan} aiUnlocked={features.aiScan} />

        {/* 2 · KID SELECTOR ───────────────────────────────────── */}
        <section className="mt-8">
          <SectionTitle eyebrow="Step 1" title="Pick a child" />
          {!family ? (
            <div className="text-[#5A6488] text-sm">Loading your family…</div>
          ) : visibleKids.length === 0 ? (
            <div className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-6 text-center">
              <p className="text-[14px] text-[#0F1F44] font-medium">No kids on this family yet.</p>
              <Link href="/settings" className="inline-block mt-3 text-[#D4A847] font-bold text-[13px]">
                Add a child in Settings →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {visibleKids.map((kid) => (
                <Link
                  key={kid.id}
                  href={`/sparks/${kid.id}`}
                  className="group flex items-center gap-3 bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-4 hover:border-[#D4A847] hover:shadow-[0_8px_24px_rgba(15,31,68,0.06)] transition-all no-underline"
                >
                  <KidAvatar child={kid} size="lg" />
                  <div className="flex-1 min-w-0">
                    <div className="font-display font-extrabold text-[15px] text-[#0F1F44] truncate">{kid.name}</div>
                    <div className="text-[12px] text-[#5A6488] mt-0.5">
                      {kid.totalPoints?.toLocaleString() ?? 0} Kaya Points
                    </div>
                  </div>
                  <span className="text-[#D4A847] font-bold text-lg group-hover:translate-x-0.5 transition-transform" aria-hidden>→</span>
                </Link>
              ))}
              {!features.multiKid && children.length > 1 && (
                <Link
                  href="/settings/subscription"
                  className="flex items-center gap-3 bg-[#FFF4D6] border border-[#D4A847]/40 rounded-2xl p-4 hover:border-[#D4A847] transition-colors no-underline"
                >
                  <div className="w-12 h-12 rounded-2xl grid place-items-center text-xl shrink-0" style={{ background: '#fff' }} aria-hidden>🔒</div>
                  <div className="flex-1">
                    <div className="font-display font-extrabold text-[13.5px] text-[#0F1F44]">
                      + {children.length - 1} more {children.length - 1 === 1 ? 'child' : 'children'}
                    </div>
                    <div className="text-[11.5px] text-[#5A6488] mt-0.5">
                      Upgrade to Home to manage up to 5 kids
                    </div>
                  </div>
                </Link>
              )}
            </div>
          )}
        </section>

        {/* 3 · WHAT'S INSIDE — 5 AREAS ─────────────────────────── */}
        <section className="mt-10">
          <SectionTitle eyebrow="Step 2" title="What's inside" lede="Each area combines a capture behaviour (don't lose this) with an action behaviour (do something about it)." />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {SPARKS_AREA_ORDER.map((areaKey) => {
              const meta = SPARKS_AREA_META[areaKey];
              const pitch = AREA_PITCH[areaKey];
              return (
                <article
                  key={areaKey}
                  className="relative bg-white border border-[rgba(15,31,68,0.08)] rounded-[22px] p-5 overflow-hidden shadow-[0_8px_24px_rgba(15,31,68,0.06)]"
                >
                  <div
                    className="absolute -top-5 -right-5 w-20 h-20 rounded-full opacity-[0.12]"
                    style={{ background: pitch.cornerBg }}
                    aria-hidden
                  />
                  <span
                    className="inline-block text-[10.5px] font-extrabold uppercase tracking-[0.8px] px-2.5 py-1 rounded-full mb-2.5"
                    style={{ background: pitch.badgeBg, color: pitch.badgeFg }}
                  >
                    {pitch.badge}
                  </span>
                  <h3 className="font-display font-extrabold text-[18px] text-[#0F1F44] m-0">
                    {meta.emoji} {meta.label}
                  </h3>
                  <p className="text-[13px] text-[#5A6488] m-0 mt-2 mb-3 leading-relaxed">
                    {pitch.purpose}
                  </p>
                  <ul className="list-none m-0 p-0 mb-3">
                    {pitch.features.map((f) => (
                      <li key={f} className="text-[12.5px] text-[#0F1F44] py-1 flex items-start gap-2">
                        <span className="text-[#2E7D34] font-extrabold shrink-0">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1.5 bg-[#E5D6FF] text-[#5A3CB8] text-[10.5px] font-extrabold px-2.5 py-1 rounded-full">
                      {pitch.aiTag}
                    </span>
                    {pitch.workplanTag && (
                      <span className="inline-flex items-center gap-1.5 bg-[#C9F0EC] text-[#1E7873] text-[10.5px] font-extrabold px-2.5 py-1 rounded-full">
                        {pitch.workplanTag}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}

            {/* Sixth · Kid Profile backbone — mockup Step 3 dark card */}
            <article
              className="relative rounded-[22px] p-5 overflow-hidden text-white shadow-[0_8px_24px_rgba(15,31,68,0.12)]"
              style={{ background: 'linear-gradient(135deg, #0F1F44 0%, #1A2B5C 100%)' }}
            >
              <span className="inline-block text-[10.5px] font-extrabold uppercase tracking-[0.8px] px-2.5 py-1 rounded-full bg-white/18 mb-2.5">
                06 · Backbone
              </span>
              <h3 className="font-display font-extrabold text-[18px] m-0">🧠 Kid Profile</h3>
              <p className="text-[13px] m-0 mt-2 mb-3 leading-relaxed text-white/85">
                All five areas roll up into a living profile of the kid — subjects of strength,
                emerging talents, areas needing attention. The AI reads this profile to make
                smarter suggestions.
              </p>
              <div className="bg-white/10 rounded-xl p-3.5">
                <div className="text-[10.5px] font-extrabold uppercase tracking-[0.8px] opacity-70 mb-1">Sample · this term</div>
                <div className="text-[13px] leading-snug">
                  Strong in <strong>Mathematics, Art</strong>. Watching <strong>English handwriting</strong>.
                  Showing <strong>engineering curiosity</strong> at home.
                </div>
              </div>
            </article>
          </div>
        </section>

        {/* 4 · AI COMPANION ──────────────────────────────────── */}
        <section className="mt-12">
          <div
            className="rounded-[28px] p-7 lg:p-9 text-white overflow-hidden relative"
            style={{ background: 'linear-gradient(135deg, #1B1547 0%, #5A3CB8 50%, #4ECDC4 100%)' }}
          >
            <div
              className="absolute -top-20 -right-20 w-64 h-64 rounded-full"
              style={{ background: '#FFD93D', opacity: 0.18 }}
              aria-hidden
            />
            <span className="inline-block text-[10.5px] font-extrabold uppercase tracking-[1px] bg-white/20 rounded-full px-3 py-1.5 mb-3 relative">
              Step 3 · ✨ Kaya AI
            </span>
            <h2 className="font-display font-extrabold text-[24px] sm:text-[28px] m-0 relative max-w-xl">
              The quiet companion that notices what we miss
            </h2>
            <p className="text-[14.5px] opacity-90 max-w-prose m-0 mt-2 mb-6 relative">
              AI here is never loud. It works in the background, watches the five areas, and surfaces
              small, well-timed nudges so nothing important slips through.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 relative">
              {AI_CARDS.map((c) => (
                <div
                  key={c.title}
                  className="rounded-[16px] p-4 border border-white/15 backdrop-blur-sm"
                  style={{ background: 'rgba(255,255,255,0.12)' }}
                >
                  <div className="text-[20px] mb-1" aria-hidden>{c.icon}</div>
                  <div className="font-display font-extrabold text-[14px] mb-1">{c.title}</div>
                  <p className="text-[12.5px] opacity-85 leading-snug m-0 mb-2">{c.body}</p>
                  <div
                    className="text-[11.5px] italic opacity-95 rounded-md px-3 py-2 border-l-[3px]"
                    style={{ background: 'rgba(255,255,255,0.1)', borderLeftColor: '#FFD93D' }}
                  >
                    {c.quote}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 5 · SCAN ONCE ─────────────────────────────────────── */}
        <section className="mt-10">
          <SectionTitle eyebrow="Step 4" title="Scan once. AI does the labelling." lede="Every visual capture — old certificate, school report, art project, sports certificate — is processed by AI. Date extracted, kid identified, category labelled, subject tagged. Works for fresh captures and backfilling years of memorabilia." />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {SCAN_CARDS.map((s) => (
              <article
                key={s.label}
                className="rounded-[18px] p-5 border-t-[4px]"
                style={
                  s.darkVariant
                    ? { background: 'linear-gradient(135deg, #1B1547 0%, #5A3CB8 100%)', color: 'white', borderTopColor: s.borderTop }
                    : { background: 'white', borderTopColor: s.borderTop, boxShadow: '0 8px 24px rgba(15,31,68,0.06)' }
                }
              >
                <div className="text-[24px] mb-1" aria-hidden>{s.emoji}</div>
                <div className="text-[10.5px] font-extrabold tracking-[0.8px]" style={{ color: s.labelFg }}>{s.label}</div>
                <h4 className="font-display font-extrabold text-[15px] m-0 mt-0.5 mb-2" style={s.darkVariant ? { color: 'white' } : undefined}>{s.title}</h4>
                <p className="text-[12.5px] m-0 mb-3 leading-snug" style={s.darkVariant ? { opacity: 0.9 } : { color: '#5A6488' }}>{s.body}</p>
                <div
                  className="text-[11px] font-bold rounded-md px-2.5 py-1.5 mb-2"
                  style={{ background: s.whoBg, color: s.whoFg }}
                >
                  <strong>Who:</strong> {s.who}
                </div>
                <ul className="list-none m-0 p-0 text-[11.5px]" style={s.darkVariant ? { color: 'rgba(255,255,255,0.92)' } : { color: '#0F1F44' }}>
                  {s.items.map((it) => (
                    <li key={it} className="py-0.5">{s.darkVariant ? '' : '✓ '}{it}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          {/* End-to-end flow strip */}
          <div className="mt-5 bg-[#FBF7EE] border border-[#ECE4D3] rounded-[22px] p-5">
            <div className="text-[10.5px] font-extrabold tracking-[0.8px] text-[#5A6488]">A SINGLE SCAN, END TO END</div>
            <div className="font-display font-extrabold text-[15.5px] text-[#0F1F44] mt-0.5 mb-4">What happens in ~3 seconds</div>
            <div className="flex flex-wrap items-center gap-2">
              {FLOW_STEPS.map((s, i) => (
                <div key={s.label} className="flex items-center gap-2 flex-1 min-w-[120px]">
                  <div
                    className="flex-1 rounded-[14px] p-3 text-center"
                    style={s.dark ? { background: 'linear-gradient(135deg, #0F1F44, #1A2B5C)', color: 'white' } : { background: '#fff', color: '#0F1F44', border: '1px solid #ECE4D3' }}
                  >
                    <div className="text-[20px]" aria-hidden>{s.emoji}</div>
                    <div className="text-[10px] font-extrabold tracking-[0.6px] opacity-70 mt-1">{s.step}</div>
                    <div className="text-[12.5px] font-extrabold mt-0.5">{s.label}</div>
                  </div>
                  {i < FLOW_STEPS.length - 1 && (
                    <span className="text-[#E85C5C] font-extrabold text-lg" aria-hidden>→</span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 bg-white rounded-xl px-3.5 py-2.5 text-[12px] text-[#5A6488]">
              <strong className="text-[#0F1F44]">Parent override anywhere:</strong> all auto-extractions are editable. AI suggests — parent confirms. Nothing locks until you say so.
            </div>
          </div>

          {/* Pre-submission highlights teaser */}
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 bg-white border border-[rgba(15,31,68,0.08)] rounded-[22px] p-5 items-center">
            <div>
              <div className="text-[10.5px] font-extrabold tracking-[0.8px] text-[#5A3CB8]">PRE-SUBMISSION HIGHLIGHTS</div>
              <h4 className="font-display font-extrabold text-[16px] text-[#0F1F44] m-0 mt-1">Helpful, gentle, never blocking</h4>
              <p className="text-[12.5px] text-[#5A6488] m-0 mt-1.5 leading-snug">
                Before a kid submits work, AI flags letter shape, spacing, blanks, missing steps —
                with numbered callouts on the photo. The submit button is always enabled. The point
                is learning, not judgement.
              </p>
            </div>
            <Link
              href="/sparks/setup"
              className="inline-flex justify-center px-4 py-2.5 rounded-xl font-extrabold text-[13px] no-underline whitespace-nowrap"
              style={{ background: '#5A3CB8', color: '#fff' }}
            >
              Turn on per kid →
            </Link>
          </div>
        </section>

        {/* 6 · PRINCIPLES ────────────────────────────────────── */}
        <section className="mt-10">
          <SectionTitle eyebrow="Step 5" title="How Sparks works" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PRINCIPLES.map((p) => (
              <div
                key={p.title}
                className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-4 flex gap-3"
              >
                <div className="w-1 rounded-full shrink-0" style={{ background: p.accent }} aria-hidden />
                <div className="flex-1">
                  <div className="font-display font-extrabold text-[13.5px]" style={{ color: p.accent }}>{p.title}</div>
                  <div className="text-[12.5px] text-[#5A6488] mt-1 leading-snug">{p.body}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 7 · SETUP LINK ────────────────────────────────────── */}
        <div className="mt-10 pt-6 border-t border-[rgba(15,31,68,0.08)] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="font-display font-bold text-[14px] text-[#0F1F44]">Sparks setup</div>
            <div className="text-[12px] text-[#5A6488] mt-0.5">
              Sibling visibility, subjects, AI toggles, workplan wiring.
            </div>
          </div>
          <Link
            href="/sparks/setup"
            className="text-[#D4A847] font-bold text-[13px] no-underline whitespace-nowrap"
          >
            Open setup →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Section primitives ──────────────────────────────────────────────

function SectionTitle({ eyebrow, title, lede }: { eyebrow?: string; title: string; lede?: string }) {
  return (
    <div className="mb-4">
      {eyebrow && (
        <div className="text-[11px] font-extrabold uppercase tracking-[1.5px] text-[#5A6488] mb-1">{eyebrow}</div>
      )}
      <h2 className="font-display font-extrabold text-[22px] sm:text-[24px] text-[#0F1F44] m-0 leading-tight">
        {title}
      </h2>
      {lede && (
        <p className="text-[13.5px] text-[#5A6488] m-0 mt-2 max-w-prose">{lede}</p>
      )}
    </div>
  );
}

function Hero({ plan, aiUnlocked }: { plan: 'lite' | 'family' | 'pro'; aiUnlocked: boolean }) {
  const planLabel = plan === 'pro' ? 'Sparks Pro' : plan === 'family' ? 'Sparks Family' : 'Sparks Lite';
  const planEmoji = plan === 'pro' ? '🏰' : plan === 'family' ? '🏠' : '🏡';
  return (
    <header
      className="relative overflow-hidden rounded-[28px] p-7 lg:p-9 text-white"
      style={{ background: 'linear-gradient(135deg, #0F1F44 0%, #1A2B5C 100%)' }}
    >
      <div
        className="absolute -top-16 -right-16 w-56 h-56 rounded-full"
        style={{ background: '#D4A847', opacity: 0.18 }}
        aria-hidden
      />
      <div
        className="absolute -bottom-12 left-[40%] w-36 h-36 rounded-full"
        style={{ background: '#FF6B6B', opacity: 0.22 }}
        aria-hidden
      />

      <div className="flex items-start gap-3 relative">
        <div
          className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl grid place-items-center shrink-0"
          style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(4px)' }}
          aria-hidden
        >
          <SparksIcon className="w-10 h-10 sm:w-11 sm:h-11" />
        </div>
        <div className="min-w-0">
          <span className="inline-block text-[10.5px] font-extrabold uppercase tracking-[1px] bg-white/15 rounded-full px-3 py-1.5 mb-2">
            Kaya · Kids Education
          </span>
          <h1 className="font-display font-extrabold text-[30px] sm:text-[36px] leading-tight tracking-tight m-0">
            Kaya Sparks
          </h1>
        </div>
      </div>
      <p className="text-[15px] sm:text-[16px] opacity-90 max-w-prose m-0 mt-2.5 relative leading-relaxed">
        A keep-and-grow space inside Kaya for everything a child <strong className="font-extrabold">learns, creates, and achieves</strong>
        — school projects, home builds, awards, term grades, PTM follow-ups, and sports —
        with a gentle AI companion that nurtures emerging talent and surfaces what needs attention.
      </p>

      {/* Hero breadth chips */}
      <div className="flex flex-wrap gap-1.5 mt-4 relative">
        {HERO_CHIPS.map((c) => (
          <span
            key={c.label}
            className="inline-flex items-center gap-1.5 bg-white/15 rounded-full px-2.5 py-1 text-[11px] font-bold"
          >
            <span aria-hidden>{c.emoji}</span>
            {c.label}
          </span>
        ))}
      </div>

      {/* Plan + AI status strip */}
      <div className="flex flex-wrap items-center gap-2 mt-5 text-[12px] relative">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-extrabold uppercase tracking-[0.6px]"
          style={{ background: '#D4A847', color: '#0F1F44' }}
        >
          <span aria-hidden>{planEmoji}</span>
          {planLabel}
        </span>
        {aiUnlocked ? (
          <span className="text-white/85">· Full AI companion unlocked</span>
        ) : (
          <Link href="/settings/subscription" className="text-[#FFD93D] font-bold no-underline">
            · Unlock AI on Kaya Home →
          </Link>
        )}
      </div>
    </header>
  );
}
