'use client';

// 📲 WhatsApp Alerts — the 📜 Alert log rows + trace sheet (Design v1 I–K,
// approved 15-Oct-2026). Three row kinds:
//   🪞 reflection_miss — one event, three channels (🔔 · 📧 · 📲 tabs)
//   📉 low_rating      — WhatsApp only (its email keeps its own 🔥 row)
//   ➖ deduction       — WhatsApp only
// The message is re-rendered from the stored template blanks — exactly as
// sent (F9) — and "Who got it" shows each parent's tick status.
// 📲 = WhatsApp on this page; 💬 already means the family chat.

import { useState } from 'react';
import type { AlertLogEntry } from '@/lib/alertLog';
import { toDisplayDate } from '@/lib/dates';
import {
  WA_STATUS_LABEL, renderWaTemplate,
  type WaChannel, type WaRecipient, type WaStatus,
} from '@/lib/whatsapp.shared';

export type WaKind = 'reflection_miss' | 'low_rating' | 'deduction';
export const isWaKind = (e: AlertLogEntry): boolean =>
  e.kind === 'reflection_miss' || e.kind === 'low_rating' || e.kind === 'deduction';

const dayKeyOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const timeOf = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const LIVE: WaStatus[] = ['queued', 'sent', 'delivered', 'read'];
function waOf(e: AlertLogEntry): WaChannel | null {
  const w = e.channels?.whatsapp;
  return w && w.on && Array.isArray(w.to) && w.template ? (w as WaChannel) : null;
}
function summary(w: WaChannel | null) {
  const to = w?.to || [];
  const live = to.filter((r) => LIVE.includes(r.status)).length;
  const held = to.filter((r) => r.status === 'held').length;
  const capped = to.filter((r) => r.status === 'capped').length;
  const failed = to.filter((r) => r.status === 'failed').length;
  const meant = to.filter((r) => r.status !== 'skipped');
  const dropped = meant.length > 0 && meant.every((r) => r.status === 'dropped');
  return { live, held, capped, failed, dropped };
}

function Chip({ tone, children }: { tone: 'ok' | 'bad' | 'off' | 'wait'; children: React.ReactNode }) {
  const cls = tone === 'ok' ? 'bg-[#E7F5EC] text-pantry-leaf-dk'
    : tone === 'bad' ? 'bg-[#FDE8E8] text-hive-rose'
      : tone === 'wait' ? 'bg-[#FFF3D9] text-hive-honey-dk'
        : 'border border-dashed border-hive-line text-hive-muted';
  return <span className={`text-[10px] font-nunito font-black px-1.5 py-0.5 rounded-lg whitespace-nowrap ${cls}`}>{children}</span>;
}
function chanChip(label: string, c: { on: boolean; sent: boolean } | undefined, count?: number) {
  if (!c || !c.on) return <Chip tone="off">{label} off</Chip>;
  return c.sent ? <Chip tone="ok">{label} ✅{count ? ` ${count}` : ''}</Chip> : <Chip tone="bad">{label} ❌</Chip>;
}
function WaChip({ w }: { w: WaChannel | null }) {
  if (!w) return null;
  const s = summary(w);
  if (s.live > 0) return <Chip tone="ok">📲 ✅ {s.live}</Chip>;
  if (s.held > 0) return <Chip tone="wait">📲 ⏸ {s.held}</Chip>;
  if (s.failed > 0) return <Chip tone="bad">📲 ❌</Chip>;
  return <Chip tone="off">📲 0</Chip>;
}

