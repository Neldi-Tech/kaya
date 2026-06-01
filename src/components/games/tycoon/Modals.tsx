'use client';

// Kaya Tycoon — all dialogs. Engine prompts (buy / auction / card / raise-cash
// / win) and UI overlays (manage / trade / tile info / investor / guide) render
// here. Win takes priority; otherwise an open UI overlay wins, else the prompt.

import { useState, type ReactNode } from 'react';
import {
  type GameState, GROUP_COLORS, COLOR_NAME, money, cv, calcRent, netWorth,
  tilesInGroup, countType, canBuild, canSellHouse, canMortgage, investorTips,
  cardDisplayText, deck as getDeck,
} from '@/lib/tycoon';

export type Overlay =
  | { kind: 'manage' }
  | { kind: 'trade' }
  | { kind: 'tileInfo'; tile: number }
  | { kind: 'investor'; pid: number }
  | { kind: 'guide' }
  | null;

interface ModalsProps {
  state: GameState;
  busy: boolean;
  overlay: Overlay;
  setOverlay: (o: Overlay) => void;
  onBuy: () => void; onDecline: () => void;
  onBid: (amt: number) => void; onPass: () => void;
  onApplyCard: () => void;
  onBuild: (i: number) => void; onSellHouse: (i: number) => void;
  onMortgage: (i: number) => void; onUnmortgage: (i: number) => void;
  onSell: (i: number, buyerId: number, price: number) => void;
  onRaiseSellHouse: (i: number) => void; onRaiseMortgage: (i: number) => void;
  onSettleDebt: () => void; onGiveUp: () => void;
  onPlayAgain: () => void;
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="kt-overlay"><div className="kt-modal">{children}</div></div>;
}

