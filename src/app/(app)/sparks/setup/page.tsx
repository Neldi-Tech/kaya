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
  addSubject, copyRevisionSettingsToAllKids, removeSubject,
  setSiblingPerAreaFlag, setSiblingVisibility, subscribeToSparksProfile,
  upsertSparksProfile,
} from '@/lib/sparks/firestore';
import KidAvatar from '@/components/ui/KidAvatar';
import {
  DEFAULT_REVISION_SETTINGS, DEFAULT_REFLECTION_SETTINGS, SPARKS_AREA_META,
  type RevisionSettings, type ReflectionSettings,
  type SparksItemArea, type SparksProfile, type SparksSiblingVisibility,
} from '@/lib/sparks/schema';
import type { Child, DayOfWeek } from '@/lib/firestore';

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
                  siblings={children.filter((c) => c.id !== activeKid.id)}
                />
                <ReflectionSettingsCard
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

// Daily Reflection setup (2026-06-07). Scan (handwriting) is ALWAYS on —
// the point of the module. The parent opts in typing, and picks which
// weekdays typing is offered (e.g. scan-only on school days, typing on
// weekends). Per-kid, persisted as reflection_settings on the profile.
const REFLECTION_DAYS: { id: DayOfWeek; label: string }[] = [
  { id: 'mon', label: 'M' }, { id: 'tue', label: 'T' }, { id: 'wed', label: 'W' },
  { id: 'thu', label: 'Th' }, { id: 'fri', label: 'F' }, { id: 'sat', label: 'Sa' }, { id: 'sun', label: 'Su' },
];

