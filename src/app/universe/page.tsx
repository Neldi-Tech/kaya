import type { Metadata } from "next";
import UniverseLanding from "./UniverseLanding";

export const metadata: Metadata = {
  title: "The Kaya Universe — one family world, in one app",
  description:
    "Points, money, dreams, business, home, and more. Explore every Kaya module — tap a planet to fly straight to its story.",
  alternates: { canonical: "/universe" },
  openGraph: {
    title: "The Kaya Universe",
    description:
      "A whole family world in one app — tap a planet to meet each module.",
    type: "website",
  },
};

export default function UniversePage() {
  return <UniverseLanding />;
}
