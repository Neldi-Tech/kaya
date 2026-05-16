'use client';

// Bottom sheet (mobile) / centered modal (desktop) for choosing
// who can see an album. Two modes:
//
//   Whole family — every member implicitly included
//   Custom       — explicit allow-list of userIds
//
// When this picker is for a sub-album (parentAlbum prop non-null AND
// parent is in 'custom' mode), members NOT in the parent's accessList
// render greyed out — Sub-album access must be a subset of parent
// access, enforced both here and in firestore.rules.

import { useEffect, useState } from 'react';
import type { UserProfile } from '@/lib/firestore';
import type { Album, AlbumAccessMode } from '@/lib/albums';
import { disallowedForSubAlbum } from '@/lib/albums';
import MemberToggleRow from './MemberToggleRow';

interface Props {
  open: boolean;
  members: UserProfile[];
  /** Set when configuring a SUB-album. Drives the greyed-out rows
   *  showing members not allowed by the parent's access list. */
  parentAlbum?: Album | null;
  initialMode: AlbumAccessMode;
  initialList: string[];
  /** Disable custom mode entirely (free tier). When set, the radio
   *  is locked to 'all_family' with an upgrade nudge underneath. */
  customDisabled?: boolean;
  customDisabledReason?: string;
  onSave: (mode: AlbumAccessMode, list: string[]) => void;
  onClose: () => void;
}

export default function AccessPickerSheet({
  open, members, parentAlbum, initialMode, initialList,
  customDisabled, customDisabledReason, onSave, onClose,
}: Props) {
  const [mode, setMode] = useState<AlbumAccessMode>(initialMode);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialList));

  // Reset local state when the sheet opens with new initial values.
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setSelected(new Set(initialList));
    }
  }, [open, initialMode, initialList]);

  if (!open) return null;

  const disallowed = disallowedForSubAlbum(
    parentAlbum || null,
    members.map((m) => m.uid),
  );

  const toggleMember = (uid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const save = () => {
    if (mode === 'all_family') {
      onSave('all_family', []);
    } else {
      const list = Array.from(selected).filter((u) => !disallowed.has(u));
      onSave('custom', list);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
      <div
        className="absolute inset-0 bg-kaya-chocolate/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative bg-white w-full lg:w-[420px] lg:rounded-kaya rounded-t-3xl px-5 pt-2 pb-6 max-h-[85vh] flex flex-col shadow-2xl">
        <div className="w-10 h-1 rounded-full bg-kaya-warm-dark mx-auto mt-1.5 mb-3 lg:hidden" />

        <h3 className="font-display font-black text-lg text-kaya-chocolate">Who can see this album?</h3>
        <p className="text-xs text-kaya-sand mt-1 leading-relaxed">
          {parentAlbum
            ? 'Sub-album access can only narrow the parent\'s — anyone not in the parent album won\'t be selectable here.'
            : 'Pick whether the whole family can see this album, or limit it to specific people.'}
        </p>

        <div className="flex flex-col gap-2 mt-4">
          <RadioRow
            label="Whole family"
            sublabel="Everyone in the family group sees it"
            active={mode === 'all_family'}
            onClick={() => setMode('all_family')}
          />
          <RadioRow
            label="Custom"
            sublabel={customDisabled ? (customDisabledReason || 'Family plan only') : 'Pick exactly who can see'}
            active={mode === 'custom'}
            disabled={customDisabled}
            onClick={() => { if (!customDisabled) setMode('custom'); }}
          />
        </div>

        {mode === 'custom' && (
          <>
            <div className="flex items-center justify-between mt-4 mb-2">
              <p className="font-display font-black text-[10px] uppercase tracking-wider text-kaya-sand">
                Family members · {members.length}
              </p>
              <p className="text-[10px] text-kaya-sand font-bold">{selected.size} selected</p>
            </div>
            <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 -mx-1 px-1">
              {members.map((m) => (
                <MemberToggleRow
                  key={m.uid}
                  member={m}
                  selected={selected.has(m.uid)}
                  disabledReason={disallowed.has(m.uid) ? 'Not in parent' : undefined}
                  onToggle={() => toggleMember(m.uid)}
                />
              ))}
            </div>
          </>
        )}

        <div className="grid grid-cols-[1fr_2fr] gap-2 mt-4">
          <button
            onClick={onClose}
            className="h-12 rounded-kaya-sm bg-kaya-cream border border-kaya-warm-dark font-display font-black text-sm text-kaya-chocolate hover:bg-kaya-warm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="h-12 rounded-kaya-sm bg-kaya-chocolate text-kaya-gold-light font-display font-black text-sm hover:bg-kaya-chocolate-light transition-colors"
          >
            {mode === 'all_family' ? 'Save · Whole family' : `Save · ${selected.size} ${selected.size === 1 ? 'person' : 'people'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function RadioRow({
  label, sublabel, active, disabled, onClick,
}: {
  label: string;
  sublabel: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-3 p-3 rounded-kaya-sm border text-left transition-colors ${
        disabled
          ? 'bg-kaya-warm/50 border-kaya-warm-dark opacity-50 cursor-not-allowed'
          : active
            ? 'bg-kaya-gold-light/40 border-kaya-gold'
            : 'bg-kaya-cream border-kaya-warm-dark hover:border-kaya-chocolate'
      }`}
    >
      <div className={`w-5 h-5 rounded-full border-2 relative ${active ? 'border-kaya-gold-dark' : 'border-kaya-sand'}`}>
        {active && <div className="absolute inset-1 rounded-full bg-kaya-gold-dark" />}
      </div>
      <div className="flex-1">
        <p className="font-display font-black text-sm text-kaya-chocolate leading-tight">{label}</p>
        <p className="text-[11px] text-kaya-sand mt-0.5">{sublabel}</p>
      </div>
    </button>
  );
}
