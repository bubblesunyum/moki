import Foundation
import Testing

@testable import MokiHelperCore

// MARK: - Stubs

private final class CalendarStubURLProtocol: URLProtocol {
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

private final class CalendarRequestLog: @unchecked Sendable {
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

private func makeCalendarStubSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [CalendarStubURLProtocol.self]
    return URLSession(configuration: config)
}

private func calendarHTTPResponse(url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

private func calendarJSONData(_ object: Any) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
}

private let calendarClientEnv = [
    "MOKI_GOOGLE_CLIENT_ID": "cid",
    "MOKI_GOOGLE_CLIENT_SECRET": "s",
]

private func makeTempCalendarHome() throws -> (home: URL, scratch: URL) {
    let scratch = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString)
    let home = scratch.appendingPathComponent("home")
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    return (home, scratch)
}

private func writeCalendarTokens(_ map: [String: String], to url: URL) throws {
    try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONEncoder().encode(map).write(to: url)
}

/// Stub token refresh + userinfo (200/ok), then route Calendar API calls to
/// `calendarHandler`.
private func installCalendarStub(
    log: CalendarRequestLog,
    calendarHandler: @escaping @Sendable (URLRequest) -> (HTTPURLResponse, Data)
) {
    CalendarStubURLProtocol.setHandler { request in
        log.append(request)
        let url = request.url!.absoluteString
        if url == "https://oauth2.googleapis.com/token" {
            return (
                calendarHTTPResponse(url: request.url!, status: 200),
                calendarJSONData(["access_token": "ya29.cal", "expires_in": 3600])
            )
        }
        if url == "https://www.googleapis.com/oauth2/v2/userinfo" {
            return (
                calendarHTTPResponse(url: request.url!, status: 200),
                calendarJSONData(["name": "Cal User"])
            )
        }
        return calendarHandler(request)
    }
}

