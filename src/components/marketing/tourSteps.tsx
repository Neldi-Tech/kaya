// Guided-tour content — 6 love-first stops. Ported verbatim from the
// mockup's tourSteps[]. Each stage is JSX (inline styles use the CSS vars
// defined on .kaya-mk-overlay, so they resolve inside the overlay).
import type { ReactNode } from 'react';

export type TourStep = { title: string; body: string; stage: ReactNode };

const chip = (label: string): ReactNode => (
  <span
    key={label}
    style={{
      padding: '6px 12px',
      background: 'var(--cream)',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--navy)',
    }}
  >
    {label}
  </span>
);

const houseChip = (
  emoji: string,
  name: string,
  detail: string,
  border: string,
): ReactNode => (
  <div
    style={{
      background: 'white',
      borderRadius: 14,
      padding: 18,
      border: `2px solid ${border}`,
      textAlign: 'center',
    }}
  >
    <div style={{ fontSize: 28 }}>{emoji}</div>
    <div style={{ fontWeight: 700, color: 'var(--navy)', marginTop: 6 }}>{name}</div>
    <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4 }}>{detail}</div>
  </div>
);

const rateRow = (label: string, value: string, color: string, last = false): ReactNode => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '10px 0',
      borderBottom: last ? undefined : '1px dashed var(--line)',
    }}
  >
    <span style={{ color: 'var(--navy)' }}>{label}</span>
    <span style={{ fontWeight: 700, color }}>{value}</span>
  </div>
);

const agendaLine = (text: string, last = false): ReactNode => (
  <div
    style={{
      background: 'white',
      padding: '12px 14px',
      borderRadius: 10,
      marginBottom: last ? 0 : 8,
      fontSize: 13,
    }}
  >
    {text}
  </div>
);

const moneyRow = (
  emoji: string,
  bg: string,
  coinBg: string,
  title: string,
  sub: string,
): ReactNode => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: 12,
      background: bg,
      borderRadius: 10,
      marginBottom: 8,
    }}
  >
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: coinBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
      }}
    >
      {emoji}
    </div>
    <div>
      <strong style={{ color: 'white' }}>{title}</strong>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{sub}</div>
    </div>
  </div>
);

const tryRow = (emoji: string, text: string, last = false): ReactNode => (
  <li
    style={{
      padding: '14px 18px',
      background: 'white',
      borderRadius: 12,
      marginBottom: last ? 0 : 8,
      display: 'flex',
      gap: 14,
      alignItems: 'center',
    }}
  >
    <span style={{ fontSize: 22 }}>{emoji}</span>
    <span style={{ fontSize: 14, color: 'var(--navy)' }}>{text}</span>
  </li>
);

export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Built on love',
    body: "Kaya started as the operating system for a busy family that wanted to parent better — not just keep score. Everything you'll see grew from that foundation.",
    stage: (
      <>
        <h4>What you&apos;ll see:</h4>
        <div
          style={{
            background: 'white',
            borderRadius: 16,
            padding: 24,
            border: '2px solid var(--play-yellow)',
          }}
        >
          <p style={{ color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1.6 }}>
            A Kaya week is built around <strong>five quiet mechanisms</strong>: houses,
            chores, family meetings, character recognition, and the Sunday rhythm.
          </p>
          <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['🏠 Houses', '🧺 Chores', '🤝 Meetings', '🌱 Character', '⭐ Points'].map(chip)}
          </div>
        </div>
      </>
    ),
  },
  {
    title: 'Meet the family — three houses',
    body: "Each kid gets a house: Mia (Golden), Leo (White), Theo (Silver). It's not a competition. It's a small, dignified identity that grows with them.",
    stage: (
      <>
        <h4>The three houses:</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {houseChip('👧', 'Mia, 9', 'Golden · 7-day streak 🔥', 'var(--play-yellow)')}
          {houseChip('🧒', 'Leo, 7', 'White · 3-day streak ✨', 'var(--play-purple)')}
          {houseChip('👦', 'Theo, 5', 'Silver · just starting 🌱', 'var(--play-mint)')}
        </div>
      </>
    ),
  },
  {
    title: 'The week is rated in seconds',
    body: 'Parents and helpers tap quickly through the day: chore done, kindness shown, character moment noticed. The signal builds without anyone standing over anyone.',
    stage: (
      <>
        <h4>A typical Wednesday for Mia:</h4>
        <div style={{ background: 'white', borderRadius: 14, padding: 18 }}>
          {rateRow('Bed made before breakfast', '+5', 'var(--play-mint)')}
          {rateRow('Helped Theo with shoes', '+10 ❤', 'var(--coral)')}
          {rateRow('Cleared dinner table', '+5', 'var(--play-mint)')}
          {rateRow('Told the truth about the broken cup', '+10 ❤', 'var(--coral)', true)}
        </div>
      </>
    ),
  },
  {
    title: 'Sunday: the family meeting',
    body: 'The single most powerful habit. Twenty minutes. Notice three good things. Shape two for next week. The kids get a voice. The family slows down enough to mean it.',
    stage: (
      <>
        <h4>This Sunday&apos;s agenda:</h4>
        <div
          style={{
            background: 'linear-gradient(135deg, #FFF3D6 0%, #FFE5B4 100%)',
            borderRadius: 16,
            padding: 20,
            border: '1px solid var(--gold-soft)',
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: 'var(--navy)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 12,
            }}
          >
            Three things we noticed
          </div>
          {agendaLine('✓ Mia helped Theo three days in a row')}
          {agendaLine('✓ Leo cleared the table every dinner')}
          <div
            style={{
              fontSize: 12,
              color: 'var(--navy)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              margin: '16px 0 12px',
            }}
          >
            Two to shape next week
          </div>
          {agendaLine('→ Morning routine starts before 7:00')}
          {agendaLine('→ One sibling-help moment per day', true)}
        </div>
      </>
    ),
  },
  {
    title: 'Then — and only then — the money story',
    body: 'Once the rhythm of love and recognition was running, parents asked for more. Points → Honey Coins → Real Cash, with you as the central bank. Kaya Business lets older kids run real micro-enterprises. Money becomes a lesson, not a bribe.',
    stage: (
      <>
        <h4>The three-layer arc:</h4>
        <div style={{ background: 'var(--navy)', borderRadius: 16, padding: 20, color: 'white' }}>
          {moneyRow('⭐', 'rgba(255,217,61,0.1)', 'var(--play-yellow)', 'House Points', 'For character and chores')}
          <div style={{ textAlign: 'center', color: 'var(--gold-soft)', margin: '4px 0' }}>↓</div>
          {moneyRow('🍯', 'rgba(212,168,71,0.15)', 'var(--gold)', 'Honey Coins', 'Saved in the Hive vault')}
          <div style={{ textAlign: 'center', color: 'var(--gold-soft)', margin: '4px 0' }}>↓</div>
          {moneyRow('💵', 'rgba(46,125,52,0.15)', 'var(--green)', 'Real Cash', 'Parent-approved withdrawals')}
        </div>
      </>
    ),
  },
  {
    title: 'Now try it yourself',
    body: "We'll drop you into a live week with the Smith family. Award points. Open the meeting. Convert coins. Nothing here requires signup — just play.",
    stage: (
      <>
        <h4>You&apos;ll be able to:</h4>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {tryRow('⭐', 'Award points to Mia, Leo, or Theo — watch them pop')}
          {tryRow('🤝', 'Open the Sunday meeting agenda')}
          {tryRow('🍯', 'Convert points to Honey Coins — watch the jar fill', true)}
        </ul>
      </>
    ),
  },
];
