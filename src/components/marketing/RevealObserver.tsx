'use client';

import { useReveal } from '@/lib/useReveal';

// Mounts the scroll-reveal IntersectionObserver for the whole landing
// page. Renders nothing.
export default function RevealObserver() {
  useReveal();
  return null;
}
