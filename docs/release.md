# Releasing the browser extension

One source, three browsers (board #287). A release is a git tag; the
workflow builds Chrome, Firefox and Safari from it, signs what it can, puts
every package in the Cloudflare R2 bucket behind
**https://app-downloads.zebu.work/extension/**, and uploads the Chrome
package to the Web Store.

## Cutting a release

```bash
scripts/release.sh --dry-run     # rehearse: prints every step, touches nothing
scripts/release.sh               # 0.2.0 -> 0.2.1
scripts/release.sh --minor       # 0.2.0 -> 0.3.0
scripts/release.sh 1.0.0         # exactly that
```

The script refuses a dirty tree, a branch other than `main`, a `main` behind
`origin/main` and a tag that already exists; runs the gate (`npm run build`,
`npm run typecheck`, `npm test`, `npm run i18n:check`,
`scripts/tests/publish-r2.test.sh`); writes the version into `package.json`
and the lockfile; commits `Release X.Y.Z`; tags `vX.Y.Z`; pushes both. The
version lives in `package.json` only: `build.mjs` stamps it into every
browser's manifest, and the workflow's first job refuses a tag that disagrees.

## What the workflow does (`.github/workflows/release.yml`)

| Job | What | Needs |
|---|---|---|
| `verify` | the gate, the release-script tests, tag = package.json | — |
| `build` | `npm run package` → `zebu-{chrome,firefox,safari}-X.Y.Z.zip`; AMO signs Firefox into an `.xpi`; the Chrome zip goes to the Web Store | `AMO_*`, `CWS_*` (each optional) |
| `safari` | wraps `dist/safari` with `xcrun safari-web-extension-converter` and attaches the Xcode project as an artifact | a macOS runner |
| `publish` | every package to R2 under the version, aliases under `latest/`, then `latest.json` and Firefox's `updates.json` last, read back over the public hostname | `R2_*` (required) |

`workflow_dispatch` runs the same build and publish into
`extension/_dryrun/<run id>/` and skips the stores: a rehearsal of the
credentials, the endpoint, the bucket permissions and the ordering.

## How each browser updates

- **Chrome** updates only from the Chrome Web Store (self-hosted `.crx`
  auto-update is blocked for normal users). The R2 copy is the archive and
  the *load unpacked* source.
- **Firefox** updates from our bucket: the manifest names
  `browser_specific_settings.gecko.update_url =
  https://app-downloads.zebu.work/extension/firefox/updates.json`, which
  carries the versioned `.xpi` URL and its sha256. AMO signs the `.xpi` as
  an *unlisted* add-on (free, automatic for MV3 add-ons that pass the
  linter), so it installs from anywhere.
- **Safari** is the same code wrapped in a macOS app. The workflow produces
  the Xcode project; building, signing and App Store submission are not
  automated yet (see below).

## Secrets on the repository

| Secret | Required | Used for |
|---|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | yes | publishing to `app-downloads.zebu.work` (the desktop repository's token works: same bucket) |
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | for Firefox auto-update | addons.mozilla.org → Tools → *Manage API keys* |
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_EXTENSION_ID` | for the Web Store upload | a Google Cloud OAuth client with the *Chrome Web Store API* enabled; the refresh token from one consent flow; the extension id after the first manual upload |
| `APPLE_TEAM_ID` | Safari, later | the converter's bundle id is `work.zebu.extension` |

Without `AMO_*` the release ships `zebu-firefox-X.Y.Z.zip` (source) and no
`updates.json`; without `CWS_*` the Chrome zip is only archived on R2. Both
cases are warnings in the workflow, not failures, so the first releases can
go out before the store accounts exist.

## The bucket layout

```
extension/
  latest.json                   { version, pub_date, builds: { chrome, firefox, safari } }
  firefox/updates.json          Firefox's update manifest (gecko id → versioned xpi + sha256)
  latest/zebu-chrome.zip        aliases the downloads page links to; each downloads
  latest/zebu-firefox.xpi       under its versioned name (Content-Disposition)
  latest/zebu-safari.zip
  0.3.0/zebu-chrome-0.3.0.zip   every build, kept forever, immutable
  0.3.0/zebu-firefox-0.3.0.xpi
  0.3.0/zebu-safari-0.3.0.zip
  _dryrun/<run id>/…            rehearsals; expired by a lifecycle rule
```

Every URL in `latest.json` and `updates.json` points into the immutable
per-version prefix, never at an alias (`scripts/extension-manifest.mjs`
enforces it). Nothing in the workflow deletes; `scripts/publish-r2.sh`
uploads object by object and reads each back.

## Safari, when the Apple side is confirmed

1. `npm run build:safari && xcrun safari-web-extension-converter dist/safari
   --app-name Zebu --bundle-identifier work.zebu.extension --macos-only`
2. Open the project in Xcode, set the team, archive, upload to App Store
   Connect (or distribute with a Developer ID for direct download).
3. Safari has no idle API and no extension notifications; the build asks for
   neither permission and hides the idle card (`src/platform.ts`).

## Not automated

- The Chrome Web Store review, and the first listing (a manual upload that
  yields `CWS_EXTENSION_ID`).
- The Safari archive and App Store submission.
- The downloads page in `zebu-public` links the `latest/` aliases, so it does
  not change per release; only the copy (browser minimums) does.
