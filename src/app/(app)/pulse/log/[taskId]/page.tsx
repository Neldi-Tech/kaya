'use client';

// /pulse/log/[taskId] — Kaya Pulse · Quick Entry (playful). Shows the previous
// reading, takes today's value, previews the delta + cost live (pure helpers,
// client-side), then saves via the server log route and celebrates the points.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { formatCents } from '@/components/pantry/format';
import {
  type PulseTask, type Trackable, type PulseReading, type LogReadingResult,
  getPulseTask, getLatestReading, subscribeToTrackables, logReading,
  computeConsumption, computeDeltaCostCents,
} from '@/lib/pulse';

export default function QuickEntryPage() {
  const router = useRouter();
  const params = useParams<{ taskId: string }>();
  const taskId = (params?.taskId as string) ?? '';
  const { profile } = useAuth();
  const { config } = useHive();
  const currency = config.currency;

  const [task, setTask] = useState<PulseTask | null>(null);
  const [trackables, setTrackables] = useState<Trackable[]>([]);
  const [prev, setPrev] = useState<PulseReading | null>(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<LogReadingResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile?.familyId || !taskId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const tk = await getPulseTask(profile.familyId, taskId);
      if (cancelled) return;
      setTask(tk);
      if (tk) {
        const pr = await getLatestReading(profile.familyId, tk.trackableId);
        if (!cancelled) setPrev(pr);
      }
      setLoading(false);
    })();
    const unsub = subscribeToTrackables(profile.familyId, (list) => {
      if (!cancelled) setTrackables(list);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [profile?.familyId, taskId]);

  const trackable = useMemo(
    () => trackables.find((t) => t.id === task?.trackableId) ?? null,
    [trackables, task],
  );

  const numeric = parseFloat(value);
  const hasValue = value !== '' && Number.isFinite(numeric);
  const calc = trackable && hasValue ? computeConsumption(trackable.direction, prev?.value ?? null, numeric) : null;
  const cost = calc && trackable ? computeDeltaCostCents(calc.consumedUnits, trackable.pricePerUnitCents) : 0;

  const onSave = async () => {
    if (!profile?.familyId || !hasValue || saving) return;
    setSaving(true);
    setError('');
    try {
      const r = await logReading({
        familyId: profile.familyId, taskId, value: numeric,
        actorUid: profile.uid, actorRole: profile.role,
      });
      setResult(r);
      // Parents log on a reader's behalf from the dashboard — send them back
      // there; readers go to their daily Pulse view.
      const back = profile.role === 'parent' ? '/pulse' : '/pulse/today';
      setTimeout(() => router.push(back), 1500);
    } catch {
      setError('Could not save — check your connection and try again.');
      setSaving(false);
    }
  };

  if (loading) return <Shell><p className="text-hive-muted text-sm">Loading…</p></Shell>;
  if (!task) {
    return (
      <Shell>
        <div className="text-center pt-10">
          <div className="text-3xl mb-2">🤔</div>
          <h2 className="font-nunito font-black text-pulse-joy-ink">Task not found</h2>
          <Link href="/pulse/today" className="text-pulse-joy-purple font-bold text-sm underline mt-2 inline-block">← Back to Today</Link>
        </div>
      </Shell>
    );
  }
  if (task.status === 'logged' || task.status === 'closed') {
    return (
      <Shell>
        <div className="text-center pt-10">
          <div className="text-3xl mb-2">✅</div>
          <h2 className="font-nunito font-black text-pulse-joy-ink">Already logged today</h2>
          <Link href="/pulse/today" className="text-pulse-joy-purple font-bold text-sm underline mt-2 inline-block">← Back to Today</Link>
        </div>
      </Shell>
    );
  }

  // Success celebration.
  if (result && !result.alreadyLogged) {
    return (
      <Shell>
        <div className="text-center pt-16">
          <div className="text-5xl mb-3">⭐</div>
          <div className="font-nunito font-black text-3xl text-pulse-joy-ink">+{result.points} pts</div>
          {result.consumedUnits > 0 && (
            <p className="text-hive-muted text-sm mt-2">
              Used {result.consumedUnits} {trackable?.unit} = {formatCents(result.deltaCost, currency)}
            </p>
          )}
          {result.streak ? <p className="text-pulse-joy-purple font-bold text-sm mt-1">🔥 {result.streak}-day streak</p> : null}
          {result.isAnomaly && <p className="text-pulse-coral text-sm mt-2 font-bold">Flagged for a parent to check.</p>}
        </div>
      </Shell>
    );
  }

  const isTopup = calc?.event === 'topup';
  const isRollback = calc?.event === 'rollback';

  return (
    <Shell>
      <Link href="/pulse/today" className="text-[12px] text-pulse-joy-purple font-bold no-underline hover:underline inline-block mb-2">← Today</Link>
      <h1 className="font-nunito font-black text-xl text-pulse-joy-ink">
        {trackable?.emoji ?? '📊'} Log {trackable?.name ?? 'reading'}
      </h1>

      {/* Previous reading */}
      <div className="bg-white border-2 border-pulse-joy-purple/15 rounded-2xl p-3.5 mt-4">
        <div className="text-[10px] font-black text-hive-muted uppercase tracking-[1px]">Last reading</div>
        <div className="text-lg font-nunito font-black text-pulse-joy-ink mt-0.5">
          {prev ? `${prev.value} ${trackable?.unit ?? ''}` : 'None yet — this sets the baseline'}
        </div>
      </div>

      {/* Today's value */}
      <div className="bg-gradient-to-br from-[#FFF8EC] to-[#FFE8CB] border-2 border-pulse-joy-yellow rounded-2xl p-4 mt-3">
        <div className="text-[11px] font-black text-[#5A3D00] uppercase tracking-[1px]">Today's meter value</div>
        <div className="bg-white border-2 border-dashed border-[#F0B82B] rounded-xl px-3 py-2.5 mt-2 flex items-baseline gap-2">
          <input
            autoFocus
            type="number"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
            className="flex-1 min-w-0 text-3xl font-nunito font-black text-pulse-joy-ink bg-transparent focus:outline-none"
          />
          <span className="text-sm text-hive-muted font-bold">{trackable?.unit ?? ''}</span>
        </div>
      </div>

      {/* Live result */}
      {calc && (
        isRollback ? (
          <div className="bg-[#fdecec] border border-[#f3bcbc] rounded-2xl p-3.5 mt-3 text-sm text-[#9c2b2b] font-bold">
            That's lower than the last reading on a meter that should only go up — double-check the number.
          </div>
        ) : isTopup ? (
          <div className="bg-pulse-joy-mint/20 border border-pulse-joy-mint rounded-2xl p-3.5 mt-3 text-sm text-pulse-joy-ink font-bold">
            Looks like a top-up of {calc.toppedUpUnits} {trackable?.unit} — no usage recorded for this reading. 👍
          </div>
        ) : (
          <div className="bg-gradient-to-br from-pulse-joy-green to-pulse-joy-mint text-white rounded-2xl p-4 mt-3">
            <div className="text-[10px] uppercase tracking-[1px] font-black opacity-90">You used</div>
            <div className="text-2xl font-nunito font-black mt-0.5">
              {calc.consumedUnits} {trackable?.unit} = {formatCents(cost, currency)}
            </div>
          </div>
        )
      )}

      {!trackable?.pricePerUnitCents && (
        <p className="text-[11px] text-pulse-coral font-bold mt-2">No unit price set for this trackable — cost will show as 0 until a parent sets it.</p>
      )}
      {error && <p className="text-pulse-coral text-sm font-bold mt-3">{error}</p>}

      <button
        onClick={onSave}
        disabled={!hasValue || saving}
        className="w-full mt-4 bg-gradient-to-r from-pulse-joy-purple to-pulse-joy-coral text-white rounded-2xl py-3.5 font-nunito font-black text-[15px] disabled:opacity-50"
      >
        {saving ? 'Saving…' : `Save · +${task.pointsValue} pts ⭐`}
      </button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-md w-full px-4 pt-4 lg:pt-8 pb-32">{children}</div>;
}
