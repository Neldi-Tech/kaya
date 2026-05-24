// Section 4 — Kaya Core. Six cards in a 3×2 grid. Static / server-rendered.

const CARDS = [
  { icon: '🏠', title: 'Houses', body: 'Each kid gets a house — Gold, White, Silver. A small, dignified identity that grows with them. House Points are the shared scoreboard.', delay: 1 },
  { icon: '🧺', title: 'Chores', body: "The discrete tasks — bed made, dishes done, trash out. Rated in seconds. Custom to your family's standards.", delay: 2 },
  { icon: '🔄', title: 'Routines', body: 'Morning, after-school, bedtime — the sequences that make a day flow. Bundle steps into one rhythm each kid follows.', delay: 3 },
  { icon: '🤲', title: 'Helpers', body: "Nannies, grandparents, house staff — anyone who shares the load. They can rate the day. Only parents approve. Everyone's on the same page.", delay: 1 },
  { icon: '🤝', title: 'Family Meetings', body: 'Weekly check-ins. Notice the good. Shape the next week. The single most powerful habit a family can build.', delay: 2 },
  { icon: '🌱', title: 'Character & Kindness', body: "Points for the things money can't measure — patience, helping a sibling, telling the truth, doing the hard right thing.", delay: 3 },
];

export default function KayaCore() {
  return (
    <section className="core-section">
      <div className="container">
        <div className="core-head reveal">
          <div className="eyebrow">Where It All Starts — Kaya Core</div>
          <h2>The daily loop of a loving home.</h2>
          <p className="lede">Five quiet mechanisms that turn a busy week into shared rhythm.</p>
        </div>
        <div className="core-grid">
          {CARDS.map((c) => (
            <div key={c.title} className={`core-card reveal delay-${c.delay}`}>
              <div className="icon">{c.icon}</div>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
