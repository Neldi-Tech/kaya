'use client';

// /admin/buzz — Buzz Settings (premium dark, per design HTML).
// Operator-only. Drives /config/buzz via /api/buzz/settings (which
// the public /buzz surface subscribes to live, so flipping the
// roadmap toggle takes effect without a deploy).

import { useEffect, useState } from 'react';
import { DEFAULT_BUZZ_SETTINGS, type BuzzSettings } from '@/lib/buzz';
import { getBuzzSettings, saveBuzzSettings } from '@/lib/buzzClient';

export default function AdminBuzzPage() {
  const [base, setBase]   = useState<BuzzSettings | null>(null);
  const [draft, setDraft] = useState<BuzzSettings | null>(null);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getBuzzSettings();
        if (cancelled) return;
        setBase(s); setDraft(s);
      } catch (e) {
        if (!cancelled) setErr(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function update<K extends keyof BuzzSettings>(key: K, value: BuzzSettings[K]) {
    setDraft((prev) => prev ? ({ ...prev, [key]: value }) : prev);
  }

  const dirty = !!base && !!draft && JSON.stringify(base) !== JSON.stringify(draft);

  async function publish() {
    if (!draft) return;
    setBusy(true); setErr(null);
    try {
      const next = await saveBuzzSettings(draft);
      setBase(next); setDraft(next);
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  function discard() { if (base) setDraft(base); }
  function reset()   { setDraft(DEFAULT_BUZZ_SETTINGS); }

  if (!draft) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-white/70 text-sm" style={{ background: 'linear-gradient(180deg,#0F1F44 0%,#162954 100%)' }}>
        Loading settings…
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white" style={{ background: 'linear-gradient(180deg,#0F1F44 0%,#162954 100%)' }}>
      <div className="max-w-[1100px] mx-auto p-5 sm:p-9 pb-32">
        <header className="mb-6">
          <h2 className="font-display font-extrabold text-2xl text-white tracking-tight m-0 flex items-center gap-2">✨ Buzz settings</h2>
          <p className="text-white/70 text-sm mt-1">How the ideas &amp; help community behaves for all invited families.</p>
          {err && <p className="mt-2 text-[12px] text-red-300 font-semibold">{err}</p>}
        </header>

        <section className="rounded-[20px] p-5 border border-white/[0.08]" style={{ background: 'rgba(255,255,255,0.05)' }}>
          {/* All settings in one consistent 2-column grid. The Roadmap toggle
              (the "go live to families" switch) leads the left column so it's
              still the first thing the operator sees, but without the
              awkward standalone gold-box treatment that misaligned it from
              the rest. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <div>
              <Setting label="🗺 Show 'Roadmap at a glance' to families" description="When on, families see Coming Soon / Building / Just Released columns at the top of /buzz. Off keeps the design preserved but hidden in public view." kind="toggle" value={draft.showRoadmap}           onChange={(v) => update('showRoadmap', v as boolean)} accentGold />
              <Setting label="Allow anonymous posts"      description="Families can hide their name on ideas & comments."        kind="toggle" value={draft.allowAnonymous}       onChange={(v) => update('allowAnonymous', v as boolean)} />
              <Setting label="Kids default to anonymous"  description="Kid accounts post anonymously unless parent overrides."   kind="toggle" value={draft.kidsDefaultAnonymous} onChange={(v) => update('kidsDefaultAnonymous', v as boolean)} />
              <Setting label="Auto-publish ideas"         description="Off = admin review queue before going public."           kind="toggle" value={draft.autoPublish}          onChange={(v) => update('autoPublish', v as boolean)} />
              <Setting label="Enable Buzz Badge"         description="Public badge on profile when an idea ships."             kind="toggle" value={draft.enableBuzzBadge}    onChange={(v) => update('enableBuzzBadge', v as boolean)} />
            </div>
            <div>
              <Setting label="Honey Coins per shipped idea" description="Credited to contributor's family — split evenly across kids." kind="number" value={draft.honeyCoinsPerShippedIdea} onChange={(v) => update('honeyCoinsPerShippedIdea', v as number)} min={0} max={10000} />
              <Setting label="Anonymous posts still earn coins" description="Rewards paid privately; no public badge."         kind="toggle" value={draft.anonymousEarnsCoins}  onChange={(v) => update('anonymousEarnsCoins', v as boolean)} />
              <Setting label="Founder coffee — top N / quarter" description="30-min video calls with top contributors."         kind="number" value={draft.founderCoffeeTopN}    onChange={(v) => update('founderCoffeeTopN', v as number)} min={0} max={20} />
              <Setting label="Show Stories category"      description="Family wins & testimonials feed into marketing."         kind="toggle" value={draft.showStoriesCategory}  onChange={(v) => update('showStoriesCategory', v as boolean)} />
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button type="button" onClick={reset} className="text-[11px] text-white/40 hover:text-white/70">Reset to defaults</button>
          </div>
        </section>

        {/* Sticky save bar */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 max-w-[920px] w-[calc(100%-2.5rem)] rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap border border-white/[0.12] shadow-[0_24px_60px_rgba(0,0,0,0.35)]" style={{ background: 'rgba(15,31,68,0.96)', backdropFilter: 'blur(10px)' }}>
          <div className="flex items-center gap-2 text-[12px] text-white/80">
            <span className="w-2 h-2 rounded-full" style={{ background: dirty ? '#D4A847' : '#5BB85B', boxShadow: dirty ? '0 0 12px #D4A847' : 'none' }} />
            {dirty ? <span><b className="text-white">Changes staged</b> · preview locally until you publish.</span> : <span className="text-white/60">No changes staged.</span>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={discard} disabled={!dirty || busy} className="bg-transparent text-white border border-white/20 px-3 py-2 rounded-lg font-bold text-[12px] disabled:opacity-40">Discard</button>
            <button type="button" onClick={publish} disabled={!dirty || busy} className="bg-[#D4A847] text-[#0F1F44] border-none px-3.5 py-2 rounded-lg font-extrabold text-[12px] disabled:opacity-40 shadow-[0_6px_14px_rgba(212,168,71,0.3)]">
              {busy ? 'Publishing…' : 'Publish changes →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Setting({
  label, description, kind, value, onChange, min, max, accentGold,
}: {
  label: string;
  description: string;
  kind: 'toggle' | 'number';
  value: boolean | number;
  onChange: (v: boolean | number) => void;
  min?: number; max?: number;
  accentGold?: boolean;
}) {
  return (
    <div className="py-3 border-b border-white/[0.06] last:border-b-0 flex items-center justify-between gap-3">
      <div className="flex-1">
        <div className={`text-[13px] font-bold ${accentGold ? 'text-[#D4A847]' : 'text-white'}`}>{label}</div>
        <div className="text-[11px] text-white/55 mt-0.5">{description}</div>
      </div>
      {kind === 'toggle' ? (
        <button
          type="button"
          onClick={() => onChange(!(value as boolean))}
          className="relative inline-block w-[38px] h-[22px]"
          aria-pressed={value as boolean}
        >
          <span className={`absolute inset-0 rounded-full transition-colors ${value ? 'bg-[#D4A847]' : 'bg-white/20'}`} />
          <span className={`absolute top-[3px] w-4 h-4 bg-white rounded-full shadow transition-all ${value ? 'left-[19px]' : 'left-[3px]'}`} />
        </button>
      ) : (
        <input
          type="number"
          value={value as number}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 bg-white/[0.08] border border-white/[0.12] text-white px-2 py-1 rounded-md text-[12px] font-bold text-center"
        />
      )}
    </div>
  );
}
