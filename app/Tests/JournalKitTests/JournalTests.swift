import Foundation
import Testing

@testable import JournalKit

@Suite @MainActor struct JournalTests {
  @Test func `loads entries newest first and skips other files`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    try dir.write("2026-01-11T100000Z.md", entryText(date: "2026-01-11T10:00:00Z", project: "a"))
    try dir.write("2026-01-12T100000Z.md", entryText(date: "2026-01-12T10:00:00Z", project: "b"))
    try dir.write("README.md", "# My journal")
    try dir.write("notes.txt", "scratch")
    let journal = Journal()

    // Act
    await journal.open(dir.url)

    // Assert
    #expect(journal.state == .ready)
    #expect(journal.entries.map(\.id) == ["2026-01-12T100000Z", "2026-01-11T100000Z"])
    #expect(journal.facets.nodes(for: "project").map(\.id) == ["a", "b"])
  }

  @Test func `reports a directory that does not exist yet`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    let journal = Journal()

    // Act
    await journal.open(dir.url.appending(path: "missing"))

    // Assert
    #expect(journal.state == .missing)
    #expect(journal.entries.count == 0)
  }

  @Test func `picks up added, changed and removed entries on refresh`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    try dir.write("2026-01-11T100000Z.md", entryText(date: "2026-01-11T10:00:00Z", summary: "first"))
    try dir.write("2026-01-12T100000Z.md", entryText(date: "2026-01-12T10:00:00Z"))
    let journal = Journal()
    await journal.open(dir.url)

    // Act
    try dir.write("2026-01-11T100000Z.md", entryText(date: "2026-01-11T10:00:00Z", summary: "first, edited later"))
    try FileManager.default.removeItem(at: dir.url.appending(path: "2026-01-12T100000Z.md"))
    try dir.write("2026-01-13T100000Z.md", entryText(date: "2026-01-13T10:00:00Z"))
    await journal.refresh()

    // Assert
    #expect(journal.entries.map(\.id) == ["2026-01-13T100000Z", "2026-01-11T100000Z"])
    #expect(journal.entries[1].summary == "first, edited later")
  }

  @Test func `notifies once per change and not when nothing changed`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    try dir.write("2026-01-11T100000Z.md", entryText(date: "2026-01-11T10:00:00Z"))
    let journal = Journal()
    await journal.open(dir.url)
    var calls = 0
    journal.onChange = { calls += 1 }

    // Act
    await journal.refresh()
    try dir.write("2026-01-12T100000Z.md", entryText(date: "2026-01-12T10:00:00Z"))
    await journal.refresh()

    // Assert
    #expect(calls == 1)
  }

  @Test func `sees a new entry through the directory watch`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    let journal = Journal()
    await journal.open(dir.url)

    // Act
    try dir.write("2026-01-11T100000Z.md", entryText(date: "2026-01-11T10:00:00Z"))
    for _ in 0..<50 where journal.entries.isEmpty {
      try await Task.sleep(for: .milliseconds(100))
    }

    // Assert
    #expect(journal.entries.map(\.id) == ["2026-01-11T100000Z"])
  }

  @Test func `loads and searches ten thousand entries quickly`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    let projects = ["nebula", "agent-journal", "my-lib", "dotfiles"]
    let body = String(repeating: "Replaced the string-interpolated SQL with prepared statements. ", count: 40)
    for index in 0..<10_000 {
      let instant = Date(timeIntervalSince1970: 1_767_225_600 + Double(index) * 900)
      let iso = instant.formatted(.iso8601)
      let stem = iso.replacingOccurrences(of: ":", with: "")
      try dir.write("\(stem).md", entryText(date: iso, project: projects[index % 4], summary: "Entry \(index)", body: body))
    }
    let journal = Journal()
    let clock = ContinuousClock()

    // Act
    let loading = await clock.measure { await journal.open(dir.url) }
    let match = Query(text: "prepared needle").matcher()
    let searching = clock.measure { _ = journal.entries.filter(match) }

    // Assert
    #expect(journal.entries.count == 10_000)
    /**
     Timed only in an optimized build. A debug build runs string code many times slower, so a bound
     there would measure the compiler settings rather than the code. Run with
     `swift test -c release -Xswiftc -enable-testing` to check it.

     The bounds are about ten times what a laptop measures (0.3 s and 15 ms), so a slow shared CI
     machine passes and a change that makes loading or searching an order of magnitude slower fails.
     */
    #if !DEBUG
      #expect(loading < .seconds(3))
      #expect(searching < .milliseconds(500))
    #else
      _ = (loading, searching)
    #endif
  }
}
