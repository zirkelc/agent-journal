import Foundation

/** The frontmatter keys the journal format defines. Any other key an entry carries is kept and filterable too. */
public enum FieldKey {
  public static let date = "date"
  public static let project = "project"
  public static let summary = "summary"
  public static let cwd = "cwd"
  public static let agent = "agent"
  public static let sessionID = "session_id"
}

/**
 One journal entry. The filename is the instant it records, the frontmatter is a flat list of fields
 in the order they were written, and everything after it is the body.
 */
public struct Entry: Identifiable, Sendable {
  public struct Field: Hashable, Sendable {
    public let key: String
    public let value: String

    public init(key: String, value: String) {
      self.key = key
      self.value = value
    }
  }

  /** The filename without `.md`, for example `2026-01-11T143000Z`. Unique within a journal. */
  public let id: String
  public let url: URL
  public let date: Date
  public let fields: [Field]
  public let body: String
  /** The file exactly as it is on disk, for the raw view. */
  public let raw: String
  /** Summary and body, folded once at load so that a search does not fold every entry on every keystroke. */
  let searchText: String

  public init(id: String, url: URL, date: Date, fields: [Field], body: String, raw: String) {
    self.id = id
    self.url = url
    self.date = date
    self.fields = fields
    self.body = body
    self.raw = raw
    let summary = fields.first { $0.key == FieldKey.summary }?.value ?? ""
    self.searchText = TextSearch.fold(summary + "\n" + body)
  }

  /** The first value of a key. */
  public func value(_ key: String) -> String? {
    fields.first { $0.key == key }?.value
  }

  /** Every value of a key, for a key a hand-written entry repeats. */
  public func values(_ key: String) -> [String] {
    fields.filter { $0.key == key && !$0.value.isEmpty }.map(\.value)
  }

  public var summary: String { value(FieldKey.summary) ?? "" }
  public var project: String? { value(FieldKey.project) }
  public var cwd: String? { value(FieldKey.cwd) }
  public var agent: String? { value(FieldKey.agent) }
  public var sessionID: String? { value(FieldKey.sessionID) }
}

/** Two entries are the same when they are the same file with the same content, which is what a reload has to detect. */
extension Entry: Hashable {
  public static func == (lhs: Entry, rhs: Entry) -> Bool {
    lhs.id == rhs.id && lhs.raw == rhs.raw
  }

  public func hash(into hasher: inout Hasher) {
    hasher.combine(id)
  }
}
