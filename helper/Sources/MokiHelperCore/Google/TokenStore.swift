import Foundation

/// Refresh-token map, keyed by Gmail address. This is psymail-mini's on-disk
/// format too (`{"user@gmail.com": "<refresh token>", ...}`), which is what
/// makes the import a plain merge.
public typealias RefreshTokenMap = [String: String]

/// Reader for one token file. Async so the container read (which can block
/// on macOS's "access data from other apps" consent) can be given a deadline
/// and, in tests, replaced with a slow stub.
public typealias PsymailFileReader = @Sendable (URL) async -> Data?

/// Outcome of the one-time psymail-mini import.
public struct PsymailImportOutcome: Sendable {
    public var tokens: RefreshTokenMap
    /// True when at least one psymail-mini file existed (readable bytes),
    /// even if it decoded to nothing new. False means both sources were
    /// missing — reported as `unavailable` rather than `done`.
    public var hadSources: Bool

    public init(tokens: RefreshTokenMap, hadSources: Bool) {
        self.tokens = tokens
        self.hadSources = hadSources
    }
}

/// Reads on a plain dispatch thread: the read can block indefinitely on
/// macOS's other-app-data consent, and a blocked cooperative-pool thread
/// would starve every other request in the helper.
func defaultPsymailFileReader(url: URL) async -> Data? {
    await withCheckedContinuation { continuation in
        DispatchQueue.global(qos: .utility).async {
            continuation.resume(returning: try? Data(contentsOf: url))
        }
    }
}

/// Loads Moki's refresh tokens and imports psymail-mini's. Imported tokens
/// are copied into Moki's file once; psymail-mini's files are only ever read.
public struct GoogleTokenStore: Sendable {
    public var locations: GoogleLocations

    public init(locations: GoogleLocations) {
        self.locations = locations
    }

    /// Moki's own tokens only — never touches psymail-mini's container, so
    /// it never blocks on the cross-app data consent prompt. This is what
    /// `accounts.list` answers from when the psymail import is still pending.
    public func readMokiTokens() -> RefreshTokenMap {
        readTokenFile(at: locations.mokiTokensURL)
    }

    /// Moki's tokens merged with psymail-mini's imports. Synchronous,
    /// exact-path convenience (no glob, no deadline); the request path uses
    /// `PsymailTokenImporter` instead so a blocked container read can't hang
    /// the response. Persists newly imported tokens to Moki's file (0600);
    /// leaves the file untouched when there is nothing new. Never logs or
    /// returns anything beyond the map itself — callers must keep these
    /// values out of RPC and logs.
    @discardableResult
    public func loadRefreshTokens() -> RefreshTokenMap {
        var merged = readTokenFile(at: locations.mokiTokensURL)
        var imported = 0
        for url in psymailTokenURLs() {
            guard let data = try? Data(contentsOf: url),
                let map = try? JSONDecoder().decode(RefreshTokenMap.self, from: data)
            else { continue }
            for (address, token) in map where merged[address] == nil {
                merged[address] = token
                imported += 1
            }
        }
        if imported > 0 {
            saveTokenFile(merged, at: locations.mokiTokensURL)
        }
        return merged
    }

    /// psymail-mini token candidates: the EXACT sandboxed container path for
    /// `com.psymail.mini` plus the unsandboxed path. Never globs
    /// `~/Library/Containers/*` — listing every app's container can block
    /// indefinitely on macOS's consent prompt.
    public func psymailTokenURLs() -> [URL] {
        let sandboxed = locations.psymailSandboxedTokensURL
        let unsandboxed = locations.psymailUnsandboxedTokensURL
        if sandboxed == unsandboxed {
            return [sandboxed]
        }
        return [sandboxed, unsandboxed]
    }

    /// Merge psymail tokens into Moki's file, persisting only genuinely new
    /// addresses. Called by the importer (including late-finishing
    /// background completion) so the next `accounts.list` sees them.
    public func mergeAndPersist(psymailTokens: RefreshTokenMap) {
        guard !psymailTokens.isEmpty else { return }
        var merged = readTokenFile(at: locations.mokiTokensURL)
        var added = false
        for (address, token) in psymailTokens where merged[address] == nil {
            merged[address] = token
            added = true
        }
        if added {
            saveTokenFile(merged, at: locations.mokiTokensURL)
        }
    }
}

