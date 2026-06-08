'use client';

// ReScanButton — a small "re-scan / replace" affordance for an ALREADY-
// uploaded document (Scanning 2.0 · PR 6d). Opens the shared
// CameraCaptureSheet in scan mode (→ the crop editor: CS-Scanner crop +
// flatten + CV auto-detect), then hands the confirmed file(s) to
// `onReplace`, which uploads + swaps the stored document. Reused across
// Sparks materials, Wealth documents, etc. — so any bad scan is fixable
// whenever needed.

import { useState } from 'react';
import CameraCaptureSheet from '@/components/messaging/CameraCaptureSheet';

export default function ReScanButton({
  onReplace, label = 'Re-scan', className, title, sw = false,
}: {
  /** Upload the new scan + swap the stored doc. Receives the cropped files. */
  onReplace: (files: File[]) => void | Promise<void>;
  label?: string;
  className?: string;
  title?: string;
  sw?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const cls = className
    ?? 'inline-flex items-center gap-1 text-[11px] font-extrabold text-[#5A3CB8] hover:underline disabled:opacity-50';

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={busy} className={cls} title={title}>
        {busy ? (sw ? '⏳ Inahifadhi…' : '⏳ Saving…') : `📷 ${label}`}
      </button>
      {open && (
        <CameraCaptureSheet
          open={open}
          mode="scan"
          onClose={() => setOpen(false)}
          onConfirm={async (files) => {
            if (files.length === 0) return;
            setBusy(true);
            try { await onReplace(files); } finally { setBusy(false); }
          }}
        />
      )}
    </>
  );
}
