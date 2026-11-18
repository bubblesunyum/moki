import Foundation

// MARK: - Gmail parsing
//
// Pure parsing for the Gmail client: header/address handling, RFC2047,
// date parsing, the MIME walk, and base64url/charset decoding. No network,
// no actors — the `GmailClient` actor in `GmailClient.swift` keeps requests
// and row building and calls into these helpers.

// MARK: - Headers

/// Case-insensitive header map from a payload's header list.
func headerMap(_ headers: [GmailHeader]?) -> [String: String] {
    var out: [String: String] = [:]
    for header in headers ?? [] {
        let key = header.name.lowercased()
        if out[key] == nil { out[key] = header.value }
    }
    return out
}

func messageSubject(_ message: GmailMessage) -> String {
    let headers = headerMap(message.payload?.headers)
    return nonEmpty(decodeRFC2047(headers["subject"] ?? "")) ?? "(No subject)"
}

func nonEmpty(_ s: String) -> String? {
    let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

// MARK: - Address parsing

/// Split a To/Cc header on commas, respecting quoted display names
/// (`"Last, First" <a@b>` stays one address).
func splitAddresses(_ value: String) -> [String] {
    var out: [String] = []
    var current = ""
    var inQuotes = false
    var escaped = false
    for char in value {
        if escaped {
            current.append(char)
            escaped = false
        } else if char == "\\" && inQuotes {
            current.append(char)
            escaped = true
        } else if char == "\"" {
            inQuotes.toggle()
            current.append(char)
        } else if char == "," && !inQuotes {
            let trimmed = current.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { out.append(trimmed) }
            current = ""
        } else {
            current.append(char)
        }
    }
    let trimmed = current.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty { out.append(trimmed) }
    return out
}

/// Parse `Name <addr>`, `"Name" <addr>`, `<addr>`, or a bare address.
/// A bare address doubles as its own display name so `EmailAddress.name`
/// is always populated.
func parseEmailAddress(_ raw: String) -> EmailAddress {
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return EmailAddress(name: "", address: "") }
    if let open = value.lastIndex(of: "<"), let close = value.lastIndex(of: ">"), open < close {
        let address = String(value[value.index(after: open)..<close])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var name = String(value[..<open]).trimmingCharacters(in: .whitespacesAndNewlines)
        if name.hasPrefix("\"") && name.hasSuffix("\"") && name.count >= 2 {
            name = String(name.dropFirst().dropLast())
        }
        let decoded = decodeRFC2047(name).trimmingCharacters(in: .whitespacesAndNewlines)
        return EmailAddress(name: decoded.isEmpty ? address : decoded, address: address)
    }
    let bare = value.trimmingCharacters(in: CharacterSet(charactersIn: "<> "))
    return EmailAddress(name: bare, address: bare)
}

// MARK: - RFC2047 encoded words

/// Decode `=?charset?B|Q?text?=` words in display names and subjects.
/// Unknown charsets or malformed words pass through untouched.
func decodeRFC2047(_ value: String) -> String {
    guard value.contains("=?") else { return value }
    let pattern = #"=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?="#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return value }
    let ns = value as NSString
    let matches = regex.matches(in: value, range: NSRange(location: 0, length: ns.length))
    guard !matches.isEmpty else { return value }
    var out = ""
    var cursor = value.startIndex
    for match in matches {
        guard let range = Range(match.range, in: value),
            let charsetRange = Range(match.range(at: 1), in: value),
            let encodingRange = Range(match.range(at: 2), in: value),
            let textRange = Range(match.range(at: 3), in: value)
        else { continue }
        out += value[cursor..<range.lowerBound]
        let charset = String(value[charsetRange])
        let encoding = String(value[encodingRange]).uppercased()
        let text = String(value[textRange])
        if let decoded = decodeRFC2047Word(text: text, encoding: encoding, charset: charset) {
            out += decoded
        } else {
            out += String(value[range])
        }
        cursor = range.upperBound
    }
    out += value[cursor...]
    return out
}

private func decodeRFC2047Word(text: String, encoding: String, charset: String) -> String? {
    guard isKnownCharset(charset) else { return nil }
    if encoding == "B" {
        var padded = text
        let remainder = padded.count % 4
        if remainder == 1 { return nil }
        if remainder > 0 { padded += String(repeating: "=", count: 4 - remainder) }
        guard let data = Data(base64Encoded: padded) else { return nil }
        return stringFromBytes(data, charset: charset)
    } else {
        var bytes: [UInt8] = []
        bytes.reserveCapacity(text.utf8.count)
        var index = text.startIndex
        while index < text.endIndex {
            let char = text[index]
            if char == "_" {
                bytes.append(0x20)
                index = text.index(after: index)
            } else if char == "=" {
                let hexStart = text.index(after: index)
                guard hexStart < text.endIndex,
                    let hexEnd = text.index(hexStart, offsetBy: 2, limitedBy: text.endIndex),
                    hexEnd <= text.endIndex
                else { return nil }
                let hex = String(text[hexStart..<hexEnd])
                guard hex.count == 2, let byte = UInt8(hex, radix: 16) else { return nil }
                bytes.append(byte)
                index = hexEnd
            } else {
                for byte in String(char).utf8 { bytes.append(byte) }
                index = text.index(after: index)
            }
        }
        return stringFromBytes(Data(bytes), charset: charset)
    }
}

// MARK: - Dates

private let rfc2822Formats = [
    "EEE, dd MMM yyyy HH:mm:ss Z",
    "EEE, d MMM yyyy HH:mm:ss Z",
    "EEE, dd MMM yyyy HH:mm:ss zzz",
    "EEE, d MMM yyyy HH:mm:ss zzz",
    "dd MMM yyyy HH:mm:ss Z",
    "d MMM yyyy HH:mm:ss Z",
    "EEE, dd MMM yyyy HH:mm Z",
    "EEE, dd MMM yyyy HH:mm:ss",
]

