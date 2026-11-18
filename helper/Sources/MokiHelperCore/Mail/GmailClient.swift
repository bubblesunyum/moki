import Foundation

// MARK: - Gmail REST client
//
// Thin wrapper over the Gmail API used by `MailService`:
// - `users.labels.list` resolves bundle names (`psymail/<name>`) to label
//   ids per account, cached for the client's lifetime (`INBOX` is a system
//   label and needs no lookup).
// - `users.threads.list?labelIds=..&maxResults=30&pageToken=..` pages ids.
// - `users.threads.get?format=metadata` builds list rows (From/Subject/Date
//   headers + snippet + labelIds), fetched with bounded concurrency 8.
// - `users.threads.get?format=full` builds thread detail (html>plain bodies,
//   base64url-decoded with charset handling).
//
// Header/address parsing, RFC2047, date parsing, the MIME walk, and
// base64url/charset decoding live in `MailParsing.swift`; this file keeps
// requests, wire shapes, and row building.

private let mailConcurrency = 8

public actor GmailClient {
    private let session: URLSession
    private let tokenProvider: @Sendable (String) async throws -> String
    private let maxResults: Int
    /// "account\nlabel name" -> label id.
    private var labelCache: [String: String] = [:]

    public init(
        session: URLSession = .shared,
        maxResults: Int = 30,
        tokenProvider: @escaping @Sendable (String) async throws -> String
    ) {
        self.session = session
        self.maxResults = maxResults
        self.tokenProvider = tokenProvider
    }

    // MARK: - Requests

    private func request(
        account: String, path: String, query: [URLQueryItem]
    ) async throws -> (Data, Int) {
        // Validate (and encode) the URL before minting a token:
        // RPC-supplied segments must never crash the helper, nor read as a
        // Gmail outage.
        let url = try gmailURL(account: account, path: path, query: query)
        let token = try await tokenProvider(account)
        var urlRequest = URLRequest(url: url)
        urlRequest.timeoutInterval = googleRequestTimeout
        urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: urlRequest)
        } catch {
            throw AppError(
                code: "unreachable",
                message: "Gmail request failed: network unavailable.")
        }
        guard let http = response as? HTTPURLResponse else {
            throw AppError(code: "unreachable", message: "Gmail request failed.")
        }
        return (data, http.statusCode)
    }

    // MARK: - Labels

    /// Resolve a label name to a Gmail label id. System label `INBOX`
    /// returns directly; bundle names (`psymail/<name>`) are looked up via
    /// `users.labels.list` and cached per account. Throws
    /// `InvalidParamsError` when the account has no such label, and
    /// `AppError(unreachable)` when a 200 response won't decode (a sick
    /// proxy or API change, not an empty label list).
    public func resolveLabelID(label: String, account: String) async throws -> String {
        if label.caseInsensitiveCompare("INBOX") == .orderedSame { return "INBOX" }
        let key = account + "\n" + label
        if let cached = labelCache[key] { return cached }
        let (data, status) = try await request(account: account, path: "labels", query: [])
        guard status == 200 else { throw gmailStatusError(status: status, account: account) }
        guard let listed = try? JSONDecoder().decode(GmailLabelList.self, from: data) else {
            throw AppError(
                code: "unreachable", message: "Gmail returned an unexpected response.")
        }
        guard let match = listed.labels?.first(where: { $0.name == label }) else {
            throw InvalidParamsError("Unknown Gmail label: \(label)")
        }
        labelCache[key] = match.id
        return match.id
    }

    // MARK: - Thread lists

    public func listThreadIDs(
        account: String, labelID: String, pageToken: String?
    ) async throws -> (ids: [String], nextPageToken: String?) {
        var query = [
            URLQueryItem(name: "labelIds", value: labelID),
            URLQueryItem(name: "maxResults", value: String(maxResults)),
        ]
        if let pageToken, !pageToken.isEmpty {
            query.append(URLQueryItem(name: "pageToken", value: pageToken))
        }
        let (data, status) = try await request(account: account, path: "threads", query: query)
        guard status == 200 else { throw gmailStatusError(status: status, account: account) }
        guard let listed = try? JSONDecoder().decode(GmailThreadList.self, from: data) else {
            throw AppError(
                code: "unreachable", message: "Gmail returned an unexpected response.")
        }
        return (listed.threads?.map(\.id) ?? [], listed.nextPageToken)
    }

    // MARK: - Summaries (metadata)

    /// Fetch one list row. Never returns nil: threads without messages
    /// degrade to a placeholder row so counts stay predictable.
    public func threadSummary(account: String, id: String) async throws -> ThreadSummary {
        let query = [
            URLQueryItem(name: "format", value: "metadata"),
            URLQueryItem(name: "metadataHeaders", value: "From"),
            URLQueryItem(name: "metadataHeaders", value: "Subject"),
            URLQueryItem(name: "metadataHeaders", value: "Date"),
        ]
        let (data, status) = try await request(
            account: account, path: "threads/\(id)", query: query)
        guard status == 200 else { throw gmailStatusError(status: status, account: account) }
        guard let thread = try? JSONDecoder().decode(GmailThread.self, from: data) else {
            throw AppError(code: "unreachable", message: "Gmail returned an unexpected response.")
        }
        return summarize(thread: thread, account: account)
    }

    /// Fetch metadata rows with bounded concurrency (`mailConcurrency`
    /// in flight). A single thread's `AppError` (auth/reachability) fails
    /// the batch so the account is reported, not silently partial; any
    /// other per-thread failure skips just that thread.
    public func fetchSummaries(account: String, ids: [String]) async throws -> [ThreadSummary] {
        var out: [ThreadSummary] = []
        var index = 0
        while index < ids.count {
            let chunk = Array(ids[index..<min(index + mailConcurrency, ids.count)])
            let rows = try await withThrowingTaskGroup(
                of: ThreadSummary?.self, returning: [ThreadSummary].self
            ) { group in
                for id in chunk {
                    group.addTask {
                        do {
                            return try await self.threadSummary(account: account, id: id)
                        } catch let error as AppError {
                            throw error
                        } catch {
                            return nil
                        }
                    }
                }
                var collected: [ThreadSummary] = []
                for try await row in group {
                    if let row { collected.append(row) }
                }
                return collected
            }
            out.append(contentsOf: rows)
            index += chunk.count
        }
        return out
    }

    // MARK: - Detail (full)

    public func fetchDetail(account: String, id: String) async throws -> ThreadDetail {
        let (data, status) = try await request(
            account: account, path: "threads/\(id)",
            query: [URLQueryItem(name: "format", value: "full")])
        guard status == 200 else { throw gmailStatusError(status: status, account: account) }
        guard let thread = try? JSONDecoder().decode(GmailThread.self, from: data) else {
            throw AppError(code: "unreachable", message: "Gmail returned an unexpected response.")
        }
        guard let messages = thread.messages, !messages.isEmpty else {
            throw InvalidParamsError("Unknown Gmail thread.")
        }
        let subject = messageSubject(messages[0])
        return ThreadDetail(
            id: thread.id, account: account, subject: subject,
            messages: messages.map { detailMessage($0, account: account) })
    }

    // MARK: - Row building

    private func summarize(thread: GmailThread, account: String) -> ThreadSummary {
        let messages = thread.messages ?? []
        let first = messages.first
        let headers = headerMap(first?.payload?.headers)
        let from = parseEmailAddress(headers["from"] ?? "")
        let subject = nonEmpty(decodeRFC2047(headers["subject"] ?? "")) ?? "(No subject)"
        let date = latestDate(messages: messages, headers: headers)
        let labelIds = unionLabelIds(messages: messages)
        let unread = labelIds.contains("UNREAD")
        return ThreadSummary(
            id: thread.id, account: account, from: from, subject: subject,
            snippet: thread.snippet ?? "", date: iso8601String(date),
            unread: unread, messageCount: max(messages.count, 1), labelIds: labelIds)
    }

    private func detailMessage(_ message: GmailMessage, account: String) -> MailMessage {
        let headers = headerMap(message.payload?.headers)
        let from = parseEmailAddress(headers["from"] ?? "")
        let to = splitAddresses(headers["to"] ?? "").map(parseEmailAddress(_:))
        let cc = splitAddresses(headers["cc"] ?? "").map(parseEmailAddress(_:))
        let date = messageDate(headers: headers, internalDate: message.internalDate)
        var bodies = CollectedBodies()
        if let payload = message.payload { collectBodies(payload, into: &bodies) }
        let me = account.lowercased()
        return MailMessage(
            id: message.id, from: from, to: to, cc: cc,
            date: iso8601String(date), html: bodies.html, text: bodies.text,
            isFromMe: !from.address.isEmpty && from.address.lowercased() == me)
    }
}

