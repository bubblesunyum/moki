import Foundation

// MARK: - Fixture Drive recents
//
// Served when `MOKI_FIXTURES=1`: twelve canned Drive rows with real open
// URLs so the Docs lens UX lands before any network. No network, no file
// access.
//
// Canonical mirror: ids/titles/URLs match the renderer's DOC_FIXTURES drive
// section (lenses/docs/fixtures.ts) row-for-row — the two sides cannot share
// one file across the TS/Swift boundary, so the contract tests on both sides
// pin the same id lists. updatedAt is generated relative to now with the
// same minutes-ago offsets, so recency holds at any wall-clock time.

public enum DriveFixtures {
    /// (id, title, minutesAgo) — mirrors DOC_FIXTURES.drive.
    private static let seeds: [(id: String, title: String, minutesAgo: Double)] = [
        ("1a2b3c4d5e6f7g8h9i0j", "Launch plan v3", 12),
        ("2b3c4d5e6f7g8h9i0j1k", "Board deck — November", 48),
        ("3c4d5e6f7g8h9i0j1k2l", "Hiring rubric", 95),
        ("4d5e6f7g8h9i0j1k2l3m", "Pricing experiments", 150),
        ("5e6f7g8h9i0j1k2l3m4n", "Offsite notes", 220),
        ("6f7g8h9i0j1k2l3m4n5o", "Q4 budget", 300),
        ("7g8h9i0j1k2l3m4n5o6p", "Design critique thread", 410),
        ("8h9i0j1k2l3m4n5o6p7q", "API migration checklist", 520),
        ("9i0j1k2l3m4n5o6p7q8r", "Customer visit notes", 640),
        ("0j1k2l3m4n5o6p7q8r9s", "Brand refresh brief", 780),
        ("1k2l3m4n5o6p7q8r9s0t", "All-hands agenda", 900),
        ("2l3m4n5o6p7q8r9s0t1u", "Reading list", 1100),
    ]

    public static func listFiles(now: Date = Date()) -> DriveFilesPage {
        DriveFilesPage(
            items: seeds.map {
                DocItem(
                    id: $0.id, title: $0.title, source: .drive,
                    updatedAt: iso8601String(now.addingTimeInterval(-$0.minutesAgo * 60)),
                    openUrl: "https://drive.google.com/file/d/\($0.id)/view")
            },
            unreachable: [], authExpired: [])
    }
}
