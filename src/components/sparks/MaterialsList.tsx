'use client';

// Kaya Sparks · Home Practice → Materials list (kid + parent view).
//
// Renders the colour-coded subject filter chips + the list of materials
// after the per-kid visibility filter is applied. Parents see edit +
// delete affordances; kids only see "open" + the visible card.

import { useMemo, useState } from 'react';
import {
  countsBySubject, materialIcon, mergeSubjects, prettyBytes, subjectMeta,
  visibleToKid, type SparksMaterial,
} from '@/lib/sparks/materials';
import { deleteMaterial } from '@/lib/sparks/materialsFirestore';
import { downloadImage } from '@/lib/downloadImage';
import DocActionSheet from '@/components/DocActionSheet';
import DocViewer from '@/components/DocViewer';

interface Props {
  items: SparksMaterial[];
  /** When provided, the list is filtered to materials visible to this kid. */
  forKidId?: string;
  /** When true, edit / delete affordances render. */
  canEdit?: boolean;
  familyId: string;
  /** Subjects already known on the kid's sparks_profile — merged into
   *  the filter chip row even when no material uses them yet. */
  profileSubjects?: string[];
  /** Parent-only — clicking the edit chip surfaces a material in the
   *  Add/Edit sheet via this callback. */
  onEdit?: (material: SparksMaterial) => void;
  /** Parent-only — "+ Add" button rendered above the list. */
  onAdd?: () => void;
}

