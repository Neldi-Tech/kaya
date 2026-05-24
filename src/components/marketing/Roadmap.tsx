// Section 14 — Roadmap. Three upcoming modules: Wealth, Wellness, Chef.
// Static / server-rendered. Marketing copy only.

const CARDS = [
  { icon: '📊', name: 'Kaya Wealth', body: 'The family’s full picture — properties, financials, legacy notes. Gated, dual-approved, private.', delay: 1 },
  { icon: '🌱', name: 'Kaya Wellness', body: 'Sleep, screen time, mood, mindfulness. The quiet inputs that shape long weeks.', delay: 2 },
  { icon: '🍲', name: 'Kaya Chef', body: 'Family recipes, meal planning, cook-along. The kitchen as the anchor of the home.', delay: 3 },
];

export default function Roadmap() {
  return (
    <section className="roadmap">
      <div className="container">
        <div className="core-head reveal">
          <div className="eyebrow">What&apos;s Coming</div>
          <h2>More corners of family life, the same gentle approach.</h2>
        </div>
        <div className="roadmap-grid">
          {CARDS.map((c) => (
            <div key={c.name} className={`roadmap-card reveal delay-${c.delay}`}>
              <div className="big-icon">{c.icon}</div>
              <h3>{c.name}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