const EMOJI: Record<WaKind, string> = { reflection_miss: '🪞', low_rating: '📉', deduction: '➖' };
function rowTitle(e: AlertLogEntry): string {
  const kid = e.childName || 'Kid';
  if (e.kind === 'reflection_miss') return `${kid} · missed reflections · ${e.misses ?? '?'} days`;
  if (e.kind === 'low_rating') return `${kid} · low rating · ${e.period || 'routine'}`;
  return `${kid} · ${e.points ?? '?'} points taken off`;
}
function droppedNote(w: WaChannel | null): { note: string; at: number } | null {
  const r = w?.to.find((x) => x.status === 'dropped');
  return r ? { note: r.note || '', at: r.at } : null;
}
function rowMeta(e: AlertLogEntry, w: WaChannel | null): string {
  const t = timeOf(e.firedAt);
  if (e.kind === 'reflection_miss') {
    if (e.waRound === 'first') return `${t} · first for this gap`;
    if (e.waRound === 'reminder') return `${t} · reminder · day ${e.misses}`;
    return `${t} · daily reminder${e.nextWaAt ? ` · WhatsApp next at ${e.nextWaAt} days` : ''}`;
  }
  if (e.kind === 'low_rating') {
    const s = summary(w);
    const d = droppedNote(w);
    if (s.dropped && d) {
      const now = /^now (\d+%)$/.exec(d.note);
      return `${t} · ${e.scorePct ?? '?'}% · ${now ? `fixed to ${now[1]} before ${timeOf(d.at)}` : d.note}`;
    }
    return `${t} · rated by ${e.ratedByFirst || 'family'}`;
  }
  return `${t} · by ${e.byFirst || 'family'}${e.category ? ` · ${e.category}` : ''}`;
}

