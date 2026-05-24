// Section 12 — Privacy & Trust. Three approval cards (Single / Dual).
// Static / server-rendered.

export default function Privacy() {
  return (
    <section className="privacy">
      <div className="container privacy-grid">
        <div className="reveal">
          <div className="eyebrow">Privacy &amp; Trust</div>
          <h2>You control what kids see — to the field.</h2>
          <p className="lede">
            Single or Dual parent approvals, configurable per data category. Defaults
            are sensible. Defaults are also yours to change.
          </p>
        </div>
        <div className="reveal delay-2">
          <div className="approval-card">
            <h4>
              Chore approvals, daily spend <span className="tag">Single</span>
            </h4>
            <p>One parent&apos;s OK is enough for everyday flows. Speed where it matters.</p>
          </div>
          <div className="approval-card dual">
            <h4>
              Net worth, property values, legacy notes <span className="tag">Dual</span>
            </h4>
            <p>Both parents must approve. Locked by default for Kaya Wealth.</p>
          </div>
          <div className="approval-card">
            <h4>
              Honey → Cash conversions <span className="tag">Single</span>
            </h4>
            <p>Kids can&apos;t withdraw without a parent. Adjustable per family.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
