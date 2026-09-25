# Zebu for browsers

One extension for Chrome, Firefox and Safari, built from one source (`npm run build` makes
`dist/chrome`, `dist/firefox` and `dist/safari`). What each browser cannot do is a fact in
`src/platform.ts`, not a fork: Safari has no idle detection or notifications, Firefox shows the
idle prompt without buttons and asks for the workspace host on connect.

Track time in Zebu from the places work actually happens. On GitHub, GitLab, Jira, Linear,
Asana, Trello, Bitbucket, ClickUp and Basecamp issue pages a **Track time** button appears
next to the tracker's own actions. One click opens a small timer window with the issue's
identifier, title and link already in the notes and the most likely Zebu project preselected;
pick a task if you use them and start. The button turns into a running clock, and the toolbar
icon shows a dot while any timer runs.

On any other page the toolbar popup starts a timer with the page's title and link in the notes,
and selected text becomes the description. The right-click menu offers **Track time on this
page** and, with a selection, **Track time: "…"**. A tracker page keeps its issue identity when
tracked from either.

The toolbar popup is the desktop app's menubar popover, in Chrome: a header naming the day, a
week strip with each day's total (‹ › move a week, the days are buttons, *Today ⤴︎* jumps back),
and the day's entries — client, code and project, task and notes, the project's total, uninvoiced
time and budget — with ▶ to resume one and ■ to stop. Click an entry to edit it; ＋ opens the
entry sheet, where a project picker grouped by client (with the page's suggested projects on top),
a task, a date, a duration (`1:30`, `1.5`, `90m`) and notes start a timer or log a finished block.
Invoiced entries and approved weeks are read-only, as the workspace requires. A timer running on
another day is pinned above the list as a jump target.

Also from the desktop: ☆ **presets** (a saved project and task, started with one click, renamed
or deleted in place; stored locally per workspace), a **Resume** bar for the last timer when
nothing runs (an older day's entry asks before starting a fresh timer today), ⚙ **settings** in
the footer (who is signed in, appearance, idle detection, the keyboard shortcuts, disconnect) and
the toolbar icon becoming the running timer's clock — hours over minutes, drawn into the green
square like the menubar pill, with the project and time in its tooltip. Three **keyboard
shortcuts** are suggested — Alt+Shift+Z opens the popup, Alt+Shift+S starts or stops the timer,
Alt+Shift+N starts a timer for the page you are on — and can be changed at
`chrome://extensions/shortcuts`.

**Idle detection**, on by default: while a timer runs and Chrome reports the machine idle (ten
minutes without input; change it in the settings), coming back shows a notification with the
desktop's choices — remove the idle time and keep timing, remove it and stop, or dismiss to keep
it. **Insights** (the chart button in the header) is the desktop's Insights panel: today,
yesterday, this and last week, this month, billable share, uninvoiced time and money, and hours
per day this month and per month this year, counting up with the running timer.

The popup follows the system theme, or the Appearance setting; the options page (self-hosted
trackers, note format, forgetting learned suggestions) is behind *More settings…*.

**Live updates.** When the workspace broadcasts (Laravel Reverb; `GET /api/me` carries a
`broadcast` block), the service worker keeps a websocket to it and refetches the moment a timer is
started, stopped or edited anywhere else — about a hundred milliseconds instead of the next poll.
The pulse slows to a 30-second backstop while the socket is up and returns to its usual cadence
when it is down; a dot beside the day in the popup's header shows the socket is connected. Without
a `broadcast` block nothing changes.

Manifest V3, TypeScript, no framework. Talks to the same workspace API as the desktop app.

## Install (development)

```sh
npm install
npm run icons      # generates icons/*.png (once)
npm run build      # → dist/chrome, dist/firefox, dist/safari
npm run build:firefox   # one target; npm run watch rebuilds chrome on change
```

Then `chrome://extensions` → *Developer mode* → *Load unpacked* → pick `dist/chrome/`; in Firefox
`about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → `dist/firefox/manifest.json`. `npm run watch`
rebuilds the scripts on change (reload the extension to pick them up; static files are copied once).

## Connect a workspace

The popup's connect screen (and the options page, which opens on install) asks for one thing:
your workspace's name, the part before `.zebu.work` — `studio` for `studio.zebu.work`. Pasting
the address or a URL is reduced to the name; there is no self-hosted option for now. Connecting
uses Zebu's device flow: a tab opens in your logged-in workspace asking you to approve "Zebu for
Chrome"; the extension polls until you do and stores the resulting token in
`chrome.storage.local`. No password ever passes through the extension.

## How suggestions work (`src/suggest.ts`)

1. **Remembered** — the project (and task) you chose last time for this repo / board / Jira
   project wins outright. Choices are keyed per site and container and stored locally.
2. **Name match** — otherwise the repo, board or project name is matched against Zebu project
   *and client* names: character-bigram similarity plus token overlap after splitting camelCase,
   kebab-case and paths. Anything scoring ≥ 0.45 is shown under *Suggested*; the org / site name
   counts as a weaker hint.
3. **Recent** — ties and the rest of the list are ordered by what you used recently.

## Adding a tracker

Add one object to `ADAPTERS` in `src/content/adapters.ts`: a hostname test, `detect(url, doc)`
returning an `Issue` (identity from the URL, title from the DOM with a `document.title` fallback)
and an optional `anchor(doc)` for where the button goes (missing anchor → floating button, so a
selector change never hides the feature). Add the host to `content_scripts.matches` in
`manifest.base.json`, and a test in `tests/adapters.test.ts`. Self-hosted instances of an existing
tracker need no code: users add the origin on the options page and pick the tracker type.

## Scripts

| Command | What |
|---|---|
| `npm run build` | Bundle every browser to `dist/<target>/` |
| `npm run package` | …and zip each into `dist/zebu-<target>-<version>.zip` |
| `npm run watch` | Rebuild on change |
| `npm test` | Unit tests (suggestions, adapters) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run i18n:check` | Every `_locales/*/messages.json` matches `en` |
| `npm run zip` | `zebu-chrome-extension.zip` for the Web Store |

## Publishing

`scripts/release.sh --minor` tags a release; the workflow builds all three browsers, submits Firefox
to its listing on addons.mozilla.org, uploads to the Chrome Web Store and publishes to
https://app-downloads.zebu.work/extension/. See `docs/release.md`.

## Reproducing a build

For the addons.mozilla.org reviewers (the Firefox package is bundled and minified, so every
submission carries this source): with Node 22 and npm 10,

```bash
npm ci
npm run build:firefox      # dist/firefox/ is the submitted package, byte for byte
```

`build.mjs` runs esbuild (pinned in `package-lock.json`) over `src/*.ts` and writes the manifest from
`manifest.base.json` and `browsers/firefox.json`; nothing is fetched at build time. `npm run build`
makes the Chrome and Safari packages the same way.

## License

[MIT](LICENSE). The Zebu name and logo are not covered by the license: forks must use their own.
