/// Built-in methods, registered from the executable entry point.
/// Later features follow this pattern: a handler file plus one registration
/// line in `registerBuiltinMethods()`'s caller.

public let helperVersion = "0.1.0"

public struct PingResult: Codable, Sendable {
    public let ok: Bool
    public let version: String

    public init(ok: Bool = true, version: String = helperVersion) {
        self.ok = ok
        self.version = version
    }
}

public func pingHandler(_ params: JSONValue) async throws -> PingResult {
    PingResult(ok: true, version: helperVersion)
}

extension RPCServer {
    /// Register every built-in method. Called once from `moki-helper`'s
    /// `@main` entry point (and from tests).
    public func registerBuiltinMethods() {
        register("helper.ping", handler: pingHandler)
    }
}
