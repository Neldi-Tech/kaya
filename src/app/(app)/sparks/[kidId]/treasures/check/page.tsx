'use client';

// Kaya Sparks · Treasures — the Keeper Check.
//
// The engine of the whole module. Every second Sunday (or whatever
// cadence the parent set · D23) the child taps once per watch-listed
// thing: ✅ got it · 🔧 needs fixing · ❓ can't find. It converts "look
// after your things" from nagging into a ritual the child performs
// themselves.
//
// Three rules the screen must never break:
//   D7 · nothing is ever deducted, and the copy says so out loud before
//        the first tap. If reporting has a cost, children stop
//        reporting and the register becomes fiction.
//   D9 · watch list only, target under 30 seconds. R4 killed the
//        everything-every-time version.
//   D10 · a ❓ asks WHERE it was last, never who had it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  listTreasures, submitKeeperCheck, watchList, categoryDef,
  type Treasure, type CheckResult, type CheckSubmission,
} from '@/lib/sparks/treasures';

const PLACES = ['School bag', 'My room', 'The car', 'Sitting room', 'At school', 'Someone borrowed it'];

export default function KeeperCheckPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId ?? '';
  const router = useRouter();
  const { profile } = useAuth();
  const { children } = useFamily();

  const familyId = profile?.familyId;
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  const [list, setList] = useState<Treasure[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, CheckResult>>({});
  const [places, setPlaces] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ownedIt: number; missing: number } | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    if (!kidId) return;
    listTreasures(kidId).then((r) => setList(r)).catch(() => setList([]));
  }, [kidId]);
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => watchList(list ?? []), [list]);
  const answered = items.filter((t) => answers[t.id]).length;
  const remaining = items.length - answered;
  const missingIds = items.filter((t) => answers[t.id] === 'missing');

  async function finish() {
    if (busy || !familyId) return;
    setBusy(true);
    setErr('');
    try {
      const results: CheckSubmission[] = items
        .filter((t) => answers[t.id])
        .map((t) => ({
          treasureId: t.id,
          result: answers[t.id],
          ...(answers[t.id] === 'missing' && places[t.id] ? { lastSeenWhere: places[t.id] } : {}),
        }));
      const r = await submitKeeperCheck(familyId, kidId, results);
      setDone({ ownedIt: r.ownedIt, missing: r.missing });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the check — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (list === null) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#0F1F44] text-sm">
        Loading…
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] px-4 py-10">
        <div className="mx-auto max-w-md text-center">
          <div className="text-[46px] leading-none">🔑</div>
          <h1 className="font-display font-extrabold text-[20px] text-[#0F1F44] mt-2">
            Check done{done.missing === 0 ? ' — everything accounted for' : ''}
          </h1>
          <p className="text-[13px] text-[#5A6488] mt-2 leading-snug">
            {done.missing === 0
              ? 'That is exactly the Keeper’s job. See you next time.'
              : `We’ve started looking for ${done.missing === 1 ? 'it' : `all ${done.missing}`}. Everyone at home can help — the board shows where ${done.missing === 1 ? 'it was' : 'they were'} last seen.`}
          </p>
          {done.ownedIt > 0 && (
            <div className="mt-4 rounded-[14px] border border-[#BFE3D8] bg-[#F1FAF7] p-3.5">
              <div className="font-display font-extrabold text-[14px] text-[#0E6B5E]">🫱 Owned It</div>
              <p className="text-[12px] font-bold text-[#2C4A44] mt-1 leading-snug m-0">
                You told us straight away instead of hoping nobody noticed. Nothing was taken away —
                that is the whole point.
              </p>
            </div>
          )}
          <div className="flex gap-2 justify-center mt-5">
            <Link
              href={`/sparks/${kidId}/treasures`}
              className="px-4 py-2.5 rounded-full text-white font-extrabold text-[13px] no-underline"
              style={{ background: '#0E6B5E' }}
            >
              Back to my shelf
            </Link>
            {done.missing > 0 && (
              <Link
                href="/sparks/treasures/lost-found"
                className="px-4 py-2.5 rounded-full font-extrabold text-[13px] no-underline bg-[#E2F3EE] text-[#0E6B5E]"
              >
                🔍 Lost &amp; Found
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFBF5] pb-28">
      <div className="mx-auto max-w-md sm:max-w-2xl">
        <div className="px-4 pt-4">
          <Link
            href={`/sparks/${kidId}/treasures`}
            className="inline-flex items-center gap-1.5 pl-2.5 pr-3.5 py-1.5 rounded-full bg-white border border-[#ECE4D3] text-[#0F1F44] font-display font-extrabold text-[12px] no-underline"
          >
            <span className="text-[13px] leading-none opacity-60" aria-hidden>‹</span>
            <span>Treasures</span>
          </Link>
        </div>

        <div
          className="mx-4 mt-3 rounded-[18px] p-4 text-white"
          style={{ background: 'linear-gradient(135deg,#0E6B5E 0%,#3FA38F 100%)' }}
        >
          <div className="text-[10.5px] font-extrabold opacity-85">
            🔑 {kid?.name ? `${kid.name}’s check` : 'Keeper Check'}
          </div>
          <div className="font-display text-[19px] font-extrabold mt-0.5">Keeper Check</div>
          <div className="text-[11px] opacity-90 mt-1">
            {items.length} thing{items.length === 1 ? '' : 's'} · tap one for each · no wrong answers
          </div>
        </div>

        <div className="px-4 mt-3">
          {/* D7 · said out loud BEFORE the first tap. */}
          <div className="rounded-[12px] border border-[#BFE3D8] bg-[#E2F3EE] p-3 text-[#1B4B43]">
            <p className="text-[11.2px] font-bold leading-snug m-0">
              Kaya never takes points away for an accident.{' '}
              <b>Telling us fast is the Keeper’s job.</b>
            </p>
          </div>

          {items.length === 0 && (
            <div className="mt-4 rounded-[14px] border border-[#ECE4D3] bg-white p-4 text-center">
              <p className="text-[13px] font-bold text-[#0F1F44] m-0">
                Nothing on the watch list yet.
              </p>
              <p className="text-[11.5px] text-[#5A6488] mt-1.5 leading-snug">
                Add the things you would be saddest to lose, and they’ll show up here.
              </p>
              <Link
                href={`/sparks/${kidId}/treasures`}
                className="inline-flex mt-3 px-4 py-2 rounded-full text-white font-extrabold text-[12px] no-underline"
                style={{ background: '#0E6B5E' }}
              >
                💎 Add a treasure
              </Link>
            </div>
          )}

          <div className="mt-3">
            {items.map((t) => {
              const a = answers[t.id];
              return (
                <div
                  key={t.id}
                  className="rounded-[13px] border border-[#ECE4D3] bg-white px-2.5 py-2 mb-2 flex items-center gap-2.5"
                >
                  <span className="text-[21px] shrink-0" aria-hidden>
                    {t.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.thumbUrl} alt="" className="w-7 h-7 rounded-[7px] object-cover" />
                    ) : (t.emoji || categoryDef(t.categoryId).emoji)}
                  </span>
                  <span className="flex-1 min-w-0 font-display font-extrabold text-[11.8px] leading-tight text-[#0F1F44]">
                    {t.name}
                  </span>
                  <span className="flex gap-1 shrink-0">
                    <Opt on={a === 'have'} tone="jade" label="✅"
                      onClick={() => setAnswers((s) => ({ ...s, [t.id]: 'have' }))} />
                    <Opt on={a === 'fix'} tone="gold" label="🔧"
                      onClick={() => setAnswers((s) => ({ ...s, [t.id]: 'fix' }))} />
                    <Opt on={a === 'missing'} tone="rose" label="❓"
                      onClick={() => setAnswers((s) => ({ ...s, [t.id]: 'missing' }))} />
                  </span>
                </div>
              );
            })}
          </div>

          {/* D10 · one question, and it is about a PLACE. */}
          {missingIds.map((t) => (
            <div key={`p-${t.id}`} className="rounded-[12px] border border-[#F0C9CC] bg-[#FEF6F6] p-3 mb-2">
              <div className="text-[11.5px] font-extrabold text-[#8B2830]">
                ❓ {t.name} — where did you have it last?
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {PLACES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlaces((s) => ({ ...s, [t.id]: s[t.id] === p ? '' : p }))}
                    className={`px-2.5 py-1.5 rounded-full text-[11px] font-extrabold border ${
                      places[t.id] === p
                        ? 'bg-[#FDE8E8] text-[#C0392B] border-[#C0392B]'
                        : 'bg-white text-[#5B6B8C] border-[#F0C9CC]'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <input
                value={PLACES.includes(places[t.id]) ? '' : (places[t.id] || '')}
                onChange={(e) => setPlaces((s) => ({ ...s, [t.id]: e.target.value }))}
                placeholder="or type where…"
                maxLength={120}
                className="w-full mt-2 text-[12px] rounded-[10px] border border-[#F0C9CC] bg-white p-2 outline-none"
              />
            </div>
          ))}

          {err && <p className="text-[11.5px] text-[#C0392B] font-bold mt-2">{err}</p>}
        </div>
      </div>

      {items.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 p-3 bg-[#FFFBF5]/95 backdrop-blur border-t border-[#ECE4D3]">
          <div className="mx-auto max-w-md sm:max-w-2xl">
            <button
              type="button"
              disabled={busy || answered === 0}
              onClick={finish}
              className="w-full py-3 rounded-full text-white font-extrabold text-[13px] disabled:opacity-40"
              style={{ background: '#0E6B5E' }}
            >
              {busy
                ? 'Saving…'
                : remaining > 0
                  ? `Finish check · ${remaining} left`
                  : 'Finish check'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Opt({
  on, tone, label, onClick,
}: { on: boolean; tone: 'jade' | 'gold' | 'rose'; label: string; onClick: () => void }) {
  const ring = tone === 'jade'
    ? 'bg-[#E2F3EE] border-[#0E6B5E]'
    : tone === 'gold'
      ? 'bg-[#FFF1C9] border-[#D4A847]'
      : 'bg-[#FDE8E8] border-[#C0392B]';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-[30px] h-[30px] rounded-[9px] grid place-items-center text-[14px] border-[1.5px] ${
        on ? ring : 'bg-[#F3F1EA] border-transparent'
      }`}
    >
      <span aria-hidden>{label}</span>
    </button>
  );
}
