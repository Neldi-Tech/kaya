// Section 7 — Born of Love modules: Pulse, Household, Pantry. Each card
// carries a "Born from:" quote. Static / server-rendered. (Marketing copy
// only — these are not built features in this round.)

const CARDS = [
  {
    cls: 'pulse',
    icon: '💗',
    name: 'Kaya Pulse',
    tagline: "The family's heartbeat",
    body: "A daily check-in. Mood, energy, what's coming today, who needs what. The quiet read on how the family is actually doing — not just what got done.",
    born: '"I want to know if my kids are okay, not just productive."',
    delay: 1,
  },
  {
    cls: 'household',
    icon: '🏡',
    name: 'Kaya Household',
    tagline: 'The operating layer of the home',
    body: 'Utilities, helper schedules, shopping list, recurring maintenance, visitor planning, emergency info. The invisible work of running a house — now visible and shared.',
    born: '"Why does everyone in this house only know what mom knows?"',
    delay: 2,
  },
  {
    cls: 'pantry',
    icon: '🥕',
    name: 'Kaya Pantry',
    tagline: "What's in the fridge, what's not",
    body: "Track what you have, what's running low, what got wasted. Connects to the shopping list and (soon) Kaya Chef. Less throwing away, more cooking together.",
    born: '"Three avocados went bad this week. Again."',
    delay: 3,
  },
];

export default function BornOfLove() {
  return (
    <section className="born">
      <div className="container">
        <div className="born-grid">
          {CARDS.map((c) => (
            <div key={c.name} className={`born-card ${c.cls} reveal delay-${c.delay}`}>
              <div className="top-strip" />
              <div className="born-card-body">
                <div className="icon-row">
                  <div className="icon-circle">{c.icon}</div>
                  <div>
                    <h3>{c.name}</h3>
                    <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>{c.tagline}</p>
                  </div>
                </div>
                <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>{c.body}</p>
                <div className="why-born">
                  <strong>Born from:</strong> {c.born}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
