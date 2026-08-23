'use client';

// /settings/performance — parent-only config for how each helper's
// performance score is computed. Backs the PerformancePolicy doc
// (see src/lib/performancePolicy.ts). Three sections:
//
//   1. Metric weights — 4 sliders. Must sum to 100. Live "sum: 100"
//      readout in the header so the parent sees the validation state
//      as they drag.
//   2. Face thresholds — 3 sliders. Must be strictly decreasing
//      (Excellent > Good > Okay).
//   3. Window length — 7 / 14 / 30 day radio.
//   4. Per-helper overrides — collapsible list with checkboxes to
//      exclude a metric for one helper (tutor doesn't shop → exclude
//      Budget; grandparent doesn't have a workplan → exclude Workplan).
//
// HP2 (Helper Performance 2.0, approved 2026-08-23) adds, FIRST:
//   0. Who's tracked — per-helper Tracked · Kids review switches + work
//      days chips (D1 / D4 / D9). Untracked = no performance surfaces.
//   and below the existing cards:
//   5. Kids review helpers — min age + email-on-submit (D9 / D13).
//   6. Helpers can see their own score (D2).
//   Weights now carry a 5th metric, Kid review, default 0 (Q3).
//
// Saves are NOT auto — explicit "Save" CTA per section so the parent
// doesn't accidentally save invalid state mid-drag.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import BackButton from '@/components/ui/BackButton';
import {
  subscribeToPerformancePolicy, updatePerformancePolicy,
  validateWeights, validateThresholds, validateMinAge,
  isHelperTracked, isKidsReviewOn, METRICS,
} from '@/lib/performancePolicy';
import { listHelpers, updateHelperLink } from '@/lib/helpers';
import {
  type PerformancePolicy, type PerformanceMetric, DEFAULT_PERFORMANCE_POLICY,
  DEFAULT_KID_REVIEW_SETTINGS, type HelperLink, type WorkDay, ALL_WORK_DAYS,
} from '@/lib/firestore';

const METRIC_LABELS: Record<PerformanceMetric, { label: string; emoji: string; sub: string }> = {
  workplan:         { label: 'Workplan',         emoji: '✅', sub: 'Daily tasks done' },
  budget:           { label: 'Grocery budget',   emoji: '💰', sub: 'Shop estimates vs actuals' },
  ratingCompletion: { label: 'Ratings',          emoji: '⭐', sub: 'Morning/evening routine logs' },
  parentFeedback:   { label: 'Parent feedback',  emoji: '👍', sub: 'Your 👍 / 😐 / 👎 over time' },
  kidReview:        { label: 'Kid review',       emoji: '👧', sub: "Kids' weekly review, averaged across kids" },
};

