import Foundation
import Testing

@testable import JournalKit

@Suite struct FacetsTests {
  @Test func `orders the format's keys first and leaves out date and summary`() {
    // Arrange
    let text = "---\ndate: 2026-01-11T10:00:00Z\nmood: ok\nsummary: \"x\"\nagent: codex\nproject: a\ncwd: ~/a\n---\n"
    let parsed = EntryParser.parse(url: URL(fileURLWithPath: "/j/2026-01-11T100000Z.md"), text: text)!

    // Act
    let facets = Facets(entries: [parsed])

    // Assert
    #expect(facets.keys == ["project", "agent", "cwd", "mood"])
  }

  @Test func `counts values largest first`() {
    // Arrange
    let entries = [
      entry(date: "2026-01-11T10:00:00Z", project: "b"),
      entry(date: "2026-01-11T11:00:00Z", project: "a"),
      entry(date: "2026-01-11T12:00:00Z", project: "a"),
    ]

    // Act
    let nodes = Facets(entries: entries).nodes(for: "project")

    // Assert
    #expect(nodes.map(\.id) == ["a", "b"])
    #expect(nodes.map(\.count) == [2, 1])
  }

  @Test func `builds a tree of agents and models`() {
    // Arrange
    let entries = [
      entry(date: "2026-01-11T10:00:00Z", agent: "claude/opus-5"),
      entry(date: "2026-01-11T11:00:00Z", agent: "claude/sonnet-5"),
      entry(date: "2026-01-11T12:00:00Z", agent: "codex/gpt-5"),
    ]

    // Act
    let nodes = Facets(entries: entries).nodes(for: "agent")

    // Assert
    #expect(nodes.map(\.id) == ["claude", "codex/gpt-5"])
    #expect(nodes[0].count == 2)
    #expect(nodes[0].children.map(\.id) == ["claude/opus-5", "claude/sonnet-5"])
    #expect(nodes[1].name == "codex/gpt-5")
  }

  @Test func `folds a chain of single folders into one node`() {
    // Arrange
    let entries = [
      entry(date: "2026-01-11T10:00:00Z", cwd: "~/Developer/oss/my-lib"),
      entry(date: "2026-01-11T11:00:00Z", cwd: "~/Developer/nebula"),
      entry(date: "2026-01-11T12:00:00Z", cwd: "/tmp/scratch"),
    ]

    // Act
    let nodes = Facets(entries: entries).nodes(for: "cwd")

    // Assert
    #expect(nodes.map(\.id) == ["~/Developer", "/tmp/scratch"])
    #expect(nodes[0].children.map(\.id) == ["~/Developer/nebula", "~/Developer/oss/my-lib"])
    #expect(nodes[0].children[1].name == "oss/my-lib")
  }

  @Test func `keeps a node that has entries of its own and below it`() {
    // Arrange
    let entries = [
      entry(date: "2026-01-11T10:00:00Z", cwd: "~/Developer"),
      entry(date: "2026-01-11T11:00:00Z", cwd: "~/Developer/nebula"),
    ]

    // Act
    let nodes = Facets(entries: entries).nodes(for: "cwd")

    // Assert
    #expect(nodes.map(\.id) == ["~/Developer"])
    #expect(nodes[0].count == 2)
    #expect(nodes[0].children.map(\.id) == ["~/Developer/nebula"])
  }
}
