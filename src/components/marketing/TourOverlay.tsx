'use client';

import { TOUR_STEPS } from './tourSteps';

// The guided-tour modal. Controlled by TourProvider. Backdrop click + the
// close button dismiss it; Esc / → are handled by the provider.
export default function TourOverlay({
  isOpen,
  step,
  onClose,
  onNext,
}: {
  isOpen: boolean;
  step: number;
  onClose: () => void;
  onNext: () => void;
}) {
  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <div
      className={`kaya-mk-overlay${isOpen ? ' open' : ''}`}
      aria-hidden={!isOpen}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button type="button" className="tour-close" onClick={onClose} aria-label="Close tour">
        ✕
      </button>
      <div className="tour-card" role="dialog" aria-modal="true" aria-label="Kaya guided tour">
        <div className="tour-side">
          <div>
            <div className="tour-progress">
              {TOUR_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`dot${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}
                />
              ))}
            </div>
            <div className="tour-step-label">
              Stop {step + 1} of {TOUR_STEPS.length}
            </div>
            <h3>{current.title}</h3>
            <p>{current.body}</p>
          </div>
          <div className="tour-controls">
            <button type="button" className="tour-btn skip" onClick={onClose}>
              Skip
            </button>
            <button type="button" className="tour-btn next" onClick={onNext}>
              {isLast ? 'Drop me in the demo →' : 'Next →'}
            </button>
          </div>
        </div>
        <div className="tour-stage">{current.stage}</div>
      </div>
    </div>
  );
}
