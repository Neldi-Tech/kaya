'use client';

// Kaya Wealth · Document Vault section (PR3 · 2026-06-01).
//
// The roll-up of every document attached across the current view's assets,
// plus the scan entry point. Scanning is per-asset (documents belong to an
// asset), so "Scan document" first asks which asset, then opens the scanner.

import { useState } from 'react';
import DocumentScanner from './DocumentScanner';
import { assetClassDef, type WealthVisibility } from '@/lib/wealth';
import type { WealthData } from './useWealthData';

export default function WealthDocuments({ data, view }: {
  data: WealthData;
  view: Extract<WealthVisibility, 'shared' | 'personal'>;
}) {
  const { isParent, familyId, author } = data;
  const assets = data.assets.filter((a) => a.visibility === view);
  const docs = assets.flatMap((a) => (a.media || []).map((m) => ({ m, asset: a })));
  const [pickOpen, setPickOpen] = useState(false);
  const [scanAssetId, setScanAssetId] = useState<string | null>(null);
  const scanAsset = assets.find((a) => a.id === scanAssetId) || null;
  const canScan = isParent && assets.length > 0;

  return (
    <div className="adult-block">
      <div className="section-title"><h2>🗂️ Document Vault <span className="pilltag">Scan · Enhance · Store</span></h2></div>
      <div className="scanwrap">
        <div className="scanner">
          <div className="scan-frame"><span className="corner c1" /><span className="corner c2" /><span className="corner c3" /><span className="corner c4" /><div className="doc" /><div className="scan-line" /></div>
          <div className="scan-actions">
            <button className="sb-scan" onClick={() => canScan && setPickOpen(true)} disabled={!canScan}>📷 Scan document</button>
            <button className="sb-enh" onClick={() => canScan && setPickOpen(true)} disabled={!canScan}>✨ Add &amp; enhance</button>
          </div>
          <div className="enhance-row">✨ <span><b>Enhance</b> auto-crops edges, flattens, de-shadows &amp; sharpens — not just a photo.{assets.length === 0 ? ' Add an asset first.' : ''}</span></div>
        </div>
        <div className="gallery">
          <div className="gt">Attached to your assets</div>
          <div className="thumbs">
            {docs.length === 0 && (
              <div className="thumb"><span className="em">🗂️</span>No documents yet</div>
            )}
            {docs.map(({ m, asset }) => (
              <div className="thumb docfile enh" key={m.id} role="button"
                title={`${m.label} · ${asset.name}`}
                onClick={() => window.open(m.url, '_blank', 'noopener')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt={m.label} />
                <span className="lbl">{m.label}</span>
                {m.enhanced && <span className="badge2">Enhanced</span>}
              </div>
            ))}
            {canScan && (
              <div className="thumb" role="button" onClick={() => setPickOpen(true)}><span className="em">➕</span>Add file</div>
            )}
          </div>
        </div>
      </div>

      {pickOpen && (
        <div className="kw-modal-back" onClick={() => setPickOpen(false)}>
          <div className="kw-modal" onClick={(e) => e.stopPropagation()}>
            <h3>🗂️ Attach to which asset?</h3>
            <div className="msub">Documents live with the asset they belong to.</div>
            {assets.map((a) => (
              <button key={a.id} className="kw-pick-row" onClick={() => { setScanAssetId(a.id); setPickOpen(false); }}>
                <span>{assetClassDef(a.class).emoji} {a.name}</span>
                <span className="kw-pick-count">{a.media?.length ? `${a.media.length} 📎` : ''}</span>
              </button>
            ))}
            <div className="kw-modal-actions"><button className="kw-btn-ghost" onClick={() => setPickOpen(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {scanAsset && familyId && (
        <DocumentScanner familyId={familyId} assetId={scanAsset.id} assetName={scanAsset.name} author={author}
          onClose={() => setScanAssetId(null)} />
      )}
    </div>
  );
}
