'use client';

// Kaya Wealth · document scanner modal (PR3 · 2026-06-01).
//
// Capture/choose a photo → auto-crop + flatten + de-shadow + sharpen
// (documentScan.ts) → preview → save to the asset's vault (wealthDocs.ts).
// Auto-crop can be toggled off (re-processes) when detection isn't wanted.

import { useRef, useState } from 'react';
import { auth } from '@/lib/firebase';
import { scanDocument, type ScanResult } from './documentScan';
import { uploadWealthDocument, uploadUnfiledDocument } from './wealthDocs';
import type { WealthAuthor, WealthMedia } from '@/lib/wealth';

type Stage = 'idle' | 'processing' | 'preview' | 'uploading' | 'error';

export default function DocumentScanner({ familyId, author, onClose, assets = [], defaultAssetId = null, onAttached, onSaved }: {
  familyId: string; author: WealthAuthor; onClose: () => void;
  assets?: { id: string; name: string }[];
  defaultAssetId?: string | null;
  onAttached?: (m: WealthMedia) => void;
  onSaved?: () => void;
}) {
  const [stage, setStage] = useState<Stage>('idle');
  const [stageMsg, setStageMsg] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [label, setLabel] = useState('');
  const [attachTo, setAttachTo] = useState<string>(defaultAssetId ?? '');
  const [detected, setDetected] = useState<{ docType: string; suggestedName: string } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Best-effort AI auto-detect of the document type — pre-fills the name and
  // shows a hint. Never blocks saving; failures are silent (manual entry).
  const classify = async (dataUrl: string) => {
    setDetecting(true);
    try {
      const u = auth.currentUser;
      const token = u ? await u.getIdToken() : '';
      const base64 = dataUrl.split(',')[1] || '';
      const r = await fetch('/api/wealth/scan/classify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ imageBase64: base64, mediaType: 'image/jpeg' }),
      });
      const d = await r.json();
      if (d && (d.docType || d.suggestedName)) {
        setDetected({ docType: d.docType || '', suggestedName: d.suggestedName || '' });
        setLabel((cur) => cur || d.suggestedName || d.docType || '');
      }
    } catch { /* detection is best-effort */ } finally { setDetecting(false); }
  };

  const process = async (f: File) => {
    setStage('processing'); setError(''); setDetected(null);
    try {
      const r = await scanDocument(f, { onStage: setStageMsg });
      setResult(r); setStage('preview');
      void classify(r.dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not process that image.'); setStage('error');
    }
  };
  const onPick = (f: File | null) => { if (!f) return; void process(f); };

  const save = async () => {
    if (!result) return;
    setStage('uploading');
    try {
      if (attachTo) {
        const media = await uploadWealthDocument({ familyId, assetId: attachTo, blob: result.blob, label, enhanced: true, author });
        if (media && onAttached) onAttached(media);
      } else {
        await uploadUnfiledDocument({ familyId, blob: result.blob, label, enhanced: true, author, detectedType: detected?.docType || undefined });
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed — try again.'); setStage('error');
    }
  };

  return (
    <div className="kw-modal-back" onClick={onClose}>
      <div className="kw-modal" onClick={(e) => e.stopPropagation()}>
        <h3>🗂️ Scan a document</h3>
        <div className="msub">Scan a document — it&apos;s enhanced &amp; stored in your Wealth vault.</div>

        {stage === 'idle' && (
          <>
            <div className="kw-scan-drop" onClick={() => inputRef.current?.click()} role="button">
              <div style={{ fontSize: 34 }}>📷</div>
              <div style={{ fontWeight: 800, color: '#0F1F44' }}>Take a photo or choose a file</div>
              <div style={{ fontSize: 12, color: '#5A5A5A', marginTop: 4 }}>Lay it flat in good light — we&apos;ll de-shadow, sharpen &amp; clean it up.</div>
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
              <span className="kw-badge-muted">de-shadowed &amp; sharpened</span>
            </div>
            {detecting && <div style={{ fontSize: 12, color: '#9a7b27', margin: '8px 0 0' }}>🧠 Detecting document type…</div>}
            {detected && (detected.docType || detected.suggestedName) && (
              <div style={{ fontSize: 12.5, color: '#0F1F44', background: 'rgba(231,198,121,.16)', border: '1px solid rgba(231,198,121,.4)', borderRadius: 10, padding: '8px 11px', margin: '8px 0 0' }}>
                🧠 Detected: <b>{detected.docType || 'Document'}</b>{detected.suggestedName ? ' — name suggested below' : ''}. Adjust if needed.
              </div>
            )}
            <div className="kw-field" style={{ marginTop: 10 }}>
              <label>Attach to</label>
              <select value={attachTo} onChange={(e) => setAttachTo(e.target.value)}>
                <option value="">📂 General vault (unfiled)</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="kw-field" style={{ marginTop: 10 }}>
              <label>Name</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Title deed" />
            </div>
            <div className="kw-modal-actions">
              <button className="kw-btn-ghost" onClick={() => { setResult(null); setDetected(null); setStage('idle'); }}>Retake</button>
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
