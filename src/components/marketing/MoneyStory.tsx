'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useTour } from './TourProvider';

// Section 9 — The Money Story. Navy panel, three-layer flow with
// plain-English rates. The layers pulse in sequence when the section
// scrolls into view (and again via "Watch It Flow"). "Try the Demo" opens
// the guided tour.
export default function MoneyStory() {
  const { open } = useTour();
  const sectionRef = useRef<HTMLElement>(null);
  const l1 = useRef<HTMLDivElement>(null);
  const l2 = useRef<HTMLDivElement>(null);
  const l3 = useRef<HTMLDivElement>(null);

  const animate = useCallback(() => {
    [l1, l2, l3].forEach((r, i) => {
      setTimeout(() => {
        const el = r.current;
        if (!el) return;
        el.classList.add('pulse');
        setTimeout(() => el.classList.remove('pulse'), 700);
      }, i * 800);
    });
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setTimeout(animate, 400);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [animate]);

  return (
    <section className="money-story" ref={sectionRef}>
      <div className="container money-grid">
        <div className="reveal">
          <p className="money-prelude">
            After character. After meetings. After the daily rhythm of love.
          </p>
          <div className="eyebrow">The Hive · Kaya Business</div>
          <h2>Where points become money — and money becomes a lesson.</h2>
          <p className="lede">
            A three-layer currency, with you as the central bank. And for kids ready
            for more: real micro-businesses they own.
          </p>
          <div style={{ marginTop: 28, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-gold" onClick={animate}>
              Watch It Flow ↓
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={open}
              style={{ color: 'var(--cream)', borderColor: 'var(--gold-soft)' }}
            >
              Try the Demo
            </button>
          </div>
        </div>
        <div className="money-flow reveal delay-2">
          <div className="layer layer-1" ref={l1}>
            <div className="coin">⭐</div>
            <div className="text">
              <strong>House Points</strong>
              <small>Earned for chores, character, kindness</small>
            </div>
          </div>
          <div className="layer-arrow">
            <strong>100 points = 1 Honey Coin</strong>
            <br />
            <span className="rate-note">↓ you set the rate</span>
          </div>
          <div className="layer layer-2" ref={l2}>
            <div className="coin">🍯</div>
            <div className="text">
              <strong>Honey Coins</strong>
              <small>Saved in the Hive vault</small>
            </div>
          </div>
          <div className="layer-arrow">
            <strong>1 Honey Coin = $1 cash</strong>
            <br />
            <span className="rate-note">↓ you set the rate (any currency)</span>
          </div>
          <div className="layer layer-3" ref={l3}>
            <div className="coin">💵</div>
            <div className="text">
              <strong>Real Cash</strong>
              <small>Spent with parent approval</small>
            </div>
          </div>
          <div className="lever-note">
            Both rates are <strong>yours to set</strong> in settings. Looser for younger
            kids, tighter as they grow. <strong>Points → Honey</strong> happens
            automatically. <strong>Honey → Cash</strong> always needs a parent&apos;s
            approval.
          </div>
        </div>
      </div>
    </section>
  );
}
