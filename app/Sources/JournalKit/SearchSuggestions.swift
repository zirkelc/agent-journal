import Foundation

/**
 What the search dropdown offers. With an empty field it offers a way back to earlier searches; the
 Project filter already lists every project. While typing it offers the search itself, the projects
 the last word could mean, so a project filter can be set from the keyboard, and earlier searches
 that contain the text.
 */
public enum SearchSuggestion: Hashable, Sendable {
  case search(String)
  case recent(String)
  case project(String)
}

public enum SearchSuggestions {
  public static let maxRecents = 5
  public static let maxProjects = 6
  /** How many searches are remembered, which is more than are shown at once so matching finds older ones. */
  public static let maxStored = 10

  /** `projects` in the order to offer them when the last word matches, most recent first. */
  public static func build(text: String, recents: [String], projects: [String]) -> [SearchSuggestion] {
    let text = text.trimmingCharacters(in: .whitespaces)
    guard !text.isEmpty else {
      return recents.prefix(maxRecents).map(SearchSuggestion.recent)
    }

    var word = String(text.split(separator: " ").last ?? "")
    if word.hasPrefix("project:") { word.removeFirst("project:".count) }
    let matching = word.isEmpty ? [] : projects.filter { $0.localizedCaseInsensitiveContains(word) }
    let earlier = recents.filter { $0 != text && $0.localizedCaseInsensitiveContains(text) }

    return [.search(text)] + matching.prefix(maxProjects).map(SearchSuggestion.project) + earlier.prefix(maxRecents).map(SearchSuggestion.recent)
  }

  /** The text without its last word, which picking a project replaces with a filter. */
  public static func removingLastWord(_ text: String) -> String {
    var words = text.split(separator: " ")
    if !words.isEmpty { words.removeLast() }
    return words.joined(separator: " ")
  }

  /** Puts a search first, removing an earlier copy, and keeps at most ``maxStored``. Blank searches are not kept. */
  public static func remember(_ search: String, in recents: [String]) -> [String] {
    let search = search.trimmingCharacters(in: .whitespaces)
    guard !search.isEmpty else { return recents }
    return Array(([search] + recents.filter { $0 != search }).prefix(maxStored))
  }
}
