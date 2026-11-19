# Handoff — badge-gating round (2026-11-19 ~15:30 CST)

## Where it stands
- `mok-222` closed and committed (`31a91c8`): avatar source badge is opt-in
  (`showSourceBadge` on ThreadList mapping to `showEmailBadge` on the row).
  Email segment + bundle lenses omit it; All reserves it. Taste naming notes
  applied by orchestrator micro-edits; correctness clean.
- Per the standing rule the round landed with a relaunch: fixtures capture
  verified badge-free rows, then a live detached instance was left running
  (python `start_new_session` daemon — macOS has no `setsid`; the harness
  background runner does not survive, so all 'leave it open' launches must go
  through the python daemon trick, never runner-backgrounded shells).

## Still open / next
- User runs the live app (left open): eyeball Commerce/Notifications/Feed +
  Messages — photos loading on real senders, any pinned row, long-name pill.
- Open backlog: mok-05p (gate env failure), mok-e48 (test flake), mok-8mm
  (psymail follow-ups incl. psy-isrj).
