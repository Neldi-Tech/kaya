'use client';

// Kaya Sparks · Quests — the practice-pack approval queue (D5 · D6 · D7).
//
// The single most important surface in the whole feature, because it is
// the thing standing between a language model and a seven-year-old.
//
// Nothing generated here has EVER been readable by the child: pending
// items live in a gateway-only collection, so approval is not a UI
// filter — it is the moment the item is copied into the kid-visible
// materials library. There is deliberately no "trust this source" or
// "auto-approve" switch anywhere in this component, and there never
// should be.
//
// Each item carries a one-line WHY so a parent can clear five items in
// forty seconds without it becoming a rubber stamp — and any link must
// be opened once before Approve unlocks.

import { useCallback, useEffect, useState } from 'react';
import {
  generatePack, listPending, approvePending, rejectPending,
  type PendingItem, type Quest,
} from '@/lib/sparks/quests';
import { toDisplayDate } from '@/lib/dates';

interface Props {
  quest: Quest;
  kidName: string;
}

export default function QuestPackQueue({ quest, kidName }: Props) {
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [quota, setQuota] = useState<null | { by: string; at: number }>(null);

  const load = useCallback(() => {
    listPending(quest.id)
      .then(setItems)
      .catch(() => setItems([]));
  }, [quest.id]);

  useEffect(() => { load(); }, [load]);

  async function generate(queue = false) {
    setBusy(true); setError(''); setQuota(null);
    try {
      await generatePack(quest.id, { queue });
      load();
    } catch (e) {
      const err = e as Error & { hint?: string; by?: string; at?: number };
      if (err.message === 'quota-used') {
        setQuota({ by: err.by || 'Someone', at: err.at || 0 });
      } else {
        setError(err.hint || 'Kaya couldn’t make a pack right now. Try again in a moment.');
      }
    }
    setBusy(false);
  }

  async function approve(item: PendingItem) {
    setBusy(true);
    await approvePending(quest.id, item.id).catch(() => {});
    setBusy(false);
    load();
  }

  async function reject(item: PendingItem) {
    setBusy(true);
    await rejectPending(quest.id, item.id).catch(() => {});
    setBusy(false);
    load();
  }

  const pending = items ?? [];

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="font-display font-extrabold text-[13px] text-[#0F1F44]">
          📎 Reference materials
          {pending.length > 0 && (
            <span className="ml-2 text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-[#FFF1C9] text-[#8A6800]">
              {pending.length} to review
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => generate(false)}
          disabled={busy}
          className="px-3 py-1.5 rounded-full text-[11.5px] font-extrabold text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #A66CFF 0%, #4ECDC4 100%)' }}
        >
          {busy ? 'Working…' : '✨ Generate activities'}
        </button>
      </div>

      {/* D7 · the other parent already used today's slot */}
      {quota && (
        <div className="rounded-[16px] border border-[#DCC7FA] bg-[#F3E9FF] px-4 py-3.5 mb-3">
          <div className="text-[12.5px] text-[#5A3CB8] leading-snug font-semibold">
            {quota.by} already made today&apos;s pack
            {quota.at ? ` at ${new Date(quota.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}.
            One pack a day per quest keeps the review pile honest.
          </div>
          <div className="flex flex-wrap gap-2 mt-2.5">
            <button
              type="button"
              onClick={() => generate(true)}
              disabled={busy}
              className="px-3.5 py-2 rounded-xl text-[12px] font-extrabold text-white"
              style={{ background: '#5A3CB8' }}
            >
              📅 Queue one for tomorrow
            </button>
            <button
              type="button"
              onClick={() => setQuota(null)}
              className="px-3.5 py-2 rounded-xl text-[12px] font-extrabold border border-[#DCC7FA] text-[#5A3CB8] bg-white"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-[#FDE8E8] border border-[#F5C6C6] px-3.5 py-2.5 text-[12px] text-[#8B2130] mb-3 leading-snug">
          {error}
        </div>
      )}

      {items !== null && pending.length === 0 && !quota && (
        <div className="bg-[#FBF7EE] rounded-2xl px-5 py-5 text-center">
          <p className="text-[12px] text-[#5A6488] m-0 leading-snug max-w-md mx-auto">
            Things for {kidName} to <strong>read or watch</strong> alongside the quest — the Library
            above is what they <strong>do</strong>. Nothing Kaya suggests here reaches {kidName}
            {' '}until you&apos;ve read it and approved it. There is no auto-publish, ever.
          </p>
        </div>
      )}

      <div className="grid gap-2.5">
        {pending.map((item) => {
          const needsOpen = !!item.link && !opened.has(item.id);
          return (
            <div key={item.id} className="rounded-[16px] border border-[#ECE4D3] bg-white p-3.5">
              <div className="font-display font-extrabold text-[13.5px] text-[#0F1F44] leading-snug">
                {item.title}
              </div>
              {/* The line the parent actually decides on */}
              <div className="text-[11.5px] text-[#5A3CB8] font-bold mt-1 leading-snug">
                Why: {item.why}
              </div>
              <p className="text-[12px] text-[#5A6488] mt-1.5 mb-0 leading-relaxed">{item.how}</p>

              {item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={() => setOpened((p) => new Set(p).add(item.id))}
                  className="inline-flex items-center gap-1.5 mt-2 text-[11.5px] font-extrabold text-[#3B2E86] underline break-all"
                >
                  🔗 {new URL(item.link).hostname} — open it first
                </a>
              )}

              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => approve(item)}
                  disabled={busy || needsOpen}
                  className="px-3.5 py-2 rounded-xl text-[12px] font-extrabold text-white disabled:opacity-40"
                  style={{ background: '#2E7D34' }}
                >
                  ✅ Approve
                </button>
                <button
                  type="button"
                  onClick={() => reject(item)}
                  disabled={busy}
                  className="px-3.5 py-2 rounded-xl text-[12px] font-extrabold border border-[#F5C6C6] text-[#D64550] bg-white disabled:opacity-40"
                >
                  Discard
                </button>
                {needsOpen && (
                  <span className="text-[10.5px] text-[#8A8471] leading-snug">
                    Open the link once before approving.
                  </span>
                )}
                <span className="text-[10.5px] text-[#8A8471] ml-auto whitespace-nowrap">
                  for {toDisplayDate(item.forDate)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {pending.length > 0 && (
        <p className="text-[10.5px] text-[#8A8471] italic mt-2.5 leading-snug">
          Approved activities appear in {kidName}&apos;s Sparks materials. Until then they exist only
          here — {kidName}&apos;s device has never received them.
        </p>
      )}
    </div>
  );
}
