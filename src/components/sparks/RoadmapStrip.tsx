'use client';

import type { Spark } from '@/lib/sparks';

export function RoadmapStrip({ sparks }: { sparks: Spark[] }) {
  const soon     = sparks.filter((s) => s.status === 'soon').slice(0, 3);
  const building = sparks.filter((s) => s.status === 'building').slice(0, 3);
  const released = sparks
    .filter((s) => s.status === 'live' || s.status === 'reward')
    .sort((a, b) => (b.shippedAt ?? 0) - (a.shippedAt ?? 0))
    .slice(0, 3);

  return (
    <div className="bg-white rounded-[20px] px-[18px] py-4 border border-[rgba(15,31,68,0.08)] mb-5 relative z-[1]">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-display font-bold text-base text-[#0F1F44] m-0 flex items-center gap-2">
          🗺 Roadmap at a glance
          <span className="text-[11px] text-[#6E7791] font-semibold">— pipeline view, updated when admin toggles status</span>
        </h4>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        <Column emoji="🔮" title="Coming Soon" count={soon.length} items={soon} subtitle={(s) => s.comingSoonTargetWindow ? `Target: ${s.comingSoonTargetWindow}` : 'No date yet'} />
        <Column emoji="🛠"  title="Building Now" count={building.length} items={building} subtitle={() => 'In flight'} />
        <Column emoji="✅" title="Just Released" count={released.length} items={released} subtitle={(s) => s.shippedAt ? `Shipped ${relativeShort(s.shippedAt)}` : 'Shipped'} />
      </div>
    </div>
  );
}

function Column({
  emoji, title, count, items, subtitle,
}: {
  emoji: string;
  title: string;
  count: number;
  items: Spark[];
  subtitle: (s: Spark) => string;
}) {
  return (
    <div className="bg-[#FBF7EE] rounded-[14px] p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-extrabold text-[#0F1F44] uppercase tracking-wider flex items-center gap-1.5">
          {emoji} {title}
        </div>
        <div className="text-[11px] bg-white px-2 py-0.5 rounded-full font-bold text-[#0F1F44] border border-[rgba(15,31,68,0.08)]">{count}</div>
      </div>
      {items.length === 0 && <div className="text-[11px] text-[#6E7791] py-1">Nothing here yet.</div>}
      {items.map((s, idx) => (
        <div
          key={s.id}
          className={`text-[12px] text-[#0F1F44] py-1.5 font-semibold ${idx < items.length - 1 ? 'border-b border-dashed border-[rgba(15,31,68,0.08)]' : ''}`}
        >
          {s.title}
          <small className="block text-[10px] text-[#6E7791] font-semibold uppercase tracking-wider mt-0.5">{subtitle(s)}</small>
        </div>
      ))}
    </div>
  );
}

function relativeShort(ms: number): string {
  const diff = Date.now() - ms;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'today';
  if (diff < 7 * day) return `${Math.round(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.round(diff / (7 * day))}w ago`;
  return `${Math.round(diff / (30 * day))}mo ago`;
}
