import Foundation

// MARK: - Fixture calendar
//
// Served when `MOKI_FIXTURES=1`: five canned day events matching the Figma
// day view (Standup 9:30, QWELL 12:00, Lunch 1:15, Physio 3:30, Garden
// 6:30), placed at local wall-clock hours on the day named by `timeMin` so
// any day renders. No network, no file access.
//
// The instants are derived from the *local* day of the request: stamping
// local wall-clock times with `Z` shifts the day in every non-UTC timezone
// (PST reads Standup at 1:30 AM; east of UTC the events fall off the local
// day entirely).

public enum CalendarFixtures {
    public static func listEvents(timeMin: String, timeMax: String) -> CalendarEventsPage {
        listEvents(timeMin: timeMin, timeMax: timeMax, calendar: .current)
    }

    /// Deterministic overload for tests: `calendar` supplies the local
    /// timezone for wall-clock placement.
    static func listEvents(timeMin: String, timeMax: String, calendar: Calendar) -> CalendarEventsPage {
        _ = timeMax
        let day = localDay(from: timeMin, calendar: calendar)
            ?? calendar.dateComponents([.year, .month, .day], from: Date())
        func at(_ hour: Int, _ minute: Int, lengthMinutes: Int) -> (start: String, end: String) {
            var components = day
            components.hour = hour
            components.minute = minute
            components.second = 0
            let start = calendar.date(from: components) ?? Date()
            let end = start.addingTimeInterval(TimeInterval(lengthMinutes * 60))
            return (utcString(start), utcString(end))
        }
        let seeds: [(id: String, title: String, hour: Int, minute: Int, lengthMinutes: Int)] = [
            ("cal-f1", "Standup", 9, 30, 30),
            ("cal-f2", "QWELL", 12, 0, 60),
            ("cal-f3", "Lunch", 13, 15, 45),
            ("cal-f4", "Physio", 15, 30, 60),
            ("cal-f5", "Garden", 18, 30, 60),
        ]
        return CalendarEventsPage(
            events: seeds.map { seed in
                let window = at(seed.hour, seed.minute, lengthMinutes: seed.lengthMinutes)
                return CalendarEvent(
                    id: seed.id, title: seed.title, start: window.start, end: window.end,
                    calendar: "primary", account: fixturePersonalAccount)
            },
            unreachable: [], authExpired: [])
    }

    /// The local year/month/day of the instant named by an RFC3339 bound
    /// (a bare `YYYY-MM-DD` names that calendar date as-is), or nil when
    /// the bound is garbage — callers fall back to today.
    static func localDay(from timeMin: String, calendar: Calendar) -> DateComponents? {
        if let instant = fixtureInstant(from: timeMin) {
            return calendar.dateComponents([.year, .month, .day], from: instant)
        }
        let parts = timeMin.split(separator: "-").compactMap { Int($0) }
        if parts.count == 3, (1...9999).contains(parts[0]),
            (1...12).contains(parts[1]), (1...31).contains(parts[2])
        {
            return DateComponents(year: parts[0], month: parts[1], day: parts[2])
        }
        return nil
    }

    /// Parse an RFC3339 bound (with or without fractional seconds) to an
    /// instant.
    static func fixtureInstant(from timeMin: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: timeMin) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: timeMin)
    }

    /// Emit an instant as UTC `...Z` for the wire.
    static func utcString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }
}