export default function Modals(props: ModalsProps) {
  const { state, busy, overlay, setOverlay } = props;
  const m = (v: number) => money(state.cur, v);
  const prompt = state.prompt;

  function rentTable(i: number): ReactNode {
    const t = state.board[i];
    if (t.type === 'prop') {
      return (
        <div className="kt-rent-table">
          <div><span>Rent</span><span>{m(t.rent![0])}</span></div>
          <div><span>Full colour set</span><span>{m(t.rent![0] * 2)}</span></div>
          {state.mode === 'long' && (
            <>
              <div><span>1 🏠</span><span>{m(t.rent![1])}</span></div>
              <div><span>2 🏠</span><span>{m(t.rent![2])}</span></div>
              <div><span>3 🏠</span><span>{m(t.rent![3])}</span></div>
              <div><span>4 🏠</span><span>{m(t.rent![4])}</span></div>
              <div><span>🏨 Hotel</span><span>{m(t.rent![5])}</span></div>
              <div><span>House cost</span><span>{m(t.houseCost!)} each</span></div>
            </>
          )}
        </div>
      );
    }
    if (t.type === 'airport') {
      return (
        <div className="kt-rent-table">
          <div><span>1 {state.themeRender.airportE}</span><span>{m(cv(state, 25))}</span></div>
          <div><span>2</span><span>{m(cv(state, 50))}</span></div>
          <div><span>3</span><span>{m(cv(state, 100))}</span></div>
          <div><span>4</span><span>{m(cv(state, 200))}</span></div>
        </div>
      );
    }
    return (
      <div className="kt-rent-table">
        <div><span>1 owned</span><span>4× dice</span></div>
        <div><span>2 owned</span><span>10× dice</span></div>
      </div>
    );
  }

  // ── WIN (top priority) ──────────────────────────────────────────────────
  if (prompt && prompt.kind === 'win') {
    const standings = state.players.slice().sort((a, b) => netWorth(state, b) - netWorth(state, a));
    const w = prompt.winnerId != null ? state.players[prompt.winnerId] : null;
    return (
      <Shell>
        <div className="kt-win-emoji">🏆</div>
        <h2>{w ? `${w.token} ${w.name}` : 'Nobody'} wins!</h2>
        <p style={{ color: '#888' }}>{prompt.reason}</p>
        <div className="kt-rent-table">
          {standings.map((pl) => (
            <div key={pl.id} style={{ opacity: pl.bankrupt ? 0.5 : 1 }}>
              <span>{pl.token} {pl.name}{pl.bankrupt ? ' (bankrupt)' : ''}</span>
              <span>{m(netWorth(state, pl))}</span>
            </div>
          ))}
        </div>
        <div className="kt-row">
          <button type="button" className="kt-btn-go" onClick={props.onPlayAgain}>🔄 Play Again</button>
        </div>
      </Shell>
    );
  }

  // ── UI overlays ───────────────────────────────────────────────────────────
  if (overlay) {
    if (overlay.kind === 'guide') return <GuideModal state={state} onClose={() => setOverlay(null)} />;
    if (overlay.kind === 'tileInfo') return <TileInfoModal state={state} i={overlay.tile} rentTable={rentTable} onClose={() => setOverlay(null)} />;
    if (overlay.kind === 'investor') return <InvestorModal state={state} pid={overlay.pid} onClose={() => setOverlay(null)} />;
    if (overlay.kind === 'trade') return <TradeModal {...props} />;
    if (overlay.kind === 'manage') return <ManageModal {...props} />;
  }

  if (!prompt) return null;

  // ── BUY ─────────────────────────────────────────────────────────────────
  if (prompt.kind === 'buy') {
    const i = prompt.tile; const t = state.board[i]; const p = state.players[state.current];
    const can = p.cash >= (t.price || 0);
    return (
      <Shell>
        {t.type === 'prop' && <div className="kt-cbar2" style={{ background: GROUP_COLORS[t.group!] }} />}
        <h2>{t.name}</h2>
        <p style={{ color: '#888' }}>Unclaimed — price <b>{m(t.price!)}</b></p>
        {rentTable(i)}
        <p>{p.token} <b>{p.name}</b>, you have {m(p.cash)}.</p>
        <div className="kt-row">
          <button type="button" className="kt-btn-buy" disabled={!can || busy} onClick={props.onBuy}>Buy for {m(t.price!)}</button>
          <button type="button" className="kt-btn-ghost" disabled={busy} onClick={props.onDecline}>{state.auctions ? 'Auction it' : 'Skip'}</button>
        </div>
        {!can && <p style={{ color: 'var(--kt-coral)', fontSize: 13 }}>Not enough cash — it goes to {state.auctions ? 'auction' : 'the next player'}.</p>}
      </Shell>
    );
  }

  // ── AUCTION ───────────────────────────────────────────────────────────────
  if (prompt.kind === 'auction' && state.auction) {
    const a = state.auction; const t = state.board[a.tile];
    const bidder = state.players[a.active[a.idx]];
    const steps = [cv(state, 10), cv(state, 50), cv(state, 100)];
    return (
      <Shell>
        {t.type === 'prop' && <div className="kt-cbar2" style={{ background: GROUP_COLORS[t.group!] }} />}
        <h2>🔨 Auction: {t.name}</h2>
        <p style={{ color: '#888' }}>List price {m(t.price!)}</p>
        <p>Highest bid: <b>{m(a.high)}</b> {a.highBidder !== null ? `by ${state.players[a.highBidder].token} ${state.players[a.highBidder].name}` : '(no bids yet)'}</p>
        <p style={{ fontSize: 17 }}>{bidder.token} <b style={{ color: bidder.color }}>{bidder.name}</b>, your move! (You have {m(bidder.cash)})</p>
        <div className="kt-row">
          {steps.map((inc) => {
            const amt = a.high + inc;
            return <button key={inc} type="button" className="kt-btn-buy" disabled={bidder.cash < amt || busy} onClick={() => props.onBid(amt)}>{m(amt)}</button>;
          })}
        </div>
        <div className="kt-row"><button type="button" className="kt-btn-ghost" disabled={busy} onClick={props.onPass}>Pass</button></div>
      </Shell>
    );
  }

  // ── CARD ────────────────────────────────────────────────────────────────
  if (prompt.kind === 'card') {
    const card = getDeck(prompt.deck)[prompt.cardIdx];
    return (
      <Shell>
        <h2>{prompt.deck === 'adventure' ? '❓ Adventure' : '🎁 Surprise'} Card</h2>
        <div className="kt-card-emoji">{card.t}</div>
        <p style={{ fontSize: 18 }}>{cardDisplayText(state, card)}</p>
        <div className="kt-row"><button type="button" className="kt-btn-primary" disabled={busy} onClick={props.onApplyCard}>OK</button></div>
      </Shell>
    );
  }

  // ── RAISE CASH ────────────────────────────────────────────────────────────
  if (prompt.kind === 'raiseCash' && state.pendingDebt) {
    const d = state.pendingDebt; const p = state.players[d.player];
    return (
      <Shell>
        <h2>💰 Raise Cash</h2>
        <p>{p.token} <b>{p.name}</b>, you owe <b>{m(d.amount)}</b> but have <b>{m(p.cash)}</b>.</p>
        <p style={{ fontSize: 13, color: '#888' }}>Sell houses or mortgage to cover it.</p>
        <div className="kt-build-list">
          {p.props.map((i) => {
            const t = state.board[i]; const h = state.houses[i] || 0;
            return (
              <div key={i} className="kt-build-item">
                <span className="kt-cbar2" style={{ width: 8, height: 24, background: t.type === 'prop' ? GROUP_COLORS[t.group!] : '#999', margin: 0 }} />
                <span className="kt-bi-name">{t.name}{state.mortgaged[i] ? ' 💤' : ''} {h === 5 ? '🏨' : '🏠'.repeat(h)}</span>
                {h > 0 && <button type="button" className="kt-btn-warn" disabled={busy} onClick={() => props.onRaiseSellHouse(i)}>Sell {h === 5 ? 'hotel' : 'house'} +{m(Math.floor((t.houseCost || 0) / 2))}</button>}
                {!state.mortgaged[i] && canMortgage(state, i) && <button type="button" className="kt-btn-ghost" disabled={busy} onClick={() => props.onRaiseMortgage(i)}>Mortgage +{m(t.mortgage || 0)}</button>}
              </div>
            );
          })}
        </div>
        <div className="kt-row">
          <button type="button" className="kt-btn-primary" disabled={p.cash < d.amount || busy} onClick={props.onSettleDebt}>Pay {m(d.amount)}</button>
          <button type="button" className="kt-btn-end" disabled={busy} onClick={props.onGiveUp}>Give up</button>
        </div>
      </Shell>
    );
  }

  return null;
}

