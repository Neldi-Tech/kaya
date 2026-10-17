# Kaya for Google Play — Android build runbook

Kaya ships to Google Play as a **Trusted Web Activity (TWA)**: a thin native
Android shell that renders `https://www.ourkaya.com` full-screen, with no URL
bar, using the user's installed Chrome engine. There is no second codebase —
every deploy to Vercel is instantly live inside the installed app.

Owner: **Kaya Home Inc** · package **`com.ourkaya.app`** (permanent once published).

> **This folder IS the Android app.** A small, hand-written TWA project
> (Google's `androidbrowserhelper`) — no Android Studio, no Bubblewrap, no
> developer laptop needed. GitHub builds it: **Actions → "Android app build"
> → Run workflow** → download `kaya-android` (the `.aab` for Play, the `.apk`
> to install directly). Everything that changes the app's look or URL is in
> [`app/build.gradle`](app/build.gradle) (`def twa = [...]`).

---

## 0. What the web app already provides

| Requirement | Where it lives | Status |
| --- | --- | --- |
| Web app manifest (`id`, `scope`, maskable icons, shortcuts) | [`public/manifest.json`](../public/manifest.json) | ✅ |
| Digital Asset Links endpoint | [`src/app/api/assetlinks/route.ts`](../src/app/api/assetlinks/route.ts), rewritten to `/.well-known/assetlinks.json` in [`next.config.js`](../next.config.js) | ✅ endpoint live, ⚠️ awaiting fingerprint |
| **App mode** (in-app purchases hidden) | [`src/lib/appMode.ts`](../src/lib/appMode.ts) — the app launches `/home?source=android-app` | ✅ |
| Privacy Policy / Terms / Children's Privacy | `/legal/privacy` · `/legal/terms` · `/legal/childrens-privacy` | ⚠️ update pending approval |
| Account deletion page (Play requirement) | `/legal/delete-account` | ⚠️ pending approval |
| Push notifications | FCM service worker, delegated to Android by the TWA (`DelegationService`) | ✅ |
| Install prompt suppressed in-app | `InstallPrompt` bails on `display-mode: standalone` | ✅ |

---

## 1. Build it (no laptop needed)

**GitHub → Actions → "Android app build" → Run workflow** (pick a *Version
name* like `1.0.1`). In ~5 minutes the run page shows a summary (package,
version, signing fingerprint) and an artifact **`kaya-android`** with:

- `kaya-<n>.aab` → upload to **Play Console**
- `kaya-<n>.apk` → install directly on a phone (Option C — direct download)

The version code is the run number, so it always increases (Play rejects a
repeat). It also builds automatically on any PR that touches `android/`, and
on a tag `android-v*`.

### Target SDK

Google Play's minimum `targetSdk` rises every August. This project targets
**API 36**. If Play Console refuses an upload for the target level, bump
`compileSdk`/`targetSdk` in `app/build.gradle` (and the platform in the
workflow) — don't guess, read the rejection message.

---

## 2. Signing keys (one-time, 🔐 Kaya Home Inc's most important app asset)

Without secrets the workflow signs with a **throwaway TEST key** — fine for
trying the APK on a phone, **never for Play**. For real releases create the
**upload key** once:

```bash
keytool -genkeypair -v -keystore kaya-upload.jks -alias kaya-upload \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Kaya Home Inc, O=Kaya Home Inc"
base64 -w0 kaya-upload.jks > kaya-upload.jks.b64
```

Add four **GitHub → Settings → Secrets and variables → Actions** secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_B64` | contents of `kaya-upload.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `kaya-upload` |
| `ANDROID_KEY_PASSWORD` | the key password (same as above if you used one) |

> Back up `kaya-upload.jks` + passwords in the Kaya Home Inc password vault.
> Enrol in **Play App Signing** (the default): Google holds the real app
> signing key, so a lost *upload* key can be reset through Play support —
> but treat it as irreplaceable anyway. Never commit it (`*.jks` is ignored).

**Direct-download APK vs Play:** an APK signed with the upload key and the
Play-installed app have different signatures. Families who sideloaded early
must uninstall once and install from Play. After Play launch, offer the
**Play-signed universal APK** for direct download (Play Console → App bundle
explorer → Downloads) so both paths stay upgradeable.

---

## 3. Payments (decided)

Google Play requires Play Billing for digital purchases made *inside* an app.
**Decision (Elia, Oct 2026): families pay outside the app for now.** In app
mode Kaya hides every purchase surface — Settings → Subscription shows a
neutral "Your plan" card, feature locks show no prices or upgrade button,
and nothing tells users to pay elsewhere (anti-steering is also a Play rule).
If Play Billing is wanted later: Digital Goods API + Play products.

---

## 4. Store assets

App icon 512×512 = [`public/icon-512.png`](../public/icon-512.png). Still
needed for the listing: feature graphic 1024×500, at least two phone
screenshots, short description (≤80 chars), full description (≤4000 chars).

---

## 5. Wire up Digital Asset Links

This is the step that removes the URL bar. Until it is done the app works but
renders with a Chrome address bar across the top — which reads as broken and
will draw reviewer comments.

1. Upload the `.aab` (built with the real upload key, §2) to Play Console — Internal testing is fine for this.
2. Go to **Test and release → Setup → App signing**.
3. Copy the **SHA-256 certificate fingerprint** under *App signing key
   certificate* — this is Google's key, not your local one.
4. Also take the upload key fingerprint (printed in every workflow run's
   summary) so direct-download APKs verify too.
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

## 6. Play Console checklist

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
- **Financial features**: none in-app — purchase surfaces are hidden in app
  mode (see §3).
- **Store listing**: app icon 512×512, feature graphic 1024×500, at least two
  phone screenshots, short description (≤80 chars), full description
  (≤4000 chars).

Because the Play developer account is registered as an **organization**, the
"12 testers for 14 continuous days of closed testing" requirement that applies
to personal accounts does **not** apply — production access is available
directly. Running an Internal testing track first is still the sane way to get
the fingerprint and shake out the install.
