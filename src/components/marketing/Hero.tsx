'use client';

import Link from 'next/link';
import { useTour } from './TourProvider';

// Section 2 — Hero. Love-first headline + Sunday-meeting visual card whose
// agenda items stagger in. Primary CTA opens the tour; secondary scrolls to
// the demo; a quiet line under the CTAs links existing families to sign in.

// Stagger timings ported from the mockup (500 / 900 / 1300 / 1700 ms).
const AGENDA = [
  { delay: '0.5s', text: 'Mia helped Theo with homework — three days in a row' },
  { delay: '0.9s', text: 'Leo cleared the table every dinner' },
  { delay: '1.3s', text: 'We held one calm conversation about phones' },
];

export default function Hero() {
  const { open } = useTour();

  return (
    <section className="hero">
      <div className="container hero-grid">
        <div className="reveal in">
          <div className="eyebrow">A Family Operating System, Built on Love</div>
          <h1>
            Responsible Kids.
            <br />
            Responsible Parents.
            <br />
            <span className="gold">Even in our busy world.</span>
          </h1>
          <p className="lede">
            Kaya is the gentle structure that helps families slow down enough to teach
            character, hold meetings, and shape discipline — without the shouting.
          </p>
          <p className="micro">
            Chores · Routines · Family Meetings · Character · then Money &amp; Real
            Businesses
          </p>
          <div className="hero-ctas">
            <button type="button" className="btn btn-primary" onClick={open}>
              See How a Kaya Week Feels →
            </button>
            <a className="btn btn-secondary" href="#demo">
              Try the Demo
            </a>
          </div>
          <p className="hero-signin">
            Already have a family on Kaya? <Link href="/login">Sign in →</Link>
          </p>
        </div>

        <div className="hero-visual reveal in delay-2">
          <div className="family-card">
            <div className="family-card-header">
              <span className="pulse-dot" />
              Sunday Family Meeting · 6:30 PM
            </div>
            <div className="family-card-body">
              <div className="family-meeting-title">This week, together.</div>
              <div className="family-meeting-sub">
                {'Three things we noticed. Two things we’ll work on.'}
              </div>
              {AGENDA.map((a) => (
                <div key={a.delay} className="agenda-item" style={{ animationDelay: a.delay }}>
                  <div className="check">✓</div>
                  <div>{a.text}</div>
                </div>
              ))}
              <div className="agenda-item skip" style={{ animationDelay: '1.7s' }}>
                <div className="check">→</div>
                <div>This week: morning routine starts before 7:00</div>
              </div>
            </div>
          </div>
          <div className="stat-pill tl">
            <span className="em">❤️</span>Built on love
          </div>
          <div className="stat-pill br">
            <span className="em">🤝</span>Approved together
          </div>
        </div>
      </div>
    </section>
  );
}
