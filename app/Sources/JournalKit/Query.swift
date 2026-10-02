import Foundation

/** A span of hours in the local day. It can wrap past midnight, so night is 22 to 5. */
public struct HourRange: Hashable, Codable, Sendable {
  /** The first hour, 0 to 23. */
  public let from: Int
  /** The first hour no longer in the range, 0 to 24. */
  public let to: Int

  public init(from: Int, to: Int) {
    self.from = from
    self.to = to
  }

  public func contains(hour: Int) -> Bool {
    from <= to ? (hour >= from && hour < to) : (hour >= from || hour < to)
  }

  public static let morning = HourRange(from: 5, to: 12)
  public static let afternoon = HourRange(from: 12, to: 17)
  public static let evening = HourRange(from: 17, to: 22)
  public static let night = HourRange(from: 22, to: 5)

  /** The named ranges the time picker and the filter pill offer, in the order they are offered. */
  public static let presets: [(name: String, range: HourRange)] = [
    ("Morning", .morning), ("Afternoon", .afternoon), ("Evening", .evening), ("Night", .night),
  ]

  /** The preset this range is, if any. */
  public var presetName: String? {
    Self.presets.first { $0.range == self }?.name
  }

  /**
   A range from two picked hours, or nil when they span the whole day, which is no filter at all. A
   start of 24 is midnight, the same as 0.
   */
  public static func normalized(from: Int, to: Int) -> HourRange? {
    let from = from % 24
    if from == to % 24 || (from == 0 && to == 24) { return nil }
    return HourRange(from: from, to: to)
  }
}

/**
 Which entries to show, apart from the period. It is also what a saved filter stores, which is why the
 period is not part of it: a saved filter like "nebula, decisions" applies to whatever period is open.

 Values within one key are alternatives and keys must all hold, so `project: a, b` with `agent: codex`
 means (a or b) and codex.
 */
public struct Query: Hashable, Codable, Sendable {
  public var facets: [String: Set<String>]
  public var hours: HourRange?
  public var text: String

  public init(facets: [String: Set<String>] = [:], hours: HourRange? = nil, text: String = "") {
    self.facets = facets
    self.hours = hours
    self.text = text
  }

  /**
   The filter value for entries that do not have the field at all. An empty string, because no real
   value is ever empty: a field without a value counts as not recorded.
   */
  public static let notRecorded = ""

  public var isEmpty: Bool {
    facets.values.allSatisfy(\.isEmpty) && hours == nil && text.trimmingCharacters(in: .whitespaces).isEmpty
  }

  /**
   Whether a field value matches a filter value. A value also matches everything below it, split at
   `/`: `claude` matches `claude/opus-5`, and `~/Developer` matches `~/Developer/nebula`. The same rule
   serves agents and directories, and a project name has no `/` so it only matches itself.
   */
  public static func value(_ value: String, matches filter: String) -> Bool {
    let filter = filter.count > 1 && filter.hasSuffix("/") ? String(filter.dropLast()) : filter
    return value == filter || value.hasPrefix(filter + "/")
  }

  public mutating func toggle(_ key: String, _ value: String) {
    var values = facets[key] ?? []
    if values.contains(value) { values.remove(value) } else { values.insert(value) }
    facets[key] = values.isEmpty ? nil : values
  }

  /**
   Makes one value the only one for its key, the way a plain click selects in a list. Selecting the
   only selected value again clears the key, so a second click undoes the first. Other keys are kept.
   */
  public mutating func select(_ key: String, _ value: String) {
    facets[key] = facets[key] == [value] ? nil : [value]
  }

  public func contains(_ key: String, _ value: String) -> Bool {
    facets[key]?.contains(value) ?? false
  }

  /** A matcher for many entries, so that the text is split and folded once rather than once per entry. */
  public func matcher(calendar: Calendar = .autoupdatingCurrent) -> @Sendable (Entry) -> Bool {
    let terms = TextSearch.terms(text)
    let facets = facets.filter { !$0.value.isEmpty }
    let hours = hours

    return { entry in
      for (key, values) in facets {
        /** Every value of a repeated key counts, the same way the facet counts do. */
        let present = entry.values(key)
        if !present.isEmpty {
          let matches = present.contains { value in
            values.contains { $0 != Query.notRecorded && Query.value(value, matches: $0) }
          }
          guard matches else { return false }
        } else {
          guard values.contains(Query.notRecorded) else { return false }
        }
      }
      if let hours, !hours.contains(hour: calendar.component(.hour, from: entry.date)) {
        return false
      }
      return TextSearch.matches(entry, terms: terms)
    }
  }
}

/** A query with a name, kept in the sidebar. */
public struct SavedFilter: Identifiable, Hashable, Codable, Sendable {
  public var id: UUID
  public var name: String
  public var query: Query

  public init(id: UUID = UUID(), name: String, query: Query) {
    self.id = id
    self.name = name
    self.query = query
  }
}

/**
 Splits typed search text into filters and free text, so `project:nebula retry` filters by project and
 searches for `retry`. Only keys the journal actually has are taken as filters, so a colon in ordinary
 text, like `error: timeout`, stays text.
 */
public enum SearchInput {
  public struct Token: Hashable, Sendable {
    public let key: String
    public let value: String

    public init(key: String, value: String) {
      self.key = key
      self.value = value
    }
  }

  public static func parse(_ input: String, keys: Set<String>) -> (tokens: [Token], text: String) {
    var tokens: [Token] = []
    var rest: [String] = []

    for word in words(input) {
      if let colon = word.firstIndex(of: ":") {
        let key = String(word[..<colon])
        var value = String(word[word.index(after: colon)...])
        if value.count >= 2, value.hasPrefix("\""), value.hasSuffix("\"") {
          value = String(value.dropFirst().dropLast())
        }
        if keys.contains(key), !value.isEmpty {
          tokens.append(Token(key: key, value: value))
          continue
        }
      }
      rest.append(word)
    }
    return (tokens, rest.joined(separator: " "))
  }

  /** Whitespace-separated words, where a double-quoted part keeps its spaces: `cwd:"~/My Code"`. */
  private static func words(_ input: String) -> [String] {
    var words: [String] = []
    var current = ""
    var quoted = false
    for char in input {
      if char == "\"" { quoted.toggle() }
      if char.isWhitespace && !quoted {
        if !current.isEmpty { words.append(current) }
        current = ""
      } else {
        current.append(char)
      }
    }
    if !current.isEmpty { words.append(current) }
    return words
  }
}