/** One 📜 row — same card as the other log rows. */
export function WaRow({ e, onOpen }: { e: AlertLogEntry; onOpen: () => void }) {
  const w = waOf(e);
  const s = summary(w);
  const ch = e.channels;
  return (
    <button type="button" onClick={onOpen}
      className="w-full text-left bg-hive-paper border border-hive-line rounded-hive p-3 mb-2 hover:border-hive-honey">
      <div className="flex items-center gap-2">
        <span className="text-base">{EMOJI[e.kind as WaKind]}</span>
        <span className="font-nunito font-extrabold text-[13px] text-hive-navy truncate min-w-0">{rowTitle(e)}</span>
        {e.kind === 'low_rating' && !s.dropped && e.scorePct != null && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#FDE8E8] text-hive-rose border border-hive-rose/40 shrink-0">{e.scorePct}%</span>
        )}
        {s.dropped && <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#F1EEE6] text-hive-muted border border-hive-line shrink-0">dropped</span>}
        {!s.dropped && s.capped > 0 && <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#FFF3D9] text-hive-honey-dk border border-hive-honey/40 shrink-0">capped</span>}
        <span className="ml-auto text-hive-muted text-sm shrink-0">›</span>
      </div>
      <div className="flex items-center gap-1 flex-wrap mt-1.5">
        <span className="text-[11px] text-hive-muted font-bold">{rowMeta(e, w)}</span>
        <span className="ml-auto flex gap-1 flex-wrap">
          {e.kind === 'reflection_miss' && chanChip('🔔', ch?.inapp, ch?.inapp?.to.length)}
          {e.kind === 'reflection_miss' && chanChip('📧', ch?.email, ch?.email?.to.length)}
          <WaChip w={w} />
        </span>
      </div>
    </button>
  );
}

/** *bold* → <b> (WhatsApp's own markup). */
function waText(s: string): React.ReactNode[] {
  return s.split(/(\*[^*\n]+\*)/g).map((part, i) =>
    /^\*[^*\n]+\*$/.test(part) ? <b key={i} className="font-bold">{part.slice(1, -1)}</b> : <span key={i}>{part}</span>);
}

function statusTone(st: WaStatus): string {
  if (st === 'failed') return 'text-hive-rose';
  if (st === 'held' || st === 'capped' || st === 'queued') return 'text-hive-honey-dk';
  if (st === 'dropped' || st === 'skipped') return 'text-hive-muted';
  return 'text-pantry-leaf-dk';
}
function StatusLabel({ st }: { st: WaStatus }) {
  if (st === 'delivered') return <><span className="text-[#8E9AA0]">✓✓</span> Delivered</>;
  if (st === 'read') return <><span className="text-[#34B7F1]">✓✓</span> Read</>;
  if (st === 'sent') return <><span className="text-[#8E9AA0]">✓</span> Sent</>;
  return <>{WA_STATUS_LABEL[st]}</>;
}
function subLine(r: WaRecipient): string {
  if (r.status === 'skipped') return r.note || 'skipped';
  if (r.heldAt) return `⏸ held ${timeOf(r.heldAt)} · quiet hours`;
  if (r.status === 'held') return `⏸ held · ${r.note || 'quiet hours'}`;
  return r.masked;
}
function rightSmall(r: WaRecipient): string {
  if (r.status === 'dropped') return `${timeOf(r.at)}${r.note ? ` · ${r.note}` : ''}`;
  if (r.status === 'skipped') return '';
  if (r.status === 'held') return `goes later`;
  return timeOf(r.at);
}

function WaTab({ e, w }: { e: AlertLogEntry; w: WaChannel }) {
  const msg = renderWaTemplate(w.template, w.vars || {});
  const s = summary(w);
  const reached = s.live > 0 || s.held > 0;
  return (
    <div>
      <div className="rounded-[14px] p-2.5" style={{ background: '#EFEAE2' }}>
        <p className="text-[9.5px] font-nunito font-black uppercase tracking-[1.4px] mb-1.5" style={{ color: '#6B7A72' }}>
          {reached ? `📲 As sent · template ${w.template}` : '📲 Would have said'}
        </p>
        <div className={`bg-white rounded-[2px_10px_10px_10px] px-2.5 pt-2 pb-1.5 text-[13px] leading-[1.45] shadow-sm max-w-[92%] whitespace-pre-line ${reached ? '' : 'opacity-70'}`} style={{ color: '#111B21' }}>
          {waText(msg.text)}
          {reached && <span className="block text-right text-[10px] mt-0.5" style={{ color: '#667781' }}>{timeOf(e.firedAt)}</span>}
        </div>
        {reached && msg.button && (
          <div className="bg-white rounded-[10px] text-center py-2 text-[13px] mt-0.5 shadow-sm max-w-[92%]" style={{ color: '#027EB5' }}>↗ {msg.button.title}</div>
        )}
      </div>
      <p className="text-[10px] font-nunito font-black uppercase tracking-[1.4px] text-hive-muted mt-3 mb-1.5">{reached ? 'Who got it' : 'Who it was for'}</p>
      {w.to.map((r) => (
        <div key={r.uid} className="flex items-start gap-2.5 py-2.5 border-t border-hive-line">
          <span className="w-[30px] h-[30px] rounded-full bg-[#FFF3D9] text-hive-honey-dk grid place-items-center text-[13px] font-nunito font-black shrink-0">{(r.name || '?').slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0">
            <p className="font-nunito font-black text-[13px] text-hive-navy">{r.name}</p>
            <p className="text-[10.5px] text-hive-muted font-bold">{subLine(r)}</p>
          </div>
          <span className={`ml-auto text-right text-[11px] font-nunito font-black whitespace-nowrap ${statusTone(r.status)}`}>
            <StatusLabel st={r.status} />
            {rightSmall(r) && <small className="block text-[10px] text-hive-muted font-bold">{rightSmall(r)}</small>}
            {r.status === 'failed' && r.note && <small className="block text-[10px] text-hive-rose font-bold whitespace-normal max-w-[180px]">{r.note}</small>}
          </span>
        </div>
      ))}
    </div>
  );
}

function EmailTrace({ e }: { e: AlertLogEntry }) {
  const em = e.channels?.email;
  if (!em) return <p className="text-[12px] text-hive-muted font-bold">No email on this alert.</p>;
  if (!em.on) return <p className="text-[12px] text-hive-muted font-bold">📧 Email isn’t switched on for Kaya.</p>;
  return (
    <div className="rounded-xl border border-hive-line bg-hive-cream px-3 py-2.5 text-[11px] text-hive-muted font-bold leading-relaxed">
      To: {em.to.length ? em.to.map((r) => (r.name && r.name !== r.email ? `${r.name} <${r.email}>` : r.email)).join(' · ') : '—'}<br />
      Subject: <span className="text-hive-navy">{em.subject}</span><br />
      {em.sent ? '✅ sent' : '❌ not sent'}
    </div>
  );
}
function BellTrace({ e }: { e: AlertLogEntry }) {
  const n = e.channels?.inapp;
  if (!n) return <p className="text-[12px] text-hive-muted font-bold">No bell on this alert.</p>;
  return (
    <div>
      <div className="border border-hive-line border-l-4 border-l-hive-honey rounded-xl bg-white px-3 py-2.5">
        <p className="font-nunito font-black text-[13px] text-hive-navy">{n.title}</p>
        {n.message && <p className="text-[11px] text-hive-muted font-bold mt-0.5 leading-relaxed">{n.message}</p>}
      </div>
      <p className="text-[11px] text-hive-muted font-bold mt-2">{n.sent ? `✅ delivered to: ${n.to.map((r) => r.name).join(' · ')}` : '❌ nobody reached'}</p>
    </div>
  );
}

/** The trace sheet body for a 🪞 / 📉 / ➖ entry (header included). */
export function WaSheet({ e }: { e: AlertLogEntry }) {
  const w = waOf(e);
  const s = summary(w);
  const isReflection = e.kind === 'reflection_miss';
  const [tab, setTab] = useState<'wa' | 'email' | 'inapp'>(w ? 'wa' : 'email');
  const when = `${toDisplayDate(dayKeyOf(e.firedAt))} ${timeOf(e.firedAt)}`;
  const title = e.kind === 'reflection_miss' ? `${e.childName || 'Kid'} — missed reflections`
    : e.kind === 'low_rating' ? `${e.childName || 'Kid'} — low rating · ${e.period || 'routine'}`
      : `${e.childName || 'Kid'} — ${e.points ?? '?'} points taken off`;
  const sub = e.kind === 'reflection_miss' ? `${when} · ${e.misses} school days in a row · alert after ${e.threshold}`
    : e.kind === 'low_rating' ? `${when} · line ${e.linePct ?? 50}% · rated by ${e.ratedByFirst || 'family'}`
      : `${when} · by ${e.byFirst || 'family'}${e.category ? ` · ${e.category}` : ''}`;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-xl">{EMOJI[e.kind as WaKind]}</span>
        <div className="flex-1 min-w-0">
          <p className="font-nunito font-black text-[15px] text-hive-navy leading-tight">{title}</p>
          <p className="text-[11px] text-hive-muted font-bold">{sub}</p>
        </div>
        {e.kind === 'low_rating' && !s.dropped && e.scorePct != null && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#FDE8E8] text-hive-rose border border-hive-rose/40 shrink-0">{e.scorePct}%</span>
        )}
        {s.dropped && <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#F1EEE6] text-hive-muted border border-hive-line shrink-0">dropped</span>}
      </div>
      {isReflection && (
        <div className="flex gap-1.5 mt-3 mb-3">
          {(w ? (['wa', 'email', 'inapp'] as const) : (['email', 'inapp'] as const)).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`flex-1 text-center text-[11px] font-nunito font-black py-2 rounded-xl border ${tab === t ? 'bg-hive-navy text-white border-hive-navy' : 'bg-white text-hive-muted border-hive-line'}`}>
              {t === 'wa' ? '📲 WhatsApp' : t === 'email' ? '📧 Email' : '🔔 In-app'}
            </button>
          ))}
        </div>
      )}
      {!isReflection && <div className="mt-3" />}
      {(!isReflection || tab === 'wa') && w && <WaTab e={e} w={w} />}
      {isReflection && tab === 'email' && <EmailTrace e={e} />}
      {isReflection && tab === 'inapp' && <BellTrace e={e} />}
      {isReflection && !w && tab === 'wa' && <p className="text-[12px] text-hive-muted font-bold">No WhatsApp on this alert.</p>}
      {isReflection && !e.waRound && e.nextWaAt && tab !== 'wa' && (
        <p className="text-[10.5px] text-hive-muted font-bold mt-2">📲 No WhatsApp today. The next one goes at {e.nextWaAt} missed days.</p>
      )}
    </div>
  );
}
