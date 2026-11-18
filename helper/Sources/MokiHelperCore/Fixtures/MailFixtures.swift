import Foundation

// MARK: - Fixture mail
//
// Served when `MOKI_FIXTURES=1`: canned threads (12 rows across two
// accounts) plus matching accounts, with no network and no file access.
// Cursor paging uses 8 rows per page so infinite scroll is exercised.

public let fixturePersonalAccount = "bubbles@example.com"
public let fixtureWorkAccount = "work@example.com"

public enum MailFixtures {
    public static let pageSize = 8

    public static func fixtureAccountsResult() -> GoogleAccountsListResult {
        GoogleAccountsListResult(
            accounts: [
                GoogleAccount(
                    address: fixturePersonalAccount, name: "Bubbles", status: .ok),
                GoogleAccount(
                    address: fixtureWorkAccount, name: "Work", status: .ok),
            ],
            psymailImport: .done)
    }

    /// Merged newest-first page. The cursor maps account -> integer offset
    /// (encoded as a string); accounts fetch up to `pageSize` rows past
    /// their offset, the merge truncates to `pageSize`, and offsets advance
    /// only by rows actually returned, so nothing is skipped or repeated.
    /// `label` is accepted for shape parity and ignored.
    public static func listThreads(
        label: String, cursor: [String: String]?, now: Date = Date()
    ) -> MailPage {
        _ = label
        let all = summaries(now: now)
        var byAccount: [String: [ThreadSummary]] = [:]
        for thread in all { byAccount[thread.account, default: []].append(thread) }
        var offsets: [String: Int] = [:]
        var fetched: [ThreadSummary] = []
        for (account, rows) in byAccount {
            let offset = Int(cursor?[account] ?? "0") ?? 0
            offsets[account] = max(0, offset)
            fetched.append(contentsOf: rows.dropFirst(max(0, offset)).prefix(pageSize))
        }
        fetched.sort {
            let left = mailSortDate($0.date)
            let right = mailSortDate($1.date)
            if left != right { return left > right }
            return $0.id < $1.id
        }
        let page = Array(fetched.prefix(pageSize))
        var consumed: [String: Int] = [:]
        for thread in page { consumed[thread.account, default: 0] += 1 }
        var next: [String: String] = [:]
        for (account, rows) in byAccount {
            let advanced = (offsets[account] ?? 0) + (consumed[account] ?? 0)
            if advanced < rows.count { next[account] = String(advanced) }
        }
        return MailPage(
            threads: page, next: next.isEmpty ? nil : next,
            unreachable: [], authExpired: [])
    }

    public static func getThread(account: String, id: String, now: Date = Date()) throws -> ThreadDetail {
        guard let detail = details(now: now)["\(account)/\(id)"] else {
            throw InvalidParamsError("Unknown thread.")
        }
        return detail
    }

    // MARK: - Seeds

    static func summaries(now: Date) -> [ThreadSummary] {
        seeds(now: now).map(\.summary)
    }

    static func details(now: Date) -> [String: ThreadDetail] {
        var out: [String: ThreadDetail] = [:]
        for seed in seeds(now: now) {
            out["\(seed.summary.account)/\(seed.summary.id)"] = seed.detail
        }
        return out
    }

    struct Seed {
        var summary: ThreadSummary
        var detail: ThreadDetail
    }

