'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import TourOverlay from './TourOverlay';
import { TOUR_STEPS } from './tourSteps';

type TourContextValue = { open: () => void };

const TourContext = createContext<TourContextValue | null>(null);

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used within <TourProvider>');
  return ctx;
}

// Holds the guided-tour open/step state and renders the overlay. Wraps the
// page so any section (top bar, hero, money story) can call open().
export default function TourProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(0);

  const open = useCallback(() => {
    setStep(0);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  const next = useCallback(() => {
    setStep((s) => {
      if (s < TOUR_STEPS.length - 1) return s + 1;
      // Final stop → close the overlay and drop into the live demo.
      queueMicrotask(() => {
        setIsOpen(false);
        setTimeout(
          () => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' }),
          250,
        );
      });
      return s;
    });
  }, []);

  // Body scroll-lock + keyboard controls while the tour is open.
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, close, next]);

  return (
    <TourContext.Provider value={{ open }}>
      {children}
      <TourOverlay isOpen={isOpen} step={step} onClose={close} onNext={next} />
    </TourContext.Provider>
  );
}
