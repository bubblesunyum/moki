import Foundation
import Testing

@testable import MokiHelperCore

// MARK: - Stubs

private final class MailStubURLProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler:
        (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    static func setHandler(
        _ handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)
    ) {
        lock.withLock { self.handler = handler }
    }

    static func clear() {
        lock.withLock { self.handler = nil }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let handler = Self.lock.withLock { Self.handler }
        do {
            guard let handler else { throw URLError(.badServerResponse) }
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private final class MailRequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []

    func append(_ request: URLRequest) {
        lock.withLock { requests.append(request) }
    }

    var all: [URLRequest] {
        lock.withLock { requests }
    }

    func urls(containing fragment: String) -> [URLRequest] {
        all.filter { $0.url?.absoluteString.contains(fragment) ?? false }
    }
}

private func makeMailStubSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [MailStubURLProtocol.self]
    return URLSession(configuration: config)
}

private func mailHTTPResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func mailJSONData(_ object: Any) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
}

private func mailBodyData(of request: URLRequest) -> Data? {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return nil }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
        let read = stream.read(&buffer, maxLength: buffer.count)
        if read <= 0 { break }
        data.append(buffer, count: read)
    }
    return data
}

private func makeTempMailHome() throws -> (home: URL, scratch: URL) {
    let scratch = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString)
    let home = scratch.appendingPathComponent("home")
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    return (home, scratch)
}

private func writeMailTokens(_ map: [String: String], to url: URL) throws {
    try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(map).write(to: url)
}

// Thread seeds for the stubbed Gmail API.
private struct MailSeed {
    var id: String
    var from: String
    var subject: String
    var date: String
    var snippet: String
    var labelIds: [String]
    var internalMs: String
}

private func metadataJSON(_ seed: MailSeed) -> [String: Any] {
    [
        "id": seed.id,
        "snippet": seed.snippet,
        "messages": [
            [
                "id": "\(seed.id)-m1",
                "labelIds": seed.labelIds,
                "internalDate": seed.internalMs,
                "payload": [
                    "mimeType": "text/plain",
                    "headers": [
                        ["name": "From", "value": seed.from],
                        ["name": "Subject", "value": seed.subject],
                        ["name": "Date", "value": seed.date],
                    ],
                ],
            ] as [String: Any]
        ],
    ]
}

private func installMailStub(
    log: MailRequestLog,
    seeds: [String: [MailSeed]],
    listTokens: [String: String] = [:],
    failAccounts: [String: Int] = [:],
    labels: [[String: String]] = []
) {
    MailStubURLProtocol.setHandler { request in
        log.append(request)
        let url = request.url!.absoluteString
        if url == "https://oauth2.googleapis.com/token" {
            return (
                mailHTTPResponse(url: request.url!, status: 200),
                mailJSONData(["access_token": "ya29.mail", "expires_in": 3600])
            )
        }
        if url == "https://www.googleapis.com/oauth2/v2/userinfo" {
            return (
                mailHTTPResponse(url: request.url!, status: 200),
                mailJSONData(["name": "Mail User"])
            )
        }
        if url.contains("/labels") {
            return (
                mailHTTPResponse(url: request.url!, status: 200),
                mailJSONData(["labels": labels])
            )
        }
        // threads.get
        if let threadsRange = url.range(of: "/threads/") {
            let rest = String(url[threadsRange.upperBound...])
            let id = rest.split(separator: "?").first.map(String.init) ?? rest
            for (_, accountSeeds) in seeds {
                if let seed = accountSeeds.first(where: { $0.id == id }) {
                    if url.contains("format=full") {
                        return (
                            mailHTTPResponse(url: request.url!, status: 200),
                            mailFullJSON(seed)
                        )
                    }
                    return (
                        mailHTTPResponse(url: request.url!, status: 200),
                        mailJSONData(metadataJSON(seed))
                    )
                }
            }
            return (mailHTTPResponse(url: request.url!, status: 404), Data())
        }
        // threads.list
        if url.contains("/threads") {
            let account = url.split(separator: "/").dropLast().last.map(String.init) ?? ""
            if let status = failAccounts[account] {
                return (mailHTTPResponse(url: request.url!, status: status), Data())
            }
            let accountSeeds = seeds[account] ?? []
            let hasPageToken = url.contains("pageToken=")
            let ids: [[String: String]] = hasPageToken ? [] : accountSeeds.map { ["id": $0.id] }
            var body: [String: Any] = ["threads": ids]
            if !hasPageToken, let token = listTokens[account] {
                body["nextPageToken"] = token
            }
            return (mailHTTPResponse(url: request.url!, status: 200), mailJSONData(body))
        }
        return (mailHTTPResponse(url: request.url!, status: 500), Data())
    }
}

