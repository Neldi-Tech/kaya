'use client';

import ComingSoonHero from '@/components/ui/ComingSoonHero';

export default function KayaWellnessTeaserPage() {
  return (
    <ComingSoonHero
      emoji="🧘"
      title="Kaya Wellness"
      tagline="Sleep, screens, mood, health — quietly tracked."
      paragraphs={[
        "Wellness is the slow stuff. How well the kids slept. How much screen time really happened. How mood drifted across the week. It's hard to feel these things day-to-day; they only show up in patterns.",
        "Kaya Wellness collects them in the background — a tap here, a check-in there — and feeds the family meeting with real signal instead of memory and guesswork. Nothing alarming, nothing clinical. Just a calmer view of how everyone is actually doing.",
      ]}
      bullets={[
        { emoji: '😴', title: 'Sleep', desc: 'Per-kid bed/wake check-ins with weekly trend. No wearables required.' },
        { emoji: '📱', title: 'Screens', desc: 'A daily honest log. Not a punishment dashboard — a conversation starter.' },
        { emoji: '🙂', title: 'Mood', desc: 'One emoji at the end of the day. Patterns become visible over weeks.' },
        { emoji: '💧', title: 'Health basics', desc: 'Water, movement, doctor visits, allergies — the family\'s shared health notes.' },
      ]}
      notifySubject="Kaya Wellness — notify me"
    />
  );
}
