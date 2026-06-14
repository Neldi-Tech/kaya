// Kaya Pulse · shared UI primitives — the brand mark + a premium screen header,
// so every Pulse parent surface reads with one consistent, elevated look.

import Link from 'next/link';

/** The locked Kaya Pulse mark: navy house, cream window, gold ascending chart
 *  line (from Brand/logos/01_KayaPulse_Mark.svg). Inline SVG so it scales + tints
 *  cleanly anywhere (nav, headers). */
export function PulseMark({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Kaya Pulse">
      <path d="M50,10 L88,40 L88,86 L12,86 L12,40 Z" fill="#0F1F44" strokeLinejoin="round" />
      <rect x="22" y="50" width="56" height="30" fill="#FBF7EE" />
      <line x1="22" y1="76" x2="78" y2="76" stroke="#0F1F44" strokeWidth="1" opacity="0.18" />
      <path d="M28,72 L40,62 L52,66 L68,50" stroke="#D4A847" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="68" cy="50" r="3.5" fill="#D4A847" />
    </svg>
  );
}

/** Premium screen header for Pulse parent surfaces: optional back link, the mark
 *  + eyebrow, a tight display title, and a subtitle. */
export function PulseHeader({
  eyebrow,
  title,
  subtitle,
  back,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-1">
      {back && (
        <Link href={back.href} className="text-[12px] text-pulse-gold-dk font-bold no-underline hover:underline inline-block mb-2">
          ← {back.label}
        </Link>
      )}
      <div className="flex items-center gap-1.5">
        <PulseMark className="w-5 h-5" />
        {eyebrow && <span className="text-[10px] font-nunito font-black uppercase tracking-[2px] text-pulse-gold-dk">{eyebrow}</span>}
      </div>
      <h1 className="font-nunito font-black text-2xl lg:text-[32px] text-pulse-navy mt-1 tracking-tight">{title}</h1>
      {subtitle && <p className="text-hive-muted text-sm mt-1">{subtitle}</p>}
    </div>
  );
}

/** Inline breadcrumb trail for the Pulse drill-down chain (Dashboard → Bucket
 *  → Transaction, etc). The last crumb is non-clickable and styled as the
 *  current page. Pass every link except the current page leaf. */
export function PulseBreadcrumb({ trail, current }: { trail: Array<{ href: string; label: string }>; current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-[10.5px] font-bold text-hive-muted mb-1.5 flex flex-wrap items-center gap-1">
      <Link href="/pulse" className="text-pulse-gold-dk no-underline hover:underline">‹ Pulse</Link>
      {trail.map((c) => (
        <span key={c.href} className="flex items-center gap-1">
          <span className="text-[#cfcfcf]">/</span>
          <Link href={c.href} className="text-pulse-gold-dk no-underline hover:underline">{c.label}</Link>
        </span>
      ))}
      <span className="text-[#cfcfcf]">/</span>
      <span className="text-pulse-navy font-black">{current}</span>
    </nav>
  );
}

/** Premium hero card (navy → indigo gradient with a soft gold-tinted accent
 *  ring), the signature Pulse surface for headline numbers. */
export function PulseHero({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-3xl p-5 text-white shadow-[0_14px_32px_rgba(15,31,68,0.22)] ${className}`}
      style={{ background: 'linear-gradient(135deg,#0F1F44 0%,#1c3566 100%)' }}
    >
      <div className="pointer-events-none absolute -top-10 -right-8 w-32 h-32 rounded-full" style={{ background: 'rgba(212,168,71,0.16)' }} />
      <div className="pointer-events-none absolute -bottom-12 right-10 w-20 h-20 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
      <div className="relative">{children}</div>
    </div>
  );
}
