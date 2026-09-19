# Zebu browser extension

Track time from issue trackers with project suggestions and device-flow
login against the web app. One source for Chrome, Firefox and Safari
(board #287): `build.mjs --target <browser>` bundles with esbuild into
`dist/<target>/` and writes the manifest from `manifest.base.json` plus
`browsers/<target>.json` (scripts/manifest.mjs), with the version stamped
from `package.json`. Tested with vitest.

```bash
npm run build && npm run typecheck && npm test && npm run i18n:check
bash scripts/tests/publish-r2.test.sh   # release scripts
npm run package                          # dist/zebu-<target>-<version>.zip
scripts/release.sh --minor               # tag; the workflow does the rest (docs/release.md)
```

Conventions:

- Browser differences are facts in `src/platform.ts` (`hasIdle`,
  `hasNotifications`, `hasNotificationButtons`, `hostPermissionIsOptional`,
  `shortcutsPage`), each taking the target so `tests/platform.test.ts`
  covers all three. Never sniff `navigator.userAgent`; `build.mjs` bakes
  `__TARGET__` in.
- A browser-specific manifest key goes in `browsers/<target>.json`; an
  array there replaces the base's (Safari lists the permissions it can use).
- Releases: tag-based, `scripts/release.sh`; nothing here deploys on push.
  Chrome updates only through the Web Store, Firefox from
  `extension/firefox/updates.json` on R2, Safari by hand for now.

## Task board (lite-kan) — shared across the Zebu suite

The MCP server `lite-kan` (https://board.alanwoo.ca) is the task list shared
between Alan and Claude. Alan is the user; assign Claude's items to Claude.
Columns: **To Do → In Progress → Review → Done**.

- **Start of every run:** read the board. Act on cards assigned to Claude in
  To Do or In Progress and on cards in Review assigned to Claude; treat new
  comments on those cards as instructions. Move a card to In Progress when
  starting on it.
- **Anything only Alan can do** (secrets, env keys, DNS, accounts, signing
  keys, manual server edits, purchases) becomes a To Do card assigned to
  Alan, with the exact commands or steps in the description. In chat, point
  to the card instead of repeating the steps.
- **Review flow:** whoever finishes a card moves it to Review and assigns it
  to the other person with a comment saying what to check and how. The
  reviewer verifies (test, probe, server check, trying the feature), then
  either moves it to Done with a comment on what was checked, or comments
  with what is wrong and assigns it back to In Progress. Nothing goes
  straight to Done.
- **After each batch of work,** update the cards: comment progress, move
  finished work to Review, add follow-ups as new cards.
- **If the server fails to connect,** say so once, keep working, and list the
  pending Alan-tasks at the end of the final message so nothing is lost.
- **`/board`** (user-level skill, `~/.claude/skills/board`, shared with Alan's
  other projects) does one such pass on demand; `/loop 10m /board` keeps it
  running in a session.
