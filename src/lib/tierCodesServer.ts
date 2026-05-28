// Server-only helpers for Tier Codes. Handles auto-send via Resend so
// the admin never copies-and-pastes — the code goes straight from
// "Generate" click to the family's inbox.
//
// NEVER import this from a client component — pulls in firebase-admin
// + the Resend SDK.

import { Resend } from 'resend';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { DEFAULT_ADDONS, DEFAULT_TIERS, type SubscriptionTierId } from './tiers';
import { expiryCopy } from './tierCodes';

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';

const resend = apiKey ? new Resend(apiKey) : null;

interface SendCodeEmailArgs {
  to: string;
  recipientName: string;       // "Diana" / "The Mwangi Family"
  code: string;                // "HOME-X4K9B2"
  tierId: SubscriptionTierId;
  addons: string[];            // addon ids
  expiresAtMs: number | null;  // null = forever
}

/** Sends the redemption email. Returns { sent: true } on success and
 *  { sent: false, error } on Resend failure or missing API key. Never
 *  throws — the admin UI uses this signal to flag a "Failed to email,
 *  resend?" state but the code is still saved in /tierCodes either way. */
export async function sendCodeEmail(args: SendCodeEmailArgs): Promise<{ sent: boolean; error?: string }> {
  if (!resend) {
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }
  const tier = DEFAULT_TIERS[args.tierId];
  const addonNames = args.addons
    .map((a) => DEFAULT_ADDONS.find((d) => d.id === a)?.name)
    .filter(Boolean) as string[];
  const expiryLine = expiryCopy(args.expiresAtMs);
  const redeemUrl = `${APP_URL}/redeem?code=${encodeURIComponent(args.code)}`;

  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: args.to,
      subject: `Your Kaya ${tier.name} access code — ${args.code}`,
      html: renderCodeEmailHtml({
        recipientName: args.recipientName,
        code: args.code,
        tierName: tier.name,
        tierEmoji: tier.emoji,
        addonNames,
        expiryLine,
        redeemUrl,
      }),
    });
    if (error) {
      return { sent: false, error: String((error as { message?: string }).message ?? error) };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: String(e instanceof Error ? e.message : e) };
  }
}

function renderCodeEmailHtml(args: {
  recipientName: string;
  code: string;
  tierName: string;
  tierEmoji: string;
  addonNames: string[];
  expiryLine: string;
  redeemUrl: string;
}): string {
  const addonsBlock = args.addonNames.length
    ? `<p style="margin:0 0 16px;color:#6E7791;font-size:14px;font-weight:600;line-height:1.55">
        Includes the following add-ons: <strong style="color:#0F1F44">${args.addonNames.join(' · ')}</strong>.
       </p>`
    : '';

  return `
<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:24px;background:#FBF7EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0F1F44">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:white;border-radius:24px;overflow:hidden;border:1px solid rgba(15,31,68,0.08)">
    <tr><td style="padding:32px 32px 18px">
      <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:#D4A847;letter-spacing:0.6px;text-transform:uppercase">Kaya · Your access code</p>
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:900;color:#0F1F44;line-height:1.25">${args.tierEmoji} Welcome to ${args.tierName}, ${args.recipientName}!</h1>
      <p style="margin:0 0 18px;font-size:15px;color:#6E7791;font-weight:600;line-height:1.55">
        Here's your single-use code. Tap below to redeem it, or paste it on the Plan & Billing page when you're next signed in.
      </p>

      <div style="background:#FFF9EC;border:1.5px dashed #D4A847;border-radius:18px;padding:22px;text-align:center;margin:0 0 18px">
        <div style="font-family:'SF Mono',Menlo,Monaco,monospace;font-size:24px;font-weight:900;letter-spacing:4px;color:#D4A847">${args.code}</div>
        <div style="font-size:12px;color:#6E7791;font-weight:700;margin-top:6px">${args.expiryLine}</div>
      </div>

      <div style="text-align:center;margin:0 0 22px">
        <a href="${args.redeemUrl}" style="display:inline-block;background:#D4A847;color:#0F1F44;font-size:14px;font-weight:900;text-decoration:none;padding:12px 24px;border-radius:14px">Tap to redeem →</a>
      </div>

      ${addonsBlock}

      <p style="margin:0 0 6px;color:#6E7791;font-size:12px;font-weight:600;line-height:1.55">
        This code is locked to your family — it won't work on any other account. If you didn't request this, just ignore the email.
      </p>
      <p style="margin:0;color:#6E7791;font-size:12px;font-weight:600;line-height:1.55">
        Questions? Reply to this email and we'll respond same day. 🌻
      </p>
    </td></tr>
    <tr><td style="padding:14px 32px;background:#FBF7EE;text-align:center;color:#6E7791;font-size:11px;font-weight:700">
      Kaya · Where Families Thrive · ourkaya.com
    </td></tr>
  </table>
</body></html>`;
}