// ── Manage (Grand Tour) ─────────────────────────────────────────────────────
function ManageModal(props: ModalsProps) {
  const { state, busy, setOverlay } = props;
  const m = (v: number) => money(state.cur, v);
  const p = state.players[state.current];
  return (
    <div className="kt-overlay"><div className="kt-modal">
      <h2>🏗️ Manage</h2>
      <p style={{ fontSize: 13, color: '#888' }}>{p.token} {p.name} · {m(p.cash)}</p>
      <div className="kt-build-list">
        {p.props.length === 0 && <p>You don&rsquo;t own anything yet — land on a city and buy it!</p>}
        {p.props.map((i) => {
          const t = state.board[i]; const h = state.houses[i] || 0;
          const unmortCost = Math.ceil((t.mortgage || 0) * 1.1);
          return (
            <div key={i} className="kt-build-item">
              <span className="kt-cbar2" style={{ width: 8, height: 24, background: t.type === 'prop' ? GROUP_COLORS[t.group!] : '#999', margin: 0 }} />
              <span className="kt-bi-name">{t.name}{state.mortgaged[i] ? ' 💤' : ''} {h === 5 ? '🏨' : '🏠'.repeat(h)}</span>
              {t.type === 'prop' && canBuild(state, i) && p.cash >= (t.houseCost || 0) && h < 5 && (
                <button type="button" className="kt-btn-buy" disabled={busy} onClick={() => props.onBuild(i)}>{h === 4 ? 'Hotel' : 'House'} {m(t.houseCost!)}</button>
              )}
              {canSellHouse(state, i) && (
                <button type="button" className="kt-btn-warn" disabled={busy} onClick={() => props.onSellHouse(i)}>Sell +{m(Math.floor((t.houseCost || 0) / 2))}</button>
              )}
              {!state.mortgaged[i] && canMortgage(state, i) && (
                <button type="button" className="kt-btn-ghost" disabled={busy} onClick={() => props.onMortgage(i)}>Mortgage +{m(t.mortgage || 0)}</button>
              )}
              {state.mortgaged[i] && p.cash >= unmortCost && (
                <button type="button" className="kt-btn-ghost" disabled={busy} onClick={() => props.onUnmortgage(i)}>Unmortgage -{m(unmortCost)}</button>
              )}
            </div>
          );
        })}
      </div>
      <div className="kt-row"><button type="button" className="kt-btn-ghost" onClick={() => setOverlay({ kind: 'trade' })}>🤝 Sell a city to a player</button></div>
      <div className="kt-row"><button type="button" className="kt-btn-primary" onClick={() => setOverlay(null)}>Done</button></div>
    </div></div>
  );
}

