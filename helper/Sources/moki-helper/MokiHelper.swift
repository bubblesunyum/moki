import Foundation
import MokiHelperCore

/// Executable entry point: build the server over stdio, register methods,
/// and serve until stdin closes (then exit 0).
///
/// Later features add one line here per method, e.g.:
/// `await server.register("gmail.list", handler: listGmail)`.
@main
struct MokiHelper {
    static func main() async {
        let transport = StdioTransport()
        let server = RPCServer(transport: transport)
        await server.registerBuiltinMethods()
        await server.register("accounts.list", handler: googleAccountsListHandler())
        await server.run()
    }
}
