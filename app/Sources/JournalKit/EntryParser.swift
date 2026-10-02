import Foundation

/**
 Reads entries in the journal format: `YYYY-MM-DDTHHMMSSZ.md`, frontmatter between two `---` lines,
 then the body.

 The frontmatter is flat `key: value` lines, so it is read line by line rather than through a YAML
 parser. That is also how the CLI reads it, so the app and the CLI agree on what an entry says even
 when an entry is not valid YAML, which a hand-written one often is not.
 */
public enum EntryParser {
  private static let utc: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
  }()

  /**
   The instant a filename stem records, or nil when the stem is not an entry name. A journal directory
   is a plain directory and often holds a README, and this check is what keeps it out.
   */
  public static func date(fromStem stem: String) -> Date? {
    let chars = Array(stem.utf8)
    guard chars.count == 18, chars[4] == UInt8(ascii: "-"), chars[7] == UInt8(ascii: "-"),
      chars[10] == UInt8(ascii: "T"), chars[17] == UInt8(ascii: "Z")
    else { return nil }

    func number(_ range: Range<Int>) -> Int? {
      var value = 0
      for index in range {
        let char = chars[index]
        guard char >= UInt8(ascii: "0"), char <= UInt8(ascii: "9") else { return nil }
        value = value * 10 + Int(char - UInt8(ascii: "0"))
      }
      return value
    }

    guard let year = number(0..<4), let month = number(5..<7), let day = number(8..<10),
      let hour = number(11..<13), let minute = number(13..<15), let second = number(15..<17)
    else { return nil }

    let components = DateComponents(year: year, month: month, day: day, hour: hour, minute: minute, second: second)
    guard components.isValidDate(in: utc) else { return nil }
    return utc.date(from: components)
  }

  /** Parses one file. Returns nil when the filename is not an entry name. */
  public static func parse(url: URL, text: String) -> Entry? {
    let stem = url.deletingPathExtension().lastPathComponent
    guard url.pathExtension == "md", let date = date(fromStem: stem) else { return nil }

    let (fields, body) = split(text)
    return Entry(id: stem, url: url, date: date, fields: fields, body: body, raw: text)
  }

  /**
   Separates the frontmatter from the body. A file without an opening fence, or with an opening fence
   that is never closed, has no frontmatter and is all body, so nothing in it is silently dropped.
   */
  static func split(_ text: String) -> ([Entry.Field], String) {
    /** By `isNewline` rather than by `"\n"`, because Swift reads `"\r\n"` as one character that `"\n"` does not match. */
    var lines = text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline)

    guard lines.first == "---", let close = lines.dropFirst().firstIndex(of: "---") else {
      return ([], text.trimmingCharacters(in: .newlines))
    }

    var fields: [Entry.Field] = []
    for line in lines[1..<close] {
      if let field = field(line) { fields.append(field) }
    }

    lines.removeSubrange(0...close)
    let body = lines.joined(separator: "\n").trimmingCharacters(in: .newlines)
    return (fields, body)
  }

  /** One `key: value` line. A line that is not one, such as a comment or a stray continuation, is skipped. */
  static func field(_ line: Substring) -> Entry.Field? {
    guard let colon = line.firstIndex(of: ":") else { return nil }
    let key = line[..<colon]
    guard let first = key.first, first.isLetter || first == "_",
      key.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" })
    else { return nil }

    var value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    /** Quotes are punctuation, not part of the value. The summary is always quoted, and any value with a colon should be. */
    if value.count >= 2, value.hasPrefix("\""), value.hasSuffix("\"") {
      value = unescape(value.dropFirst().dropLast())
    }
    return Entry.Field(key: String(key), value: value)
  }

  /**
   Decodes the backslash escapes of a double-quoted value. Agents escape a quote inside a summary as
   `\"`, which is what a YAML reader expects, so showing it as written would show the backslash.
   */
  static func unescape(_ text: Substring) -> String {
    guard text.contains("\\") else { return String(text) }
    var result = ""
    var escaped = false
    for char in text {
      if escaped {
        switch char {
        case "n": result.append("\n")
        case "t": result.append("\t")
        default: result.append(char)
        }
        escaped = false
      } else if char == "\\" {
        escaped = true
      } else {
        result.append(char)
      }
    }
    if escaped { result.append("\\") }
    return result
  }
}
