'use client';

// Kaya Wealth · Legacy & Next of Kin (Phase 2 · PR8 · 2026-06-01).
//
// SETUP ONLY. The owner configures the inactivity period, pre-release
// check-ins, and their next of kin — and that's it. No release of anything
// happens here; the actual inactivity transfer waits for a legal-reviewed
// pass. Personal-only. Reuses the mockup's `.kin` styling from wealth.css.

import { useEffect, useState, type CSSProperties } from 'react';
import {
  subscribeLegacy, saveLegacy, newKinId, MIN_INACTIVITY_MONTHS,
  type LegacyConfig,
} from '@/lib/wealthLegacy';

const initials = (n: string) => n.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
const ord = (i: number) => ['1st', '2nd', '3rd', '4th', '5th', '6th'][i] ?? `${i + 1}th`;
const kinBtn: CSSProperties = { background: 'rgba(255,255,255,.08)', border: 'none', color: '#cdbdf0', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', fontSize: 12 };

export default function LegacyVault({ uid }: { uid: string }) {
  const [cfg, setCfg] = useState<LegacyConfig>({ inactivityMonths: MIN_INACTIVITY_MONTHS, checkInsOn: true, kin: [] });
  const [months, setMonths] = useState(MIN_INACTIVITY_MONTHS);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (!uid) return;
    return subscribeLegacy(uid, (c) => { setCfg(c); setMonths(c.inactivityMonths); });
  }, [uid]);

  const saveMonths = () => saveLegacy(uid, { inactivityMonths: Math.max(MIN_INACTIVITY_MONTHS, months) });
  const toggleCheckins = () => saveLegacy(uid, { checkInsOn: !cfg.checkInsOn });
  const addKin = async (name: string, relationship: string, contact: string) => {
    const kin = [...cfg.kin, { id: newKinId(), name, relationship, contact, order: cfg.kin.length, status: 'pending' as const }];
    await saveLegacy(uid, { kin });
    setAddOpen(false);
  };
  const removeKin = async (id: string) => {
    await saveLegacy(uid, { kin: cfg.kin.filter((k) => k.id !== id).map((k, i) => ({ ...k, order: i })) });
  };
  const move = async (id: string, dir: -1 | 1) => {
    const arr = [...cfg.kin];
    const i = arr.findIndex((k) => k.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    await saveLegacy(uid, { kin: arr.map((k, idx) => ({ ...k, order: idx })) });
  };

  return (
    <div className="personal-block">
      <div className="section-title"><h2>🕊️ Legacy &amp; Next of Kin <span className="pilltag">Personal vault only</span></h2></div>
      <div className="grid g2">
        {/* Inactivity Transfer */}
        <div className="kin">
          <div className="h"><div className="ki">🔑</div><div className="t">Inactivity Transfer<small>A safe handover if something happens to you</small></div></div>
          <p className="exp">If your vault is inactive for the period you set, Kaya privately releases your Personal vault to your chosen next of kin — in order. Nothing is shared while you are active.</p>
          <div className="cond">
            <div className="row">
              <span className="lab">Release after inactivity of</span>
              <span className="pickwrap">
                <input type="range" min={MIN_INACTIVITY_MONTHS} max={24} step={1} value={months}
                  onChange={(e) => setMonths(+e.target.value)} onMouseUp={saveMonths} onTouchEnd={saveMonths} />
                <span className="mval">{months} months</span>
              </span>
            </div>
            <div className="row">
              <span className="lab">Pre-release check-in reminders</span>
              <button onClick={toggleCheckins} className="mval" style={{ background: 'none', border: 'none', cursor: 'pointer', color: cfg.checkInsOn ? '#cdbdf0' : '#8f86b5' }}>
                {cfg.checkInsOn ? 'On' : 'Off'}
              </button>
            </div>
          </div>
          <div className="kin-note">ℹ️ Minimum 6 months. The actual release is being finalised with legal review — for now this safely records your wishes.</div>
        </div>

        {/* Next of Kin */}
        <div className="kin" style={{ background: 'linear-gradient(135deg,#2c2150,#241a44)' }}>
          <div className="h"><div className="ki">👪</div><div className="t">Chosen Next of Kin<small>At least 2 recommended · released in order</small></div></div>
          <div className="kin-list">
            {cfg.kin.length === 0 && <div className="kin-note" style={{ marginTop: 0 }}>No next of kin yet. Add at least two.</div>}
            {cfg.kin.map((k, i) => (
              <div className="kinrow" key={k.id}>
                <div className="ka">{initials(k.name)}</div>
                <div className="kn">{k.name}<small>{k.relationship}{k.status === 'verified' ? ' · verified' : ' · pending'}</small></div>
                <span className="order">{ord(i)}</span>
                <div style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
                  <button onClick={() => move(k.id, -1)} style={kinBtn} title="Move up">↑</button>
                  <button onClick={() => move(k.id, 1)} style={kinBtn} title="Move down">↓</button>
                  <button onClick={() => removeKin(k.id)} style={kinBtn} title="Remove">✕</button>
                </div>
              </div>
            ))}
          </div>
          <button className="add-kin" onClick={() => setAddOpen(true)}>+ Add next of kin</button>
          {cfg.kin.length < 2 && <div className="kin-note">⚠️ At least 2 next of kin are recommended before any future release could ever run.</div>}
          <div className="kin-note">🔐 Each kin will verify their identity (2FA) before receiving anything — at release time. Re-order or remove anyone, anytime.</div>
        </div>
      </div>

      {addOpen && <AddKinModal onClose={() => setAddOpen(false)} onAdd={addKin} />}
    </div>
  );
}

function AddKinModal({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string, relationship: string, contact: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const canSave = name.trim().length > 0 && !busy;
  const save = async () => { if (!canSave) return; setBusy(true); try { await onAdd(name.trim(), relationship.trim() || 'Family', contact.trim()); } catch { setBusy(false); } };
  return (
    <div className="kw-modal-back" onClick={onClose}>
      <div className="kw-modal" onClick={(e) => e.stopPropagation()}>
        <h3>👪 Add next of kin</h3>
        <div className="msub">Private to you. They&apos;ll verify their identity at release time (not now).</div>
        <div className="kw-field"><label>Name</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Timotheo" /></div>
        <div className="kw-field"><label>Relationship</label><input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="Spouse / Daughter / Sibling…" /></div>
        <div className="kw-field"><label>Contact <span style={{ color: '#9a9a9a', fontWeight: 500 }}>(optional)</span></label><input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email or phone" /></div>
        <div className="kw-modal-actions">
          <button className="kw-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="kw-btn-primary" disabled={!canSave} onClick={save}>{busy ? 'Adding…' : 'Add'}</button>
        </div>
      </div>
    </div>
  );
}