private func mailFullJSON(_ seed: MailSeed) -> Data {
    let html =
        "<html><head><style>.invite{color:#3DE8FF}</style></head><body><a href=\"https://example.com/x\">Hi</a></body></html>"
    return mailJSONData([
        "id": seed.id,
        "messages": [
            [
                "id": "\(seed.id)-m1",
                "labelIds": seed.labelIds,
                "internalDate": seed.internalMs,
                "payload": [
                    "mimeType": "multipart/alternative",
                    "headers": [
                        ["name": "From", "value": seed.from],
                        ["name": "Subject", "value": seed.subject],
                        ["name": "Date", "value": seed.date],
                        ["name": "To", "value": "Bubbles <bubbles@example.com>"],
                    ],
                    "parts": [
                        [
                            "mimeType": "text/plain",
                            "body": [
                                "data": Data(seed.snippet.utf8).base64EncodedString()
                            ],
                        ],
                        [
                            "mimeType": "text/html",
                            "body": ["data": Data(html.utf8).base64EncodedString()],
                        ],
                    ],
                ],
            ] as [String: Any]
        ],
    ])
}

private let mailClientEnv = [
    "MOKI_GOOGLE_CLIENT_ID": "cid",
    "MOKI_GOOGLE_CLIENT_SECRET": "s",
]

@Suite(.serialized)
struct MailTests {
    // MARK: - Header parsing

    @Test func parsesDisplayNameAddress() {
        let parsed = parseEmailAddress("Clayton Gibson <clayton@example.com>")
        #expect(parsed == EmailAddress(name: "Clayton Gibson", address: "clayton@example.com"))
    }

    @Test func parsesQuotedAddressWithComma() {
        let parsed = parseEmailAddress("\"Last, First\" <first@example.com>")
        #expect(parsed == EmailAddress(name: "Last, First", address: "first@example.com"))
    }

    @Test func parsesBareAddress() {
        let parsed = parseEmailAddress("jordan@example.com")
        #expect(parsed == EmailAddress(name: "jordan@example.com", address: "jordan@example.com"))
    }

    @Test func splitsAddressesRespectingQuotes() {
        let parts = splitAddresses("\"Last, First\" <a@x.com>, second@y.com")
        #expect(parts == ["\"Last, First\" <a@x.com>", "second@y.com"])
    }

