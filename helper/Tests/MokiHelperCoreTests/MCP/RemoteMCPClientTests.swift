import Foundation
import Testing

@testable import MokiHelperCore

// MARK: - Stubs

/// Routes requests to per-test answers. Private to this file.
private final class MCPStubURLProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler:
        (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    static func setHandler(_ handler: @escaping @Sendable (URLRequest) throws -> (HTTPURLResponse, Data)) {
        lock.withLock { self.handler = handler }
    }

    static func clear() {
        lock.withLock { self.handler = nil }
    }

    /// Recorded requests for header/body assertions.
    nonisolated(unsafe) private static var logged: [URLRequest] = []
    static func resetLog() { lock.withLock { logged = [] } }
    static func requests() -> [URLRequest] { lock.withLock { logged } }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let handler = Self.lock.withLock { Self.handler }
        Self.lock.withLock { Self.logged.append(request) }
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

private func makeMCPStubSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [MCPStubURLProtocol.self]
    return URLSession(configuration: config)
}

private func mcpHTTPResponse(
    url: URL, status: Int, headers: [String: String]? = nil
) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: headers)!
}

private func mcpJSON(_ object: Any) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
}

private func mcpRequestMethod(_ request: URLRequest) -> String? {
    guard let json = try? JSONDecoder().decode(JSONValue.self, from: mcpStubBody(request)),
        case .object(let dict) = json,
        case .string(let method) = dict["method"]
    else { return nil }
    return method
}

/// Body bytes however URLSession delivered them: `httpBody` when set,
/// else the `httpBodyStream` URLProtocol stubs receive (same pattern as
/// the Google sign-in suite's stub).
private func mcpStubBody(_ request: URLRequest) -> Data {
    if let body = request.httpBody, !body.isEmpty { return body }
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open()
    defer { stream.close() }
    var body = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
        let read = stream.read(&buffer, maxLength: buffer.count)
        if read <= 0 { break }
        body.append(buffer, count: read)
    }
    return body
}

private let mcpEndpoint = URL(string: "https://mcp.notion.com/mcp")!
private let mcpToken = "mcp-access-token"

/// Successful initialize → tools/list script. Captures the session id the
/// client sends back on later calls.
private func succeedMCPHandshakeAndList(logged: LockedBox<[String: String]>) {
    MCPStubURLProtocol.setHandler { request in
        let url = request.url!
        let auth = request.value(forHTTPHeaderField: "Authorization") ?? ""
        switch mcpRequestMethod(request) {
        case "initialize":
            logged.write(["initialize": auth])
            return (
                mcpHTTPResponse(url: url, status: 200, headers: ["Mcp-Session-Id": "sess-1"]),
                mcpJSON(["jsonrpc": "2.0", "id": 1, "result": ["protocolVersion": "2025-06-18", "capabilities": [:]] as [String: Any]]))
        case "notifications/initialized":
            return (mcpHTTPResponse(url: url, status: 202), Data())
        case "tools/list":
            logged.modify { $0["tools/list"] = request.value(forHTTPHeaderField: "Mcp-Session-Id") ?? "" }
            _ = auth
            return (
                mcpHTTPResponse(url: url, status: 200),
                mcpJSON([
                    "jsonrpc": "2.0", "id": 1,
                    "result": ["tools": [
                        ["name": "notion-list-recent-pages", "inputSchema": ["type": "object"]],
                        ["name": "other-tool"],
                    ]],
                ]))
        case "tools/call":
            logged.modify { $0["tools/call"] = request.value(forHTTPHeaderField: "Mcp-Session-Id") ?? "" }
            return (
                mcpHTTPResponse(url: url, status: 200),
                mcpJSON([
                    "jsonrpc": "2.0", "id": 1,
                    "result": [
                        "structuredContent": ["pages": [["id": "p1"]]],
                        "content": [["type": "text", "text": "{\"pages\":[]}"]],
                    ],
                ]))
        default:
            return (mcpHTTPResponse(url: url, status: 500), Data())
        }
    }
}

/// Locked box for values a test mutates from inside `@Sendable` closures.
private final class LockedBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    init(_ value: Value) {
        self.value = value
    }

    func read() -> Value {
        lock.withLock { value }
    }

    func write(_ next: Value) {
        lock.withLock { value = next }
    }

    func modify(_ transform: (inout Value) -> Void) {
        lock.withLock { transform(&value) }
    }
}

@Suite(.serialized)
struct RemoteMCPClientTests {
    @Test func handshakeTracksSessionIdAndListsTools() async throws {
        defer { MCPStubURLProtocol.clear() }
        let seen = LockedBox<[String: String]>([:])
        succeedMCPHandshakeAndList(logged: seen)

        let client = RemoteMCPClient(
            endpoint: mcpEndpoint, accessToken: mcpToken, session: makeMCPStubSession())
        let tools = try await client.listTools()
        #expect(tools.map(\.name).contains("notion-list-recent-pages"))
        #expect(tools.first?.inputSchema != nil)
        // Bearer auth on the wire; session id tracked from initialize.
        #expect(seen.read()["initialize"] == "Bearer \(mcpToken)")
        #expect(seen.read()["tools/list"] == "sess-1")
    }

