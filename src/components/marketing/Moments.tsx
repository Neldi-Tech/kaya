// Section 5 — Moments. Anti-public-social framing: 4 promise rows on the
// left, a mock private photo mosaic on the right. Static / server-rendered.
//
// Brand-name softened per Elia (2026-05-24): the original named Instagram
// directly; we keep the anti-public-social punch without naming a platform.

const PROMISES = [
  {
    icon: '🔒',
    title: 'Private by default',
    body: 'Only the family sees what the family shares. No accounts to follow. No public feed. No discoverability. Ever.',
  },
  {
    icon: '📸',
    title: 'Post freely — but only to your people',
    body: "For parents who want the joy of sharing without the audience. Post a photo, a note, a small win — and only the family circle you've added sees it. Grandparents in the loop. Strangers nowhere near.",
  },
  {
    icon: '⏳',
    title: 'Forever, not 24 hours',
    body: "Moments don't expire, get buried by an algorithm, or vanish in a story. They're saved as a real archive — yours to keep and export.",
  },
  {
    icon: '🌳',
    title: 'Memories that reach grandchildren',
    body: 'Tagged, dated, organized by kid and year. The kind of family record your great-grandchildren will be able to open and feel.',
  },
];

const TILES = [
  { cls: 't1', em: '🎂', label: 'Theo turns 5 · May 22' },
  { cls: 't2', em: '🌳', label: 'First climb' },
  { cls: 't3', em: '🍳', label: 'Mia cooked breakfast' },
  { cls: 't4', em: '📚', label: 'Leo read aloud' },
  { cls: 't5', em: '🤝', label: 'Sunday meeting' },
];

export default function Moments() {
  return (
    <section className="moments-section">
      <div className="container moments-grid">
        <div className="reveal">
          <span className="anti-pill">📔 Moments</span>
          <div className="eyebrow">For Families Who Don&apos;t Want Social Media</div>
          <h2>
            The family memory
            <br />
            a public feed can&apos;t keep.
          </h2>
          <p className="lede" style={{ marginTop: 14 }}>
            Not every family wants their kids on social media. Not every parent wants
            their childhood scattered across servers built for ads. Moments is the
            quiet alternative — a private memory book for your family, designed to
            outlive the app it lives in.
          </p>
          <div className="moments-promise">
            {PROMISES.map((p) => (
              <div key={p.title} className="promise-row">
                <div className="promise-icon">{p.icon}</div>
                <div>
                  <strong>{p.title}</strong>
                  <span>{p.body}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="reveal delay-2">
          <div className="moments-frame">
            <div className="moments-header">
              <h4>👨‍👩‍👧‍👦 The Smith Family · This Week</h4>
              <span className="private-badge">🔒 Private</span>
            </div>
            <div className="moments-mosaic">
              {TILES.map((t) => (
                <div key={t.cls} className={`photo-tile ${t.cls}`}>
                  <span className="photo-tile-em">{t.em}</span>
                  <div className="photo-tile-label">{t.label}</div>
                </div>
              ))}
            </div>
            <div className="moments-stats">
              <span>
                <strong>247</strong>&nbsp;moments saved
              </span>
              <span>
                <strong>3 years</strong>&nbsp;of family
              </span>
              <span>
                <strong>0</strong>&nbsp;strangers viewing
              </span>
            </div>
            <div className="gen-line">
              &quot;Your great-grandchildren will be able to open this.&quot;
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
