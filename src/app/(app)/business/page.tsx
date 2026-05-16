'use client';

import ComingSoonHero from '@/components/ui/ComingSoonHero';

export default function KayaBusinessTeaserPage() {
  return (
    <ComingSoonHero
      emoji="💼"
      title="Kaya Business"
      tagline="Tiny businesses, real lessons."
      paragraphs={[
        "Kaya Business is where kids — and the whole family — run real micro-enterprises with simple books. A weekend lemonade stand, a cookie sale at school, a parent's side hustle: each one becomes a little company with inventory, sales, and profit you can actually see.",
        "It's the bridge between Kaya (points and character) and The Hive (real money). Kids learn how revenue, cost, and savings connect — by doing, not by being told.",
      ]}
      bullets={[
        { emoji: '📒', title: 'Simple books', desc: 'Log inventory, sales, costs. See profit by day, week, month.' },
        { emoji: '🧑‍🍳', title: 'Family ventures', desc: 'Each business has its own little homepage, members, and rules.' },
        { emoji: '🐝', title: 'Wired to The Hive', desc: 'Profit flows into a kid\'s Hive wallet automatically — Spend / Save / Goal.' },
        { emoji: '🏆', title: 'Milestones', desc: 'First shilling, first 1k profit, first month in the black — celebrated like badges.' },
      ]}
      notifySubject="Kaya Business — notify me"
    />
  );
}
