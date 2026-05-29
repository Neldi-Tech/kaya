import type { Metadata } from 'next';
import LegalDoc, { LegalSection } from '@/components/legal/LegalDoc';

export const metadata: Metadata = {
  title: 'Terms of Service · Kaya',
  description: 'The terms that govern your use of Kaya.',
};

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of Service"
      current="/legal/terms"
      intro="Kaya helps families run a calm weekly rhythm — routines, points and a family meeting. These terms set out who can use Kaya and the responsibilities that come with creating an account or a child’s Kaya Code."
    >
      <LegalSection title="Who can use Kaya">
        <p>
          Kaya is for adults aged <strong>18 or older</strong>. By creating an account you confirm you are 18+ and that the information you give us is
          accurate. Children never create their own Kaya account — they join only through a Kaya Code issued by a parent or legal guardian.
        </p>
      </LegalSection>

      <LegalSection title="Your account">
        <p>
          You are responsible for keeping your login details safe and for activity that happens under your account. Tell us promptly if you believe your
          account has been used without your permission.
        </p>
      </LegalSection>

      <LegalSection title="Kaya Codes & children">
        <p>
          A Kaya Code lets a child sign in without an email or password. When you create a code, you confirm that you are that child’s parent or legal
          guardian, you give verifiable parental consent under COPPA and applicable law, and you accept responsibility for the child’s use of Kaya. You can
          pause, revoke, or delete a child and their code from your dashboard at any time.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>
          Use Kaya lawfully and kindly. Don’t attempt to disrupt the service, access other families’ data, or use Kaya to harm a child. We may suspend
          accounts that break these terms.
        </p>
      </LegalSection>

      <LegalSection title="Changes to these terms">
        <p>
          We may update these terms as Kaya grows. When a change is material, we’ll ask you to review and accept the update the next time you sign in before
          you continue.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
