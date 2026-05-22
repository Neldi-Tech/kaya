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
import { useKidMyDay, type MyDayItem, type MyDayPeriod } from '@/lib/myDay';
import { ChevronRight } from 'lucide-react';

const JOY = { purple: '#9B5DE5', green: '#6BCB77', coral: '#FF6B6B', yellow: '#FFD93D', ink: '#2D1B5E', border: '#F0E8FF' };

const PERIOD_LABEL: Record<MyDayPeriod, string> = {
  morning: '☀️ Morning',
  anytime: '⏰ Anytime',
  evening: '🌙 Evening',
};

export default function MyDayPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const role = profile?.role;

  // Phase 3 is kid-only. Parent/helper My Day arrives in Phase 4.
  useEffect(() => {
    if (role && role !== 'kid') router.replace(role === 'helper' ? '/helper' : '/home');
  }, [role, router]);

  if (!family || !profile || role !== 'kid' || !profile.childId) return null;

  const me = children.find((c) => c.id === profile.childId);
  const name = (me?.name ?? profile.displayName ?? 'friend').split(' ')[0];

  return (
    <MyDayKid familyId={family.id} childId={profile.childId} userUid={profile.uid} name={name} />
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