const PRESET_EMOJI: Record<string, string> = {
  nanny: '🤱', tutor: '📚', driver: '🚗', gardener: '🌿', grandparent: '👵',
  security: '🛡️', cleaner: '🧹', cook: '🍲', handyman: '🔧', custom: '🤝',
};
const DAY_LABEL: Record<WorkDay, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export default function PerformanceSettingsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family } = useFamily();
  const isParent = profile?.role === 'parent';

  useEffect(() => {
    if (!profile) return;
    if (!isParent) router.replace('/pantry/workplan');
  }, [profile, isParent, router]);

  const [policy, setPolicy] = useState<PerformancePolicy>(DEFAULT_PERFORMANCE_POLICY);
  const [helpers, setHelpers] = useState<HelperLink[]>([]);
  const [loading, setLoading] = useState(true);
  const reloadHelpers = async () => {
    if (!family) return;
    try {
      const list = await listHelpers(family.id);
      setHelpers(list.filter((h) => h.status !== 'removed'));
    } catch { /* swallow */ }
  };

  useEffect(() => {
    if (!family || !isParent) return;
    const t = setTimeout(() => setLoading(false), 1500);
    const unsub = subscribeToPerformancePolicy(family.id, (p) => {
      setPolicy(p);
      setLoading(false);
    });
    return () => { clearTimeout(t); unsub(); };
  }, [family, isParent]);

  useEffect(() => {
    if (!family || !isParent) return;
    (async () => {
      try {
        const list = await listHelpers(family.id);
        setHelpers(list.filter((h) => h.status !== 'removed'));
      } catch { /* swallow */ }
    })();
  }, [family, isParent]);

  if (!isParent) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h2 className="font-nunito font-black text-lg">Performance settings are parent-only</h2>
        <Link href="/pantry/workplan" className="text-pantry-leaf-dk font-nunito font-bold text-sm underline mt-4 inline-block">
          ← Back to Workplan
        </Link>
      </div>
    );
  }
  if (!family) return null;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-4">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Settings · Performance
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1 leading-tight">
          How is performance scored?
        </h1>
        <p className="text-hive-muted text-sm mt-2 leading-relaxed">
          Choose who&apos;s tracked, then tune how the score is built. Each tracked helper gets one
          consolidated score from weighted metrics — a tutor-only family might weight
          Ratings higher; a household-heavy setup might lean on Workplan + Budget.
        </p>
      </div>

      {loading && (
        <p className="text-center text-hive-muted text-sm py-8">Loading…</p>
      )}
      {!loading && (
        <div className="space-y-4">
          <TrackedCard
            policy={policy}
            helpers={helpers}
            familyId={family.id}
            byUid={profile!.uid}
            onHelpersChanged={reloadHelpers}
          />
          <WeightsCard policy={policy} familyId={family.id} byUid={profile!.uid} />
          <ThresholdsCard policy={policy} familyId={family.id} byUid={profile!.uid} />
          <WindowCard policy={policy} familyId={family.id} byUid={profile!.uid} />
          <OverridesCard
            policy={policy}
            helpers={helpers}
            familyId={family.id}
            byUid={profile!.uid}
          />
          <KidReviewCard policy={policy} familyId={family.id} byUid={profile!.uid} />
          <HelpersSeeOwnCard policy={policy} familyId={family.id} byUid={profile!.uid} />
        </div>
      )}
    </div>
  );
}

// ── Weights ──────────────────────────────────────────────────────

