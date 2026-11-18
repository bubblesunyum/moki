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

- `MOKI_FIXTURES=1` — canned mail and accounts, no network, no sign-in, no
  macOS consent prompt. Drop it to see real Gmail.
- The capture is the page only: native traffic lights are not in it.
- For a review packet, copy the PNG to `/tmp/mok-<name>.png`; the packet's
  Captures section picks up `mok-*.png`.
- Without `MOKI_CAPTURE_QUIT=1` the app stays open; kill it when done —
  leftover instances pile up and hold the helper.
