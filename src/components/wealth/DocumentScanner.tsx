'use client';

// Kaya Wealth · document scanner modal (PR3 · 2026-06-01).
//
// Capture/choose a photo → auto-crop + flatten + de-shadow + sharpen
// (documentScan.ts) → preview → save to the asset's vault (wealthDocs.ts).
// Auto-crop can be toggled off (re-processes) when detection isn't wanted.

import { useRef, useState } from 'react';
import { scanDocument, type ScanResult } from './documentScan';
import { uploadWealthDocument } from './wealthDocs';
import type { WealthAuthor, WealthMedia } from '@/lib/wealth';

type Stage = 'idle' | 'processing' | 'preview' | 'uploading' | 'error';

export default function DocumentScanner({ familyId, assetId, assetName, author, onClose, onAttached }: {
  familyId: string; assetId: string; assetName: string; author: WealthAuthor;
  onClose: () => void; onAttached?: (m: WealthMedia) => void;
}) {
  const [stage, setStage] = useState<Stage>('idle');
  const [stageMsg, setStageMsg] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [label, setLabel] = useState('');
  const [autoCrop, setAutoCrop] = useState(true);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const process = async (f: File, crop: boolean) => {
    setStage('processing'); setError('');
    try {
      const r = await scanDocument(f, { autoCrop: crop, onStage: setStageMsg });
      setResult(r); setStage('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not process that image.'); setStage('error');
    }
  };
  const onPick = (f: File | null) => { if (!f) return; setFile(f); void process(f, autoCrop); };
  const toggleCrop = (next: boolean) => { setAutoCrop(next); if (file) void process(file, next); };

  const save = async () => {
    if (!result) return;
    setStage('uploading');
    try {
      const media = await uploadWealthDocument({ familyId, assetId, blob: result.blob, label, enhanced: true, author });
      if (media && onAttached) onAttached(media);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed — try again.'); setStage('error');
    }
  };

  return (
    <div className="kw-modal-back" onClick={onClose}>
      <div className="kw-modal" onClick={(e) => e.stopPropagation()}>
        <h3>🗂️ Scan a document</h3>
        <div className="msub">Attaching to <b>{assetName}</b> · scanned, enhanced &amp; stored in the vault.</div>

        {stage === 'idle' && (
          <>
            <div className="kw-scan-drop" onClick={() => inputRef.current?.click()} role="button">
              <div style={{ fontSize: 34 }}>📷</div>
              <div style={{ fontWeight: 800, color: '#0F1F44' }}>Take a photo or choose a file</div>
              <div style={{ fontSize: 12, color: '#5A5A5A', marginTop: 4 }}>Lay it flat in good light — we&apos;ll auto-crop, de-shadow &amp; sharpen it.</div>
            </div>
            <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
            <div className="kw-modal-actions"><button className="kw-btn-ghost" onClick={onClose}>Cancel</button></div>
          </>
        )}

        {stage === 'processing' && <div className="kw-scan-stage">✨ {stageMsg || 'Enhancing…'}</div>}
        {stage === 'uploading' && <div className="kw-scan-stage">⬆️ Saving to vault…</div>}

        {stage === 'preview' && result && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="kw-scan-preview" src={result.dataUrl} alt="Enhanced document preview" />
            <div className="kw-scan-badges">
              <span className="kw-badge-ok">✨ Enhanced</span>
              {result.autoCropped
                ? <span className="kw-badge-ok">✓ auto-cropped</span>
                : <span className="kw-badge-muted">full frame</span>}
            </div>
            <label className="kw-crop-row">
              <input type="checkbox" checked={autoCrop} onChange={(e) => toggleCrop(e.target.checked)} />
              Auto-crop &amp; flatten the document
            </label>
            <div className="kw-field" style={{ marginTop: 10 }}>
              <label>Name</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Title deed" />
            </div>
            <div className="kw-modal-actions">
              <button className="kw-btn-ghost" onClick={() => { setResult(null); setFile(null); setStage('idle'); }}>Retake</button>
              <button className="kw-btn-primary" onClick={save}>Save to vault</button>
            </div>
          </>
        )}

        {stage === 'error' && (
          <>
            <div style={{ color: '#c0392b', fontSize: 13, margin: '12px 0', fontWeight: 600 }}>{error}</div>
            <div className="kw-modal-actions">
              <button className="kw-btn-ghost" onClick={onClose}>Close</button>
              <button className="kw-btn-primary" onClick={() => { setStage('idle'); setError(''); }}>Try again</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