    @Test func decodesRFC2047Words() {
        // "Café plans" as Q-encoding plus a B-encoded subject.
        #expect(decodeRFC2047("=?UTF-8?Q?Caf=C3=A9_plans?=") == "Café plans")
        #expect(
            decodeRFC2047("=?UTF-8?B?SGVsbG8gd29ybGQ=?=") == "Hello world")
        #expect(decodeRFC2047("Plain subject") == "Plain subject")
        // Unknown charset passes through untouched.
        #expect(
            decodeRFC2047("=?X-NONSENSE?B?SGVsbG8=?=") == "=?X-NONSENSE?B?SGVsbG8=?=")
    }

    @Test func parsesRFC2822Dates() {
        let expected = Date(timeIntervalSince1970: 1_763_380_800)
        let variants = [
            "Mon, 17 Nov 2025 12:00:00 +0000",
            "Mon, 17 Nov 2025 12:00:00 GMT",
            "17 Nov 2025 12:00:00 +0000",
        ]
        for variant in variants {
            #expect(parseEmailDate(variant) == expected)
        }
        #expect(parseEmailDate("not a date") == nil)
    }

    // MARK: - base64url + charset

    @Test func decodesBase64URLWithoutPadding() {
        // "Hello" unpadded, plus URL-safe alphabet round-trip.
        #expect(decodeBase64URL("SGVsbG8") == Data("Hello".utf8))
        let bytes = Data([0xfb, 0xff, 0xfe])
        let encoded =
            bytes.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        #expect(decodeBase64URL(String(encoded)) == bytes)
        #expect(decodeBase64URL("A") == nil)
    }

    @Test func decodesLatin1Charset() {
        // "Café" in ISO-8859-1 bytes.
        let bytes = Data([0x43, 0x61, 0x66, 0xE9])
        #expect(stringFromBytes(bytes, charset: "iso-8859-1") == "Café")
        #expect(stringFromBytes(Data("hi".utf8), charset: nil) == "hi")
        #expect(stringFromBytes(Data("hi".utf8), charset: "bogus-charset") == "hi")
    }

    @Test func parsesCharsetParam() {
        #expect(
            parseCharset(fromContentType: "text/plain; charset=iso-8859-1") == "iso-8859-1")
        #expect(
            parseCharset(fromContentType: "text/html; charset=\"utf-8\"") == "utf-8")
        #expect(parseCharset(fromContentType: "text/plain") == nil)
        #expect(parseCharset(fromContentType: nil) == nil)
    }

    // MARK: - Gmail client over stubbed HTTP

    @Test func listThreadsMergesNewestFirst() async throws {
        let (home, scratch) = try makeTempMailHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        try writeMailTokens(
            ["a@example.com": "ra", "b@example.com": "rb"], to: locations.mokiTokensURL)

        let seeds: [String: [MailSeed]] = [
            "a@example.com": [
                MailSeed(
                    id: "t-a1", from: "Ana <ana@x.com>", subject: "Middle",
                    date: "Mon, 17 Nov 2025 10:00:00 +0000", snippet: "mid",
                    labelIds: ["INBOX", "UNREAD"], internalMs: "1763373600000"),
                MailSeed(
                    id: "t-a2", from: "Zed <zed@x.com>",
                    subject: "=?UTF-8?Q?Caf=C3=A9_plans?=",
                    date: "Sun, 16 Nov 2025 10:00:00 +0000", snippet: "old",
                    labelIds: ["INBOX"], internalMs: "1763287200000"),
            ],
            "b@example.com": [
                MailSeed(
                    id: "t-b1", from: "Bo <bo@x.com>", subject: "Newest",
                    date: "Mon, 17 Nov 2025 12:00:00 +0000", snippet: "new",
                    labelIds: ["INBOX"], internalMs: "1763380800000")
            ],
        ]
        let log = MailRequestLog()
        installMailStub(
            log: log, seeds: seeds,
            listTokens: ["a@example.com": "tok-a", "b@example.com": "tok-b"])
        defer { MailStubURLProtocol.clear() }

        let service = MailService(
            accounts: GoogleAccountsService(
                locations: locations, environment: mailClientEnv,
                session: makeMailStubSession()),
            session: makeMailStubSession())
        let page = try await service.listThreads(label: "INBOX")

        #expect(page.threads.map(\.id) == ["t-b1", "t-a1", "t-a2"])
        #expect(page.next == ["a@example.com": "tok-a", "b@example.com": "tok-b"])
        #expect(page.unreachable.isEmpty)
        #expect(page.authExpired.isEmpty)

        let newest = try #require(page.threads.first)
        #expect(newest.account == "b@example.com")
        #expect(newest.from == EmailAddress(name: "Bo", address: "bo@x.com"))
        #expect(newest.subject == "Newest")
        #expect(newest.messageCount == 1)
        #expect(!newest.unread)

        let middle = page.threads[1]
        #expect(middle.unread)
        #expect(middle.labelIds.contains("UNREAD"))

        // RFC2047 subject decoded on the oldest row.
        #expect(page.threads[2].subject == "Café plans")

        // INBOX resolves without a labels.list round-trip.
        #expect(log.urls(containing: "/labels").isEmpty)
    }

    @Test func cursorPagingDropsExhaustedAccounts() async throws {
        let (home, scratch) = try makeTempMailHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        try writeMailTokens(["a@example.com": "ra"], to: locations.mokiTokensURL)

        let seeds: [String: [MailSeed]] = [
            "a@example.com": [
                MailSeed(
                    id: "t-a1", from: "Ana <ana@x.com>", subject: "One",
                    date: "Mon, 17 Nov 2025 10:00:00 +0000", snippet: "one",
                    labelIds: ["INBOX"], internalMs: "1763373600000")
            ]
        ]
        let log = MailRequestLog()
        installMailStub(log: log, seeds: seeds, listTokens: ["a@example.com": "tok-a"])
        defer { MailStubURLProtocol.clear() }

        let service = MailService(
            accounts: GoogleAccountsService(
                locations: locations, environment: mailClientEnv,
                session: makeMailStubSession()),
            session: makeMailStubSession())
        let first = try await service.listThreads(label: "INBOX")
        #expect(first.threads.map(\.id) == ["t-a1"])
        #expect(first.next == ["a@example.com": "tok-a"])

        // Second page: stub returns no ids and no token past the cursor.
        let second = try await service.listThreads(
            label: "INBOX", cursor: first.next)
        #expect(second.threads.isEmpty)
        #expect(second.next == nil)
        #expect(log.urls(containing: "pageToken=tok-a").count == 1)
    }

    @Test func bundleLabelResolvesAndCaches() async throws {
        let (home, scratch) = try makeTempMailHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        try writeMailTokens(["a@example.com": "ra"], to: locations.mokiTokensURL)

        let log = MailRequestLog()
        installMailStub(
            log: log,
            seeds: ["a@example.com": []],
            labels: [["id": "Label_7", "name": "psymail/commerce"]])
        defer { MailStubURLProtocol.clear() }

        let service = MailService(
            accounts: GoogleAccountsService(
                locations: locations, environment: mailClientEnv,
                session: makeMailStubSession()),
            session: makeMailStubSession())
        let first = try await service.listThreads(label: "psymail/commerce")
        let second = try await service.listThreads(label: "psymail/commerce")
        #expect(first.threads.isEmpty)
        #expect(second.threads.isEmpty)
        // One labels.list lookup total: the id is cached per account.
        #expect(log.urls(containing: "/labels").count == 1)
        // The resolved id travels as labelIds on the threads.list call.
        #expect(log.urls(containing: "labelIds=Label_7").count == 2)
    }

    @Test func accountFailuresAreReportedNotSilent() async throws {
        let (home, scratch) = try makeTempMailHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        try writeMailTokens(
            ["a@example.com": "ra", "bad@example.com": "rbad", "gone@example.com": "rgone"],
            to: locations.mokiTokensURL)

        let seeds: [String: [MailSeed]] = [
            "a@example.com": [
                MailSeed(
                    id: "t-a1", from: "Ana <ana@x.com>", subject: "Hi",
                    date: "Mon, 17 Nov 2025 10:00:00 +0000", snippet: "hi",
                    labelIds: ["INBOX"], internalMs: "1763373600000")
            ]
        ]
        // bad: threads.list 500s; gone: refresh dies with invalid_grant.
        MailStubURLProtocol.setHandler { request in
            let url = request.url!.absoluteString
            if url == "https://oauth2.googleapis.com/token" {
                let body = mailBodyData(of: request).flatMap { String(data: $0, encoding: .utf8) } ?? ""
                if body.contains("refresh_token=rgone") {
                    return (
                        mailHTTPResponse(url: request.url!, status: 400),
                        mailJSONData(["error": "invalid_grant"])
                    )
                }
                return (
                    mailHTTPResponse(url: request.url!, status: 200),
                    mailJSONData(["access_token": "ya29.mail", "expires_in": 3600])
                )
            }
            if url == "https://www.googleapis.com/oauth2/v2/userinfo" {
                return (
                    mailHTTPResponse(url: request.url!, status: 200),
                    mailJSONData([:])
                )
            }
            if url.contains("bad@example.com") && url.contains("/threads") {
                return (mailHTTPResponse(url: request.url!, status: 500), Data())
            }
            if url.contains("/threads/") {
                return (
                    mailHTTPResponse(url: request.url!, status: 200),
                    mailJSONData(metadataJSON(seeds["a@example.com"]![0]))
                )
            }
            if url.contains("/threads") {
                return (
                    mailHTTPResponse(url: request.url!, status: 200),
                    mailJSONData(["threads": [["id": "t-a1"]]])
                )
            }
            return (mailHTTPResponse(url: request.url!, status: 500), Data())
        }
        defer { MailStubURLProtocol.clear() }

        let service = MailService(
            accounts: GoogleAccountsService(
                locations: locations, environment: mailClientEnv,
                session: makeMailStubSession()),
            session: makeMailStubSession())
        let page = try await service.listThreads(label: "INBOX")
        #expect(page.threads.map(\.id) == ["t-a1"])
        #expect(page.unreachable == ["bad@example.com"])
        #expect(page.authExpired == ["gone@example.com"])
    }

    @Test func getThreadDecodesHTMLBody() async throws {
        let (home, scratch) = try makeTempMailHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        try writeMailTokens(["a@example.com": "ra"], to: locations.mokiTokensURL)

        let seed = MailSeed(
            id: "t-a1", from: "Ana <ana@x.com>", subject: "Hi",
            date: "Mon, 17 Nov 2025 10:00:00 +0000", snippet: "plain fallback",
            labelIds: ["INBOX"], internalMs: "1763373600000")
        let log = MailRequestLog()
        installMailStub(log: log, seeds: ["a@example.com": [seed]])
        defer { MailStubURLProtocol.clear() }

        let service = MailService(
            accounts: GoogleAccountsService(
                locations: locations, environment: mailClientEnv,
                session: makeMailStubSession()),
            session: makeMailStubSession())
        let detail = try await service.getThread(account: "a@example.com", id: "t-a1")
        #expect(detail.subject == "Hi")
        let message = try #require(detail.messages.first)
        #expect(message.html?.contains("<style>") == true)
        #expect(message.html?.contains("https://example.com/x") == true)
        #expect(message.text == "plain fallback")
        #expect(message.to == [EmailAddress(name: "Bubbles", address: "bubbles@example.com")])
        #expect(!message.isFromMe)
    }

    @Test func latin1PartDecodesToText() async throws {
        let client = GmailClient(session: makeMailStubSession()) { _ in "token" }
        // Bypass HTTP: exercise the MIME walker through a stubbed full
        // response with an ISO-8859-1 plain part.
        MailStubURLProtocol.setHandler { request in
            let latin1 = Data([0x43, 0x61, 0x66, 0xE9])  // "Café"
            let base64 = latin1.base64EncodedString()
            let body: [String: Any] = [
                "id": "t1",
                "messages": [
                    [
                        "id": "m1",
                        "labelIds": ["INBOX"],
                        "internalDate": "1763373600000",
                        "payload": [
                            "mimeType": "text/plain",
                            "headers": [
                                ["name": "From", "value": "a@x.com"],
                                ["name": "Subject", "value": "s"],
                                [
                                    "name": "Content-Type",
                                    "value": "text/plain; charset=iso-8859-1",
                                ],
                            ],
                            "body": ["data": base64],
                        ],
                    ] as [String: Any]
                ],
            ]
            return (
                mailHTTPResponse(url: request.url!, status: 200),
                mailJSONData(body)
            )
        }
        defer { MailStubURLProtocol.clear() }
        let detail = try await client.fetchDetail(account: "a@x.com", id: "t1")
        #expect(detail.messages.first?.text == "Café")
    }

    // MARK: - URL building from RPC input

    @Test func controlCharactersAreInvalidParams() async {
        // Validation runs before any token mint or network, so no stub is
        // needed: these must throw without touching the network.
        let client = GmailClient(session: makeMailStubSession()) { _ in "token" }
        await #expect(throws: InvalidParamsError.self) {
            try await client.fetchDetail(account: "a\u{01}@example.com", id: "t1")
        }
        await #expect(throws: InvalidParamsError.self) {
            try await client.fetchDetail(account: "a@example.com", id: "t\u{01}1")
        }
        await #expect(throws: InvalidParamsError.self) {
            _ = try await client.listThreadIDs(
                account: "a\u{01}@example.com", labelID: "INBOX", pageToken: nil)
        }
        await #expect(throws: InvalidParamsError.self) {
            _ = try await client.threadSummary(account: "a@example.com", id: "t\u{01}1")
        }
    }

    @Test func pathSegmentsArePercentEncoded() async throws {
        let log = MailRequestLog()
        MailStubURLProtocol.setHandler { request in
            log.append(request)
            return (
                mailHTTPResponse(url: request.url!, status: 200),
                mailJSONData(["threads": []] as [String: Any])
            )
        }
        defer { MailStubURLProtocol.clear() }
        let client = GmailClient(session: makeMailStubSession()) { _ in "token" }
        // A space and & in a label id must travel encoded, not split the URL.
        _ = try await client.listThreadIDs(
            account: "a@example.com", labelID: "A B&C", pageToken: nil)
        let urls = log.all.compactMap { $0.url?.absoluteString }
        #expect(urls.count == 1)
        #expect(urls[0].contains("labelIds=A%20B%26C"))
        #expect(urls[0].hasPrefix("https://gmail.googleapis.com/gmail/v1/users/"))
    }

    // MARK: - Malformed 200 responses

    /// Stub Gmail where one endpoint answers 200 with undecodable bytes.
    private func installGarbageStub(
        log: MailRequestLog,
        garbageInLabels: Bool = false,
        garbageInList: Bool = false,
        garbageInGet: Bool = false,
        seed: MailSeed
    ) {
        MailStubURLProtocol.setHandler { request in
            log.append(request)
            let url = request.url!.absoluteString
            if url == "https://oauth2.googleapis.com/token" {
                return (
                    mailHTTPResponse(url: request.url!, status: 200),
                    mailJSONData(["access_token": "ya29.mail", "expires_in": 3600])
                )
            }
            if url == "https://www.googleapis.com/oauth2/v2/userinfo" {
                return (
                    mailHTTPResponse(url: request.url!, status: 200),
                    mailJSONData([:])
                )
            }
            if url.contains("/labels") {
                if garbageInLabels {
                    return (
                        mailHTTPResponse(url: request.url!, status: 200),
                        Data("not json".utf8))
                }
                return (
                    mailHTTPResponse(url: request.url!, status: 200),
                    mailJSONData(["labels": [["id": "Label_7", "name": "psymail/commerce"]]])
                )
            }
            if url.contains("/threads/") {
                if garbageInGet {
                    return (
                        mailHTTPResponse(url: request.url!, status: 200),
                        Data("not json".utf8))
                }
                if url.contains("format=full") {
                    return (
                        mailHTTPResponse(url: request.url!, status: 200),
                        mailFullJSON(seed)
                    )
                }
                return (
                    mailHTTPResponse(url: request.url!, status: 200),
                    mailJSONData(metadataJSON(seed))
                )
            }
            if url.contains("/threads") {
                if garbageInList {
                    return (
                        mailHTTPResponse(url: request.url!, status: 200),
                        Data("not json".utf8))
                }
                return (
                    mailHTTPResponse(url: request.url!, status: 200),
                    mailJSONData(["threads": [["id": seed.id]]])
                )
            }
            return (mailHTTPResponse(url: request.url!, status: 500), Data())
        }
    }

    private func garbageSeed() -> MailSeed {
        MailSeed(
            id: "t-a1", from: "Ana <ana@x.com>", subject: "Hi",
            date: "Mon, 17 Nov 2025 10:00:00 +0000", snippet: "hi",
            labelIds: ["INBOX"], internalMs: "1763373600000")
    }

    private func makeGarbageService(home: URL) -> MailService {
        let locations = GoogleLocations(homeDirectoryURL: home)
        return MailService(
            accounts: GoogleAccountsService(
                locations: locations, environment: mailClientEnv,
                session: makeMailStubSession()),
            session: makeMailStubSession())
    }

    @Test func malformedThreadsListSurfacesUnreachable() async throws {
        let (home, scratch) = try makeTempMailHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeMailTokens(
            ["a@example.com": "ra"], to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)
        let log = MailRequestLog()
        installGarbageStub(log: log, garbageInList: true, seed: garbageSeed())
        defer { MailStubURLProtocol.clear() }
        let page = try await makeGarbageService(home: home).listThreads(label: "INBOX")
        #expect(page.threads.isEmpty)
        #expect(page.unreachable == ["a@example.com"])
        #expect(page.authExpired.isEmpty)
    }

    @Test func malformedLabelsListSurfacesUnreachable() async throws {
        let (home, scratch) = try makeTempMailHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeMailTokens(
            ["a@example.com": "ra"], to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)
        let log = MailRequestLog()
        installGarbageStub(log: log, garbageInLabels: true, seed: garbageSeed())
        defer { MailStubURLProtocol.clear() }
        let page = try await makeGarbageService(home: home)
            .listThreads(label: "psymail/commerce")
        #expect(page.threads.isEmpty)
        #expect(page.unreachable == ["a@example.com"])
        #expect(page.authExpired.isEmpty)
    }

    @Test func malformedThreadGetSurfacesUnreachableInList() async throws {
        let (home, scratch) = try makeTempMailHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeMailTokens(
            ["a@example.com": "ra"], to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)
        let log = MailRequestLog()
        installGarbageStub(log: log, garbageInGet: true, seed: garbageSeed())
        defer { MailStubURLProtocol.clear() }
        let page = try await makeGarbageService(home: home).listThreads(label: "INBOX")
        #expect(page.threads.isEmpty)
        #expect(page.unreachable == ["a@example.com"])
        #expect(page.authExpired.isEmpty)
    }

    @Test func malformedGetThreadThrowsUnreachable() async throws {
        let (home, scratch) = try makeTempMailHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeMailTokens(
            ["a@example.com": "ra"], to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)
        let log = MailRequestLog()
        installGarbageStub(log: log, garbageInGet: true, seed: garbageSeed())
        defer { MailStubURLProtocol.clear() }
        do {
            _ = try await makeGarbageService(home: home)
                .getThread(account: "a@example.com", id: "t-a1")
            Issue.record("expected AppError(unreachable)")
        } catch let error as AppError {
            #expect(error.code == "unreachable")
        }
    }

    @Test func missingLabelStaysZeroRowSkip() async throws {
        let (home, scratch) = try makeTempMailHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeMailTokens(
            ["a@example.com": "ra"], to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)
        // Valid labels list, but without the requested bundle name.
        let log = MailRequestLog()
        installGarbageStub(log: log, seed: garbageSeed())
        defer { MailStubURLProtocol.clear() }
        let page = try await makeGarbageService(home: home)
            .listThreads(label: "psymail/nope")
        #expect(page.threads.isEmpty)
        #expect(page.unreachable.isEmpty)
        #expect(page.authExpired.isEmpty)
        // The unknown label short-circuits before any threads.list call.
        #expect(log.urls(containing: "/threads?").isEmpty)
    }

    // MARK: - psymail import before getThread

    @Test func getThreadMergesPsymailTokensFirst() async throws {
        let (home, scratch) = try makeTempMailHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        let locations = GoogleLocations(homeDirectoryURL: home)
        // Fresh install: no Moki tokens at all. Tokens live only in
        // psymail-mini's file.
        try writeMailTokens(["a@example.com": "ra"], to: locations.psymailSandboxedTokensURL)
        let seed = garbageSeed()
        let log = MailRequestLog()
        installMailStub(log: log, seeds: ["a@example.com": [seed]])
        defer { MailStubURLProtocol.clear() }
        // No listAccounts call first: getThread must still find the token.
        let service = MailService(
            accounts: GoogleAccountsService(
                locations: locations, environment: mailClientEnv,
                session: makeMailStubSession()),
            session: makeMailStubSession())
        let detail = try await service.getThread(account: "a@example.com", id: "t-a1")
        #expect(detail.id == "t-a1")
        #expect(detail.subject == "Hi")
    }
}
