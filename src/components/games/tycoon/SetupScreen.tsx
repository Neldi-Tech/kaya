'use client';

// Kaya Tycoon — setup. Theme, home country, board country (home + neighbours
// first), currency (home rule enforced), mode, lap limit, auctions, 2–6
// players. Emits a GameConfig to start the engine.

import { useMemo, useState } from 'react';
import {
  type GameConfig, type Theme, type Mode, type CurrencyKey, type PlayerSetup,
  PACKS, TOKENS, orderedCountries, NEIGHBOURS, availableCurrencies, ensureCurrency,
} from '@/lib/tycoon';

export default function SetupScreen({ onStart, variant = 'local' }: { onStart: (c: GameConfig) => void; variant?: 'local' | 'host' }) {
  const [theme, setTheme] = useState<Theme>('cities');
  const [homeCountry, setHomeCountry] = useState('tanzania');
  const [country, setCountry] = useState('tanzania');
  const [currency, setCurrency] = useState<CurrencyKey>('local');
  const [mode, setMode] = useState<Mode>('short');
  const [lapLimit, setLapLimit] = useState(3);
  const [auctions, setAuctions] = useState(true);
  const [players, setPlayers] = useState<PlayerSetup[]>([
    { name: 'Player 1', token: '🎩' }, { name: 'Player 2', token: '🐬' },
  ]);

  const homeKeys = useMemo(() => Object.keys(PACKS).filter((k) => k !== 'global'), []);
  const countryKeys = useMemo(() => orderedCountries(homeCountry), [homeCountry]);
  const currencies = availableCurrencies(theme, country, homeCountry);

  // keep the currency choice valid as theme/board/home change
  const fixCurrency = (t: Theme, c: string, h: string, cur: CurrencyKey) => setCurrency(ensureCurrency(cur, t, c, h));

  const selTheme = (t: Theme) => { setTheme(t); fixCurrency(t, country, homeCountry, currency); };
  const selHome = (h: string) => { setHomeCountry(h); fixCurrency(theme, country, h, currency); };
  const selCountry = (c: string) => { setCountry(c); fixCurrency(theme, c, homeCountry, currency); };

  const addPlayer = () => {
    if (players.length >= 6) return;
    const used = players.map((p) => p.token);
    setPlayers([...players, { name: `Player ${players.length + 1}`, token: TOKENS.find((t) => !used.includes(t)) || '🎲' }]);
  };
  const delPlayer = (i: number) => setPlayers(players.filter((_, j) => j !== i));
  const setName = (i: number, v: string) => setPlayers(players.map((p, j) => (j === i ? { ...p, name: v } : p)));
  const pickTok = (i: number, t: string) => {
    if (players.some((p, j) => j !== i && p.token === t)) return;
    setPlayers(players.map((p, j) => (j === i ? { ...p, token: t } : p)));
  };

  const awayNote = theme === 'cities' && country !== homeCountry;

  const start = () => onStart({ mode, theme, country, homeCountry, currency, lapLimit, auctions, players });

  return (
    <div className="kt-setup">
      <div className="kt-logo">KAYA TYCOON</div>
      <div className="kt-tag">🎲 Travel the worlds. Buy the cities. Become the family tycoon!</div>

      <div className="kt-card">
        <h3>1 · Pick your world 🌍</h3>
        <div className="kt-mode-row">
          <div className={`kt-mode${theme === 'cities' ? ' sel' : ''}`} onClick={() => selTheme('cities')} role="button" tabIndex={0}>
            <b>🌍 World Cities</b><small>Buy real cities. Pick the country below to make it feel like home!</small>
          </div>
          <div className={`kt-mode${theme === 'universe' ? ' sel' : ''}`} onClick={() => selTheme('universe')} role="button" tabIndex={0}>
            <b>🚀 Kaya Universe</b><small>Buy magical planets across the Kaya galaxy — from tiny Sprout to mighty Galaxia.</small>
          </div>
        </div>
        {theme === 'cities' && (
          <div style={{ marginTop: 14 }}>
            <div className="kt-pl-row" style={{ margin: '0 0 12px' }}>
              <span style={{ fontWeight: 700 }}>🏠 Home country:</span>
              <select value={homeCountry} onChange={(e) => selHome(e.target.value)}>
                {homeKeys.map((k) => <option key={k} value={k}>{PACKS[k].flag} {PACKS[k].label}</option>)}
              </select>
              <span style={{ fontSize: 12, opacity: 0.7 }}>(unlocks your local money)</span>
            </div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Board country:</div>
            <div className="kt-chips">
              {countryKeys.map((k) => {
                const neigh = (NEIGHBOURS[homeCountry] || []).includes(k);
                return (
                  <div key={k} className={`kt-chip${country === k ? ' sel' : ''}`} onClick={() => selCountry(k)} role="button" tabIndex={0}>
                    {k === homeCountry ? '🏠 ' : ''}{PACKS[k].flag} {PACKS[k].label}
                    {neigh && <small style={{ display: 'inline', opacity: 0.6 }}> neighbour</small>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="kt-card">
        <h3>2 · Choose your money 💰</h3>
        <div className="kt-chips">
          {currencies.map((c) => (
            <div key={c.key} className={`kt-chip${currency === c.key ? ' sel' : ''}`} onClick={() => setCurrency(c.key)} role="button" tabIndex={0}>
              {c.symbol ? `${c.symbol.trim()} ` : ''}{c.name}<small>{c.blurb}</small>
            </div>
          ))}
        </div>
        <div className="kt-small-note">
          {awayNote
            ? `Playing away from home (${PACKS[homeCountry].flag} ${PACKS[homeCountry].label}) — only US$ or Kaya Coins here.`
            : 'All prices & rents convert automatically and round to clean numbers.'}
        </div>
      </div>

      <div className="kt-card">
        <h3>3 · How to play</h3>
        <div className="kt-mode-row">
          <div className={`kt-mode${mode === 'short' ? ' sel' : ''}`} onClick={() => setMode('short')} role="button" tabIndex={0}>
            <b>⚡ Quick Trip</b><small>Shorter &amp; simpler — great for younger kids. Buy &amp; charge rent (no houses). Ends after a few laps or when someone runs out of money. Richest wins! ~20–30 min.</small>
          </div>
          <div className={`kt-mode${mode === 'long' ? ' sel' : ''}`} onClick={() => setMode('long')} role="button" tabIndex={0}>
            <b>🏆 Grand Tour</b><small>Full game — build houses &amp; hotels, mortgage, sell to players, Time-Out. Last tycoon standing wins! ~45–90 min.</small>
          </div>
        </div>
        {mode === 'short' && (
          <div className="kt-pl-row" style={{ marginTop: 14 }}>
            <span>Quick Trip ends after</span>
            <select value={lapLimit} onChange={(e) => setLapLimit(Number(e.target.value))}>
              <option value={2}>2 laps each</option>
              <option value={3}>3 laps each</option>
              <option value={4}>4 laps each</option>
            </select>
            <span>(or a broke player)</span>
          </div>
        )}
        <div className="kt-toggle-row">
          <div className={`kt-switch${auctions ? ' on' : ''}`} onClick={() => setAuctions(!auctions)} role="button" tabIndex={0} aria-pressed={auctions} />
          <div><b>Auctions</b> — if a player skips buying, everyone bids for it.</div>
        </div>
      </div>

      {variant === 'local' ? (
        <div className="kt-card">
          <h3>4 · Who&rsquo;s playing? <span style={{ fontSize: 13, fontWeight: 400 }}>(2–6 players)</span></h3>
          <div>
            {players.map((p, i) => (
              <div key={i} className="kt-pl-row">
                <input value={p.name} onChange={(e) => setName(i, e.target.value)} placeholder={`Player ${i + 1} name`} />
                <div className="kt-token-pick">
                  {TOKENS.map((t) => (
                    <div key={t} className={`kt-tok${p.token === t ? ' sel' : ''}`} onClick={() => pickTok(i, t)} role="button" tabIndex={0}>{t}</div>
                  ))}
                </div>
                {players.length > 2 && <button type="button" className="kt-btn-ghost" onClick={() => delPlayer(i)} style={{ padding: '8px 12px' }}>✕</button>}
              </div>
            ))}
          </div>
          {players.length < 6 && <button type="button" className="kt-btn-ghost" onClick={addPlayer} style={{ marginTop: 8 }}>＋ Add player</button>}
          <div className="kt-small-note">Pass the device around — each player takes their turn on the same screen.</div>
        </div>
      ) : (
        <div className="kt-card">
          <h3>4 · Players join next 📲</h3>
          <div className="kt-small-note">Create the room, then family &amp; guests join from their own devices (or add players on this device in the lobby).</div>
        </div>
      )}

      <button type="button" className="kt-btn-go" onClick={start} style={{ marginTop: 6 }}>{variant === 'host' ? '✓ Create room' : '▶ Start Game'}</button>
      <div className="kt-small-note" style={{ marginTop: 16 }}>
        An original Kaya family game. The mechanics are classic property-trading; all names, board &amp; art are original to Kaya.
      </div>
    </div>
  );
}
