'use client';

// Kaya Sparks · Treasures 2.0 — 🎡 the Game Night Picker (C5 · D38 · N6).
//
// Design screen 12. "Who's in?" chips → the games that fit tonight
// (ages · players · time) → 🎡 spin if undecided → "We played!" logs the
// play (playedCount · lastPlayedOn · who → gamesPlayed for the kids) and
// resets the 🕸 dust clock. The cadence lives in Cupboard settings and
// the cron pushes "Family fun tonight?" at that hour (C3).

import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { logPlay, gameFits, type CupboardShelf, type CupboardItem } from '@/lib/sparks/cupboard';
import { gameKindDef } from '@/lib/sparks/treasures';
import { Pill, WOOD, WOOD_DK, WOOD_BG, JADE } from './CupboardShell';

type Who = { id: string; label: string; age?: number };

export default function GameNightPicker({ familyId, shelf, games, onClose, onPlayed }: {
  familyId: string;
  shelf: CupboardShelf;
  games: CupboardItem[];
  onClose: () => void;
  onPlayed: (treasureId: string) => void;
}) {
  const { profile } = useAuth();
  const meLabel = profile?.displayName?.split(' ')[0] || (shelf.me.role === 'parent' ? 'Me' : 'Me');
  const people: Who[] = useMemo(() => {
    const list: Who[] = [];
    // The caller — a parent/helper counts as a grown-up; a kid is already in kids.
    if (shelf.me.role !== 'kid') list.push({ id: 'me', label: meLabel });
    for (const k of shelf.kids) list.push({ id: k.id, label: k.name, age: k.age });
    return list;
  }, [shelf, meLabel]);

  const [inIds, setInIds] = useState<Set<string>>(() => new Set(people.map((p) => p.id)));
  const [maxMin, setMaxMin] = useState<number | undefined>(60);
  const [spun, setSpun] = useState<CupboardItem | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const who = useMemo(() => {
    const ins = people.filter((p) => inIds.has(p.id));
    const ages = ins.map((p) => p.age).filter((a): a is number => typeof a === 'number');
    return { count: ins.length, minAge: ages.length ? Math.min(...ages) : undefined, names: ins.map((p) => p.label) };
  }, [people, inIds]);

  const live = games.filter((g) => !['handed_on', 'donated', 'sold', 'outgrown', 'retired', 'lost', 'lent'].includes(g.status));
  const judged = live.map((g) => ({ g, ...gameFits(g, who, maxMin) }));
  const fits = judged.filter((j) => j.fits).sort((a, b) => (a.g.lastPlayedOn || '').localeCompare(b.g.lastPlayedOn || ''));
  const nots = judged.filter((j) => !j.fits);

  function toggle(id: string) { setInIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }

  function spin() {
    if (!fits.length || spinning) return;
    setSpinning(true); setSpun(null);
    let i = 0;
    const order = fits.map((f) => f.g);
    const pick = order[Math.floor(Math.random() * order.length)];
    const tick = () => {
      setSpun(order[i % order.length]); i++;
      if (i < 12) setTimeout(tick, 90 + i * 18);
      else { setSpun(pick); setSpinning(false); }
    };
    tick();
  }

  async function played(g: CupboardItem) {
    if (busy) return;
    setBusy(true);
    try {
      const whoIn = people.filter((p) => inIds.has(p.id)).map((p) => p.id);
      await logPlay(familyId, g.id, whoIn);
      setDone(g.name);
      onPlayed(g.id);
    } finally { setBusy(false); }
  }

  const meta = (g: CupboardItem) => [g.game?.ageMin ? `${g.game.ageMin}+` : '', g.game?.playersMin ? `${g.game.playersMin}–${g.game.playersMax || g.game.playersMin}` : '', g.game?.minutes ? `${g.game.minutes} min` : '', g.game?.gameKind ? gameKindDef(g.game.gameKind).emoji : ''].filter(Boolean).join(' · ');

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="w-full sm:max-w-md lg:max-w-lg bg-[#FFFBF5] rounded-t-[22px] sm:rounded-[22px] max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 text-white rounded-t-[22px]" style={{ background: 'linear-gradient(135deg,#1F2A44 0%,#5B6B8C 100%)' }}>
          <div className="text-[10.5px] font-extrabold opacity-85">🎲 Family fun tonight?</div>
          <div className="font-display text-[18px] font-extrabold mt-0.5">🎡 Who&rsquo;s in?</div>
          <div className="text-[11px] opacity-90 mt-0.5">Kaya picks what fits — ages · players · time</div>
        </div>
        <div className="p-4">
          {done ? (
            <div className="rounded-[14px] border border-[#BFE3D8] bg-[#F1FAF7] p-4 text-center">
              <div className="text-[28px]">🎉</div>
              <div className="font-display font-extrabold text-[14px] text-[#0E6B5E] mt-1">We played {done}!</div>
              <p className="text-[11px] font-bold text-[#2C4A44] mt-1 mb-0">Logged for {who.names.join(', ') || 'the family'} — the Bookworm Wall, the Sunday Meeting line and the 🕸 dust clock all know.</p>
              <div className="mt-3"><Pill bg={JADE} fg="#fff" onClick={onClose}>Done</Pill></div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {people.map((p) => (
                  <button key={p.id} type="button" onClick={() => toggle(p.id)}
                    className="text-[11px] font-extrabold px-2.5 py-1.5 rounded-full border-[1.5px] border-[#E8E0CF] bg-white text-[#0F1F44]"
                    style={inIds.has(p.id) ? { background: JADE, color: '#fff', borderColor: JADE } : { opacity: 0.55, textDecoration: 'line-through' }}>
                    {p.label}{typeof p.age === 'number' ? ` ${p.age}` : ''}
                  </button>
                ))}
              </div>

              <div className="mt-3 rounded-[12px] border border-[#ECE4D3] bg-white p-2.5">
                <div className="text-[10.5px] font-extrabold tracking-[.5px] uppercase text-[#8A8471] mb-1.5">⏱ How long?</div>
                <div className="flex flex-wrap gap-1.5">
                  {([[20, '15–20 min'], [60, '30–60'], [undefined, 'the evening']] as Array<[number | undefined, string]>).map(([m, l]) => (
                    <button key={l} type="button" onClick={() => setMaxMin(m)} className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full border border-[#E8E0CF] bg-white text-[#5B6B8C]"
                      style={maxMin === m ? { background: WOOD, color: '#fff', borderColor: WOOD } : undefined}>{l}</button>
                  ))}
                </div>
              </div>

              <div className="mt-2.5 rounded-[12px] border border-[#BFE3D8] bg-[#F1FAF7] p-2.5">
                <div className="font-display font-extrabold text-[12px] text-[#0E6B5E]">Fits tonight ({fits.length})</div>
                {fits.length === 0 && <p className="text-[11px] font-bold text-[#2C4A44] mt-1 m-0">Nothing fits exactly — add someone back in, allow more time, or scan a new game.</p>}
                {fits.map(({ g }) => (
                  <div key={g.id} className="flex items-center gap-2 mt-1.5">
                    <span className="text-[16px]" aria-hidden>{g.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11.5px] font-extrabold text-[#0F1F44] leading-tight">{g.name}{spun?.id === g.id && !spinning ? ' 🎯' : ''}</div>
                      <div className="text-[10px] font-bold text-[#5B6B8C]">{meta(g)}{g.lastPlayedOn ? ` · last ${g.lastPlayedOn}` : ' · never played'}</div>
                    </div>
                    <button type="button" disabled={busy} onClick={() => played(g)} className="text-[10.5px] font-extrabold px-2.5 py-1 rounded-full text-white" style={{ background: JADE }}>We played ✓</button>
                  </div>
                ))}
              </div>

              {nots.length > 0 && (
                <div className="mt-2 rounded-[12px] border border-[#F0C9CC] bg-[#FEF6F6] p-2.5">
                  <div className="font-display font-extrabold text-[12px] text-[#0F1F44]">Not tonight</div>
                  {nots.slice(0, 6).map(({ g, why }) => (
                    <p key={g.id} className="text-[10.5px] font-bold text-[#5B6B8C] mt-1 m-0">{g.emoji} {g.name} — {why.join(' · ')}</p>
                  ))}
                </div>
              )}

              {fits.length > 1 && (
                <div className="mt-3 text-center">
                  <div className="w-[74px] h-[74px] rounded-full mx-auto grid place-items-center" style={{ background: 'conic-gradient(#0E6B5E 0 25%,#D4A847 25% 50%,#7B5CD6 50% 75%,#D64550 75% 100%)', transform: spinning ? 'rotate(720deg)' : 'none', transition: spinning ? 'transform 1.6s ease-out' : 'none' }}>
                    <div className="w-[30px] h-[30px] rounded-full bg-white grid place-items-center text-[14px]">🎡</div>
                  </div>
                  {spun && !spinning && <div className="font-display font-extrabold text-[13px] text-[#0F1F44] mt-2">🎯 {spun.name}!</div>}
                  <div className="flex justify-center gap-2 mt-2">
                    <Pill bg="#D4A847" fg="#3D2E08" disabled={spinning} onClick={spin}>{spun ? 'Spin again' : 'Spin!'}</Pill>
                    {spun && !spinning && <Pill bg={JADE} fg="#fff" disabled={busy} onClick={() => played(spun)}>We played {spun.name} ✓</Pill>}
                  </div>
                </div>
              )}

              <div className="flex justify-end mt-3"><Pill bg={WOOD_BG} fg={WOOD_DK} onClick={onClose}>Close</Pill></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
