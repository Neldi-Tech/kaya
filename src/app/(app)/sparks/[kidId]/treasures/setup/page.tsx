'use client';

// Kaya Sparks · Treasures — the parent's Keeper Check setup.
//
// D23 (Elia, 16-Aug-2026) · the cadence is the PARENT's call, and it is
// the thing that decides whether this module survives: a check that
// never resurfaces is a check nobody does. Pick how often, which day,
// and how fast a miss escalates to you.
//
// The escalation ladder is about not letting it slip — never about
// blame. The copy stays "let's check your things" at every rung, and
// nothing is ever deducted (D7).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { toDisplayDate } from '@/lib/dates';
import {
  getKeeperSettings, setKeeperSettings, listTreasures, watchList,
  CADENCE_LABEL, DEFAULT_KEEPER_SETTINGS, fetchTreasuresToday,
  type CheckCadence, type KeeperCheckSettings, type Treasure,
} from '@/lib/sparks/treasures';
import { PAGE_WIDTH_CLASS } from '@/components/layout/Page';

const CADENCES: CheckCadence[] = ['weekly', 'fortnightly', 'monthly', 'termly'];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function KeeperCheckSetupPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId ?? '';
  const { profile } = useAuth();
  const { children } = useFamily();

  const familyId = profile?.familyId;
  const isParent = profile?.role === 'parent';
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  const [s, setS] = useState<KeeperCheckSettings>(DEFAULT_KEEPER_SETTINGS);
  const [list, setList] = useState<Treasure[]>([]);
  const [dueOn, setDueOn] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    if (!kidId) return;
    getKeeperSettings(kidId).then(setS).catch(() => {});
    listTreasures(kidId).then(setList).catch(() => {});
    fetchTreasuresToday(kidId).then((r) => setDueOn(r.check.dueOn)).catch(() => {});
  }, [kidId]);
  useEffect(() => { load(); }, [load]);

  const watch = useMemo(() => watchList(list), [list]);

  async function save(patch: Partial<KeeperCheckSettings>) {
    if (!familyId || busy) return;
    const next = { ...s, ...patch };
    setS(next);
    setBusy(true); setErr(''); setSaved(false);
    try {
      await setKeeperSettings(familyId, kidId, patch);
      setSaved(true);
      fetchTreasuresToday(kidId).then((r) => setDueOn(r.check.dueOn)).catch(() => {});
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  }

  if (!isParent) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center p-6 text-center">
        <div>
          <p className="text-[13px] font-bold text-[#0F1F44]">
            Your parents set how often the Keeper Check comes round.
          </p>
          <Link href={`/sparks/${kidId}/treasures`} className="text-[12px] font-extrabold text-[#0E6B5E]">
            ‹ Back to my treasures
          </Link>
        </div>
      </div>
    );
  }

  // Web-Fit (2026-08-23): narrow tier — a settings form, so just the
  // container (every control auto-saves; there is no submit). Mobile
  // markup unchanged.
  return (
    <div className="min-h-screen bg-[#FFFBF5] pb-20">
      <div className={`mx-auto max-w-md sm:max-w-2xl ${PAGE_WIDTH_CLASS.narrow} lg:px-4`}>
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
          style={{ background: 'linear-gradient(135deg,#1F2A44 0%,#5B6B8C 100%)' }}
        >
          <div className="text-[10.5px] lg:text-[12px] font-extrabold opacity-85">
            ⚙️ Sparks setup · {kid?.name ?? 'this child'}
          </div>
          <div className="font-display text-[19px] lg:text-[30px] font-extrabold mt-0.5">🔑 Keeper Check</div>
          <div className="text-[11px] lg:text-[13.5px] opacity-90 mt-1">
            How often should Kaya ask {kid?.name ?? 'them'} to check their things?
          </div>
        </div>

        <div className="px-4 mt-3 lg:mt-5">
          {CADENCES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => save({ cadence: c })}
              className={`w-full text-left rounded-[13px] border px-3 py-2.5 mb-2 flex items-center gap-2.5 ${
                s.cadence === c
                  ? 'border-2 border-[#0E6B5E] bg-[#F1FAF7]'
                  : 'border-[#ECE4D3] bg-white'
              }`}
            >
              <span className="text-[18px]" aria-hidden>🗓</span>
              <span className="flex-1 font-display font-extrabold text-[12.5px] text-[#0F1F44]">
                {CADENCE_LABEL[c]}
                {c === 'fortnightly' && (
                  <span className="ml-1.5 text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#E2F3EE] text-[#0E6B5E]">
                    default
                  </span>
                )}
              </span>
              <span className="text-[15px]" aria-hidden>{s.cadence === c ? '●' : '○'}</span>
            </button>
          ))}

          <Row label="Day & time">
            <div className="flex gap-2 items-center">
              <select
                value={s.dayOfWeek}
                onChange={(e) => save({ dayOfWeek: Number(e.target.value) })}
                className="text-[12.5px] font-extrabold bg-transparent outline-none"
              >
                {DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
              <select
                value={s.hour}
                onChange={(e) => save({ hour: Number(e.target.value) })}
                className="text-[12.5px] font-extrabold bg-transparent outline-none"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
              <span className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#EEF0F4] text-[#5B6B8C]">
                local
              </span>
            </div>
          </Row>

          <Row label="What's on the check">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-extrabold text-[#0F1F44]">
                Watch list · {watch.length} thing{watch.length === 1 ? '' : 's'}
              </span>
              <Link
                href={`/sparks/${kidId}/treasures`}
                className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#E2F3EE] text-[#0E6B5E] no-underline"
              >
                edit
              </Link>
            </div>
            <p className="text-[10.5px] text-[#8A8471] leading-snug mt-1 m-0">
              Keep this near ten things — the check has to stay under thirty seconds or nobody
              finishes it. Everything else sweeps once a term regardless.
            </p>
          </Row>

          <Row label="Escalate to me after">
            <div className="flex gap-2 items-center flex-wrap">
              <span className="text-[11.5px] font-bold text-[#5B6B8C]">Push after</span>
              <select
                value={s.escalatePushAfterDays}
                onChange={(e) => save({ escalatePushAfterDays: Number(e.target.value) })}
                className="text-[12.5px] font-extrabold bg-transparent outline-none"
              >
                {[0, 1, 2, 3, 5, 7].map((d) => (
                  <option key={d} value={d}>{d === 0 ? 'same day' : `${d} day${d === 1 ? '' : 's'}`}</option>
                ))}
              </select>
              <span className="text-[11.5px] font-bold text-[#5B6B8C]">· email after</span>
              <select
                value={s.escalateEmailAfterDays}
                onChange={(e) => save({ escalateEmailAfterDays: Number(e.target.value) })}
                className="text-[12.5px] font-extrabold bg-transparent outline-none"
              >
                {[1, 2, 3, 5, 7, 14].map((d) => (
                  <option key={d} value={d}>{d} day{d === 1 ? '' : 's'}</option>
                ))}
              </select>
            </div>
          </Row>

          <button
            type="button"
            onClick={() => save({ enabled: !s.enabled })}
            className={`w-full text-left rounded-[13px] border px-3 py-2.5 mt-2 ${
              s.enabled ? 'border-[#BFE3D8] bg-[#F1FAF7]' : 'border-[#ECE4D3] bg-white'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-extrabold text-[#0F1F44]">
                {s.enabled ? '🔔 Reminders are on' : '🔕 Reminders are off'}
              </span>
              <span
                className={`w-9 h-5 rounded-full shrink-0 relative ${
                  s.enabled ? 'bg-[#0E6B5E]' : 'bg-[#DDE3EC]'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white ${
                    s.enabled ? 'left-[18px]' : 'left-0.5'
                  }`}
                />
              </span>
            </div>
          </button>

          {/* The ladder, stated plainly — a parent should never be
              surprised by what Kaya sends on their behalf. */}
          <div className="rounded-[14px] border border-[#ECE4D3] bg-white p-3 mt-3">
            <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
              If the check is missed
            </div>
            <Rung n="①" title="Due day" body={`${kid?.name ?? 'They'} get a bell + push, and it lands on My Day and the Workplan`} />
            <Rung
              n="②"
              title={s.escalatePushAfterDays === 0 ? 'Same day' : `+${s.escalatePushAfterDays} day${s.escalatePushAfterDays === 1 ? '' : 's'} still open`}
              body="A second nudge to them and a push to you"
            />
            <Rung
              n="③"
              title={`+${s.escalateEmailAfterDays} days still open`}
              body="Email to you through the Treasure › Sparks › Family cascade"
            />
            <Rung
              n="④"
              title="Next due date arrives, still open"
              body="Marked overdue on your roll-up · the two checks merge into one, never two stacked chores"
            />
            <p className="text-[10.8px] text-[#0E6B5E] font-bold leading-snug mt-2 m-0">
              ✅ Finishing at any rung closes the ladder and appends a quiet tick — never a second
              alarm.
            </p>
          </div>

          {dueOn && (
            <p className="text-[11.5px] text-[#5A6488] font-bold mt-3">
              Next check: <b>{toDisplayDate(dueOn)}</b>
            </p>
          )}
          {saved && <p className="text-[11.5px] text-[#2E7D34] font-extrabold mt-1">Saved ✓</p>}
          {err && <p className="text-[11.5px] text-[#C0392B] font-bold mt-1">{err}</p>}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#ECE4D3] rounded-[10px] px-3 py-2 mt-2 bg-white">
      <div className="text-[9.5px] font-extrabold tracking-[0.6px] uppercase text-[#8A8471]">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Rung({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="flex gap-2 mt-2">
      <span className="text-[11px] font-extrabold text-[#0E6B5E] shrink-0">{n}</span>
      <div>
        <div className="text-[11.5px] font-extrabold text-[#0F1F44] leading-tight">{title}</div>
        <p className="text-[10.8px] font-bold text-[#5B6B8C] leading-snug m-0">{body}</p>
      </div>
    </div>
  );
}
