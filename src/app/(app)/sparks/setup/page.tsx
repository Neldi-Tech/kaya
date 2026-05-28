'use client';

// Kaya Sparks · parent setup (/sparks/setup).
//
// Slice 2 (2026-05-27) wires the sibling-visibility model + per-kid
// subjects list. Slice 3 will fold in the workplan-wiring toggles +
// per-kid AI highlight switches; the surface is structured so those
// land as new sections without disturbing the existing ones.
//
// Parent-only by route guard. Kids landing here bounce back to /sparks.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  addSubject, removeSubject, setSiblingPerAreaFlag, setSiblingVisibility,
  subscribeToSparksProfile, upsertSparksProfile,
} from '@/lib/sparks/firestore';
import KidAvatar from '@/components/ui/KidAvatar';
import {
  DEFAULT_REVISION_SETTINGS, SPARKS_AREA_META, type RevisionSettings,
  type SparksItemArea, type SparksProfile, type SparksSiblingVisibility,
} from '@/lib/sparks/schema';
import type { Child } from '@/lib/firestore';

const VISIBILITY_OPTIONS: Array<{
  id: SparksSiblingVisibility;
  label: string;
  description: string;
}> = [
  { id: 'open',        label: 'Open',        description: 'Siblings see each other read-only. Best for younger families.' },
  { id: 'independent', label: 'Independent', description: 'Each kid only sees their own Sparks. Best when ages diverge.' },
  { id: 'per_area',    label: 'Per area',    description: 'Open some areas (Achievements), keep others private (Academic).' },
];

const ITEM_AREAS: SparksItemArea[] = [
  'school_project',
  'home_project',
  'achievement',
  'sports_subscription',
];

