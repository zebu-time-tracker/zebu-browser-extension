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

- **Start of every run:** read the board. Act on cards assigned to Claude or
  moved to In progress; treat new comments on those cards as instructions.
- **Anything only Alan can do** (secrets, env keys, DNS, accounts, signing
  keys, manual server edits, purchases) becomes a TODO card assigned to Alan,
  with the exact commands or steps in the description. In chat, point to the
  card instead of repeating the steps.
- **When Alan moves a card to Done,** verify the outcome (test, probe, server
  check), then comment with what was checked. If it did not work, comment and
  move it back to In progress.
- **After each batch of work,** update the cards: comment progress, move
  shipped-and-verified work to Done, add follow-ups as new cards.
- **If the server fails to connect,** say so once, keep working, and list the
  pending Alan-tasks at the end of the final message so nothing is lost.
