'use client';

// /my-day — the kid's one place for everything that needs them today:
// Workplan + Pulse readings (Do), pending requests + reminders (Heads-up),
// finished things (Done). Aggregator only — each module owns its data
// (see lib/myDay.ts). Phase 3 of "My Day + Kids' Workplan"; parent +
// helper My Day land in Phase 4, and Phase 5 promotes this to Home.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import BackButton from '@/components/ui/BackButton';
import TodaysWorkplanCard from '@/components/helpers/TodaysWorkplanCard';
import { useKidMyDay, useParentMyDay, useReminders, type MyDayItem, type MyDayPeriod } from '@/lib/myDay';
import { addKidWorkplanItem } from '@/lib/kidWorkplan';
import { addAdhocWorkplanItem, todayDateString } from '@/lib/workplan';
import { listHelpers } from '@/lib/helpers';
import type { WorkplanPeriod } from '@/lib/firestore';
import { ChevronRight, Plus } from 'lucide-react';

const JOY = { purple: '#9B5DE5', green: '#6BCB77', coral: '#FF6B6B', yellow: '#FFD93D', ink: '#2D1B5E', border: '#F0E8FF' };

const PERIOD_LABEL: Record<MyDayPeriod, string> = {
  morning: '☀️ Morning',
  anytime: '⏰ Anytime',
  evening: '🌙 Evening',
};

export default function MyDayPage() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const role = profile?.role;

  if (!family || !profile) return null;

  if (role === 'kid') {
    if (!profile.childId) return null;
    const me = children.find((c) => c.id === profile.childId);
    const name = (me?.name ?? profile.displayName ?? 'friend').split(' ')[0];
    return <MyDayKid familyId={family.id} childId={profile.childId} userUid={profile.uid} name={name} />;
  }

  if (role === 'helper') {
    const first = (profile.displayName ?? 'there').split(' ')[0];
    return <MyDayHelper familyId={family.id} uid={profile.uid} name={first} />;
  }

  // Parent
  const first = (profile.displayName ?? 'there').split(' ')[0];
  return (
    <MyDayParent
      familyId={family.id}
      parentUid={profile.uid}
      name={first}
      kids={children.map((c) => ({ id: c.id, name: c.name }))}
      currency={family.hiveConfig?.currency ?? 'TZS'}
    />
  );
}