export default function SparksSetupPage() {
  const { profile } = useAuth();
  const { children } = useFamily();
  const router = useRouter();
  const isParent = profile?.role === 'parent';
  const familyId = profile?.familyId;

  // Route guard — kids/helpers bounce back to /sparks.
  useEffect(() => {
    if (profile && profile.role !== 'parent') router.replace('/sparks');
  }, [profile, router]);

  const [activeKidId, setActiveKidId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeKidId && children.length > 0) setActiveKidId(children[0].id);
  }, [activeKidId, children]);

  if (!isParent || !familyId) {
    return <div className="min-h-screen bg-[#FBF7EE] grid place-items-center text-[#5A6488] text-sm">Loading…</div>;
  }

  const activeKid = children.find((c) => c.id === activeKidId) ?? null;

  return (
    <div className="min-h-[80vh] bg-[#FBF7EE] text-[#0F1F44]">
      <div className="mx-auto max-w-3xl lg:max-w-5xl px-5 lg:px-10 pt-8 pb-16">
        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl" aria-hidden>⚙️</span>
          <div>
            <h1 className="font-display font-extrabold text-2xl tracking-tight m-0">Sparks Setup</h1>
            <p className="text-[#5A6488] text-[13.5px] m-0 mt-1">
              Sibling visibility and per-kid subjects.
              <span className="text-[#9C7A1D]"> Workplan wiring + AI per-task-type land with Slice 3 / Slice 4.</span>
            </p>
          </div>
        </div>

        {children.length === 0 ? (
          <div className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-6 text-center">
            <p className="text-[14px] text-[#0F1F44] font-medium">No kids on this family yet.</p>
            <Link href="/settings" className="inline-block mt-3 text-[#D4A847] font-bold text-[13px]">
              Add a child in Settings →
            </Link>
          </div>
        ) : (
          <>
            {/* Kid picker */}
            <div className="flex flex-wrap gap-2 mb-5">
              {children.map((k) => (
                <KidPickerChip
                  key={k.id}
                  kid={k}
                  active={k.id === activeKidId}
                  onClick={() => setActiveKidId(k.id)}
                />
              ))}
            </div>

            {activeKid && (
              <div className="space-y-4">
                <SiblingVisibilityCard
                  familyId={familyId}
                  kid={activeKid}
                  uid={profile.uid}
                />
                <SubjectsCard
                  familyId={familyId}
                  kid={activeKid}
                  uid={profile.uid}
                />
                <RevisionSettingsCard
                  familyId={familyId}
                  kid={activeKid}
                  uid={profile.uid}
                />
              </div>
            )}
          </>
        )}

        <div className="mt-10 pt-6 border-t border-[rgba(15,31,68,0.08)]">
          <Link
            href="/sparks"
            className="text-[#D4A847] font-bold text-[13px] no-underline"
          >
            ← Back to Sparks
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Kid picker chip ─────────────────────────────────────────────────

function KidPickerChip({
  kid, active, onClick,
}: {
  kid: Child;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-full text-[13px] font-bold transition-colors ${
        active
          ? 'bg-[#0F1F44] text-white'
          : 'bg-white border border-[rgba(15,31,68,0.08)] text-[#0F1F44] hover:border-[#D4A847]'
      }`}
    >
      <KidAvatar child={kid} size="xs" />
      {kid.name}
    </button>
  );
}

// ── Sibling visibility card ─────────────────────────────────────────

function SiblingVisibilityCard({
  familyId, kid, uid,
}: {
  familyId: string;
  kid: Child;
  uid: string;
}) {
  const [profile, setProfile] = useState<SparksProfile | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => subscribeToSparksProfile(familyId, kid.id, setProfile), [familyId, kid.id]);

  const mode: SparksSiblingVisibility = profile?.sibling_visibility ?? 'open';

  const setMode = async (next: SparksSiblingVisibility) => {
    if (next === mode || saving) return;
    setSaving(true);
    try { await setSiblingVisibility(familyId, kid.id, next, uid); }
    finally { setSaving(false); }
  };

  const toggleArea = async (area: SparksItemArea, allow: boolean) => {
    setSaving(true);
    try { await setSiblingPerAreaFlag(familyId, kid.id, area, allow, uid); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-5">
      <div className="font-display font-extrabold text-[14.5px] text-[#0F1F44]">
        Sibling visibility · {kid.name}
      </div>
      <p className="text-[12.5px] text-[#5A6488] m-0 mt-1 mb-3">
        Who in {kid.name}&apos;s family can see {kid.name}&apos;s Sparks?
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        {VISIBILITY_OPTIONS.map((opt) => {
          const active = opt.id === mode;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setMode(opt.id)}
              disabled={saving}
              className={`text-left rounded-xl border p-3 transition-colors disabled:opacity-60 ${
                active
                  ? 'bg-[#FFF4D6] border-[#D4A847]'
                  : 'bg-[#FBF7EE] border-[rgba(15,31,68,0.08)] hover:border-[#D4A847]'
              }`}
            >
              <div className="font-display font-extrabold text-[13px] text-[#0F1F44]">{opt.label}</div>
              <div className="text-[11.5px] text-[#5A6488] mt-0.5 leading-snug">{opt.description}</div>
            </button>
          );
        })}
      </div>

      {mode === 'per_area' && (
        <div className="bg-[#FBF7EE] rounded-xl p-3 mt-3">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#5A6488] mb-2">
            Which areas can siblings see?
          </div>
          <div className="grid grid-cols-2 gap-2">
            {ITEM_AREAS.map((area) => {
              const meta = SPARKS_AREA_META[area];
              const allowed = !!profile?.per_area?.[area];
              return (
                <label
                  key={area}
                  className="flex items-center gap-2 bg-white border border-[#ECE4D3] rounded-lg px-2.5 py-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={allowed}
                    onChange={(e) => toggleArea(area, e.target.checked)}
                    disabled={saving}
                    className="w-4 h-4"
                  />
                  <span className="text-[12.5px] text-[#0F1F44]">
                    {meta.emoji} {meta.shortLabel}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="text-[11px] text-[#5A6488] mt-2 leading-snug">
            Academic records are always hidden from siblings in Per-area mode (grades stay sensitive).
          </div>
        </div>
      )}
    </div>
  );
}

// ── Subjects card ───────────────────────────────────────────────────

function SubjectsCard({
  familyId, kid, uid,
}: {
  familyId: string;
  kid: Child;
  uid: string;
}) {
  const [profile, setProfile] = useState<SparksProfile | null>(null);
  const [pending, setPending] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => subscribeToSparksProfile(familyId, kid.id, setProfile), [familyId, kid.id]);

  const subjects = profile?.subjects ?? [];

  const onAdd = async () => {
    const name = pending.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await addSubject(familyId, kid.id, name, uid);
      setPending('');
    } finally { setSaving(false); }
  };
  const onRemove = async (name: string) => {
    setSaving(true);
    try { await removeSubject(familyId, kid.id, name, uid); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-5">
      <div className="font-display font-extrabold text-[14.5px] text-[#0F1F44]">
        Subjects · {kid.name}
      </div>
      <p className="text-[12.5px] text-[#5A6488] m-0 mt-1 mb-3">
        Drives the dropdown when capturing a school project + the per-term Academic form.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={pending}
          onChange={(e) => setPending(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }}
          placeholder="e.g. Mathematics"
          maxLength={40}
          className="flex-1 bg-[#FBF7EE] border border-[#ECE4D3] rounded-lg px-3 py-2 text-[13px] text-[#0F1F44] focus:outline-none focus:border-[#D4A847]"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={saving || !pending.trim()}
          className="px-3.5 py-2 rounded-lg text-[12.5px] font-extrabold disabled:opacity-40"
          style={{ background: '#D4A847', color: '#0F1F44' }}
        >
          + Add
        </button>
      </div>

      {subjects.length === 0 ? (
        <div className="text-[12px] text-[#5A6488]">
          No subjects yet. Add ones like Mathematics, English, Kiswahili, Science…
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {subjects.map((s) => (
            <span
              key={s.name}
              className="inline-flex items-center gap-1.5 bg-[#FBF7EE] border border-[#ECE4D3] rounded-full px-2.5 py-1 text-[12px] font-bold text-[#0F1F44]"
            >
              {s.name}
              <button
                type="button"
                onClick={() => onRemove(s.name)}
                aria-label={`Remove ${s.name}`}
                className="text-[#E85C5C] font-bold hover:bg-white rounded"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Home Revisions settings card (Slice 7 · 2026-05-28) ────────────

function RevisionSettingsCard({
  familyId, kid, uid,
}: {
  familyId: string;
  kid: Child;
  uid: string;
}) {
  const [profile, setProfile] = useState<SparksProfile | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => subscribeToSparksProfile(familyId, kid.id, setProfile), [familyId, kid.id]);

  const effective: Required<Omit<RevisionSettings, 'focus_subjects'>> = {
    ...DEFAULT_REVISION_SETTINGS,
    ...(profile?.revision_settings ?? {}),
  };

  const patch = async (next: Partial<RevisionSettings>) => {
    setSaving(true);
    try {
      await upsertSparksProfile(
        familyId, kid.id,
        { revision_settings: { ...(profile?.revision_settings ?? {}), ...next } },
        uid,
      );
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl" aria-hidden>🎯</span>
        <div className="font-display font-extrabold text-[14.5px] text-[#0F1F44]">
          Home Revisions · {kid.name}
        </div>
      </div>
      <p className="text-[12.5px] text-[#5A6488] m-0 mt-1 mb-4">
        Practice loop knobs. Claude scores each revision; you set the bar.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <NumberKnob
          label="Base Kaya Points"
          hint="Per qualifying revision"
          value={effective.base_points}
          min={1} max={50} step={1}
          onChange={(v) => patch({ base_points: v })}
          disabled={saving}
        />
        <NumberKnob
          label="Bonus Kaya Points"
          hint="When score ≥ bonus threshold"
          value={effective.bonus_points}
          min={1} max={100} step={1}
          onChange={(v) => patch({ bonus_points: v })}
          disabled={saving}
        />
        <NumberKnob
          label="Qualifying score (%)"
          hint="Min score that earns points"
          value={effective.qualifying_score}
          min={30} max={90} step={5}
          onChange={(v) => patch({ qualifying_score: v })}
          disabled={saving}
        />
        <NumberKnob
          label="Bonus threshold (%)"
          hint="Score that unlocks bonus tier"
          value={effective.bonus_threshold}
          min={70} max={100} step={5}
          onChange={(v) => patch({ bonus_threshold: v })}
          disabled={saving}
        />
      </div>

      <div className="space-y-2">
        <ToggleKnob
          label="🎉 Celebration animation on qualifying submit"
          hint="Confetti pop when the kid qualifies. Honours prefers-reduced-motion."
          checked={effective.celebration_enabled}
          onChange={(v) => patch({ celebration_enabled: v })}
          disabled={saving}
        />
        <ToggleKnob
          label="🙋 Parent approval required before awarding points"
          hint="When ON: kid sees 'pending approval' and points fire when you rate the revision. When OFF: points auto-award on a qualifying score."
          checked={effective.parent_approval_required}
          onChange={(v) => patch({ parent_approval_required: v })}
          disabled={saving}
        />
        <ToggleKnob
          label="🖨 Auto-print the next 3 questions"
          hint="Open the print dialog when AI returns next questions."
          checked={effective.auto_print_next}
          onChange={(v) => patch({ auto_print_next: v })}
          disabled={saving}
        />
      </div>
    </div>
  );
}

function NumberKnob({
  label, hint, value, min, max, step, onChange, disabled,
}: {
  label: string;
  hint: string;
  value: number;
  min: number; max: number; step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block bg-[#FBF7EE] border border-[#ECE4D3] rounded-xl px-3 py-2.5">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#5A6488]">{label}</div>
      <input
        type="number"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => {
          const n = Math.max(min, Math.min(max, Number(e.target.value) || min));
          onChange(n);
        }}
        disabled={disabled}
        className="w-full bg-white border border-[#ECE4D3] rounded px-2 py-1 text-[14px] font-extrabold text-[#0F1F44] mt-1 disabled:opacity-60"
      />
      <div className="text-[10.5px] text-[#5A6488] mt-1 leading-snug">{hint}</div>
    </label>
  );
}

function ToggleKnob({
  label, hint, checked, onChange, disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-3 bg-[#FBF7EE] border border-[#ECE4D3] rounded-xl px-3 py-2.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="w-4 h-4 mt-0.5 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-bold text-[#0F1F44]">{label}</div>
        <div className="text-[11px] text-[#5A6488] mt-0.5 leading-snug">{hint}</div>
      </div>
    </label>
  );
}
