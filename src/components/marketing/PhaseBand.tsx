// Sections 6 & 8 — transition bands between phases. Reused for "Born of
// Love" and "A Natural Next Step". Static / server-rendered.

export default function PhaseBand({
  eyebrow,
  title,
  children,
  cream = false,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  cream?: boolean;
}) {
  return (
    <section
      className="phase-band"
      style={cream ? { background: 'var(--cream-warm)' } : undefined}
    >
      <div className="container reveal">
        <span className="phase-mark" />
        <div className="eyebrow">{eyebrow}</div>
        <h2>{title}</h2>
        <p className="lede">{children}</p>
      </div>
    </section>
  );
}