export default function MaterialsList({
  items, forKidId, canEdit, familyId, profileSubjects, onEdit, onAdd,
}: Props) {
  const [filter, setFilter] = useState<string | null>(null);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  // Doc-open menu (Open with Kaya / Download) + inline viewer.
  const [docMenu, setDocMenu] = useState<SparksMaterial | null>(null);
  const [docView, setDocView] = useState<SparksMaterial | null>(null);

  // Apply the per-kid visibility filter first (kid view); parents see
  // every material in the family.
  const visible = useMemo(
    () => (forKidId ? items.filter((m) => visibleToKid(m, forKidId)) : items),
    [items, forKidId],
  );

  const counts = useMemo(() => countsBySubject(visible), [visible]);
  const inUseSubjects = useMemo(() => Object.keys(counts), [counts]);
  const subjects = useMemo(
    () => mergeSubjects({ inUseSubjects, profileSubjects }),
    [inUseSubjects, profileSubjects],
  );

  // Keep only the subject pills that actually have material counts on
  // the kid's view — otherwise the chip row gets noisy. Parent view
  // shows all known subjects so they can preview the palette.
  const visiblePills = forKidId
    ? subjects.filter((s) => (counts[s.key] ?? 0) > 0)
    : subjects;

  const filtered = useMemo(
    () => filter ? visible.filter((m) => m.subject === filter) : visible,
    [visible, filter],
  );

  const onDelete = async (m: SparksMaterial) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete "${m.title}"?\nThis can't be undone.`)) return;
    setBusyDeleteId(m.id);
    try { await deleteMaterial(familyId, m); } finally { setBusyDeleteId(null); }
  };

  return (
    <div>
      {/* Filter chips */}
      {visiblePills.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
          <button
            type="button"
            onClick={() => setFilter(null)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold border-[1.5px] transition flex items-center gap-1.5 ${filter === null ? 'border-[#5A3CB8] bg-[#E5D6FF] text-[#5A3CB8]' : 'border-transparent bg-[#E5D6FF] text-[#1B1547] opacity-80'}`}
            aria-pressed={filter === null}
          >
            All
            <span className="bg-white rounded-full px-1.5 py-[1px] text-[10px]">{visible.length}</span>
          </button>
          {visiblePills.map((s) => {
            const selected = filter === s.key;
            const count = counts[s.key] ?? 0;
            return (
              <button
                type="button"
                key={s.key}
                onClick={() => setFilter(selected ? null : s.key)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold flex items-center gap-1.5 border-[1.5px] transition`}
                style={{
                  background: s.bg,
                  color: s.color,
                  borderColor: selected ? s.color : 'transparent',
                  boxShadow: selected ? '0 0 0 3px rgba(90, 60, 184, 0.10)' : undefined,
                }}
                aria-pressed={selected}
              >
                {s.emoji} {s.key}
                {count > 0 && <span className="bg-white rounded-full px-1.5 py-[1px] text-[10px]">{count}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Header with add button */}
      {(canEdit && onAdd) && (
        <div className="flex items-center justify-between mt-2 mb-1.5 px-1">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-[#5A6488]">
            Materials · {visible.length}
          </div>
          <button
            type="button"
            onClick={onAdd}
            className="text-[11px] font-extrabold rounded-full px-3 py-1 bg-[#5A3CB8] text-white"
          >
            + Add
          </button>
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="rounded-2xl border-[1.5px] border-dashed border-[#ECE4D3] bg-[#FBF7EE] py-8 px-4 text-center text-[12.5px] text-[#5A6488] leading-snug">
          {visible.length === 0
            ? (canEdit
                ? '📚 No materials yet — tap "+ Add" to upload a PDF, scan a page, or paste a link.'
                : '📚 No materials shared with you yet. Ask a parent to add some!')
            : `No materials for "${filter}".`}
        </div>
      )}

      {/* List */}
      {filtered.length > 0 && (
        <ul className="m-0 p-0 list-none space-y-2 lg:grid lg:grid-cols-2 lg:gap-2 lg:space-y-0">
          {filtered.map((m) => {
            const meta = subjectMeta(m.subject);
            const icon = materialIcon(m);
            const sizeLabel = m.kind === 'file' ? prettyBytes(m.file_size_bytes) : (m.link_url ? hostFrom(m.link_url) : '');
            const allKids = m.shared_with === 'all_kids';
            // File → open the menu (Open with Kaya / Download). Link →
            // hop straight to the external URL in a new tab (a menu
            // would be confusing for a URL with no file to download).
            const onTap = () => {
              if (m.kind === 'link' && m.link_url) {
                window.open(m.link_url, '_blank', 'noopener,noreferrer');
              } else if (m.kind === 'file' && m.file_url) {
                setDocMenu(m);
              }
            };
            return (
              <li key={m.id} className="bg-white border border-[#ECE4D3] rounded-[14px] p-3 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onTap}
                  className="w-[42px] h-[48px] rounded-[8px] grid place-items-center text-[18px] shrink-0"
                  style={{ background: meta.bg, color: meta.color }}
                  aria-label={`Open ${m.title}`}
                >
                  {icon}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-extrabold text-[13px] text-[#0F1F44] truncate">{m.title}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                    <span
                      className="text-[10px] font-extrabold rounded-full px-2 py-[1px]"
                      style={{ background: meta.bg, color: meta.color }}
                    >
                      {meta.emoji} {m.subject}
                    </span>
                    <span className="text-[10.5px] text-[#5A6488] truncate">
                      {m.kind === 'link' ? 'Link' : (m.file_mime || 'File').split('/').pop()?.toUpperCase()}
                      {sizeLabel ? ` · ${sizeLabel}` : ''}
                      {' · '}
                      {m.uploaded_by_name}
                    </span>
                    {!allKids && Array.isArray(m.shared_with) && (
                      <span className="text-[9.5px] font-bold rounded-full px-1.5 py-[1px] bg-[#FFF1C9] text-[#8A6800]">
                        🎯 {m.shared_with.length} {m.shared_with.length === 1 ? 'kid' : 'kids'}
                      </span>
                    )}
                  </div>
                  {m.description && (
                    <div className="text-[11.5px] text-[#0F1F44] mt-1 leading-snug">{m.description}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={onTap}
                    className="text-[16px] text-[#5A3CB8] hover:bg-[#FBF7EE] rounded px-1.5"
                    aria-label={`Open ${m.title}`}
                  >
                    ↗
                  </button>
                  {canEdit && (
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => onEdit?.(m)}
                        className="text-[10px] font-bold text-[#5A6488] hover:text-[#5A3CB8] px-1.5"
                        title="Edit"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(m)}
                        disabled={busyDeleteId === m.id}
                        className="text-[10px] font-bold text-[#A33A2A] hover:underline px-1.5 disabled:opacity-40"
                        title="Delete"
                      >
                        🗑
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Tap on a file material → choice sheet (Open with Kaya / Download). */}
      <DocActionSheet
        open={!!docMenu}
        doc={docMenu ? {
          url: docMenu.file_url || '',
          name: docMenu.file_name || docMenu.title,
          mime: docMenu.file_mime,
          sizeBytes: docMenu.file_size_bytes,
        } : null}
        onClose={() => setDocMenu(null)}
        onOpen={() => { if (docMenu) { setDocView(docMenu); setDocMenu(null); } }}
        onDownload={() => {
          if (!docMenu || !docMenu.file_url) return;
          const tgt = docMenu;
          downloadImage(tgt.file_url!, tgt.file_name || tgt.title || 'material').catch((err) => console.error('Material download failed', err));
          setDocMenu(null);
        }}
      />

      {/* Inline full-screen viewer when the kid picks "Open with Kaya". */}
      <DocViewer
        open={!!docView}
        doc={docView ? {
          url: docView.file_url || '',
          name: docView.file_name || docView.title,
          mime: docView.file_mime,
        } : null}
        onClose={() => setDocView(null)}
        onDownload={() => {
          if (!docView || !docView.file_url) return;
          downloadImage(docView.file_url, docView.file_name || docView.title || 'material').catch((err) => console.error('Material download failed', err));
        }}
      />
    </div>
  );
}

function hostFrom(u: string): string {
  try { return new URL(u).host.replace(/^www\./, ''); } catch { return u.slice(0, 32); }
}
