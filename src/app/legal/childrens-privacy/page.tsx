import type { Metadata } from 'next';
import LegalDoc, { LegalSection } from '@/components/legal/LegalDoc';

export const metadata: Metadata = {
  title: 'Children’s Privacy Notice · Kaya',
  description: 'How Kaya protects children’s data under COPPA — for parents and guardians.',
};

export default function ChildrensPrivacyPage() {
  return (
    <LegalDoc
      title="Children’s Privacy Notice"
      current="/legal/childrens-privacy"
      intro="This notice is for parents and guardians. It explains, in plain language, what Kaya collects about a child, how we protect it, and the consent you give when you create a Kaya Code — consistent with the U.S. Children’s Online Privacy Protection Act (COPPA)."
    >
      <LegalSection title="What we collect about a child">
        <p>
          Only what’s needed to run Kaya for them: a <strong>first name or nickname</strong>, a <strong>date of birth</strong>, and a{' '}
          <strong>preset avatar</strong>. No email, no password, no photo upload, and no precise location.
        </p>
      </LegalSection>

      <LegalSection title="Verifiable parental consent">
        <p>
          A child is added only by a parent or legal guardian. At the moment you create a Kaya Code, you tick a consent box and re-confirm your identity with
          your password. That step is how we obtain verifiable parental consent under COPPA before any child data is collected.
        </p>
      </LegalSection>

      <LegalSection title="How a child signs in">
        <p>
          Children sign in with a Kaya Code you issue — never an email or password. The code is shown to you once and is stored only as a secure hash; share
          it directly with your child and never post it publicly. You can pause, regenerate, or revoke it at any time.
        </p>
      </LegalSection>

      <LegalSection title="Max-Privacy Mode">
        <p>
          Children’s sessions carry <strong>no advertising, no profiling, and no third-party trackers</strong>, and a child’s data is never used to train AI
          models. Activity logs are deleted on a 30-day rolling basis.
        </p>
      </LegalSection>

      <LegalSection title="Your rights as a parent">
        <p>
          You can review the personal information we hold about your child, ask us to delete it, and refuse further collection by revoking the Kaya Code —
          all from your dashboard, or by emailing{' '}
          <a href="mailto:hello@ourkaya.com" className="text-kaya-gold-dark font-bold underline underline-offset-2">
            hello@ourkaya.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
