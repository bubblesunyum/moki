import Foundation
import Testing

@testable import MokiHelperCore

@Suite
struct OAuthSharedTests {
    @Test func randomStringIsURLSafe() {
        for _ in 0..<10 {
            let value = oauthRandomURLSafeString()
            #expect(!value.isEmpty)
            #expect(value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil)
        }
        // Fresh entropy every call.
        #expect(oauthRandomURLSafeString() != oauthRandomURLSafeString())
    }

    @Test func codeChallengeMatchesRFC7636Vector() {
        // RFC 7636 §B: verifier → challenge is a fixed transform.
        #expect(
            oauthCodeChallenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
                == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func callbackInitAndEquality() {
        let callback = OAuthLoopbackCallback(code: "c", state: "s", providerError: nil)
        #expect(callback == OAuthLoopbackCallback(code: "c", state: "s", providerError: nil))
        #expect(callback != OAuthLoopbackCallback(code: "c", state: "other", providerError: nil))
        #expect(OAuthLoopbackError.cancelled == OAuthLoopbackError.cancelled)
    }

    @Test func docsSignInPollEncodesToProtocolShape() throws {
        let done = DocsSignInPollResult(status: .done, account: "Notion")
        let doneJSON = String(data: try JSONEncoder().encode(done), encoding: .utf8)!
        #expect(doneJSON.contains("\"status\":\"done\""))
        #expect(doneJSON.contains("\"account\":\"Notion\""))

        let pending = DocsSignInPollResult(status: .pending)
        let pendingObject = try JSONDecoder().decode(
            [String: String].self, from: JSONEncoder().encode(pending))
        #expect(pendingObject["status"] == "pending")
    }
}

@Suite(.serialized)
struct OAuthLoopbackServerTests {
    @Test func ephemeralStartDeliversCodeAndState() async throws {
        let server = OAuthLoopbackServer()
        let port = try await server.start(port: nil)
        #expect(port > 0)

        async let waited = server.waitForCallback()
        // Let the waiter register before the redirect lands.
        try? await Task.sleep(for: .milliseconds(50))
        let target = URL(string: "http://127.0.0.1:\(port)/oauth/notion?code=auth-code&state=csrf-state")!
        let (data, response) = try await URLSession.shared.data(from: target)
        #expect((response as? HTTPURLResponse)?.statusCode == 200)
        // Generic page: no code/state material in the body.
        let body = String(data: data, encoding: .utf8) ?? ""
        #expect(body.contains("signed in"))
        #expect(!body.contains("auth-code"))
        #expect(!body.contains("csrf-state"))

        let callback = try await waited
        #expect(callback == OAuthLoopbackCallback(code: "auth-code", state: "csrf-state"))
        server.stop()
    }

    @Test func fixedPortBindsRequestedPort() async throws {
        let server = OAuthLoopbackServer()
        let port = try await server.start(port: 49687)
        #expect(port == 49687)
        server.stop()
    }

    @Test func providerErrorDeliversFailPage() async throws {
        let server = OAuthLoopbackServer()
        let port = try await server.start(port: nil)

        async let waited = server.waitForCallback()
        try? await Task.sleep(for: .milliseconds(50))
        let target = URL(string: "http://127.0.0.1:\(port)/oauth/craft?error=access_denied")!
        let (data, _) = try await URLSession.shared.data(from: target)
        let body = String(data: data, encoding: .utf8) ?? ""
        #expect(body.contains("sign-in failed"))

        let callback = try await waited
        #expect(callback.providerError == "access_denied")
        #expect(callback.code == nil)
        server.stop()
    }

    @Test func faviconProbeIsIgnored() async throws {
        let server = OAuthLoopbackServer()
        let port = try await server.start(port: nil)

        let waiter = Task { try await server.waitForCallback() }
        try? await Task.sleep(for: .milliseconds(50))
        // A favicon probe carries neither code nor error: the waiter stays
        // parked (the probe must not resolve it with an empty callback).
        _ = try? await URLSession.shared.data(from: URL(string: "http://127.0.0.1:\(port)/favicon.ico")!)
        try? await Task.sleep(for: .milliseconds(100))
        server.stop()
        await #expect(throws: OAuthLoopbackError.self) {
            _ = try await waiter.value
        }
    }

    @Test func waiterRegisteredAfterStopErrorsInsteadOfHanging() async throws {
        let server = OAuthLoopbackServer()
        _ = try await server.start(port: nil)
        server.stop()
        do {
            _ = try await server.waitForCallback()
            Issue.record("a waiter registering after stop must throw, not hang")
        } catch let error as OAuthLoopbackError {
            #expect(error == .cancelled)
        }
    }

    @Test func stopDropsBufferedCallback() async throws {
        let server = OAuthLoopbackServer()
        let port = try await server.start(port: nil)
        _ = try? await URLSession.shared.data(
            from: URL(string: "http://127.0.0.1:\(port)/oauth/notion?code=stale&state=s")!)
        // Let the redirect buffer before the stop lands.
        try? await Task.sleep(for: .milliseconds(100))
        server.stop()
        do {
            _ = try await server.waitForCallback()
            Issue.record("a stopped server must not serve its stale buffered callback")
        } catch let error as OAuthLoopbackError {
            #expect(error == .cancelled)
        }
    }
}