function MyDayKid({ familyId, childId, userUid, name }: {
  familyId: string; childId: string; userUid: string; name: string;
}) {
  const { loading, doItems, headsUp, doneItems, total, doneCount, pct, tickWorkplan } =
    useKidMyDay(familyId, childId, userUid);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  const allDone = total > 0 && doneCount === total;

  const onTap = async (item: MyDayItem) => {
    if (item.tickItemId) {
      setBusy(item.id);
      try { await tickWorkplan(item.tickItemId, !item.done); }
      finally { setBusy(null); }
      return;
    }
    if (item.href) router.push(item.href);
  };

  const Row = ({ item }: { item: MyDayItem }) => {
    const tappable = !!item.tickItemId || !!item.href;
    return (
      <button
        type="button"
        disabled={!tappable || busy === item.id}
        onClick={() => onTap(item)}
        className={`w-full flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition-all ${
          item.done ? 'bg-[#F1FBF2] border-[#6BCB77]' : 'bg-white border-[#F0E8FF]'
        } ${tappable ? 'hover:shadow-sm active:scale-[0.99]' : 'cursor-default'} ${busy === item.id ? 'opacity-60' : ''}`}
      >
        {/* check bubble for tickable workplan rows; icon chip otherwise */}
        {item.tickItemId ? (
          <span
            className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 text-[14px] font-black"
            style={{ background: item.done ? JOY.green : '#fff', border: `2px solid ${item.done ? JOY.green : JOY.purple}`, color: item.done ? '#fff' : 'transparent' }}
          >✓</span>
        ) : (
          <span className="text-2xl flex-shrink-0" aria-hidden>{item.icon}</span>
        )}
        {item.tickItemId && <span className="text-2xl flex-shrink-0" aria-hidden>{item.icon}</span>}
        <span className="min-w-0 flex-1">
          <span className={`block font-extrabold text-[13px] leading-tight ${item.done ? 'line-through text-[#5C6975]' : ''}`} style={item.done ? {} : { color: JOY.ink }}>
            {item.label}
          </span>
          <span className="block text-[10px] font-bold mt-0.5" style={{ color: item.accent ?? '#5C6975' }}>
            {item.accent && <span className="inline-block w-2 h-2 rounded-full align-middle mr-1" style={{ background: item.accent }} />}
            {item.sublabel}
          </span>
        </span>
        {item.time && !item.done && (
          <span className="text-[10px] font-black flex-shrink-0" style={{ color: JOY.purple }}>{fmtTime(item.time)}</span>
        )}
        {item.badge && (
          <span
            className="flex-shrink-0 text-[10px] font-black px-2 py-1 rounded-lg"
            style={badgeStyle(item)}
          >{item.badge}</span>
        )}
        {item.href && !item.done && <ChevronRight size={15} className="flex-shrink-0" style={{ color: '#B9AFC9' }} />}
      </button>
    );
  };

  const doByPeriod: MyDayPeriod[] = ['morning', 'anytime', 'evening'];

  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4 pb-32">
      <div className="lg:hidden"><BackButton /></div>

      {/* Hero */}
      <div className="rounded-2xl p-4 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${JOY.purple}, ${JOY.coral})` }}>
        <p className="text-[10px] font-black uppercase tracking-[2px] opacity-90">My Day</p>
        <div className="flex items-center justify-between gap-3 mt-0.5">
          <div className="min-w-0">
            <p className="font-black text-[18px] leading-tight">{allDone ? '🎉 All done!' : `Habari, ${name} 👋`}</p>
            <p className="text-[12px] font-bold opacity-90 mt-0.5">{today} · {total > 0 ? `${doneCount} of ${total} done` : 'nothing to do yet'}</p>
          </div>
          {total > 0 && (
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 font-black text-[16px] flex-shrink-0 border-2 border-white/40">{pct}%</div>
          )}
        </div>
        {total > 0 && (
          <div className="mt-3 h-2.5 w-full rounded-full bg-white/25 overflow-hidden">
            <div className="h-full rounded-full bg-white transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-center text-sm font-extrabold py-8" style={{ color: JOY.purple }}>Loading your day…</p>
      ) : (
        <>
          {/* Do */}
          {doByPeriod.map((p) => {
            const rows = doItems.filter((i) => i.period === p);
            if (rows.length === 0) return null;
            return (
              <div key={p} className="mb-4">
                <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: JOY.ink }}>{PERIOD_LABEL[p]}</p>
                <div className="space-y-2">{rows.map((i) => <Row key={i.id} item={i} />)}</div>
              </div>
            );
          })}

          {/* Heads-up */}
          {headsUp.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: JOY.ink }}>📨 Heads-up</p>
              <div className="space-y-2">{headsUp.map((i) => <Row key={i.id} item={i} />)}</div>
            </div>
          )}

          {/* Done */}
          {doneItems.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: JOY.green }}>✓ Done · {doneItems.length}</p>
              <div className="space-y-2 opacity-80">{doneItems.map((i) => <Row key={i.id} item={i} />)}</div>
            </div>
          )}

          {/* Empty */}
          {doItems.length === 0 && headsUp.length === 0 && doneItems.length === 0 && (
            <div className="rounded-2xl bg-white border-2 border-dashed border-[#F0E8FF] p-8 text-center">
              <div className="text-4xl mb-2">🌈</div>
              <p className="font-extrabold text-[15px]" style={{ color: JOY.ink }}>Nothing on your plate</p>
              <p className="text-[12px] text-[#5C6975] mt-1">Tasks, readings &amp; reminders will show up here.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function fmtTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m[2]} ${ampm}`;
}

function badgeStyle(item: MyDayItem): React.CSSProperties {
  if (item.done) return { background: '#E3F2E6', color: JOY.green };
  if (item.badge === 'Log') return { background: `linear-gradient(135deg, ${JOY.purple}, #6A4FCF)`, color: '#fff' };
  if (item.badge === 'pending') return { background: '#EEF3FB', color: '#264B6E' };
  if (item.badge === 'reminder') return { background: '#EEF3FB', color: '#264B6E' };
  if (item.badge === 'missed') return { background: '#FDE6E6', color: JOY.coral };
  if (item.points) return { background: `linear-gradient(135deg, ${JOY.purple}, #6A4FCF)`, color: '#fff' };
  return { background: '#F0E8FF', color: JOY.ink };
}

/* ============================================================
   HELPER + PARENT — premium (navy/gold) My Day
   ============================================================ */
const NAVY = '#0F1F44';
const GOLD = '#D4A847';

function premiumBadge(b?: string): React.CSSProperties {
  if (b === 'approve') return { background: NAVY, color: GOLD };
  if (b === 'close') return { background: '#FFF3D9', color: '#B58A2F' };
  if (b === 'reminder') return { background: '#EEF3FB', color: '#264B6E' };
  if (b === 'pending') return { background: '#EEF3FB', color: '#264B6E' };
  return { background: '#F0EBE0', color: '#5C6975' };
}

function PremiumRow({ item, onTap }: { item: MyDayItem; onTap: (i: MyDayItem) => void }) {
  const tappable = !!item.href;
  return (
    <button
      type="button"
      disabled={!tappable}
      onClick={() => onTap(item)}
      className={`w-full flex items-center gap-3 rounded-hive-lg border p-3 text-left ${
        item.done ? 'bg-green-50 border-green-200' : 'bg-hive-paper border-hive-line'
      } ${tappable ? 'hover:bg-hive-cream/40' : 'cursor-default'}`}
    >
      <span className="text-2xl flex-shrink-0" aria-hidden>{item.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-nunito font-extrabold text-[13px] truncate">{item.label}</span>
        <span className="block text-[11px] text-hive-muted truncate">{item.sublabel}</span>
      </span>
      {(() => {
        const a = approvalAge(item.createdAtMs);
        if (!a) return null;
        return (
          <span
            className="flex-shrink-0 text-[9px] font-black px-1.5 py-1 rounded-lg"
            style={a.over ? { background: '#fde6e6', color: '#E85C5C' } : { background: '#F0EBE0', color: '#5C6975' }}
          >
            ⏱ {a.label}
          </span>
        );
      })()}
      {item.badge && (
        <span className="flex-shrink-0 text-[10px] font-black px-2 py-1 rounded-lg uppercase tracking-wide" style={premiumBadge(item.badge)}>
          {item.badge}
        </span>
      )}
      {tappable && <ChevronRight size={15} className="text-hive-muted flex-shrink-0" />}
    </button>
  );
}

/** Days an approval has been waiting + whether it's past the 48h
 *  standard (→ red). Only approval rows carry createdAtMs. */
function approvalAge(createdAtMs?: number): { label: string; over: boolean } | null {
  if (!createdAtMs) return null;
  const hrs = (Date.now() - createdAtMs) / 3600000;
  const days = Math.floor(hrs / 24);
  return { label: days >= 1 ? `${days}d` : 'today', over: hrs >= 48 };
}

function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Map an optional clock time to a helper Workplan period (helpers use
 *  morning/anytime/evening buckets, not a clock anchor). */
function timeToPeriod(hhmm: string): WorkplanPeriod {
  const h = parseInt(hhmm.split(':')[0] ?? '', 10);
  if (Number.isNaN(h)) return 'anytime';
  if (h < 12) return 'morning';
  if (h < 17) return 'anytime';
  return 'evening';
}

function MyDayHelper({ familyId, uid, name }: { familyId: string; uid: string; name: string }) {
  const router = useRouter();
  const reminders = useReminders(familyId, uid);
  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4 pb-32">
      <div className="lg:hidden"><BackButton /></div>
      <div className="rounded-hive-lg p-4 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, #1c3566)` }}>
        <p className="text-[10px] font-black uppercase tracking-[2px]" style={{ color: GOLD }}>My Day</p>
        <p className="font-nunito font-black text-[18px] leading-tight mt-0.5">Habari, {name}</p>
        <p className="text-[12px] font-bold opacity-80 mt-0.5">{todayLabel()} · your work + readings, one place</p>
      </div>

      {/* Do — workplan + Pulse readings, with combined % (reused card) */}
      <TodaysWorkplanCard familyId={familyId} helperUid={uid} />

      {/* Heads-up */}
      {reminders.length > 0 && (
        <div className="mt-1">
          <p className="text-[10px] font-black uppercase tracking-wider mb-2 text-hive-navy">📨 Heads-up</p>
          <div className="space-y-2">
            {reminders.map((i) => <PremiumRow key={i.id} item={i} onTap={(x) => x.href && router.push(x.href)} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function MyDayParent({ familyId, parentUid, name, kids, currency }: {
  familyId: string;
  parentUid: string;
  name: string;
  kids: { id: string; name: string }[];
  currency: string;
}) {
  const router = useRouter();
  const { loading, approve, headsUp, glance, glanceDone, glanceTotal, approveCount } =
    useParentMyDay(familyId, parentUid, kids, currency);
  const onTap = (i: MyDayItem) => { if (i.href) router.push(i.href); };

  // Quick "add a task" — drop a one-off (today) onto a kid or helper
  // straight from My Day; refine recurrence/points later in the full
  // editors. Kids → addKidWorkplanItem (adhoc); helpers → addAdhocWorkplanItem.
  const [helpers, setHelpers] = useState<{ uid: string; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    listHelpers(familyId)
      .then((hs) => { if (alive) setHelpers(hs.filter((h) => h.status !== 'removed').map((h) => ({ uid: h.uid, name: h.displayName || 'Helper' }))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [familyId]);

  const [addOpen, setAddOpen] = useState(false);
  const [target, setTarget] = useState<{ type: 'kid' | 'helper'; id: string; name: string } | null>(null);
  const [taskLabel, setTaskLabel] = useState('');
  const [taskEmoji, setTaskEmoji] = useState('');
  const [taskTime, setTaskTime] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addFlash, setAddFlash] = useState<string | null>(null);

  const submitQuickTask = async () => {
    if (!target || !taskLabel.trim() || addBusy) return;
    setAddBusy(true);
    const label = taskLabel.trim();
    const icon = taskEmoji.trim() || '⭐';
    const today = todayDateString();
    try {
      if (target.type === 'kid') {
        await addKidWorkplanItem(familyId, target.id, {
          label, icon, category: 'other', daysOfWeek: [], active: true,
          createdBy: parentUid, kind: 'adhoc', scheduledDates: [today],
          ...(taskTime ? { timeLocal: taskTime } : {}),
        });
      } else {
        await addAdhocWorkplanItem(familyId, target.id, {
          label, icon,
          period: taskTime ? timeToPeriod(taskTime) : 'anytime',
          scheduledDates: [today],
          assignedBy: parentUid,
        });
      }
      setAddFlash(`Added “${label}” to ${target.name}'s day`);
      setTimeout(() => setAddFlash(null), 3500);
      setTarget(null); setTaskLabel(''); setTaskEmoji(''); setTaskTime('');
      setAddOpen(false);
    } catch {
      setAddFlash('Could not add — try again.');
      setTimeout(() => setAddFlash(null), 3500);
    } finally { setAddBusy(false); }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>

      {/* Hero */}
      <div className="rounded-hive-lg p-4 mb-4 text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, #1c3566)` }}>
        <p className="text-[10px] font-black uppercase tracking-[2px]" style={{ color: GOLD }}>My Day</p>
        <div className="flex items-end justify-between gap-3 mt-0.5">
          <div>
            <p className="font-nunito font-black text-[18px] leading-tight">Hello, {name}</p>
            <p className="text-[12px] font-bold opacity-80 mt-0.5">{todayLabel()} · {approveCount > 0 ? `${approveCount} need${approveCount === 1 ? 's' : ''} you` : 'all caught up'}</p>
          </div>
          {approveCount > 0 && (
            <div className="text-right">
              <p className="font-nunito font-black text-[26px] leading-none" style={{ color: GOLD }}>{approveCount}</p>
              <p className="text-[9px] font-bold uppercase tracking-wide opacity-80">to approve</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick add — assign a one-off task to a kid or helper, today */}
      {addFlash && (
        <div className="mb-3 rounded-hive bg-green-50 border border-green-300 text-green-800 text-[12px] font-extrabold px-3 py-2">✓ {addFlash}</div>
      )}
      {addOpen ? (
        <div className="rounded-hive-lg border-2 p-3 mb-4" style={{ borderColor: GOLD, background: '#FFFDF7' }}>
          <p className="font-nunito font-black text-[13px] mb-2" style={{ color: NAVY }}>Add a task for today</p>
          <p className="text-[10px] font-black uppercase tracking-wider text-hive-muted mb-1">Who</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {kids.map((k) => {
              const on = target?.type === 'kid' && target.id === k.id;
              return (
                <button key={`k-${k.id}`} type="button"
                  onClick={() => setTarget({ type: 'kid', id: k.id, name: k.name })}
                  className={`text-[12px] font-bold rounded-hive-pill px-3 py-1.5 border ${on ? 'text-white border-transparent' : 'bg-white border-hive-line text-hive-navy'}`}
                  style={on ? { background: NAVY } : {}}>🧒 {k.name}</button>
              );
            })}
            {helpers.map((h) => {
              const on = target?.type === 'helper' && target.id === h.uid;
              return (
                <button key={`h-${h.uid}`} type="button"
                  onClick={() => setTarget({ type: 'helper', id: h.uid, name: h.name })}
                  className={`text-[12px] font-bold rounded-hive-pill px-3 py-1.5 border ${on ? 'text-white border-transparent' : 'bg-white border-hive-line text-hive-navy'}`}
                  style={on ? { background: NAVY } : {}}>🤝 {h.name}</button>
              );
            })}
            {kids.length === 0 && helpers.length === 0 && (
              <span className="text-[11px] text-hive-muted">No kids or helpers yet.</span>
            )}
          </div>
          <div className="flex gap-2 mb-2">
            <input value={taskEmoji} onChange={(e) => setTaskEmoji(e.target.value)} placeholder="⭐" maxLength={2}
              className="w-12 text-center rounded-hive border border-hive-line px-2 py-2 text-[16px]" aria-label="Emoji" />
            <input value={taskLabel} onChange={(e) => setTaskLabel(e.target.value)} placeholder="e.g. Tidy the playroom"
              className="flex-1 min-w-0 rounded-hive border border-hive-line px-3 py-2 text-[13px] font-bold" aria-label="Task" />
            <input value={taskTime} onChange={(e) => setTaskTime(e.target.value)} type="time"
              className="rounded-hive border border-hive-line px-2 py-2 text-[12px]" aria-label="Time (optional)" />
          </div>
          <p className="text-[10px] text-hive-muted mb-3">One-off for <b>today</b>. Set recurrence / points later in the full Workplan editor.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAddOpen(false); setTarget(null); setTaskLabel(''); setTaskEmoji(''); setTaskTime(''); }}
              className="text-[12px] font-bold text-hive-muted px-2">Cancel</button>
            <button onClick={submitQuickTask} disabled={!target || !taskLabel.trim() || addBusy}
              className="h-9 px-4 rounded-hive-pill text-white font-nunito font-extrabold text-[12px] disabled:opacity-50" style={{ background: NAVY }}>
              {addBusy ? 'Adding…' : 'Add task'}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAddOpen(true)}
          className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-hive-lg border-2 border-dashed mb-4 font-nunito font-extrabold text-[12px] hover:bg-hive-cream/40"
          style={{ borderColor: GOLD, color: NAVY }}>
          <Plus size={15} /> Add a task for a kid or helper
        </button>
      )}

      {loading ? (
        <p className="text-center text-[13px] text-hive-muted py-8">Loading…</p>
      ) : (
        <>
          {/* Approve */}
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-wider mb-2 text-hive-navy">✅ Approve</p>
            {approve.length > 0 ? (
              <div className="space-y-2">{approve.map((i) => <PremiumRow key={i.id} item={i} onTap={onTap} />)}</div>
            ) : (
              <div className="rounded-hive-lg border border-hive-line bg-hive-paper p-5 text-center">
                <p className="text-[13px] font-nunito font-extrabold">Nothing waiting 🎉</p>
                <p className="text-[11px] text-hive-muted mt-0.5">Purchase, Hive &amp; Business approvals will land here.</p>
              </div>
            )}
          </div>

          {/* Heads-up */}
          {headsUp.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-black uppercase tracking-wider mb-2 text-hive-navy">📨 Heads-up</p>
              <div className="space-y-2">{headsUp.map((i) => <PremiumRow key={i.id} item={i} onTap={onTap} />)}</div>
            </div>
          )}

          {/* Family glance */}
          {glance.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-black uppercase tracking-wider mb-2 text-hive-navy">
                👀 Family glance{glanceTotal > 0 ? ` · ${glanceDone}/${glanceTotal} tasks done` : ''}
              </p>
              <div className="space-y-2">
                {glance.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => router.push(`/profiles?child=${g.id}`)}
                    className="w-full flex items-center gap-3 rounded-hive-lg border border-hive-line bg-hive-paper p-3 text-left hover:bg-hive-cream/40"
                  >
                    <span className="text-2xl flex-shrink-0" aria-hidden>👦</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-nunito font-extrabold text-[13px] truncate">{g.name}</span>
                      <span className="block text-[11px] text-hive-muted">
                        {g.total > 0 ? `${g.done}/${g.total} workplan tasks today` : 'No tasks today'}
                      </span>
                    </span>
                    {g.total > 0 && (
                      <span className="flex-shrink-0 text-[11px] font-black px-2 py-1 rounded-lg"
                        style={g.done === g.total ? { background: '#E3F2E6', color: '#2E7D34' } : { background: '#FFF3D9', color: '#B58A2F' }}>
                        {Math.round((g.done / g.total) * 100)}%
                      </span>
                    )}
                    <ChevronRight size={15} className="text-hive-muted flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
