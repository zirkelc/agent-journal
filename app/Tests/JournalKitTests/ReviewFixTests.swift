import Foundation
import Testing

@testable import JournalKit

@Suite struct RepeatedKeyTests {
  @Test func `matches a value written in a repeated key`() throws {
    // Arrange
    let text = "---\nagent: claude\nagent: codex\n---\nbody"
    let entry = try #require(EntryParser.parse(url: URL(fileURLWithPath: "/j/2026-01-11T100000Z.md"), text: text))
    let match = Query(facets: ["agent": ["codex"]]).matcher(calendar: fixedCalendar())

    // Act
    let result = match(entry)

    // Assert
    #expect(result)
  }
}

@Suite struct DaylightSavingDaysTests {
  @Test func `starts every day at its own start where midnight is skipped`() {
    // Arrange
    /** Chile moves its clocks from 00:00 to 01:00 on 6 September 2026, so that day starts at 01:00. */
    let calendar = fixedCalendar(timeZone: "America/Santiago")
    let september = Period(.month, containing: date("2026-09-15T12:00:00Z"), calendar: calendar)

    // Act
    let days = september.days(calendar: calendar)

    // Assert
    #expect(days.count == 30)
    #expect(days.allSatisfy { calendar.startOfDay(for: $0) == $0 })
  }
}

@Suite struct HourRangeTests {
  @Test(arguments: [(0, 24), (5, 5), (0, 0), (22, 22)])
  func `treats the whole day as no filter`(from: Int, to: Int) {
    // Act
    let result = HourRange.normalized(from: from, to: to)

    // Assert
    #expect(result == nil)
  }

  @Test func `keeps a partial range and wraps 24 to 0 at the start`() {
    // Act
    let range = HourRange.normalized(from: 24, to: 5)

    // Assert
    #expect(range == HourRange(from: 0, to: 5))
  }

  @Test func `names a preset range`() {
    // Act
    let night = HourRange.night.presetName
    let custom = HourRange(from: 9, to: 11).presetName

    // Assert
    #expect(night == "Night")
    #expect(custom == nil)
    #expect(HourRange.presets.map(\.name) == ["Morning", "Afternoon", "Evening", "Night"])
  }
}

@Suite @MainActor struct JournalReopenTests {
  @Test func `loads and watches the second directory when opened during a scan of the first`() async throws {
    // Arrange
    let a = try ScratchDirectory()
    let b = try ScratchDirectory()
    for index in 0..<300 {
      let instant = Date(timeIntervalSince1970: 1_767_225_600 + Double(index) * 900).formatted(.iso8601)
      try a.write("\(instant.replacingOccurrences(of: ":", with: "")).md", entryText(date: instant))
    }
    try b.write("2026-01-11T100000Z.md", entryText(date: "2026-01-11T10:00:00Z"))
    let journal = Journal()

    // Act
    let first = Task { await journal.open(a.url) }
    await Task.yield()
    await journal.open(b.url)
    await first.value
    try b.write("2026-01-12T100000Z.md", entryText(date: "2026-01-12T10:00:00Z"))
    for _ in 0..<50 where journal.entries.count < 2 {
      try await Task.sleep(for: .milliseconds(100))
    }

    // Assert
    #expect(journal.directory == b.url)
    #expect(journal.state == .ready)
    #expect(journal.entries.map(\.id) == ["2026-01-12T100000Z", "2026-01-11T100000Z"])
  }
}

@Suite struct JournalCLIPipeTests {
  @Test(.timeLimit(.minutes(1)))
  func `fails rather than hangs when the CLI writes a lot to stderr`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    let script = dir.url.appending(path: "noisy")
    try "#!/bin/sh\nhead -c 300000 /dev/zero | tr '\\\\0' x >&2\nexit 1\n".write(to: script, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)
    let cli = JournalCLI(executable: script)

    // Act
    let result = await Result(catching: { try await cli.config() })

    // Assert
    let failure = try #require(result.failureValue as? JournalCLI.Failure)
    guard case .exited(let status, let message) = failure else { Issue.record("unexpected failure"); return }
    #expect(status == 1)
    #expect(message.count == 300_000)
  }
}

extension Result where Failure == any Error {
  init(catching body: () async throws -> Success) async {
    do { self = .success(try await body()) } catch { self = .failure(error) }
  }
}
