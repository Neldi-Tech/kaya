'use client';

// Kaya Sparks · Treasures 2.0 — a thing from the Cupboard, opened.
//
// Design screen 6 (C1 subset: identity · where it lives · details ·
// keeper · lend / missing / found · endings · the story so far). The
// reading loop (C3), the Finish Quiz (C4) and the play log (C5) mount
// on this same page later.
//
// D41 · the lifecycle is Treasures 1.0's, unchanged — a family thing is
// lent, reported missing, found and retired exactly like a kid's.
// D28 · a hand-typed name waits ⚠ for a parent to confirm.

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { toDisplayDate } from '@/lib/dates';
import {
  getCupboardItem, updateCupboardItem, cupboardCondition, cupboardFound,
  cupboardLend, cupboardReturn, cupboardEnd, fetchCupboard, pingCupboard,
  kindOf, gameMetaLine, bookMetaLine,
  type CupboardItem, type CupboardShelf,
} from '@/lib/sparks/cupboard';
import {
  GAME_KINDS, gameKindDef, isFamilyOwned, STATUS_CHIP, STATUS_LABEL, todayIso,
  type TreasureEvent, type GameKind,
} from '@/lib/sparks/treasures';
import {
  CupboardFrame, Card, Pill, OwnerChip, Field, ChoiceChips, inputCls,
  WOOD, WOOD_DK, WOOD_BG, JADE, JADE_BG,
} from '@/components/sparks/CupboardShell';

const EVENT_EMOJI: Record<string, string> = {
  registered: '🗄', check: '🔑', broken: '🔧', repaired: '🔧', lost: '❓', found: '✅',
  sighting: '👀', lent: '🤝', returned: '↩️', shared: '👨‍👩‍👧', handed_on: '🤝',
  donated: '💚', sold: '💰', outgrown: '🌱', retired: '🕰', story: '💬',
  thanked: '💛', reply: '💌', value_set: '🔒', vault_promoted: '🏦',
};

