import Foundation

/**
 Where a text search looks. A search is a question about the whole journal, so by default it ignores
 the period the calendar shows; limiting it to that period is a choice made while searching. Without
 search text the period applies as always.
 */
public enum SearchScope: Hashable, Sendable {
  case all
  case period

  /** The period the list is limited to, given the selected one and the search text. Nil means every entry. */
  public func period(_ selected: Period?, text: String) -> Period? {
    guard Self.isSearching(text) else { return selected }
    return self == .period ? selected : nil
  }

  /** Whether choosing a scope means anything: only while searching, and only when a period is selected. */
  public static func offersChoice(period: Period?, text: String) -> Bool {
    period != nil && isSearching(text)
  }

  public static func isSearching(_ text: String) -> Bool {
    !text.trimmingCharacters(in: .whitespaces).isEmpty
  }
}