// ── Trade ─────────────────────────────────────────────────────────────────
function TradeModal(props: ModalsProps) {
  const { state, busy, setOverlay, onSell } = props;
  const m = (v: number) => money(state.cur, v);
  const p = state.players[state.current];
  const sellable = p.props.filter((i) => (state.houses[i] || 0) === 0);
  const buyers = state.players.filter((o) => o.id !== p.id && !o.bankrupt);
  const [city, setCity] = useState<number>(sellable[0] ?? -1);
  const [buyerId, setBuyerId] = useState<number>(buyers[0]?.id ?? -1);
  const [price, setPrice] = useState<number>(cv(state, 100));
  const [confirm, setConfirm] = useState(false);

  if (sellable.length === 0) {
    return <div className="kt-overlay"><div className="kt-modal">
      <h2>🤝 Sell a City</h2>
      <p>No cities without buildings to sell — sell buildings first.</p>
      <div className="kt-row"><button type="button" className="kt-btn-ghost" onClick={() => setOverlay({ kind: 'manage' })}>Back</button></div>
    </div></div>;
  }
  const c = sellable.includes(city) ? city : sellable[0];
  const b = buyers.some((x) => x.id === buyerId) ? buyerId : buyers[0]?.id;
  const buyer = state.players[b];

  if (confirm && buyer) {
    return <div className="kt-overlay"><div className="kt-modal">
      <h2>Confirm</h2>
      <p>{buyer.token} <b>{buyer.name}</b>, accept buying <b>{state.board[c].name}</b> for <b>{m(price)}</b>?</p>
      <div className="kt-row">
        <button type="button" className="kt-btn-buy" disabled={busy} onClick={() => { onSell(c, b, price); setOverlay({ kind: 'manage' }); }}>Accept</button>
        <button type="button" className="kt-btn-ghost" onClick={() => setConfirm(false)}>Decline</button>
      </div>
    </div></div>;
  }

  return <div className="kt-overlay"><div className="kt-modal">
    <h2>🤝 Sell a City</h2>
    <div style={{ textAlign: 'left', margin: '10px 0' }}>
      <label>City:</label><br />
      <select style={{ width: '100%', margin: '4px 0' }} value={c} onChange={(e) => setCity(Number(e.target.value))}>
        {sellable.map((i) => <option key={i} value={i}>{state.board[i].name}{state.mortgaged[i] ? ' (mortgaged)' : ''}</option>)}
      </select><br />
      <label>Buyer:</label><br />
      <select style={{ width: '100%', margin: '4px 0' }} value={b} onChange={(e) => setBuyerId(Number(e.target.value))}>
        {buyers.map((o) => <option key={o.id} value={o.id}>{o.token} {o.name} ({m(o.cash)})</option>)}
      </select><br />
      <label>Price:</label><br />
      <input type="number" min={0} style={{ width: '100%' }} value={price} onChange={(e) => setPrice(Math.max(0, parseInt(e.target.value, 10) || 0))} />
    </div>
    <div className="kt-row">
      <button type="button" className="kt-btn-buy" disabled={!buyer || busy} onClick={() => setConfirm(true)}>Offer Sale</button>
      <button type="button" className="kt-btn-ghost" onClick={() => setOverlay({ kind: 'manage' })}>Back</button>
    </div>
  </div></div>;
}