private func calendarBodyData(of request: URLRequest) -> Data? {
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

private func calendarListJSON(_ items: [[String: Any]]) -> Data {
    calendarJSONData(["items": items])
}

private func timedItem(
    id: String, summary: String, start: String, end: String,
    status: String = "confirmed"
) -> [String: Any] {
    [
        "id": id, "status": status, "summary": summary,
        "start": ["dateTime": start], "end": ["dateTime": end],
    ]
}

@Suite(.serialized)
struct CalendarTests {
    // MARK: - URL building

    @Test func listURLHitsPrimaryWithExpansionParams() throws {
        let url = try calendarEventsURL(
            timeMin: "2026-11-20T00:00:00Z", timeMax: "2026-11-21T00:00:00Z")
        let absolute = url.absoluteString
        #expect(
            absolute.hasPrefix(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events?"))
        #expect(absolute.contains("singleEvents=true"))
        #expect(absolute.contains("orderBy=startTime"))
        #expect(absolute.contains("timeMin=2026-11-20T00:00:00Z"))
        #expect(absolute.contains("timeMax=2026-11-21T00:00:00Z"))
    }

    @Test func emptyBoundsAreInvalidParams() {
        #expect(throws: InvalidParamsError.self) {
            try calendarEventsURL(timeMin: "", timeMax: "2026-11-21T00:00:00Z")
        }
        #expect(throws: InvalidParamsError.self) {
            try calendarEventsURL(timeMin: "2026-11-20T00:00:00Z", timeMax: "")
        }
        #expect(throws: InvalidParamsError.self) {
            try calendarEventsURL(timeMin: "2026-11-20T00:00:00Z\u{01}", timeMax: "x")
        }
    }

    // MARK: - Parsing

    @Test func mapsTimedAllDayAndUntitledItems() {
        let timed = calendarEvent(
            from: GCalEventItem(
                id: "e1", status: "confirmed", summary: "Standup",
                start: GCalEventDate(dateTime: "2026-11-20T09:30:00Z", date: nil),
                end: GCalEventDate(dateTime: "2026-11-20T10:00:00Z", date: nil)),
            account: "a@example.com")
        #expect(
            timed
                == CalendarEvent(
                    id: "e1", title: "Standup",
                    start: "2026-11-20T09:30:00Z", end: "2026-11-20T10:00:00Z",
                    calendar: "primary", account: "a@example.com"))

        // All-day items carry `date`, not `dateTime`.
        let allDay = calendarEvent(
            from: GCalEventItem(
                id: "e2", status: "confirmed", summary: nil,
                start: GCalEventDate(dateTime: nil, date: "2026-11-20"),
                end: GCalEventDate(dateTime: nil, date: "2026-11-21")),
            account: "a@example.com")
        #expect(allDay?.title == "(No title)")
        #expect(allDay?.start == "2026-11-20")
        #expect(allDay?.end == "2026-11-21")

        // Cancelled events and id-less/start-less items are skipped.
        #expect(
            calendarEvent(
                from: GCalEventItem(
                    id: "e3", status: "cancelled", summary: "Gone",
                    start: GCalEventDate(dateTime: "2026-11-20T10:00:00Z", date: nil),
                    end: nil),
                account: "a@example.com") == nil)
        #expect(
            calendarEvent(
                from: GCalEventItem(
                    id: nil, status: "confirmed", summary: "No id",
                    start: GCalEventDate(dateTime: "2026-11-20T10:00:00Z", date: nil),
                    end: nil),
                account: "a@example.com") == nil)
        #expect(
            calendarEvent(
                from: GCalEventItem(
                    id: "e4", status: "confirmed", summary: "No start",
                    start: nil, end: nil),
                account: "a@example.com") == nil)
    }

    @Test func statusMapping() {
        #expect((calendarStatusError(status: 401, account: "a") as? AppError)?.code == "auth_expired")
        #expect((calendarStatusError(status: 403, account: "a") as? AppError)?.code == "auth_expired")
        #expect((calendarStatusError(status: 500, account: "a") as? AppError)?.code == "unreachable")
    }

    // MARK: - Live listing over stubbed HTTP

    private func makeService(home: URL) -> CalendarService {
        let locations = GoogleLocations(homeDirectoryURL: home)
        return CalendarService(
            accounts: GoogleAccountsService(
                locations: locations, environment: calendarClientEnv,
                session: makeCalendarStubSession()),
            session: makeCalendarStubSession())
    }

    @Test func listsAcrossAccountsMergedByStart() async throws {
        let (home, scratch) = try makeTempCalendarHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeCalendarTokens(
            ["a@example.com": "ra", "b@example.com": "rb"],
            to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)

        let log = CalendarRequestLog()
        CalendarStubURLProtocol.setHandler { request in
            log.append(request)
            let url = request.url!.absoluteString
            if url == "https://oauth2.googleapis.com/token" {
                // Per-account tokens: both accounts fetch the same primary
                // URL, so the Bearer value is what tells them apart.
                let body = calendarBodyData(of: request).flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let token = body.contains("refresh_token=rb") ? "ya29.b" : "ya29.a"
                return (
                    calendarHTTPResponse(url: request.url!, status: 200),
                    calendarJSONData(["access_token": token, "expires_in": 3600])
                )
            }
            if url == "https://www.googleapis.com/oauth2/v2/userinfo" {
                return (
                    calendarHTTPResponse(url: request.url!, status: 200),
                    calendarJSONData(["name": "Cal User"])
                )
            }
            let auth = request.value(forHTTPHeaderField: "Authorization") ?? ""
            #expect(auth == "Bearer ya29.a" || auth == "Bearer ya29.b")
            if auth == "Bearer ya29.a" {
                return (
                    calendarHTTPResponse(url: request.url!, status: 200),
                    calendarListJSON([
                        timedItem(
                            id: "late", summary: "Late",
                            start: "2026-11-20T15:30:00Z", end: "2026-11-20T16:30:00Z")
                    ]))
            }
            return (
                calendarHTTPResponse(url: request.url!, status: 200),
                calendarListJSON([
                    timedItem(
                        id: "early", summary: "Early",
                        start: "2026-11-20T09:30:00Z", end: "2026-11-20T10:00:00Z")
                ]))
        }
        defer { CalendarStubURLProtocol.clear() }

        let page = try await makeService(home: home).listEvents(
            timeMin: "2026-11-20T00:00:00Z", timeMax: "2026-11-21T00:00:00Z")
        #expect(page.events.map(\.id) == ["early", "late"])
        #expect(page.events.map(\.account) == ["b@example.com", "a@example.com"])
        #expect(page.unreachable.isEmpty)
        #expect(page.authExpired.isEmpty)

        let calls = log.urls(containing: "calendar/v3/calendars/primary/events")
        #expect(calls.count == 2)
        #expect(calls.allSatisfy { $0.url?.absoluteString.contains("singleEvents=true") == true })
    }

    @Test func perAccountFailuresAreReportedNotSilent() async throws {
        let (home, scratch) = try makeTempCalendarHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeCalendarTokens(
            ["a@example.com": "ra", "gone@example.com": "rgone", "bad@example.com": "rbad"],
            to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)

        let log = CalendarRequestLog()
        CalendarStubURLProtocol.setHandler { request in
            log.append(request)
            let url = request.url!.absoluteString
            if url == "https://oauth2.googleapis.com/token" {
                let body = calendarBodyData(of: request).flatMap { String(data: $0, encoding: .utf8) } ?? ""
                if body.contains("refresh_token=rgone") {
                    return (
                        calendarHTTPResponse(url: request.url!, status: 400),
                        calendarJSONData(["error": "invalid_grant"])
                    )
                }
                if body.contains("refresh_token=rbad") {
                    return (calendarHTTPResponse(url: request.url!, status: 500), Data())
                }
                return (
                    calendarHTTPResponse(url: request.url!, status: 200),
                    calendarJSONData(["access_token": "ya29.cal", "expires_in": 3600])
                )
            }
            if url == "https://www.googleapis.com/oauth2/v2/userinfo" {
                return (
                    calendarHTTPResponse(url: request.url!, status: 200),
                    calendarJSONData([:])
                )
            }
            // a@example.com's Calendar call 403s: a grant that died after
            // the profile check still lands in authExpired.
            return (calendarHTTPResponse(url: request.url!, status: 403), Data())
        }
        defer { CalendarStubURLProtocol.clear() }

        let page = try await makeService(home: home).listEvents(
            timeMin: "2026-11-20T00:00:00Z", timeMax: "2026-11-21T00:00:00Z")
        #expect(page.events.isEmpty)
        #expect(page.unreachable == ["bad@example.com"])
        #expect(page.authExpired == ["a@example.com", "gone@example.com"])
    }

    @Test func garbageListBodyIsUnreachable() async throws {
        let (home, scratch) = try makeTempCalendarHome()
        defer { try? FileManager.default.removeItem(at: scratch) }
        try writeCalendarTokens(
            ["a@example.com": "ra"],
            to: GoogleLocations(homeDirectoryURL: home).mokiTokensURL)

        let log = CalendarRequestLog()
        installCalendarStub(log: log) { request in
            (calendarHTTPResponse(url: request.url!, status: 200), Data("not json".utf8))
        }
        defer { CalendarStubURLProtocol.clear() }

        let page = try await makeService(home: home).listEvents(
            timeMin: "2026-11-20T00:00:00Z", timeMax: "2026-11-21T00:00:00Z")
        #expect(page.events.isEmpty)
        #expect(page.unreachable == ["a@example.com"])
        #expect(page.authExpired.isEmpty)
    }

    // MARK: - Fixtures

    private func fixtureStart(of event: CalendarEvent) -> Date {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime]
        return parser.date(from: event.start)!
    }

    @Test func fixtureReturnsFiveFigmaEventsAtLocalWorkingHours() {
        let page = CalendarFixtures.listEvents(
            timeMin: "2026-11-20T00:00:00Z", timeMax: "2026-11-21T00:00:00Z")
        #expect(page.events.map(\.title) == ["Standup", "QWELL", "Lunch", "Physio", "Garden"])
        let calendar = Calendar.current
        let hours = page.events.map { event -> String in
            let parts = calendar.dateComponents([.hour, .minute], from: fixtureStart(of: event))
            return "\(parts.hour!):\(parts.minute!)"
        }
        #expect(hours == ["9:30", "12:0", "13:15", "15:30", "18:30"])
        #expect(page.events.allSatisfy { $0.calendar == "primary" })
        #expect(page.unreachable.isEmpty)
        #expect(page.authExpired.isEmpty)
    }

    @Test func fixtureStaysOnTheRequestedLocalDayWestOfUTC() {
        // Midnight PST Nov 20: Standup must read 9:30 AM PST (17:30Z),
        // not 09:30Z (1:30 AM PST).
        var pacific = Calendar(identifier: .gregorian)
        pacific.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        let page = CalendarFixtures.listEvents(
            timeMin: "2026-11-20T08:00:00Z", timeMax: "2026-11-21T08:00:00Z",
            calendar: pacific)
        #expect(page.events[0].start == "2026-11-20T17:30:00Z")
        #expect(page.events[0].end == "2026-11-20T18:00:00Z")
        let days = Set(page.events.map {
            pacific.dateComponents([.year, .month, .day], from: fixtureStart(of: $0))
        })
        #expect(days.count == 1)
        #expect(days.first?.day == 20)
    }

    @Test func fixtureStaysOnTheRequestedLocalDayEastOfUTC() {
        // 11:00Z Nov 19 is midnight NZDT Nov 20: all five events must land
        // on local Nov 20, not vanish onto the previous day.
        var auckland = Calendar(identifier: .gregorian)
        auckland.timeZone = TimeZone(identifier: "Pacific/Auckland")!
        let page = CalendarFixtures.listEvents(
            timeMin: "2026-11-19T11:00:00Z", timeMax: "2026-11-20T11:00:00Z",
            calendar: auckland)
        #expect(page.events[0].start == "2026-11-19T20:30:00Z")
        let days = Set(page.events.map {
            auckland.dateComponents([.year, .month, .day], from: fixtureStart(of: $0))
        })
        #expect(days.count == 1)
        #expect(days.first?.day == 20)
        #expect(days.first?.month == 11)
    }

    @Test func fixtureFallsBackToTodayOnBadBounds() {
        let page = CalendarFixtures.listEvents(timeMin: "garbage", timeMax: "")
        #expect(page.events.count == 5)
        let today = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        #expect(
            page.events.allSatisfy {
                Calendar.current.dateComponents(
                    [.year, .month, .day], from: fixtureStart(of: $0)) == today
            })
    }
}
