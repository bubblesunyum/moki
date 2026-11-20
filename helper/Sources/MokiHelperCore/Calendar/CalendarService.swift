import Foundation

// MARK: - Calendar domain models
//
// JSON shapes here must match `packages/protocol` exactly (dates are
// ISO8601 strings, or `YYYY-MM-DD` for all-day events straight from the
// Calendar API). The renderer only talks to the helper through
// `window.moki.call`, so change both sides together.

public struct CalendarEvent: Codable, Sendable, Equatable {
    public var id: String
    public var title: String
    /// ISO8601 date-time string (`YYYY-MM-DD` for all-day events).
    public var start: String
    public var end: String
    /// Which calendar on the account this came from (`"primary"` — the
    /// service only lists the primary calendar).
    public var calendar: String
    public var account: String?

    public init(
        id: String, title: String, start: String, end: String,
        calendar: String, account: String? = nil
    ) {
        self.id = id
        self.title = title
        self.start = start
        self.end = end
        self.calendar = calendar
        self.account = account
    }
}

/// Merged page across accounts: a failed account lands in
/// `unreachable`/`authExpired`, never silently as "no events".
public struct CalendarEventsPage: Codable, Sendable, Equatable {
    public var events: [CalendarEvent]
    public var unreachable: [String]
    public var authExpired: [String]

    public init(events: [CalendarEvent], unreachable: [String], authExpired: [String]) {
        self.events = events
        self.unreachable = unreachable
        self.authExpired = authExpired
    }
}

// MARK: - RPC params

public struct ListCalendarEventsParams: Codable, Sendable {
    /// RFC3339 lower bound (inclusive), e.g. `2026-11-20T00:00:00Z`.
    public var timeMin: String
    /// RFC3339 upper bound (exclusive).
    public var timeMax: String

    public init(timeMin: String, timeMax: String) {
        self.timeMin = timeMin
        self.timeMax = timeMax
    }
}

// MARK: - Merged calendar service
//
// `listEvents` lists the primary calendar across every signed-in account
// and merges start-time-first. Per-account failures never fail the page —
// they land in `unreachable`/`authExpired` — while a missing OAuth client
// (`auth_unconfigured`) still throws. Accounts are fetched sequentially:
// no TaskGroup, which has hung this codebase's tests before.

public struct CalendarService: Sendable {
    private let accounts: GoogleAccountsService
    private let session: URLSession

    public init(accounts: GoogleAccountsService, session: URLSession = .shared) {
        self.accounts = accounts
        self.session = session
    }

    public func listEvents(timeMin: String, timeMax: String) async throws -> CalendarEventsPage {
        let listed = try await accounts.listAccounts()
        var events: [CalendarEvent] = []
        var unreachable = listed.accounts.filter { $0.status == .unreachable }.map(\.address)
        var authExpired = listed.accounts.filter { $0.status == .authExpired }.map(\.address)
        // Validate before minting tokens: RPC-supplied bounds must never
        // read as a Calendar outage.
        let url = try calendarEventsURL(timeMin: timeMin, timeMax: timeMax)
        for account in listed.accounts where account.status == .ok {
            do {
                let token = try await accounts.accessToken(for: account.address)
                events.append(
                    contentsOf: try await fetchEvents(
                        url: url, account: account.address, token: token))
            } catch let error as AppError where error.code == "auth_expired" {
                authExpired.append(account.address)
            } catch {
                unreachable.append(account.address)
            }
        }
        events.sort {
            let left = calendarSortDate($0.start)
            let right = calendarSortDate($1.start)
            if left != right { return left < right }
            return $0.id < $1.id
        }
        return CalendarEventsPage(
            events: events,
            unreachable: unreachable.sorted(), authExpired: authExpired.sorted())
    }

    private func fetchEvents(url: URL, account: String, token: String) async throws -> [CalendarEvent] {
        var request = URLRequest(url: url)
        request.timeoutInterval = googleRequestTimeout
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AppError(
                code: "unreachable",
                message: "Calendar request failed: network unavailable.")
        }
        guard let http = response as? HTTPURLResponse else {
            throw AppError(code: "unreachable", message: "Calendar request failed.")
        }
        guard http.statusCode == 200 else {
            throw calendarStatusError(status: http.statusCode, account: account)
        }
        guard let list = try? JSONDecoder().decode(GCalEventList.self, from: data) else {
            throw AppError(
                code: "unreachable", message: "Calendar returned an unexpected response.")
        }
        return (list.items ?? []).compactMap { calendarEvent(from: $0, account: account) }
    }
}

