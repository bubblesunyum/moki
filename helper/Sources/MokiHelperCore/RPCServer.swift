import Foundation

/// Newline-delimited JSON-RPC 2.0 dispatcher.
///
/// Handlers are registered by method name; `run()` reads request lines until
/// EOF and writes exactly one JSON line per response. Because the server is
/// an actor and all output funnels through the shared transport, writes are
/// serialized even when notifications race responses.
public actor RPCServer {
    private var handlers: [String: StoredHandler] = [:]
    private let transport: any LineTransport

    /// Type-erased handler: concrete `Encodable` results are converted to
    /// `JSONValue` at registration time so dispatch stays untyped.
    typealias StoredHandler = @Sendable (JSONValue) async throws -> JSONValue

    public init(transport: any LineTransport) {
        self.transport = transport
    }

    /// Register a method. Later features add a file plus one call like:
    /// `await server.register("gmail.list", handler: listGmail)`.
    public func register<T: Encodable & Sendable>(
        _ method: String,
        handler: @escaping @Sendable (JSONValue) async throws -> T
    ) {
        handlers[method] = { params in
            let result = try await handler(params)
            return try encodeToJSONValue(result)
        }
    }

    /// A push handle that writes notifications over this server's transport.
    public func makeNotifier() -> Notifier {
        Notifier(transport: transport)
    }

    /// Read request lines until EOF (`nil`), writing one response line each.
    /// Returns when stdin closes; the executable then exits 0.
    public func run() async {
        // Each request runs in its own task so a slow handler (a Gmail fetch)
        // never holds up the next line; replies may arrive out of order, which
        // JSON-RPC allows since they carry their request's id.
        await withTaskGroup(of: Void.self) { group in
            while let line = await transport.nextLine() {
                group.addTask {
                    if let response = await self.handleLine(line) {
                        await self.transport.writeLine(response)
                    }
                }
            }
        }
    }

    /// Process a single line. Returns the response line, or nil when the
    /// input needs no reply (blank line or client-side notification).
    @discardableResult
    public func handleLine(_ line: String) async -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let data = Data(trimmed.utf8)

        // Malformed JSON (not parseable at all) -> -32700.
        guard (try? JSONDecoder().decode(JSONValue.self, from: data)) != nil else {
            return encodeJSONLine(errorResponse(id: .null, code: RPCErrorCode.parseError, message: "Parse error"))
        }

        // Valid JSON with the wrong shape -> -32600, echoing id when present.
        guard let request = try? JSONDecoder().decode(DecodedRequest.self, from: data),
            request.jsonrpc == "2.0",
            let method = request.method, !method.isEmpty
        else {
            return encodeJSONLine(
                errorResponse(id: extractID(from: data), code: RPCErrorCode.invalidRequest, message: "Invalid Request")
            )
        }

        guard let handler = handlers[method] else {
            // A notification never gets a reply, not even an error (JSON-RPC 2.0 §4.1).
            guard request.hasID else { return nil }
            return encodeJSONLine(
                errorResponse(
                    id: request.hasID ? request.id : .null,
                    code: RPCErrorCode.methodNotFound,
                    message: "Method not found"
                )
            )
        }

        // Client-side notification (no id): run the handler, send no reply.
        if !request.hasID {
            _ = try? await handler(request.params)
            return nil
        }

        do {
            let result = try await handler(request.params)
            return encodeJSONLine(successResponse(id: request.id, result: result))
        } catch let error as InvalidParamsError {
            return encodeJSONLine(errorResponse(id: request.id, code: RPCErrorCode.invalidParams, message: error.message))
        } catch let error as AppError {
            return encodeJSONLine(
                errorResponse(id: request.id, code: RPCErrorCode.appError, message: error.message, appCode: error.code)
            )
        } catch is DecodingError {
            return encodeJSONLine(errorResponse(id: request.id, code: RPCErrorCode.invalidParams, message: "Invalid params"))
        } catch {
            return encodeJSONLine(errorResponse(id: request.id, code: RPCErrorCode.internalError, message: "Internal error"))
        }
    }
}

// MARK: - Wire format

/// Decoded request. `id` uses `JSONValue` so the response echoes the exact
/// type (number vs. string); `hasID` distinguishes a missing id (client
/// notification) from an explicit `"id": null`.
struct DecodedRequest: Decodable, Sendable {
    var jsonrpc: String?
    var hasID: Bool
    var id: JSONValue
    var method: String?
    var params: JSONValue

    enum CodingKeys: String, CodingKey {
        case jsonrpc, id, method, params
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        jsonrpc = try container.decodeIfPresent(String.self, forKey: .jsonrpc)
        if container.contains(.id) {
            hasID = true
            id = (try? container.decode(JSONValue.self, forKey: .id)) ?? .null
        } else {
            hasID = false
            id = .null
        }
        method = try container.decodeIfPresent(String.self, forKey: .method)
        if container.contains(.params) {
            params = (try? container.decode(JSONValue.self, forKey: .params)) ?? .null
        } else {
            params = .null
        }
    }
}

func successResponse(id: JSONValue, result: JSONValue) -> JSONValue {
    .object([
        "jsonrpc": .string("2.0"),
        "id": id,
        "result": result,
    ])
}

func errorResponse(id: JSONValue, code: Int, message: String, appCode: String? = nil) -> JSONValue {
    var errorObject: [String: JSONValue] = [
        "code": .int(code),
        "message": .string(message),
    ]
    if let appCode {
        errorObject["data"] = .object(["code": .string(appCode)])
    }
    return .object([
        "jsonrpc": .string("2.0"),
        "id": id,
        "error": .object(errorObject),
    ])
}

/// Best-effort id extraction for responses to shape-invalid requests.
func extractID(from data: Data) -> JSONValue {
    guard let value = try? JSONDecoder().decode(JSONValue.self, from: data),
        case .object(let dict) = value,
        let id = dict["id"]
    else {
        return .null
    }
    return id
}

func encodeToJSONValue<T: Encodable>(_ value: T) throws -> JSONValue {
    let data = try JSONEncoder().encode(value)
    return try JSONDecoder().decode(JSONValue.self, from: data)
}

/// Encode a response/notification as a single JSON line (no trailing newline;
/// the transport adds it). Sorted keys keep test output deterministic.
func encodeJSONLine(_ value: JSONValue) -> String? {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let data = try? encoder.encode(value) else { return nil }
    return String(data: data, encoding: .utf8)
}
