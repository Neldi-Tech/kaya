'use client';

// Kaya Tycoon — React orchestrator. Holds the engine GameState and turns each
// action's emitted `events` into a timed animation (token hops, dice shake,
// centre flashes, confetti) before committing the next state. The engine
// (src/lib/tycoon) stays pure; this hook is the only place timers live.

import { useCallback, useRef, useState } from 'react';
import {
  type GameState, type GameConfig, type GameEvent, type ActionResult, type Rng,
  createGame, money, STEP_MS,
  roll, buyProperty, declineBuy, bid, passBid, applyCard,
  build, sellHouse, mortgage, unmortgage, sellToPlayer,
  raiseSellHouse, raiseMortgage, settleDebt, giveUp, endTurn,
} from '@/lib/tycoon';

export interface FlashState { emoji: string; text: string; id: number }
export interface DiceState { d1: number; d2: number; seq: number }

const sleep = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

export function useTycoon() {
  const [state, setState] = useState<GameState | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [animPos, setAnimPos] = useState<number | null>(null);
  const [moverCount, setMoverCount] = useState<number | null>(null);
  const [dice, setDice] = useState<DiceState | null>(null);
  const [flash, setFlash] = useState<FlashState | null>(null);
  const [confettiSignal, setConfettiSignal] = useState(0);

  const stateRef = useRef<GameState | null>(null);
  const busyRef = useRef(false);
  const seqRef = useRef(0);
  const rng = useRef<Rng>(Math.random);

  const commit = useCallback((next: GameState) => { stateRef.current = next; setState(next); }, []);

  const fireFlash = useCallback((emoji: string, text: string) => {
    seqRef.current += 1;
    setFlash({ emoji, text, id: seqRef.current });
  }, []);

  // Walk an action's events as a timed sequence, then commit the next state.
  const play = useCallback(async (events: GameEvent[], cur: GameState['cur'], passGo: number) => {
    for (const e of events) {
      if (e.type === 'log') {
        setLog((l) => [...l, e.html]);
      } else if (e.type === 'dice') {
        seqRef.current += 1;
        setDice({ d1: e.d1, d2: e.d2, seq: seqRef.current });
      } else if (e.type === 'flash') {
        fireFlash(e.emoji, e.text);
        await sleep(360);
      } else if (e.type === 'confetti') {
        setConfettiSignal((n) => n + 1);
      } else if (e.type === 'move') {
        for (let k = 0; k < e.path.length; k += 1) {
          setAnimPos(e.path[k]);
          setMoverCount(k + 1);
          if (e.salaryAt.includes(k)) fireFlash('💵', `+${money(cur, passGo)}`);
          // eslint-disable-next-line no-await-in-loop
          await sleep(STEP_MS);
        }
        setMoverCount(null);
      }
    }
  }, [fireFlash]);

  const run = useCallback(async (result: ActionResult) => {
    const prev = stateRef.current;
    if (!prev || busyRef.current) return;
    // No-op actions return the same reference + no events; skip the busy churn.
    if (result.state === prev && result.events.length === 0) return;
    busyRef.current = true; setBusy(true);
    await play(result.events, prev.cur, prev.passGo);
    commit(result.state);
    setAnimPos(null); setMoverCount(null);
    busyRef.current = false; setBusy(false);
  }, [play, commit]);

  // ── lifecycle ───────────────────────────────────────────────────────────
  const start = useCallback((config: GameConfig) => {
    const g = createGame(config);
    stateRef.current = g; setState(g);
    setAnimPos(null); setMoverCount(null); setDice(null); setFlash(null);
    setLog([
      `🎉 Kaya Tycoon — ${g.sub} · ${g.mode === 'short' ? 'Quick Trip' : 'Grand Tour'}!`,
      `${g.players.length} players, ${money(g.cur, g.startCash)} each in ${g.cur.name}. ${g.players[0].name} goes first.`,
    ]);
  }, []);

  const reset = useCallback(() => {
    stateRef.current = null; setState(null);
    setLog([]); setAnimPos(null); setMoverCount(null); setDice(null); setFlash(null);
    busyRef.current = false; setBusy(false);
  }, []);

  // ── dispatchers (each reads the latest committed state) ──────────────────
  const cur = () => stateRef.current!;
  const doRoll = useCallback(() => { run(roll(cur(), rng.current)); }, [run]);
  const doBuy = useCallback(() => { run(buyProperty(cur())); }, [run]);
  const doDecline = useCallback(() => { run(declineBuy(cur())); }, [run]);
  const doBid = useCallback((amount: number) => { run(bid(cur(), amount)); }, [run]);
  const doPass = useCallback(() => { run(passBid(cur())); }, [run]);
  const doApplyCard = useCallback(() => { run(applyCard(cur(), rng.current)); }, [run]);
  const doBuild = useCallback((i: number) => { run(build(cur(), i)); }, [run]);
  const doSellHouse = useCallback((i: number) => { run(sellHouse(cur(), i)); }, [run]);
  const doMortgage = useCallback((i: number) => { run(mortgage(cur(), i)); }, [run]);
  const doUnmortgage = useCallback((i: number) => { run(unmortgage(cur(), i)); }, [run]);
  const doSell = useCallback((i: number, buyerId: number, price: number) => { run(sellToPlayer(cur(), i, buyerId, price)); }, [run]);
  const doRaiseSellHouse = useCallback((i: number) => { run(raiseSellHouse(cur(), i)); }, [run]);
  const doRaiseMortgage = useCallback((i: number) => { run(raiseMortgage(cur(), i)); }, [run]);
  const doSettleDebt = useCallback(() => { run(settleDebt(cur())); }, [run]);
  const doGiveUp = useCallback(() => { run(giveUp(cur())); }, [run]);
  const doEndTurn = useCallback(() => { run(endTurn(cur())); }, [run]);

  return {
    state, log, busy, animPos, moverCount, dice, flash, confettiSignal,
    start, reset,
    doRoll, doBuy, doDecline, doBid, doPass, doApplyCard,
    doBuild, doSellHouse, doMortgage, doUnmortgage, doSell,
    doRaiseSellHouse, doRaiseMortgage, doSettleDebt, doGiveUp, doEndTurn,
  };
}

export type TycoonController = ReturnType<typeof useTycoon>;
