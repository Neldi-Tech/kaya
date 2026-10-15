'use client';

// 📲 WhatsApp alerts — Settings card (Design v1 cards A–G, approved 15-Oct-2026).
//
// Parents only (R1). Each parent connects their OWN number; the "Family
// rules" block at the bottom is shared by both parents. Everything goes
// through /api/whatsapp/settings — numbers live in an Admin-only collection
// because users/{uid} is readable by the whole family.
//
//   A  first time        → number + consent + "Send test message"
//   B  test sent         → ⏳ waiting (polls until Twilio reports back)
//   C  connected         → "Send me" switches · today meter · buttons
//   D  test not delivered→ ⚠️ reason in plain words + retry
//   E  replied STOP      → ✋ + "Turn back on · sends a test first"
//   F  keys not set yet  → ℹ️ saved, starts working when Kaya switches it on
//   G  Family rules      → who's connected · low line · quiet hours · switch

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { auth as fbAuth } from '@/lib/firebase';
import { useFamily } from '@/contexts/FamilyContext';
import { toDisplayDate } from '@/lib/dates';
import {
  REFLECTION_ALERT_DEFAULT, WA_LOW_LINES, isValidWaNumber, normalizeWaNumber, displayWaNumber,
  type WaAlertPrefs, type WaFamilyRules, type WaView,
} from '@/lib/whatsapp.shared';

const ERRORS: Record<string, string> = {
  'bad-number': 'That number doesn’t look right. Check it and try again.',
  'consent-required': 'Tick the box first, so Kaya may message you.',
  'admin-unavailable': 'This needs the Kaya server. Try again on ourkaya.com.',
  'parents-only': 'WhatsApp alerts are for parents.',
  'no-number': 'Save your number first.',
};

const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

