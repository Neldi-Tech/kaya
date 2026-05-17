'use client';

// /pantry/people — Household → People hub.
// Lists all helpers (any preset — nanny / tutor / driver / gardener /
// grandparent / custom) and surfaces their performance + workplan
// inline. Parent can edit any helper's workplan from here without
// going to Settings → Helpers (which still works as the deep-config
// surface for access tiers, frequency, login codes).
//
// Helpers can also navigate here and see THEIR OWN row in detail —
// rules already gate workplan reads to parent OR self.

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { ChevronDown, ChevronUp, Settings as SettingsIcon } from 'lucide-react';
import BackButton from '@/components/ui/BackButton';
import WorkplanEditor from '@/components/helpers/WorkplanEditor';
import PerformanceCard from '@/components/helpers/PerformanceCard';
import { listHelpers } from '@/lib/helpers';
import type { HelperLink } from '@/lib/firestore';

// Emoji map per preset — same vocabulary as the role chips in
// Settings → Helpers add form. Used as the avatar on each row.
const PRESET_EMOJI: Record<HelperLink['preset'], string> = {
  nanny:       '🤱',
  tutor:       '📚',
  driver:      '🚗',
  gardener:    '🌿',
  grandparent: '👵',
  custom:      '🤝',
};

const PRESET_LABEL: Record<HelperLink['preset'], string> = {
  nanny:       'Nanny',
  tutor:       'Tutor',
  driver:      'Driver',
  gardener:    'Gardener',
  grandparent: 'Grandparent',
  custom:      'Custom',
};

export default function PantryPeoplePage() {
  const { profile } = useAuth();
  const { family } = useFamily();
  const [helpers, setHelpers] = useState<HelperLink[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!family) return;
    const list = await listHelpers(family.id);
    setHelpers(list.filter((h) => h.status !== 'removed'));
  }, [family]);
  useEffect(() => { reload(); }, [reload]);

  // Helpers reaching this page can only see their own row in detail
  // (rules already enforce workplan read-access); we hide other rows
  // entirely so the page makes sense to them too.
  const visibleHelpers = helpers
    ? (profile?.role === 'helper'
        ? helpers.filter((h) => h.uid === profile.uid)
        : helpers)
    : null;

  if (!family) return null;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">Household · People</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">Your team 🤝</h1>
        </div>
        {profile?.role === 'parent' && (
          <Link
            href="/settings/helpers"
            className="h-10 px-4 rounded-hive-pill bg-hive-paper border border-hive-line text-hive-navy font-nunito font-extrabold text-[12px] inline-flex items-center gap-1.5 no-underline hover:bg-hive-cream"
          >
            <SettingsIcon size={14} /> Settings
          </Link>
        )}
      </div>

      <p className="text-[12px] text-hive-muted mb-4">
        Everyone helping with the household. Tap a person to see their workplan, today&apos;s tasks, and how they&apos;re doing.
      </p>

      {visibleHelpers === null && (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-6 text-center">
          <p className="font-nunito text-[13px] text-hive-muted">Loading…</p>
        </div>
      )}

      {visibleHelpers && visibleHelpers.length === 0 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
          <div className="text-4xl mb-2">🤝</div>
          <p className="font-nunito font-extrabold text-[14px]">No helpers yet</p>
          <p className="text-[12px] text-hive-muted mt-1 mb-4">
            Add a nanny, tutor, driver, gardener, or grandparent. Each one gets their own workplan + performance view.
          </p>
          {profile?.role === 'parent' && (
            <Link
              href="/settings/helpers"
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-extrabold text-[12px] no-underline"
            >
              + Add helper in Settings
            </Link>
          )}
        </div>
      )}

      <div className="space-y-3">
        {(visibleHelpers ?? []).map((h) => (
          <PersonCard
            key={h.uid}
            helper={h}
            familyId={family.id}
            expanded={expanded === h.uid}
            onToggle={() => setExpanded((v) => (v === h.uid ? null : h.uid))}
          />
        ))}
      </div>
    </div>
  );
}

// ── Single person row ────────────────────────────────
function PersonCard({ helper, familyId, expanded, onToggle }: {
  helper: HelperLink;
  familyId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive-lg overflow-hidden">
      {/* Row header — always visible. Big emoji + name + role +
          compact perf summary. */}
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full p-4 flex items-center gap-3 text-left hover:bg-hive-cream/40"
      >
        <span className="text-4xl flex-shrink-0" aria-hidden>
          {PRESET_EMOJI[helper.preset]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-nunito font-extrabold text-[16px] truncate">
            {helper.displayName}
            {helper.status === 'paused' && (
              <span className="ml-2 text-[9px] uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold align-middle">
                Paused
              </span>
            )}
          </p>
          <p className="text-[12px] text-hive-muted mt-0.5 truncate">
            {PRESET_LABEL[helper.preset]} · code <span className="font-mono font-bold">{helper.helperCode}</span>
          </p>
        </div>
        {expanded ? <ChevronUp size={18} className="text-hive-muted flex-shrink-0" /> : <ChevronDown size={18} className="text-hive-muted flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-hive-line p-4 space-y-3 bg-hive-cream/30">
          {/* Performance card — big, icon-first, top of expanded view */}
          <PerformanceCard
            familyId={familyId}
            helperUid={helper.uid}
            name={helper.displayName}
            days={7}
          />

          {/* Workplan editor (parent edits; helper views) */}
          <WorkplanEditor
            familyId={familyId}
            helperUid={helper.uid}
            helperName={helper.displayName}
            presetHint={helper.preset}
            defaultOpen={true}
          />
        </div>
      )}
    </div>
  );
}