// MARK: - Gmail wire shapes

struct GmailLabelInfo: Decodable {
    var id: String
    var name: String
}

struct GmailLabelList: Decodable {
    var labels: [GmailLabelInfo]?
}

struct GmailThreadRef: Decodable {
    var id: String
}

struct GmailThreadList: Decodable {
    var threads: [GmailThreadRef]?
    var nextPageToken: String?
}

struct GmailHeader: Decodable {
    var name: String
    var value: String
}

struct GmailBody: Decodable {
    var data: String?
    var size: Int?
}

struct GmailPart: Decodable {
    var mimeType: String?
    var filename: String?
    var headers: [GmailHeader]?
    var body: GmailBody?
    var parts: [GmailPart]?
}

struct GmailMessage: Decodable {
    var id: String
    var threadId: String?
    var labelIds: [String]?
    var snippet: String?
    var internalDate: String?
    var payload: GmailPart?
}

struct GmailThread: Decodable {
    var id: String
    var snippet: String?
    var historyId: String?
    var messages: [GmailMessage]?
    var labelIds: [String]?
}

// MARK: - Status mapping

/// 401/403 means the grant died (`auth_expired`); 404 means the caller
/// asked for something unknown (`InvalidParamsError`); anything else is a
/// transient Gmail failure (`unreachable`).
func gmailStatusError(status: Int, account: String) -> Error {
    switch status {
    case 401, 403:
        return AppError(
            code: "auth_expired",
            message: "Google authorization expired for \(account). Sign in again to reconnect.")
    case 404:
        return InvalidParamsError("Unknown Gmail thread or label.")
    default:
        return AppError(
            code: "unreachable",
            message: "Gmail request failed (HTTP \(status)).")
    }
}

