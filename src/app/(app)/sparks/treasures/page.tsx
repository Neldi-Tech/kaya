'use client';

// Kaya Sparks · Treasures — the parent roll-up.
//
// Three things a parent actually wants, in the order they want them:
//   1. what needs me right now (a thank-you to send, a warranty about
//      to lapse, a check that's slipping),
//   2. how each child is doing at LOOKING AFTER things — behaviour, not
//      possessions,
//   3. and, parents-only, what the register is worth.
//
// D5 is the rule this screen exists to respect: the children's numbers
// sit on their own rows and are NEVER ranked or totalled against each
// other. Care Score is comparable because it measures behaviour; count
// and value never are.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { toDisplayDate } from '@/lib/dates';
import {
  fetchTreasuresRollUp, treasuresApi, CADENCE_LABEL,
  type TreasuresRollUp,
} from '@/lib/sparks/treasures';

export default function ParentTreasuresPage() {
  const { profile } = useAuth();
  const isParent = profile?.role === 'parent';

  const [data, setData] = useState<TreasuresRollUp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    fetchTreasuresRollUp().then(setData).catch(() => setData(null));
  }, []);
  useEffect(() => { if (isParent) load(); }, [isParent, load]);

  if (!isParent) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center p-6 text-center">
        <div>
          <p className="text-[13px] font-bold text-[#0F1F44]">This page is for parents.</p>
          <Link href="/sparks" className="text-[12px] font-extrabold text-[#0E6B5E]">‹ Sparks</Link>
        </div>
      </div>
    );
  }

  async function send(treasureId: string) {
    if (busy) return;
    setBusy(true); setErr('');
    try { await treasuresApi('thankyou-send', { treasureId }); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not send that'); }
    finally { setBusy(false); }
  }

  const kids = data?.kids ?? [];
  const totalLive = kids.reduce((n, k) => n + k.live, 0);
  const totalMissing = kids.reduce((n, k) => n + k.missing, 0);

  return (
    <div className="min-h-screen bg-[#FFFBF5] pb-20">
      <div className="mx-auto max-w-md sm:max-w-2xl">
        <div className="px-4 pt-4">
          <Link
            href="/sparks"
            className="inline-flex items-center gap-1.5 pl-2.5 pr-3.5 py-1.5 rounded-full bg-white border border-[#ECE4D3] text-[#0F1F44] font-display font-extrabold text-[12px] no-underline"
          >
            <span className="text-[13px] leading-none opacity-60" aria-hidden>‹</span>
            <span>Sparks</span>
          </Link>
        </div>

        <div
          className="mx-4 mt-3 rounded-[18px] p-4 text-white"
          style={{ background: 'linear-gradient(135deg,#1F2A44 0%,#5B6B8C 100%)' }}
        >
          <div className="text-[10.5px] font-extrabold opacity-85">✨ Sparks · parents only</div>
          <div className="font-display text-[19px] font-extrabold mt-0.5">💎 Treasures</div>
          <div className="text-[11px] opacity-90 mt-1">
            {data === null
              ? 'Loading…'
              : `${kids.length} ${kids.length === 1 ? 'child' : 'children'} · ${totalLive} registered${
                  totalMissing ? ` · ${totalMissing} missing` : ''
                }`}
          </div>
        </div>

        <div className="px-4 mt-3">
          {data === null && (
            <p className="text-[13px] text-[#5A6488] text-center py-6">Loading…</p>
          )}

          {data && kids.length === 0 && (
            <div className="rounded-[14px] border border-[#ECE4D3] bg-white p-4 text-center">
              <div className="text-[30px] leading-none">💎</div>
              <p className="text-[13px] font-extrabold text-[#0F1F44] mt-1.5 m-0">
                Nothing registered yet
              </p>
              <p className="text-[11.5px] text-[#5A6488] mt-1.5 leading-snug">
                Open a child&rsquo;s Sparks → Treasures and start with the ten things they would be
                saddest to lose.
              </p>
            </div>
          )}

          {/* 1 · What needs you */}
          {!!data?.thankYous.length && (
            <div className="rounded-[14px] border border-[#BFE3D8] bg-[#F1FAF7] p-3 mb-2.5">
              <div className="font-display font-extrabold text-[12.5px] text-[#0E6B5E]">
                💛 Thank-yous waiting for you
              </div>
              <p className="text-[10.5px] text-[#2C4A44] font-bold m-0 mt-0.5 leading-snug">
                They wrote it. Kaya never sends a child&rsquo;s words without you.
              </p>
              {data.thankYous.map((ty) => (
                <div key={ty.treasureId} className="mt-2 rounded-[10px] bg-white border border-[#BFE3D8] p-2.5">
                  <div className="text-[11.5px] font-extrabold text-[#0F1F44]">
                    {ty.kidName} → {ty.giverName || 'the giver'} · {ty.name}
                  </div>
                  {ty.text && (
                    <p className="text-[11.5px] italic text-[#2C4A44] mt-1 m-0 leading-snug">
                      &ldquo;{ty.text}&rdquo;
                    </p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => send(ty.treasureId)}
                      className="px-3.5 py-1.5 rounded-full text-white font-extrabold text-[11.5px]"
                      style={{ background: '#0E6B5E' }}
                    >
                      ▶ Send it
                    </button>
                    <Link
                      href={`/sparks/${ty.kidId}/treasures/${ty.treasureId}`}
                      className="px-3.5 py-1.5 rounded-full font-extrabold text-[11.5px] bg-[#EEF0F4] text-[#5B6B8C] no-underline"
                    >
                      Open
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!!data?.warrantyDue.length && (
            <div className="rounded-[14px] border border-[#F3D3A6] bg-[#FFF9EF] p-3 mb-2.5">
              <div className="font-display font-extrabold text-[12.5px] text-[#8A6800]">
                🧾 Warranty ending soon
              </div>
              {data.warrantyDue.map((w) => (
                <p key={w.treasureId} className="text-[11.3px] font-bold text-[#7a6320] mt-1.5 m-0 leading-snug">
                  <Link
                    href={`/sparks/${w.kidId}/treasures/${w.treasureId}`}
                    className="text-[#8A6800] no-underline"
                  >
                    {w.kidName}&rsquo;s {w.name}
                  </Link>{' '}
                  — ends {toDisplayDate(w.endsOn)} ({w.days} day{w.days === 1 ? '' : 's'})
                </p>
              ))}
              <p className="text-[10.5px] text-[#8A8471] italic mt-2 m-0 leading-snug">
                One honoured warranty on a laptop or a bike repays a year of Kaya.
              </p>
            </div>
          )}

          {/* 2 · Behaviour, per child. Never ranked. */}
          {kids.map((k) => (
            <div key={k.kidId} className="rounded-[14px] border border-[#ECE4D3] bg-white p-3 mb-2.5">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-[46px] h-[46px] rounded-full grid place-items-center shrink-0"
                  style={{ background: `conic-gradient(#0E6B5E 0 ${k.careScore}%, #E4EDEA ${k.careScore}% 100%)` }}
                  aria-hidden
                >
                  <span className="w-[34px] h-[34px] rounded-full bg-white grid place-items-center font-display font-extrabold text-[11px] text-[#0E6B5E]">
                    {k.careScore}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-extrabold text-[13px] text-[#0F1F44]">
                    {k.emoji} {k.name} · 🔑 {k.careScore}%
                  </div>
                  <p className="text-[10.8px] font-bold text-[#5B6B8C] mt-0.5 m-0 leading-snug">
                    {k.live} thing{k.live === 1 ? '' : 's'}
                    {k.missing ? ` · ${k.missing} missing` : ''}
                    {k.lent ? ` · ${k.lent} lent` : ''}
                    {k.ownedIt ? ` · 🫱 Owned It ×${k.ownedIt}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <span
                  className="text-[10px] font-extrabold px-2 py-1 rounded-full"
                  style={
                    k.checkOverdueDays >= 1
                      ? { background: '#FDE8E8', color: '#C0392B' }
                      : { background: '#EEF0F4', color: '#5B6B8C' }
                  }
                >
                  🔑 {k.checkOverdueDays >= 1
                    ? `Check overdue ${k.checkOverdueDays}d`
                    : `Next check ${toDisplayDate(k.checkDueOn)}`}
                </span>
                <span className="text-[10px] font-extrabold px-2 py-1 rounded-full bg-[#EEF0F4] text-[#5B6B8C]">
                  {CADENCE_LABEL[k.cadence]}
                </span>
                <Link
                  href={`/sparks/${k.kidId}/treasures`}
                  className="text-[10px] font-extrabold px-2 py-1 rounded-full bg-[#E2F3EE] text-[#0E6B5E] no-underline"
                >
                  Open
                </Link>
                <Link
                  href={`/sparks/${k.kidId}/treasures/setup`}
                  className="text-[10px] font-extrabold px-2 py-1 rounded-full bg-[#EEF0F4] text-[#5B6B8C] no-underline"
                >
                  ⚙️ Cadence
                </Link>
              </div>

              {/* 3 · D4 · value, parents only, and never compared. */}
              {k.costCents > 0 && (
                <p className="text-[10.8px] font-bold text-[#5B6B8C] mt-2 m-0">
                  🔒 Cost {(k.costCents / 100).toLocaleString()} {k.currency} · roughly{' '}
                  {(k.nowCents / 100).toLocaleString()} {k.currency} now
                </p>
              )}
            </div>
          ))}

          {kids.length > 1 && (
            <div className="rounded-[12px] border border-[#DDE3EC] bg-[#F1F3F7] p-3 mt-1">
              <p className="text-[11.2px] font-bold text-[#5B6B8C] leading-snug m-0">
                No total is ever compared across children — not here, not on a kid screen, not in an
                email. <b>Only behaviour is shown, never count or value.</b>
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-3">
            <Link
              href="/sparks/treasures/lost-found"
              className="px-3.5 py-2 rounded-full font-extrabold text-[12px] no-underline bg-[#E2F3EE] text-[#0E6B5E]"
            >
              🔍 Lost &amp; Found{totalMissing ? ` · ${totalMissing}` : ''}
            </Link>
            {/* 🗄 Treasures 2.0 — the family's shared books + games. */}
            <Link
              href="/sparks/treasures/cupboard"
              className="px-3.5 py-2 rounded-full font-extrabold text-[12px] no-underline bg-[#F6ECDF] text-[#6E4624]"
            >
              🗄 Family Cupboard
            </Link>
          </div>

          {err && <p className="text-[11.5px] text-[#C0392B] font-bold mt-3">{err}</p>}
        </div>
      </div>
    </div>
  );
}
