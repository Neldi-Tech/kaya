'use client';

// Kaya Wealth · Document Vault section (PR3 · standalone scan, 2026-06-02).
//
// Scan a document ANY time — no asset required. The scan lands in the general
// vault, and you can optionally attach it to an asset from inside the scanner.
// The gallery shows both the unfiled docs and everything attached across this
// view's assets.

import { useEffect, useState } from 'react';
import DocumentScanner from './DocumentScanner';
import { subscribeUnfiledDocs, replaceUnfiledDoc, replaceAssetDocument, type WealthDocEntry } from './wealthDocs';
import ReScanButton from '@/components/scan/ReScanButton';
import { assetInView, type WealthVisibility } from '@/lib/wealth';
import type { WealthData } from './useWealthData';

export default function WealthDocuments({ data, view }: {
  data: WealthData;
  view: Extract<WealthVisibility, 'shared' | 'personal'>;
}) {
  const { isParent, familyId, author } = data;
  const assets = data.assets.filter((a) => assetInView(a, view, author.uid));
  const assetDocs = assets.flatMap((a) => (a.media || []).map((m) => ({ m, asset: a })));
  const [unfiled, setUnfiled] = useState<WealthDocEntry[]>([]);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => { if (familyId) return subscribeUnfiledDocs(familyId, setUnfiled); }, [familyId]);

  const canScan = isParent;
  const assetList = assets.map((a) => ({ id: a.id, name: a.name }));
  const total = unfiled.length + assetDocs.length;

  return (
    <div className="adult-block">
      <div className="section-title"><h2>🗂️ Document Vault <span className="pilltag">Scan · Enhance · Store</span></h2></div>
      <div className="scanwrap">
        <div className="scanner">
          <div className="scan-frame"><span className="corner c1" /><span className="corner c2" /><span className="corner c3" /><span className="corner c4" /><div className="doc" /><div className="scan-line" /></div>
          <div className="scan-actions">
            <button className="sb-scan" onClick={() => canScan && setScanOpen(true)} disabled={!canScan}>📷 Scan document</button>
            <button className="sb-enh" onClick={() => canScan && setScanOpen(true)} disabled={!canScan}>✨ Add &amp; enhance</button>
          </div>
          <div className="enhance-row">✨ <span><b>Enhance</b> de-shadows, sharpens &amp; cleans up your scan — not just a photo. Scan now; attach it to an asset later, or keep it in the general vault.</span></div>
        </div>
        <div className="gallery">
          <div className="gt">Your documents</div>
          <div className="thumbs">
            {total === 0 && (
              <div className="thumb"><span className="em">🗂️</span>No documents yet</div>
            )}
            {unfiled.map((d) => (
              <div className="thumb docfile enh" key={d.id} role="button"
                title={`${d.label} · general vault`}
                style={{ position: 'relative' }}
                onClick={() => window.open(d.url, '_blank', 'noopener')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.url} alt={d.label} />
                <span className="lbl">{d.label}</span>
                {d.enhanced && <span className="badge2">Enhanced</span>}
                {isParent && familyId && (
                  <span onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 4, left: 4, zIndex: 2 }}>
                    <ReScanButton
                      label="" title="Re-scan / replace this document"
                      className="text-[11px] font-extrabold bg-white/90 text-[#0F1F44] rounded-full px-1.5 py-0.5 shadow disabled:opacity-50"
                      onReplace={async (files) => { await replaceUnfiledDoc(familyId, d, files[0], author); }}
                    />
                  </span>
                )}
              </div>
            ))}
            {assetDocs.map(({ m, asset }) => (
              <div className="thumb docfile enh" key={m.id} role="button"
                title={`${m.label} · ${asset.name}`}
                style={{ position: 'relative' }}
                onClick={() => window.open(m.url, '_blank', 'noopener')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt={m.label} />
                <span className="lbl">{m.label}</span>
                {m.enhanced && <span className="badge2">Enhanced</span>}
                {isParent && familyId && (
                  <span onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 4, left: 4, zIndex: 2 }}>
                    <ReScanButton
                      label="" title="Re-scan / replace this document"
                      className="text-[11px] font-extrabold bg-white/90 text-[#0F1F44] rounded-full px-1.5 py-0.5 shadow disabled:opacity-50"
                      onReplace={async (files) => { await replaceAssetDocument(familyId, asset.id, m, files[0], author); }}
                    />
                  </span>
                )}
              </div>
            ))}
            {canScan && (
              <div className="thumb" role="button" onClick={() => setScanOpen(true)}><span className="em">➕</span>Scan / add</div>
            )}
          </div>
        </div>
      </div>

      {scanOpen && familyId && (
        <DocumentScanner familyId={familyId} author={author} assets={assetList}
          onClose={() => setScanOpen(false)} />
      )}
    </div>
  );
}