// MARK: - RPC handlers

public func calendarListEventsHandler(service: CalendarService) -> @Sendable (JSONValue) async throws -> CalendarEventsPage {
    return { params in
        let request = try decodeRpcParams(params, as: ListCalendarEventsParams.self)
        return try await service.listEvents(timeMin: request.timeMin, timeMax: request.timeMax)
    }
}

public func fixtureCalendarListEventsHandler() -> @Sendable (JSONValue) async throws -> CalendarEventsPage {
    return { params in
        let request = try decodeRpcParams(params, as: ListCalendarEventsParams.self)
        return CalendarFixtures.listEvents(timeMin: request.timeMin, timeMax: request.timeMax)
    }
}

// MARK: - Calendar API wire shapes

struct GCalEventDate: Decodable {
    /// RFC3339 date-time for timed events.
    var dateTime: String?
    /// `YYYY-MM-DD` for all-day events.
    var date: String?
}

struct GCalEventItem: Decodable {
    var id: String?
    var status: String?
    var summary: String?
    var start: GCalEventDate?
    var end: GCalEventDate?
}

struct GCalEventList: Decodable {
    var items: [GCalEventItem]?
}

/// Map one API item to a `CalendarEvent`. Nil for cancelled events and
/// items with no id or start — the list skips those rather than handing
/// the renderer an undated row.
func calendarEvent(from item: GCalEventItem, account: String) -> CalendarEvent? {
    guard item.status != "cancelled",
        let id = item.id, !id.isEmpty
    else { return nil }
    guard let start = item.start?.dateTime ?? item.start?.date, !start.isEmpty else { return nil }
    let end = item.end?.dateTime ?? item.end?.date ?? start
    return CalendarEvent(
        id: id, title: item.summary ?? "(No title)",
        start: start, end: end.isEmpty ? start : end,
        calendar: "primary", account: account)
}

// MARK: - Status mapping

/// 401/403 means the grant died (`auth_expired`); anything else is a
/// transient Calendar failure (`unreachable`).
func calendarStatusError(status: Int, account: String) -> Error {
    switch status {
    case 401, 403:
        return AppError(
            code: "auth_expired",
            message: "Google authorization expired for \(account). Sign in again to reconnect.")
    default:
        return AppError(
            code: "unreachable",
            message: "Calendar request failed (HTTP \(status)).")
    }
}

// MARK: - URL building

/// Build the primary-calendar `events.list` URL (`singleEvents` expanded,
/// ordered by start) from RPC-supplied bounds. Control characters (never
/// valid in an RFC3339 bound) and empty bounds are caller bugs →
/// `InvalidParamsError`, never a crash and never misreported as a
/// Calendar outage. `URLComponents` percent-encodes the query values.
func calendarEventsURL(timeMin: String, timeMax: String) throws -> URL {
    guard !timeMin.isEmpty, !timeMax.isEmpty,
        timeMin.rangeOfCharacter(from: .controlCharacters) == nil,
        timeMax.rangeOfCharacter(from: .controlCharacters) == nil
    else {
        throw InvalidParamsError("Invalid calendar request.")
    }
    var components = URLComponents()
    components.scheme = "https"
    components.host = "www.googleapis.com"
    components.percentEncodedPath = "/calendar/v3/calendars/primary/events"
    components.queryItems = [
        URLQueryItem(name: "singleEvents", value: "true"),
        URLQueryItem(name: "orderBy", value: "startTime"),
        URLQueryItem(name: "maxResults", value: "50"),
        URLQueryItem(name: "timeMin", value: timeMin),
        URLQueryItem(name: "timeMax", value: timeMax),
    ]
    guard let url = components.url else {
        throw InvalidParamsError("Invalid calendar request.")
    }
    return url
}

// MARK: - Sorting

/// Parse back a start string for merge sorting. Handles fractional
/// seconds (the plain mail formatter doesn't); malformed strings sort
/// first via the distant past so the sort stays total.
func calendarSortDate(_ iso: String) -> Date {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: iso) { return date }
    return mailSortDate(iso)
}
