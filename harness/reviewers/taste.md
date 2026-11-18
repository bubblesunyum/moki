# moki — taste checks

- Raw hex/px colors outside `ui/tokens.css`; a one-off style that should be a primitive prop.
- Screen-level code doing a primitive's job (scroll math, skeletons, empty states).
- A renderer file importing from `electron` or Node; everything goes through `window.moki`.
- An RPC method added on one side only (protocol type without Swift handler, or the reverse).
- Product logic in `src/main` — main forwards, it doesn't decide.
- Wordy UI states; spec wants an icon or one line.
