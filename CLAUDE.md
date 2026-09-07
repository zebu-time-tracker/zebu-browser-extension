# Zebu for Chrome

Track time from issue trackers with project suggestions and device-flow
login against the web app. Built with `build.mjs` (esbuild), tested with
vitest, MV3 manifest in `manifest.json`.

```bash
npm run build && npm run typecheck && npm test && npm run i18n:check
npm run zip             # dist -> zebu-chrome-extension.zip for the store
```

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
