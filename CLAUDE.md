@AGENTS.md

# moki

Moki is a dark-only macOS desktop app that gathers one person's sources
(Gmail, Apple Messages, Slack, calendars, Notion, files…) into **lenses** — live
views by kind of thing, not by app. The product spec is the "Life OS spec" doc
(Moki); the Figma file is "playground", page "lenses". Design numbers live in
`docs/design/messages-brief.md`.

## Architecture

```
apps/desktop          electron-vite app
  src/main            window, helper process, IPC forwarding — no product logic
  src/preload         contextBridge: window.moki.call/on, typed from protocol
  src/renderer/src
    ui/               tokens.css + primitives (Avatar, Segment, GlassPane, InfiniteList…)
    shell/            sidebar, lens router, content area, inspector
    lenses/<lens>/    one folder per lens; registered in lenses/registry.ts
packages/protocol     shared TS types: RPC method map, domain shapes
helper/               Swift package: moki-helper, JSON-RPC 2.0 over stdio
  MokiHelperCore/<Area>/   one folder per source/capability, one registration line in main.swift
```

- **Sources stay the source of truth.** The helper reads and writes the source;
  anything cached locally is derived and rebuildable.
- **Native and secret things live in the helper.** OAuth tokens, Gmail, later
  Messages/Reminders/files. Tokens never cross into JS, logs or stdout.
- **The renderer only talks to the helper through `window.moki.call`.** Every
  method is declared once in `packages/protocol` and mirrored by a Swift handler;
  change both together.
- **Gmail labels follow psymail's scheme**: inbox = `INBOX`, bundles =
  `psymail/<name>` (commerce, notifications, feed). OAuth reuses psymail-mini's
  Desktop client and refresh tokens (`../psymail-mini`); Moki never writes psymail's files.
- `MOKI_FIXTURES=1` runs the helper on canned data — use it for UI work and screenshots.

## Taste

Follow `../psymail-mini/ARCHITECTURE.md` for React shape: composition first,
small primitives up to screens, capabilities not features (build `InfiniteList`,
not scroll math in a screen), hooks as units of organisation, providers over
prop-drilling, JSX as configuration. Primitives extend the native element's
props and build their own loading/empty states in.

- Styling: CSS variables from `ui/tokens.css`; no raw hex outside it. Plus Jakarta
  Sans, the six `Lenses/*` text styles, Lucide icons at the brief's stroke.
- States are quiet: an icon or one line, never a paragraph (spec "States").
- Swift: Swift 6 strict concurrency, actors for shared state, `Sendable` models,
  errors as typed `AppError` codes the UI can act on (`auth_expired`, `unreachable`).

## Testing

`pnpm test` (vitest) for pure logic and primitives; `swift test` in `helper/` for
parsing, decoding and RPC dispatch. Network is stubbed (URLProtocol), never live.
The gate (`scripts/harness verify`) runs typecheck, tests and builds.
