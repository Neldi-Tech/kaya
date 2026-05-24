import type { Metadata } from 'next';
import { Suspense } from 'react';
import './marketing.css';

import RefCapture from '@/components/marketing/RefCapture';
import RedirectIfAuthed from '@/components/marketing/RedirectIfAuthed';
import RevealObserver from '@/components/marketing/RevealObserver';
import TourProvider from '@/components/marketing/TourProvider';
import TopContextBar from '@/components/marketing/TopContextBar';
import Hero from '@/components/marketing/Hero';
import FoundedOnLove from '@/components/marketing/FoundedOnLove';
import KayaCore from '@/components/marketing/KayaCore';
import Moments from '@/components/marketing/Moments';
import PhaseBand from '@/components/marketing/PhaseBand';
import BornOfLove from '@/components/marketing/BornOfLove';
import MoneyStory from '@/components/marketing/MoneyStory';
import Walkthrough from '@/components/marketing/Walkthrough';
import InteractiveDemo from '@/components/marketing/InteractiveDemo';
import Privacy from '@/components/marketing/Privacy';
import Voices from '@/components/marketing/Voices';
import Roadmap from '@/components/marketing/Roadmap';
import FoundingFamilyNote from '@/components/marketing/FoundingFamilyNote';
import FamilyLetterSignup from '@/components/marketing/FamilyLetterSignup';
import MarketingFooter from '@/components/marketing/MarketingFooter';

// Public marketing landing — server-rendered so ourkaya.com returns real
// hero markup on first paint (no auth gate, no "Loading…" spinner). Signed-in
// families are bounced to /discover by the RedirectIfAuthed client island.
export const metadata: Metadata = {
  title: 'Kaya — Responsible Kids. Responsible Parents.',
  description:
    'A family operating system, built on love. Chores, routines, weekly meetings and character — then money and real businesses. The gentle structure for busy families.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Kaya — Responsible Kids. Responsible Parents.',
    description:
      'A family operating system, built on love. The gentle structure for busy families.',
    type: 'website',
  },
};

export default function MarketingHome() {
  return (
    <div className="kaya-mk">
      <Suspense fallback={null}>
        <RefCapture />
      </Suspense>
      <RedirectIfAuthed />
      <RevealObserver />

      <TourProvider>
        <TopContextBar />
        <Hero />
        <FoundedOnLove />
        <KayaCore />
        <Moments />
        <PhaseBand eyebrow="Born of Love" title="Then the family kept asking for more.">
          Every feature below came from a real request — &ldquo;I wish Kaya could also
          help with…&rdquo; Each one is still about love, just expressed in a new corner
          of the home.
        </PhaseBand>
        <BornOfLove />
        <PhaseBand cream eyebrow="A Natural Next Step" title="Then came the money story.">
          Once kids were earning points for character and chores, parents started
          asking: <em>&ldquo;Can we tie this to real money — and teach them how it
          works?&rdquo;</em> So we built the Hive, and then Kaya Business.
        </PhaseBand>
        <MoneyStory />
        <Walkthrough />
        <InteractiveDemo />
        <Privacy />
        <Voices />
        <Roadmap />
        <FoundingFamilyNote />
        <FamilyLetterSignup />
        <MarketingFooter />
      </TourProvider>
    </div>
  );
}
