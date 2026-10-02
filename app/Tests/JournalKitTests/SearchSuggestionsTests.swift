import Foundation
import Testing

@testable import JournalKit

@Suite struct SearchSuggestionsTests {
  let projects = ["nebula", "agent-journal", "ai-retry", "spellbee"]

  @Test func `offers only recent searches for an empty field`() {
    // Act
    let result = SearchSuggestions.build(text: "  ", recents: ["retry", "project:nebula deploy"], projects: projects)

    // Assert
    #expect(result == [.recent("retry"), .recent("project:nebula deploy")])
  }

  @Test func `offers the search itself first, then projects matching the last word`() {
    // Act
    let result = SearchSuggestions.build(text: "deploy ne", recents: [], projects: projects)

    // Assert
    #expect(result == [.search("deploy ne"), .project("nebula")])
  }

  @Test func `matches projects after a project prefix`() {
    // Act
    let result = SearchSuggestions.build(text: "project:ai", recents: [], projects: projects)

    // Assert
    #expect(result == [.search("project:ai"), .project("ai-retry")])
  }

  @Test func `offers recent searches that contain the text, but not the text itself`() {
    // Act
    let result = SearchSuggestions.build(text: "retry", recents: ["retry", "retry storm", "deploy"], projects: [])

    // Assert
    #expect(result == [.search("retry"), .recent("retry storm")])
  }

  @Test func `limits each section`() {
    // Arrange
    let many = (1...20).map { "p\($0)" }

    // Act
    let result = SearchSuggestions.build(text: "p", recents: many, projects: many)

    // Assert
    #expect(result.filter { if case .recent = $0 { true } else { false } }.count == SearchSuggestions.maxRecents)
    #expect(result.filter { if case .project = $0 { true } else { false } }.count == SearchSuggestions.maxProjects)
  }

  @Test(arguments: [
    ("deploy ne", "deploy"),
    ("project:neb", ""),
    ("ne", ""),
    ("fix   project:ai", "fix"),
  ])
  func `removes the word a project was picked from`(text: String, expected: String) {
    // Act
    let result = SearchSuggestions.removingLastWord(text)

    // Assert
    #expect(result == expected)
  }

  @Test func `keeps recent searches newest first, without duplicates, bounded`() {
    // Arrange
    var recents = (1...10).map { "s\($0)" }

    // Act
    recents = SearchSuggestions.remember("s5", in: recents)
    recents = SearchSuggestions.remember("  new  ", in: recents)
    recents = SearchSuggestions.remember("   ", in: recents)

    // Assert
    #expect(recents.first == "new")
    #expect(recents[1] == "s5")
    #expect(recents.count == SearchSuggestions.maxStored)
    #expect(recents.filter { $0 == "s5" }.count == 1)
  }
}
