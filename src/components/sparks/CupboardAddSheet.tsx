'use client';

// Kaya Sparks · Treasures 2.0 — add to the 🗄 Family Cupboard.
//
// C1 ships the confirm card by hand (design screen 5): kind · name ·
// the words on the box / the book's details · whose it is · where it
// lives · an optional photo. C2 puts the two scan tiers on top of this
// same card (D30) — the card never forks, only how it gets filled.
//
// D28 · a hand-typed title is stored `nameSource: 'manual'` and, unless
// a parent typed it, waits ⚠ for a parent to confirm.
// D29 · the gateway refuses a silent double — we show "already in the
// Cupboard · open it · add a 2nd copy".

import { useState } from 'react';
import Link from 'next/link';
import { uploadSparksPhoto } from '@/lib/sparks/uploadPhoto';
import {
  addCupboardItem, type CupboardShelf, type CupboardKind, type NewCupboardItemInput,
} from '@/lib/sparks/cupboard';
import { GAME_KINDS, type GameKind, type OwnerScope } from '@/lib/sparks/treasures';
import { Field, ChoiceChips, inputCls, WOOD, WOOD_DK, WOOD_BG } from './CupboardShell';

interface Props {
  familyId: string;
  shelf: CupboardShelf;
  defaultKind?: CupboardKind;
  onClose: () => void;
  onAdded: (id: string) => void;
}

