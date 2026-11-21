import Foundation

// MARK: - Docs dispatcher (`docs.listRecents`)
//
// The renderer calls one method per section — `docs.listRecents {source}` —
// and expects a `DocsListRecentsResult` envelope (`items` + `unreachable` +
// `signedOut`). The helper previously served Drive and Notion under separate
// method names (`docs.listDrive`, `notion.listRecents`) with different
// shapes, so the live renderer path always errored into fixture-partial.
// This dispatcher unifies them: Drive reuses `DriveService.listFiles`,
// Notion reuses `NotionService.listRecents` (hosted MCP first, legacy
// integration token as fallback), and Craft reuses
// `CraftService.listRecents` (Connect URL listing) when a service is
// wired in.
//
// Tokens never leave the helper: OAuth grants and any legacy credentials
// stay in the Keychain behind their services, and only rows + status cross
// the RPC boundary. No TaskGroup anywhere on this path (see
// swift-taskgroup-timeout trap): Drive lists accounts sequentially inside
// `DriveService`, and each provider is one serial request behind its own
// limiter.

/// `docs.listRecents` params: which Docs section to serve.
public struct DocsListRecentsParams: Codable, Sendable {
    public var source: DocSource

    public init(source: DocSource) {
        self.source = source
    }
}

/// Per-section envelope the renderer (`useDocsRecents`) branches on:
/// `signedOut` empties the section into its sign-in state, `unreachable`
/// renders the one-line partial notice over whatever rows survived.
public struct DocsListRecentsResult: Codable, Sendable, Equatable {
    public var items: [DocItem]
    public var unreachable: Bool
    public var signedOut: Bool

    public init(items: [DocItem], unreachable: Bool, signedOut: Bool) {
        self.items = items
        self.unreachable = unreachable
        self.signedOut = signedOut
    }
}

public struct DocsRecentsService: Sendable {
    private let drive: DriveService
    private let notion: NotionService
    private let craft: CraftService?

    public init(drive: DriveService, notion: NotionService, craft: CraftService? = nil) {
        self.drive = drive
        self.notion = notion
        self.craft = craft
    }

    /// Serve one section. Never throws: every failure mode lands in the
    /// envelope so the lens renders rows, partial, or sign-in — never a
    /// blank RPC error.
    public func listRecents(source: DocSource) async -> DocsListRecentsResult {
        switch source {
        case .drive:
            return await driveRecents()
        case .notion:
            return await notionRecents()
        case .craft:
            // Served by the Craft Connect API when a service is wired in
            // (rows are already `DocItem`s — identity, no mapping).
            // Without one the section shows its partial state instead of
            // fake rows.
            if let craft {
                return await craft.listRecents()
            }
            return DocsListRecentsResult(items: [], unreachable: true, signedOut: false)
        }
    }

    /// Drive rows are already `DocItem`-shaped with `source == .drive`:
    /// pass them through, folding the per-account `unreachable`/`authExpired`
    /// lists into the section flags. Contract: never send rows with
    /// `signedOut` — an expired grant alongside healthy rows is a partial
    /// (rows + `unreachable`); only a fully empty page with expired grants
    /// signs out.
    private func driveRecents() async -> DocsListRecentsResult {
        do {
            let page = try await drive.listFiles()
            let signedOut = page.items.isEmpty && !page.authExpired.isEmpty
            return DocsListRecentsResult(
                items: page.items,
                unreachable: signedOut || !page.authExpired.isEmpty || !page.unreachable.isEmpty,
                signedOut: signedOut)
        } catch {
            return DocsListRecentsResult(items: [], unreachable: true, signedOut: false)
        }
    }

    /// Map `NotionService` search results to `DocItem`s (`source == .notion`,
    /// `updatedAt` from `last_edited_time`, `openUrl` from the page URL with
    /// a `notion.so` fallback). Auth states empty the section into sign-in;
    /// anything else (`unreachable`, `rate_limited` throws) is a partial.
    private func notionRecents() async -> DocsListRecentsResult {
        do {
            let result = try await notion.listRecents()
            switch result.status {
            case .ok:
                return DocsListRecentsResult(
                    items: result.items.map(notionDocItem(from:)),
                    unreachable: false, signedOut: false)
            case .signedOut, .authExpired:
                return DocsListRecentsResult(items: [], unreachable: false, signedOut: true)
            }
        } catch {
            return DocsListRecentsResult(items: [], unreachable: true, signedOut: false)
        }
    }
}

/// Map one Notion row to the shared `DocItem` shape. Rows always carry an
/// id (id-less search results are skipped upstream), so only the URL needs
/// a fallback.
func notionDocItem(from recent: NotionRecent) -> DocItem {
    let openUrl: String
    if let url = recent.url, !url.isEmpty {
        openUrl = url
    } else {
        openUrl = "https://www.notion.so/\(recent.id)"
    }
    return DocItem(
        id: recent.id, title: recent.title, source: .notion,
        updatedAt: recent.lastEditedTime, openUrl: openUrl)
}

// MARK: - RPC handlers

public func docsListRecentsHandler(service: DocsRecentsService) -> @Sendable (JSONValue) async throws
    -> DocsListRecentsResult
{
    return { params in
        let request = try decodeRpcParams(params, as: DocsListRecentsParams.self)
        return await service.listRecents(source: request.source)
    }
}

