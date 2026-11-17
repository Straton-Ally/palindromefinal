# iOS release (App Store) from Windows via GitHub Actions

The workflow `.github/workflows/ios-testflight.yml` runs on a GitHub macOS runner.
It prebuilds the Expo iOS project, signs it with your distribution certificate,
and uploads the build to **TestFlight**. Then you submit it for App Store review
from the App Store Connect website.

## One-time setup (all web or Windows)

### 1. Register the bundle ID
developer.apple.com → Certificates, IDs & Profiles → **Identifiers** → `+` → App IDs → App
- Bundle ID (explicit): `com.gammagames.palindrome`
- Capabilities: tick **Sign In with Apple**

### 2. Create the app record
appstoreconnect.apple.com → Apps → `+` → New App → iOS, pick the bundle ID above,
name "Palindrome", any SKU (e.g. `palindrome-ios`).

### 3. App Store Connect API key
appstoreconnect.apple.com → Users and Access → **Integrations** → App Store Connect API →
Team Keys → `+`, role **Admin** (App Manager only works if "Access to Certificates, Identifiers & Profiles" is ticked). Download `AuthKey_XXXX.p8`
(you can only download it once). Note the **Key ID** and the **Issuer ID**.

### 4. Distribution certificate (no Mac needed)
In Git Bash, from the repo:
```bash
bash scripts/ios-dist-cert.sh csr "you@example.com" "Your Name"
```
Upload `~/apple-signing/dist.csr` at developer.apple.com → Certificates → `+` →
**Apple Distribution**, download `distribution.cer` into `~/apple-signing/`, then run:
```bash
bash scripts/ios-dist-cert.sh p12 "a-strong-password"
```
Keep `~/apple-signing/` private and backed up. Never commit it.

### 5. GitHub secrets
Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `APPLE_TEAM_ID` | 10-char Team ID (developer.apple.com → Membership) |
| `ASC_KEY_ID` | API Key ID from step 3 |
| `ASC_ISSUER_ID` | Issuer ID from step 3 |
| `ASC_API_KEY_P8` | full text of the `.p8` file, including the BEGIN/END lines |
| `IOS_DIST_CERT_P12_BASE64` | contents of `~/apple-signing/dist.p12.base64.txt` |
| `IOS_DIST_CERT_PASSWORD` | the password from step 4 |
| `GOOGLE_SERVICE_INFO_PLIST_BASE64` | *optional*: base64 of `GoogleService-Info.plist` |

Optional **variable** (not secret): `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.

## Each release
1. Bump `expo.version` in `app.json` for a new App Store version (e.g. `1.0.1`).
   You don't need to touch the build number: the workflow uses the latest TestFlight build + 1.
2. GitHub → Actions → **iOS → TestFlight** → Run workflow (on `main`).
3. Wait about 10–30 min for Apple's processing, then test the build in TestFlight.
4. App Store Connect → your app → the version → select the build, fill in
   screenshots, description, privacy and age rating → **Submit for Review**.

## Notes
- The workflow is manual only. macOS runner minutes cost 10× Linux minutes on private repos
  (this repo is public, so they're free).
- The profile is fetched or created automatically by fastlane `sigh` with the API key.
- Apple requires an in-app **account deletion** option for apps with sign-in (Guideline 5.1.1(v)).
