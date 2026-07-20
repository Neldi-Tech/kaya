'use client';

// HousePicker — onboarding (and anywhere else a family picks a child's
// house). 10 starter chips inline; "Browse the gallery (130+)" opens a
// modal with search, theme tabs, a tile grid, and a Custom builder
// (name + color + emoji). All houses come from src/lib/houses.ts so the
// library can grow without touching this file.

import { useEffect, useMemo, useState } from 'react';
import AvatarEmojiPicker from '@/components/ui/AvatarEmojiPicker';
import {
  HOUSES,
  HOUSE_THEMES,
  STARTERS,
  housesInTheme,
  searchHouses,
  type HousePreset,
  type HouseTheme,
} from '@/lib/houses';

export type HouseSelection = {
  houseName: string;
  houseColor: string;
  avatarEmoji: string;
};

type Props = {
  selected: HouseSelection;
  onSelect: (s: HouseSelection) => void;
};

function toSelection(p: HousePreset): HouseSelection {
  return { houseName: p.houseName, houseColor: p.color, avatarEmoji: p.emoji };
}

export default function HousePicker({ selected, onSelect }: Props) {
  const [showGallery, setShowGallery] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {STARTERS.map((p) => {
          const isSelected = selected.houseName === p.houseName;
          return (
            <button
              key={p.houseName}
              type="button"
              onClick={() => onSelect(toSelection(p))}
              className={`inline-flex items-center gap-2 pl-2 pr-3.5 py-1.5 bg-white rounded-full border-[1.5px] transition-colors text-[13px] font-bold hover:border-brand-honey ${
                isSelected
                  ? 'border-brand-honey-dk bg-brand-honey/10'
                  : 'border-kaya-warm-dark'
              }`}
            >
              <span
                className="w-3.5 h-3.5 rounded-full shrink-0"
                style={{ background: p.color }}
              />
              <span className="text-base leading-none">{p.emoji}</span>
              <span className="text-brand-navy">{p.name}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setShowGallery(true)}
          className="inline-flex items-center gap-2 bg-brand-navy text-white rounded-full px-3.5 py-1.5 text-[13px] font-bold hover:bg-brand-navy-soft transition-colors"
        >
          Browse the gallery
          <span className="bg-brand-honey text-brand-navy rounded-full px-2 py-[2px] text-[11px] font-black">
            {HOUSES.length}+
          </span>
        </button>
      </div>

      {showGallery && (
        <HouseGalleryModal
          selected={selected}
          onSelect={(s) => {
            onSelect(s);
            setShowGallery(false);
          }}
          onClose={() => setShowGallery(false)}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// Gallery modal — search · theme tabs · tile grid · Custom builder
// ────────────────────────────────────────────────────────────────────

type GalleryProps = {
  selected: HouseSelection;
  onSelect: (s: HouseSelection) => void;
  onClose: () => void;
};

type TabId = HouseTheme | 'custom';

function HouseGalleryModal({ selected, onSelect, onClose }: GalleryProps) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabId>('gems');
  const [customName, setCustomName] = useState('');
  const [customColor, setCustomColor] = useState('#F39C2F');
  const [customEmoji, setCustomEmoji] = useState('🏆');

  // Body scroll lock + Esc closes.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const filtered: HousePreset[] = useMemo(() => {
    if (search.trim()) return searchHouses(search);
    if (tab === 'custom') return [];
    return housesInTheme(tab);
  }, [search, tab]);

  const handleCustomCreate = () => {
    const name = customName.trim();
    if (!name) return;
    onSelect({
      houseName: `${name} House`,
      houseColor: customColor,
      avatarEmoji: customEmoji.trim() || '🏆',
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-brand-ink/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="House Gallery"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full max-w-[940px] max-h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Head */}
        <div className="px-5 sm:px-6 py-4 border-b border-kaya-warm-dark/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="font-nunito font-extrabold text-lg sm:text-xl text-brand-navy">
              House Gallery
            </h3>
            <span className="hidden sm:inline-block bg-brand-cream-warm text-brand-honey-dk text-[10px] font-extrabold uppercase tracking-[0.08em] px-2 py-1 rounded-full whitespace-nowrap">
              {HOUSES.length} houses · 7 themes + custom
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close gallery"
            className="w-9 h-9 rounded-full bg-kaya-warm hover:bg-kaya-warm-dark text-brand-ink/70 text-base flex items-center justify-center shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-5 sm:px-6 py-3 border-b border-kaya-warm-dark/60">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name (Ruby · Phoenix · Athena · Oak …)"
            className="w-full bg-brand-cream border-[1.5px] border-kaya-warm-dark rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-honey focus:ring-2 focus:ring-brand-honey/30"
          />
        </div>

        {/* Tabs */}
        {!search && (
          <div className="px-3 sm:px-4 pt-3 pb-1 border-b border-kaya-warm-dark/60 flex flex-wrap gap-1.5">
            {HOUSE_THEMES.map((t) => {
              const active = tab === t.id;
              const count = housesInTheme(t.id).length;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12.5px] font-bold transition-colors mb-1 ${
                    active
                      ? 'bg-brand-navy text-white'
                      : 'text-brand-ink/70 hover:bg-kaya-warm'
                  }`}
                >
                  <span>{t.icon}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                  <span className="sm:hidden">{t.label.split(' ')[0]}</span>
                  <span
                    className={`text-[10px] px-1.5 py-[1px] rounded-full font-extrabold ${
                      active
                        ? 'bg-brand-honey text-brand-navy'
                        : 'bg-kaya-warm text-brand-ink/60'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setTab('custom')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12.5px] font-bold transition-colors mb-1 ${
                tab === 'custom'
                  ? 'bg-brand-navy text-white'
                  : 'text-brand-ink/70 hover:bg-kaya-warm'
              }`}
            >
              <span>✏️</span>
              Custom
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {tab === 'custom' && !search ? (
            <CustomBuilder
              name={customName}
              color={customColor}
              emoji={customEmoji}
              onName={setCustomName}
              onColor={setCustomColor}
              onEmoji={setCustomEmoji}
              onCreate={handleCustomCreate}
            />
          ) : filtered.length === 0 ? (
            <div className="text-center text-brand-ink/60 py-12 text-sm">
              No houses match &ldquo;{search}&rdquo; — try a different name or browse a theme.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3">
              {filtered.map((p) => {
                const isSelected = selected.houseName === p.houseName;
                return (
                  <button
                    key={p.houseName}
                    type="button"
                    onClick={() => onSelect(toSelection(p))}
                    className={`bg-white border-[1.5px] rounded-2xl p-3.5 text-center transition-all hover:-translate-y-0.5 hover:border-brand-honey ${
                      isSelected
                        ? 'border-brand-honey-dk shadow-md bg-brand-honey/10'
                        : 'border-kaya-warm-dark'
                    }`}
                  >
                    <div
                      className="w-12 h-12 rounded-full mx-auto mb-1.5 flex items-center justify-center text-[22px] shadow-sm"
                      style={{ background: p.color }}
                    >
                      {p.emoji}
                    </div>
                    <div className="font-nunito font-extrabold text-[13.5px] text-brand-navy leading-tight">
                      {p.name}
                    </div>
                    <div className="text-[11px] text-brand-ink/60 mt-0.5 leading-snug">
                      {p.tag}
                    </div>
                    {isSelected && (
                      <div className="mt-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-honey text-brand-navy text-[11px] font-extrabold">
                        ✓
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Custom builder — make your own house
// ────────────────────────────────────────────────────────────────────

type CustomProps = {
  name: string;
  color: string;
  emoji: string;
  onName: (s: string) => void;
  onColor: (s: string) => void;
  onEmoji: (s: string) => void;
  onCreate: () => void;
};

function CustomBuilder({
  name,
  color,
  emoji,
  onName,
  onColor,
  onEmoji,
  onCreate,
}: CustomProps) {
  const previewName = name.trim() || 'Your House';
  return (
    <div className="max-w-md mx-auto">
      <h4 className="font-nunito font-extrabold text-lg text-brand-navy mb-1">
        Build your own house
      </h4>
      <p className="text-sm text-brand-ink/65 mb-6">
        Pick a name, color, and emoji. Use anything that feels like your family.
      </p>

      <div className="bg-white border-[1.5px] border-kaya-warm-dark rounded-2xl p-5 mb-6 flex items-center gap-4">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-2xl shadow-sm shrink-0"
          style={{ background: color }}
        >
          {emoji}
        </div>
        <div className="min-w-0">
          <div className="font-nunito font-extrabold text-base text-brand-navy truncate">
            {previewName} House
          </div>
          <div className="text-xs text-brand-ink/60">Custom · your family</div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/60 mb-1.5">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="e.g. Timotheo"
            maxLength={30}
            className="w-full bg-brand-cream border-[1.5px] border-kaya-warm-dark rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-honey focus:ring-2 focus:ring-brand-honey/30"
          />
          <p className="text-[11px] text-brand-ink/50 mt-1">
            Stored as &ldquo;{previewName} House&rdquo;.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/60 mb-1.5">
              Color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => onColor(e.target.value)}
                aria-label="Pick house color"
                className="w-12 h-10 border-[1.5px] border-kaya-warm-dark rounded-lg cursor-pointer p-0"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => onColor(e.target.value)}
                maxLength={7}
                className="flex-1 bg-brand-cream border-[1.5px] border-kaya-warm-dark rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-brand-honey"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/60 mb-1.5">
              Emoji
            </label>
            <input
              type="text"
              value={emoji}
              onChange={(e) => onEmoji(e.target.value.slice(0, 8))}
              placeholder="🏆"
              className="w-full bg-brand-cream border-[1.5px] border-kaya-warm-dark rounded-xl px-4 py-2 text-2xl text-center focus:outline-none focus:border-brand-honey"
            />
          </div>
        </div>

        {/* Approved 2026-07-20 — the shared avatar library (8 categories ·
            144 choices) alongside the free-type box above. */}
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-brand-ink/60 mb-1.5">
            Or pick from the library
          </label>
          <AvatarEmojiPicker value={emoji} onChange={onEmoji} compact />
        </div>

        <button
          type="button"
          onClick={onCreate}
          disabled={!name.trim()}
          className="w-full bg-brand-honey hover:bg-brand-honey-dk disabled:bg-brand-honey/40 disabled:cursor-not-allowed text-brand-navy font-extrabold text-sm py-3 rounded-xl transition-colors"
        >
          Use this house →
        </button>
      </div>
    </div>
  );
}
