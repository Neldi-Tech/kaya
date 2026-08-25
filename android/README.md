# Kaya for Google Play — Android build runbook

Kaya ships to Google Play as a **Trusted Web Activity (TWA)**: a thin native
Android shell that renders `https://www.ourkaya.com` full-screen, with no URL
bar, using the user's installed Chrome engine. There is no second codebase —
every deploy to Vercel is instantly live inside the installed app.

Generated and maintained with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap).

> **The generated Android project is deliberately NOT committed.** It is
> reproducible from `twa-manifest.json` + the live web manifest. What *must*
> be kept safe is the signing keystore — see [Signing keys](#4-signing-keys).

---

## 0. What the web app already provides

| Requirement | Where it lives | Status |
| --- | --- | --- |
| Web app manifest (`id`, `scope`, maskable icons, shortcuts) | [`public/manifest.json`](../public/manifest.json) | ✅ |
| Digital Asset Links endpoint | [`src/app/api/assetlinks/route.ts`](../src/app/api/assetlinks/route.ts), rewritten to `/.well-known/assetlinks.json` in [`next.config.js`](../next.config.js) | ✅ endpoint live, ⚠️ awaiting fingerprint |
| Privacy Policy URL | `/legal/privacy` | ✅ live |
| Terms URL | `/legal/terms` | ✅ live |
| Children's Privacy notice | `/legal/childrens-privacy` | ✅ live |
| Push notifications | FCM service worker, delegated to Android by the TWA | ✅ |
| Install prompt suppressed in-app | `InstallPrompt` bails on `display-mode: standalone` | ✅ |

---

## 1. Prerequisites

Bubblewrap will offer to download a JDK and the Android SDK build-tools on
first run (~1.5 GB into `~/.bubblewrap`). Accept — you do not need Android
Studio.

```bash
npm install -g @bubblewrap/cli
```

---

## 2. Generate the Android project

Run from **this** directory. Bubblewrap reads the *live* web manifest, which is
why the manifest hardening had to ship first.

```bash
bubblewrap init --manifest=https://www.ourkaya.com/manifest.json
```

Answer the prompts with these values. **The package name is permanent once
published — it can never be changed for this listing.**

| Prompt | Value |
| --- | --- |
| Domain | `www.ourkaya.com` |
| Application name | `Kaya — Where Families Grow` |
| Short name | `Kaya` |
| Application ID / package | `com.ourkaya.app` |
| Start URL | `/` |
| Icon URL | `https://www.ourkaya.com/icon-512.png` |
| Maskable icon URL | `https://www.ourkaya.com/icon-512.png` |
| Status bar colour | `#1E120B` |
| Navigation bar colour | `#1E120B` |
| Splash screen colour | `#FDFBF7` |
| Display mode | `standalone` |
| Orientation | `portrait` |
| Version code | `1` |
| Version name | `1.0.0` |
| Include support for Play Billing | **No** — see [Payments](#6-payments-the-one-real-policy-risk) |
| Request geolocation permission | **No** |
| Enable notification delegation | **Yes** (Kaya uses FCM push) |

This writes `twa-manifest.json` plus a Gradle project into this directory.
Commit `twa-manifest.json`; everything else is generated output.

### Target SDK

Google Play enforces a minimum `targetSdkVersion` for new apps and it moves
every August. Bubblewrap's current release targets the level required at the
time it was published — **check Play Console's rejection message if the upload
is refused**, then bump `targetSdkVersion` in `twa-manifest.json` and re-run
`bubblewrap update`. Do not guess this value from memory.

---

## 3. Build the App Bundle

```bash
bubblewrap build
```

Produces `app-release-bundle.aab` (upload this to Play) and
`app-release-signed.apk` (sideload this to test on a real device).

Re-running after any change to `twa-manifest.json`:

```bash
bubblewrap update && bubblewrap build
```

Bump `appVersionCode` (integer, must increase every upload) and
`appVersionName` (human-readable) for each Play release.

---

## 4. Signing keys

`bubblewrap init` creates `android.keystore` and asks for two passwords.

> 🔐 **Back this up before doing anything else.** The keystore plus both
> passwords are the *only* way to push an update to this listing. Losing them
> means the app can never be updated — the listing has to be republished under
> a new package name, and every install is orphaned.
>
> Store `android.keystore` + passwords in the Kaya password manager / 1Password
> vault. It is git-ignored here and must never be committed.

Enrolling in **Play App Signing** (the default for new apps) gives Google a
recovery path for the *app signing* key, but the *upload* key in this keystore
is still yours to protect.

---

## 5. Wire up Digital Asset Links

This is the step that removes the URL bar. Until it is done the app works but
renders with a Chrome address bar across the top — which reads as broken and
will draw reviewer comments.

1. Upload the `.aab` to Play Console (Internal testing is fine for this).
2. Go to **Test and release → Setup → App signing**.
3. Copy the **SHA-256 certificate fingerprint** under *App signing key
   certificate* — this is Google's key, not your local one.
4. Also grab your local upload key fingerprint so sideloaded test builds
   verify too:
   ```bash
   keytool -list -v -keystore android.keystore -alias android | grep SHA256
   ```
5. In Vercel → project `kaya` → **Settings → Environment Variables**, set for
   **Production, Preview and Development**:

   | Name | Value |
   | --- | --- |
   | `ANDROID_SHA256_FINGERPRINTS` | both fingerprints, comma-separated |
   | `ANDROID_PACKAGE_NAME` | `com.ourkaya.app` (optional — this is the default) |

   The endpoint tolerates upper/lower case, with or without colons.
6. Redeploy production (env vars only take effect on a new deploy).
7. Verify:
   ```bash
   curl -s https://www.ourkaya.com/.well-known/assetlinks.json
   ```
   It must return a non-empty array with `package_name: "com.ourkaya.app"` and
   a `Content-Type: application/json` header.
8. Confirm Google agrees:
   <https://developers.google.com/digital-asset-links/tools/generator>
9. Reinstall the app. No URL bar → verified. 🎉

---

## 6. Payments — the one real policy risk

Kaya sells subscription tiers (Nest / Home / Castle) through **Stripe**.
Google Play's Payments policy requires digital purchases made *inside* an app
to go through Google Play Billing (15–30% fee). A TWA that walks a user into a
Stripe checkout is the exact pattern that policy targets.

This is a business decision, not a technical one. The options:

- **Gate it.** Detect the TWA and hide the upgrade/checkout entry point inside
  the Android app; families subscribe on the website. Lowest risk, zero fee,
  some friction. (Detect via `document.referrer.startsWith('android-app://')`.)
- **Play Billing.** Re-run `bubblewrap init` answering *Yes* to Play Billing
  and implement the Digital Goods API. Compliant everywhere, costs the fee, and
  is real engineering work.
- **External link (US only).** Post-*Epic v. Google*, US listings may link out
  to external payment. Narrower than it sounds and the rules are still moving —
  worth confirming against current policy before relying on it.

**Nothing in this repo gates the Stripe flow yet.** Decide before the first
production release.

---

## 7. Play Console checklist

Declarations for a **mixed audience (parents + children)** listing:

- **App content → Target audience and content**: select both adult and child
  age bands. Kaya must then pass Families Policy review.
- **App content → Privacy policy**: `https://www.ourkaya.com/legal/privacy`
- **App content → Data safety**: declare account data, user content, photos,
  and approximate location if collected. Must match what the Privacy Policy
  says — mismatches are the most common rejection.
- **App content → Data deletion**: `https://www.ourkaya.com/legal/delete-account`
- **App content → Ads**: *No ads* (Kaya serves none — keep it that way for the
  child bands).
- **Content rating**: complete the IARC questionnaire. Declare the in-app
  social surfaces honestly — family chat, Moments, and the Buzz community are
  user-generated content and need moderation plus a report mechanism.
- **Financial features**: declare the Stripe subscription if it stays reachable
  in-app (see §6).
- **Store listing**: app icon 512×512, feature graphic 1024×500, at least two
  phone screenshots, short description (≤80 chars), full description
  (≤4000 chars).

Because the Play developer account is registered as an **organization**, the
"12 testers for 14 continuous days of closed testing" requirement that applies
to personal accounts does **not** apply — production access is available
directly. Running an Internal testing track first is still the sane way to get
the fingerprint and shake out the install.