export default function CupboardItemPage() {
  const params = useParams<{ treasureId: string }>();
  const treasureId = params?.treasureId ?? '';
  const { profile } = useAuth();
  const familyId = profile?.familyId ?? '';

  const [item, setItem] = useState<CupboardItem | null>(null);
  const [events, setEvents] = useState<TreasureEvent[]>([]);
  const [perm, setPerm] = useState({ canEdit: false, canEnd: false, canManage: false });
  const [shelf, setShelf] = useState<CupboardShelf | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'none' | 'edit' | 'lend' | 'missing' | 'end'>('none');

  const load = useCallback(() => {
    if (!treasureId) return;
    getCupboardItem(treasureId)
      .then((r) => { setItem(r.item); setEvents(r.events); setPerm({ canEdit: r.canEdit, canEnd: r.canEnd, canManage: r.canManage }); setErr(''); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'error'));
    fetchCupboard().then(setShelf).catch(() => setShelf(null));
  }, [treasureId]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setErr('');
    try { await fn(); pingCupboard(familyId); load(); setMode('none'); }
    catch (e) { setErr(e instanceof Error ? friendly(e.message) : 'That did not work'); }
    finally { setBusy(false); }
  }

  if (err && !item) {
    return (
      <CupboardFrame back={{ href: '/sparks/treasures/cupboard', label: 'Cupboard' }} hero={{ tone: 'wood', eyebrow: '🗄 The Family Cupboard', title: 'Not on the shelf', sub: ' ' }}>
        <Card tone="warn"><div className="text-[12px] font-extrabold text-[#8A6800]">{err === 'forbidden' ? 'The Cupboard is for the family.' : 'That one is not on the Cupboard shelf.'}</div></Card>
      </CupboardFrame>
    );
  }
  if (!item) {
    return (
      <CupboardFrame back={{ href: '/sparks/treasures/cupboard', label: 'Cupboard' }} hero={{ tone: 'wood', eyebrow: '🗄 The Family Cupboard', title: 'Opening…', sub: ' ' }}>
        <p className="text-[13px] text-[#5A6488] text-center py-6">Loading…</p>
      </CupboardFrame>
    );
  }

  const kind = kindOf(item);
  const family = isFamilyOwned(item);
  const meta = kind === 'book' ? bookMetaLine(item.book) : gameMetaLine(item.game);
  const chip = STATUS_CHIP[item.status];
  const img = (kind === 'book' ? item.book?.coverUrl : undefined) || item.photoUrl || item.thumbUrl;
  const ended = ['handed_on', 'donated', 'sold', 'outgrown', 'retired'].includes(item.status);
  const kids = shelf?.kids ?? [];
  const backHref = kind === 'book' ? '/sparks/treasures/cupboard/books' : '/sparks/treasures/cupboard/games';

  return (
    <CupboardFrame
      back={{ href: backHref, label: kind === 'book' ? 'Book Shelf' : 'Game Shelf' }}
      hero={{
        tone: family ? 'wood' : 'jade',
        eyebrow: `🗄 The Family Cupboard › ${kind === 'book' ? '📚 Book Shelf' : '🎲 Game Shelf'}`,
        title: `${item.emoji} ${item.name}`,
        sub: (
          <span>
            {meta || (kind === 'book' ? 'A book' : 'A game')}
            {item.game?.gameKind ? ` · ${gameKindDef(item.game.gameKind).emoji} ${gameKindDef(item.game.gameKind).label}` : ''}
            {item.whereKept ? ` · 📍 ${item.whereKept}` : ''}
          </span>
        ),
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
        <OwnerChip item={item} />
        <span className="inline-block text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: chip.bg, color: chip.fg }}>
          {chip.emoji} {STATUS_LABEL[item.status]}
        </span>
        {item.keeperName && <span className="inline-block text-[10px] font-extrabold px-2 py-1 rounded-full bg-[#EEF0F4] text-[#5B6B8C]">🔑 Keeper: {item.keeperName}</span>}
        {item.barcode && <span className="inline-block text-[10px] font-extrabold px-2 py-1 rounded-full bg-[#EEF0F4] text-[#5B6B8C]">▌▌ {item.barcode}</span>}
      </div>

      {img && (
        <div className="rounded-[14px] overflow-hidden border border-[#ECE4D3] bg-[#FBF4E4] mb-2.5 max-h-[220px] grid place-items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="" className="max-h-[220px] object-contain" />
        </div>
      )}

      {/* D28 · a hand-typed name waits for a parent */}
      {item.nameConfirmed === false && (
        <Card tone="warn">
          <div className="font-display font-extrabold text-[12.5px] text-[#8A6800]">⚠ Typed by hand</div>
          {perm.canManage ? (
            <NameConfirm item={item} busy={busy} onSave={(name) => run(() => updateCupboardItem(familyId, item.id, { name, nameConfirmed: true }))} />
          ) : (
            <p className="text-[10.8px] font-bold text-[#7a6320] mt-1 m-0 leading-snug">Waiting for a parent to confirm the {kind === 'book' ? 'title' : 'name'} so it never gets written wrong.</p>
          )}
        </Card>
      )}

      {/* kid-owned → its full page lives in their register */}
      {!family && (
        <Card tone="good">
          <div className="text-[11.5px] font-bold text-[#2C4A44] leading-snug">
            💎 This is {item.ownerName}&rsquo;s, shared to the Cupboard. Its giver, story and Keeper Check live in{' '}
            <Link href={`/sparks/${item.kidId}/treasures/${item.id}`} className="font-extrabold text-[#0E6B5E]">their Treasures →</Link>
          </div>
        </Card>
      )}

      {/* 📍 Where it lives (N10) */}
      <Card>
        <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">📍 Where it lives</div>
        <WhereKept value={item.whereKept || ''} canEdit={perm.canEdit && !ended} busy={busy}
          onSave={(whereKept) => run(() => updateCupboardItem(familyId, item.id, { whereKept }))} />
      </Card>

      {/* Details */}
      <Card>
        <div className="flex items-center justify-between">
          <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">{kind === 'book' ? '📚 About the book' : '🎲 On the box'}</div>
          {perm.canEdit && !ended && (
            <button type="button" onClick={() => setMode(mode === 'edit' ? 'none' : 'edit')} className="text-[11px] font-extrabold" style={{ color: WOOD_DK }}>
              {mode === 'edit' ? 'Close' : '✏️ Edit'}
            </button>
          )}
        </div>
        {mode !== 'edit' ? (
          <p className="text-[11.3px] font-bold text-[#5B6B8C] mt-1 m-0 leading-snug">
            {kind === 'book' ? (
              <>
                {item.book?.author ? `by ${item.book.author}` : 'Author not set'}
                {item.book?.pages ? ` · ${item.book.pages} pages` : ''}
                {item.book?.year ? ` · ${item.book.year}` : ''}
                {item.book?.publisher ? ` · ${item.book.publisher}` : ''}
                {item.book?.isbn ? ` · ISBN ${item.book.isbn}` : ''}
                {item.book?.ageMin ? ` · good for ${item.book.ageMin}+` : ''}
              </>
            ) : (
              <>
                {gameMetaLine(item.game) || 'Ages, players and minutes not set'}
                {item.game?.piecesNote ? ` · 🧩 ${item.game.piecesNote}` : ''}
              </>
            )}
          </p>
        ) : (
          <DetailsEditor item={item} busy={busy} onSave={(patch) => run(() => updateCupboardItem(familyId, item.id, patch))} />
        )}
      </Card>

      {/* 🔑 Keeper (family things only — D25) */}
      {family && !ended && kids.length > 0 && (
        <Card>
          <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">🔑 Who has it right now?</div>
          <p className="text-[10.5px] font-bold text-[#8A8471] mt-0.5 mb-1.5 leading-snug">The keeper — optional. A family thing with a named keeper is the family-iPad rule.</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={!perm.canEdit || busy} onClick={() => run(() => updateCupboardItem(familyId, item.id, { keeperKidId: '' }))}
              className="text-[11px] font-extrabold px-2.5 py-1.5 rounded-full border-[1.5px] border-[#E8E0CF] bg-white text-[#0F1F44] disabled:opacity-60"
              style={!item.keeperKidId ? { background: WOOD, color: '#fff', borderColor: WOOD } : undefined}>
              🗄 On the shelf
            </button>
            {kids.map((k) => (
              <button key={k.id} type="button" disabled={!perm.canEdit || busy} onClick={() => run(() => updateCupboardItem(familyId, item.id, { keeperKidId: k.id }))}
                className="text-[11px] font-extrabold px-2.5 py-1.5 rounded-full border-[1.5px] border-[#E8E0CF] bg-white text-[#0F1F44] disabled:opacity-60"
                style={item.keeperKidId === k.id ? { background: WOOD, color: '#fff', borderColor: WOOD } : undefined}>
                {k.emoji} {k.name}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* 🤝 Lend · ❓ Missing · ✅ Found — D41 */}
      {!ended && perm.canEdit && (
        <Card>
          <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">What&rsquo;s happening with it</div>
          {item.status === 'lent' && item.borrow && (
            <div className="mt-1.5">
              <p className="text-[11.3px] font-bold text-[#5B6B8C] m-0">🤝 With {item.borrow.toName} since {toDisplayDate(item.borrow.since)} · back by {toDisplayDate(item.borrow.dueOn)}{item.borrow.dueOn < todayIso() ? ' · overdue' : ''}</p>
              <div className="mt-2"><Pill bg={JADE} fg="#fff" disabled={busy} onClick={() => run(() => cupboardReturn(familyId, item.id))}>↩️ It&rsquo;s back</Pill></div>
            </div>
          )}
          {item.status === 'lost' && (
            <div className="mt-1.5">
              <p className="text-[11.3px] font-bold text-[#C0392B] m-0">❓ Missing{item.lostSince ? ` since ${toDisplayDate(item.lostSince)}` : ''}{item.lastSeenWhere ? ` · last seen ${item.lastSeenWhere}` : ''}</p>
              <div className="mt-2"><Pill bg={JADE} fg="#fff" disabled={busy} onClick={() => run(() => cupboardFound(familyId, item.id, item.whereKept))}>✅ Found it</Pill></div>
            </div>
          )}
          {item.status === 'broken' && (
            <div className="mt-2"><Pill bg={JADE} fg="#fff" disabled={busy} onClick={() => run(() => cupboardCondition(familyId, item.id, 'repaired'))}>🔧 Fixed now</Pill></div>
          )}
          {(item.status === 'kept' || item.status === 'repaired') && (
            <div className="flex flex-wrap gap-2 mt-2">
              <Pill bg="#EFE8FF" fg="#5A3CB8" onClick={() => setMode(mode === 'lend' ? 'none' : 'lend')}>🤝 Lend it</Pill>
              <Pill bg="#FDE8E8" fg="#C0392B" onClick={() => setMode(mode === 'missing' ? 'none' : 'missing')}>❓ Can&rsquo;t find it</Pill>
              <Pill bg="#FFF1C9" fg="#8A6800" disabled={busy} onClick={() => run(() => cupboardCondition(familyId, item.id, 'broken', kind === 'game' ? 'Pieces missing or broken' : 'Damaged'))}>🔧 Needs fixing</Pill>
            </div>
          )}
          {mode === 'lend' && (
            <LendForm kids={kids} busy={busy} onLend={(to) => run(() => cupboardLend(familyId, item.id, to))} />
          )}
          {mode === 'missing' && (
            <MissingForm defaultWhere={item.whereKept || ''} busy={busy} onReport={(where) => run(() => cupboardCondition(familyId, item.id, 'lost', undefined, where))} />
          )}
        </Card>
      )}

      {/* Endings — parents for family things; owner or parent for a kid's (D41) */}
      {!ended && perm.canEnd && (
        <Card>
          <div className="flex items-center justify-between">
            <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">🕰 Let it go</div>
            <button type="button" onClick={() => setMode(mode === 'end' ? 'none' : 'end')} className="text-[11px] font-extrabold text-[#5B6B8C]">{mode === 'end' ? 'Close' : 'Options'}</button>
          </div>
          <p className="text-[10.5px] font-bold text-[#8A8471] mt-0.5 m-0 leading-snug">Hand it on, donate it or retire it. It moves to the Memory Shelf — nothing is ever deleted.</p>
          {mode === 'end' && <EndForm kids={kids} busy={busy} onEnd={(how, opts) => run(() => cupboardEnd(familyId, item.id, how, opts))} />}
        </Card>
      )}

      {ended && (
        <Card tone="sky">
          <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">🕰 On the Memory Shelf</div>
          <p className="text-[11px] font-bold text-[#5B6B8C] mt-1 m-0">{STATUS_LABEL[item.status]}{item.endedOn ? ` · ${toDisplayDate(item.endedOn)}` : ''}{item.endedNote ? ` · ${item.endedNote}` : ''}</p>
        </Card>
      )}

      {err && <p className="text-[11.5px] text-[#C0392B] font-bold mb-2">{err}</p>}

      {/* The story so far */}
      <Card>
        <div className="font-display font-extrabold text-[12.5px] text-[#0F1F44]">📜 Its story so far</div>
        <div className="border-l-2 border-[#E4CDB2] ml-1.5 pl-3 mt-2">
          {events.slice().reverse().map((e) => (
            <div key={e.id} className="mb-2 relative">
              <span className="absolute -left-[17px] top-1 w-2 h-2 rounded-full" style={{ background: WOOD }} aria-hidden />
              <div className="text-[9.5px] font-extrabold text-[#8A8471] tracking-[.4px]">{toDisplayDate(e.on)} · {e.byName}</div>
              <div className="text-[11.5px] font-extrabold text-[#0F1F44] leading-snug">{EVENT_EMOJI[e.kind] || '•'} {e.note || e.kind}</div>
            </div>
          ))}
          {events.length === 0 && <p className="text-[11px] text-[#8A8471] m-0">Just arrived.</p>}
        </div>
      </Card>

      <div className="flex flex-wrap gap-2 mt-1">
        <Pill bg={WOOD_BG} fg={WOOD_DK} href="/sparks/treasures/cupboard">🗄 Cupboard</Pill>
        <Pill bg={JADE_BG} fg={JADE} href="/sparks/treasures/lost-found">🔍 Lost &amp; Found</Pill>
      </div>
    </CupboardFrame>
  );
}

// ── Small forms ─────────────────────────────────────────────────────

function NameConfirm({ item, busy, onSave }: { item: CupboardItem; busy: boolean; onSave: (name: string) => void }) {
  const [name, setName] = useState(item.name);
  return (
    <div className="mt-1.5">
      <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      <div className="flex gap-2 mt-2">
        <Pill bg={WOOD} fg="#fff" disabled={busy || !name.trim()} onClick={() => onSave(name.trim())}>✓ Confirm the name</Pill>
      </div>
    </div>
  );
}

function WhereKept({ value, canEdit, busy, onSave }: { value: string; canEdit: boolean; busy: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (!editing) {
    return (
      <p className="text-[11.3px] font-bold text-[#5B6B8C] mt-1 m-0 leading-snug">
        {value || 'Not written down yet'}
        {canEdit && <> · <button type="button" onClick={() => setEditing(true)} className="font-extrabold" style={{ color: WOOD_DK }}>{value ? 'change' : 'add'}</button></>}
      </p>
    );
  }
  return (
    <div className="mt-1.5">
      <input className={inputCls} value={v} onChange={(e) => setV(e.target.value)} placeholder="living-room cupboard, top shelf" maxLength={120} />
      <div className="flex gap-2 mt-2">
        <Pill bg={WOOD} fg="#fff" disabled={busy} onClick={() => { onSave(v.trim()); setEditing(false); }}>Save</Pill>
        <Pill bg="#EEF0F4" fg="#5B6B8C" onClick={() => { setV(value); setEditing(false); }}>Cancel</Pill>
      </div>
    </div>
  );
}

function DetailsEditor({ item, busy, onSave }: { item: CupboardItem; busy: boolean; onSave: (p: Parameters<typeof updateCupboardItem>[2]) => void }) {
  const kind = kindOf(item);
  const [author, setAuthor] = useState(item.book?.author || '');
  const [pages, setPages] = useState(item.book?.pages ? String(item.book.pages) : '');
  const [year, setYear] = useState(item.book?.year ? String(item.book.year) : '');
  const [ageMin, setAgeMin] = useState(String(item.book?.ageMin || item.game?.ageMin || ''));
  const [pMin, setPMin] = useState(item.game?.playersMin ? String(item.game.playersMin) : '');
  const [pMax, setPMax] = useState(item.game?.playersMax ? String(item.game.playersMax) : '');
  const [minutes, setMinutes] = useState(item.game?.minutes ? String(item.game.minutes) : '');
  const [gameKind, setGameKind] = useState<GameKind | undefined>(item.game?.gameKind);
  const [pieces, setPieces] = useState(item.game?.piecesNote || '');
  const digits = (s: string) => s.replace(/\D/g, '');
  return (
    <div className="mt-2">
      {kind === 'book' ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-3"><Field label="Author"><input className={inputCls} value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={120} /></Field></div>
          <Field label="Pages"><input className={inputCls} inputMode="numeric" value={pages} onChange={(e) => setPages(digits(e.target.value))} /></Field>
          <Field label="Year"><input className={inputCls} inputMode="numeric" value={year} onChange={(e) => setYear(digits(e.target.value).slice(0, 4))} /></Field>
          <Field label="Good for"><input className={inputCls} inputMode="numeric" value={ageMin} onChange={(e) => setAgeMin(digits(e.target.value))} placeholder="9+" /></Field>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Field label="Ages"><input className={inputCls} inputMode="numeric" value={ageMin} onChange={(e) => setAgeMin(digits(e.target.value))} placeholder="8+" /></Field>
            <Field label="Players from"><input className={inputCls} inputMode="numeric" value={pMin} onChange={(e) => setPMin(digits(e.target.value))} /></Field>
            <Field label="to"><input className={inputCls} inputMode="numeric" value={pMax} onChange={(e) => setPMax(digits(e.target.value))} /></Field>
            <Field label="Minutes"><input className={inputCls} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(digits(e.target.value))} /></Field>
          </div>
          <Field label="Kind"><ChoiceChips value={gameKind} onChange={setGameKind} options={GAME_KINDS.map((k) => ({ id: k.id, label: `${k.emoji} ${k.label}` }))} /></Field>
          <Field label="🧩 Pieces note"><input className={inputCls} value={pieces} onChange={(e) => setPieces(e.target.value)} placeholder="all there · one red pawn missing" maxLength={200} /></Field>
        </>
      )}
      <Pill bg={WOOD} fg="#fff" disabled={busy} onClick={() => onSave(kind === 'book'
        ? { book: { author: author.trim() || undefined, pages: pages ? Number(pages) : undefined, year: year ? Number(year) : undefined, ageMin: ageMin ? Number(ageMin) : undefined } }
        : { game: { ageMin: ageMin ? Number(ageMin) : undefined, playersMin: pMin ? Number(pMin) : undefined, playersMax: pMax ? Number(pMax) : undefined, minutes: minutes ? Number(minutes) : undefined, gameKind, piecesNote: pieces.trim() || undefined } })}>
        Save details
      </Pill>
    </div>
  );
}

function LendForm({ kids, busy, onLend }: { kids: Array<{ id: string; name: string; emoji: string }>; busy: boolean; onLend: (to: { toChildId?: string; toName: string; dueOn: string }) => void }) {
  const [toName, setToName] = useState('');
  const [toChildId, setToChildId] = useState('');
  const [dueOn, setDueOn] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 14); return todayIso(d); });
  return (
    <div className="mt-2 rounded-[12px] border border-[#E8E0CF] bg-[#FBF7EE] p-2.5">
      <Field label="To whom?">
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {kids.map((k) => (
            <button key={k.id} type="button" onClick={() => { setToChildId(k.id); setToName(k.name); }}
              className="text-[11px] font-extrabold px-2.5 py-1.5 rounded-full border-[1.5px] border-[#E8E0CF] bg-white text-[#0F1F44]"
              style={toChildId === k.id ? { background: '#5A3CB8', color: '#fff', borderColor: '#5A3CB8' } : undefined}>
              {k.emoji} {k.name}
            </button>
          ))}
        </div>
        <input className={inputCls} value={toName} onChange={(e) => { setToName(e.target.value); setToChildId(''); }} placeholder="a cousin, a friend, a neighbour" maxLength={60} />
      </Field>
      <Field label="Back by"><input type="date" className={inputCls} value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></Field>
      <Pill bg="#5A3CB8" fg="#fff" disabled={busy || !toName.trim()} onClick={() => onLend({ toChildId: toChildId || undefined, toName: toName.trim(), dueOn })}>🤝 Lend it</Pill>
    </div>
  );
}

function MissingForm({ defaultWhere, busy, onReport }: { defaultWhere: string; busy: boolean; onReport: (where: string) => void }) {
  const [where, setWhere] = useState(defaultWhere);
  return (
    <div className="mt-2 rounded-[12px] border border-[#F0C9CC] bg-[#FEF6F6] p-2.5">
      <Field label="Where was it last? (no one is in trouble — where helps us find it)">
        <input className={inputCls} value={where} onChange={(e) => setWhere(e.target.value)} placeholder="the car · grandma's · the garden" maxLength={120} />
      </Field>
      <Pill bg="#C0392B" fg="#fff" disabled={busy} onClick={() => onReport(where.trim())}>❓ Mark it missing</Pill>
    </div>
  );
}

function EndForm({ kids, busy, onEnd }: {
  kids: Array<{ id: string; name: string; emoji: string }>; busy: boolean;
  onEnd: (how: 'handed_on' | 'donated' | 'retired', opts: { toChildId?: string; note?: string }) => void;
}) {
  const [how, setHow] = useState<'handed_on' | 'donated' | 'retired'>('handed_on');
  const [toChildId, setToChildId] = useState(kids[0]?.id || '');
  const [note, setNote] = useState('');
  return (
    <div className="mt-2">
      <ChoiceChips value={how} onChange={setHow} options={[{ id: 'handed_on', label: '🤝 Hand on to a child' }, { id: 'donated', label: '💚 Donate' }, { id: 'retired', label: '🕰 Retire' }]} />
      {how === 'handed_on' && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {kids.map((k) => (
            <button key={k.id} type="button" onClick={() => setToChildId(k.id)}
              className="text-[11px] font-extrabold px-2.5 py-1.5 rounded-full border-[1.5px] border-[#E8E0CF] bg-white text-[#0F1F44]"
              style={toChildId === k.id ? { background: JADE, color: '#fff', borderColor: JADE } : undefined}>
              {k.emoji} {k.name}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="a note for its story (optional)" maxLength={400} /></div>
      <div className="mt-2"><Pill bg="#5B6B8C" fg="#fff" disabled={busy || (how === 'handed_on' && !toChildId)} onClick={() => onEnd(how, { toChildId: how === 'handed_on' ? toChildId : undefined, note: note.trim() || undefined })}>Do it</Pill></div>
    </div>
  );
}

function friendly(code: string): string {
  switch (code) {
    case 'forbidden': return 'Only a parent can do that.';
    case 'parents-only-name': return 'Only a parent can change a name.';
    case 'not-lent': return 'It isn’t lent out.';
    case 'already-ended': return 'It’s already on the Memory Shelf.';
    default: return 'That did not work — try again.';
  }
}