/// Canned per-source rows for `MOKI_FIXTURES=1`: no network, no Keychain
/// touch. Drive and Notion mirror the existing fixture builders; Craft
/// serves the canonical `DocsFixtures` table (same `s/…` rows the wired
/// `CraftService` serves under fixtures) so pins and byte-agreement hold
/// on every path.
public func fixtureDocsListRecentsHandler() -> @Sendable (JSONValue) async throws -> DocsListRecentsResult {
    return { params in
        let request = try decodeRpcParams(params, as: DocsListRecentsParams.self)
        switch request.source {
        case .drive:
            let page = DriveFixtures.listFiles()
            return DocsListRecentsResult(items: page.items, unreachable: false, signedOut: false)
        case .notion:
            // Fixture Notion auth is hermetic in-memory state (see
            // NotionFixtureAuthState, flipped by the fixture branches of
            // notion.setToken/signOut): a fixtures sign-out empties this
            // section into its sign-in state instead of snapping back to
            // rows.
            if await NotionFixtureAuthState.shared.isSignedOut() {
                return DocsListRecentsResult(items: [], unreachable: false, signedOut: true)
            }
            return DocsListRecentsResult(
                items: notionFixtureRecents().map(notionDocItem(from:)),
                unreachable: false, signedOut: false)
        case .craft:
            // Fixture Craft auth is hermetic in-memory state (see
            // CraftFixtureAuthState, flipped by the fixture branches of
            // craftConnect.save/signOut): a fixtures sign-out empties this
            // section into its sign-in state instead of snapping back to
            // rows.
            if await CraftFixtureAuthState.shared.isSignedOut() {
                return DocsListRecentsResult(items: [], unreachable: false, signedOut: true)
            }
            return DocsListRecentsResult(
                items: DocsFixtures.craftRecents(), unreachable: false, signedOut: false)
        }
    }
}

// MARK: - Fixtures

public enum DocsFixtures {
    /// 12 canned Craft rows: ids/titles mirror the renderer's
    /// `DOC_FIXTURES` craft section. Contract-shaped rows — `openUrl` the
    /// Craft web editor (previews in the guest like Notion), `deepLink` the
    /// native-app target — so the lens shell shows content while live
    /// listing needs a credential.
    ///
    /// Fixture rows model clickableLink-bearing live rows (the normal live
    /// case): each row's `deepLink` is the API-shaped
    /// `craftdocs://open?spaceId=fixture-space&documentId=<editorId>` and its
    /// `openUrl` is the same low-level `craftWebEditorURL` builder the live
    /// path uses. The editor ids deliberately differ from the row ids —
    /// craft's two id families differ for the same doc live — and mix
    /// uppercase-hex and lowercase-uuid forms like the live data. The
    /// editor ids are unreserved-set only so Swift and JS `encodeURIComponent`
    /// byte-agree.
    ///
    /// Canonical mirror: ids/titles match lenses/docs/fixtures.ts row-for-row
    /// (see its header for the cross-side contract). updatedAt is generated
    /// relative to now with the same minutes-ago offsets, so ?mokiDoc pins
    /// and "within last day" hold under MOKI_FIXTURES=1 at any wall-clock
    /// time. Ids, editor ids, and URL tables are pinned in the renderer
    /// tests — change rows here AND there together. The editor-id column
    /// mirrors the live clickableLink values (not the row ids).
    public static func craftRecents(now: Date = Date()) -> [DocItem] {
        let seeds: [(id: String, editorId: String, title: String, minutesAgo: Double)] = [
            ("s/launch-checklist-a1b2c3", "A7C5E2D4-93B1-4F0E-9F27-F1B2C3D4E5F6", "Launch checklist", 35),
            ("s/essay-draft-d4e5f6", "4b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", "Essay draft", 80),
            ("s/trip-itinerary-g7h8i9", "B3A4F5E6-D7C8-4A9B-8C0D-1E2F3A4B5C6D", "Trip itinerary", 160),
            ("s/reading-notes-j0k1l2", "7d8e9f0a-1b2c-4d3e-9f0a-1b2c3d4e5f6a", "Reading notes", 240),
            ("s/garden-plan-m3n4o5", "C9D8E7F6-A5B4-4C3D-8E9F-0A1B2C3D4E5F", "Garden plan", 330),
            ("s/talk-outline-p6q7r8", "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d", "Talk outline", 450),
            ("s/budget-review-s9t0u1", "D0E1F2A3-B4C5-4D6E-8F90-1A2B3C4D5E6F", "Budget review", 570),
            ("s/book-club-v2w3x4", "5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c", "Book club picks", 690),
            ("s/workout-log-y5z6a7", "E1F2A3B4-C5D6-4E7F-8A9B-0C1D2E3F4A5B", "Workout log", 810),
            ("s/gift-list-b8c9d0", "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d", "Gift list", 930),
            ("s/home-inventory-e1f2g3", "F2A3B4C5-D6E7-4F8A-9B0C-1D2E3F4A5B6C", "Home inventory", 1050),
            ("s/ideas-inbox-h4i5j6", "3b4c5d6e-7f8a-4b9c-0d1e-2f3a4b5c6d7e", "Ideas inbox", 1180),
        ]
        return seeds.map {
            DocItem(
                id: $0.id, title: $0.title, source: .craft,
                updatedAt: iso8601String(now.addingTimeInterval(-$0.minutesAgo * 60)),
                openUrl: craftWebEditorURL(spaceId: "fixture-space", documentId: $0.editorId) ?? "",
                deepLink: "craftdocs://open?spaceId=fixture-space&documentId=\($0.editorId)")
        }
    }
}
