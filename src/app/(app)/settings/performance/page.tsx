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
  validateWeights, validateThresholds,
} from '@/lib/performancePolicy';
import { listHelpers } from '@/lib/helpers';
import {
  type PerformancePolicy, type PerformanceMetric, DEFAULT_PERFORMANCE_POLICY,
  type HelperLink,
} from '@/lib/firestore';

const METRIC_LABELS: Record<PerformanceMetric, { label: string; emoji: string; sub: string }> = {
  workplan:         { label: 'Workplan',         emoji: '✅', sub: 'Daily tasks done' },
  budget:           { label: 'Grocery budget',   emoji: '💰', sub: 'Shop estimates vs actuals' },
  ratingCompletion: { label: 'Ratings',          emoji: '⭐', sub: 'Morning/evening routine logs' },
  parentFeedback:   { label: 'Parent feedback',  emoji: '👍', sub: 'Your 👍 / 😐 / 👎 over time' },
};

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
          Each helper gets one consolidated score, made up of 4 weighted metrics. Tune the
          weights to match what matters to your family — a tutor-only family might weight
          Ratings higher; a household-heavy setup might lean on Workplan + Budget.
        </p>
      </div>

      {loading && (
        <p className="text-center text-hive-muted text-sm py-8">Loading…</p>
      )}
      {!loading && (
        <div className="space-y-4">
          <WeightsCard policy={policy} familyId={family.id} byUid={profile!.uid} />
          <ThresholdsCard policy={policy} familyId={family.id} byUid={profile!.uid} />
          <WindowCard policy={policy} familyId={family.id} byUid={profile!.uid} />
          <OverridesCard
            policy={policy}
            helpers={helpers}
            familyId={family.id}
            byUid={profile!.uid}
          />
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

  const sum = Object.values(draft).reduce((a, b) => a + b, 0);
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
        Weights are percentages. They must add up to <strong>100</strong>. Default 25 / 25 / 25 / 25.
      </p>
      <div className="space-y-3">
        {(Object.keys(METRIC_LABELS) as PerformanceMetric[]).map((m) => (
          <div key={m}>
            <div className="flex items-baseline justify-between text-[12px] mb-1">
              <span className="font-nunito font-extrabold">
                {METRIC_LABELS[m].emoji} {METRIC_LABELS[m].label}
                <span className="font-normal text-hive-muted ml-1.5">· {METRIC_LABELS[m].sub}</span>
              </span>
              <span className="font-nunito font-black text-pantry-leaf-dk">{draft[m]}%</span>
            </div>
            <input
              type="range" min={0} max={100} step={1}
              value={draft[m]}
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
          Reset to 25/25/25/25
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
    if (next.length === 0) {
      delete nextOverrides[helperUid];
    } else {
      nextOverrides[helperUid] = { excludeMetrics: next };
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
                  {(Object.keys(METRIC_LABELS) as PerformanceMetric[]).map((m) => {
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