export default function CupboardAddSheet({ familyId, shelf, defaultKind = 'book', onClose, onAdded }: Props) {
  const me = shelf.me;
  const isParent = me.role === 'parent';
  const isHelper = me.role === 'helper';

  const [kind, setKind] = useState<CupboardKind>(defaultKind);
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [pages, setPages] = useState('');
  const [year, setYear] = useState('');
  const [ageMin, setAgeMin] = useState('');
  const [playersMin, setPlayersMin] = useState('');
  const [playersMax, setPlayersMax] = useState('');
  const [minutes, setMinutes] = useState('');
  const [gameKind, setGameKind] = useState<GameKind | undefined>(undefined);
  const [whereKept, setWhereKept] = useState('');
  const [scope, setScope] = useState<OwnerScope>('family');
  const [kidId, setKidId] = useState<string>(me.childId || shelf.kids[0]?.id || '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dup, setDup] = useState<{ id: string; name: string; ownerName: string } | null>(null);

  // Whose can it be? Family always; a kid's own only for the kid
  // themselves or a parent picking a child; a helper adds family things.
  const whoOptions: Array<{ id: string; label: string }> = [{ id: 'family', label: '🗄 The family' }];
  if (!isHelper) {
    if (isParent) for (const k of shelf.kids) whoOptions.push({ id: `kid:${k.id}`, label: `💎 ${k.name}'s` });
    else if (me.childId) whoOptions.push({ id: `kid:${me.childId}`, label: '💎 Mine' });
  }
  const whoValue = scope === 'family' ? 'family' : `kid:${kidId}`;

  async function submit(allowDuplicate = false) {
    if (busy) return;
    const n = name.trim();
    if (!n) { setErr(kind === 'book' ? 'What is the book called?' : 'What is the game called?'); return; }
    setBusy(true); setErr(''); setDup(null);
    try {
      const input: NewCupboardItemInput = {
        kind, name: n, ownerScope: scope, nameSource: 'manual', allowDuplicate,
        whereKept: whereKept.trim() || undefined,
      };
      if (scope === 'kid') input.kidId = kidId;
      if (kind === 'book') {
        input.book = {
          author: author.trim() || undefined,
          pages: pages ? Number(pages) : undefined,
          year: year ? Number(year) : undefined,
        };
      } else {
        input.game = {
          ageMin: ageMin ? Number(ageMin) : undefined,
          playersMin: playersMin ? Number(playersMin) : undefined,
          playersMax: playersMax ? Number(playersMax) : undefined,
          minutes: minutes ? Number(minutes) : undefined,
          gameKind,
        };
      }
      if (file) {
        const holderId = `cupboard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const up = await uploadSparksPhoto(familyId, holderId, file);
        input.photoUrl = up.feedUrl; input.thumbUrl = up.thumbUrl; input.photoId = up.photoId;
      }
      const r = await addCupboardItem(familyId, input);
      if (r.duplicateOf) { setDup(r.duplicateOf); return; }
      if (r.id) onAdded(r.id);
    } catch (e) {
      setErr(e instanceof Error ? friendly(e.message) : 'Could not add that');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full sm:max-w-md lg:max-w-lg bg-[#FFFBF5] rounded-t-[22px] sm:rounded-[22px] max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 text-white rounded-t-[22px]" style={{ background: 'linear-gradient(135deg,#6E4624 0%,#8B5E34 100%)' }}>
          <div className="text-[10.5px] font-extrabold opacity-85">🗄 The Family Cupboard</div>
          <div className="font-display text-[18px] font-extrabold mt-0.5">Add to the shelf</div>
          <div className="text-[11px] opacity-90 mt-0.5">A name is enough — the rest can come later.</div>
        </div>

        <div className="p-4">
          <Field label="What is it?">
            <ChoiceChips value={kind} onChange={(v) => setKind(v)} options={[{ id: 'book', label: '📚 A book' }, { id: 'game', label: '🎲 A game' }]} />
          </Field>

          <Field label={kind === 'book' ? 'Title' : 'Name of the game'}>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'book' ? 'e.g. Matilda' : 'e.g. Ticket to Ride'} maxLength={120} />
          </Field>

          {kind === 'book' ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-3"><Field label="Author"><input className={inputCls} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Roald Dahl" maxLength={120} /></Field></div>
              <Field label="Pages"><input className={inputCls} inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value.replace(/\D/g, ''))} placeholder="240" /></Field>
              <Field label="Year"><input className={inputCls} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1988" /></Field>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2">
                <Field label="Ages"><input className={inputCls} inputMode="numeric" value={ageMin} onChange={(e) => setAgeMin(e.target.value.replace(/\D/g, ''))} placeholder="8+" /></Field>
                <Field label="Players from"><input className={inputCls} inputMode="numeric" value={playersMin} onChange={(e) => setPlayersMin(e.target.value.replace(/\D/g, ''))} placeholder="2" /></Field>
                <Field label="to"><input className={inputCls} inputMode="numeric" value={playersMax} onChange={(e) => setPlayersMax(e.target.value.replace(/\D/g, ''))} placeholder="5" /></Field>
                <Field label="Minutes"><input className={inputCls} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} placeholder="45" /></Field>
              </div>
              <Field label="Kind">
                <ChoiceChips value={gameKind} onChange={setGameKind} options={GAME_KINDS.map((k) => ({ id: k.id, label: `${k.emoji} ${k.label}` }))} />
              </Field>
            </>
          )}

          <Field label="Whose is it?">
            <ChoiceChips
              value={whoValue}
              onChange={(v) => { if (v === 'family') setScope('family'); else { setScope('kid'); setKidId(v.slice(4)); } }}
              options={whoOptions}
            />
            <p className="text-[10.5px] font-bold text-[#8A8471] mt-1.5 m-0 leading-snug">
              {scope === 'family'
                ? 'The family’s — anyone may read or play it.'
                : 'Stays in their own Treasures, shared to the Cupboard shelf.'}
            </p>
          </Field>

          <Field label="📍 Where it lives">
            <input className={inputCls} value={whereKept} onChange={(e) => setWhereKept(e.target.value)} placeholder="living-room cupboard, top shelf" maxLength={120} />
          </Field>

          <Field label="Photo (optional)">
            <input type="file" accept="image/*" capture="environment" className="text-[12px]" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>

          {!isParent && (
            <p className="text-[10.8px] font-bold text-[#8A6800] bg-[#FFF9EF] border border-[#F3D3A6] rounded-[10px] px-3 py-2 leading-snug">
              ⚠ Typed by hand — a parent will confirm the {kind === 'book' ? 'title' : 'name'} so it never gets written wrong.
            </p>
          )}

          {dup && (
            <div className="rounded-[12px] border border-[#F3D3A6] bg-[#FFF9EF] p-3 mt-2">
              <div className="font-display font-extrabold text-[12.5px] text-[#8A6800]">⚠ Already in the Cupboard — {dup.name}</div>
              <p className="text-[10.8px] font-bold text-[#7a6320] mt-1 m-0">{dup.ownerName ? `${dup.ownerName}’s copy` : 'The family’s copy'} is on the shelf.</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Link href={`/sparks/treasures/cupboard/${dup.id}`} className="px-3.5 py-1.5 rounded-full font-extrabold text-[11.5px] no-underline" style={{ background: WOOD, color: '#fff' }}>Open it</Link>
                <button type="button" disabled={busy} onClick={() => submit(true)} className="px-3.5 py-1.5 rounded-full font-extrabold text-[11.5px]" style={{ background: WOOD_BG, color: WOOD_DK }}>Add a 2nd copy</button>
              </div>
            </div>
          )}

          {err && <p className="text-[11.5px] text-[#C0392B] font-bold mt-2">{err}</p>}

          <div className="flex gap-2 mt-3">
            <button type="button" disabled={busy} onClick={() => submit(false)} className="flex-1 px-4 py-2.5 rounded-full font-extrabold text-[13px] text-white disabled:opacity-50" style={{ background: WOOD }}>
              {busy ? 'Adding…' : '✓ Add to the Cupboard'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-full font-extrabold text-[13px] bg-[#EEF0F4] text-[#5B6B8C]">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function friendly(code: string): string {
  switch (code) {
    case 'forbidden': return 'You can’t add that one here.';
    case 'no-such-kid': return 'Pick whose it is.';
    case 'bad-name': return 'It needs a name.';
    default: return 'Could not add that — try again.';
  }
}