    static func seeds(now: Date) -> [Seed] {
        let personalMe = EmailAddress(name: "Bubbles", address: fixturePersonalAccount)
        func date(hoursAgo: Double) -> String {
            iso8601String(now.addingTimeInterval(-hoursAgo * 3600))
        }
        func single(
            id: String, account: String, fromName: String, fromAddress: String,
            subject: String, snippet: String, hoursAgo: Double, unread: Bool,
            labelIds: [String] = ["INBOX"], html: String? = nil, text: String? = nil,
            to: [EmailAddress]? = nil, cc: [EmailAddress] = []
        ) -> Seed {
            let from = EmailAddress(name: fromName, address: fromAddress)
            let recipients = to ?? [personalMe]
            let body = text ?? snippet
            let summary = ThreadSummary(
                id: id, account: account, from: from, subject: subject,
                snippet: snippet, date: date(hoursAgo: hoursAgo), unread: unread,
                messageCount: 1, labelIds: unread ? labelIds.unionUnread : labelIds)
            let message = MailMessage(
                id: "\(id)-m1", from: from, to: recipients, cc: cc,
                date: date(hoursAgo: hoursAgo), html: html, text: body,
                isFromMe: false)
            return Seed(
                summary: summary,
                detail: ThreadDetail(id: id, account: account, subject: subject, messages: [message]))
        }

        let claytonHTML =
            #"<html><head><style>.invite{color:#3DE8FF;font-weight:bold}</style></head><body><p class="invite">Still good for Saturday?</p><p>I'll bring the monstera cuttings and extra pots.</p><a href="https://example.com/swap">RSVP here</a></body></html>"#

        var seeds: [Seed] = [
            single(
                id: "f1", account: fixturePersonalAccount,
                fromName: "Clayton Gibson", fromAddress: "clayton@example.com",
                subject: "Plant swap this weekend?",
                snippet: "Still good for Saturday? I'll bring the monstera cuttings…",
                hoursAgo: 0.4, unread: true, html: claytonHTML,
                text: "Still good for Saturday? I'll bring the monstera cuttings and extra pots. RSVP: https://example.com/swap"),
            single(
                id: "f2", account: fixturePersonalAccount,
                fromName: "Kate", fromAddress: "kate@example.com",
                subject: "Re: weekend cabin",
                snippet: "Booked! Leaving Friday after lunch, back Sunday night…",
                hoursAgo: 1.2, unread: true),
            single(
                id: "f4", account: fixtureWorkAccount,
                fromName: "Luis", fromAddress: "luis@example.com",
                subject: "Q3 planning doc",
                snippet: "Left comments on the headcount tab — take a look…",
                hoursAgo: 3, unread: false,
                text: "Left comments on the headcount tab — take a look when you get a chance."),
            single(
                id: "f5", account: fixturePersonalAccount,
                fromName: "Tasha", fromAddress: "tasha@example.com",
                subject: "Book club pick",
                snippet: "Voting closes tonight — I'm team mystery…",
                hoursAgo: 8, unread: true),
            single(
                id: "f6", account: fixtureWorkAccount,
                fromName: "Sam", fromAddress: "sam@example.com",
                subject: "Deploy is green",
                snippet: "Canary at 100%, no errors so far…",
                hoursAgo: 22, unread: false,
                text: "Canary is at 100% and error rates look clean. Calling it green."),
            single(
                id: "f7", account: fixturePersonalAccount,
                fromName: "Noor", fromAddress: "noor@example.com",
                subject: "Photos from Saturday",
                snippet: "Finally uploaded the lake ones…",
                hoursAgo: 30, unread: false),
            single(
                id: "f8", account: fixtureWorkAccount,
                fromName: "Garden club", fromAddress: "garden-club@example.com",
                subject: "Compost pickup moved",
                snippet: "This week's pickup moves to Thursday…",
                hoursAgo: 49, unread: false,
                text: "Heads up: this week's compost pickup moves to Thursday morning. Bins out by 7!",
                cc: [EmailAddress(name: "Priya", address: "priya@example.com")]),
            single(
                id: "f9", account: fixturePersonalAccount,
                fromName: "Maya", fromAddress: "maya@example.com",
                subject: "Thank you!!",
                snippet: "The soup was exactly what I needed…",
                hoursAgo: 73, unread: false),
            single(
                id: "f10", account: fixtureWorkAccount,
                fromName: "Eli", fromAddress: "eli@example.com",
                subject: "Interview loop Friday",
                snippet: "Can you cover the 2pm system design…",
                hoursAgo: 97, unread: true,
                text: "Can you cover the 2pm system design round on Friday? Happy to swap."),
            single(
                id: "f11", account: fixturePersonalAccount,
                fromName: "Andre", fromAddress: "andre@example.com",
                subject: "Running tomorrow?",
                snippet: "6:30 at the usual spot?",
                hoursAgo: 122, unread: false,
                text: "6:30 at the usual spot? Forecast says clear and cool."),
            single(
                id: "f12", account: fixtureWorkAccount,
                fromName: "Jordan", fromAddress: "jordan@example.com",
                subject: "Expense report",
                snippet: "Approved — reimburses Friday…",
                hoursAgo: 168, unread: false,
                text: "Approved — this reimburses on Friday's cycle."),
        ]

        // Priya: the 3-message thread (one reply from me).
        let priya = EmailAddress(name: "Priya", address: "priya@example.com")
        let priyaMessages = [
            MailMessage(
                id: "f3-m1", from: priya, to: [personalMe], cc: [],
                date: date(hoursAgo: 27), html: nil,
                text: "Are you free for dinner Thursday? That new place on 5th?", isFromMe: false),
            MailMessage(
                id: "f3-m2", from: personalMe, to: [priya], cc: [],
                date: date(hoursAgo: 26), html: nil,
                text: "Thursday works! 7ish?", isFromMe: true),
            MailMessage(
                id: "f3-m3", from: priya, to: [personalMe], cc: [],
                date: date(hoursAgo: 26), html: nil,
                text: "7ish is perfect, see you there!", isFromMe: false),
        ]
        let priyaSummary = ThreadSummary(
            id: "f3", account: fixturePersonalAccount, from: priya,
            subject: "Dinner Thursday?",
            snippet: "Priya: 7ish is perfect, see you there!",
            date: date(hoursAgo: 26), unread: true, messageCount: 3,
            labelIds: ["INBOX", "UNREAD"])
        seeds.insert(
            Seed(
                summary: priyaSummary,
                detail: ThreadDetail(
                    id: "f3", account: fixturePersonalAccount,
                    subject: "Dinner Thursday?", messages: priyaMessages)),
            at: 2)

        return seeds
    }
}

private extension Array where Element == String {
    var unionUnread: [String] {
        contains("UNREAD") ? self : self + ["UNREAD"]
    }
}

// MARK: - Fixture RPC handlers (no network, no file access)

public func fixtureAccountsListHandler() -> @Sendable (JSONValue) async throws -> GoogleAccountsListResult {
    return { _ in MailFixtures.fixtureAccountsResult() }
}

public func fixtureMailListThreadsHandler() -> @Sendable (JSONValue) async throws -> MailPage {
    return { params in
        let request = try decodeMailParams(params, as: ListThreadsParams.self)
        return MailFixtures.listThreads(label: request.label, cursor: request.cursor)
    }
}

public func fixtureMailGetThreadHandler() -> @Sendable (JSONValue) async throws -> ThreadDetail {
    return { params in
        let request = try decodeMailParams(params, as: GetThreadParams.self)
        return try MailFixtures.getThread(account: request.account, id: request.id)
    }
}
