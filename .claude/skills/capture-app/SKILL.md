---
name: capture-app
description: Screenshot the real Moki app (Electron + helper) for verification or a review packet, including on fixture mail. Use when you need to see what a change actually renders.
---

# Capture the running app

The app photographs its own page, so this works with the display locked or
asleep (OS screen capture does not).

```bash
pkill -f "/dev/moki/node_modules/.pnpm/electron"; pkill -f electron-vite   # stale instances
MOKI_FIXTURES=1 MOKI_CAPTURE=$PWD/.tmp/app.png MOKI_CAPTURE_QUIT=1 \
  MOKI_CAPTURE_DELAY=4000 pnpm --filter moki-desktop dev > .tmp/dev.log 2>&1
grep capture .tmp/dev.log        # "[capture] wrote …"
```

Prefix the base command with `MOKI_THREAD=<id>` to open that thread
instead of the first row (fixture `f3` is the 3-message Priya dinner
thread), or `MOKI_SEGMENT=<source>` for that Messages segment
(`Text` shows the Coming soon state). Both compose; unknown values warn
and keep the defaults.

- `MOKI_FIXTURES=1` — canned mail and accounts, no network, no sign-in, no
  macOS consent prompt. Drop it to see real Gmail.
- `MOKI_THREAD=<id>` — select that thread instead of the first row, e.g.
  `MOKI_THREAD=f3` opens the 3-message Priya dinner thread on fixture mail.
  Unknown ids warn in the console and keep the first-row default — never a
  blank pane.
- `MOKI_SEGMENT=<source>` — open that Messages segment (`Email`, `Text`,
  `Slack`, `Discord`, `All`; case-insensitive). `MOKI_SEGMENT=Text` shows
  the Text "Coming soon" state. Unknown values warn and keep Email.
- Unset vars behave exactly as today (first row + Email).
- The capture is the page only: native traffic lights are not in it.
- For a review packet, copy the PNG to `/tmp/mok-<name>.png`; the packet's
  Captures section picks up `mok-*.png`.
- Without `MOKI_CAPTURE_QUIT=1` the app stays open; kill it when done —
  leftover instances pile up and hold the helper.
