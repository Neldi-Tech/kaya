import type { Metadata } from 'next';
import LegalDoc, { LegalSection } from '@/components/legal/LegalDoc';

export const metadata: Metadata = {
  title: 'Children’s Privacy Notice · Kaya',
  description: 'How Kaya protects children’s data — for parents and guardians (COPPA, Tanzania PDPA, GDPR).',
};

const A = 'text-kaya-gold-dark font-bold underline underline-offset-2';

export default function ChildrensPrivacyPage() {
  return (
    <LegalDoc
      title="Children’s Privacy Notice"
      current="/legal/childrens-privacy"
      intro="This notice is for parents and guardians. It explains, in plain language, what Kaya (operated by Kaya Home Inc) collects about a child, how we protect it, and the consent you give when you create a Kaya Code — consistent with the U.S. Children’s Online Privacy Protection Act (COPPA) and the data-protection laws of the places our families live, including Tanzania."
    >
      <LegalSection title="What we collect about a child">
        <p>
          <strong>When you add a child:</strong> a first name or nickname, a date of birth and an avatar. No email address, no password and no
          precise location.
        </p>
        <p>
          <strong>As your family uses Kaya:</strong> what the child or the family adds — routine ratings, points and awards; reflections and diary
          entries, including photos of handwritten pages; photos, videos and voice notes of schoolwork, projects, achievements or Moments; revision
          and quiz answers; reading, game and belongings logs; and any health or care records a parent chooses to keep (for example a medication
          schedule).
        </p>
      </LegalSection>

      <LegalSection title="Verifiable parental consent">
        <p>
          A child is added only by a parent or legal guardian. When you create a Kaya Code you tick a consent box and re-confirm your identity with
          your password. That step is how we obtain verifiable parental consent before any child data is collected.
        </p>
      </LegalSection>

      <LegalSection title="How a child signs in">
        <p>
          Children sign in with a Kaya Code you issue — never an email or password. The code is shown to you once and stored only as a secure hash.
          Share it directly with your child and never post it publicly. You can pause, regenerate or revoke it at any time.
        </p>
      </LegalSection>

      <LegalSection title="Max-Privacy Mode — always on for children">
        <p>
          Children’s sessions carry <strong>no advertising, no profiling and no third-party trackers or analytics</strong>. We never sell a child’s
          data and never use it to train AI. Children’s sign-in session records are deleted automatically after 30 days.
        </p>
      </LegalSection>

      <LegalSection title="AI and a child’s work">
        <p>
          Some features help a child with AI — for example reading their handwritten reflection, or giving warm feedback on a revision. Only the
          page or text for that task is sent to our AI provider, Anthropic, which processes it for us and does not train on it. The child and their
          parent can always see and change the result.
        </p>
      </LegalSection>

      <LegalSection title="Who can see a child’s information">
        <p>
          The child’s parents, and other family members and helpers only as a parent’s settings allow (for example, adults-only books stay hidden
          from children). Outside the family, only the service providers listed in the{' '}
          <a href="/legal/privacy" className={A}>Privacy Policy</a> that run Kaya for us.
        </p>
      </LegalSection>

      <LegalSection title="Your rights as a parent">
        <p>
          You can review the information we hold about your child, ask us to correct or delete it, and stop further collection by revoking the Kaya
          Code. Email{' '}
          <a href="mailto:hello@ourkaya.com" className={A}>hello@ourkaya.com</a>{' '}
          from your account email and we will act within 30 days. To close the whole family account, see{' '}
          <a href="/legal/delete-account" className={A}>Delete your account</a>.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
