'use client';

// Kaya · "what do you want to do with this document?" mini sheet.
//
// Shown when a kid taps a document attachment in chat or a Materials
// row. Gives them two clear choices:
//   👁 Open with Kaya — full-screen inline viewer (DocViewer)
//   ⬇ Download       — fetch + save via downloadImage helper
//
// Keeps the tap behaviour predictable on iOS PWA (where a single
// <a target=_blank download> would download AND open, surprising
// kids). The sheet also surfaces the filename + size for context.

export interface DocActionSheetProps {
  open: boolean;
  doc: { url: string; name?: string; mime?: string; sizeBytes?: number } | null;
  onClose: () => void;
  onOpen: () => void;
  onDownload: () => void;
}

const prettyBytes = (n?: number): string => {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export default function DocActionSheet({
  open, doc, onClose, onOpen, onDownload,
}: DocActionSheetProps) {
  if (!open || !doc) return null;
  const safeName = doc.name || 'Document';
  const sub = [doc.mime, prettyBytes(doc.sizeBytes)].filter(Boolean).join(' · ');
  return (
    <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/45"
      />
      <div
        role="dialog"
        aria-label="Document actions"
        className="relative w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl p-5"
      >
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-10 h-12 rounded-lg bg-[#FBF7EE] border border-[#ECE4D3] grid place-items-center text-[20px] shrink-0">📄</div>
          <div className="min-w-0 flex-1">
            <div className="font-display font-extrabold text-[13.5px] text-[#0F1F44] truncate">{safeName}</div>
            {sub && <div className="text-[10.5px] text-[#5A6488] truncate">{sub}</div>}
          </div>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={onOpen}
            className="w-full rounded-2xl bg-[#5A3CB8] text-white font-extrabold text-[14px] py-3 flex items-center justify-center gap-2"
          >
            👁 Open with Kaya
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="w-full rounded-2xl bg-white border border-[#ECE4D3] text-[#0F1F44] font-extrabold text-[14px] py-3 flex items-center justify-center gap-2 hover:bg-[#FBF7EE]"
          >
            ⬇ Download
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full text-[#5A6488] font-bold text-[12px] py-2"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
