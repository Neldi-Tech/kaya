"use client";

import { useAuth } from "@/contexts/AuthContext";
import UniverseLanding from "./UniverseLanding";
import UniverseInApp from "./UniverseInApp";

/**
 * One route, two faces. `/universe` is auth-aware:
 *   • Logged out (and during SSR/SSG, where auth is still resolving) →
 *     the public marketing landing. Keeps the page statically generated +
 *     SEO-indexable — SSR output is always the marketing variant.
 *   • Logged in → the personalised in-app walk-through (progress, deep
 *     links, "Mark explored"). Swaps in after hydration once auth resolves.
 */
export default function UniverseGate() {
  const { user, loading } = useAuth();
  if (!loading && user) return <UniverseInApp />;
  return <UniverseLanding />;
}
