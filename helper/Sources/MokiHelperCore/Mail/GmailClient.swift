import Foundation

// MARK: - Gmail REST client
//
// Thin wrapper over the Gmail API used for thread detail:
// - `users.threads.get?format=full` builds thread detail (html>plain bodies,
//   base64url-decoded with charset handling).
//
// Listing goes through the mail engine seam (`EngineSeam.swift`), not
// through this client.
//
// Header/address parsing, RFC2047, date parsing, the MIME walk, and
// base64url/charset decoding live in `MailParsing.swift`; this file keeps
// requests, wire shapes, and detail-row building.

public actor GmailClient {
    private let session: URLSession
    private let tokenProvider: @Sendable (String) async throws -> String
    private let maxResults: Int

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

    // MARK: - Detail rows

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