function whenLabel(ms: number): string {
  const d = new Date(ms);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${toDisplayDate(key)} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function dateLabel(ms: number): string {
  const d = new Date(ms);
  return toDisplayDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

function Switch({ on }: { on: boolean }) {
  return (
    <div className={`w-10 h-6 rounded-full shrink-0 mt-0.5 relative transition-colors ${on ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'}`}>
      <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all" style={{ left: on ? '18px' : '2px' }} />
    </div>
  );
}

function Banner({ tone, icon, children }: { tone: 'ok' | 'wait' | 'bad' | 'off'; icon: string; children: React.ReactNode }) {
  const cls = tone === 'ok' ? 'bg-[#E7F5EC] text-[#22603C]'
    : tone === 'wait' ? 'bg-[#FFF1C9] text-[#7A5C00]'
      : tone === 'bad' ? 'bg-[#FDE8E8] text-[#A8323C]'
        : 'bg-kaya-warm text-[#6B5D48]';
  return (
    <div className={`flex gap-2 items-start rounded-kaya-sm px-3 py-2.5 text-xs font-semibold leading-relaxed ${cls}`}>
      <span className="text-[15px] leading-tight">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

const LABEL = 'text-[10px] font-bold uppercase tracking-wider text-kaya-sand mt-3 mb-1.5';
const INPUT = 'w-full h-9 px-3 bg-kaya-cream border border-kaya-warm-dark rounded-kaya-sm text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-kaya-gold/40';
const PRIMARY = 'w-full h-9 mt-3 bg-kaya-gold text-white rounded-kaya-sm font-bold text-xs disabled:opacity-40';
const GHOST = 'h-9 px-4 bg-white border border-kaya-warm-dark text-kaya-chocolate rounded-kaya-sm text-xs font-bold disabled:opacity-40';

export default function WhatsAppAlertsCard() {
  const { family: fam } = useFamily();
  const alertAt = fam?.reflectionParentAlertAt || REFLECTION_ALERT_DEFAULT;
  const [view, setView] = useState<WaView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [num, setNum] = useState('');
  const [consent, setConsent] = useState(false);
  const [pollGaveUp, setPollGaveUp] = useState(false);
  const polls = useRef(0);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}): Promise<boolean> => {
    try {
      const token = await fbAuth.currentUser?.getIdToken();
      if (!token) return false;
      const res = await fetch('/api/whatsapp/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const text = ERRORS[data?.error as string] || 'Something went wrong. Try again.';
        if (action === 'get') setLoadError(text); else setMsg(text);
        return false;
      }
      setView(data.view as WaView);
      setLoadError(null);
      return true;
    } catch {
      if (action === 'get') setLoadError('Couldn’t load WhatsApp settings.'); else setMsg('Couldn’t reach Kaya. Try again.');
      return false;
    }
  }, []);

  useEffect(() => { void call('get'); }, [call]);

  const me = view?.me ?? null;
  const notConfigured = !!view && !view.configured;
  const waiting = !!me && me.state === 'pending' && me.test?.status !== 'not-configured' && !editing;

  // B — poll until Twilio reports the test (delivered → C, failed → D).
  useEffect(() => {
    if (!waiting) { polls.current = 0; setPollGaveUp(false); return; }
    const t = setInterval(() => {
      polls.current += 1;
      if (polls.current > 30) { clearInterval(t); setPollGaveUp(true); return; }
      void call('get');
    }, 3000);
    return () => clearInterval(t);
  }, [waiting, call]);

  const run = async (key: string, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(key); setMsg(null);
    const ok = await call(action, extra);
    setBusy(null);
    return ok;
  };

  const sendFirst = async () => {
    const ok = await run('link', 'link', { number: num, consent });
    if (ok) { setEditing(false); setPollGaveUp(false); polls.current = 0; }
  };
  const startChange = () => {
    setNum(me ? displayWaNumber(me.number) : '');
    setConsent(true);
    setEditing(true);
    setMsg(null);
  };
  const toggleAlert = async (k: keyof WaAlertPrefs) => {
    if (!me || !view) return;
    const next = { ...me.alerts, [k]: !me.alerts[k] };
    setView({ ...view, me: { ...me, alerts: next } }); // optimistic
    const ok = await call('alerts', { alerts: next });
    if (!ok) setView(view);
  };
  const saveRules = async (patch: Partial<WaFamilyRules>) => {
    if (!view) return;
    const prev = view;
    setView({ ...view, family: { ...view.family, rules: { ...view.family.rules, ...patch } } });
    const ok = await call('family', { rules: patch });
    if (!ok) setView(prev);
  };

  // ── Collapsed summary (C2) ──
  const alertsOn = me ? Object.values(me.alerts).filter(Boolean).length : 0;
  const summary = !view ? null
    : !me || me.state === 'off' ? <span className="text-[10px] text-kaya-sand-light">off</span>
      : me.state === 'connected' ? <span className="text-[10px] font-bold text-[#2E7D4F]">on · {alertsOn} alert{alertsOn === 1 ? '' : 's'}</span>
        : me.state === 'failed' ? <span className="text-[10px] font-bold text-[#C2412D]">⚠️ check number</span>
          : me.state === 'stopped' ? <span className="text-[10px] text-kaya-sand-light">stopped</span>
            : me.test?.status === 'not-configured' ? <span className="text-[10px] text-kaya-sand-light">saved</span>
              : <span className="text-[10px] text-kaya-sand-light">checking…</span>;

  const digits = normalizeWaNumber(num);
  const canSend = isValidWaNumber(digits) && consent && busy === null;

  // ── A / D form: number + consent + Send test ──
  const form = (opts: { failedNote?: string }) => (
    <>
      {opts.failedNote && me && (
        <Banner tone="bad" icon="⚠️"><b className="font-extrabold">Not delivered to {displayWaNumber(me.number)}.</b> {opts.failedNote}</Banner>
      )}
      <div className={LABEL}>Your WhatsApp number</div>
      <input
        className={INPUT}
        inputMode="tel"
        autoComplete="tel"
        placeholder="0754 123 456"
        value={num}
        onChange={(e) => setNum(e.target.value)}
        aria-label="Your WhatsApp number"
      />
      <p className="text-[11px] text-kaya-sand mt-1.5 leading-relaxed">Tanzanian numbers can start with 0 — we add +255. Other countries: start with + and the code.</p>
      <button
        type="button"
        onClick={() => setConsent((c) => !c)}
        className="w-full flex gap-2.5 items-start mt-3 p-3 border border-kaya-warm-dark rounded-kaya-sm text-xs leading-relaxed text-left"
        aria-pressed={consent}
      >
        <span className={`w-[18px] h-[18px] rounded-[5px] border-[1.5px] shrink-0 mt-px grid place-items-center text-[12px] font-extrabold text-white ${consent ? 'bg-kaya-gold border-kaya-gold' : 'border-kaya-warm-dark'}`}>{consent ? '✓' : ''}</span>
        <span>I agree that Kaya may send me WhatsApp messages about our kids. I can reply <b>STOP</b> any time.</span>
      </button>
      <button type="button" className={PRIMARY} disabled={!canSend} onClick={sendFirst}>
        {busy === 'link' ? 'Sending…' : '📲 Send test message'}
      </button>
      {editing && me && (
        <button type="button" className="block mx-auto mt-2 text-[11px] font-bold text-kaya-sand" onClick={() => { setEditing(false); setMsg(null); }}>Cancel</button>
      )}
    </>
  );

  // Pre-fill the D form with the failed number the first time we see it.
  useEffect(() => {
    if (me?.state === 'failed' && !num) { setNum(displayWaNumber(me.number)); setConsent(true); }
  }, [me?.state, me?.number, num]);

  let body: React.ReactNode = null;
  if (!view) {
    body = <p className="text-xs text-kaya-sand">{loadError || 'Loading…'}</p>;
  } else if (!me || editing) {
    // A — first time (or Change number)
    body = (
      <>
        {!editing && (
          <p className="text-xs text-kaya-sand leading-relaxed">
            Get a WhatsApp when one of the kids needs a hand: <b className="text-kaya-chocolate">missed reflections</b>, a <b className="text-kaya-chocolate">low routine rating</b>, or <b className="text-kaya-chocolate">points taken off</b>. Just for you; the other parent connects their own number.
          </p>
        )}
        {form({})}
      </>
    );
  } else if (me.state === 'failed') {
    body = form({ failedNote: me.test?.note || 'This number doesn’t seem to be on WhatsApp. Check it and try again.' });
  } else if (me.state === 'stopped' || me.state === 'off') {
    // E — replied STOP (or turned off here)
    body = (
      <>
        <Banner tone="off" icon="✋">
          {me.state === 'stopped'
            ? <><b className="font-extrabold">You replied STOP on {dateLabel(me.stoppedAt || Date.now())}.</b> WhatsApp alerts are off for you. Bell + email carry on as normal.</>
            : <><b className="font-extrabold">You turned WhatsApp alerts off.</b> Bell + email carry on as normal.</>}
        </Banner>
        <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => run('test', 'test')}>
          {busy === 'test' ? 'Sending…' : 'Turn back on · sends a test first'}
        </button>
        <p className="text-[11px] text-kaya-sand mt-1.5 text-center">
          Number on file: {displayWaNumber(me.number)} · <button type="button" className="font-bold text-kaya-gold-dark" onClick={startChange}>change</button>
        </p>
      </>
    );
  } else if (me.state === 'pending' && me.test?.status !== 'not-configured') {
    // B — test sent, waiting for the tick
    body = (
      <>
        <div className={LABEL}>Your WhatsApp number</div>
        <div className={`${INPUT} flex items-center`}>{displayWaNumber(me.number)}</div>
        <p className="text-[11px] font-semibold text-[#2E7D4F] mt-1.5">Saved as {displayWaNumber(me.number)} ✓</p>
        <div className="flex gap-2.5 items-start mt-3 p-3 border border-kaya-warm-dark rounded-kaya-sm text-xs leading-relaxed">
          <span className="w-[18px] h-[18px] rounded-[5px] border-[1.5px] shrink-0 mt-px grid place-items-center text-[12px] font-extrabold text-white bg-kaya-gold border-kaya-gold">✓</span>
          <span>I agree that Kaya may send me WhatsApp messages about our kids. I can reply <b>STOP</b> any time.</span>
        </div>
        <div className="mt-3">
          <Banner tone="wait" icon="⏳">
            <b className="font-extrabold">Test sent to {displayWaNumber(me.number)}.</b> Waiting for WhatsApp to say it arrived; this usually takes a few seconds.
          </Banner>
        </div>
        {pollGaveUp && (
          <div className="flex gap-1.5 flex-wrap mt-3">
            <button type="button" className={GHOST} onClick={() => void call('get')}>Check again</button>
            <button type="button" className={GHOST} disabled={busy !== null} onClick={() => run('test', 'test')}>Send test again</button>
            <button type="button" className={GHOST} onClick={startChange}>Change number</button>
          </div>
        )}
      </>
    );
  } else {
    // C — connected (and F — saved while Kaya's keys aren't set yet)
    const connected = me.state === 'connected';
    const rows: { k: keyof WaAlertPrefs; t: string; d: React.ReactNode }[] = [
      { k: 'reflection', t: '🪞 Missed reflections', d: <>When a kid misses school days in a row · sent at {alertAt} · again every 5 more days. <Link href="/sparks/setup" className="text-kaya-gold-dark font-bold no-underline">Days + time in Sparks setup →</Link></> },
      { k: 'lowRating', t: '📉 Low routine ratings', d: <>When a morning or evening rating scores below {view.family.rules.lowLinePct}%. Never for a rating you gave yourself.</> },
      { k: 'deduction', t: '➖ Points taken off', d: <>When another adult takes House Points off a kid.</> },
    ];
    body = (
      <>
        {connected && (
          <Banner tone="ok" icon="✓">
            <b className="font-extrabold">Connected · {displayWaNumber(me.number)}</b><br />
            Test delivered {whenLabel(me.connectedAt || me.test?.at || Date.now())}
          </Banner>
        )}
        {!connected && (
          <p className="text-[11px] text-kaya-sand">Number on file: {displayWaNumber(me.number)} · <button type="button" className="font-bold text-kaya-gold-dark" onClick={startChange}>change</button></p>
        )}
        {!connected && view.configured && (
          <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => run('test', 'test')}>{busy === 'test' ? 'Sending…' : '📲 Send test message'}</button>
        )}
        <div className="text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-kaya-chocolate mt-3">Send me</div>
        <div className="mt-2 space-y-2">
          {rows.map((r) => (
            <button key={r.k} type="button" onClick={() => toggleAlert(r.k)} aria-pressed={me.alerts[r.k]}
              className="w-full flex items-start gap-3 p-3 rounded-kaya-sm border border-kaya-warm-dark hover:border-kaya-sand-light text-left transition-colors">
              <Switch on={me.alerts[r.k]} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{r.t}</p>
                <p className="text-[11px] text-kaya-sand leading-relaxed">{r.d}</p>
              </div>
            </button>
          ))}
        </div>
        {connected && (
          <>
            <div className="mt-2.5 flex items-center gap-2 text-[11px] text-kaya-sand">
              <span>Today {me.todayCount} of {view.cap}</span>
              <span className="flex-1 h-1.5 rounded-full bg-kaya-warm overflow-hidden">
                <span className="block h-full bg-kaya-gold rounded-full" style={{ width: `${Math.min(100, Math.round((me.todayCount / view.cap) * 100))}%` }} />
              </span>
            </div>
            <p className="text-[11px] text-kaya-sand mt-1.5">Over {view.cap} in a day, alerts still reach you by bell + email.</p>
            <div className="flex gap-1.5 flex-wrap mt-3">
              <button type="button" className={GHOST} onClick={startChange}>Change number</button>
              <button type="button" className={GHOST} disabled={busy !== null} onClick={() => run('test', 'test')}>{busy === 'test' ? 'Sending…' : 'Send test again'}</button>
              <button type="button" className={GHOST} disabled={busy !== null} onClick={() => run('off', 'off')}>Turn off</button>
            </div>
            <Link href="/pantry/utility-meters/alerts" className="block text-center text-xs font-bold text-kaya-gold-dark mt-3 no-underline">See every WhatsApp sent → 📜 Alert log</Link>
          </>
        )}
      </>
    );
  }

  // ── G — Family rules (both parents) ──
  const rules = view?.family.rules;
  const family = view && rules && (
    <>
      <div className="h-px bg-kaya-warm-dark mt-4 mb-0.5" />
      <div className="text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-kaya-chocolate mt-3 flex items-center gap-1.5">
        👪 Family rules <span className="normal-case tracking-normal font-semibold text-[10px] text-kaya-sand">· same for both parents</span>
      </div>
      <div className={LABEL}>Who's connected</div>
      <div className="flex gap-1.5 flex-wrap">
        {view.family.people.map((p) => (
          <span key={p.uid} className={`inline-flex items-center gap-1 text-[11.5px] font-bold px-2.5 py-1 rounded-full border ${p.state === 'connected' ? 'bg-[#E7F5EC] border-[#BFE3CC] text-[#22603C]' : 'bg-kaya-cream border-kaya-warm-dark text-kaya-sand'}`}>
            {p.state === 'connected' ? `✓ ${p.name}` : `${p.name} · ${p.state === 'stopped' ? 'stopped' : p.state === 'off' ? 'off' : 'not yet'}`}
          </span>
        ))}
      </div>
      <div className={LABEL}>A rating is “low” below</div>
      <div className="flex gap-1.5">
        {WA_LOW_LINES.map((n) => (
          <button key={n} type="button" onClick={() => saveRules({ lowLinePct: n })}
            className={`flex-1 h-[34px] rounded-kaya-sm border text-[13px] font-bold ${rules.lowLinePct === n ? 'bg-kaya-gold-light border-kaya-gold text-kaya-chocolate' : 'bg-white border-kaya-warm-dark text-kaya-sand'}`}>
            {n}%
          </button>
        ))}
      </div>
      <div className={LABEL}>Quiet hours</div>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5 items-center">
        <select className={INPUT} value={rules.quietFrom} onChange={(e) => saveRules({ quietFrom: e.target.value })} aria-label="Quiet hours from">
          {HALF_HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <span className="text-xs text-kaya-sand">→</span>
        <select className={INPUT} value={rules.quietTo} onChange={(e) => saveRules({ quietTo: e.target.value })} aria-label="Quiet hours to">
          {HALF_HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
      </div>
      <p className="text-[11px] text-kaya-sand mt-1.5 leading-relaxed">Messages wait until {rules.quietTo} and are checked again first. If the rating was fixed or the reflection was written, they’re dropped.</p>
      <button type="button" onClick={() => saveRules({ enabled: !rules.enabled })} aria-pressed={rules.enabled}
        className="w-full flex items-start gap-3 p-3 mt-3 rounded-kaya-sm border border-kaya-warm-dark hover:border-kaya-sand-light text-left transition-colors">
        <Switch on={rules.enabled} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">WhatsApp for the whole family</p>
          <p className="text-[11px] text-kaya-sand leading-relaxed">Off = nothing goes by WhatsApp for anyone. Bell + email carry on.</p>
        </div>
      </button>
    </>
  );

  return (
    <CollapsibleSection id="whatsapp" remember icon="📲" title="WhatsApp alerts" summary={summary}>
      {notConfigured && (
        <div className="mb-3">
          <Banner tone="off" icon="ℹ️">WhatsApp isn't switched on for Kaya yet. Your number and choices are saved and will start working as soon as it is.</Banner>
        </div>
      )}
      {body}
      {msg && <p className="text-[11px] font-semibold text-[#A8323C] mt-2">{msg}</p>}
      {family}
    </CollapsibleSection>
  );
}