/// Parse a Date header (RFC2822, GMT assumed when no zone is present).
func parseEmailDate(_ value: String) -> Date? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    for format in rfc2822Formats {
        formatter.dateFormat = format
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        if let date = formatter.date(from: trimmed) { return date }
    }
    return nil
}

func internalMessageDate(_ internalDate: String?) -> Date? {
    guard let internalDate,
        let millis = Double(internalDate.trimmingCharacters(in: .whitespacesAndNewlines))
    else { return nil }
    return Date(timeIntervalSince1970: millis / 1000)
}

/// Newest date across a thread's messages: Date header first, then the
/// latest internalDate, then now (never nil so sorting is total).
func latestDate(messages: [GmailMessage], headers: [String: String]) -> Date {
    if let first = headers["date"], let parsed = parseEmailDate(first) {
        // The list row shows the thread's newest activity; check siblings
        // for anything newer carried only as internalDate.
        var best = parsed
        for message in messages {
            if let candidate = internalMessageDate(message.internalDate), candidate > best {
                best = candidate
            }
        }
        return best
    }
    let internals = messages.compactMap { internalMessageDate($0.internalDate) }
    return internals.max() ?? Date()
}

func messageDate(headers: [String: String], internalDate: String?) -> Date {
    if let raw = headers["date"], let parsed = parseEmailDate(raw) { return parsed }
    return internalMessageDate(internalDate) ?? Date()
}

private func makeISOFormatter() -> ISO8601DateFormatter {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
}

func iso8601String(_ date: Date) -> String {
    makeISOFormatter().string(from: date)
}

/// Parse back an ISO8601 date string for merge sorting. Never nil so the
/// sort is total even if a row carries a malformed date.
func mailSortDate(_ iso: String) -> Date {
    makeISOFormatter().date(from: iso) ?? Date.distantPast
}

func unionLabelIds(messages: [GmailMessage]) -> [String] {
    var seen = Set<String>()
    var out: [String] = []
    for message in messages {
        for id in message.labelIds ?? [] where seen.insert(id).inserted {
            out.append(id)
        }
    }
    return out
}

// MARK: - Bodies (base64url + charset, html preferred)

struct CollectedBodies {
    var html: String?
    var text: String?
}

/// Depth-first walk of the MIME tree, keeping the first text/html and the
/// first text/plain part. Callers prefer html over plain.
func collectBodies(_ part: GmailPart, into collected: inout CollectedBodies) {
    if let data = part.body?.data, !data.isEmpty {
        let charset = parseCharset(fromContentType: partContentType(part))
        if part.mimeType?.lowercased() == "text/html", collected.html == nil,
            let raw = decodeBase64URL(data)
        {
            collected.html = stringFromBytes(raw, charset: charset)
        } else if part.mimeType?.lowercased() == "text/plain", collected.text == nil,
            let raw = decodeBase64URL(data)
        {
            collected.text = stringFromBytes(raw, charset: charset)
        }
    }
    for child in part.parts ?? [] {
        if collected.html != nil && collected.text != nil { break }
        collectBodies(child, into: &collected)
    }
}

private func partContentType(_ part: GmailPart) -> String? {
    headerMap(part.headers)["content-type"]
}

/// Pull `charset=` out of a Content-Type header value, if present.
func parseCharset(fromContentType value: String?) -> String? {
    guard let value else { return nil }
    for segment in value.split(separator: ";").dropFirst() {
        let pair = segment.split(separator: "=", maxSplits: 1)
        guard pair.count == 2 else { continue }
        let key = pair[0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard key == "charset" else { continue }
        var charset = pair[1].trimmingCharacters(in: .whitespacesAndNewlines)
        if charset.hasPrefix("\"") && charset.hasSuffix("\"") && charset.count >= 2 {
            charset = String(charset.dropFirst().dropLast())
        }
        return charset.isEmpty ? nil : charset
    }
    return nil
}

/// True when `stringFromBytes` can honor the charset (so RFC2047 words in
/// unknown charsets pass through untouched instead of guessing).
private func isKnownCharset(_ charset: String) -> Bool {
    let name = charset.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if name == "utf-8" || name == "utf8" || name == "us-ascii" || name == "ascii" {
        return true
    }
    return CFStringConvertIANACharSetNameToEncoding(name as CFString) != kCFStringEncodingInvalidId
}

/// Gmail uses base64url without padding.
func decodeBase64URL(_ value: String) -> Data? {
    let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !cleaned.isEmpty else { return nil }
    var base64 =
        cleaned
        .replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/")
    let remainder = base64.count % 4
    if remainder == 1 { return nil }
    if remainder > 0 { base64 += String(repeating: "=", count: 4 - remainder) }
    return Data(base64Encoded: base64)
}

/// Decode bytes with an IANA charset name (`utf-8` assumed). Falls back
/// through utf-8 then latin-1 so blind text survives unknown charsets.
func stringFromBytes(_ data: Data, charset: String?) -> String {
    let name =
        charset?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? "utf-8"
    if name == "utf-8" || name == "utf8" || name == "us-ascii" || name == "ascii" {
        return String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
    }
    let cfEncoding = CFStringConvertIANACharSetNameToEncoding(name as CFString)
    if cfEncoding != kCFStringEncodingInvalidId {
        let nsEncoding = CFStringConvertEncodingToNSStringEncoding(cfEncoding)
        let encoding = String.Encoding(rawValue: nsEncoding)
        if let decoded = String(data: data, encoding: encoding) { return decoded }
    }
    return String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
}
