import Foundation

// MARK: - Merged mail service
//
// One `listThreads` call fans out to every signed-in account and merges
// the rows newest-first; one `getThread` call fetches a single thread's
// full messages. Per-account failures never fail the page — they land in
// `unreachable`/`authExpired` — while a missing OAuth client
// (`auth_unconfigured`) still throws.

public struct MailService: Sendable {
    public var accounts: GoogleAccountsService
    public var gmail: GmailClient

    public init(accounts: GoogleAccountsService, session: URLSession = .shared) {
        self.accounts = accounts
        let service = accounts
        self.gmail = GmailClient(session: session) { address in
            try await service.accessToken(for: address)
        }
    }

    /// List threads for `label` (`INBOX`, or `psymail/<name>` bundles)
    /// merged newest-first across accounts. `cursor` maps account to the
    /// previous page's `next` token; the returned `next` omits exhausted
    /// accounts.
    public func listThreads(label: String, cursor: [String: String]? = nil) async throws -> MailPage {
        let listed = try await accounts.listAccounts()
        var ok: [String] = []
        var unreachable: [String] = []
        var authExpired: [String] = []
        for account in listed.accounts {
            switch account.status {
            case .ok: ok.append(account.address)
            case .authExpired: authExpired.append(account.address)
            case .unreachable: unreachable.append(account.address)
            }
        }
        var threads: [ThreadSummary] = []
        var next: [String: String] = [:]
        if !ok.isEmpty {
            let gmail = gmail
            let results = await withTaskGroup(
                of: AccountThreads.self, returning: [AccountThreads].self
            ) { group in
                for address in ok {
                    group.addTask {
                        await fetchThreads(
                            gmail: gmail, label: label, account: address,
                            pageToken: cursor?[address])
                    }
                }
                var out: [AccountThreads] = []
                for await result in group { out.append(result) }
                return out
            }
            for result in results {
                switch result.outcome {
                case .ok(let rows, let token):
                    threads.append(contentsOf: rows)
                    if let token { next[result.account] = token }
                case .authExpired:
                    authExpired.append(result.account)
                case .unreachable:
                    unreachable.append(result.account)
                }
            }
        }
        threads.sort {
            let left = mailSortDate($0.date)
            let right = mailSortDate($1.date)
            if left != right { return left > right }
            return $0.id < $1.id
        }
        return MailPage(
            threads: threads, next: next.isEmpty ? nil : next,
            unreachable: unreachable.sorted(), authExpired: authExpired.sorted())
    }

    public func getThread(account: String, id: String) async throws -> ThreadDetail {
        // `listThreads` funnels through `listAccounts()`, which gives the
        // one-time psymail import its chance to merge; `getThread` doesn't,
        // so ensure the import here — a fresh install may hold tokens only in
        // psymail-mini.
        await accounts.ensureTokens()
        return try await gmail.fetchDetail(account: account, id: id)
    }
}

private struct AccountThreads: Sendable {
    enum Outcome: Sendable {
        case ok(rows: [ThreadSummary], token: String?)
        case authExpired
        case unreachable
    }

    var account: String
    var outcome: Outcome
}

/// Fetch one account's page. Never throws: `auth_expired` maps to the
/// account outcome, anything else transient maps to `unreachable`, and an
/// unknown label (e.g. a bundle the account never created) contributes no
/// rows rather than failing the merge.
private func fetchThreads(
    gmail: GmailClient, label: String, account: String, pageToken: String?
) async -> AccountThreads {
    do {
        let labelID = try await gmail.resolveLabelID(label: label, account: account)
        let (ids, token) = try await gmail.listThreadIDs(
            account: account, labelID: labelID, pageToken: pageToken)
        let rows = try await gmail.fetchSummaries(account: account, ids: ids)
        return AccountThreads(account: account, outcome: .ok(rows: rows, token: token))
    } catch _ as InvalidParamsError {
        return AccountThreads(account: account, outcome: .ok(rows: [], token: nil))
    } catch let error as AppError where error.code == "auth_expired" {
        return AccountThreads(account: account, outcome: .authExpired)
    } catch {
        return AccountThreads(account: account, outcome: .unreachable)
    }
}

// MARK: - RPC handlers

/// Decode RPC params through JSON round-trip. Shared with the fixture
/// handlers in `Fixtures/MailFixtures.swift` so both entry points reject
/// malformed params identically.
func decodeMailParams<T: Decodable>(_ params: JSONValue, as type: T.Type) throws -> T {
    do {
        let data = try JSONEncoder().encode(params)
        return try JSONDecoder().decode(T.self, from: data)
    } catch {
        throw InvalidParamsError("Invalid params")
    }
}

public func mailListThreadsHandler(service: MailService) -> @Sendable (JSONValue) async throws -> MailPage {
    return { params in
        let request = try decodeMailParams(params, as: ListThreadsParams.self)
        return try await service.listThreads(label: request.label, cursor: request.cursor)
    }
}

public func mailGetThreadHandler(service: MailService) -> @Sendable (JSONValue) async throws -> ThreadDetail {
    return { params in
        let request = try decodeMailParams(params, as: GetThreadParams.self)
        return try await service.getThread(account: request.account, id: request.id)
    }
}