// ── Tile info ────────────────────────────────────────────────────────────
function TileInfoModal({ state, i, rentTable, onClose }: { state: GameState; i: number; rentTable: (i: number) => ReactNode; onClose: () => void }) {
  const m = (v: number) => money(state.cur, v);
  const t = state.board[i]; const C = state.themeRender.corners;
  const icon = (() => {
    if (t.type === 'airport') return state.themeRender.airportE;
    if (t.type === 'utility') return state.themeRender.utilE[i];
    if (t.type === 'card') return t.deck === 'adventure' ? '❓' : '🎁';
    if (t.type === 'tax') return '💸';
    if (t.type === 'start') return C.start.e;
    if (t.type === 'jail') return C.jail.e;
    if (t.type === 'parking') return C.parking.e;
    if (t.type === 'gotojail') return C.gotojail.e;
    return '🏙️';
  })();

  if (['start', 'jail', 'parking', 'gotojail', 'card', 'tax'].includes(t.type)) {
    const desc: Record<string, string> = {
      start: `Pass or land here to collect ${m(state.passGo)}.`,
      jail: `Just passing is safe. Sent here? Roll a double to escape (or pay ${m(cv(state, 50))} after 3 tries).`,
      parking: `A free rest. ${state.parkingPot > 0 ? `Land here to win the ${m(state.parkingPot)} pot!` : 'No bonus pot right now.'}`,
      gotojail: `Land here and you're sent straight to ${C.jail.l} — no ${m(state.passGo)}!`,
      card: t.deck === 'adventure' ? 'Draw an Adventure card — could be good or tricky!' : 'Draw a Surprise card — a little luck awaits!',
      tax: `Pay ${m(t.amount || 0)} to the bank (it adds to the ${C.parking.l} pot).`,
    };
    return <div className="kt-overlay"><div className="kt-modal">
      <h2>{icon} {t.name}</h2>
      <p>{desc[t.type]}</p>
      <div className="kt-row"><button type="button" className="kt-btn-primary" onClick={onClose}>Got it</button></div>
    </div></div>;
  }

  const owner = state.owners[i]; const h = state.houses[i] || 0;
  return <div className="kt-overlay"><div className="kt-modal">
    {t.type === 'prop' && <div className="kt-cbar2" style={{ background: GROUP_COLORS[t.group!] }} />}
    <h2>{icon} {t.name}</h2>
    {owner === undefined ? (
      <p style={{ color: '#888' }}>Unclaimed — anyone can buy it for {m(t.price!)}.</p>
    ) : (
      <p>
        Owned by {state.players[owner].token} <b style={{ color: state.players[owner].color }}>{state.players[owner].name}</b>
        {state.mortgaged[i] ? ' · 💤 mortgaged (no rent)' : ''}
        {t.type === 'prop' && <><br />{h === 5 ? '🏨 Hotel built' : h > 0 ? `${'🏠'.repeat(h)} ${h} house${h > 1 ? 's' : ''}` : 'No houses yet'}</>}
      </p>
    )}
    {rentTable(i)}
    <div className="kt-row"><button type="button" className="kt-btn-primary" onClick={onClose}>Close</button></div>
  </div></div>;
}

