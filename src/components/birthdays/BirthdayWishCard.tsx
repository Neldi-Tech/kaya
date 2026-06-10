'use client';

// Kaya · Birthdays — the My Day wish card (B1).
//
// Shown to every family member (parent / sibling / helper) on the day, for
// each birthday person except themselves. One tap on a themed quick wish — or
// write your own — sends it to the family chat AND lights a candle on the
// birthday person's cake (wishes are tallied on family.birthdays via the
// /api/birthdays/wish admin route).

import { useState } from 'react';
import { useTodaysBirthdays } from './useTodaysBirthdays';
import { ordinalAge } from '@/lib/birthdays';

export default function BirthdayWishCard({ familyId, viewerUid, viewerChildId, wrapClassName }: {
  familyId: string; viewerUid: string; viewerChildId?: string;
  /** Optional outer container classes (e.g. the My Day page gutter) — only
   *  rendered when there's actually a birthday, so no empty spacing. */
  wrapClassName?: string;
}) {
  const { people, state } = useTodaysBirthdays(familyId);
  const targets = people.filter((p) => p.id !== viewerChildId && p.id !== viewerUid);
  if (targets.length === 0) return null;

  return (
    <div className={`flex flex-col gap-3 mb-4 ${wrapClassName ?? ''}`}>
      {targets.map((p) => (
        <WishRow key={p.stateKey} familyId={familyId} viewerUid={viewerUid}
          personKey={p.stateKey} name={p.name} age={p.age}
          quickWishes={p.theme.quickWishes} accentFrom={p.theme.from} accentTo={p.theme.to}
          alreadyWished={(state[p.stateKey]?.wishes || []).some((w) => w.uid === viewerUid)}
          wishCount={state[p.stateKey]?.wishes?.length ?? 0}
        />
      ))}
    </div>
  );
}

function WishRow({ familyId, viewerUid, personKey, name, age, quickWishes, accentFrom, accentTo, alreadyWished, wishCount }: {
  familyId: string; viewerUid: string; personKey: string; name: string; age?: number;
  quickWishes: string[]; accentFrom: string; accentTo: string;
  alreadyWished: boolean; wishCount: number;
}) {
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/birthdays/wish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId, fromUid: viewerUid, personKey, text: text.trim() }),
      });
      if (!res.ok) throw new Error('send-failed');
      setSent(true); setCustom('');
    } catch {
      setErr('Couldn’t send the wish — try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-hive-paper border-2 border-dashed rounded-hive p-3.5" style={{ borderColor: accentTo }}>
      <div className="font-nunito font-black text-[14px] text-hive-navy">
        🎈 Wish {name} a happy {age ? `${ordinalAge(age)}` : 'birthday'}!
      </div>
      <div className="text-[11.5px] text-hive-muted mt-0.5">
        {sent || alreadyWished
          ? `✓ Your wish is in — ${wishCount + (sent && !alreadyWished ? 1 : 0)} candle${(wishCount + (sent && !alreadyWished ? 1 : 0)) === 1 ? '' : 's'} lit 🕯️ Add another below if you like.`
          : 'One tap sends it to the family chat — every wish lights a candle on the cake.'}
      </div>
      {!(sent || alreadyWished) && (
        <div className="flex gap-2 flex-wrap mt-2.5">
          {quickWishes.map((w) => (
            <button key={w} type="button" disabled={busy} onClick={() => send(w)}
              className="text-[12px] font-nunito font-extrabold rounded-full px-3 py-1.5 text-white disabled:opacity-60"
              style={{ background: `linear-gradient(135deg, ${accentFrom}, ${accentTo})` }}>
              {busy ? 'Sending…' : w}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 mt-2.5">
        <input value={custom} onChange={(e) => setCustom(e.target.value)}
          placeholder={`Write your own wish for ${name}…`} maxLength={200}
          className="flex-1 border border-hive-line rounded-lg px-3 py-2 text-[12.5px] font-nunito font-bold focus:outline-none focus:border-hive-honey bg-white" />
        <button type="button" disabled={busy || !custom.trim()} onClick={() => send(custom)}
          className="bg-hive-honey text-white rounded-lg px-4 py-2 font-nunito font-black text-[12.5px] disabled:opacity-50">
          Send
        </button>
      </div>
      {err && <div className="text-[11px] text-hive-rose font-bold mt-1.5">{err}</div>}
    </div>
  );
}
