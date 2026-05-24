// Section 10 — Walk-through. Three steps with inline SVG illustrations.
// Static / server-rendered. SVGs ported verbatim from the mockup.

export default function Walkthrough() {
  return (
    <section className="walk">
      <div className="container">
        <div className="walk-head reveal">
          <div className="eyebrow">A Week in Kaya</div>
          <h2>Three small habits. Twenty minutes total.</h2>
          <p className="lede" style={{ margin: '0 auto' }}>
            Then the loop runs itself — and the family runs warmer.
          </p>
        </div>
        <div className="walk-steps">
          <div className="step reveal delay-1">
            <div className="step-num">1</div>
            <h3>Set up your house</h3>
            <p>Add kids, name your houses, choose the chores and character traits that matter to you.</p>
            <div className="step-visual">
              <svg width="120" height="80" viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">
                <rect x="10" y="20" width="32" height="50" rx="6" fill="#FFD93D" stroke="#0F1F44" strokeWidth="1.5" />
                <rect x="44" y="20" width="32" height="50" rx="6" fill="#EEE5FF" stroke="#0F1F44" strokeWidth="1.5" />
                <rect x="78" y="20" width="32" height="50" rx="6" fill="#DCF5E0" stroke="#0F1F44" strokeWidth="1.5" />
                <text x="26" y="48" textAnchor="middle" fontSize="14" fontWeight="700" fill="#0F1F44">M</text>
                <text x="60" y="48" textAnchor="middle" fontSize="14" fontWeight="700" fill="#0F1F44">L</text>
                <text x="94" y="48" textAnchor="middle" fontSize="14" fontWeight="700" fill="#0F1F44">T</text>
              </svg>
            </div>
          </div>
          <div className="step reveal delay-2">
            <div className="step-num">2</div>
            <h3>Rate the day in seconds</h3>
            <p>Bed made. Plate cleared. Sister helped. Quick taps from parents or helpers. The signal builds quietly.</p>
            <div className="step-visual">
              <svg width="160" height="60" viewBox="0 0 160 60" xmlns="http://www.w3.org/2000/svg">
                <rect x="10" y="20" width="36" height="20" rx="10" fill="#6BCB77" />
                <text x="28" y="34" textAnchor="middle" fontSize="11" fontWeight="700" fill="white">+5</text>
                <rect x="55" y="20" width="36" height="20" rx="10" fill="#FFD93D" />
                <text x="73" y="34" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0F1F44">+3</text>
                <rect x="100" y="20" width="36" height="20" rx="10" fill="#E85C5C" />
                <text x="118" y="34" textAnchor="middle" fontSize="11" fontWeight="700" fill="white">+10</text>
              </svg>
            </div>
          </div>
          <div className="step reveal delay-3">
            <div className="step-num">3</div>
            <h3>Meet on Sunday</h3>
            <p>Twenty minutes. Notice the good. Shape the next week together. The single most powerful habit.</p>
            <div className="step-visual">
              <svg width="140" height="80" viewBox="0 0 140 80" xmlns="http://www.w3.org/2000/svg">
                <circle cx="40" cy="40" r="14" fill="#FFD93D" stroke="#0F1F44" strokeWidth="1.5" />
                <circle cx="70" cy="40" r="14" fill="#9B72CF" stroke="#0F1F44" strokeWidth="1.5" />
                <circle cx="100" cy="40" r="14" fill="#6BCB77" stroke="#0F1F44" strokeWidth="1.5" />
                <text x="40" y="44" textAnchor="middle" fontSize="12" fontWeight="700" fill="#0F1F44">M</text>
                <text x="70" y="44" textAnchor="middle" fontSize="12" fontWeight="700" fill="white">L</text>
                <text x="100" y="44" textAnchor="middle" fontSize="12" fontWeight="700" fill="#0F1F44">T</text>
                <path d="M30 65 Q70 75 110 65" fill="none" stroke="#F39C2F" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
