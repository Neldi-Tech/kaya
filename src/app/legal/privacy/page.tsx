import type { Metadata } from 'next';
import LegalDoc, { LegalSection } from '@/components/legal/LegalDoc';

export const metadata: Metadata = {
  title: 'Privacy Policy · Kaya',
  description: 'How Kaya collects, uses, and protects your family’s data.',
};

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      current="/legal/privacy"
      intro="We built Kaya to be private by default. This policy explains what we collect, why, and the controls you have. Children’s data is handled under stricter rules — see the Children’s Privacy notice."
    >
      <LegalSection title="What we collect">
        <p>
          For a parent account: your name, email, and the settings you choose. For a child you add: only a first name or nickname, a date of birth, and a
          preset avatar. We do not ask for or store a child’s email, password, photo, or precise location.
        </p>
      </LegalSection>

      <LegalSection title="Max-Privacy Mode — always on for kids">
        <p>
          Child sessions run with <strong>no advertising, no profiling, and no third-party trackers or analytics SDKs</strong>. We do not sell personal
          data, and we never use a child’s data to train AI models. This isn’t a setting you have to find — it’s always on.
        </p>
      </LegalSection>

      <LegalSection title="How we use data">
        <p>
          We use the information above to run Kaya for your family — to show routines and points, run your weekly meeting, and keep your account secure. We
          don’t use it to build advertising profiles.
        </p>
      </LegalSection>

      <LegalSection title="Retention & deletion">
        <p>
          Children’s activity logs are deleted on a 30-day rolling basis. You can delete a child, revoke their Kaya Code, or close your account at any time
          from your dashboard; deleting removes the associated personal data.
        </p>
      </LegalSection>

      <LegalSection title="Your controls">
        <p>
          As a parent you can review, pause, or delete a child’s data whenever you like. To exercise any privacy right or ask a question, email{' '}
          <a href="mailto:hello@ourkaya.com" className="text-kaya-gold-dark font-bold underline underline-offset-2">
            hello@ourkaya.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
