'use client';

// /admin/branding — minimal v1. Two operator-controlled knobs:
//   1. Brand wordmark — overrides the "Kaya" string in the sidebar /
//      nav header (closed-beta convenience: e.g. "Kaya · Closed Beta").
//   2. Announcement banner — single-line message rendered at the top of
//      every app-shell page (e.g. "🎉 Buzz Coming Soon · share ideas").
//
// Saves to /config/branding via PATCH /api/admin/branding.
// Broader theming (accent colors, logos, fonts) is deferred to v1.1.

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { DEFAULT_BRANDING, type BrandingConfig } from '@/lib/branding';

export default function AdminBrandingPage() {
  const [live, setLive] = useState<BrandingConfig>(DEFAULT_BRANDING);
  const [draft, setDraft] = useState<BrandingConfig>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setErr(null);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const res = await fetch('/api/admin/branding', { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`load-failed-${res.status}`);
      const { branding } = (await res.json()) as { branding: BrandingConfig };
      setLive(branding);
      setDraft(branding);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const dirty =
    draft.wordmark !== live.wordmark ||
    draft.bannerEnabled !== live.bannerEnabled ||
    draft.bannerText !== live.bannerText ||
    draft.bannerEmoji !== live.bannerEmoji;

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const res = await fetch('/api/admin/branding', {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'unknown' }));
        throw new Error(error || 'save-failed');
      }
      const { branding } = (await res.json()) as { branding: BrandingConfig };
      setLive(branding);
      setDraft(branding);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(160deg,#0F1F44 0%,#162954 100%)' }}>
      <div className="max-w-[720px] mx-auto px-5 py-10">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-9 h-9 rounded-xl grid place-items-center"
              style={{ background: 'rgba(212,168,71,0.18)', border: '1px solid rgba(212,168,71,0.3)' }}
            >
              <span className="text-base">🎨</span>
            </div>
            <h1 className="font-display font-black text-2xl text-white tracking-tight m-0">Branding</h1>
          </div>
          <p className="text-white/55 text-[13px] font-semibold ml-12">
            Minimal v1 · wordmark + announcement banner · live via <code className="text-[#D4A847]">/config/branding</code>. Theme colours, logos, fonts land in v1.1.
          </p>
        </header>

        {err && (
          <div className="bg-[#FF6B6B]/10 border border-[#FF6B6B]/30 rounded-2xl px-4 py-3 text-[#FF7676] text-[13px] font-bold mb-4">
            {err}
          </div>
        )}

        {loading && (
          <div className="text-white/55 text-sm py-12 text-center">Loading current branding…</div>
        )}

        {!loading && !err && (
          <div className="flex flex-col gap-4">
            {/* Live preview */}
            <Preview branding={draft} />

            {/* Wordmark */}
            <Section title="Wordmark" hint="The string shown in the sidebar header. Defaults to 'Kaya'. Max 30 chars.">
              <input
                value={draft.wordmark}
                onChange={(e) => setDraft({ ...draft, wordmark: e.target.value.slice(0, 30) })}
                placeholder="Kaya"
                className="w-full bg-transparent text-white text-[15px] font-extrabold outline-none"
              />
            </Section>

            {/* Banner */}
            <Section
              title="Announcement banner"
              hint="A single line shown at the very top of every signed-in page. Off by default."
            >
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setDraft({ ...draft, bannerEnabled: !draft.bannerEnabled })}
                  className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full"
                  style={
                    draft.bannerEnabled
                      ? { background: 'rgba(212,168,71,0.2)', color: '#D4A847' }
                      : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }
                  }
                >
                  {draft.bannerEnabled ? 'On' : 'Off'}
                </button>
                <span className="text-[11px] text-white/55 font-semibold">
                  {draft.bannerEnabled ? 'Visible to every signed-in user.' : 'Hidden.'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={draft.bannerEmoji}
                  onChange={(e) => setDraft({ ...draft, bannerEmoji: e.target.value.slice(0, 4) })}
                  placeholder="🎉"
                  className="w-12 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-base text-center outline-none"
                />
                <input
                  value={draft.bannerText}
                  onChange={(e) => setDraft({ ...draft, bannerText: e.target.value.slice(0, 120) })}
                  placeholder="Buzz Coming Soon — share your ideas at /buzz"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-[13px] font-semibold outline-none"
                />
              </div>
              <div className="text-[10px] text-white/45 font-semibold mt-1">
                {draft.bannerText.length}/120 chars
              </div>
            </Section>

            {/* Actions */}
            <footer className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setDraft(live)}
                disabled={!dirty || saving}
                className="text-[12px] font-bold px-3 py-2 rounded-lg disabled:opacity-50"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}
              >
                Discard
              </button>
              <button
                onClick={save}
                disabled={!dirty || saving}
                className="text-[12px] font-black px-4 py-2 rounded-lg disabled:opacity-50"
                style={{ background: '#D4A847', color: '#0F1F44' }}
              >
                {saving ? 'Saving…' : 'Publish'}
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}

function Preview({ branding }: { branding: BrandingConfig }) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div className="text-[10px] font-black text-white/55 uppercase tracking-wider px-4 pt-3">Preview</div>
      <div className="bg-[#FBF7EE] m-3 rounded-xl overflow-hidden">
        {branding.bannerEnabled && branding.bannerText && (
          <div
            className="px-4 py-2 text-[12px] font-bold flex items-center gap-2"
            style={{ background: '#0F1F44', color: 'white' }}
          >
            {branding.bannerEmoji && <span>{branding.bannerEmoji}</span>}
            <span>{branding.bannerText}</span>
          </div>
        )}
        <div className="px-4 py-3 flex items-center gap-3">
          <div
            className="w-7 h-7 rounded-lg grid place-items-center"
            style={{ background: '#D4A847', color: '#0F1F44' }}
          >
            <span className="text-sm font-black">{branding.wordmark.slice(0, 1)}</span>
          </div>
          <span className="font-display font-black text-[18px] text-[#0F1F44]">{branding.wordmark}</span>
        </div>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-2xl p-4"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div className="text-[11px] font-black text-white/55 uppercase tracking-wider mb-1">{title}</div>
      <div className="text-[10px] text-white/45 font-semibold mb-3 leading-snug">{hint}</div>
      <div
        className="rounded-xl px-3 py-2.5"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {children}
      </div>
    </section>
  );
}
