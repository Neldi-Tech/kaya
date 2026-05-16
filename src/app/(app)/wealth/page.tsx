'use client';

import ComingSoonHero from '@/components/ui/ComingSoonHero';

export default function KayaWealthTeaserPage() {
  return (
    <ComingSoonHero
      emoji="💎"
      title="Kaya Wealth"
      tagline="An honest picture of the family's money."
      paragraphs={[
        "Most families don't really know what they own. Accounts in three banks, a piece of land somewhere, a fund that's been sitting since 2019. Kaya Wealth pulls all of it onto one page — assets, accounts, investments, debts — so the household has one shared, honest view.",
        "It's not about chasing returns. It's about the whole family seeing where they stand together, setting goals that mean something, and watching them move over the years.",
      ]}
      bullets={[
        { emoji: '🏦', title: 'Accounts in one view', desc: 'Bank, mobile money, savings groups, retirement — listed once, kept current.' },
        { emoji: '🏡', title: 'Things you own', desc: 'Property, vehicles, equipment, livestock — anything with value, tracked simply.' },
        { emoji: '📈', title: 'Net worth over time', desc: 'A slow, quiet line going up. Year-by-year, not minute-by-minute.' },
        { emoji: '🎯', title: 'Family goals', desc: 'Set goals you share — university, land, a year of runway — and see progress together.' },
      ]}
      notifySubject="Kaya Wealth — notify me"
    />
  );
}
