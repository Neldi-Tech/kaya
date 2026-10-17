import type { Metadata } from 'next';
import LegalDoc, { LegalSection } from '@/components/legal/LegalDoc';

export const metadata: Metadata = {
  title: 'Privacy Policy · Kaya',
  description: 'How Kaya Home Inc collects, uses, shares and protects your family’s data — on the web and in the Kaya Android app.',
};

const A = 'text-kaya-gold-dark font-bold underline underline-offset-2';

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      current="/legal/privacy"
      intro="Kaya is a family app — routines, points, the weekly family meeting, Sparks learning, Moments and more. This policy explains, in plain language, what we collect, why, who helps us run Kaya, and the controls you have. Children’s data is handled under stricter rules — see the Children’s Privacy Notice."
    >
      <LegalSection title="Who we are">
        <p>
          Kaya is operated by <strong>Kaya Home Inc</strong> (“Kaya”, “we”, “us”). This policy covers the Kaya website at ourkaya.com and the
          Kaya Android app (package <code>com.ourkaya.app</code>), which open the same service. Questions or requests:{' '}
          <a href="mailto:hello@ourkaya.com" className={A}>hello@ourkaya.com</a>.
        </p>
      </LegalSection>

      <LegalSection title="What we collect">
        <p>
          <strong>Parents and other adults with an account:</strong> your name, email address and sign-in details (a password, which our sign-in
          provider stores securely, or Google sign-in); your role in the family; the settings you choose; your phone number <em>only if</em> you
          turn on WhatsApp alerts; and your subscription status. Card payments are handled by Stripe — we never see or store your full card number.
        </p>
        <p>
          <strong>Children you add:</strong> a first name or nickname, a date of birth and an avatar. Children never create their own account;
          they sign in with a Kaya Code you issue. See the Children’s Privacy Notice.
        </p>
        <p>
          <strong>What your family creates in Kaya:</strong> routines, ratings, points and awards; notes and comments; family-meeting records;
          reflections and diary entries (typed text, and photos of handwritten pages); photos, videos and voice notes added to Sparks, Moments or
          family chat; schoolwork and revision photos; reading and game logs; wishlists; and household, pantry and finance records you choose to keep.
        </p>
        <p>
          <strong>Health information you choose to log:</strong> for example a child’s medication or care schedule and doses, and diet, fasting or
          exercise records. This is only collected when someone in your family enters it, and is visible only to the family members your settings allow.
        </p>
        <p>
          <strong>Technical information:</strong> device and browser type, a notification token if you allow notifications, and security logs
          (such as IP address and sign-in times) used to keep accounts safe. <strong>We do not collect precise location.</strong>
        </p>
      </LegalSection>

      <LegalSection title="How we use it">
        <p>
          Only to run Kaya for your family: to show routines and points, run your family meeting, power Sparks, Moments and the other features you
          use, send the reminders and alerts you turn on (in-app, push, email or WhatsApp), keep accounts secure, provide support, and manage your
          subscription. <strong>We do not sell personal data, we show no advertising, and we build no advertising profiles.</strong>
        </p>
      </LegalSection>

      <LegalSection title="AI features">
        <p>
          Some features use AI — for example reading a child’s handwritten reflection, suggesting a summary of a book, scoring a revision or
          drafting a gentle note. When you use one, Kaya sends only the text or image needed for that task to our AI provider,{' '}
          <strong>Anthropic</strong> (the Claude models), which processes it on our behalf and returns the result. Under our commercial terms
          Anthropic does not use this data to train its models, and <strong>we never use a child’s data to train AI</strong>. AI can make
          mistakes — the words are always shown for a parent or child to check and change.
        </p>
      </LegalSection>

      <LegalSection title="Who helps us run Kaya">
        <p>We share data only with providers that run parts of Kaya for us, under contracts that limit their use to that job:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Google Firebase / Google Cloud</strong> — accounts, database, file and photo storage, push notifications.</li>
          <li><strong>Vercel</strong> — hosting the Kaya website and app service.</li>
          <li><strong>Anthropic</strong> — the AI features described above.</li>
          <li><strong>Stripe</strong> — subscription payments (parents only).</li>
          <li><strong>Resend</strong> — sending Kaya emails.</li>
          <li><strong>Twilio</strong> — WhatsApp alerts, only for adults who switch them on.</li>
          <li><strong>Google</strong> — “Sign in with Google”, if you choose it.</li>
        </ul>
        <p>
          Inside your family, members see family content according to the roles and settings a parent controls. We may also disclose information
          if the law requires it, to protect someone’s safety, or as part of a merger or sale of Kaya Home Inc (with this policy continuing to apply).
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          We keep your family’s data while your account is open so Kaya works for you. Children’s sign-in session records are deleted automatically
          after 30 days. Anything you delete in the app is removed. When you close your account we delete the family’s personal data within 30
          days; copies in backups are overwritten within a further 90 days. We keep only what the law requires — for example payment records for
          tax purposes.
        </p>
      </LegalSection>

      <LegalSection title="Your rights and controls">
        <p>
          You can view and correct your family’s data in the app, delete items, ask us for a copy of your data, withdraw consent for a child, and
          turn notifications and WhatsApp alerts on or off. To close your account and delete your data, see{' '}
          <a href="/legal/delete-account" className={A}>Delete your account</a>. Depending on where you live — for example under Tanzania’s Personal
          Data Protection Act, Kenya’s Data Protection Act, the EU/UK GDPR or the US Children’s Online Privacy Protection Act (COPPA) — you may have
          further rights, including to complain to your data-protection authority. Email{' '}
          <a href="mailto:hello@ourkaya.com" className={A}>hello@ourkaya.com</a> to use any of them; we reply within 30 days.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Data is encrypted in transit (HTTPS) and at rest by our providers. Access is limited by role, Kaya Codes are stored only as a secure hash,
          and phone numbers for WhatsApp are kept where children and helpers cannot read them. No system is perfectly secure; if a breach affects
          you, we will tell you and the authorities as the law requires.
        </p>
      </LegalSection>

      <LegalSection title="Where your data is stored">
        <p>
          Our providers run servers in several countries, so your data may be stored or processed outside the country you live in, including in
          the United States and the European Union. We rely on our providers’ contractual safeguards for these transfers.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>
          If we make a material change, we will update the version date above and ask parents to review and accept it in the app before
          continuing.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
