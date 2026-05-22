'use client';

// Kaya Business · Parent Console (parent screens 1 + 2). Family grid (every
// kid × their businesses, month profit at a glance) + the business approvals
// queue. Approvals read from the ONE unified queue filtered to module:'business'
// — resolved ones are retained as the family's business approval history.
// Matching/capital + audit/export (parent screens 3 + 4) are Phase 2.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  Business, DisplayRounding, subscribeToFamilyBusinesses, subscribeToBusinessRequests, resolveBusinessRequest,
  readBusinessConfig, setBusinessConfig, getKidWeeklyEffort, suggestedWeeklyHp,
} from '@/lib/business';
import { ApprovalRequest } from '@/lib/hive';
import { giveAward, Child } from '@/lib/firestore';
import { formatCash } from '@/components/hive/format';
import { formatWorth, ROUNDING_LABEL } from '@/components/business/money';
import { typeMeta, STATUS_META } from '@/components/business/meta';

export default function ParentBusinessConsolePage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const { config } = useHive();
  const bizConfig = readBusinessConfig(family);

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);

  // Parent-only surface.
  useEffect(() => {
    if (profile && profile.role !== 'parent') router.replace('/business');
  }, [profile, router]);

  const familyId = profile?.familyId;
  useEffect(() => {
    if (!familyId) return;
    const u1 = subscribeToFamilyBusinesses(familyId, setBusinesses);
    const u2 = subscribeToBusinessRequests(familyId, setRequests);
    return () => { u1(); u2(); };
  }, [familyId]);

  const byKid = useMemo(() => {
    const map = new Map<string, Business[]>();
    for (const b of businesses) {
      const arr = map.get(b.ownerId) || [];
      arr.push(b);
      map.set(b.ownerId, arr);
    }
    return map;
  }, [businesses]);

  const pending = requests.filter((r) => r.status === 'pending');
  const history = requests.filter((r) => r.status !== 'pending').slice(0, 12);

  const activeCount = businesses.filter((b) => b.status === 'active').length;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 font-lato text-hive-navy">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Parent · Kaya Business</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1">Family console</h1>
          <p className="text-[13px] text-hive-muted mt-1">
            {children.length} {children.length === 1 ? 'kid' : 'kids'} · {activeCount} active
            {pending.length > 0 ? ` · ${pending.length} pending` : ''}
          </p>
        </div>
        <Link href="/business" className="shrink-0 text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
          Portfolio →
        </Link>
      </div>

      {/* House Points for stock-take effort — parent reviews weekly, or auto. */}
      <HpAwardSettings familyId={familyId!} hpAward={bizConfig.hpAward} />

      {/* How worth/value numbers are shown — readability vs precision. */}
      <DisplayRoundingSettings familyId={familyId!} value={bizConfig.displayRounding} currency={config.currency} />

      {/* Approvals first — the thing a parent comes here to do. */}
      <h2 className="font-nunito font-extrabold text-[14px] mb-2">Approvals</h2>
      {pending.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center mb-6">
          <div className="text-3xl mb-1.5">📭</div>
          <p className="text-hive-muted text-[13px]">Nothing waiting. New launch requests show up here in real time.</p>
        </div>
      ) : (
        <div className="space-y-3 mb-6">
          {pending.map((r) => (
            <ApprovalRow key={r.id} req={r} kidName={children.find((c) => c.id === r.kidId)?.name} familyId={familyId!} approverUid={profile!.uid} />
          ))}
        </div>
      )}

      {/* Family grid */}
      <h2 className="font-nunito font-extrabold text-[14px] mb-2">Family grid</h2>
      {businesses.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center mb-6">
          <div className="text-3xl mb-1.5">🌱</div>
          <p className="text-hive-muted text-[13px]">No businesses yet. Start one from a kid&apos;s Portfolio.</p>
        </div>
      ) : (
        <div className="space-y-3 mb-6">
          {children.map((kid) => {
            const list = byKid.get(kid.id) || [];
            if (list.length === 0) return null;
            const monthProfit = list.reduce((s, b) => s + (b.stats?.monthProfitCents ?? 0), 0);
            return (
              <div key={kid.id} className="bg-hive-paper border border-hive-line rounded-hive p-4">
                <div className="flex items-center justify-between mb-1.5">
                  <h3 className="font-nunito font-extrabold text-[15px]">{kid.avatarEmoji} {kid.name}</h3>
                  <span className={`text-[11px] font-nunito font-black px-2.5 py-1 rounded-hive-pill ${monthProfit > 0 ? 'bg-[#E2F0E2] text-[#2F7D32]' : 'bg-hive-cream text-hive-muted'}`}>
                    {monthProfit > 0 ? `+${formatCash(monthProfit, config.currency)}` : 'this month'}
                  </span>
                </div>
                {list.map((b) => {
                  const t = typeMeta(b.type);
                  const s = STATUS_META[b.status];
                  return (
                    <Link key={b.id} href={`/business/${b.id}`} className="flex items-center justify-between py-2 border-b border-dashed border-hive-line last:border-0 no-underline text-hive-navy">
                      <span className="text-[13px] flex items-center gap-1.5 min-w-0">
                        <span>{t.emoji}</span>
                        <span className="truncate">{b.name}</span>
                        <span className={`text-[10px] font-nunito font-black px-1.5 py-0.5 rounded-hive-pill ${s.pill}`}>{s.label}</span>
                      </span>
                      <span className="font-nunito font-extrabold text-[13px] shrink-0 ml-2">
                        {(b.stats?.monthProfitCents ?? 0) > 0 ? `+${formatCash(b.stats.monthProfitCents, config.currency)}` : '—'}
                      </span>
                    </Link>
                  );
                })}
                <KidWeeklyAward familyId={familyId!} kid={kid} hpAward={bizConfig.hpAward} awarder={profile!} />
              </div>
            );
          })}
        </div>
      )}

      {/* Approval history (retained) */}
      {history.length > 0 && (
        <>
          <h2 className="font-nunito font-extrabold text-[14px] mb-2">History</h2>
          <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-8">
            {history.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-dashed border-hive-line last:border-0 text-[12.5px]">
                <span className="text-hive-navy/80 min-w-0 truncate">
                  {children.find((c) => c.id === r.kidId)?.name || 'Kid'} · {r.description}
                </span>
                <span className={`shrink-0 ml-2 text-[11px] font-nunito font-black px-2 py-0.5 rounded-hive-pill ${r.status === 'approved' ? 'bg-[#E2F0E2] text-[#2F7D32]' : 'bg-hive-cream text-hive-muted'}`}>
                  {r.status === 'approved' ? 'Approved' : 'Declined'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ApprovalRow({ req, kidName, familyId, approverUid }: { req: ApprovalRequest; kidName?: string; familyId: string; approverUid: string }) {
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [showDeny, setShowDeny] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const act = async (decision: 'approved' | 'rejected') => {
    setError('');
    setBusy(decision === 'approved' ? 'approve' : 'deny');
    try {
      await resolveBusinessRequest(familyId, req.id, decision, approverUid, decision === 'rejected' ? reason : undefined);
    } catch (e: any) {
      setError(e?.message || 'Could not resolve.');
      setBusy(null);
    }
  };

  return (
    <div className="bg-hive-paper border-2 border-hive-honey/50 rounded-hive-lg p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-[12px] bg-hive-honey-soft text-hive-honey-dk flex items-center justify-center text-xl shrink-0">{req.type === 'investment_buy' ? '📈' : '🚀'}</div>
        <div className="flex-1 min-w-0">
          <p className="font-nunito font-extrabold text-[13px]">{req.type === 'investment_buy' ? 'Investment buy' : 'Launch request'}</p>
          <p className="text-[12.5px] text-hive-navy mt-0.5 leading-snug">{req.description}</p>
          <p className="text-[11px] text-hive-muted mt-1">For <strong className="text-hive-navy">{kidName || 'unknown kid'}</strong></p>
          {req.aiContext && <p className="text-[11px] text-hive-muted mt-1 italic">AI: {req.aiContext}</p>}
        </div>
      </div>
      {!showDeny ? (
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => act('approved')} disabled={!!busy}
            className="flex-1 h-10 rounded-hive-pill bg-[#2F7D32] text-white font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-110 transition">
            {busy === 'approve' ? 'Approving…' : '✓ Approve'}
          </button>
          <button onClick={() => setShowDeny(true)} disabled={!!busy}
            className="h-10 px-4 rounded-hive-pill bg-[#FCEAEA] text-hive-rose font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-95 transition">
            Decline
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional, kid sees this)" maxLength={120}
            className="w-full h-10 px-3 bg-hive-cream rounded-hive-pill text-[13px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-rose/40" autoFocus />
          <div className="flex gap-2">
            <button onClick={() => act('rejected')} disabled={!!busy}
              className="flex-1 h-10 rounded-hive-pill bg-hive-rose text-white font-nunito font-black text-[13px] disabled:opacity-40 transition">
              {busy === 'deny' ? 'Declining…' : 'Confirm decline'}
            </button>
            <button onClick={() => { setShowDeny(false); setReason(''); }} disabled={!!busy}
              className="h-10 px-4 rounded-hive-pill bg-hive-cream text-hive-muted font-nunito font-extrabold text-[12px]">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-hive-rose text-[12px] font-bold mt-2">{error}</p>}
    </div>
  );
}

// ── House Points for effort — family policy (parent reviews vs auto) ──
function HpAwardSettings({ familyId, hpAward }: {
  familyId: string;
  hpAward: { mode: 'parent_review' | 'auto'; perDayHp: number; weeklyCapHp: number };
}) {
  const [mode, setMode] = useState(hpAward.mode);
  const [perDay, setPerDay] = useState(String(hpAward.perDayHp));
  const [cap, setCap] = useState(String(hpAward.weeklyCapHp));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await setBusinessConfig(familyId, { hpAward: {
        mode, perDayHp: Math.max(0, parseInt(perDay) || 0), weeklyCapHp: Math.max(0, parseInt(cap) || 0),
      } });
      setSaved(true);
    } finally { setSaving(false); }
  };

  const seg = (active: boolean) =>
    `flex-1 h-9 rounded-hive-pill text-[12px] font-nunito font-extrabold border transition ${active ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-hive-paper text-hive-muted border-hive-line'}`;

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-nunito font-extrabold text-[14px]">House Points for effort</h2>
        <span className="text-[11px] text-hive-muted">pick what&apos;s simplest</span>
      </div>
      <div className="flex gap-2 mb-2">
        <button onClick={() => { setMode('parent_review'); setSaved(false); }} className={seg(mode === 'parent_review')}>Parent reviews weekly</button>
        <button onClick={() => { setMode('auto'); setSaved(false); }} className={seg(mode === 'auto')}>Auto-award</button>
      </div>
      {mode === 'auto' ? (
        <div className="bg-hive-cream rounded-hive p-3 text-[12.5px] text-hive-navy/80">
          Kids earn HP automatically each week from their stock-take days — no tap needed.
          <div className="flex gap-3 mt-2">
            <label className="flex-1 text-[11px] font-nunito font-bold">HP / day
              <input value={perDay} onChange={(e) => { setPerDay(e.target.value); setSaved(false); }} inputMode="numeric" className="w-full h-9 px-2 mt-0.5 bg-white rounded-hive border border-hive-line text-[13px]" /></label>
            <label className="flex-1 text-[11px] font-nunito font-bold">Weekly cap
              <input value={cap} onChange={(e) => { setCap(e.target.value); setSaved(false); }} inputMode="numeric" className="w-full h-9 px-2 mt-0.5 bg-white rounded-hive border border-hive-line text-[13px]" /></label>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-hive-muted">You award HP each week from the effort summary on each kid below.</p>
      )}
      <button onClick={save} disabled={saving} className="w-full mt-3 h-10 rounded-hive-pill bg-hive-navy text-hive-honey font-nunito font-black text-[12.5px] disabled:opacity-40">
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save policy'}
      </button>
    </div>
  );
}

// ── Per-kid weekly HP award (manual; loads effort on tap) ──
function KidWeeklyAward({ familyId, kid, hpAward, awarder }: {
  familyId: string;
  kid: Child;
  hpAward: { perDayHp: number; weeklyCapHp: number };
  awarder: { uid: string; displayName?: string };
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(0);
  const [points, setPoints] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const openPanel = async () => {
    setOpen(true); setLoading(true); setDone(false);
    try {
      const eff = await getKidWeeklyEffort(familyId, kid.id);
      setDays(eff.stockTakeDays);
      setPoints(String(suggestedWeeklyHp(eff.stockTakeDays, hpAward.perDayHp, hpAward.weeklyCapHp)));
    } finally { setLoading(false); }
  };

  const award = async () => {
    const pts = Math.max(0, parseInt(points) || 0);
    if (pts <= 0) { setOpen(false); return; }
    setBusy(true);
    try {
      await giveAward(familyId, {
        childId: kid.id, kind: 'regular', points: pts,
        reason: `Kaya Business — stock-take effort this week (${days} ${days === 1 ? 'day' : 'days'})`,
        category: 'business', awardedBy: awarder.uid, awardedByName: awarder.displayName || 'Parent',
        senderRole: 'parent',
      });
      setDone(true); setOpen(false);
    } finally { setBusy(false); }
  };

  if (done) return <p className="mt-2 text-[12px] font-nunito font-bold text-[#2F7D32]">✓ House Points awarded</p>;
  if (!open) {
    return (
      <button onClick={openPanel} className="mt-2 text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">🏅 Award weekly HP</button>
    );
  }
  return (
    <div className="mt-2 bg-hive-cream rounded-hive p-3">
      {loading ? (
        <p className="text-[12px] text-hive-muted">Reading this week&apos;s effort…</p>
      ) : (
        <>
          <p className="text-[12px] text-hive-navy/80 mb-2">{days} stock-take {days === 1 ? 'day' : 'days'} this week · suggested {suggestedWeeklyHp(days, hpAward.perDayHp, hpAward.weeklyCapHp)} HP</p>
          <div className="flex items-center gap-2">
            <input value={points} onChange={(e) => setPoints(e.target.value)} inputMode="numeric" className="w-20 h-9 px-2 bg-white rounded-hive border border-hive-line text-[13px] text-center" />
            <span className="text-[12px] text-hive-muted">HP</span>
            <button onClick={award} disabled={busy} className="flex-1 h-9 rounded-hive-pill bg-[#2F7D32] text-white font-nunito font-black text-[12px] disabled:opacity-40">{busy ? 'Awarding…' : 'Award'}</button>
            <button onClick={() => setOpen(false)} className="text-hive-muted text-[12px]">✕</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Number style — how worth/value numbers round (kid readability) ──
function DisplayRoundingSettings({ familyId, value, currency }: { familyId: string; value: DisplayRounding; currency: string }) {
  const [mode, setMode] = useState<DisplayRounding>(value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const SAMPLE = 50011420; // $500,114.20 in cents — the example you flagged
  const opts: DisplayRounding[] = ['exact', 'whole', 'ten', 'hundred'];
  const save = async () => {
    setSaving(true); setSaved(false);
    try { await setBusinessConfig(familyId, { displayRounding: mode }); setSaved(true); }
    finally { setSaving(false); }
  };
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-nunito font-extrabold text-[14px]">Number style</h2>
        <span className="text-[11px] text-hive-muted">how worth is shown to kids</span>
      </div>
      <div className="grid grid-cols-4 gap-2 mb-2">
        {opts.map((o) => (
          <button key={o} onClick={() => { setMode(o); setSaved(false); }}
            className={`h-9 rounded-hive-pill text-[11.5px] font-nunito font-extrabold border transition ${mode === o ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-hive-paper text-hive-muted border-hive-line'}`}>
            {ROUNDING_LABEL[o]}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-hive-muted">Preview: <span className="font-nunito font-extrabold text-hive-navy">{formatWorth(SAMPLE, currency, mode)}</span> <span className="opacity-60">· prices &amp; sales always show exact</span></p>
      <button onClick={save} disabled={saving || mode === value}
        className="w-full mt-3 h-10 rounded-hive-pill bg-hive-navy text-hive-honey font-nunito font-black text-[12.5px] disabled:opacity-40">
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save number style'}
      </button>
    </div>
  );
}