function ReflectionSettingsCard({
  familyId, kid, uid,
}: {
  familyId: string;
  kid: Child;
  uid: string;
}) {
  const [profile, setProfile] = useState<SparksProfile | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => subscribeToSparksProfile(familyId, kid.id, setProfile), [familyId, kid.id]);

  const effective: ReflectionSettings = {
    ...DEFAULT_REFLECTION_SETTINGS,
    ...(profile?.reflection_settings ?? {}),
  };
  const hasSaved = !!profile?.reflection_settings;

  const patch = async (next: Partial<ReflectionSettings>) => {
    setSaving(true);
    try {
      await upsertSparksProfile(
        familyId, kid.id,
        { reflection_settings: { ...effective, ...next } },
        uid,
      );
    } finally { setSaving(false); }
  };

  const toggleDay = (d: DayOfWeek) => {
    const set = new Set(effective.typing_days);
    if (set.has(d)) set.delete(d); else set.add(d);
    patch({ typing_days: REFLECTION_DAYS.map((x) => x.id).filter((x) => set.has(x)) });
  };

  return (
    <div className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-xl" aria-hidden>🪞</span>
        <div className="font-display font-extrabold text-[14.5px] text-[#0F1F44]">
          Daily Reflection · {kid.name}
        </div>
        <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${hasSaved ? 'bg-[#DDF5DF] text-[#2E7D34]' : 'bg-[#FFF1C9] text-[#8A6800]'}`}>
          {hasSaved ? '✓ Saved' : 'Defaults'}
        </span>
      </div>
      <p className="text-[12.5px] text-[#5A6488] m-0 mt-1 mb-4">
        Scanning handwriting is always on — it’s how {kid.name} reflects. You decide whether typing is allowed, and on which days.
      </p>

      {/* Scan — always on (informational) */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[#ECE4D3] bg-[#FBF7EE] px-3 py-2.5 mb-2">
        <div>
          <div className="font-nunito font-extrabold text-[13px] text-[#0F1F44]">📷 Scan handwriting</div>
          <div className="text-[11px] text-[#5A6488]">Always on — the main way to reflect</div>
        </div>
        <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#DCEEFB] text-[#3F6FA0]">On</span>
      </div>

      {/* Typing master toggle */}
      <button
        type="button"
        onClick={() => patch({ typing_allowed: !effective.typing_allowed })}
        disabled={saving}
        className="w-full flex items-center justify-between gap-3 rounded-xl border border-[#ECE4D3] bg-white px-3 py-2.5 disabled:opacity-50"
        aria-pressed={effective.typing_allowed}
      >
        <span className="text-left">
          <span className="block font-nunito font-extrabold text-[13px] text-[#0F1F44]">✍️ Allow typing</span>
          <span className="block text-[11px] text-[#5A6488]">Let {kid.name} type instead of scanning</span>
        </span>
        <span className={`w-[42px] h-[24px] rounded-full relative shrink-0 transition-colors ${effective.typing_allowed ? 'bg-[#5A3CB8]' : 'bg-[#cfd3e0]'}`}>
          <span className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all ${effective.typing_allowed ? 'right-[3px]' : 'left-[3px]'}`} />
        </span>
      </button>

      {/* Day picker — only when typing is allowed */}
      {effective.typing_allowed && (
        <div className="mt-3">
          <div className="text-[10px] font-nunito font-black uppercase tracking-[1.2px] text-[#5A6488] mb-1.5">Typing allowed on…</div>
          <div className="flex gap-1.5">
            {REFLECTION_DAYS.map((d) => {
              const on = effective.typing_days.includes(d.id);
              return (
                <button key={d.id} type="button" onClick={() => toggleDay(d.id)} disabled={saving}
                  className={`w-9 h-9 rounded-lg grid place-items-center font-nunito font-extrabold text-[12px] border-[1.5px] transition disabled:opacity-50 ${
                    on ? 'bg-[#E5D6FF] border-[#5A3CB8] text-[#5A3CB8]' : 'bg-white border-[#ECE4D3] text-[#5A6488]'
                  }`}>
                  {d.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-[#5A6488] mt-2">
            On unticked days {kid.name} only sees “Scan” — builds the handwriting habit on school days.
          </p>
        </div>
      )}
    </div>
  );
}

function RevisionSettingsCard({
  familyId, kid, uid, siblings,
}: {
  familyId: string;
  kid: Child;
  uid: string;
  siblings: Child[];
}) {
  const [profile, setProfile] = useState<SparksProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  useEffect(() => subscribeToSparksProfile(familyId, kid.id, setProfile), [familyId, kid.id]);

  const effective: Required<Omit<RevisionSettings, 'focus_subjects'>> = {
    ...DEFAULT_REVISION_SETTINGS,
    ...(profile?.revision_settings ?? {}),
  };
  // Saved vs default — drives the badge so a parent can see at a glance
  // whether THIS kid's settings are configured or still on defaults.
  const hasSaved = !!profile?.revision_settings && Object.keys(profile.revision_settings).length > 0;

  const patch = async (next: Partial<RevisionSettings>) => {
    setSaving(true);
    setCopyMsg(null);
    try {
      await upsertSparksProfile(
        familyId, kid.id,
        { revision_settings: { ...(profile?.revision_settings ?? {}), ...next } },
        uid,
      );
    } finally { setSaving(false); }
  };

  const onCopyToAll = async () => {
    if (siblings.length === 0 || !hasSaved) return;
    const siblingNames = siblings.map((s) => s.name).join(', ');
    const ok = window.confirm(
      `Copy ${kid.name}'s revision settings to: ${siblingNames}?\n\nThis overwrites their current revision settings.`,
    );
    if (!ok) return;
    setCopying(true);
    setCopyMsg(null);
    try {
      const n = await copyRevisionSettingsToAllKids(familyId, kid.id, uid);
      setCopyMsg(`✓ Copied to ${n} kid${n === 1 ? '' : 's'}.`);
    } catch (e) {
      setCopyMsg(e instanceof Error ? `Copy failed: ${e.message}` : 'Copy failed.');
    } finally { setCopying(false); }
  };

  return (
    <div className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-xl" aria-hidden>🎯</span>
        <div className="font-display font-extrabold text-[14.5px] text-[#0F1F44]">
          Home Revisions · {kid.name}
        </div>
        {hasSaved ? (
          <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#DDF5DF] text-[#2E7D34]">
            ✓ Saved
          </span>
        ) : (
          <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FFF1C9] text-[#8A6800]">
            Defaults
          </span>
        )}
      </div>
      <p className="text-[12.5px] text-[#5A6488] m-0 mt-1 mb-4">
        Practice loop knobs. Claude scores each revision; you set the bar.
        {!hasSaved && siblings.length > 0 && (
          <span className="block mt-1 text-[#8A6800]">
            Showing defaults — change any knob to save for {kid.name}.
          </span>
        )}
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
        <NumberKnob
          label="Override cap (±)"
          hint="How much you can nudge the suggested points up or down"
          value={effective.points_override_cap}
          min={0} max={50} step={1}
          onChange={(v) => patch({ points_override_cap: v })}
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
          label="🎚 Allow points override on rating"
          hint="When ON: the rate sheet shows a ± stepper so you can add or reduce within the Override cap. When OFF: the suggestion is locked in — no nudging on individual revisions."
          checked={effective.allow_points_override}
          onChange={(v) => patch({ allow_points_override: v })}
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

      {/* Copy-to-all action — only shown when there are siblings AND
          this kid actually has saved settings. Settings are per-kid by
          design (older kids → higher bars), but parents who want
          family-wide values shouldn't have to reconfigure each card. */}
      {siblings.length > 0 && (
        <div className="mt-4 pt-4 border-t border-[rgba(15,31,68,0.08)]">
          <button
            type="button"
            onClick={onCopyToAll}
            disabled={copying || saving || !hasSaved}
            className="px-3.5 py-2 rounded-xl text-[12.5px] font-extrabold disabled:opacity-40 border-2 border-[#5A3CB8] text-[#5A3CB8] bg-white hover:bg-[#F6EFFF]"
            title={hasSaved ? `Apply ${kid.name}'s values to the other ${siblings.length} kid${siblings.length === 1 ? '' : 's'}` : 'Save at least one knob first'}
          >
            {copying ? 'Copying…' : `📋 Copy to all kids (${siblings.length})`}
          </button>
          {copyMsg && (
            <span className="ml-3 text-[12px] font-bold text-[#2E7D34]">{copyMsg}</span>
          )}
          {!hasSaved && (
            <span className="ml-3 text-[11.5px] text-[#5A6488]">
              Change a knob above to enable.
            </span>
          )}
        </div>
      )}
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
  // Local draft string so the field can be cleared (empty) while editing —
  // we only clamp + propagate up on blur/Enter, not on every keystroke.
  // Without this, typing backspace over "12" snaps to min the moment the
  // value becomes empty, leaving a stuck "1".
  const [draft, setDraft] = useState<string>(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    if (draft.trim() === '') { setDraft(String(value)); return; }
    const n = Number(draft);
    if (!Number.isFinite(n)) { setDraft(String(value)); return; }
    const clamped = Math.max(min, Math.min(max, n));
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <label className="block bg-[#FBF7EE] border border-[#ECE4D3] rounded-xl px-3 py-2.5">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.6px] text-[#5A6488]">{label}</div>
      <input
        type="number"
        min={min} max={max} step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
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
