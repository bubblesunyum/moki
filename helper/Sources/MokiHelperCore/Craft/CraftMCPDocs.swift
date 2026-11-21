import Foundation

// MARK: - Craft document listing over MCP
//
// `RemoteMCPClient` is the transport: it handshakes, tracks
// `Mcp-Session-Id`, and returns `tools/list` + the raw `tools/call` result.
// This file owns the Craft side only: how to ask for documents (the hosted
// server advertises `craft_read`, whose `command` returns a text list;
// older servers advertise a JSON `documents_list`) and how rows map to
// shared `DocItem`s. Never dump document content into logs or errors — ids
// and titles travel, bodies never do.

// MARK: - Arguments

/// Command for the advertised `craft_read` tool. `documents list` returns
/// the first page in space order, one `<rootBlockId> Title` per line.
func craftDocumentsReadArgs(schema _: JSONValue?) -> JSONValue {
    .object(["command": .string("documents list")])
}

/// Arguments for an older JSON `documents_list` tool, from its advertised
/// input schema. `limit` (12) whenever the tool takes it (or the schema is
/// absent), and `fetchMetadata` only when the schema offers it. Anything
/// else is never sent — strict servers reject unknown args.
func craftDocumentsListArgs(schema: JSONValue?) -> JSONValue {
    func supports(_ name: String) -> Bool {
        guard let schema, case .object(let dict) = schema,
            case .object(let properties) = dict["properties"]
        else { return false }
        return properties[name] != nil
    }
    var args: [String: JSONValue] = [:]
    if schema == nil || supports("limit") {
        args["limit"] = .int(craftOAuthRecentsPageSize)
    }
    if supports("fetchMetadata") {
        args["fetchMetadata"] = .bool(true)
    }
    return .object(args)
}

// MARK: - Result parsing

/// One `documents_list` row: identity, title, and the server's modified
/// stamp when it gives one (field names vary — the hosted schema is the
/// truth, so read liberally). A row-carried native deep link wins when it
/// is a `craftdocs://` target; otherwise the row maps to the standard
/// per-document deep link.
struct CraftMCPDocument: Sendable, Equatable {
    var id: String
    var title: String
    var modifiedAt: String?
    var deepLink: String?
}

/// Parse a `documents_list` result into rows. Accepts the structured
/// content or the text JSON, unwrapping a bare array, a wrapper object
/// (`documents`/`items`/`results`/`data`/`pages`), or a single row object.
/// Id-less rows are dropped upstream (unlinkable); a missing title renders
/// `(Untitled)`, matching the legacy Connect mapping.
func craftMCPDocuments(from result: MCPToolResult) -> [CraftMCPDocument] {
    let payload: JSONValue? = {
        if let structured = result.structuredContent { return structured }
        guard let text = result.text, let data = text.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(JSONValue.self, from: data)
    }()
    let items: [JSONValue] = {
        guard let payload else { return [] }
        if case .array(let array) = payload { return array }
        if case .object(let dict) = payload {
            for key in ["documents", "items", "results", "data", "pages"] {
                if case .array(let array) = dict[key] { return array }
            }
            // A single row object, not wrapped in an array.
            if rowID(from: dict) != nil { return [payload] }
        }
        return []
    }()
    let rows = items.compactMap { item -> CraftMCPDocument? in
        guard case .object(let dict) = item, let id = rowID(from: dict) else { return nil }
        return CraftMCPDocument(
            id: id, title: rowTitle(from: dict), modifiedAt: rowModifiedAt(from: dict),
            deepLink: rowDeepLink(from: dict))
    }
    if !rows.isEmpty || result.text == nil { return rows }
    return craftDocumentsFromReadText(result.text ?? "")
}

/// Parse the `craft_read` text form: a count header, then one
/// `  <rootBlockId> Title` row per line, then an optional `Next page:`.
/// Only rows with a bracketed id are documents; everything else is prose.
func craftDocumentsFromReadText(_ text: String) -> [CraftMCPDocument] {
    text.split(whereSeparator: \.isNewline).compactMap { line -> CraftMCPDocument? in
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("<"), let closing = trimmed.firstIndex(of: ">") else {
            return nil
        }
        let id = String(trimmed[trimmed.index(after: trimmed.startIndex)..<closing])
        guard !id.isEmpty else { return nil }
        let title = String(trimmed[trimmed.index(after: closing)...])
            .trimmingCharacters(in: .whitespaces)
        return CraftMCPDocument(
            id: id, title: title.isEmpty ? "(Untitled)" : title,
            modifiedAt: nil, deepLink: nil)
    }
}

private func firstString(in dict: [String: JSONValue], keys: [String]) -> String? {
    for key in keys {
        if case .string(let value) = dict[key], !value.isEmpty { return value }
    }
    return nil
}

private func rowID(from dict: [String: JSONValue]) -> String? {
    firstString(in: dict, keys: ["id", "blockId", "block_id", "documentId", "document_id"])
}

private func rowTitle(from dict: [String: JSONValue]) -> String {
    firstString(in: dict, keys: ["title", "name"]) ?? "(Untitled)"
}

private func rowModifiedAt(from dict: [String: JSONValue]) -> String? {
    firstString(
        in: dict,
        keys: [
            "lastModifiedAt", "last_modified_at", "updatedAt", "updated_at",
            "modifiedAt", "modified_at", "lastEditedTime", "last_edited_time",
        ])
}

private func rowDeepLink(from dict: [String: JSONValue]) -> String? {
    guard let raw = firstString(in: dict, keys: ["deepLink", "deep_link", "url"]),
        raw.hasPrefix("craftdocs://")
    else { return nil }
    return raw
}

// MARK: - DocItem mapping

/// One MCP document as a shared Docs row. `openUrl` stays empty (Craft rows
/// never load in the preview guest); `updatedAt` is the server's modified
/// stamp when it gives one, else empty — a fetch time would claim recency
/// the list does not have (the section reads `In space order`).
func craftMCPDocItem(from document: CraftMCPDocument) -> DocItem {
    DocItem(
        id: document.id, title: document.title, source: .craft,
        updatedAt: document.modifiedAt ?? "", openUrl: "",
        deepLink: document.deepLink ?? craftDeepLink(spaceId: nil, blockId: document.id))
}
