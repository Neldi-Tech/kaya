// Section 13 — Voices. Three testimonials framed around Sunday meetings +
// character. Static / server-rendered.

const VOICES = [
  {
    quote: '"Our Sunday meeting is now sacred. Twenty minutes. The whole week feels different because of it."',
    initials: 'JM',
    name: 'Jordan M.',
    detail: 'Two kids, 6 and 9',
    delay: 1,
  },
  {
    quote: '"I stopped nagging. I started noticing. The kids noticed me noticing — and that changed everything."',
    initials: 'RA',
    name: 'Rita A.',
    detail: 'One kid, 8',
    delay: 2,
  },
  {
    quote: "\"We're both working parents. Kaya gave us a structure to actually be present, not just exhausted.\"",
    initials: 'DK',
    name: 'Daniel K.',
    detail: 'Three kids, 5–11',
    delay: 3,
  },
];

export default function Voices() {
  return (
    <section className="voices">
      <div className="container">
        <div className="core-head reveal">
          <div className="eyebrow">Words From Families</div>
          <h2>What actually changed at home.</h2>
        </div>
        <div className="voices-grid">
          {VOICES.map((v) => (
            <div key={v.initials} className={`voice-card reveal delay-${v.delay}`}>
              <div className="quote">{v.quote}</div>
              <div className="who">
                <div className="avatar">{v.initials}</div>
                <div>
                  <strong>{v.name}</strong>
                  <small>{v.detail}</small>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
