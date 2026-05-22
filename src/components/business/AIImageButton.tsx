'use client';

// Kaya Business · AI image button. On tap, asks /api/business-image for a
// friendly logo / product picture, previews it, and on "Use this" hands the
// base64 data URL to the caller (which uploads it to Storage + saves the URL).
// Renders nothing if the API has no key (graceful, like the coach).

import { useState } from 'react';

export default function AIImageButton({
  kind,
  subject,
  detail,
  onAccept,
  cta = '✨ Generate with AI',
}: {
  kind: 'logo' | 'product';
  subject: string;
  detail?: string;
  /** Receives the base64 data URL; should upload + persist, then resolve. */
  onAccept: (dataUrl: string) => Promise<void>;
  cta?: string;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'preview' | 'saving' | 'error' | 'off'>('idle');
  const [image, setImage] = useState('');
  const [error, setError] = useState('');

  const generate = async () => {
    setState('loading'); setError('');
    try {
      const r = await fetch('/api/business-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, subject, detail }),
      });
      const j = await r.json();
      if (j?.skipped) { setState('off'); return; }
      if (!r.ok || j?.error || !j?.image) { setError(j?.error || 'Could not generate.'); setState('error'); return; }
      setImage(j.image);
      setState('preview');
    } catch {
      setError('Could not generate.'); setState('error');
    }
  };

  const accept = async () => {
    setState('saving');
    try { await onAccept(image); setState('idle'); setImage(''); }
    catch (e: any) { setError(e?.message || 'Could not save.'); setState('error'); }
  };

  if (state === 'off') return null;

  if (state === 'preview' || state === 'saving') {
    return (
      <div className="bg-hive-paper border border-hive-line rounded-hive p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="AI preview" className="w-full max-w-[220px] mx-auto aspect-square object-contain rounded-hive mb-2" />
        <div className="flex gap-2">
          <button onClick={accept} disabled={state === 'saving'}
            className="flex-1 h-10 rounded-hive-pill bg-[#2F7D32] text-white font-nunito font-black text-[12.5px] disabled:opacity-40">
            {state === 'saving' ? 'Saving…' : '✓ Use this'}
          </button>
          <button onClick={generate} disabled={state === 'saving'}
            className="h-10 px-3 rounded-hive-pill bg-hive-cream text-hive-muted font-nunito font-extrabold text-[12px]">↻ Again</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={generate} disabled={state === 'loading' || !subject.trim()}
        className="w-full h-11 rounded-hive bg-hive-paper border border-hive-line text-hive-navy font-nunito font-extrabold text-[13px] disabled:opacity-40 hover:bg-hive-cream active:scale-[0.99] transition">
        {state === 'loading' ? 'Drawing… ✨' : cta}
      </button>
      {error && <p className="text-hive-rose text-[12px] font-bold mt-1.5">{error}</p>}
    </div>
  );
}
