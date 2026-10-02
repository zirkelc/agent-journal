import Foundation

/**
 Full-text search over summaries and bodies, in memory.

 A year of entries is a few megabytes, so a plain substring scan answers in milliseconds and needs no
 index to build, store or keep in sync with files the agents write while the app is open. An index
 can replace this behind the same `Query` when a journal outgrows it.
 */
public enum TextSearch {
  /** Case- and diacritic-insensitive, so `cafe` finds `Café`. Applied to the entries once, and to the query. */
  public static func fold(_ text: String) -> String {
    text.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
      .precomposedStringWithCanonicalMapping
  }

  /**
   The terms of a query. Words are separate terms that must all appear, in any order. Text in double
   quotes is one term, so `"rate limit"` only finds the two words together.
   */
  public static func terms(_ query: String) -> [String] {
    var terms: [String] = []
    var current = ""
    var quoted = false

    for char in query {
      if char == "\"" {
        if !current.isEmpty { terms.append(current) }
        current = ""
        quoted.toggle()
      } else if char.isWhitespace && !quoted {
        if !current.isEmpty { terms.append(current) }
        current = ""
      } else {
        current.append(char)
      }
    }
    if !current.isEmpty { terms.append(current) }

    return terms.map(fold)
  }

  /** Whether every term appears in the entry. No terms match everything. */
  public static func matches(_ entry: Entry, terms: [String]) -> Bool {
    terms.allSatisfy { contains(entry.searchText, $0) }
  }

  /**
   A byte search over UTF-8. Both sides are folded and normalized the same way, so equal text is equal
   bytes, and this is many times faster than `String.contains`, which compares by grapheme. A match
   can in theory start inside a grapheme, such as a bare accent after a letter, which folding has
   already removed.
   */
  static func contains(_ haystack: String, _ needle: String) -> Bool {
    var haystack = haystack
    var needle = needle
    return haystack.withUTF8 { hay in
      needle.withUTF8 { pin in
        guard pin.count > 0 else { return true }
        return memmem(hay.baseAddress, hay.count, pin.baseAddress, pin.count) != nil
      }
    }
  }

  /** Where the terms appear in a text, for highlighting. */
  public static func ranges(of terms: [String], in text: String) -> [Range<String.Index>] {
    var ranges: [Range<String.Index>] = []
    for term in terms where !term.isEmpty {
      var start = text.startIndex
      while let range = text.range(of: term, options: [.caseInsensitive, .diacriticInsensitive], range: start..<text.endIndex) {
        ranges.append(range)
        start = range.upperBound
      }
    }
    return ranges.sorted { $0.lowerBound < $1.lowerBound }
  }
}
