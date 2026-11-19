import Foundation
import Testing

@testable import MokiHelperCore

@Suite struct EngineMappingTests {
    // MARK: - Label -> tab

    @Test func inboxLabelsMapToInboxTab() {
        #expect(mailTab(for: "INBOX") == "inbox")
        #expect(mailTab(for: "inbox") == "inbox")
        #expect(mailTab(for: "Inbox") == "inbox")
    }

    @Test func bundlesMapToNameRemainder() {
        #expect(mailTab(for: "psymail/commerce") == "commerce")
        #expect(mailTab(for: "psymail/feed") == "feed")
        #expect(mailTab(for: "psymail/archive") == "archive")
    }

    @Test func unknownLabelsMapToNil() {
        #expect(mailTab(for: "NOT-A-LABEL") == nil)
        #expect(mailTab(for: "") == nil)
        #expect(mailTab(for: "psymail") == nil)
        #expect(mailTab(for: "psymail/") == nil)
        #expect(mailTab(for: "psymail/a/b") == nil)
        #expect(mailTab(for: "INBOX/x") == nil)
    }

    // MARK: - Row -> ThreadSummary

    @Test func rowMapsToThreadSummary() {
        let date = Date(timeIntervalSince1970: 1_763_380_800)
        let row = EngineThreadRow(
            id: "m-1", threadId: "t-1", accountAddress: "a@example.com",
            fromName: "Bo", fromAddress: "bo@x.com", subject: "Hi",
            snippet: "hello", date: date, isUnread: true,
            threadCount: 4, labelIds: ["INBOX", "UNREAD"])
        let summary = threadSummary(from: row)
        #expect(summary.id == "t-1")
        #expect(summary.account == "a@example.com")
        #expect(summary.from == EmailAddress(name: "Bo", address: "bo@x.com"))
        #expect(summary.subject == "Hi")
        #expect(summary.snippet == "hello")
        #expect(summary.date == iso8601String(date))
        #expect(summary.unread)
        #expect(summary.messageCount == 4)
        #expect(summary.labelIds == ["INBOX", "UNREAD"])
    }

    // MARK: - RFC2047 + subject fallback

    private func mappingRow(subject: String, fromName: String = "Bo") -> EngineThreadRow {
        EngineThreadRow(
            id: "m-1", threadId: "t-1", accountAddress: "a@example.com",
            fromName: fromName, fromAddress: "bo@x.com", subject: subject,
            snippet: "hello", date: Date(timeIntervalSince1970: 1_763_380_800),
            isUnread: true, threadCount: 1, labelIds: ["INBOX"])
    }

    @Test func encodedSubjectDecodes() {
        let summary = threadSummary(
            from: mappingRow(subject: "=?UTF-8?Q?Caf=C3=A9_plans?="))
        #expect(summary.subject == "Caf\u{00E9} plans")
    }

    @Test func emptySubjectFallsBack() {
        #expect(threadSummary(from: mappingRow(subject: "")).subject == "(No subject)")
        #expect(threadSummary(from: mappingRow(subject: "   ")).subject == "(No subject)")
        #expect(threadSummary(from: mappingRow(subject: "Hi")).subject == "Hi")
    }

    @Test func encodedFromNameDecodesKeepingAddress() {
        let summary = threadSummary(
            from: mappingRow(subject: "Hi", fromName: "=?UTF-8?Q?Andr=C3=A9?="))
        #expect(summary.from == EmailAddress(name: "Andr\u{00E9}", address: "bo@x.com"))
    }
}
