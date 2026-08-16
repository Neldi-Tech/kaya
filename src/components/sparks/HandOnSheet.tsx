'use client';

// Kaya Sparks · Treasures — the Hand-on ceremony.
//
// Children hoard because letting go feels like loss. A ceremony makes it
// feel like an achievement — so an outgrown thing gets a dignified exit
// instead of vanishing:
//
//   🤝 Hand on  · to a brother or sister. D12 · the OBJECT's history and
//                 the giver thread travel with it; the person's Care
//                 Score does NOT (R6). The new keeper starts neutral.
//   💚 Donate   · Kaya records where it went and keeps the memory.
//   💰 Sell     · recorded here, and the money moves through the SHIPPED
//                 Hive deposit path — we never invent a second money
//                 rail (D13).
//   🌱 Outgrow  · no exit decided yet; it just moves off the shelf.
//
// D6 · nothing is deleted. Every one of these lands the treasure on the
// 🕰 Memory Shelf with its whole story intact.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFamily } from '@/contexts/FamilyContext';
import { endTreasure, setTreasureValue, type Treasure, type TreasureStatus } from '@/lib/sparks/treasures';

type Ending = Extract<TreasureStatus, 'handed_on' | 'donated' | 'sold' | 'outgrown'>;

interface Props {
  familyId: string;
  kidId: string;
  kidName: string;
  treasure: Treasure;
  isParent: boolean;
  onClose: () => void;
  onDone: () => void;
}

export default function HandOnSheet({
  familyId, kidId, kidName, treasure, isParent, onClose, onDone,
}: Props) {
  const router = useRouter();
  const { children } = useFamily();

  const [choice, setChoice] = useState<Ending | ''>('');
  const [toChildId, setToChildId] = useState('');
  const [note, setNote] = useState('');
  const [soldFor, setSoldFor] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [doneKind, setDoneKind] = useState<Ending | ''>('');

  const siblings = children.filter((c) => c.id !== kidId);
  const years = yearsHeld(treasure.givenOn);

  async function confirm() {
    if (!choice || busy) return;
    if (choice === 'handed_on' && !toChildId) return;
    setBusy(true); setErr('');
    try {
      await endTreasure(familyId, kidId, treasure.id, choice, {
        ...(choice === 'handed_on' ? { toChildId } : {}),
        note: note.trim() || undefined,
      });
      // D4 · the sale figure is money, so it lands in the parent-only
      // sub-document like every other number — never on the treasure.
      if (choice === 'sold' && soldFor && isParent) {
        await setTreasureValue(familyId, kidId, treasure.id, {
          note: `Sold for ${soldFor}`,
        }).catch(() => {});
      }
      setDoneKind(choice);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not work');
      setBusy(false);
    }
  }

  if (doneKind) {
    const toName = children.find((c) => c.id === toChildId)?.name || 'them';
    return (
      <Shell onClose={() => { onDone(); onClose(); }} title="🕰 Onto the Memory Shelf">
        <div className="text-center py-2">
          <div className="text-[40px] leading-none">
            {doneKind === 'handed_on' ? '🤝' : doneKind === 'donated' ? '💚' : doneKind === 'sold' ? '💰' : '🌱'}
          </div>
          <p className="text-[13.5px] font-extrabold text-[#0F1F44] mt-2 m-0">
            {doneKind === 'handed_on'
              ? `${treasure.name} is ${toName}'s now`
              : doneKind === 'donated'
                ? `${treasure.name} has gone to a good home`
                : doneKind === 'sold'
                  ? `${treasure.name} is sold`
                  : `${treasure.name} is off the shelf`}
          </p>
          <p className="text-[11.5px] text-[#5A6488] mt-1.5 leading-snug">
            {years ? `Yours for ${years}. ` : ''}
            Nothing was deleted — the photo, the story and everyone who was part of it stay on your
            🕰 Memory Shelf.
            {doneKind === 'handed_on' && treasure.giverName
              ? ` And ${treasure.giverName}'s gift is still going.`
              : ''}
          </p>

          {doneKind === 'sold' && (
            <div className="mt-3 rounded-[12px] border border-[#F7D9A3] bg-[#FEF9EE] p-3 text-left">
              <p className="text-[11.5px] font-bold text-[#8A6800] m-0 leading-snug">
                💰 To move the money into {kidName}&rsquo;s Pot, use the Hive deposit — that way it
                lands in the ledger you already trust, with the usual approval.
              </p>
              <button
                type="button"
                onClick={() => router.push('/parent/hive-deposit')}
                className="mt-2 px-3.5 py-1.5 rounded-full font-extrabold text-[11.5px]"
                style={{ background: '#D4A847', color: '#3D2E08' }}
              >
                Open Hive deposit
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => { onDone(); onClose(); }}
            className="mt-4 px-5 py-2.5 rounded-full text-white font-extrabold text-[13px]"
            style={{ background: '#0E6B5E' }}
          >
            Done
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose} title={`🌱 You've outgrown ${treasure.name}`}>
      <p className="text-[11.5px] text-[#5A6488] leading-snug mt-0 mb-3">
        {years ? `Yours for ${years}. ` : ''}Let&rsquo;s give it a proper ending.
      </p>

      <Option
        on={choice === 'handed_on'}
        onClick={() => setChoice('handed_on')}
        emoji="🤝"
        title="Hand it on"
        body={
          siblings.length
            ? `Its story, its photos${treasure.giverName ? ` and ${treasure.giverName}'s note` : ''} all go with it. The Keeper Score stays yours — they start fresh.`
            : 'No brothers or sisters on Kaya yet — try donate or sell.'
        }
        disabled={!siblings.length}
      />
      {choice === 'handed_on' && (
        <div className="flex flex-wrap gap-1.5 mb-2 pl-1">
          {siblings.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setToChildId(c.id)}
              className={`px-2.5 py-1.5 rounded-full text-[11px] font-extrabold border ${
                toChildId === c.id
                  ? 'bg-[#E2F3EE] text-[#0E6B5E] border-[#0E6B5E]'
                  : 'bg-white text-[#5B6B8C] border-[#E8E0CF]'
              }`}
            >
              {c.avatarEmoji || '🧒'} {c.name}
            </button>
          ))}
        </div>
      )}

      <Option
        on={choice === 'donated'}
        onClick={() => setChoice('donated')}
        emoji="💚"
        title="Donate it"
        body="Kaya records where it went and keeps the memory on your shelf."
      />

      <Option
        on={choice === 'sold'}
        onClick={() => setChoice('sold')}
        emoji="💰"
        title="Sell it"
        body="Record the sale here; the money moves through your Hive deposit so it lands in the ledger you already use."
      />
      {choice === 'sold' && (
        <input
          value={soldFor}
          onChange={(e) => setSoldFor(e.target.value)}
          placeholder="What did it sell for? (optional)"
          maxLength={40}
          className="w-full mb-2 text-[12px] rounded-[10px] border border-[#E8E0CF] bg-white p-2 outline-none"
        />
      )}

      <Option
        on={choice === 'outgrown'}
        onClick={() => setChoice('outgrown')}
        emoji="🌱"
        title="Just outgrown"
        body="Off the shelf for now — you can decide what happens to it later."
      />

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything to remember about it? (optional)"
        maxLength={400}
        className="w-full mt-1 text-[12px] rounded-[10px] border border-[#E8E0CF] bg-white p-2 outline-none"
      />

      <div className="rounded-[12px] border border-[#BFE3D8] bg-[#E2F3EE] p-2.5 mt-2.5">
        <p className="text-[11px] font-bold text-[#1B4B43] m-0 leading-snug">
          Nothing gets deleted. It moves to your <b>🕰 Memory Shelf</b> with everything that happened
          to it.
        </p>
      </div>

      {err && <p className="text-[11.5px] text-[#C0392B] font-bold mt-2">{err}</p>}

      <button
        type="button"
        disabled={busy || !choice || (choice === 'handed_on' && !toChildId)}
        onClick={confirm}
        className="w-full mt-3 py-2.5 rounded-full text-white font-extrabold text-[13px] disabled:opacity-40"
        style={{ background: '#0E6B5E' }}
      >
        {busy ? 'Saving…' : 'Confirm'}
      </button>
    </Shell>
  );
}

