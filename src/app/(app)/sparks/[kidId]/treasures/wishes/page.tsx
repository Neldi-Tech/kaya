'use client';

// Kaya Sparks · Treasures — the ✨ Wish Shelf.
//
// Pathway 12, and the loop that closes the circle:
//
//   wish → gift → treasure → thank-you → care → hand-on
//
// A child adds what they're hoping for. The gateway mirrors it into the
// family's existing 🎁 Gift Brain stash, which already surfaces ideas 14
// days before a birthday — so the gift is something they actually
// wanted, and the day after the birthday it comes back in as a
// registered Treasure with the giver attached.
//
// The mirror flows ONE way. Gift Brain is parents-only by design (it
// must never spoil a surprise), so nothing a parent writes there is ever
// readable here. Siblings can't see a wish list at all.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { toDisplayDate } from '@/lib/dates';
import { listWishes, addWish, removeWish, type Wish } from '@/lib/sparks/treasures';
import { PAGE_WIDTH_CLASS, PageSplit, DATA_ROW } from '@/components/layout/Page';

export default function WishShelfPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId ?? '';
  const { profile } = useAuth();
  const { children } = useFamily();

  const isParent = profile?.role === 'parent';
  const isOwner = !!profile?.childId && profile.childId === kidId;
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  const [wishes, setWishes] = useState<Wish[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    if (!kidId) return;
    listWishes(kidId).then(setWishes).catch(() => setWishes([]));
  }, [kidId]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setErr('');
    try { await fn(); load(); }
    catch (e) {
      const m = e instanceof Error ? e.message : 'That did not work';
      setErr(m === 'wish-shelf-full' ? 'Your shelf is full — take one off first.' : m);
    } finally { setBusy(false); }
  }

  if (!isParent && !isOwner) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center p-6 text-center">
        <div>
          <p className="text-[13px] font-bold text-[#0F1F44]">
            A wish shelf is just for the person it belongs to.
          </p>
          <Link href="/sparks" className="text-[12px] font-extrabold text-[#0E6B5E]">‹ Sparks</Link>
        </div>
      </div>
    );
  }

  // Web-Fit (2026-08-23): content tier + rail. Desktop: the wishes as
  // one divided panel; the add-a-wish card, the loop note and errors in
  // a right rail (railMobile="last" keeps the mobile order). Mobile
  // markup unchanged.
  const rail = (
    <>
      <div className="rounded-[14px] border border-[#BFE3D8] bg-[#F1FAF7] p-3 mt-1 lg:mt-0">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="A proper art set…"
          maxLength={160}
          className="w-full text-[12.5px] rounded-[10px] border border-[#BFE3D8] bg-white p-2 outline-none"
        />
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => run(async () => { await addWish(kidId, text.trim()); setText(''); })}
          className="mt-2 px-4 py-2 rounded-full text-white font-extrabold text-[12px] disabled:opacity-40"
          style={{ background: '#0E6B5E' }}
        >
          + Add a wish
        </button>
      </div>

      <div className="rounded-[12px] border border-[#DDE3EC] bg-[#F1F3F7] p-3 mt-3">
        <p className="text-[11.2px] font-bold text-[#5B6B8C] leading-snug m-0">
          🔁 <b>How the loop closes:</b> a wish goes to your parents&rsquo; 🎁 Gift Brain, which
          reminds them two weeks before a birthday. The gift comes back here as a treasure with
          the giver on it — and one day you hand it on to someone else.
        </p>
      </div>

      {err && <p className="text-[11.5px] text-[#C0392B] font-bold mt-3">{err}</p>}
    </>
  );

  return (
    <div className="min-h-screen bg-[#FFFBF5] pb-20">
      <div className={`mx-auto max-w-md sm:max-w-2xl ${PAGE_WIDTH_CLASS.content} lg:px-4`}>
        <div className="px-4 pt-4 lg:pt-6">
          <Link
            href={`/sparks/${kidId}/treasures`}
            className="inline-flex items-center gap-1.5 pl-2.5 pr-3.5 py-1.5 rounded-full bg-white border border-[#ECE4D3] text-[#0F1F44] font-display font-extrabold text-[12px] no-underline"
          >
            <span className="text-[13px] leading-none opacity-60" aria-hidden>‹</span>
            <span>Treasures</span>
          </Link>
        </div>

        <div
          className="mx-4 mt-3 rounded-[18px] lg:rounded-[24px] p-4 lg:px-8 lg:py-7 text-white"
          style={{ background: 'linear-gradient(135deg,#0E6B5E 0%,#3FA38F 100%)' }}
        >
          <div className="text-[10.5px] lg:text-[12px] font-extrabold opacity-85">
            💎 Treasures · {kid?.name ?? ''}
          </div>
          <div className="font-display text-[19px] lg:text-[30px] font-extrabold mt-0.5">✨ Wish Shelf</div>
          <div className="text-[11px] lg:text-[13.5px] opacity-90 mt-1">
            {isOwner ? 'Things you’re hoping for · your parents can see this' : `What ${kid?.name ?? 'they'} is hoping for`}
          </div>
        </div>

        <div className="px-4 mt-3 lg:mt-5">
          <PageSplit rail={rail} railMobile="last">
          {wishes === null && (
            <p className="text-[13px] text-[#5A6488] text-center py-6">Loading…</p>
          )}

          {wishes?.length === 0 && (
            <div className="rounded-[14px] border border-[#ECE4D3] bg-white p-4 text-center">
              <div className="text-[30px] leading-none">✨</div>
              <p className="text-[13px] font-extrabold text-[#0F1F44] mt-1.5 m-0">
                Nothing on the shelf yet
              </p>
              <p className="text-[11.5px] text-[#5A6488] mt-1.5 leading-snug">
                {isOwner
                  ? 'Add the things you’d love. Your parents will see them when a birthday is coming.'
                  : 'When they add a wish it lands in your 🎁 Gift Brain automatically.'}
              </p>
            </div>
          )}

          {!!wishes?.length && (
          <div className="lg:rounded-[14px] lg:border lg:border-[#ECE4D3] lg:bg-white lg:divide-y lg:divide-[#ECE4D3] lg:overflow-hidden">
          {wishes.map((w) => (
            <div key={w.id} className={`rounded-[14px] border border-[#ECE4D3] bg-white p-3 mb-2 lg:mb-0 lg:px-4 lg:py-3 ${DATA_ROW}`}>
              <div className="flex items-start gap-2">
                <span className="text-[16px]" aria-hidden>✨</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-extrabold text-[#0F1F44] leading-snug">
                    {w.text}
                  </div>
                  <div className="text-[10.5px] font-bold text-[#8A8471] mt-0.5">
                    Added {toDisplayDate(w.on)}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => removeWish(kidId, w.id))}
                  className="text-[10px] font-extrabold px-2 py-1 rounded-full bg-[#EEF0F4] text-[#5B6B8C] shrink-0"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          </div>
          )}
          </PageSplit>
        </div>
      </div>
    </div>
  );
}
