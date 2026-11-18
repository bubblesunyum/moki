import Foundation

/// Minimal line-oriented transport. The server reads request lines via
/// `nextLine()` (nil = EOF) and emits exactly one JSON line per response or
/// notification via `writeLine(_:)`.
public protocol LineTransport: Sendable {
    func nextLine() async -> String?
    func writeLine(_ line: String) async
}

/// In-memory transport for tests: feed request lines up front, then inspect
/// what the server wrote.
public actor InMemoryTransport: LineTransport {
    private var inputs: [String]
    private var outputs: [String] = []

    public init(lines: [String] = []) {
        self.inputs = lines
    }

    public func feed(_ line: String) {
        inputs.append(line)
    }

    public func nextLine() async -> String? {
        guard !inputs.isEmpty else { return nil }
        return inputs.removeFirst()
    }

    public func writeLine(_ line: String) async {
        outputs.append(line)
    }

    public func collectedOutput() -> [String] {
        outputs
    }
}

/// Production transport: stdin for requests, stdout for responses.
/// Writes go through this actor so concurrent notifiers and the run loop
/// cannot interleave bytes on stdout.
public actor StdioTransport: LineTransport {
    private var iterator: AsyncLineSequence<FileHandle.AsyncBytes>.AsyncIterator?

    public init() {}

    public func nextLine() async -> String? {
        if iterator == nil {
            iterator = FileHandle.standardInput.bytes.lines.makeAsyncIterator()
        }
        guard var it = iterator else { return nil }
        defer { iterator = it }
        do {
            return try await it.next()
        } catch {
            logToStderr("moki-helper: stdin read error: \(error)")
            return nil
        }
    }

    public func writeLine(_ line: String) async {
        var text = line
        if !text.hasSuffix("\n") {
            text.append("\n")
        }
        guard let data = text.data(using: .utf8) else { return }
        do {
            try FileHandle.standardOutput.write(contentsOf: data)
        } catch {
            logToStderr("moki-helper: stdout write error: \(error)")
        }
    }
}

/// Server-to-client notifications (`{jsonrpc, method, params}`, no `id`).
/// Grab one from `RPCServer.makeNotifier()` and hold it wherever pushes
/// originate; every `notify` call serializes through the shared transport.
public struct Notifier: Sendable {
    private let transport: any LineTransport

    public init(transport: any LineTransport) {
        self.transport = transport
    }

    public func notify(method: String, params: JSONValue = .null) async {
        let value = JSONValue.object([
            "jsonrpc": .string("2.0"),
            "method": .string(method),
            "params": params,
        ])
        guard let line = encodeJSONLine(value) else { return }
        await transport.writeLine(line)
    }
}

/// Logging must never touch stdout — the Electron parent parses every stdout
/// line as JSON-RPC. Diagnostics go here instead.
public func logToStderr(_ message: String) {
    var text = message
    if !text.hasSuffix("\n") {
        text.append("\n")
    }
    if let data = text.data(using: .utf8) {
        try? FileHandle.standardError.write(contentsOf: data)
    }
}
