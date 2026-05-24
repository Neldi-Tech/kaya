'use client';

import Link from 'next/link';
import KayaIcon from './KayaIcon';
import { useTour } from './TourProvider';

// Section 1 — sticky context bar. Logo · 4 chips · Sign in pill · gold
// "See It In Action" CTA (opens the guided tour).
export default function TopContextBar() {
  const { open } = useTour();

  return (
    <header className="context-bar">
      <div className="context-bar-inner">
        <div className="brand-mini">
          <KayaIcon className="logo-mini" size={28} />
          Kaya
        </div>
        <div className="chips">
          <span className="chip">
            <strong>Responsible Kids</strong>
          </span>
          <span className="chip">
            <strong>Responsible Parents</strong>
          </span>
          <span className="chip">
            Built on <strong>Love</strong>
          </span>
          <span className="chip">
            For <strong>Busy</strong> Families
          </span>
        </div>
        <Link className="signin-link" href="/login">
          Sign in
        </Link>
        <button type="button" className="chip chip-cta" onClick={open}>
          See It In Action →
        </button>
      </div>
    </header>
  );
}