function Shell({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-[22px] sm:rounded-[22px] max-h-[92vh] overflow-y-auto">
        <div
          className="px-4 py-4 text-white flex items-start justify-between gap-3"
          style={{ background: 'linear-gradient(135deg,#0E6B5E 0%,#3FA38F 100%)' }}
        >
          <div className="font-display text-[16px] font-extrabold">{title}</div>
          <button type="button" onClick={onClose} className="text-white/80 text-[20px] leading-none px-1" aria-label="Close">
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function Option({
  on, onClick, emoji, title, body, disabled,
}: {
  on: boolean; onClick: () => void; emoji: string;
  title: string; body: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full text-left rounded-[13px] border p-2.5 mb-2 disabled:opacity-45 ${
        on ? 'border-2 border-[#0E6B5E] bg-[#F1FAF7]' : 'border-[#E8E0CF] bg-white'
      }`}
    >
      <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">
        {emoji} {title}
      </div>
      <p className="text-[10.8px] font-bold text-[#5B6B8C] mt-1 m-0 leading-snug">{body}</p>
    </button>
  );
}

/** "Yours for 2 years" — the line that makes the ending feel earned. */
function yearsHeld(givenOn: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(givenOn)) return '';
  const [y, m, d] = givenOn.split('-').map(Number);
  const days = Math.round((Date.now() - Date.UTC(y, (m || 1) - 1, d || 1)) / 86400000);
  if (days < 45) return '';
  if (days < 365) return `${Math.round(days / 30)} months`;
  const yrs = Math.round(days / 365.25);
  return `${yrs} year${yrs === 1 ? '' : 's'}`;
}
