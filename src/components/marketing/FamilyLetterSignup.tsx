'use client';

import { useState } from 'react';

// Section 16 — Family Letter signup. Visual only: on submit we clear the
// field and show an inline thank-you. No backend / email service wired.
export default function FamilyLetterSignup() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setEmail('');
    setDone(true);
  };

  return (
    <section className="letter" id="letter">
      <div className="container">
        <div className="reveal">
          <div className="eyebrow">The Family Letter</div>
          <h2>One short note every other week.</h2>
          <p className="lede">
            New modules, parenting ideas we&apos;re testing at home, and the occasional
            photo. No spam — just signal.
          </p>
          <form className="letter-form" onSubmit={onSubmit}>
            <input
              type="email"
              placeholder="you@family.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              aria-label="Email address"
            />
            <button type="submit" className="btn btn-primary">
              Join
            </button>
          </form>
          {done && <p className="letter-done">Thanks! We&apos;ll be in touch. 💛</p>}
        </div>
      </div>
    </section>
  );
}
