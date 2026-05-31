'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { GameProps } from './types';

// Make as many words as you can from 7 letters in 60 seconds. Each rack
// carries its own word list; a runtime letter-availability check guards
// against any mis-listed word, so it can never accept the impossible.

const DURATION = 60;

const RACKS: { letters: string; words: string[] }[] = [
  { letters: 'TEACHRS', words: ['teach', 'reach', 'chase', 'share', 'cheat', 'trace', 'crate', 'chart', 'char', 'cash', 'rash', 'star', 'arts', 'rats', 'cats', 'cars', 'scar', 'care', 'race', 'rate', 'tear', 'heat', 'hear', 'ear', 'eat', 'tea', 'ate', 'sea', 'set', 'the', 'hat', 'cat', 'car', 'art', 'ash', 'has', 'sat', 'rat', 'tar'] },
  { letters: 'PRINTED', words: ['print', 'tried', 'tired', 'pride', 'diner', 'rind', 'ride', 'ripe', 'pine', 'dine', 'dirt', 'drip', 'trip', 'pint', 'rent', 'nerd', 'tend', 'tin', 'ten', 'pen', 'pet', 'net', 'red', 'rip', 'tip', 'pit', 'dip', 'din', 'end', 'pie', 'tie', 'die', 'pin', 'rid'] },
  { letters: 'STORMED', words: ['stored', 'sorted', 'modest', 'store', 'storm', 'term', 'torn', 'tore', 'rote', 'most', 'dorm', 'rest', 'rode', 'more', 'mode', 'dome', 'dose', 'rose', 'sore', 'rod', 'rot', 'ore', 'toe', 'doe', 'met', 'set', 'red', 'sod', 'dot', 'mod'] },
  { letters: 'BLANKET', words: ['blanket', 'ankle', 'blank', 'table', 'bean', 'lean', 'lent', 'tale', 'late', 'bake', 'lake', 'take', 'bank', 'tank', 'bent', 'teal', 'ten', 'net', 'ant', 'eat', 'ate', 'tea', 'ban', 'bat', 'bet', 'let', 'lab', 'tab', 'ale', 'elk'] },
];

function canMake(word: string, letters: string): boolean {
  const avail: Record<string, number> = {};
  for (const ch of letters.toUpperCase()) avail[ch] = (avail[ch] || 0) + 1;
  for (const ch of word.toUpperCase()) {
    if (!avail[ch]) return false;
    avail[ch] -= 1;
  }
  return true;
}

export default function WordSprint({ onComplete }: GameProps) {
  const [rack] = useState(() => RACKS[Math.floor(Math.random() * RACKS.length)]);
  const valid = useMemo(
    () => new Set(rack.words.filter((w) => canMake(w, rack.letters)).map((w) => w.toLowerCase())),
    [rack],
  );
  const [input, setInput] = useState('');
  const [found, setFound] = useState<string[]>([]);
  const [left, setLeft] = useState(DURATION);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState('Spell words with these letters');

  useEffect(() => {
    if (done) return;
    if (left <= 0) { setDone(true); return; }
    const t = window.setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left, done]);

  useEffect(() => {
    if (done) {
      const t = window.setTimeout(
        () => onComplete({ success: found.length > 0, score: found.length, message: found.length > 0 ? `${found.length} words! 🎉` : "Time's up! Try again" }),
        300,
      );
      return () => window.clearTimeout(t);
    }
  }, [done, found.length, onComplete]);

  const submit = useCallback((e?: FormEvent) => {
    e?.preventDefault();
    const w = input.trim().toLowerCase();
    setInput('');
    if (w.length < 3) { setMsg('Words need 3+ letters'); return; }
    if (found.includes(w)) { setMsg(`Already found "${w}"`); return; }
    if (valid.has(w) && canMake(w, rack.letters)) { setFound((f) => [w, ...f]); setMsg(`✓ Nice — "${w}"`); }
    else setMsg(`"${w}" isn't in this puzzle`);
  }, [input, found, valid, rack.letters]);

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-games-ink-soft">Found: {found.length}</span>
        <span className="text-xs font-bold text-games-ink-soft">⏱ {left}s</span>
      </div>
      <div className="flex justify-center gap-1.5 mb-4">
        {rack.letters.split('').map((ch, i) => (
          <span key={i} className="w-9 h-10 rounded-kaya-sm bg-gradient-to-br from-games-violet to-games-violet-deep text-white font-display font-black flex items-center justify-center text-lg">
            {ch}
          </span>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2 mb-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="type a word"
          autoCapitalize="none"
          autoCorrect="off"
          className="flex-1 bg-games-card rounded-kaya px-3 py-2.5 text-sm font-bold text-games-ink outline-none shadow-[0_4px_12px_rgba(26,18,64,0.06)]"
        />
        <button type="submit" className="bg-games-violet text-white font-extrabold px-4 rounded-kaya">Add</button>
      </form>
      <p className="text-[11px] font-semibold text-games-ink-soft mb-3 h-4">{msg}</p>
      <div className="flex flex-wrap gap-1.5">
        {found.map((w) => (
          <span key={w} className="bg-games-mint text-games-ink text-[11px] font-bold px-2 py-1 rounded-full">{w}</span>
        ))}
      </div>
    </div>
  );
}
