# Handoff — row richness round (2026-11-19 ~14:30 CST)

## Where it stands
- `mok-bs6` closed and committed (`0d76f27`): sender photos rebuilt renderer-side
  from psymail's SenderPhotos (Gravatar SHA-256 + favicon logos, freemail
  exclusions, 32px floor, session miss-cache, portrait-cover vs logo-card);
  `ThreadSummary.pinned` through protocol + Swift + seam; count pill + pin icon
  (direct Lucide import — taste kept `pin` out of the Figma map).
- Reviews: taste 3 (all fixed), correctness clean, design clean on fixtures with
  3 uncapturable asks (pinned row, loaded photos, long-name pill).
- Standing guideline saved: `psymail-reference` memory — check psymail-mini
  first for any repeated feature. Spec files in repo root are user-provided
  reference (left uncommitted).
- Gate: green except pre-existing `opencode contract link` env failure (mok-05p).

## Next / open
- User live run: photos WILL load against real senders (fixtures 404) — ask
  them to eyeball Commerce/Notifications/Feed + Messages for photo treatment,
  any pinned row, and long-name pill clipping.
- Open backlog: mok-05p (env), mok-e48 (test flake), mok-8mm (psymail follow-up
  pointer incl. psy-isrj).
