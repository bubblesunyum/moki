import Foundation

// MARK: - Notion rate limiter
//
// The integration proxies at ~3 req/s. A single search call goes out per
// `listRecents`, so this is a minimum-interval gate, not a fan-out pool —
// and per the swift-taskgroup-timeout trap, nothing here fans out at all.

/// Serializes Notion API calls to at most one per `minInterval`. An actor,
/// so concurrent `listRecents` calls queue instead of bursting.
public actor NotionRateLimiter {
    private var lastFire: Date?
    private let minInterval: TimeInterval
    private let now: @Sendable () -> Date

    public init(
        minInterval: TimeInterval = 1.0 / 3.0,
        now: @Sendable @escaping () -> Date = Date.init
    ) {
        self.minInterval = minInterval
        self.now = now
    }

    /// Wait until a call may fire, then record the slot. Sequential by
    /// construction: the actor re-checks `lastFire` after any sleep, so a
    /// queued waiter never inherits a stale timestamp. Throws on
    /// cancellation — the sleep's `CancellationError` propagates instead of
    /// being swallowed, so a cancelled waiter never records a slot it
    /// didn't earn (and never busy-spins on an already-cancelled sleep).
    public func acquire() async throws {
        while true {
            let elapsed: TimeInterval? = lastFire.map { now().timeIntervalSince($0) }
            if elapsed == nil || elapsed! >= minInterval {
                lastFire = now()
                return
            }
            let wait = minInterval - (elapsed ?? 0)
            try await Task.sleep(for: .seconds(wait))
        }
    }
}
