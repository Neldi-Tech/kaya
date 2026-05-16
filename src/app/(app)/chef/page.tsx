'use client';

import ComingSoonHero from '@/components/ui/ComingSoonHero';

export default function KayaChefTeaserPage() {
  return (
    <ComingSoonHero
      emoji="🍳"
      title="Kaya Chef"
      tagline="Recipes, meals, cook-alongs — the family kitchen, organised."
      paragraphs={[
        "Kaya Chef sits between Household (what's in the pantry) and Wellness (what we ate). A small library of family recipes, a weekly meal plan that respects what you already have, and step-by-step cook-alongs that let a kid actually run dinner with a parent beside them.",
        "Less takeout-by-default, more shared meals — and the kids end up knowing how to feed themselves and someone they love.",
      ]}
      bullets={[
        { emoji: '📖', title: 'Family recipes', desc: 'The dishes your house actually cooks — saved, photographed, easy to find.' },
        { emoji: '🗓️', title: 'Weekly meal plan', desc: 'Drag-and-drop the week. Pulls from the pantry so the shopping list writes itself.' },
        { emoji: '👨‍🍳', title: 'Cook-alongs', desc: 'Step-by-step kid-friendly modes. Big buttons, timers, photo cues.' },
        { emoji: '⭐', title: 'Earn points', desc: 'Cooking a meal counts as a routine — points flow into Kaya like any other.' },
      ]}
      notifySubject="Kaya Chef — notify me"
    />
  );
}
