'use client';

import { useRef, useState } from 'react';

// Section 11 — Interactive Demo. The Smith family, in-memory only. Award
// buttons bump points (with a pop + floating flyer); the Hive block
// converts 100 points → 1 Honey Coin and fills the jar. No Firestore.

type Kid = 'mia' | 'leo' | 'theo';
type FlyerKind = 'plus' | 'minus' | 'kind';
type Flyer = { id: number; kind: FlyerKind; label: string; left: number; top: number };

const HOUSES: {
  kid: Kid;
  cls: string;
  badge: string;
  name: string;
  avatar: string;
  streak: string;
}[] = [
  { kid: 'mia', cls: 'gold', badge: 'Golden House', name: 'Mia, 9', avatar: '👧', streak: '7-day streak 🔥' },
  { kid: 'leo', cls: 'white', badge: 'White House', name: 'Leo, 7', avatar: '🧒', streak: '3-day streak ✨' },
  { kid: 'theo', cls: 'silver', badge: 'Silver House', name: 'Theo, 5', avatar: '👦', streak: 'just starting 🌱' },
];

const INITIAL: Record<Kid, { points: number; coins: number }> = {
  mia: { points: 320, coins: 3 },
  leo: { points: 245, coins: 2 },
  theo: { points: 180, coins: 1 },
};

export default function InteractiveDemo() {
  const [state, setState] = useState(INITIAL);
  const [bumps, setBumps] = useState<Record<Kid, number>>({ mia: 0, leo: 0, theo: 0 });
  const [flyers, setFlyers] = useState<Record<Kid, Flyer[]>>({ mia: [], leo: [], theo: [] });

  const houseRefs: Record<Kid, React.RefObject<HTMLDivElement>> = {
    mia: useRef<HTMLDivElement>(null),
    leo: useRef<HTMLDivElement>(null),
    theo: useRef<HTMLDivElement>(null),
  };
  const flyerSeq = useRef(0);

  function award(kid: Kid, amount: number, kind: FlyerKind, e: React.MouseEvent<HTMLButtonElement>) {
    setState((prev) => ({
      ...prev,
      [kid]: { ...prev[kid], points: Math.max(0, prev[kid].points + amount) },
    }));
    setBumps((b) => ({ ...b, [kid]: b[kid] + 1 }));

    // Spawn a flyer that floats up from the tapped button.
    const houseEl = houseRefs[kid].current;
    const btn = e.currentTarget;
    let left = 24;
    let top = 8;
    if (houseEl) {
      const hr = houseEl.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      left = br.left - hr.left + br.width / 2 - 12;
      top = br.top - hr.top - 10;
    }
    const id = ++flyerSeq.current;
    const label = `${amount > 0 ? '+' : ''}${amount}${kind === 'kind' ? ' ❤' : ''}`;
    setFlyers((f) => ({ ...f, [kid]: [...f[kid], { id, kind, label, left, top }] }));
    setTimeout(() => {
      setFlyers((f) => ({ ...f, [kid]: f[kid].filter((x) => x.id !== id) }));
    }, 1000);
  }

  function convert() {
    if (state.mia.points < 100) {
      window.alert('Mia needs at least 100 points to convert. Award some chores or kindness first.');
      return;
    }
    setState((prev) => ({
      ...prev,
      mia: { points: prev.mia.points - 100, coins: prev.mia.coins + 1 },
    }));
    setBumps((b) => ({ ...b, mia: b.mia + 1 }));
  }

  return (
    <section className="demo-section" id="demo">
      <div className="container">
        <div className="core-head reveal">
          <div className="eyebrow">Try It Yourself</div>
          <h2>A live week in the Smith family.</h2>
          <p className="lede" style={{ margin: '0 auto' }}>
            Rate a kid&apos;s day. Convene a meeting. Convert points to coins. No
            signup — just play.
          </p>
        </div>

        <div className="demo-frame reveal">
          <div className="demo-bar">
            <div>👨‍👩‍👧‍👦 The Smith Family · Today, Sunday</div>
            <div className="demo-tag">Live Demo</div>
          </div>

          <div className="demo-body">
            <div className="demo-head">
              <h3>{'This Week’s Houses'}</h3>
              <div className="demo-tabs">
                <button type="button" className="demo-tab active">
                  Houses
                </button>
                <button type="button" className="demo-tab">
                  Meeting
                </button>
                <button type="button" className="demo-tab">
                  The Hive
                </button>
              </div>
            </div>

            <div className="houses">
              {HOUSES.map((h) => (
                <div key={h.kid} className={`house ${h.cls}`} ref={houseRefs[h.kid]}>
                  <div className="top">
                    <div>
                      <div className="badge">{h.badge}</div>
                      <div className="name" style={{ marginTop: 6 }}>
                        {h.name}
                      </div>
                    </div>
                    <div className="avatar">{h.avatar}</div>
                  </div>
                  <div key={bumps[h.kid]} className={`points${bumps[h.kid] > 0 ? ' bounce' : ''}`}>
                    {state[h.kid].points}
                  </div>
                  <div className="points-label">{h.streak}</div>
                  <div className="award-row">
                    <button type="button" className="award-btn" onClick={(e) => award(h.kid, 5, 'plus', e)}>
                      +5 Chore
                    </button>
                    <button type="button" className="award-btn kind" onClick={(e) => award(h.kid, 10, 'kind', e)}>
                      +10 Kind
                    </button>
                    <button type="button" className="award-btn minus" onClick={(e) => award(h.kid, -3, 'minus', e)}>
                      −3
                    </button>
                  </div>
                  {flyers[h.kid].map((f) => (
                    <div
                      key={f.id}
                      className={`flyer ${f.kind}`}
                      style={{ left: f.left, top: f.top }}
                    >
                      {f.label}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="meeting-card">
              <div>
                <h4>Family Meeting</h4>
                <div className="mtg-title">Sunday at 6:30 PM</div>
                <div className="mtg-sub">
                  Three things to notice. Two things to shape. The week starts here.
                </div>
              </div>
              <button
                type="button"
                className="mtg-btn"
                onClick={() =>
                  window.alert(
                    'In the real app: opens the meeting board — quick prompts, kid contributions, gentle notes.',
                  )
                }
              >
                Open the meeting →
              </button>
            </div>

            <div className="hive-block">
              <div>
                <h4>The Hive · Mia&apos;s Vault</h4>
                <div className="hive-title">Convert points to Honey Coins</div>
                <div className="hive-sub">
                  100 House Points = 1 Honey Coin (you set this). 1 Honey Coin = $1 cash,
                  parent-approved.
                </div>
                <button type="button" className="convert-btn" onClick={convert}>
                  🍯 Convert 100 → 1 Honey Coin
                </button>
                <div className="hive-mirror">
                  Mia has {state.mia.points} points available
                </div>
              </div>
              <div className="hive-jars">
                {HOUSES.map((h) => (
                  <div key={h.kid} className="jar">
                    <div className="jar-label">{h.name.split(',')[0]}</div>
                    <div className="jar-coins">{state[h.kid].coins}</div>
                    <div
                      className="jar-fill"
                      style={{ height: `${Math.min(100, state[h.kid].coins * 10)}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="demo-cta-float">
              <a className="btn btn-primary" href="#letter">
                Build my family on Kaya →
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
