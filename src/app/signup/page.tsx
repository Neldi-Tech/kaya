import type { Metadata } from 'next';
import AuthShell from '@/components/auth/AuthShell';
import AuthControls from '@/components/auth/AuthControls';

// /signup — parent sign-up, re-skinned to the live Kaya master via
// <AuthShell mode="signup">. Captures the parent only — NO child data here;
// COPPA-grade verifiable consent is deferred to /family/add-child where it
// actually applies. The "Create account" tap is the clickwrap acceptance,
// logged by <AuthControls>. In closed beta, allowlisted invitees still sign
// up here; the not-invited path routes to the waitlist.

export const metadata: Metadata = {
  title: 'Create your account · Kaya',
  description: 'Create a Kaya account — daily routines, points and weekly meetings for your family.',
};

export default function SignupPage() {
  return (
    <AuthShell mode="signup">
      <AuthControls mode="signup" />
    </AuthShell>
  );
}
