// New section (2026-05-29) — "Built for the families who want to do this
// on purpose." Sits between Hero and Founded on Love. Six audience cards
// (two-parent · solo · guardians/chosen families · helpers · character ·
// remember-it) + a typical-week use-case strip. Static / server-rendered.
//
// Copy lives in src/lib/audienceCopy.ts so the same content also renders
// on the public /universe landing without drift.

import {
  AUDIENCE_CARDS,
  AUDIENCE_EYEBROW,
  AUDIENCE_LEDE,
  AUDIENCE_TITLE,
  AUDIENCE_USES,
  AUDIENCE_USES_TITLE,
} from '@/lib/audienceCopy';

export default function Audience() {
  return (
    <section className="audience">
      <div className="container">
        <div className="audience-head reveal">
          <div className="eyebrow">{AUDIENCE_EYEBROW}</div>
          <h2>{AUDIENCE_TITLE}</h2>
          <p className="lede">{AUDIENCE_LEDE}</p>
        </div>

        <div className="audience-grid">
          {AUDIENCE_CARDS.map((c, i) => (
            <div key={c.title} className={`who-card reveal delay-${(i % 3) + 1}`}>
              <div className="who-em">{c.em}</div>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>

        <div className="use-strip reveal">
          <h3>{AUDIENCE_USES_TITLE}</h3>
          <ul className="use-list">
            {AUDIENCE_USES.map((u) => (
              <li key={u.strong}>
                <span className="use-em">{u.em}</span>
                <span>
                  <strong>{u.strong}</strong> — {u.body}
                </span>
              </li>
            ))}
          </ul>
          <div className="use-closer">
            That’s it. The system holds the rest.{' '}
            <em>If that’s the kind of family you want to be — Kaya is for you.</em>
          </div>
        </div>
      </div>
    </section>
  );
}
