import Foundation
import Testing

@testable import JournalKit

@Suite struct SavedFilterStoreTests {
  @Test func `has no filters before the first save`() throws {
    // Arrange
    let dir = try ScratchDirectory()
    let store = SavedFilterStore(url: dir.url.appending(path: "nested/filters.json"))

    // Act
    let filters = try store.load()

    // Assert
    #expect(filters.count == 0)
  }

  @Test func `round-trips filters through the file`() throws {
    // Arrange
    let dir = try ScratchDirectory()
    let store = SavedFilterStore(url: dir.url.appending(path: "nested/filters.json"))
    let filters = [
      SavedFilter(name: "nebula, decisions", query: Query(facets: ["project": ["nebula"]], text: "decided")),
      SavedFilter(name: "codex, mornings", query: Query(facets: ["agent": ["codex"]], hours: .morning)),
    ]

    // Act
    try store.save(filters)
    let loaded = try store.load()

    // Assert
    #expect(loaded == filters)
  }
}

@Suite struct JournalCLITests {
  /** The checkout's own CLI, against a config directory of the test's own. */
  func cli(_ dir: ScratchDirectory) throws -> JournalCLI {
    let cli = try #require(JournalCLI.bundled())
    return JournalCLI(executable: cli.executable, environment: ["XDG_CONFIG_HOME": dir.url.appending(path: "config").path])
  }

  @Test func `reads the default journal directory`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    let cli = try cli(dir)

    // Act
    let config = try await cli.config()

    // Assert
    #expect(config.isDefault)
    #expect(config.journalDir.path == FileManager.default.homeDirectoryForCurrentUser.appending(path: "agent-journal").path)
    #expect(config.configFile.path == dir.url.appending(path: "config/agent-journal/config").path)
  }

  @Test func `sets and resets the journal directory`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    let cli = try cli(dir)
    let target = dir.url.appending(path: "journal")

    // Act
    try await cli.setJournalDir(target.path)
    let set = try await cli.config()
    try await cli.resetJournalDir()
    let reset = try await cli.config()

    // Assert
    #expect(!set.isDefault)
    #expect(set.journalDir.path == target.path)
    #expect(FileManager.default.fileExists(atPath: target.path))
    #expect(reset.isDefault)
  }
}