function WeightsCard({
  policy, familyId, byUid,
}: { policy: PerformancePolicy; familyId: string; byUid: string }) {
  const [draft, setDraft] = useState(policy.weights);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => { setDraft(policy.weights); }, [policy.weights]);

  const sum = METRICS.reduce((a, m) => a + (draft[m] ?? 0), 0);
  const valid = !validateWeights(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(policy.weights);

  const save = async () => {
    const v = validateWeights(draft);
    if (v) { setError(v); return; }
    setError(null);
    setSaving(true);
    try {
      await updatePerformancePolicy(familyId, { weights: draft }, byUid);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <section className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h2 className="font-nunito font-extrabold text-base">⚖️ Metric weights</h2>
        <span className={`text-[11px] font-nunito font-extrabold ${valid ? 'text-pantry-leaf-dk' : 'text-hive-rose'}`}>
          Sum: {Math.round(sum)} {valid ? '✓' : '— must be 100'}
        </span>
      </div>
      <p className="text-[11px] text-hive-muted leading-relaxed mb-3">
        Weights are percentages. They must add up to <strong>100</strong>. Default 25 / 25 / 25 / 25 / 0 —
        Kid review starts at 0 so it shows <em>beside</em> the score until you dial it in.
      </p>
      <div className="space-y-3">
        {METRICS.map((m) => (
          <div key={m}>
            <div className="flex items-baseline justify-between text-[12px] mb-1">
              <span className="font-nunito font-extrabold">
                {METRIC_LABELS[m].emoji} {METRIC_LABELS[m].label}
                <span className="font-normal text-hive-muted ml-1.5">· {METRIC_LABELS[m].sub}</span>
              </span>
              <span className="font-nunito font-black text-pantry-leaf-dk">{draft[m] ?? 0}%</span>
            </div>
            <input
              type="range" min={0} max={100} step={1}
              value={draft[m] ?? 0}
              onChange={(e) => setDraft({ ...draft, [m]: parseInt(e.target.value, 10) })}
              className="w-full accent-pantry-leaf"
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDraft(DEFAULT_PERFORMANCE_POLICY.weights)}
          className="text-[11px] font-nunito font-bold text-hive-muted underline"
        >
          Reset to 25/25/25/25/0
        </button>
        <div className="flex-1" />
        {error && <span className="text-[11px] text-hive-rose font-bold">{error}</span>}
        {savedFlash && <span className="text-[11px] text-pantry-leaf-dk font-bold">✓ Saved</span>}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || !valid || saving}
          className="bg-pantry-leaf hover:bg-pantry-leaf-dk disabled:bg-hive-line disabled:text-hive-muted text-white rounded-hive px-4 py-2 text-xs font-nunito font-black"
        >
          {saving ? 'Saving…' : 'Save weights'}
        </button>
      </div>
    </section>
  );
}

// ── Thresholds ───────────────────────────────────────────────────

function ThresholdsCard({
  policy, familyId, byUid,
}: { policy: PerformancePolicy; familyId: string; byUid: string }) {
  const [draft, setDraft] = useState(policy.thresholds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => { setDraft(policy.thresholds); }, [policy.thresholds]);

  const v = validateThresholds(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(policy.thresholds);

  const save = async () => {
    if (v) { setError(v); return; }
    setError(null);
    setSaving(true);
    try {
      await updatePerformancePolicy(familyId, { thresholds: draft }, byUid);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const ROWS: { key: 'excellent' | 'good' | 'okay'; emoji: string; label: string }[] = [
    { key: 'excellent', emoji: '😀', label: 'Excellent' },
    { key: 'good',      emoji: '🙂', label: 'Good' },
    { key: 'okay',      emoji: '😐', label: 'Okay' },
  ];

  return (
    <section className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
      <h2 className="font-nunito font-extrabold text-base">🎯 Face thresholds</h2>
      <p className="text-[11px] text-hive-muted leading-relaxed mt-1 mb-3">
        Cutoffs for the face emoji. Defaults: ≥ 90 😀 · ≥ 70 🙂 · ≥ 50 😐 · &lt; 50 🙁. Must be
        strictly decreasing.
      </p>
      <div className="space-y-3">
        {ROWS.map((r) => (
          <div key={r.key}>
            <div className="flex items-baseline justify-between text-[12px] mb-1">
              <span className="font-nunito font-extrabold">{r.emoji} {r.label}</span>
              <span className="font-nunito font-black text-pantry-leaf-dk">≥ {draft[r.key]}%</span>
            </div>
            <input
              type="range" min={1} max={100} step={1}
              value={draft[r.key]}
              onChange={(e) => setDraft({ ...draft, [r.key]: parseInt(e.target.value, 10) })}
              className="w-full accent-pantry-leaf"
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDraft(DEFAULT_PERFORMANCE_POLICY.thresholds)}
          className="text-[11px] font-nunito font-bold text-hive-muted underline"
        >
          Reset to 90/70/50
        </button>
        <div className="flex-1" />
        {error && <span className="text-[11px] text-hive-rose font-bold">{error}</span>}
        {savedFlash && <span className="text-[11px] text-pantry-leaf-dk font-bold">✓ Saved</span>}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || !!v || saving}
          className="bg-pantry-leaf hover:bg-pantry-leaf-dk disabled:bg-hive-line disabled:text-hive-muted text-white rounded-hive px-4 py-2 text-xs font-nunito font-black"
        >
          {saving ? 'Saving…' : 'Save thresholds'}
        </button>
      </div>
    </section>
  );
}

// ── Window ───────────────────────────────────────────────────────

function WindowCard({
  policy, familyId, byUid,
}: { policy: PerformancePolicy; familyId: string; byUid: string }) {
  const [draft, setDraft] = useState(policy.windowDays);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => { setDraft(policy.windowDays); }, [policy.windowDays]);

  const OPTIONS = [7, 14, 30];
  const dirty = draft !== policy.windowDays;

  const save = async () => {
    setSaving(true);
    try {
      await updatePerformancePolicy(familyId, { windowDays: draft }, byUid);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } finally { setSaving(false); }
  };

  return (
    <section className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
      <h2 className="font-nunito font-extrabold text-base">📅 Rolling window</h2>
      <p className="text-[11px] text-hive-muted leading-relaxed mt-1 mb-3">
        How many days back the metrics consider. Shorter windows react faster; longer
        windows smooth out one-off bad days.
      </p>
      <div className="flex gap-2">
        {OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDraft(d)}
            className={`flex-1 rounded-hive py-2.5 text-sm font-nunito font-extrabold border ${
              draft === d
                ? 'bg-pantry-leaf text-white border-pantry-leaf-dk'
                : 'bg-hive-paper border-hive-line text-hive-ink'
            }`}
          >
            {d} days
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1" />
        {savedFlash && <span className="text-[11px] text-pantry-leaf-dk font-bold">✓ Saved</span>}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="bg-pantry-leaf hover:bg-pantry-leaf-dk disabled:bg-hive-line disabled:text-hive-muted text-white rounded-hive px-4 py-2 text-xs font-nunito font-black"
        >
          {saving ? 'Saving…' : 'Save window'}
        </button>
      </div>
    </section>
  );
}

// ── Per-helper overrides ─────────────────────────────────────────

function OverridesCard({
  policy, helpers, familyId, byUid,
}: {
  policy: PerformancePolicy;
  helpers: HelperLink[];
  familyId: string;
  byUid: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const overrides = policy.helperOverrides ?? {};

  const toggle = async (helperUid: string, metric: PerformanceMetric) => {
    const current = overrides[helperUid]?.excludeMetrics ?? [];
    const next = current.includes(metric)
      ? current.filter((m) => m !== metric)
      : [...current, metric];
    const nextOverrides = { ...overrides };
    const { excludeMetrics: _drop, ...rest } = nextOverrides[helperUid] ?? {};
    void _drop;
    if (next.length === 0 && Object.keys(rest).length === 0) {
      delete nextOverrides[helperUid];
    } else {
      nextOverrides[helperUid] = next.length === 0 ? { ...rest } : { ...rest, excludeMetrics: next };
    }
    setSaving(helperUid);
    try {
      await updatePerformancePolicy(familyId, { helperOverrides: nextOverrides }, byUid);
    } finally { setSaving(null); }
  };

  if (helpers.length === 0) return null;
  return (
    <section className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-baseline justify-between"
      >
        <h2 className="font-nunito font-extrabold text-base">🎚️ Per-helper overrides</h2>
        <span className="text-[11px] text-hive-muted">{open ? '▴ Hide' : '▾ Show'}</span>
      </button>
      <p className="text-[11px] text-hive-muted leading-relaxed mt-1">
        Exclude a metric for a specific helper. Excluded metrics drop out of their
        consolidated score + the remaining weights re-normalise to 100.
      </p>
      {open && (
        <div className="mt-3 space-y-3">
          {helpers.map((h) => {
            const excluded = overrides[h.uid]?.excludeMetrics ?? [];
            return (
              <div key={h.uid} className="border-t border-hive-line/50 pt-3">
                <p className="font-nunito font-extrabold text-sm">
                  {h.displayName}
                  <span className="text-hive-muted text-[11px] font-normal ml-1.5">· {h.preset}</span>
                  {saving === h.uid && <span className="ml-2 text-[10px] text-hive-muted italic">saving…</span>}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {METRICS.map((m) => {
                    const off = excluded.includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => toggle(h.uid, m)}
                        className={`text-[11px] font-nunito font-extrabold px-2.5 py-1 rounded-full border ${
                          off
                            ? 'bg-hive-line text-hive-muted border-hive-line line-through'
                            : 'bg-pantry-leaf-soft text-pantry-leaf-dk border-pantry-leaf'
                        }`}
                        title={off ? 'Tap to include' : 'Tap to exclude for this helper'}
                      >
                        {METRIC_LABELS[m].emoji} {METRIC_LABELS[m].label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── HP2 · Who's tracked (D1 · D4 · D9) ───────────────────────────

function Switch({ on, onToggle, disabled, label }: { on: boolean; onToggle: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-pantry-leaf' : 'bg-hive-line'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

function TrackedCard({
  policy, helpers, familyId, byUid, onHelpersChanged,
}: {
  policy: PerformancePolicy;
  helpers: HelperLink[];
  familyId: string;
  byUid: string;
  onHelpersChanged: () => Promise<void> | void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [openUid, setOpenUid] = useState<string | null>(null);
  const overrides = policy.helperOverrides ?? {};
  const trackedCount = helpers.filter((h) => isHelperTracked(policy, h.uid)).length;

  const setFlag = async (uid: string, flag: 'tracked' | 'kidsReview', value: boolean) => {
    const nextOverrides = { ...overrides, [uid]: { ...(overrides[uid] ?? {}), [flag]: value } };
    setSaving(uid);
    try {
      await updatePerformancePolicy(familyId, { helperOverrides: nextOverrides }, byUid);
    } finally { setSaving(null); }
  };

  const toggleDay = async (h: HelperLink, day: WorkDay) => {
    const current: WorkDay[] = h.workDays && h.workDays.length > 0 ? h.workDays : ALL_WORK_DAYS;
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    if (next.length === 0) return; // at least one working day
    setSaving(h.uid);
    try {
      await updateHelperLink(familyId, h.uid, { workDays: ALL_WORK_DAYS.filter((d) => next.includes(d)) });
      await onHelpersChanged();
    } finally { setSaving(null); }
  };

  return (
    <section className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-nunito font-extrabold text-base">👀 Who&apos;s tracked?</h2>
        <span className="text-[11px] font-nunito font-extrabold text-pantry-leaf-dk">{trackedCount} of {helpers.length}</span>
      </div>
      <p className="text-[11px] text-hive-muted leading-relaxed mt-1 mb-3">
        Only tracked helpers get a score, show in the weekly email and can be reviewed by kids.
        Untracked helpers keep their workplan — nothing else changes for them.
      </p>
      {helpers.length === 0 && (
        <p className="text-[12px] text-hive-muted">No helpers yet — add one in <Link href="/settings/helpers" className="underline font-bold">Settings → Helpers</Link>.</p>
      )}
      <div className="divide-y divide-hive-line/60">
        {helpers.map((h) => {
          const tracked = isHelperTracked(policy, h.uid);
          const kids = isKidsReviewOn(policy, h.uid);
          const days: WorkDay[] = h.workDays && h.workDays.length > 0 ? h.workDays : ALL_WORK_DAYS;
          const daysLabel = days.length === 7 ? 'Mon–Sun'
            : days.length === 6 && !days.includes('sun') ? 'Mon–Sat'
            : days.map((d) => DAY_LABEL[d]).join(' ');
          const open = openUid === h.uid;
          return (
            <div key={h.uid} className={`py-2.5 ${tracked ? '' : 'opacity-60'}`}>
              <div className="flex items-center gap-3">
                <span className="text-2xl w-8 text-center" aria-hidden>{PRESET_EMOJI[h.preset] ?? '🤝'}</span>
                <button type="button" onClick={() => setOpenUid(open ? null : h.uid)} className="flex-1 min-w-0 text-left">
                  <p className="font-nunito font-extrabold text-[13px] truncate">
                    {h.displayName}
                    {saving === h.uid && <span className="ml-2 text-[10px] text-hive-muted italic font-normal">saving…</span>}
                  </p>
                  <p className="text-[11px] text-hive-muted truncate">
                    {h.preset.charAt(0).toUpperCase() + h.preset.slice(1)} · {tracked ? daysLabel : 'not tracked'} <span className="text-pantry-leaf-dk">{open ? '▴' : '▾ work days'}</span>
                  </p>
                </button>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-center gap-0.5">
                    <Switch on={tracked} onToggle={() => setFlag(h.uid, 'tracked', !tracked)} disabled={saving === h.uid} label={`Track ${h.displayName}`} />
                    <span className="text-[9px] font-nunito font-extrabold text-hive-muted">Tracked</span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <Switch on={kids} onToggle={() => setFlag(h.uid, 'kidsReview', !(overrides[h.uid]?.kidsReview !== false))} disabled={!tracked || saving === h.uid} label={`Kids review ${h.displayName}`} />
                    <span className="text-[9px] font-nunito font-extrabold text-hive-muted">Kids review</span>
                  </div>
                </div>
              </div>
              {open && (
                <div className="mt-2 ml-11">
                  <p className="text-[10px] uppercase tracking-wider font-nunito font-extrabold text-hive-muted mb-1.5">Work days</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_WORK_DAYS.map((d) => {
                      const on = days.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          disabled={saving === h.uid}
                          onClick={() => toggleDay(h, d)}
                          className={`text-[11px] font-nunito font-extrabold px-2.5 py-1 rounded-full border ${on ? 'bg-pantry-leaf text-white border-pantry-leaf-dk' : 'bg-hive-paper text-hive-muted border-hive-line'}`}
                        >
                          {DAY_LABEL[d]}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-hive-muted mt-1.5">Off-days show ⚪ in Routine fill and don&apos;t count against {h.displayName.split(' ')[0]}.</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── HP2 · Kids review helpers (D9 · D10 · D13) ───────────────────

function KidReviewCard({
  policy, familyId, byUid,
}: { policy: PerformancePolicy; familyId: string; byUid: string }) {
  const current = policy.kidReview ?? DEFAULT_KID_REVIEW_SETTINGS;
  const [minAge, setMinAge] = useState<number>(current.minAge);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => { setMinAge(current.minAge); }, [current.minAge]);

  const saveAge = async () => {
    const v = validateMinAge(minAge);
    if (v) { setError(v); return; }
    setError(null);
    setSaving(true);
    try {
      await updatePerformancePolicy(familyId, { kidReview: { ...current, minAge } }, byUid);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };
  const toggleEmail = async () => {
    setSaving(true);
    try {
      await updatePerformancePolicy(familyId, { kidReview: { ...current, emailOnSubmit: !current.emailOnSubmit } }, byUid);
    } finally { setSaving(false); }
  };

  return (
    <section className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
      <h2 className="font-nunito font-extrabold text-base">👧 Kids review helpers</h2>
      <p className="text-[11px] text-hive-muted leading-relaxed mt-1 mb-3">
        Once a week (Friday noon → Sunday night) each assigned kid is asked 4 quick face-taps about
        the helper. Only parents see the answers — the helper never does. Turn it off per helper above.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-[12px] font-nunito font-extrabold">Minimum age</label>
        <div className="inline-flex items-center gap-1">
          <button type="button" onClick={() => setMinAge((a) => Math.max(3, a - 1))} className="w-8 h-8 rounded-hive border border-hive-line font-black">−</button>
          <span className="w-8 text-center font-nunito font-black">{minAge}</span>
          <button type="button" onClick={() => setMinAge((a) => Math.min(12, a + 1))} className="w-8 h-8 rounded-hive border border-hive-line font-black">+</button>
        </div>
        <button
          type="button"
          onClick={saveAge}
          disabled={saving || minAge === current.minAge}
          className="bg-pantry-leaf hover:bg-pantry-leaf-dk disabled:bg-hive-line disabled:text-hive-muted text-white rounded-hive px-3 py-1.5 text-xs font-nunito font-black"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {savedFlash && <span className="text-[11px] text-pantry-leaf-dk font-bold">✓ Saved</span>}
        {error && <span className="text-[11px] text-hive-rose font-bold">{error}</span>}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Switch on={current.emailOnSubmit} onToggle={toggleEmail} disabled={saving} label="Email me when a kid sends a review" />
        <span className="text-[12px] font-nunito font-extrabold">Email me the moment a kid sends a review</span>
      </div>
    </section>
  );
}

// ── HP2 · Helpers see their own score (D2) ───────────────────────

function HelpersSeeOwnCard({
  policy, familyId, byUid,
}: { policy: PerformancePolicy; familyId: string; byUid: string }) {
  const on = policy.helpersSeeOwnScore !== false;
  const [saving, setSaving] = useState(false);
  const toggle = async () => {
    setSaving(true);
    try { await updatePerformancePolicy(familyId, { helpersSeeOwnScore: !on }, byUid); }
    finally { setSaving(false); }
  };
  return (
    <section className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
      <div className="flex items-center gap-3">
        <Switch on={on} onToggle={toggle} disabled={saving} label="Helpers can see their own score" />
        <div>
          <h2 className="font-nunito font-extrabold text-base">🙋 Helpers can see their own score</h2>
          <p className="text-[11px] text-hive-muted leading-relaxed mt-0.5">
            Score, routine fill and trend on their own row — never the kids&apos; answers.
          </p>
        </div>
      </div>
    </section>
  );
}
