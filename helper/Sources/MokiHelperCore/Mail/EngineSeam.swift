import Foundation
import PsymailKit

// MARK: - Mail listing seam
//
// `MailService.listThreads` lists through this protocol, not through
// `PsymailEngine` directly, so tests inject a fake and the helper stays
// offline. Production wires `PsymailMailEngine` (one shared engine per
// `MailService`; its emitted-thread tracking is per tab).

/// One thread row for a listing: the thread's newest message plus the
/// thread's rolled-up flags. Mirrors the `PsymailRow` fields Moki maps;
/// `EngineThreadRow(_:)` adapts the engine's row (whose initializer isn't
/// public, so tests build this struct directly instead).
public struct EngineThreadRow: Sendable, Equatable {
    public var id: String
    public var threadId: String
    public var accountAddress: String
    public var fromName: String
    public var fromAddress: String
    public var subject: String
    public var snippet: String
    public var date: Date
    public var isUnread: Bool
    public var threadCount: Int
    public var labelIds: [String]

    public init(
        id: String, threadId: String, accountAddress: String,
        fromName: String, fromAddress: String, subject: String,
        snippet: String, date: Date, isUnread: Bool,
        threadCount: Int, labelIds: [String]
    ) {
        self.id = id
        self.threadId = threadId
        self.accountAddress = accountAddress
        self.fromName = fromName
        self.fromAddress = fromAddress
        self.subject = subject
        self.snippet = snippet
        self.date = date
        self.isUnread = isUnread
        self.threadCount = threadCount
        self.labelIds = labelIds
    }

    init(_ row: PsymailRow) {
        self.init(
            id: row.id, threadId: row.threadId,
            accountAddress: row.accountAddress, fromName: row.fromName,
            fromAddress: row.fromAddress, subject: row.subject,
            snippet: row.snippet, date: row.date, isUnread: row.isUnread,
            threadCount: row.threadCount, labelIds: row.labelIds)
    }
}

/// One listing page through the seam, newest first.
public struct EnginePage: Sendable, Equatable {
    public var rows: [EngineThreadRow]
    public var next: [String: String]?
    public var unreachable: [String]
    public var authExpired: [String]

    public init(
        rows: [EngineThreadRow], next: [String: String]?,
        unreachable: [String], authExpired: [String]
    ) {
        self.rows = rows
        self.next = next
        self.unreachable = unreachable
        self.authExpired = authExpired
    }
}

public protocol MailEngine: Sendable {
    func labelMap(for address: String) async throws -> [String: String]
    func page(
        tab: String, accounts: [PsymailAccount], cursor: [String: String]?
    ) async -> EnginePage
}

/// Production seam: one shared `PsymailEngine` behind `MailEngine`.
public struct PsymailMailEngine: MailEngine {
    private let engine: PsymailEngine

    public init(token: @escaping PsymailEngine.TokenProvider) {
        self.engine = PsymailEngine(token: token)
    }

    public func labelMap(for address: String) async throws -> [String: String] {
        try await engine.labelMap(for: address)
    }

    public func page(
        tab: String, accounts: [PsymailAccount], cursor: [String: String]?
    ) async -> EnginePage {
        let page = await engine.page(tab: tab, accounts: accounts, cursor: cursor)
        return EnginePage(
            rows: page.rows.map(EngineThreadRow.init), next: page.next,
            unreachable: page.unreachable, authExpired: page.authExpired)
    }
}

// MARK: - Label -> tab mapping

/// Map a Moki label to the engine tab title: `INBOX` (any case) is the
/// `inbox` tab; `psymail/<name>` bundles are the `<name>` tab. Anything
/// else is unknown and lists nothing — the old Gmail path swallowed its
/// unknown-label error the same way.
func mailTab(for label: String) -> String? {
    if label.caseInsensitiveCompare("INBOX") == .orderedSame { return "inbox" }
    let parts = label.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count == 2, parts[0] == "psymail", !parts[1].isEmpty else { return nil }
    return String(parts[1])
}

// MARK: - Row mapping

/// Map an engine row to Moki's `ThreadSummary`: the thread id is the row
/// id, the account is the row's account, the date renders through the same
/// ISO8601 helper the old Gmail path used. Engine rows carry the raw Gmail
/// header (psymail has no inbound encoded-word decoder), so the subject and
/// sender name decode here: RFC2047 first, then the old path's
/// empty-marks-"(No subject)" fallback. The address passes through
/// untouched — the renderer falls back to it on an empty name.
func threadSummary(from row: EngineThreadRow) -> ThreadSummary {
    ThreadSummary(
        id: row.threadId, account: row.accountAddress,
        from: EmailAddress(name: decodeRFC2047(row.fromName), address: row.fromAddress),
        subject: nonEmpty(decodeRFC2047(row.subject)) ?? "(No subject)", snippet: row.snippet,
        date: iso8601String(row.date), unread: row.isUnread,
        messageCount: row.threadCount, labelIds: row.labelIds)
}
