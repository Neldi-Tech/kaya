import type { Metadata } from 'next';
import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import AuthControls from '@/components/auth/AuthControls';

// /login — parent login, re-skinned to the live Kaya master (gold/chocolate/
// cream + Outfit/Plus Jakarta) via <AuthShell>. The clickwrap CTA inside
// <AuthControls> is the acceptance; a subordinate kid "Kaya Code" path and a
// quiet helper sign-in link keep the other two audiences from getting lost.

export const metadata: Metadata = {
  title: 'Log in · Kaya',
  description: 'Log in to run your family’s week on Kaya.',
};

export default function LoginPage() {
  return (
    <AuthShell mode="login">
      <AuthControls mode="login" />

      {/* Helpers have no email/password account — they sign in with the
          codes their family gave them. Kept quiet + distinct. */}
      <p className="text-center text-[13px] text-kaya-sand pt-5 mt-5 border-t border-kaya-warm-dark/70">
        Helping a family with their kids?{' '}
        <Link href="/h/login" className="font-bold text-kaya-chocolate hover:text-kaya-gold-dark">
          Helper sign-in →
        </Link>
      </p>
    </AuthShell>
  );
}
