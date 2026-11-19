# Handoff — bundle inbox lenses round (2026-11-19 ~13:00 CST)

## Where it stands
- `mok-62z` closed and committed (`7f1b79a`): Commerce/Notifications/Feed render
  the shared mail inbox (`BundleLens` + neutral `lenses/mail/` home for
  ThreadList/hooks/thread pane; shared `InboxLayout.css`). All/Unread text tabs
  on shared `SegmentGroup`; 3px segment gap (global, per user request).
- Labels: `psymail/commerce|notifications|feed` through existing RPC + engine
  mapping. Unread is client-side with auto-paging; selection re-anchors.
- Review: taste + correctness + design ran (first attempt died on ECONNRESET,
  re-spawned clean). Revision applied 6/8 findings; declined: scoping the 3px
  gap (user asked global, Messages pixels confirm).

## Still open / next
- Design sign-off on bundle pixels: the three screens were never photographed
  (no lens deep-link + no attached browser in agent env). User runs the app —
  ask them to eyeball Commerce/Notifications/Feed in All + Unread.
- `mok-e48` (P3): ThreadList auto-select test flakes in full-suite runs.
- `mok-05p`: gate still red on `opencode contract link` only (pre-existing env).
- Untracked user files in root: `moki spec.md`, `moki spec - raw dictation appendix.md` — left alone.
