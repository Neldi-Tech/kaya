'use client';

// Kaya Sparks · Treasures — the family Lost & Found board.
//
// D10 · the board records SIGHTINGS, not suspects. There is deliberately
// no field anywhere on this screen for who might have taken something —
// it asks WHERE it was last, because that is what actually finds things,
// and because "who took my headphones?" is the fight this feature would
// otherwise start every week.
//
// Deliberately family-wide (not per kid): finding things is a household
// act, and a sibling who can help look is a sibling doing something
// good.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { toDisplayDate } from '@/lib/dates';
import { treasuresApi, markFound, addSighting } from '@/lib/sparks/treasures';
import { PAGE_WIDTH_CLASS, PageSplit, DATA_ROW } from '@/components/layout/Page';

interface BoardItem {
  id: string;
  kidId: string;
  kidName: string;
  name: string;
  emoji: string;
  thumbUrl?: string;
  lostSince?: string;
  days: number;
  lastSeenWhere?: string;
  lastSeenOn?: string;
  sightings: Array<{ where: string; on: string; byName: string; at: number }>;
}

export default function LostAndFoundPage() {
  const { profile } = useAuth();
  const familyId = profile?.familyId;

  const [missing, setMissing] = useState<BoardItem[] | null>(null);
  const [found, setFound] = useState<Array<{ note: string; on: string }>>([]);
  const [openId, setOpenId] = useState<string>('');
  const [where, setWhere] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    treasuresApi<{ missing: BoardItem[]; found: Array<{ note: string; on: string }> }>('family-board')
      .then((r) => { setMissing(r.missing || []); setFound(r.found || []); })
      .catch(() => { setMissing([]); setFound([]); });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setErr('');
    try { await fn(); setWhere(''); setOpenId(''); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'That did not work'); }
    finally { setBusy(false); }
  }

  // Web-Fit (2026-08-23): content tier. Desktop: the missing things as
  // one divided panel, the rule + "found recently" + errors in a right
  // rail (railMobile="last" keeps the mobile order). Mobile unchanged.
  const rail = (
    <>
      {/* The rule, said out loud — because the copy is the guardrail. */}
      <div className="rounded-[12px] border border-[#DDE3EC] bg-[#F1F3F7] p-3 mt-3 lg:mt-0">
        <p className="text-[11.2px] font-bold text-[#5B6B8C] leading-snug m-0">
          Kaya never asks who took something. It asks <b>where it was last</b> — because that is
          what actually finds things.
        </p>
      </div>

      {found.length > 0 && (
        <div className="rounded-[14px] border border-[#BFE3D8] bg-[#F1FAF7] p-3 mt-3">
          <div className="font-display font-extrabold text-[12.5px] text-[#0E6B5E]">
            ✅ Found recently
          </div>
          {found.map((f, i) => (
            <p key={`${f.on}-${i}`} className="text-[11px] font-bold text-[#2C4A44] mt-1 m-0">
              {f.note}
            </p>
          ))}
        </div>
      )}

      {err && <p className="text-[11.5px] text-[#C0392B] font-bold mt-3">{err}</p>}
    </>
  );

  return (
    <div className="min-h-screen bg-[#FFFBF5] pb-20">
      <div className={`mx-auto max-w-md sm:max-w-2xl ${PAGE_WIDTH_CLASS.content} lg:px-4`}>
        <div className="px-4 pt-4 lg:pt-6">
          <Link
            href="/sparks"
            className="inline-flex items-center gap-1.5 pl-2.5 pr-3.5 py-1.5 rounded-full bg-white border border-[#ECE4D3] text-[#0F1F44] font-display font-extrabold text-[12px] no-underline"
          >
            <span className="text-[13px] leading-none opacity-60" aria-hidden>‹</span>
            <span>Sparks</span>
          </Link>
        </div>

        <div
          className="mx-4 mt-3 rounded-[18px] lg:rounded-[24px] p-4 lg:px-8 lg:py-7 text-white"
          style={{ background: 'linear-gradient(135deg,#0E6B5E 0%,#3FA38F 100%)' }}
        >
          <div className="text-[10.5px] lg:text-[12px] font-extrabold opacity-85">💎 Treasures · the whole family</div>
          <div className="font-display text-[19px] lg:text-[30px] font-extrabold mt-0.5">🔍 Lost &amp; Found</div>
          <div className="text-[11px] lg:text-[13.5px] opacity-90 mt-1">
            {missing === null
              ? 'Looking…'
              : missing.length === 0
                ? 'Nothing is missing right now'
                : `${missing.length} thing${missing.length === 1 ? '' : 's'} missing · let’s retrace them`}
          </div>
        </div>

        <div className="px-4 mt-3 lg:mt-5">
          <PageSplit rail={rail} railMobile="last">
          {missing === null && (
            <p className="text-[13px] text-[#5A6488] text-center py-6">Loading the board…</p>
          )}

          {missing?.length === 0 && (
            <div className="rounded-[14px] border border-[#BFE3D8] bg-[#F1FAF7] p-4 text-center">
              <div className="text-[30px] leading-none">✅</div>
              <p className="text-[13px] font-extrabold text-[#0E6B5E] mt-1.5 m-0">
                Everything is accounted for
              </p>
              <p className="text-[11.5px] text-[#2C4A44] mt-1 leading-snug">
                That is the Keeper Check doing its job.
              </p>
            </div>
          )}

          {!!missing?.length && (
          <div className="lg:rounded-[14px] lg:border lg:border-[#ECE4D3] lg:divide-y lg:divide-[#ECE4D3] lg:overflow-hidden">
          {missing.map((m) => {
            const tone = m.days >= 5 ? 'bad' : 'warn';
            return (
              <div
                key={m.id}
                className={`rounded-[14px] border p-3 mb-2.5 lg:mb-0 lg:px-4 lg:py-3 ${DATA_ROW} ${
                  tone === 'bad'
                    ? 'border-[#F0C9CC] bg-[#FEF6F6]'
                    : 'border-[#F3D3A6] bg-[#FFF9EF]'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[18px]" aria-hidden>{m.emoji}</span>
                  <span className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
                    {m.name}
                  </span>
                  <span
                    className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full"
                    style={
                      tone === 'bad'
                        ? { background: '#FDE8E8', color: '#C0392B' }
                        : { background: '#FFF1C9', color: '#8A6800' }
                    }
                  >
                    {m.days} day{m.days === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-[10.8px] font-bold text-[#5B6B8C] mt-1 m-0 leading-snug">
                  {m.kidName}’s
                  {m.lastSeenWhere ? ` · last seen ${m.lastSeenWhere}` : ''}
                  {m.lastSeenOn ? ` (${toDisplayDate(m.lastSeenOn)})` : ''}
                </p>

                {m.sightings.length > 0 && (
                  <div className="mt-1.5">
                    {m.sightings.slice(-3).map((s, i) => (
                      <p key={`${s.at}-${i}`} className="text-[10.8px] font-bold text-[#5B6B8C] m-0">
                        👀 {s.byName}: “{s.where}”
                      </p>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mt-2 flex-wrap">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => markFound(familyId!, m.kidId, m.id))}
                    className="px-3.5 py-1.5 rounded-full text-white font-extrabold text-[11.5px]"
                    style={{ background: '#0E6B5E' }}
                  >
                    ✅ I found it
                  </button>
                  <button
                    type="button"
                    onClick={() => { setOpenId(openId === m.id ? '' : m.id); setWhere(''); }}
                    className="px-3.5 py-1.5 rounded-full font-extrabold text-[11.5px] bg-white text-[#0E6B5E] border-[1.5px] border-[#0E6B5E]"
                  >
                    👀 I’ve seen it
                  </button>
                </div>

                {openId === m.id && (
                  <div className="mt-2">
                    <input
                      value={where}
                      onChange={(e) => setWhere(e.target.value)}
                      placeholder="Where did you see it?"
                      maxLength={120}
                      className="w-full text-[12px] rounded-[10px] border border-[#ECE4D3] bg-white p-2 outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy || !where.trim()}
                      onClick={() => run(() => addSighting(familyId!, m.kidId, m.id, where.trim()))}
                      className="mt-2 px-3.5 py-1.5 rounded-full text-white font-extrabold text-[11.5px] disabled:opacity-40"
                      style={{ background: '#0E6B5E' }}
                    >
                      Add what I saw
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          </div>
          )}
          </PageSplit>
        </div>
      </div>
    </div>
  );
}