// ── DB helpers ───────────────────────────────────────────────────────

/** Look up the requester's email. We accept it from the request doc but
 *  fall back to the family doc / Firebase Auth so a re-send works even
 *  if the original request didn't include one. */
export async function resolveRecipientEmail(
  db: Firestore,
  familyId: string,
  requesterUid: string | null,
): Promise<{ email: string | null; name: string }> {
  let email: string | null = null;
  let name = 'there';

  if (requesterUid) {
    const userSnap = await db.collection('users').doc(requesterUid).get();
    if (userSnap.exists) {
      const u = userSnap.data() as { email?: string; displayName?: string };
      email = u.email ?? null;
      name = u.displayName ?? name;
    }
  }

  if (!email || !name || name === 'there') {
    const famSnap = await db.collection('families').doc(familyId).get();
    if (famSnap.exists) {
      const fam = famSnap.data() as { name?: string; createdBy?: string };
      if (fam.name) name = fam.name;
      if (!email && fam.createdBy) {
        const createdBySnap = await db.collection('users').doc(fam.createdBy).get();
        if (createdBySnap.exists) {
          email = ((createdBySnap.data() as { email?: string }).email) ?? null;
        }
      }
    }
  }

  return { email, name };
}

/** Apply a code redemption to a family doc: set tierId + addons +
 *  expiresAt + audit fields, atomically with marking the code as
 *  redeemed. Idempotent on the code id — re-running with the same code
 *  is a no-op. */
export async function redeemCode(
  db: Firestore,
  codeId: string,
  familyId: string,
): Promise<{ ok: true; tier: SubscriptionTierId } | { ok: false; error: string }> {
  const codeRef = db.collection('tierCodes').doc(codeId);
  const famRef  = db.collection('families').doc(familyId);

  const result = await db.runTransaction<{ ok: true; tier: SubscriptionTierId } | { ok: false; error: string }>(async (tx) => {
    const codeSnap = await tx.get(codeRef);
    if (!codeSnap.exists) return { ok: false, error: 'code-not-found' };
    const code = codeSnap.data() as {
      tierId: SubscriptionTierId;
      addons: string[];
      familyId: string;
      expiresAtMs: number | null;
      status: string;
    };

    if (code.familyId !== familyId) return { ok: false, error: 'wrong-family' };
    if (code.status !== 'fresh')    return { ok: false, error: `code-${code.status}` };
    if (code.expiresAtMs !== null && code.expiresAtMs < Date.now()) {
      tx.update(codeRef, { status: 'expired' });
      return { ok: false, error: 'code-expired' };
    }

    const now = FieldValue.serverTimestamp();
    tx.update(codeRef, {
      status: 'redeemed',
      redeemedAt: now,
    });

    const famPatch: Record<string, unknown> = {
      tierId: code.tierId,
      'subscription.addons': code.addons,
      'subscription.redeemedCodeId': codeRef.id,
      'subscription.redeemedAt': now,
    };
    if (code.expiresAtMs === null) {
      famPatch['subscription.expiresAt'] = FieldValue.delete();
    } else {
      famPatch['subscription.expiresAt'] = new Date(code.expiresAtMs);
    }
    tx.update(famRef, famPatch);

    return { ok: true, tier: code.tierId };
  });

  return result;
}
