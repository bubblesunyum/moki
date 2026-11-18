/// Typed errors a handler can throw. `RPCServer` maps these to JSON-RPC
/// error objects; anything else becomes `-32603` (internal error).

/// Handler received well-formed JSON it cannot use. Maps to `-32602`.
public struct InvalidParamsError: Error, Sendable {
    public let message: String

    public init(_ message: String = "Invalid params") {
        self.message = message
    }
}

/// Application-level failure (expired auth, missing account, …).
/// Maps to `-32000` with `data: {"code": "<code>"}`.
public struct AppError: Error, Sendable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

enum RPCErrorCode {
    static let parseError = -32700
    static let invalidRequest = -32600
    static let methodNotFound = -32601
    static let invalidParams = -32602
    static let internalError = -32603
    static let appError = -32000
}
