'use client';

import { useEffect } from 'react';

// Scroll-reveal for the marketing page. Observes every `.reveal` element
// inside the marketing root and adds `.in` once it scrolls into view, then
// stops watching it — same behaviour as the source mockup's global
// IntersectionObserver. Mount once near the top of the page.
//
// Falls back to revealing everything immediately if IntersectionObserver
// is unavailable (old browsers / SSR hand-off) so nothing stays hidden.
export function useReveal() {
  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('.kaya-mk .reveal'),
    );
    if (nodes.length === 0) return;

    if (typeof IntersectionObserver === 'undefined') {
      nodes.forEach((n) => n.classList.add('in'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );

    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
}
