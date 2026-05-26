// Shared "Coming soon" placeholder for the four Admin tabs that ship as
// stubs in PR 2 (Pricing / Branding / Families / Pipeline). They'll fill
// out in v1.1; in the meantime each tab renders this so the nav at the
// top stays coherent and the operator knows where the feature lives.

export function AdminStub({ title, emoji, summary }: { title: string; emoji: string; summary: string }) {
  return (
    <div className="min-h-screen text-white" style={{ background: 'linear-gradient(180deg,#0F1F44 0%,#162954 100%)' }}>
      <div className="max-w-[820px] mx-auto p-5 sm:p-9">
        <header className="mb-6">
          <h2 className="font-display font-extrabold text-2xl text-white tracking-tight m-0 flex items-center gap-2">{emoji} {title}</h2>
          <p className="text-white/70 text-sm mt-1">{summary}</p>
        </header>
        <section className="rounded-[20px] p-6 border border-white/[0.08]" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🛠</div>
            <h3 className="font-display font-bold text-lg text-white m-0">Coming soon</h3>
            <p className="text-white/60 text-[13px] mt-2 max-w-md mx-auto">
              This admin surface ships in v1.1. The data model + matrix that powers it is live now — see
              <b className="text-[#D4A847]"> Tiers &amp; Modules</b> and <b className="text-[#D4A847]">Sparks Settings</b>.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
