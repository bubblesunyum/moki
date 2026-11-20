import Foundation
import PsymailKit

// MARK: - Merged mail service
//
// `listThreads` lists through the mail engine seam (`EngineSeam.swift`):
// one `page` call across every signed-in account, threads collapsed and
// merged newest-first. `getThread` still fetches full detail over the
// Gmail API (`fetchDetail` + `MailParsing`), which is where subject/to/cc
// bodies the engine's rows don't carry come from. Per-account failures
// never fail the page — they land in `unreachable`/`authExpired` — while
// a missing OAuth client (`auth_unconfigured`) still throws.

public struct MailService: Sendable {
    public var accounts: GoogleAccountsService
    public var gmail: GmailClient
    private let engine: any MailEngine

    public init(accounts: GoogleAccountsService, session: URLSession = .shared) {
        self.accounts = accounts
        let service = accounts
        self.gmail = GmailClient(session: session) { address in
            try await service.accessToken(for: address)
        }
        // One shared engine per service: its emitted-thread tracking is
        // per tab, and a fresh engine per listing would re-emit threads
        // across pages.
        self.engine = PsymailMailEngine(token: { address in
            try await service.accessToken(for: address)
        })
    }

    /// Test seam: inject a fake engine (and Gmail client for detail tests).
    init(accounts: GoogleAccountsService, gmail: GmailClient, engine: any MailEngine) {
        self.accounts = accounts
        self.gmail = gmail
        self.engine = engine
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
        // Unknown labels (anything but INBOX / psymail/<name>) list
        // nothing — the old Gmail path swallowed its unknown-label error
        // the same way.
        guard let tab = mailTab(for: label) else {
            return MailPage(
                threads: [], next: nil,
                unreachable: unreachable.sorted(), authExpired: authExpired.sorted())
        }
        // Per-account label maps through the engine. A dead grant lands
        // the account in `authExpired`; anything else transient lands it
        // in `unreachable`.
        var engineAccounts: [PsymailAccount] = []
        for address in ok {
            do {
                let map = try await engine.labelMap(for: address)
                engineAccounts.append(PsymailAccount(address: address, labelMap: map))
            } catch let error as AppError where error.code == "auth_expired" {
                authExpired.append(address)
            } catch {
                unreachable.append(address)
            }
        }
        guard !engineAccounts.isEmpty else {
            return MailPage(
                threads: [], next: nil,
                unreachable: unreachable.sorted(), authExpired: authExpired.sorted())
        }
        // A non-nil but empty cursor is a first page, not a continuation:
        // the engine skips accounts missing from a non-nil cursor
        // (GmailSource.merge), so `{}` would skip every listed account and
        // return an empty first page. The old path read each account's
        // token as `cursor?[address]` (missing key = first page), which this
        // restores. A non-empty cursor keeps its continuation meaning:
        // accounts it omits are exhausted, not restarted.
        let effectiveCursor = (cursor?.isEmpty == true) ? nil : cursor
        let page = await engine.page(tab: tab, accounts: engineAccounts, cursor: effectiveCursor)
        var threads = page.rows.map(threadSummary(from:))
        threads.sort {
            let left = mailSortDate($0.date)
            let right = mailSortDate($1.date)
            if left != right { return left > right }
            return $0.id < $1.id
        }
        return MailPage(
            threads: threads, next: page.next,
            unreachable: Set(unreachable).union(page.unreachable).sorted(),
            authExpired: Set(authExpired).union(page.authExpired).sorted())
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

// MARK: - RPC handlers

/* Decode RPC params through a JSON round-trip. Shared with the fixture
 * handlers in `Fixtures/MailFixtures.swift` and the calendar handlers so
 * all entry points reject malformed params identically. */
func decodeRpcParams<T: Decodable>(_ params: JSONValue, as type: T.Type) throws -> T {
    do {
        let data = try JSONEncoder().encode(params)
        return try JSONDecoder().decode(T.self, from: data)
    } catch {
        throw InvalidParamsError("Invalid params")
    }
}

public func mailListThreadsHandler(service: MailService) -> @Sendable (JSONValue) async throws -> MailPage {
    return { params in
        let request = try decodeRpcParams(params, as: ListThreadsParams.self)
        return try await service.listThreads(label: request.label, cursor: request.cursor)
    }
}

public func mailGetThreadHandler(service: MailService) -> @Sendable (JSONValue) async throws -> ThreadDetail {
    return { params in
        let request = try decodeRpcParams(params, as: GetThreadParams.self)
        return try await service.getThread(account: request.account, id: request.id)
    }
}
