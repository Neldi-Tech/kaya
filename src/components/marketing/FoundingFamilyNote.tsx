// Section 15 — A note from the Founding Family. "E" avatar, never names
// Elia; signs "— The Founding Family". Static / server-rendered.

export default function FoundingFamilyNote() {
  return (
    <section className="founder">
      <div className="container">
        <div className="founder-grid reveal">
          <div className="founder-photo">E</div>
          <div>
            <div className="eyebrow">A Note From the Founding Family</div>
            <h2 style={{ fontSize: 28, marginBottom: 18 }}>Why our family built this.</h2>
            <p>
              We were a busy household with three kids, and we kept feeling the same
              thing: we were too tired to be the parents we wanted to be. Not bad
              parents. Just stretched.
            </p>
            <p>
              We didn&apos;t want another reward chart. We wanted a quiet system — for
              love, for our Sunday meetings, for the slow work of shaping character —
              that fit a real, busy week. Kaya is what we built for ourselves first.
              The money parts came later, because the foundation worked.
            </p>
            <p>
              We&apos;re sharing it now because we don&apos;t think we&apos;re the only
              family who feels this way.
            </p>
            <span className="sign">— The Founding Family</span>
          </div>
        </div>
      </div>
    </section>
  );
}