/// One-time, deadline-bounded psymail-mini import, shared for the helper's
/// lifetime. The container read runs once in a background `Task`; request
/// paths `wait(timeout:)` for it and fall back to Moki's own file on
/// timeout. A late-finishing task still merges and persists, so the next
/// call sees the imported tokens. The container is never re-read (no retry
/// loop): after the single task finishes, later calls reuse its outcome.
public final class PsymailTokenImporter: @unchecked Sendable {
    private let locations: GoogleLocations
    private let reader: PsymailFileReader
    private let lock = NSLock()
    private var task: Task<PsymailImportOutcome, Never>?

    public init(
        locations: GoogleLocations,
        reader: PsymailFileReader? = nil
    ) {
        self.locations = locations
        self.reader = reader ?? defaultPsymailFileReader
    }

    private func ensureTask() -> Task<PsymailImportOutcome, Never> {
        lock.withLock {
            if let existing = task {
                return existing
            }
            let locations = locations
            let reader = reader
            let store = GoogleTokenStore(locations: locations)
            let urls = store.psymailTokenURLs()
            let next = Task<PsymailImportOutcome, Never> {
                var tokens: RefreshTokenMap = [:]
                var hadSources = false
                for url in urls {
                    guard let data = await reader(url) else { continue }
                    hadSources = true
                    guard
                        let map = try? JSONDecoder().decode(
                            RefreshTokenMap.self, from: data)
                    else { continue }
                    for (address, token) in map where tokens[address] == nil {
                        tokens[address] = token
                    }
                }
                // Persist for the next call even when the current waiter
                // already timed out — the Task runs to completion.
                store.mergeAndPersist(psymailTokens: tokens)
                return PsymailImportOutcome(tokens: tokens, hadSources: hadSources)
            }
            task = next
            return next
        }
    }

    /// Wait up to `timeout` for the single import. Returns `nil` on timeout
    /// (the background task keeps running and still persists on completion).
    public func wait(timeout: Duration) async -> PsymailImportOutcome? {
        let current = ensureTask()
        // Not a task group: a group waits for every child before returning,
        // and awaiting `current.value` ignores cancellation, so the deadline
        // would never fire while the read is blocked.
        let race = FirstResult<PsymailImportOutcome?>()
        return await withCheckedContinuation { continuation in
            race.install(continuation)
            Task { race.resolve(await current.value) }
            Task {
                try? await Task.sleep(for: timeout)
                race.resolve(nil)
            }
        }
    }
}

/// Resumes a continuation with whichever value arrives first; later ones are dropped.
private final class FirstResult<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Never>?

    func install(_ continuation: CheckedContinuation<Value, Never>) {
        lock.withLock { self.continuation = continuation }
    }

    func resolve(_ value: Value) {
        let pending = lock.withLock { () -> CheckedContinuation<Value, Never>? in
            defer { continuation = nil }
            return continuation
        }
        pending?.resume(returning: value)
    }
}

/// Read a `{address: refreshToken}` file. Missing or corrupt files read as
/// empty (a corrupt Moki file heals on the next import that saves).
func readTokenFile(at url: URL) -> RefreshTokenMap {
    guard let data = try? Data(contentsOf: url),
        let map = try? JSONDecoder().decode(RefreshTokenMap.self, from: data)
    else {
        return [:]
    }
    return map
}

/// Write Moki's token file (creating parent dirs), mode 0600. Best effort:
/// a failure only logs a generic message — tokens stay in memory for the
/// current request either way.
func saveTokenFile(_ map: RefreshTokenMap, at url: URL) {
    let manager = FileManager.default
    do {
        try manager.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(map)
        try data.write(to: url, options: .atomic)
        try manager.setAttributes(
            [.posixPermissions: 0o600], ofItemAtPath: url.path)
    } catch {
        logToStderr("moki-helper: could not save google tokens file")
    }
}
