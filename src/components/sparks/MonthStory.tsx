'use client';

// Timeline 2.0 · 📖 Kaya Writes — Month Story (design v2 innovation #3).
//
// One warm cached paragraph about a month of notes, shown at the top of
// the month in the Browse view. First open generates it (family
// kill-switch honoured); parents get a 🔄 regenerate. Locked pages
// never reach the model — the gateway reads server-side.

import { useEffect, useState } from 'react';
import { getMonthStory, writeMonthStory } from '@/lib/noteSend';

export default function MonthStory({ kidId, surface, monthKey, isParent, sw }: {
  kidId: string;
  surface: 'reflection' | 'diary';
  monthKey: string; // YYYY-MM
  isParent: boolean;
  sw: boolean;
}) {
  const [story, setStory] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'off'>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setState('loading'); setStory(null);
    (async () => {
      try {
        const cached = await getMonthStory({ kidId, surface, monthKey });
        if (!alive) return;
        if (cached.story) { setStory(cached.story); setState('ready'); return; }
        const fresh = await writeMonthStory({ kidId, surface, monthKey, lang: sw ? 'sw' : 'en' });
        if (!alive) return;
        if (fresh.story) { setStory(fresh.story); setState('ready'); }
        else setState('off'); // kill-switch, too few notes, or no API key
      } catch { if (alive) setState('off'); }
    })();
    return () => { alive = false; };
  }, [kidId, surface, monthKey, sw]);

  const regenerate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const fresh = await writeMonthStory({ kidId, surface, monthKey, lang: sw ? 'sw' : 'en', force: true });
      if (fresh.story) setStory(fresh.story);
    } catch { /* keep the old story */ }
    finally { setBusy(false); }
  };

  if (state === 'off') return null;

  return (
    <div className="mb-2 rounded-2xl border-[1.5px] border-[#E5D6FF] bg-[#F6EFFF] px-3.5 py-2.5">
      <div className="flex items-center justify-between">
        <span className="font-nunito font-black text-[10.5px] tracking-wide text-[#5A3CB8]">
          📖 {sw ? 'KAYA ANAANDIKA · HADITHI YA MWEZI' : 'KAYA WRITES · THE MONTH’S STORY'}
        </span>
        {isParent && state === 'ready' && (
          <button type="button" onClick={regenerate} disabled={busy}
            className="font-nunito font-extrabold text-[10.5px] text-[#5A3CB8] disabled:opacity-50">
            {busy ? '…' : `🔄 ${sw ? 'Andika upya' : 'Rewrite'}`}
          </button>
        )}
      </div>
      {state === 'loading'
        ? <p className="text-[12px] text-[#5A6488] italic mt-1 m-0">{sw ? 'Kaya anaandika…' : 'Kaya is writing…'}</p>
        : <p className="text-[12.5px] text-[#2c2056] italic leading-relaxed mt-1 m-0">{story}</p>}
    </div>
  );
}
