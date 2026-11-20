import Foundation

// MARK: - Drive recents service
//
// `listFiles` lists `files.list` across every signed-in account and merges
// newest-first, capped at 12 rows for the Docs Drive section. Per-account
// failures never fail the page — they land in `unreachable`/`authExpired`
// — while a missing OAuth client (`auth_unconfigured`) still throws.
// Accounts are fetched sequentially: no TaskGroup, which has hung this
// codebase's tests before.
//
// Scope caveat: psymail-mini's sign-in never requested a Drive scope, so
// refresh tokens imported from it mint access tokens the Drive API rejects
// (403 → `auth_expired` here). Those users re-auth with a Drive scope;
// never promise a seamless upgrade on the imported grant alone.

public struct DriveService: Sendable {
    private let accounts: GoogleAccountsService
    private let session: URLSession

    public init(accounts: GoogleAccountsService, session: URLSession = .shared) {
        self.accounts = accounts
        self.session = session
    }

    public func listFiles() async throws -> DriveFilesPage {
        let listed = try await accounts.listAccounts()
        var items: [DocItem] = []
        var unreachable = listed.accounts.filter { $0.status == .unreachable }.map(\.address)
        var authExpired = listed.accounts.filter { $0.status == .authExpired }.map(\.address)
        for account in listed.accounts where account.status == .ok {
            do {
                let token = try await accounts.accessToken(for: account.address)
                items.append(
                    contentsOf: try await fetchFiles(account: account.address, token: token))
            } catch let error as AppError where error.code == "auth_expired" {
                authExpired.append(account.address)
            } catch {
                unreachable.append(account.address)
            }
        }
        items.sort {
            let left = calendarSortDate($0.updatedAt)
            let right = calendarSortDate($1.updatedAt)
            if left != right { return left > right }
            return $0.id < $1.id
        }
        return DriveFilesPage(
            items: Array(items.prefix(driveRecentsLimit)),
            unreachable: unreachable.sorted(), authExpired: authExpired.sorted())
    }

    private func fetchFiles(account: String, token: String) async throws -> [DocItem] {
        var request = URLRequest(url: driveFilesURL)
        request.timeoutInterval = googleRequestTimeout
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AppError(
                code: "unreachable",
                message: "Drive request failed: network unavailable.")
        }
        guard let http = response as? HTTPURLResponse else {
            throw AppError(code: "unreachable", message: "Drive request failed.")
        }
        guard http.statusCode == 200 else {
            throw driveStatusError(status: http.statusCode, account: account)
        }
        guard let list = try? JSONDecoder().decode(DriveFileList.self, from: data) else {
            throw AppError(
                code: "unreachable", message: "Drive returned an unexpected response.")
        }
        return (list.files ?? []).compactMap { docItem(from: $0) }
    }
}

// MARK: - RPC handlers

public func driveListFilesHandler(service: DriveService) -> @Sendable (JSONValue) async throws -> DriveFilesPage {
    return { _ in try await service.listFiles() }
}

public func fixtureDriveListFilesHandler() -> @Sendable (JSONValue) async throws -> DriveFilesPage {
    return { _ in DriveFixtures.listFiles() }
}

// MARK: - Drive API wire shapes

/// How many rows the Docs Drive section shows.
let driveRecentsLimit = 12

struct DriveFileItem: Decodable {
    var id: String?
    var name: String?
    var modifiedTime: String?
    var mimeType: String?
    var webViewLink: String?
}

struct DriveFileList: Decodable {
    var files: [DriveFileItem]?
}

/// Map one API file to a `DocItem`. Nil for id-less or modifiedTime-less
/// files — the list skips those rather than handing the renderer an
/// unsortable row. `mimeType` is informational only: the preview pane
/// opens `openUrl`, so it is not carried on the wire shape.
func docItem(from file: DriveFileItem) -> DocItem? {
    guard let id = file.id, !id.isEmpty else { return nil }
    guard let modifiedTime = file.modifiedTime, !modifiedTime.isEmpty else { return nil }
    let title: String
    if let name = file.name, !name.isEmpty {
        title = name
    } else {
        title = "(Untitled)"
    }
    let openUrl: String
    if let link = file.webViewLink, !link.isEmpty {
        openUrl = link
    } else {
        openUrl = "https://drive.google.com/file/d/\(id)/view"
    }
    return DocItem(
        id: id, title: title, source: .drive, updatedAt: modifiedTime, openUrl: openUrl)
}

// MARK: - Status mapping

/// 401/403 means the grant died — or was minted without a Drive scope
/// (psymail-mini imports predate it) — so both read as `auth_expired`
/// (re-auth); anything else is a transient Drive failure (`unreachable`).
func driveStatusError(status: Int, account: String) -> Error {
    switch status {
    case 401, 403:
        return AppError(
            code: "auth_expired",
            message: "Google authorization expired for \(account). Sign in again to reconnect.")
    default:
        return AppError(
            code: "unreachable",
            message: "Drive request failed (HTTP \(status)).")
    }
}

// MARK: - URL building

/// `files.list` for the Docs section: newest first, My Drive first
/// (no shared-drive corpora), 12 rows, trashed excluded, minimal fields.
/// No caller input, so this is a fixed URL rather than a throwing builder.
let driveFilesURL: URL = {
    var components = URLComponents()
    components.scheme = "https"
    components.host = "www.googleapis.com"
    components.percentEncodedPath = "/drive/v3/files"
    components.queryItems = [
        URLQueryItem(name: "pageSize", value: "12"),
        URLQueryItem(name: "orderBy", value: "modifiedTime desc"),
        URLQueryItem(name: "q", value: "trashed = false"),
        URLQueryItem(
            name: "fields",
            value: "files(id,name,modifiedTime,mimeType,webViewLink)"),
    ]
    return components.url!
}()
