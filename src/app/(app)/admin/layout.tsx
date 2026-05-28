'use client';

// /admin/* — shared operator gate + tab nav. The nav is a thin sticky
// bar that floats above whatever chrome the child page paints. Existing
// /admin (closed-beta) keeps its cream theme; new tabs added in PR 2
// (Tiers & Modules, Buzz Settings) paint a premium navy chrome.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getOperatorRole, type OperatorRole } from '@/lib/access';

const TABS: { href: string; label: string }[] = [
  { href: '/admin',          label: 'Closed beta' },
  { href: '/admin/tiers',    label: 'Tiers & Modules' },
  { href: '/admin/buzz',     label: 'Buzz Settings' },
  { href: '/admin/pricing',  label: 'Pricing' },
  { href: '/admin/branding', label: 'Branding' },
  { href: '/admin/families', label: 'Families' },
  { href: '/admin/upgrade-requests', label: 'Upgrades' },
  { href: '/admin/pipeline', label: 'Pipeline' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRole] = useState<OperatorRole | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await getOperatorRole(user?.email);
      if (cancelled) return;
      setRole(r);
      if (!r) router.replace('/');
    })();
    return () => { cancelled = true; };
  }, [user?.email, router]);

  if (role === undefined) {
    return <div className="min-h-screen flex items-center justify-center bg-kaya-cream text-kaya-sand text-sm">Checking access…</div>;
  }
  if (!role) return null;

  return (
    <div>
      <div className="sticky top-0 z-40 px-4 sm:px-6 py-2 border-b border-black/10" style={{ background: 'rgba(15,31,68,0.96)', backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-[11px] font-bold text-[#D4A847] uppercase tracking-wider mr-2 whitespace-nowrap">👑 Admin</span>
          {TABS.map((tab) => {
            const active = tab.href === '/admin' ? pathname === '/admin' : pathname?.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`text-[12px] font-bold px-2.5 py-1.5 rounded-lg whitespace-nowrap ${
                  active
                    ? 'bg-[#D4A847] text-[#0F1F44]'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>
      {children}
    </div>
  );
}
