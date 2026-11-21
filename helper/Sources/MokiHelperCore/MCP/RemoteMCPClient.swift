import Foundation

// MARK: - Minimal Streamable-HTTP MCP client (2025 revision)
//
// Small generic transport for the hosted-OAuth providers (Notion, Craft):
// `initialize` + `notifications/initialized` handshake, `tools/list`,
// `tools/call` over Streamable HTTP. 2025 revisions only — no 2026
// self-contained mode. Handles `application/json` and `text/event-stream`
// responses, tracks `Mcp-Session-Id` (with one re-handshake retry on a
// 404), and enforces a per-request timeout.
//
// The client never logs the token or payload content, and it never
// provider-parses tool payloads: `callTool` returns the text JSON plus
// `structuredContent` verbatim, and each provider service parses its own
// tool's shape.

/// One MCP tool advertisement: name plus its JSON-Schema input shape.
/// The schema is the contract source of truth for argument shapes.
public struct MCPTool: Sendable, Equatable {
    public var name: String
    public var inputSchema: JSONValue?

    public init(name: String, inputSchema: JSONValue? = nil) {
        self.name = name
        self.inputSchema = inputSchema
    }
}

/// One `tools/call` result: the raw text payload plus the structured
/// content verbatim. Provider services parse their own tool's shape from
/// these — the transport never interprets them.
public struct MCPToolResult: Sendable, Equatable {
    public var structuredContent: JSONValue?
    public var text: String?
    public var isError: Bool

    public init(structuredContent: JSONValue? = nil, text: String? = nil, isError: Bool = false) {
        self.structuredContent = structuredContent
        self.text = text
        self.isError = isError
    }
}

let mcpRequestTimeout: TimeInterval = 15
let mcpProtocolVersion = "2025-06-18"

/// Per-client mutable handshake state, shared by the struct's copies.
private final class MCPClientState: @unchecked Sendable {
    private let lock = NSLock()
    private var sessionId: String?
    private var initialized = false

    func currentSessionId() -> String? { lock.withLock { sessionId } }
    func isInitialized() -> Bool { lock.withLock { initialized } }
    func set(sessionId: String?) {
        lock.withLock {
            if let sessionId { self.sessionId = sessionId }
            self.initialized = true
        }
    }
    func reset() {
        lock.withLock {
            sessionId = nil
            initialized = false
        }
    }
}

public struct RemoteMCPClient: Sendable {
    private let endpoint: URL
    private let accessToken: String
    private let session: URLSession
    private let state = MCPClientState()

    public init(endpoint: URL, accessToken: String, session: URLSession) {
        self.endpoint = endpoint
        self.accessToken = accessToken
        self.session = session
    }

    /// Tool advertisements (`tools/list`). Handshakes lazily first.
    public func listTools() async throws -> [MCPTool] {
        try await ensureHandshake()
        let result = try await send(method: "tools/list", params: .object([:]))
        guard case .object(let dict) = result,
            case .array(let tools) = dict["tools"]
        else {
            throw AppError(code: "unreachable", message: "The service returned an unexpected response.")
        }
        return tools.compactMap { item -> MCPTool? in
            guard case .object(let tool) = item,
                case .string(let name) = tool["name"]
            else { return nil }
            return MCPTool(name: name, inputSchema: tool["inputSchema"])
        }
    }

    /// Call one tool. Handshakes lazily first. Returns text JSON plus
    /// `structuredContent` without provider-parsing either.
    public func callTool(name: String, arguments: JSONValue) async throws -> MCPToolResult {
        try await ensureHandshake()
        let result = try await send(
            method: "tools/call",
            params: .object(["name": .string(name), "arguments": arguments]))
        guard case .object(let dict) = result else {
            throw AppError(code: "unreachable", message: "The service returned an unexpected response.")
        }
        var text: String?
        if case .array(let items) = dict["content"] {
            let runs = items.compactMap { item -> String? in
                guard case .object(let part) = item,
                    case .string(let kind) = part["type"], kind == "text",
                    case .string(let run) = part["text"]
                else { return nil }
                return run
            }
            if !runs.isEmpty { text = runs.joined(separator: "\n") }
        }
        let isError: Bool = {
            if case .bool(let flag) = dict["isError"] { return flag }
            return false
        }()
        return MCPToolResult(structuredContent: dict["structuredContent"], text: text, isError: isError)
    }

    // MARK: - Handshake + transport

