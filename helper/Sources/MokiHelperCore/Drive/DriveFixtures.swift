import Foundation

// MARK: - Fixture Drive recents
//
// Served when `MOKI_FIXTURES=1`: twelve canned Drive rows with real
// open URLs so the Docs lens UX lands before any network. No network,
// no file access.

public enum DriveFixtures {
    public static func listFiles() -> DriveFilesPage {
        let seeds: [(id: String, title: String, updatedAt: String, openUrl: String)] = [
            ("drive-f1", "Q3 planning doc", "2026-11-20T16:05:00.000Z",
             "https://docs.google.com/document/d/drive-f1/edit"),
            ("drive-f2", "Garden budget 2026", "2026-11-20T14:12:00.000Z",
             "https://docs.google.com/spreadsheets/d/drive-f2/edit"),
            ("drive-f3", "Physio exercises", "2026-11-20T11:48:00.000Z",
             "https://drive.google.com/file/d/drive-f3/view"),
            ("drive-f4", "Moki lens notes", "2026-11-19T22:03:00.000Z",
             "https://docs.google.com/document/d/drive-f4/edit"),
            ("drive-f5", "Sprint retro deck", "2026-11-19T18:30:00.000Z",
             "https://docs.google.com/presentation/d/drive-f5/edit"),
            ("drive-f6", "Lease renewal scan", "2026-11-19T09:15:00.000Z",
             "https://drive.google.com/file/d/drive-f6/view"),
            ("drive-f7", "Dinner party list", "2026-11-18T20:41:00.000Z",
             "https://docs.google.com/document/d/drive-f7/edit"),
            ("drive-f8", "Travel itinerary — Kyoto", "2026-11-18T12:00:00.000Z",
             "https://docs.google.com/document/d/drive-f8/edit"),
            ("drive-f9", "Invoices November", "2026-11-17T15:26:00.000Z",
             "https://docs.google.com/spreadsheets/d/drive-f9/edit"),
            ("drive-f10", "Bike repair quote", "2026-11-17T08:54:00.000Z",
             "https://drive.google.com/file/d/drive-f10/view"),
            ("drive-f11", "Book club picks", "2026-11-16T19:37:00.000Z",
             "https://docs.google.com/document/d/drive-f11/edit"),
            ("drive-f12", "Apartment inventory", "2026-11-16T10:02:00.000Z",
             "https://docs.google.com/spreadsheets/d/drive-f12/edit"),
        ]
        return DriveFilesPage(
            items: seeds.map {
                DocItem(
                    id: $0.id, title: $0.title, source: .drive,
                    updatedAt: $0.updatedAt, openUrl: $0.openUrl)
            },
            unreachable: [], authExpired: [])
    }
}
