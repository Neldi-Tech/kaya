import type { Metadata } from 'next';
import LegalDoc, { LegalSection } from '@/components/legal/LegalDoc';

// Google Play requires a public page, named for the app and its developer,
// that explains how to request account + data deletion and what is kept.
export const metadata: Metadata = {
  title: 'Delete your account · Kaya',
  description: 'How to delete your Kaya account and your family’s data (Kaya — Kaya Home Inc).',
};

const A = 'text-kaya-gold-dark font-bold underline underline-offset-2';
const MAIL = 'mailto:hello@ourkaya.com?subject=Delete%20my%20Kaya%20account&body=Please%20delete%20my%20Kaya%20family%20account%20and%20its%20data.%0A%0AAccount%20email%3A%20';

export default function DeleteAccountPage() {
  return (
    <LegalDoc
      title="Delete your account"
      current="/legal/delete-account"
      intro="This page explains how to delete your Kaya account and your family’s data, for the Kaya website and the Kaya Android app by Kaya Home Inc."
    >
      <LegalSection title="How to ask us to delete your account">
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>
            In Kaya, open <strong>Settings → Delete my account</strong>, or tap the button below.
          </li>
          <li>
            Send the email <strong>from the email address you use to sign in to Kaya</strong>, so we know the request is really yours. Only a parent
            can delete a family account.
          </li>
          <li>We confirm by email, then delete the account and its data within 30 days.</li>
        </ol>
        <p className="pt-2">
          <a href={MAIL} className="inline-block bg-kaya-chocolate text-kaya-gold-light font-display font-bold px-5 py-3 rounded-kaya no-underline">
            Email us to delete my account
          </a>
        </p>
        <p className="text-[13px]">
          Or email <a href="mailto:hello@ourkaya.com" className={A}>hello@ourkaya.com</a> with the subject “Delete my Kaya account”.
        </p>
      </LegalSection>

      <LegalSection title="What we delete">
        <p>
          Your family account and every member’s sign-in; the children’s profiles and Kaya Codes; routines, ratings, points and awards;
          reflections, diaries, photos, videos and voice notes; messages and Moments; health, household and finance records; and your WhatsApp,
          notification and sign-in links.
        </p>
      </LegalSection>

      <LegalSection title="What we keep, and for how long">
        <p>
          Copies in our backups are overwritten within 90 days of deletion. Payment and invoice records held by our payment provider (Stripe) are
          kept for as long as tax law requires. We may keep anonymous totals that cannot identify you or your family.
        </p>
      </LegalSection>

      <LegalSection title="Deleting only some data">
        <p>
          You do not have to close your account to remove something. Parents can delete individual items in the app. To remove a child’s profile
          or ask for specific data to be deleted, email <a href="mailto:hello@ourkaya.com" className={A}>hello@ourkaya.com</a> and we will act
          within 30 days. See also the <a href="/legal/privacy" className={A}>Privacy Policy</a>.
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