    private func ensureHandshake() async throws {
        if state.isInitialized() { return }
        let result = try await send(
            method: "initialize",
            params: .object([
                "protocolVersion": .string(mcpProtocolVersion),
                "capabilities": .object([:]),
                "clientInfo": .object([
                    "name": .string("Moki"),
                    "version": .string(helperVersion),
                ]),
            ]))
        guard case .object = result else {
            throw AppError(code: "unreachable", message: "The service returned an unexpected response.")
        }
        try await sendNotification(method: "notifications/initialized")
    }

    private func sendNotification(method: String) async throws {
        _ = try await post(payload: mcpEnvelope(method: method, params: nil, id: nil), allowEmpty: true)
    }

    private func send(method: String, params: JSONValue?) async throws -> JSONValue {
        do {
            return try await post(payload: mcpEnvelope(method: method, params: params, id: .int(1)), allowEmpty: false)
        } catch let error as AppError where error.code == "mcp_session_expired" {
            // One re-handshake, then retry the call once.
            state.reset()
            try await ensureHandshake()
            return try await post(payload: mcpEnvelope(method: method, params: params, id: .int(2)), allowEmpty: false)
        }
    }

    private func mcpEnvelope(method: String, params: JSONValue?, id: JSONValue?) -> JSONValue {
        var object: [String: JSONValue] = ["jsonrpc": .string("2.0"), "method": .string(method)]
        if let params { object["params"] = params }
        if let id { object["id"] = id }
        return .object(object)
    }

    /// One POST; returns the `result` (or Void for empty notifications).
    /// Throws `AppError` with a token-free, content-free message.
    @discardableResult
    private func post(payload: JSONValue, allowEmpty: Bool) async throws -> JSONValue {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = mcpRequestTimeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        if let sessionId = state.currentSessionId() {
            request.setValue(sessionId, forHTTPHeaderField: "Mcp-Session-Id")
        }
        request.httpBody = try? JSONEncoder().encode(payload)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AppError(code: "unreachable", message: "The service request failed: network unavailable.")
        }
        guard let http = response as? HTTPURLResponse else {
            throw AppError(code: "unreachable", message: "The service request failed.")
        }
        if http.statusCode == 429 {
            throw AppError(code: "rate_limited", message: "The service is rate-limiting requests. Try again in a moment.")
        }
        if http.statusCode == 401 || http.statusCode == 403 {
            throw AppError(code: "auth_expired", message: "The service authorization expired. Sign in again to reconnect.")
        }
        if http.statusCode == 404 && state.currentSessionId() != nil {
            throw AppError(code: "mcp_session_expired", message: "The service session expired.")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw AppError(code: "unreachable", message: "The service request failed (HTTP \(http.statusCode)).")
        }
        if let sessionId = http.value(forHTTPHeaderField: "Mcp-Session-Id"), !sessionId.isEmpty {
            state.set(sessionId: sessionId)
        } else if !state.isInitialized() {
            // Initialized without a session id (plain-JSON servers): the
            // handshake still counts.
            state.set(sessionId: nil)
        }
        if data.isEmpty {
            guard allowEmpty else {
                throw AppError(code: "unreachable", message: "The service returned an unexpected response.")
            }
            return .null
        }
        let body = mcpResponseBody(data, contentType: http.value(forHTTPHeaderField: "Content-Type"))
        guard let envelope = try? JSONDecoder().decode(JSONValue.self, from: body),
            case .object(let dict) = envelope
        else {
            throw AppError(code: "unreachable", message: "The service returned an unexpected response.")
        }
        if case .object = dict["error"] {
            // Server prose can echo request material; never forward it.
            throw AppError(code: "unreachable", message: "The service returned an error.")
        }
        guard let result = dict["result"] else {
            throw AppError(code: "unreachable", message: "The service returned an unexpected response.")
        }
        return result
    }
}

/// Response body for JSON vs. SSE: `text/event-stream` carries one JSON
/// document per `data:` line — concatenate and parse the whole.
func mcpResponseBody(_ data: Data, contentType: String?) -> Data {
    guard let contentType, contentType.contains("text/event-stream"),
        let text = String(data: data, encoding: .utf8)
    else { return data }
    let payload = text.components(separatedBy: .newlines)
        .compactMap { line -> String? in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("data:") else { return nil }
            let value = String(trimmed.dropFirst("data:".count)).trimmingCharacters(in: .whitespaces)
            return value.isEmpty ? nil : value
        }
        .joined(separator: "\n")
    return Data(payload.utf8)
}
