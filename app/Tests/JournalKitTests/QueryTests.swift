import Foundation
import Testing

@testable import JournalKit

@Suite struct QueryTests {
  let calendar = fixedCalendar()

  @Test func `matches every entry when empty`() {
    // Arrange
    let query = Query()

    // Act
    let result = query.matcher(calendar: calendar)(entry(date: "2026-01-11T10:00:00Z"))

    // Assert
    #expect(result)
    #expect(query.isEmpty)
  }

  @Test func `treats values of one key as alternatives and keys as all required`() {
    // Arrange
    let query = Query(facets: ["project": ["nebula", "my-lib"], "agent": ["codex"]])
    let match = query.matcher(calendar: calendar)

    // Act
    let both = match(entry(date: "2026-01-11T10:00:00Z", project: "my-lib", agent: "codex/gpt-5"))
    let wrongAgent = match(entry(date: "2026-01-11T10:00:00Z", project: "nebula", agent: "claude/opus-5"))
    let noProject = match(entry(date: "2026-01-11T10:00:00Z", project: nil, agent: "codex"))

    // Assert
    #expect(both)
    #expect(!wrongAgent)
    #expect(!noProject)
  }

  @Test(arguments: [
    ("claude/opus-5", "claude", true),
    ("claude", "claude", true),
    ("claudette", "claude", false),
    ("~/Developer/nebula", "~/Developer", true),
    ("~/Developer2", "~/Developer", false),
    ("~/Developer", "~/Developer/", true),
  ])
  func `matches a value and everything below it`(value: String, filter: String, expected: Bool) {
    // Act
    let result = Query.value(value, matches: filter)

    // Assert
    #expect(result == expected)
  }

  @Test func `filters by local hour, wrapping past midnight`() {
    // Arrange
    let night = Query(hours: .night).matcher(calendar: calendar)

    // Act
    /** 22:30 UTC is 23:30 in Berlin in winter, 12:00 UTC is 13:00. */
    let late = night(entry(date: "2026-01-11T22:30:00Z"))
    let noon = night(entry(date: "2026-01-11T12:00:00Z"))

    // Assert
    #expect(late)
    #expect(!noon)
  }

  @Test func `searches summary and body, ignoring case and accents`() {
    // Arrange
    let match = Query(text: "cafe RETRY").matcher(calendar: calendar)

    // Act
    let found = match(entry(date: "2026-01-11T10:00:00Z", summary: "Fixed the retry", body: "In the Café module."))
    let missing = match(entry(date: "2026-01-11T10:00:00Z", summary: "Fixed the retry", body: "Elsewhere."))

    // Assert
    #expect(found)
    #expect(!missing)
  }

  @Test func `keeps a quoted phrase together`() {
    // Arrange
    let match = Query(text: "\"rate limit\"").matcher(calendar: calendar)

    // Act
    let together = match(entry(date: "2026-01-11T10:00:00Z", body: "Hit the rate limit."))
    let apart = match(entry(date: "2026-01-11T10:00:00Z", body: "The limit on the rate."))

    // Assert
    #expect(together)
    #expect(!apart)
  }

  @Test func `toggles a value on and off`() {
    // Arrange
    var query = Query()

    // Act
    query.toggle("project", "nebula")
    let on = query.contains("project", "nebula")
    query.toggle("project", "nebula")

    // Assert
    #expect(on)
    #expect(query.facets["project"] == nil)
    #expect(query.isEmpty)
  }

  @Test func `selects one value, replacing the others of that key only`() {
    // Arrange
    var query = Query(facets: ["cwd": ["~/a", "~/b"], "project": ["nebula"]])

    // Act
    query.select("cwd", "~/c")

    // Assert
    #expect(query.facets["cwd"] == ["~/c"])
    #expect(query.facets["project"] == ["nebula"])
  }

  @Test func `clears a key when its only value is selected again`() {
    // Arrange
    var query = Query(facets: ["cwd": ["~/a"]])

    // Act
    query.select("cwd", "~/a")

    // Assert
    #expect(query.facets["cwd"] == nil)
  }

  @Test func `narrows to one value when it is one of several`() {
    // Arrange
    var query = Query(facets: ["cwd": ["~/a", "~/b"]])

    // Act
    query.select("cwd", "~/a")

    // Assert
    #expect(query.facets["cwd"] == ["~/a"])
  }

  @Test func `splits typed search into filters and text`() {
    // Act
    let result = SearchInput.parse("project:nebula error: timeout cwd:\"~/My Code\" unknown:x", keys: ["project", "cwd"])

    // Assert
    #expect(result.tokens == [SearchInput.Token(key: "project", value: "nebula"), SearchInput.Token(key: "cwd", value: "~/My Code")])
    #expect(result.text == "error: timeout unknown:x")
  }

  @Test func `highlights every occurrence of every term`() {
    // Arrange
    let text = "Retry the retry, then Café."

    // Act
    let ranges = TextSearch.ranges(of: TextSearch.terms("retry cafe"), in: text)

    // Assert
    #expect(ranges.map { String(text[$0]) } == ["Retry", "retry", "Café"])
  }
}