// ── Investor Coach ──────────────────────────────────────────────────────────
function InvestorModal({ state, pid, onClose }: { state: GameState; pid: number; onClose: () => void }) {
  const m = (v: number) => money(state.cur, v);
  const p = state.players[pid];
  const word = state.theme === 'universe' ? 'planets' : 'cities';
  const tips = investorTips(state, p);
  return <div className="kt-overlay"><div className="kt-modal">
    <h2>{p.token} {p.name}</h2>
    <p style={{ color: '#888' }}>💵 {m(p.cash)}{state.mode === 'long' ? ` · 🏦 worth ${m(netWorth(state, p))}` : ''} · {p.props.length} {word}</p>
    <div style={{ textAlign: 'left', margin: '10px 0' }}>
      <h3 style={{ fontSize: 14, marginBottom: 6 }}>Holdings</h3>
      {p.props.length === 0 ? <p style={{ opacity: 0.7 }}>No {word} owned yet.</p> : p.props.map((i) => {
        const t = state.board[i]; const h = state.houses[i] || 0;
        return (
          <div key={i} className="kt-holding">
            <span style={{ width: 8, height: 18, background: t.type === 'prop' ? GROUP_COLORS[t.group!] : '#999', borderRadius: 3 }} />
            <b>{t.name}</b>{state.mortgaged[i] ? ' 💤' : ''} {h === 5 ? '🏨' : '🏠'.repeat(h)}
            <span style={{ marginLeft: 'auto', color: '#888' }}>{m(t.price!)}</span>
          </div>
        );
      })}
    </div>
    <h3 style={{ fontSize: 14, textAlign: 'left' }}>💡 Investor coach</h3>
    {tips.map((tp, idx) => <div key={idx} className="kt-invest-tip">{tp}</div>)}
    <div className="kt-row"><button type="button" className="kt-btn-primary" onClick={onClose}>Close</button></div>
  </div></div>;
}

// ── How to play ─────────────────────────────────────────────────────────────
function GuideModal({ state, onClose }: { state: GameState; onClose: () => void }) {
  const m = (v: number) => money(state.cur, v);
  const word = state.theme === 'universe' ? 'planets' : 'cities';
  const single = word.slice(0, -1);
  const C = state.themeRender.corners;
  return <div className="kt-overlay"><div className="kt-modal">
    <h2>❓ How to play Kaya Tycoon</h2>
    <div style={{ textAlign: 'left', fontSize: 14, lineHeight: 1.55 }}>
      <p>🎲 <b>1. Roll the dice</b> and watch your token hop around the board — count along!</p>
      <p>🏙️ <b>2. Land on a free {single}?</b> Buy it! You then collect rent when others land there.</p>
      <p>🌈 <b>3. Collect a whole colour set</b> to double your rent{state.mode === 'long' ? ' and build houses 🏠 and hotels 🏨 for huge rent.' : '.'}</p>
      <p>💵 <b>4. Pass {C.start.l}</b> to collect {m(state.passGo)} every lap.</p>
      <p>{C.gotojail.e} <b>5. {C.gotojail.l.replace('GO TO ', '')}!</b> Roll a double to get out, or pay {m(cv(state, 50))}.</p>
      {state.auctions && <p>🔨 <b>Auctions:</b> if someone skips buying, everyone bids — highest bid wins!</p>}
      <p>🏆 <b>Goal:</b> {state.mode === 'short' ? 'Be the richest when the game ends after the chosen laps!' : 'Be the last tycoon standing — bankrupt everyone else!'}</p>
      <p style={{ opacity: 0.7 }}>💡 Tip: tap any tile for details, or tap a player to see their {word} and get coaching.</p>
    </div>
    <div className="kt-row"><button type="button" className="kt-btn-primary" onClick={onClose}>Let&rsquo;s play!</button></div>
  </div></div>;
}
