import Foundation
import Testing

@testable import MokiHelperCore

@Suite(.serialized)
struct FixtureTests {
    @Test func fixtureAccountsNeedNoNetworkOrFiles() async throws {
        let result = MailFixtures.fixtureAccountsResult()
        #expect(result.psymailImport == .done)
        #expect(
            result.accounts == [
                GoogleAccount(
                    address: "bubbles@example.com", name: "Bubbles", status: .ok),
                GoogleAccount(
                    address: "work@example.com", name: "Work", status: .ok),
            ])
    }

    @Test func fixtureListThreadsPagesEightThenFour() {
        let first = MailFixtures.listThreads(label: "INBOX", cursor: nil)
        #expect(first.threads.count == 8)
        #expect(first.unreachable.isEmpty)
        #expect(first.authExpired.isEmpty)
        let firstCursor = try? #require(first.next)

        // Newest-first across both accounts.
        let dates = first.threads.map { mailSortDate($0.date) }
        #expect(dates == dates.sorted(by: >))
        #expect(Set(first.threads.map(\.account)) == ["bubbles@example.com", "work@example.com"])

        let second = MailFixtures.listThreads(label: "INBOX", cursor: firstCursor)
        #expect(second.threads.count == 4)
        #expect(second.next == nil)

        // Twelve unique rows total, still newest-first across the boundary.
        let all = first.threads + second.threads
        #expect(Set(all.map(\.id)).count == 12)
        let allDates = all.map { mailSortDate($0.date) }
        #expect(allDates == allDates.sorted(by: >))

        // Spread over the past week: newest within a day, oldest ~7 days.
        let now = Date()
        #expect(now.timeIntervalSince(allDates.first!) < 24 * 3600)
        #expect(now.timeIntervalSince(allDates.last!) > 6 * 24 * 3600)

        // Figma-like names, a few unread, one 3-message thread.
        let names = Set(all.map { $0.from.name })
        for expected in [
            "Clayton Gibson", "Kate", "Priya", "Luis", "Tasha", "Sam", "Noor",
            "Garden club", "Maya", "Eli", "Andre", "Jordan",
        ] {
            #expect(names.contains(expected))
        }
        #expect(all.filter(\.unread).count >= 3)
        #expect(all.filter { $0.messageCount == 3 }.count == 1)

        // One row carries a long subject for truncation verification.
        #expect(
            all.map(\.subject).contains(
                "Audience segments look great, sending to the full list tomorrow morning unless you object"
            ))
    }

    @Test func fixtureGetThreadServesHTMLAndPlainText() throws {
        let html = try MailFixtures.getThread(account: "bubbles@example.com", id: "f1")
        #expect(html.subject == "Plant swap this weekend?")
        let message = try #require(html.messages.first)
        #expect(message.html?.contains("<style>") == true)
        #expect(message.html?.contains("https://example.com/swap") == true)
        #expect((message.text ?? "").contains("monstera"))

        let plain = try MailFixtures.getThread(account: "bubbles@example.com", id: "f11")
        #expect(plain.subject == "Running tomorrow?")
        #expect(plain.messages.first?.html == nil)
        #expect((plain.messages.first?.text ?? "").contains("6:30"))

        // The 3-message thread carries a reply from me, with mixed html
        // and plain text plus one long paragraph.
        let priya = try MailFixtures.getThread(account: "bubbles@example.com", id: "f3")
        #expect(priya.messages.count == 3)
        #expect(priya.messages.filter(\.isFromMe).count == 1)
        #expect(priya.messages.contains(where: { $0.html != nil }))
        #expect(priya.messages.contains(where: { $0.html == nil && ($0.text ?? "").contains("5th") }))
        #expect(priya.messages.contains(where: { ($0.html ?? "").contains("corner booth") }))

        #expect(throws: InvalidParamsError.self) {
            try MailFixtures.getThread(account: "bubbles@example.com", id: "nope")
        }
    }

    @Test func fixtureHandlersServeOverRPC() async throws {
        let transport = InMemoryTransport(lines: [
            #"{"jsonrpc":"2.0","id":1,"method":"mail.listThreads","params":{"label":"INBOX"}}"#,
            #"{"jsonrpc":"2.0","id":2,"method":"mail.getThread","params":{"account":"bubbles@example.com","id":"f1"}}"#,
            #"{"jsonrpc":"2.0","id":3,"method":"accounts.list"}"#,
        ])
        let server = RPCServer(transport: transport)
        await server.register("accounts.list", handler: fixtureAccountsListHandler())
        await server.register("mail.listThreads", handler: fixtureMailListThreadsHandler())
        await server.register("mail.getThread", handler: fixtureMailGetThreadHandler())
        await server.run()
        let output = await transport.collectedOutput()
        #expect(output.count == 3)
        // Replies may arrive out of order (each carries its request id).
        var byID: [Int: JSONValue] = [:]
        for line in output {
            let value = try JSONDecoder().decode(JSONValue.self, from: Data(line.utf8))
            guard case .object(let envelope) = value,
                case .int(let id) = envelope["id"]
            else {
                Issue.record("response had unexpected shape: \(line)")
                return
            }
            byID[id] = value
        }
        let list = try #require(byID[1])
        let detail = try #require(byID[2])
        let accounts = try #require(byID[3])

        guard case .object(let envelope) = list,
            case .object(let result) = envelope["result"],
            case .array(let threads) = result["threads"],
            case .array(let unreachable) = result["unreachable"],
            case .array(let authExpired) = result["authExpired"]
        else {
            Issue.record("mail.listThreads response had unexpected shape: \(String(describing: byID[1]))")
            return
        }
        #expect(threads.count == 8)
        #expect(unreachable.isEmpty)
        #expect(authExpired.isEmpty)
        guard case .object(let first) = threads[0],
            case .object(let from) = first["from"]
        else {
            Issue.record("thread row had unexpected shape: \(threads)")
            return
        }
        #expect(from["name"]?.stringValue?.isEmpty == false)
        #expect(first["date"]?.stringValue?.isEmpty == false)
        #expect(first["subject"]?.stringValue?.isEmpty == false)
        // Second page continues from the returned cursor.
        guard case .object(let next) = result["next"] else {
            Issue.record("expected a next cursor on the first page")
            return
        }
        #expect(!next.isEmpty)

        guard case .object(let detailEnvelope) = detail,
            case .object(let detailResult) = detailEnvelope["result"],
            case .array(let messages) = detailResult["messages"]
        else {
            Issue.record("mail.getThread response had unexpected shape: \(String(describing: byID[2]))")
            return
        }
        #expect(messages.count == 1)
        guard case .object(let message) = messages[0] else {
            Issue.record("message had unexpected shape: \(messages)")
            return
        }
        #expect(message["html"]?.stringValue?.contains("https://example.com/swap") == true)

        guard case .object(let accountsEnvelope) = accounts,
            case .object(let accountsResult) = accountsEnvelope["result"],
            case .array(let accountList) = accountsResult["accounts"]
        else {
            Issue.record("accounts.list response had unexpected shape: \(String(describing: byID[3]))")
            return
        }
        #expect(accountList.count == 2)
    }
}
