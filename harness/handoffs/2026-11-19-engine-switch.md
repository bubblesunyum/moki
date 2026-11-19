# Handoff — engine switch round (2026-11-19 ~00:35 CST)

## Where it stands
- `mok-ymw` closed and committed (`7828677`): helper `listThreads` goes through
  `PsymailEngine` via `EngineSeam.swift`. Generic label mapping
  (`INBOX`→`inbox`, `psymail/<name>`→`<name>`), token store kept, RPC unchanged,
  `getThread` still on Gmail full fetch. 54 swift + 130 renderer tests green.
- Review fixes already in the commit: RFC2047 subject/name decode with
  `"(No subject)"` fallback; empty-dict cursor normalizes to nil.
- `mok-66b` closed as superseded. `mok-8mm` (backlog) tracks psymail follow-ups,
  now including `psy-isrj`.

## Known gaps (filed, not fixed)
- `psy-isrj` (psymail): `labelMap` 401/403 surfaces as `unreachable` in Moki
  instead of `authExpired` until the engine throws a caller-readable error.
  Narrow race only (token dying between `listAccounts` and the labels call).
- Taste note declined: `EngineThreadRow`/`EnginePage` mirrors stay as the
  offline-test boundary (`PsymailRow` has no public init).
- Renderer `ThreadList.test.tsx` has a midnight-boundary flake (30m vs 90m both
  render "Wed" when run 00:00–00:30 local). No bead filed yet — worth one if it
  bites again.

## Environment (pre-existing, not this round)
- Gate stays red on `opencode contract link` only (`.opencode/plugins/` absent,
  never in repo). Filed as `mok-05p`. Do not "fix" by hand-stubbing; needs
  `harness add` from the starter checkout.
- Uncommitted dirt left alone: `.gitignore` (worktree-round line), untracked
  `.agents/skills/worktree-round`, `harness/evals/results.jsonl`.

## Next
- User runs the live side-by-side: Moki Email tab vs psymail Inbox, top 30,
  both accounts. Workers stayed offline all round.
- No git origin: commits + beads still only on this machine.
