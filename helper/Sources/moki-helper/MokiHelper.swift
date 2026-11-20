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
        if ProcessInfo.processInfo.environment["MOKI_FIXTURES"] == "1" {
            // Canned data: no network, no file access (UI work, screenshots).
            await server.register("accounts.list", handler: fixtureAccountsListHandler())
            await server.register("mail.listThreads", handler: fixtureMailListThreadsHandler())
            await server.register("mail.getThread", handler: fixtureMailGetThreadHandler())
            await server.register("calendar.listEvents", handler: fixtureCalendarListEventsHandler())
            await server.register("docs.listDrive", handler: fixtureDriveListFilesHandler())
            await server.register("docs.listRecents", handler: fixtureDocsListRecentsHandler())
        } else {
            await server.register("accounts.list", handler: googleAccountsListHandler())
            let accounts = GoogleAccountsService()
            let mail = MailService(
                accounts: accounts, session: .shared)
            await server.register("mail.listThreads", handler: mailListThreadsHandler(service: mail))
            await server.register("mail.getThread", handler: mailGetThreadHandler(service: mail))
            let calendar = CalendarService(accounts: accounts, session: .shared)
            await server.register("calendar.listEvents", handler: calendarListEventsHandler(service: calendar))
            let drive = DriveService(accounts: accounts, session: .shared)
            await server.register("docs.listDrive", handler: driveListFilesHandler(service: drive))
            let notion = NotionService()
            let craft = CraftService(session: .shared)
            let docs = DocsRecentsService(drive: drive, notion: notion, craft: craft)
            await server.register("docs.listRecents", handler: docsListRecentsHandler(service: docs))
        }
        await server.registerNotionMethods()
        await server.registerCraftMethods()
        await server.registerGoogleSignInMethods()
        await server.run()
    }
}
