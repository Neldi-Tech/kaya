'use client';

// Kaya Business · AI co-pilot card. Calls /api/business-coach on demand (a tap,
// not on every render — keeps it cheap) and shows the coach's bubble + advisory
// reply chips. The coach only ever proposes; the chips are conversation
// prompts, not actions. Renders nothing if the API has no key (graceful).

import { useState } from 'react';

type Loop = 'idea' | 'pricing' | 'cost_flag' | 'weekly';

export default function AICoachCard({
  loop,
  facts,
  coachName = 'Kaya Coach',
  currency = 'USD',
  cta = 'Ask for a tip',
}: {
  loop: Loop;
  facts: Record<string, string | number>;
  coachName?: string;
  currency?: string;
  cta?: string;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error' | 'off'>('idle');
  const [message, setMessage] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const ask = async () => {
    setState('loading');
    try {
      const r = await fetch('/api/business-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loop, coachName, currency, facts }),
      });
      const j = await r.json();
      if (j?.skipped) { setState('off'); return; }
      if (!r.ok || j?.error || !j?.message) { setState('error'); return; }
      setMessage(j.message);
      setSuggestions(Array.isArray(j.suggestions) ? j.suggestions : []);
      setState('done');
    } catch {
      setState('error');
    }
  };

  if (state === 'off') return null; // no API key — stay silent

  const Bubble = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-[16px_16px_16px_4px] bg-hive-navy text-hive-cream p-3.5">
      <div className="text-[10px] font-nunito font-black uppercase tracking-wider text-hive-honey mb-1">
        🤖 {coachName}
      </div>
      {children}
    </div>
  );

  if (state === 'idle') {
    return (
      <button onClick={ask}
        className="w-full flex items-center justify-center gap-2 h-11 rounded-hive bg-hive-paper border border-hive-line text-hive-navy font-nunito font-extrabold text-[13px] hover:bg-hive-cream active:scale-[0.99] transition">
        🤖 {cta}
      </button>
    );
  }

  if (state === 'loading') {
    return <Bubble><p className="text-[13px] opacity-80">Thinking about your numbers…</p></Bubble>;
  }

  if (state === 'error') {
    return (
      <Bubble>
        <p className="text-[13px]">I couldn&apos;t get a tip just now.</p>
        <button onClick={ask} className="mt-2 text-[12px] font-nunito font-extrabold text-hive-honey hover:underline">Try again</button>
      </Bubble>
    );
  }

  return (
    <Bubble>
      <p className="text-[13px] leading-relaxed whitespace-pre-line">{message}</p>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {suggestions.map((s, i) => (
            <span key={i} className="px-2.5 py-1 rounded-hive-pill bg-white/10 text-hive-honey-soft text-[11px] font-nunito font-bold">
              {s}
            </span>
          ))}
        </div>
      )}
      <button onClick={ask} className="mt-2.5 text-[11px] font-nunito font-bold text-hive-honey-soft/70 hover:text-hive-honey">↻ Ask again</button>
    </Bubble>
  );
}