    @Test func callToolReturnsTextAndStructuredContent() async throws {
        defer { MCPStubURLProtocol.clear() }
        succeedMCPHandshakeAndList(logged: LockedBox([:]))

        let client = RemoteMCPClient(
            endpoint: mcpEndpoint, accessToken: mcpToken, session: makeMCPStubSession())
        let result = try await client.callTool(
            name: "notion-list-recent-pages", arguments: .object(["limit": .int(12)]))
        #expect(!result.isError)
        #expect(result.structuredContent != nil)
        #expect((result.text ?? "").contains("pages"))
    }

    @Test func callToolSurfacesIsError() async throws {
        defer { MCPStubURLProtocol.clear() }
        MCPStubURLProtocol.setHandler { request in
            let url = request.url!
            switch mcpRequestMethod(request) {
            case "initialize":
                return (
                    mcpHTTPResponse(url: url, status: 200),
                    mcpJSON(["jsonrpc": "2.0", "id": 1, "result": ["capabilities": [:]] as [String: Any]]))
            case "notifications/initialized":
                return (mcpHTTPResponse(url: url, status: 202), Data())
            default:
                return (
                    mcpHTTPResponse(url: url, status: 200),
                    mcpJSON([
                        "jsonrpc": "2.0", "id": 1,
                        "result": [
                            "content": [["type": "text", "text": "denied"]],
                            "isError": true,
                        ],
                    ]))
            }
        }

        let client = RemoteMCPClient(
            endpoint: mcpEndpoint, accessToken: mcpToken, session: makeMCPStubSession())
        let result = try await client.callTool(name: "x", arguments: .object([:]))
        #expect(result.isError)
        #expect(result.text == "denied")
    }

    @Test func handlesSSEEnvelope() async throws {
        defer { MCPStubURLProtocol.clear() }
        MCPStubURLProtocol.setHandler { request in
            let url = request.url!
            switch mcpRequestMethod(request) {
            case "initialize":
                let payload = mcpJSON([
                    "jsonrpc": "2.0", "id": 1, "result": ["capabilities": [:]] as [String: Any]
                ])
                let sse = Data("event: message\ndata: ".utf8) + payload + Data("\n\n".utf8)
                return (mcpHTTPResponse(url: url, status: 200, headers: ["Content-Type": "text/event-stream"]), sse)
            case "notifications/initialized":
                return (mcpHTTPResponse(url: url, status: 202), Data())
            default:
                return (
                    mcpHTTPResponse(url: url, status: 200),
                    mcpJSON(["jsonrpc": "2.0", "id": 1, "result": ["tools": []]]))
            }
        }

        let client = RemoteMCPClient(
            endpoint: mcpEndpoint, accessToken: mcpToken, session: makeMCPStubSession())
        let tools = try await client.listTools()
        #expect(tools.isEmpty)
    }

    @Test func rateLimitedMapsToRateLimited() async throws {
        defer { MCPStubURLProtocol.clear() }
        MCPStubURLProtocol.setHandler { request in
            (mcpHTTPResponse(url: request.url!, status: 429), Data())
        }
        let client = RemoteMCPClient(
            endpoint: mcpEndpoint, accessToken: mcpToken, session: makeMCPStubSession())
        do {
            _ = try await client.listTools()
            Issue.record("expected rate_limited")
        } catch let error as AppError {
            #expect(error.code == "rate_limited")
            #expect(!error.message.contains(mcpToken))
        }
    }

    @Test func unauthorizedMapsToAuthExpiredWithoutTokenLeak() async throws {
        defer { MCPStubURLProtocol.clear() }
        MCPStubURLProtocol.setHandler { request in
            (mcpHTTPResponse(url: request.url!, status: 401), Data("secret-body".utf8))
        }
        let client = RemoteMCPClient(
            endpoint: mcpEndpoint, accessToken: mcpToken, session: makeMCPStubSession())
        do {
            _ = try await client.listTools()
            Issue.record("expected auth_expired")
        } catch let error as AppError {
            #expect(error.code == "auth_expired")
            #expect(!error.message.contains(mcpToken))
            #expect(!error.message.contains("secret-body"))
        }
    }

    @Test func networkFailureIsUnreachable() async throws {
        defer { MCPStubURLProtocol.clear() }
        MCPStubURLProtocol.setHandler { _ in throw URLError(.notConnectedToInternet) }
        let client = RemoteMCPClient(
            endpoint: mcpEndpoint, accessToken: mcpToken, session: makeMCPStubSession())
        do {
            _ = try await client.listTools()
            Issue.record("expected unreachable")
        } catch let error as AppError {
            #expect(error.code == "unreachable")
        }
    }
}
