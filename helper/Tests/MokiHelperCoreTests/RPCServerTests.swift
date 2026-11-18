import Foundation
import Testing

@testable import MokiHelperCore

/// Drive the server through the in-memory line transport: feed request
/// lines, run to EOF, and decode the captured response lines.
private func runLines(_ lines: String...) async -> [JSONValue] {
    let transport = InMemoryTransport(lines: lines)
    let server = RPCServer(transport: transport)
    await server.registerBuiltinMethods()
    await server.run()
    let output = await transport.collectedOutput()
    return output.compactMap { line in
        try? JSONDecoder().decode(JSONValue.self, from: Data(line.utf8))
    }
}

@Test func pingDispatch() async throws {
    let responses = await runLines(#"{"jsonrpc":"2.0","id":1,"method":"helper.ping"}"#)
    #expect(responses.count == 1)
    guard case .object(let envelope) = responses[0],
        let id = envelope["id"],
        case .object(let result) = envelope["result"],
        case .bool(let ok) = result["ok"],
        case .string(let version) = result["version"]
    else {
        Issue.record("ping response had unexpected shape: \(responses)")
        return
    }
    #expect(id == .int(1))
    #expect(ok == true)
    #expect(version == helperVersion)
}

@Test func unknownMethodError() async throws {
    let responses = await runLines(#"{"jsonrpc":"2.0","id":7,"method":"nope.missing"}"#)
    #expect(responses.count == 1)
    guard case .object(let envelope) = responses[0],
        case .object(let error) = envelope["error"],
        case .int(let code) = error["code"]
    else {
        Issue.record("error response had unexpected shape: \(responses)")
        return
    }
    #expect(code == -32601)
    #expect(envelope["id"] == .int(7))
}

@Test func malformedJSONError() async throws {
    let responses = await runLines(#"{this is not json"#)
    #expect(responses.count == 1)
    guard case .object(let envelope) = responses[0],
        case .object(let error) = envelope["error"],
        case .int(let code) = error["code"]
    else {
        Issue.record("parse-error response had unexpected shape: \(responses)")
        return
    }
    #expect(code == -32700)
}

@Test func appErrorMapping() async throws {
    let transport = InMemoryTransport(lines: [#"{"jsonrpc":"2.0","id":3,"method":"auth.check"}"#])
    let server = RPCServer(transport: transport)
    await server.register("auth.check") { (_: JSONValue) async throws -> JSONValue in
        throw AppError(code: "auth_expired", message: "Token expired")
    }
    await server.run()
    let output = await transport.collectedOutput()
    #expect(output.count == 1)
    let value = try JSONDecoder().decode(JSONValue.self, from: Data(output[0].utf8))
    guard case .object(let envelope) = value,
        case .object(let error) = envelope["error"],
        case .int(let code) = error["code"],
        case .object(let data) = error["data"],
        case .string(let appCode) = data["code"]
    else {
        Issue.record("app-error response had unexpected shape: \(output)")
        return
    }
    #expect(code == -32000)
    #expect(appCode == "auth_expired")
}

@Test func serverNotificationHasNoID() async throws {
    let transport = InMemoryTransport()
    let server = RPCServer(transport: transport)
    await server.makeNotifier().notify(method: "cache.invalidated", params: .object(["scope": .string("gmail")]))
    let output = await transport.collectedOutput()
    #expect(output.count == 1)
    let value = try JSONDecoder().decode(JSONValue.self, from: Data(output[0].utf8))
    guard case .object(let envelope) = value else {
        Issue.record("notification had unexpected shape: \(output)")
        return
    }
    #expect(envelope["id"] == nil)
    #expect(envelope["method"] == .string("cache.invalidated"))
}

@Test func unknownMethodNotificationGetsNoReply() async throws {
    let responses = await runLines(#"{"jsonrpc":"2.0","method":"nope.missing"}"#)
    #expect(responses.isEmpty)
}
