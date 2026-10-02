import Foundation
import Testing

@testable import JournalKit

@Suite struct EntryParserTests {
  @Test func `reads the date from the filename in UTC`() {
    // Act
    let result = EntryParser.date(fromStem: "2026-01-11T143000Z")

    // Assert
    #expect(result == date("2026-01-11T14:30:00Z"))
  }

  @Test(arguments: ["README", "2026-01-11", "2026-01-11T1430Z", "2026-13-11T143000Z", "2026-01-11T143000", "2026-01-11T14300xZ"])
  func `rejects a stem that is not an entry name`(stem: String) {
    // Act
    let result = EntryParser.date(fromStem: stem)

    // Assert
    #expect(result == nil)
  }

  @Test func `parses every field in order and the body`() throws {
    // Arrange
    let text = """
      ---
      date: 2026-01-11T14:30:00Z
      project: my-lib
      summary: "Shipped the sync path: prepared statements now."
      cwd: ~/Developer/oss/my-lib
      agent: claude/opus-5
      session_id: 4eb89b17
      ---

      First paragraph.

      Second paragraph.
      """

    // Act
    let entry = try #require(EntryParser.parse(url: URL(fileURLWithPath: "/j/2026-01-11T143000Z.md"), text: text))

    // Assert
    #expect(entry.id == "2026-01-11T143000Z")
    #expect(entry.fields.map(\.key) == ["date", "project", "summary", "cwd", "agent", "session_id"])
    #expect(entry.summary == "Shipped the sync path: prepared statements now.")
    #expect(entry.project == "my-lib")
    #expect(entry.cwd == "~/Developer/oss/my-lib")
    #expect(entry.sessionID == "4eb89b17")
    #expect(entry.body == "First paragraph.\n\nSecond paragraph.")
    #expect(entry.raw == text)
  }

  @Test func `decodes escapes inside a quoted value`() throws {
    // Arrange
    let text = #"---\#nsummary: "Fails without \"Version released\" in C:\\temp"\#n---\#n"#

    // Act
    let entry = try #require(EntryParser.parse(url: URL(fileURLWithPath: "/j/2026-01-11T143000Z.md"), text: text))

    // Assert
    #expect(entry.summary == #"Fails without "Version released" in C:\temp"#)
  }

  @Test func `keeps keys the format does not define`() throws {
    // Arrange
    let text = "---\ndate: 2026-01-11T14:30:00Z\nmood: tired\n---\nbody"

    // Act
    let entry = try #require(EntryParser.parse(url: URL(fileURLWithPath: "/j/2026-01-11T143000Z.md"), text: text))

    // Assert
    #expect(entry.value("mood") == "tired")
  }

  @Test func `treats a file without frontmatter as all body`() throws {
    // Arrange
    let text = "Just some notes.\n"

    // Act
    let entry = try #require(EntryParser.parse(url: URL(fileURLWithPath: "/j/2026-01-11T143000Z.md"), text: text))

    // Assert
    #expect(entry.fields.count == 0)
    #expect(entry.body == "Just some notes.")
  }

  @Test func `treats an unclosed fence as body rather than dropping it`() throws {
    // Arrange
    let text = "---\ndate: 2026-01-11T14:30:00Z\nno closing fence"

    // Act
    let entry = try #require(EntryParser.parse(url: URL(fileURLWithPath: "/j/2026-01-11T143000Z.md"), text: text))

    // Assert
    #expect(entry.fields.count == 0)
    #expect(entry.body == text)
  }

  @Test func `reads files with Windows line endings`() throws {
    // Arrange
    let text = "---\r\nproject: nebula\r\n---\r\nbody\r\n"

    // Act
    let entry = try #require(EntryParser.parse(url: URL(fileURLWithPath: "/j/2026-01-11T143000Z.md"), text: text))

    // Assert
    #expect(entry.project == "nebula")
  }

  @Test func `skips lines in the frontmatter that are not fields`() throws {
    // Arrange
    let text = "---\n# a comment\nproject: nebula\n  indented: no\n---\n"

    // Act
    let entry = try #require(EntryParser.parse(url: URL(fileURLWithPath: "/j/2026-01-11T143000Z.md"), text: text))

    // Assert
    #expect(entry.fields == [Entry.Field(key: "project", value: "nebula")])
  }

  @Test func `ignores files that are not entries`() {
    // Act
    let readme = EntryParser.parse(url: URL(fileURLWithPath: "/j/README.md"), text: "# Journal")
    let text = EntryParser.parse(url: URL(fileURLWithPath: "/j/2026-01-11T143000Z.txt"), text: "body")

    // Assert
    #expect(readme == nil)
    #expect(text == nil)
  }
}
