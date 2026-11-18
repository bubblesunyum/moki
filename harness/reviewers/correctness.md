# moki — correctness checks

- Tokens or secrets reaching stdout, stderr, logs, RPC results or the renderer.
- Helper stdout carrying anything but JSON-RPC lines (a stray print breaks the bridge).
- Pending RPC calls never resolved when the helper dies; no timeout.
- Gmail: base64url vs base64, charset decoding, missing From name, threads merged across accounts not sorted newest-first, a failed account treated as "no mail" (must be unreachable/auth_expired).
- Email HTML rendered without DOMPurify or outside a shadow root; links not forced external.
- Writing to psymail-mini's files (Moki only reads them).
- Electron: contextIsolation off, nodeIntegration on, or sandbox off for the renderer.
