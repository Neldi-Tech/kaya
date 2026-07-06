'use client';

// /pantry/utility-meters/alerts — 📜 the Alert log (VIS PR2, approved v2).
//
// Every low-balance alarm the engine fired, grouped by day, each entry
// openable to a per-channel trace: the EMAIL AS SENT (re-rendered from its
// stamped templateVersion + facts — F9: we store facts, never HTML), the
// family-chat bubble and the in-app bell card verbatim (D8/F12), plus who
// received each channel and which cascade level resolved them (D11).
// Recovered entries close each episode's story. Parent-only — entries carry
// recipient email addresses (the API route enforces this too).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { auth } from '@/lib/firebase';
import { fetchAlertLog, type AlertLogEntry } from '@/lib/alertLog';
import { relativeDayLabel, toDisplayDate } from '@/lib/dates';
import { meterEmoji, type UtilityMeterType } from '@/lib/utilityMeters';
import { formatCents } from '@/components/pantry/format';

type Tab = 'email' | 'chat' | 'inapp';

const dayKeyOf = (ms: number): string => {
  const d = new Date(ms); // LOCAL day boundaries — Kaya families are worldwide
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const timeOf = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const emojiOf = (e: AlertLogEntry): string =>
  e.meterType ? meterEmoji(e.meterType as UtilityMeterType) : '🔌';

export default function AlertLogPage() {
  const { profile, isGuest } = useAuth();
  const isParent = profile?.role === 'parent';
  const [entries, setEntries] = useState<AlertLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<AlertLogEntry | null>(null);
  const [tab, setTab] = useState<Tab>('email');

  useEffect(() => {
    if (!isParent || isGuest) { setLoading(false); return; }
    (async () => {
      try {
        const u = auth.currentUser;
        if (!u) return;
        setEntries(await fetchAlertLog(await u.getIdToken()));
      } finally { setLoading(false); }
    })();
  }, [isParent, isGuest]);

  if (profile && !isParent) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h2 className="font-nunito font-black text-lg">The Alert log is parent-only</h2>
        <p className="text-hive-muted text-sm mt-2 mb-4">It shows who was emailed about low balances.</p>
        <Link href="/pantry/utility" className="text-hive-honey-dk font-nunito font-bold text-sm underline">← Back to Utility</Link>
      </div>
    );
  }

  // Group by local day — entries arrive newest-first from the route.
  const groups: { key: string; rows: AlertLogEntry[] }[] = [];
  for (const e of entries) {
    const key = dayKeyOf(e.firedAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(e);
    else groups.push({ key, rows: [e] });
  }
  const dayLabel = (key: string) => {
    const rel = relativeDayLabel(key);
    const disp = toDisplayDate(key);
    return rel === disp ? disp : `${rel} · ${disp}`;
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-4">
        <Link href="/pantry/utility-meters" className="text-[12px] text-pantry-leaf-dk font-bold no-underline hover:underline inline-block mb-2">
          ← Manage meters
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight">📜 Alert log</h1>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#FFF3D9] text-hive-honey-dk border border-hive-honey/40">last 90 days</span>
        </div>
        <p className="text-hive-muted text-sm mt-1">
          Every low-balance alarm Kaya raised — open one to see exactly what was sent, and to whom.
        </p>
      </div>

      {loading && <p className="text-sm text-hive-muted font-bold">Loading…</p>}
      {!loading && entries.length === 0 && (
        <div className="bg-hive-paper border border-dashed border-hive-line rounded-hive p-6 text-center">
          <div className="text-2xl mb-1">🔕</div>
          <p className="font-nunito font-extrabold text-sm">No alarms yet</p>
          <p className="text-[12px] text-hive-muted font-bold mt-1">
            When a protected meter runs low, the alert lands here with its full trace.
          </p>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key}>
          <p className="text-[10px] font-nunito font-black uppercase tracking-[1.5px] text-hive-muted mt-4 mb-1.5">{dayLabel(g.key)}</p>
          {g.rows.map((e) => {
            // 📬 Kid emails (KID PR2/PR3) — same log, their own row shape.
            if (e.kind === 'kid_reward' || e.kind === 'kid_digest') {
              const em = e.channels?.email;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => { setOpen(e); setTab('email'); }}
                  className="w-full text-left bg-hive-paper border border-hive-line rounded-hive p-3 mb-2 hover:border-hive-honey"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{e.kind === 'kid_reward' ? '🏅' : '🌞'}</span>
                    <span className="font-nunito font-extrabold text-[13px] text-hive-navy truncate">
                      {e.childName || 'Kid'} · {e.kind === 'kid_reward' ? 'reward email' : 'morning digest'}
                    </span>
                    {em?.sent ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#E7F5EC] text-pantry-leaf-dk border border-pantry-leaf-dk/30">✅ sent</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#FDE8E8] text-hive-rose border border-hive-rose/40">❌ not sent</span>
                    )}
                    <span className="ml-auto text-hive-muted text-sm">›</span>
                  </div>
                  <p className="text-[11px] text-hive-muted font-bold mt-1 truncate">
                    {timeOf(e.firedAt)}{em?.subject ? ` · ${em.subject}` : ''}{e.sourceLabel ? ` · via ${e.sourceLabel}` : ''}
                  </p>
                </button>
              );
            }
            const unit = e.unit ? ` ${e.unit}` : '';
            const ch = e.channels;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => { if (e.kind === 'alert') { setOpen(e); setTab('email'); } }}
                className={`w-full text-left bg-hive-paper border border-hive-line rounded-hive p-3 mb-2 ${e.kind === 'alert' ? 'hover:border-hive-honey' : 'opacity-90'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{emojiOf(e)}</span>
                  <span className="font-nunito font-extrabold text-[13px] text-hive-navy truncate">{e.meterLabel}</span>
                  {e.kind === 'recovered' ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#E7F5EC] text-pantry-leaf-dk border border-pantry-leaf-dk/30">✅ recovered</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#FDE8E8] text-hive-rose border border-hive-rose/40">🔔 LOW {Math.round(e.balance ?? 0)}{unit}</span>
                  )}
                  {e.kind === 'alert' && <span className="ml-auto text-hive-muted text-sm">›</span>}
                </div>
                <p className="text-[11px] text-hive-muted font-bold mt-1">
                  {timeOf(e.firedAt)} · {e.trigger === 'sweep' ? 'hourly sweep' : 'on a reading'} · floor {e.threshold}{unit}
                  {e.kind === 'alert' && e.daysLeft != null ? ` · ~${e.daysLeft} days left` : ''}
                  {e.kind === 'recovered' ? ` · back to ${Math.round(e.balance ?? 0)}${unit}` : ''}
                </p>
                {e.kind === 'alert' && ch && (
                  <div className="flex items-center gap-1 flex-wrap mt-1.5">
                    <ChanChip label="📧" c={ch.email} count={ch.email?.to.length} />
                    <ChanChip label="🔔" c={ch.inapp} count={ch.inapp?.to.length} />
                    <ChanChip label="💬" c={ch.chat} />
                    <span className="text-[10px] font-nunito font-black px-1.5 py-0.5 rounded-lg border border-dashed border-hive-line text-hive-muted opacity-70">📱 soon</span>
                    {e.requestId && (
                      <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#FFF3D9] text-hive-honey-dk border border-hive-honey/40">
                        🤖 {e.requestName ? e.requestName.split(' · ')[0] : 'request'}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ))}

      {/* ── The trace sheet — each channel, as it was sent (D8). ── */}
      {open && (
        <>
          <div className="fixed inset-0 bg-hive-navy/40 z-40" onClick={() => setOpen(null)} />
          <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-hive-paper rounded-t-3xl shadow-2xl z-50 pb-8 pt-2 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-center pt-1 pb-2">
              <div className="w-12 h-1 rounded-full bg-hive-line"></div>
            </div>
            <div className="px-4">
              {open.kind === 'kid_reward' || open.kind === 'kid_digest' ? (
                <div className="flex items-center gap-2">
                  <span className="text-xl">{open.kind === 'kid_reward' ? '🏅' : '🌞'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-nunito font-black text-[15px] text-hive-navy">
                      {open.childName || 'Kid'} — {open.kind === 'kid_reward' ? 'reward email' : 'morning digest'}
                    </p>
                    <p className="text-[11px] text-hive-muted font-bold">
                      {toDisplayDate(dayKeyOf(open.firedAt))} {timeOf(open.firedAt)}
                      {open.sourceLabel ? ` · address via ${open.sourceLabel}` : ''}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xl">{emojiOf(open)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-nunito font-black text-[15px] text-hive-navy">{open.meterLabel} — low alert</p>
                    <p className="text-[11px] text-hive-muted font-bold">
                      {toDisplayDate(dayKeyOf(open.firedAt))} {timeOf(open.firedAt)} · {open.trigger === 'sweep' ? 'hourly sweep' : 'on a reading'}
                      {' · resolved by '}{open.resolvedBy === 'item' ? 'this meter' : open.resolvedBy === 'category' ? '⚡ Utilities setup' : '🌍 global setup'}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#FDE8E8] text-hive-rose border border-hive-rose/40 shrink-0">
                    {Math.round(open.balance ?? 0)} / {open.threshold}{open.unit ? ` ${open.unit}` : ''}
                  </span>
                </div>
              )}

              {/* Kid emails are email-only — no channel tabs to switch. */}
              {open.kind === 'alert' && (
                <div className="flex gap-1.5 mt-3 mb-3">
                  {(['email', 'chat', 'inapp'] as Tab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={`flex-1 text-center text-[11px] font-nunito font-black py-2 rounded-xl border ${tab === t ? 'bg-hive-navy text-white border-hive-navy' : 'bg-white text-hive-muted border-hive-line'}`}
                    >
                      {t === 'email' ? '📧 Email' : t === 'chat' ? '💬 Chat' : '🔔 In-app'}
                    </button>
                  ))}
                </div>
              )}
              {(open.kind === 'kid_reward' || open.kind === 'kid_digest') && <div className="mt-3" />}

              {(tab === 'email' || open.kind !== 'alert') && <EmailTab e={open} />}
              {tab === 'chat' && open.kind === 'alert' && <ChatTab e={open} />}
              {tab === 'inapp' && open.kind === 'alert' && <InAppTab e={open} />}

              {open.requestId && (
                <Link
                  href={`/pantry/purchase/${open.requestId}`}
                  className="block text-center bg-hive-honey text-white font-nunito font-black text-sm rounded-xl py-2.5 mt-4"
                >
                  Open request {open.requestName ? open.requestName.split(' · ')[0] : ''} →
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* Channel result chip on a log row: ✅ sent (+count) / ❌ failed / off. */
function ChanChip({ label, c, count }: { label: string; c?: { on: boolean; sent: boolean } | undefined; count?: number }) {
  if (!c || !c.on) {
    return <span className="text-[10px] font-nunito font-black px-1.5 py-0.5 rounded-lg border border-dashed border-hive-line text-hive-muted opacity-70">{label} off</span>;
  }
  return c.sent ? (
    <span className="text-[10px] font-nunito font-black px-1.5 py-0.5 rounded-lg bg-[#E7F5EC] text-pantry-leaf-dk">{label} ✅{count ? ` ${count}` : ''}</span>
  ) : (
    <span className="text-[10px] font-nunito font-black px-1.5 py-0.5 rounded-lg bg-[#FDE8E8] text-hive-rose">{label} ❌</span>
  );
}

/* ── 📧 The email, AS SENT — template v1 re-rendered from the stored
      facts (F9). Markup mirrors lib/autoTopup.server sendLowBalanceEmail
      1:1; bump both together with EMAIL_TEMPLATE_VERSION. ── */
function EmailTab({ e }: { e: AlertLogEntry }) {
  const em = e.channels?.email;
  if (!em) return <Missing what="email" />;
  // 🌞 Kid morning digest (KID PR3) — its own template, re-rendered from
  // the stored facts + version, like everything else in this log.
  if (em.kidDigestFacts) {
    const d = em.kidDigestFacts;
    return (
      <div>
        <div className="rounded-t-xl border border-b-0 border-hive-line bg-hive-cream px-3 py-2 text-[10px] text-hive-muted font-bold leading-relaxed">
          To: {em.to.length > 0 ? em.to.map((r) => `${r.name} <${r.email}>`).join(' · ') : '—'}<br />
          Subject: {em.subject}<br />
          {em.sent ? '✅ sent' : `❌ not sent${em.error ? ` · ${em.error}` : ''}`} · template v{em.templateVersion}
        </div>
        <div className="rounded-b-xl border border-hive-line bg-white p-3 font-nunito">
          <div className="rounded-2xl p-4 text-white" style={{ background: 'linear-gradient(135deg,#1F2A44,#2E3D5C)' }}>
            <div className="text-[15px] font-black">🌞 Good morning, {d.kidName}!</div>
            <div className="text-[11.5px] opacity-90 mt-0.5">{d.dateLabel} · here&apos;s your day 👇</div>
          </div>
          {d.tasks.length === 0 && (
            <p className="text-center text-[12px] text-hive-muted font-bold py-3">No tasks today — free day! 🎈</p>
          )}
          {d.tasks.map((t, i) => (
            <div key={i} className="flex items-center gap-2 border border-hive-line rounded-xl px-2.5 py-2 mt-1.5">
              <span className="text-base">{t.icon}</span>
              <span className="font-nunito font-extrabold text-[12px] text-hive-navy flex-1">{t.label}</span>
              {t.points ? <span className="text-[10.5px] font-nunito font-black text-hive-honey-dk">+{t.points} HP</span> : null}
            </div>
          ))}
          <div className="flex gap-2 mt-2.5">
            {[
              { l: 'YESTERDAY', v: `+${d.yesterdayPoints} HP`, c: '#C77E0A' },
              { l: 'BALANCE', v: `${d.balance.toLocaleString()} HP`, c: '#1F2A44' },
              { l: 'STREAK', v: d.streak > 0 ? `🔥 ${d.streak}` : '—', c: '#2E7D4F' },
            ].map((s) => (
              <div key={s.l} className="flex-1 rounded-xl p-2 text-center" style={{ background: '#FBF4E4' }}>
                <div className="text-[9px] font-extrabold" style={{ color: '#8A8471' }}>{s.l}</div>
                <div className="text-[14px] font-black" style={{ color: s.c }}>{s.v}</div>
              </div>
            ))}
          </div>
          <div className="text-center mt-3 mb-1">
            <span className="inline-block rounded-full px-6 py-2.5 font-black text-sm" style={{ background: '#F0A32A', color: '#3a2a08' }}>Open my day →</span>
          </div>
        </div>
        <p className="text-[10px] text-hive-muted font-bold mt-2 opacity-80">
          Sent daily at the set time — manage in 🧰 Household Setup.
        </p>
      </div>
    );
  }
  // 📬 Kid reward/digest emails carry kidFacts instead of meter facts —
  // rendered by their own template (KID PR2), same re-render discipline.
  if (em.kidFacts) {
    const k = em.kidFacts;
    return (
      <div>
        <div className="rounded-t-xl border border-b-0 border-hive-line bg-hive-cream px-3 py-2 text-[10px] text-hive-muted font-bold leading-relaxed">
          To: {em.to.length > 0 ? em.to.map((r) => `${r.name} <${r.email}>`).join(' · ') : '—'}<br />
          Subject: {em.subject}<br />
          {em.sent ? '✅ sent' : `❌ not sent${em.error ? ` · ${em.error}` : ''}`} · template v{em.templateVersion}
        </div>
        <div className="rounded-b-xl border border-hive-line bg-white p-3 font-nunito">
          <div className="rounded-2xl p-5 text-white text-center" style={{ background: 'linear-gradient(135deg,#F0A32A,#E58A1F)' }}>
            <div className="text-4xl leading-none">{k.emoji}</div>
            <div className="text-xl font-black mt-1.5">{k.headline}</div>
            <div className="text-[13px] font-extrabold opacity-95 mt-1">{k.detail}</div>
          </div>
          <div className="text-center mt-4">
            {k.balance != null && (
              <>
                <div className="text-[12px] font-bold" style={{ color: '#5C6975' }}>Your balance</div>
                <div className="text-[26px] font-black" style={{ color: '#1F2A44' }}>{k.balance.toLocaleString()} HP</div>
              </>
            )}
            {k.streak && k.streak > 1 ? (
              <div className="text-[12px] font-extrabold mt-0.5" style={{ color: '#2E7D4F' }}>🔥 {k.streak}-day streak — keep it going!</div>
            ) : null}
            <div className="mt-3 mb-1">
              <span className="inline-block rounded-full px-6 py-2.5 font-black text-sm" style={{ background: '#F0A32A', color: '#3a2a08' }}>See my day →</span>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-hive-muted font-bold mt-2 opacity-80">
          Sent because Reward emails are on for {k.kidName} — manage in 🧰 Household Setup.
        </p>
      </div>
    );
  }
  const f = em.facts;
  if (!f) return <Missing what="email" />;
  return (
    <div>
      <div className="rounded-t-xl border border-b-0 border-hive-line bg-hive-cream px-3 py-2 text-[10px] text-hive-muted font-bold leading-relaxed">
        To: {em.to.length > 0 ? em.to.map((r) => `${r.name} <${r.email}>`).join(' · ') : '—'}<br />
        Subject: {em.subject}<br />
        {em.sent ? '✅ sent' : `❌ not sent${em.error ? ` · ${em.error}` : ''}`} · template v{em.templateVersion}
      </div>
      <div className="rounded-b-xl border border-hive-line bg-white p-3 font-nunito">
        <div className="rounded-2xl p-5 text-white" style={{ background: 'linear-gradient(135deg,#1E2A44,#2C3E60)' }}>
          <div className="text-[10px] font-black uppercase tracking-[2px]" style={{ color: '#E8B54A' }}>🔔 Kaya · Utilities</div>
          <div className="text-lg font-black mt-1.5">{f.label} is running low</div>
          <div className="text-[13px] opacity-90 mt-1">{f.balanceLine}</div>
        </div>
        {f.requestLine && <p className="text-sm mt-4" style={{ color: '#26303B' }}>{f.requestLine}</p>}
        <div className="text-center mt-4 mb-1">
          <span className="inline-block rounded-full px-6 py-2.5 font-extrabold text-sm" style={{ background: '#E0A93C', color: '#3a2a08' }}>{f.ctaLabel}</span>
          <div className="text-[11px] mt-3" style={{ color: '#5C6975' }}>One alert per low episode — Kaya re-arms after the top-up.</div>
        </div>
      </div>
    </div>
  );
}

/* ── 💬 The family-chat line, verbatim. ── */
function ChatTab({ e }: { e: AlertLogEntry }) {
  const c = e.channels?.chat;
  if (!c) return <Missing what="chat message" />;
  if (!c.on) return <p className="text-[12px] text-hive-muted font-bold">💬 Family chat was switched off for this meter.</p>;
  return (
    <div>
      <div className="rounded-xl p-3" style={{ background: '#EFE9DA' }}>
        <div className="bg-white rounded-tl rounded-r-2xl rounded-bl-2xl px-3 py-2 max-w-[92%] shadow-sm">
          <p className="text-[10px] font-nunito font-black text-hive-honey-dk">Kaya 🔔</p>
          <p className="text-[12px] leading-relaxed mt-0.5">{c.text}</p>
          <p className="text-[9px] text-hive-muted text-right mt-1">{timeOf(e.firedAt)} {c.sent ? '✓' : ''}</p>
        </div>
      </div>
      <p className="text-[11px] text-hive-muted font-bold mt-2">
        {c.sent ? '✅ posted to Family chat' : '❌ not posted (no family thread found)'}
        {c.sent && <Link href="/chat" className="text-hive-honey-dk ml-1 underline">open chat ›</Link>}
      </p>
    </div>
  );
}

/* ── 🔔 The bell card, verbatim + who received it. ── */
function InAppTab({ e }: { e: AlertLogEntry }) {
  const n = e.channels?.inapp;
  if (!n) return <Missing what="in-app notification" />;
  if (!n.on) return <p className="text-[12px] text-hive-muted font-bold">🔔 In-app was switched off for this meter.</p>;
  return (
    <div>
      <div className="border border-hive-line border-l-4 border-l-hive-honey rounded-xl bg-white px-3 py-2.5">
        <p className="font-nunito font-black text-[13px] text-hive-navy">{n.title || `🔔 ${e.meterLabel} is running low`}</p>
        {n.message && <p className="text-[11px] text-hive-muted font-bold mt-0.5 leading-relaxed">{n.message}</p>}
      </div>
      <p className="text-[11px] text-hive-muted font-bold mt-2">
        {n.sent ? `✅ delivered to: ${n.to.map((r) => r.role === 'helper' ? `${r.name} (helper)` : r.name).join(' · ')}` : '❌ nobody reached'}
      </p>
      <p className="text-[10px] text-hive-muted font-bold mt-1 opacity-80">Helpers appear here — never on email (D2).</p>
    </div>
  );
}

function Missing({ what }: { what: string }) {
  return <p className="text-[12px] text-hive-muted font-bold">This entry predates the {what} trace.</p>;
}
