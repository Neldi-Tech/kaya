'use client';

// /admin — Closed-beta operator console (2026-05-24). Operator-only:
// manage the early-access allowlist, watch the interest waitlist, add
// teammates, and flip the two runtime switches. Cross-family counts come
// from /api/admin/stats (Admin SDK) since per-family rules block them
// client-side. Gated to operators in firestore.rules AND here.

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { toDisplayDate } from '@/lib/dates';
import {
  getBetaConfig, setBetaFlag, getOperatorRole,
  listAllowlist, addAllowlistEmail, removeAllowlistEmail,
  listOperators, addOperator, removeOperator,
  listWaitlist, getAdminStats, emailKey,
  type BetaConfig, type AllowlistEntry, type OperatorEntry, type WaitlistEntry,
  type OperatorRole, type AdminStats,
} from '@/lib/access';

function fmtMs(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms); // local time — Kaya helpers are worldwide
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return toDisplayDate(iso);
}

export default function AdminPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [role, setRole] = useState<OperatorRole | null | undefined>(undefined); // undefined = checking
  const [config, setConfig] = useState<BetaConfig | null>(null);
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [operators, setOperators] = useState<OperatorEntry[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [newAllow, setNewAllow] = useState('');
  const [newOp, setNewOp] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [cfg, al, ops, wl, st] = await Promise.all([
      getBetaConfig(), listAllowlist(), listOperators(), listWaitlist(), getAdminStats(),
    ]);
    setConfig(cfg); setAllowlist(al); setOperators(ops); setWaitlist(wl); setStats(st);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await getOperatorRole(user?.email);
      if (cancelled) return;
      setRole(r);
      if (!r) { router.replace('/'); return; }
      await refresh();
    })();
    return () => { cancelled = true; };
  }, [user?.email, router, refresh]);

  const toggle = async (flag: keyof BetaConfig) => {
    if (!config) return;
    setBusy(true);
    await setBetaFlag(flag, !config[flag]);
    setConfig({ ...config, [flag]: !config[flag] });
    setBusy(false);
  };

  const addAllow = async () => {
    const e = emailKey(newAllow);
    if (!e) return;
    setBusy(true);
    await addAllowlistEmail(e, user?.email ?? undefined);
    setNewAllow('');
    await refresh();
    setBusy(false);
  };

  const promote = async (email: string) => {
    setBusy(true);
    await addAllowlistEmail(email, user?.email ?? undefined);
    await refresh();
    setBusy(false);
  };

  const addOp = async () => {
    const e = emailKey(newOp);
    if (!e) return;
    setBusy(true);
    await addOperator(e, user?.email ?? undefined);
    setNewOp('');
    await refresh();
    setBusy(false);
  };

  const exportCsv = () => {
    const rows = [
      ['Name', 'Email', 'Country', 'Joined'],
      ...waitlist.map((w) => [w.name, w.email, w.country ?? '', fmtMs(w.createdAt)]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'kaya-waitlist.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const allowSet = new Set(allowlist.map((a) => a.email));

  if (role === undefined) {
    return <div className="min-h-screen flex items-center justify-center bg-kaya-cream"><p className="text-kaya-sand text-sm">Checking access…</p></div>;
  }
  if (!role) return null; // redirecting

  return (
    <div className="min-h-screen bg-kaya-cream pb-16">
      {/* Header + switches */}
      <div className="bg-white border-b border-kaya-warm-dark px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-extrabold text-lg flex items-center gap-2">🛠️ Beta controls</h1>
          <p className="text-xs text-kaya-sand mt-0.5">Operator console · {user?.email} {role === 'owner' && '· owner'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Switch label="Public sign-up" sub={config?.publicSignupOpen ? 'Open to everyone' : 'Paused (beta)'} on={!!config?.publicSignupOpen} danger busy={busy} onClick={() => toggle('publicSignupOpen')} />
          <Switch label="Auto-admit" sub={config?.autoAdmit ? 'Registrants auto-allowed' : 'You hand-pick'} on={!!config?.autoAdmit} busy={busy} onClick={() => toggle('autoAdmit')} />
        </div>
      </div>

      {/* Beta funnel counter */}
      <div className="grid grid-cols-3 bg-white border-b border-kaya-warm-dark">
        <Stat n={stats?.funnel.active} label="Active families" sub="early access · joined" color="#15803d" />
        <Stat n={stats?.funnel.invited} label="Invited" sub="allowlisted · not joined" color="#B8860B" border />
        <Stat n={stats?.funnel.waitlist} label="On waitlist" sub="interested" color="#5b2bd9" border />
      </div>

      {/* Kaya World */}
      <div className="bg-kaya-chocolate text-kaya-gold-light px-5 py-3.5 flex flex-wrap items-center gap-3">
        <span className="font-display font-black text-2xl text-white">🌍 {stats?.world.total ?? '—'}</span>
        <span className="font-display font-bold text-xs text-kaya-gold">people in your Kaya World</span>
        <div className="flex flex-wrap gap-4 ml-auto text-xs text-kaya-sand-light">
          <span><b className="text-white font-display">{stats?.world.parents ?? '—'}</b> parents</span>
          <span><b className="text-white font-display">{stats?.world.kids ?? '—'}</b> kids</span>
          <span><b className="text-white font-display">{stats?.world.helpers ?? '—'}</b> helpers</span>
          <span><b className="text-white font-display">{stats?.world.guests ?? '—'}</b> guests</span>
          <span>across <b className="text-white font-display">{stats?.world.families ?? '—'}</b> families</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 p-4 max-w-5xl mx-auto">
        {/* Allowlist */}
        <section className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
          <h2 className="font-display font-bold text-sm mb-1">✅ Invited testers <span className="text-kaya-sand font-normal">· {allowlist.length}</span></h2>
          <div className="flex gap-2 my-3">
            <input
              value={newAllow}
              onChange={(e) => setNewAllow(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addAllow(); }}
              placeholder="add a parent's email…"
              className="flex-1 h-10 px-3 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
            />
            <button onClick={addAllow} disabled={busy || !newAllow.trim()} className="h-10 px-4 bg-kaya-gold text-white rounded-kaya-sm font-display font-bold text-sm disabled:opacity-50">Invite</button>
          </div>
          <ul className="space-y-2">
            {allowlist.map((a) => (
              <li key={a.email} className="flex items-center justify-between gap-2 border border-kaya-warm-dark rounded-kaya-sm px-3 py-2">
                <div className="min-w-0">
                  <p className="font-display font-bold text-[13px] truncate">{a.email}</p>
                  <p className="text-[11px] text-kaya-sand">{a.auto ? 'auto-admitted' : a.addedBy === 'seed' ? 'seed' : 'invited'}{a.addedAt ? ` · ${fmtMs(a.addedAt)}` : ''}</p>
                </div>
                <button onClick={() => removeAllowlistEmail(a.email).then(refresh)} className="text-kaya-sand hover:text-red-500 text-sm shrink-0" title="Remove">✕</button>
              </li>
            ))}
            {allowlist.length === 0 && <li className="text-xs text-kaya-sand py-2">No invited testers yet.</li>}
          </ul>
        </section>

        {/* Waitlist */}
        <section className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-display font-bold text-sm">🌱 Interested families <span className="text-kaya-sand font-normal">· {waitlist.length}</span></h2>
            {waitlist.length > 0 && <button onClick={exportCsv} className="text-xs font-display font-bold text-kaya-gold-dark">⬇ Export CSV</button>}
          </div>
          <ul className="space-y-2 mt-3">
            {waitlist.map((w) => (
              <li key={w.email} className="flex items-center justify-between gap-2 border border-kaya-warm-dark rounded-kaya-sm px-3 py-2">
                <div className="min-w-0">
                  <p className="font-display font-bold text-[13px] truncate">{w.name || w.email}</p>
                  <p className="text-[11px] text-kaya-sand truncate">{w.email}{w.country ? ` · ${w.country}` : ''}{w.createdAt ? ` · ${fmtMs(w.createdAt)}` : ''}</p>
                </div>
                {allowSet.has(w.email)
                  ? <span className="text-[11px] font-display font-bold text-green-700 shrink-0">✓ invited</span>
                  : <button onClick={() => promote(w.email)} disabled={busy} className="shrink-0 bg-kaya-chocolate text-white rounded-md font-display font-bold text-[11px] px-2.5 py-1.5 disabled:opacity-50">+ Invite</button>}
              </li>
            ))}
            {waitlist.length === 0 && <li className="text-xs text-kaya-sand py-2">No one on the waitlist yet.</li>}
          </ul>
        </section>
      </div>

      {/* Operators */}
      <section className="bg-white border border-kaya-warm-dark rounded-kaya p-4 max-w-5xl mx-auto m-4 mt-0">
        <h2 className="font-display font-bold text-sm mb-1">👥 Kaya operators <span className="text-kaya-sand font-normal">· who can open this page</span></h2>
        <div className="flex flex-wrap gap-2 items-center mt-3">
          {operators.map((op) => (
            <span key={op.email} className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-display font-bold border ${op.role === 'owner' ? 'bg-kaya-chocolate text-kaya-gold-light border-kaya-chocolate' : 'bg-white border-kaya-warm-dark'}`}>
              {op.email}{op.role === 'owner' ? ' · owner' : ''}
              {op.role !== 'owner' && <button onClick={() => removeOperator(op.email).then(refresh)} className="text-kaya-sand hover:text-red-500" title="Remove">✕</button>}
            </span>
          ))}
        </div>
        <div className="flex gap-2 mt-3 max-w-sm">
          <input
            value={newOp}
            onChange={(e) => setNewOp(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addOp(); }}
            placeholder="add a teammate's email…"
            className="flex-1 h-10 px-3 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
          />
          <button onClick={addOp} disabled={busy || !newOp.trim()} className="h-10 px-4 bg-kaya-gold text-white rounded-kaya-sm font-display font-bold text-sm disabled:opacity-50">Add</button>
        </div>
        <p className="text-[11px] text-kaya-sand mt-2">Operators see this console + the Kaya World count and can flip the switches. Add only people you trust with everyone&apos;s data.</p>
      </section>
    </div>
  );
}

function Switch({ label, sub, on, danger, busy, onClick }: { label: string; sub: string; on: boolean; danger?: boolean; busy: boolean; onClick: () => void }) {
  const offColor = danger ? 'bg-red-500' : 'bg-kaya-sand-light';
  return (
    <button onClick={onClick} disabled={busy} className="flex items-center gap-2.5 bg-kaya-cream border border-kaya-warm-dark rounded-full pl-3 pr-3.5 py-1.5 disabled:opacity-60">
      <span className={`relative w-9 h-5 rounded-full transition-colors ${on ? 'bg-green-600' : offColor}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      <span className="text-left">
        <span className="block font-display font-bold text-[12px] leading-tight">{label}</span>
        <span className="block text-[10px] text-kaya-sand leading-tight">{sub}</span>
      </span>
    </button>
  );
}

function Stat({ n, label, sub, color, border }: { n?: number; label: string; sub: string; color: string; border?: boolean }) {
  return (
    <div className={`px-5 py-4 ${border ? 'border-l border-kaya-warm-dark' : ''}`}>
      <div className="font-display font-black text-2xl leading-none" style={{ color }}>{n ?? '—'}</div>
      <div className="font-display font-bold text-[12px] text-kaya-sand mt-1">{label}</div>
      <div className="text-[10.5px] text-kaya-sand-light">{sub}</div>
    </div>
  );
}