// MARK: - URL building

/// Segments allowed literally in a Gmail path segment. `/` is excluded so
/// an RPC-supplied account or id can never escape its segment; everything
/// else outside the set (spaces, `?`, `#`, non-ASCII…) is percent-encoded.
/// `@` stays literal so account URLs keep their familiar shape.
private let gmailPathSegmentAllowed: CharacterSet = {
    var allowed = CharacterSet.urlPathAllowed
    allowed.remove(charactersIn: "/")
    return allowed
}()

/// Build a Gmail API URL from RPC-supplied segments. Each segment is
/// percent-encoded so hostile input can't escape the path; control
/// characters (never valid in an account or thread id) and anything else
/// that won't build are caller bugs → `InvalidParamsError`, never a crash
/// and never misreported as a Gmail outage.
func gmailURL(account: String, path: String, query: [URLQueryItem]) throws -> URL {
    guard !account.isEmpty, !path.isEmpty else {
        throw InvalidParamsError("Invalid Gmail request.")
    }
    let rawSegments =
        [account] + path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    for segment in rawSegments {
        guard !segment.isEmpty,
            segment.rangeOfCharacter(from: .controlCharacters) == nil
        else {
            throw InvalidParamsError("Invalid Gmail request.")
        }
    }
    let encoded = try rawSegments.map { segment -> String in
        guard let escaped = segment.addingPercentEncoding(
            withAllowedCharacters: gmailPathSegmentAllowed)
        else {
            throw InvalidParamsError("Invalid Gmail request.")
        }
        return escaped
    }
    var components = URLComponents()
    components.scheme = "https"
    components.host = "gmail.googleapis.com"
    components.percentEncodedPath = "/gmail/v1/users/" + encoded.joined(separator: "/")
    if !query.isEmpty { components.queryItems = query }
    guard let url = components.url else {
        throw InvalidParamsError("Invalid Gmail request.")
    }
    return url
}
