// Section 3 — Founded on Love. Centered founding-principle quote + 4
// pillars. Static / server-rendered.

const PILLARS = [
  { em: '❤️', title: 'Love', body: 'The reason anything in here exists. Every feature is a way to express it.' },
  { em: '🤝', title: 'Family Meetings', body: 'Weekly rhythm. Three things noticed, two things to work on. The week starts here.' },
  { em: '🌱', title: 'Shaping Discipline', body: 'Not punishment. The patient work of forming habits, character, and self-respect.' },
  { em: '⏱️', title: 'Built for Busy', body: 'Parenting well in a packed week. Five minutes a day. Twenty on Sunday.' },
];

export default function FoundedOnLove() {
  return (
    <section className="love-section">
      <div className="container">
        <div className="reveal">
          <div className="eyebrow">The Founding Principle</div>
          <p className="love-quote">
            Kaya was built because we couldn&apos;t find an app that helped us be{' '}
            <em>better parents</em> — only ones that helped kids earn screen time. We
            wanted the opposite: a quiet system for{' '}
            <em>love, meetings, and the slow work of character.</em>
          </p>
        </div>
        <div className="love-pillars">
          {PILLARS.map((p, i) => (
            <div key={p.title} className={`pillar reveal delay-${i + 1}`}>
              <span className="em">{p.em}</span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
