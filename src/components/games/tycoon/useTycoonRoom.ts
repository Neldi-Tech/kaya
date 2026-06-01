'use client';

// Kaya Tycoon — networked orchestrator for the PLAYING phase of a room.
// Hydrates GameState from the live session (config + snapshot), replays the
// broadcast `events` whenever the room's seq advances (so token hops / dice /
// flashes / confetti animate on EVERY device), and enforces turn authority:
// a device may act only for the seat the engine is currently waiting on, and
// only if it owns that seat (remote) or is the host driving a local seat.
//
// The pure engine (src/lib/tycoon) is unchanged; this just wires it to
// Firestore. Lobby/seat writes live in TycoonRoom; this hook is play-time only.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type GameState, type GameEvent, type GameConfig, type TycoonSnapshot, type Seat,
  money, STEP_MS, hydrate, serialize, controlsSeat, activeSeatIndex,
  roll, buyProperty, declineBuy, bid, passBid, applyCard, build, sellHouse,
  mortgage, unmortgage, sellToPlayer, raiseSellHouse, raiseMortgage, settleDebt, giveUp, endTurn,
} from '@/lib/tycoon';
import { updateSession, type GameSession } from '@/lib/gameSessions';
import type { ActionResult } from '@/lib/tycoon';

interface RoomState {
  config?: GameConfig; snap?: TycoonSnapshot; events?: GameEvent[]; seq?: number; seats?: Seat[]; log?: string[];
}
const sleep = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

export function useTycoonRoom(session: GameSession | null, familyId: string, myUid: string) {
  const rs = (session?.state || {}) as RoomState;
  const config = rs.config || null;
  const snap = rs.snap || null;
  const seats = rs.seats || [];
  const seq = rs.seq || 0;
  const log = rs.log || [];
  const hostUid = session?.hostUid || '';

  const [state, setState] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [animPos, setAnimPos] = useState<number | null>(null);
  const [moverCount, setMoverCount] = useState<number | null>(null);
  const [dice, setDice] = useState<{ d1: number; d2: number; seq: number } | null>(null);
  const [flash, setFlash] = useState<{ emoji: string; text: string; id: number } | null>(null);
  const [confettiSignal, setConfettiSignal] = useState(0);

  const stateRef = useRef<GameState | null>(null);
  const seqRef = useRef(0);          // unique id for flash/dice remount
  const playedSeqRef = useRef(0);    // last room seq we've animated/committed
  const busyRef = useRef(false);

  const fireFlash = useCallback((emoji: string, text: string) => {
    seqRef.current += 1; setFlash({ emoji, text, id: seqRef.current });
  }, []);

  const playEvents = useCallback(async (events: GameEvent[], cur: GameState['cur'], passGo: number) => {
    for (const e of events) {
      if (e.type === 'dice') { seqRef.current += 1; setDice({ d1: e.d1, d2: e.d2, seq: seqRef.current }); }
      else if (e.type === 'flash') { fireFlash(e.emoji, e.text); await sleep(360); }
      else if (e.type === 'confetti') { setConfettiSignal((n) => n + 1); }
      else if (e.type === 'move') {
        for (let k = 0; k < e.path.length; k += 1) {
          setAnimPos(e.path[k]); setMoverCount(k + 1);
          if (e.salaryAt.includes(k)) fireFlash('💵', `+${money(cur, passGo)}`);
          // eslint-disable-next-line no-await-in-loop
          await sleep(STEP_MS);
        }
        setMoverCount(null);
      }
    }
  }, [fireFlash]);

  // Sync: when the room's seq advances, replay the broadcast events then commit.
  useEffect(() => {
    if (!config || !snap) return; // still in the lobby
    if (seq === playedSeqRef.current && stateRef.current) return; // already current
    let cancelled = false;
    (async () => {
      const incoming = hydrate(config, snap);
      const isNew = seq > playedSeqRef.current;
      if (stateRef.current && isNew && rs.events && rs.events.length) {
        busyRef.current = true; setBusy(true);
        await playEvents(rs.events, incoming.cur, incoming.passGo);
        if (cancelled) return;
        busyRef.current = false; setBusy(false);
      }
      stateRef.current = incoming; setState(incoming);
      setAnimPos(null); setMoverCount(null);
      playedSeqRef.current = seq;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, config, snap]);

  // Apply a local engine action: animate optimistically, commit, broadcast.
  const act = useCallback(async (result: ActionResult) => {
    const prev = stateRef.current;
    if (!prev || !session || busyRef.current) return;
    if (result.state === prev && result.events.length === 0) return; // no-op
    busyRef.current = true; setBusy(true);
    const newSeq = seq + 1;
    playedSeqRef.current = newSeq; // claim so the Firestore echo doesn't replay
    await playEvents(result.events, prev.cur, prev.passGo);
    stateRef.current = result.state; setState(result.state);
    setAnimPos(null); setMoverCount(null);
    busyRef.current = false; setBusy(false);
    const newLog = [...log, ...result.events.filter((e): e is Extract<GameEvent, { type: 'log' }> => e.type === 'log').map((e) => e.html)].slice(-60);
    try {
      await updateSession(familyId, session.id, {
        state: { config, snap: serialize(result.state), events: result.events, seq: newSeq, seats, log: newLog },
        status: result.state.over ? 'done' : 'playing',
      });
    } catch { /* a retry happens on the next action; UI already moved */ }
  }, [seq, config, seats, familyId, session, log, playEvents]);

  // Turn authority for the seat the engine is currently waiting on.
  const canAct = !!state && controlsSeat(seats, activeSeatIndex(state), myUid, hostUid);
  const run = (make: (s: GameState) => ActionResult) => () => {
    const s = stateRef.current;
    if (!s || busyRef.current || !canAct) return;
    void act(make(s));
  };

  return {
    state, seats, hostUid, log, busy, canAct,
    animPos, moverCount, dice, flash, confettiSignal,
    doRoll: run((s) => roll(s)),
    doBuy: run((s) => buyProperty(s)),
    doDecline: run((s) => declineBuy(s)),
    doBid: (amt: number) => run((s) => bid(s, amt))(),
    doPass: run((s) => passBid(s)),
    doApplyCard: run((s) => applyCard(s)),
    doBuild: (i: number) => run((s) => build(s, i))(),
    doSellHouse: (i: number) => run((s) => sellHouse(s, i))(),
    doMortgage: (i: number) => run((s) => mortgage(s, i))(),
    doUnmortgage: (i: number) => run((s) => unmortgage(s, i))(),
    doSell: (i: number, buyerId: number, price: number) => run((s) => sellToPlayer(s, i, buyerId, price))(),
    doRaiseSellHouse: (i: number) => run((s) => raiseSellHouse(s, i))(),
    doRaiseMortgage: (i: number) => run((s) => raiseMortgage(s, i))(),
    doSettleDebt: run((s) => settleDebt(s)),
    doGiveUp: run((s) => giveUp(s)),
    doEndTurn: run((s) => endTurn(s)),
  };
}

export type TycoonRoomController = ReturnType<typeof useTycoonRoom>;
