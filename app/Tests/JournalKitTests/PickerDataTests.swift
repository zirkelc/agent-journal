import Foundation
import Testing

@testable import JournalKit

@Suite struct NotRecordedTests {
  @Test func `matches entries without the field`() {
    // Arrange
    let match = Query(facets: ["agent": [Query.notRecorded]]).matcher(calendar: fixedCalendar())

    // Act
    let missing = match(entry(date: "2026-01-11T10:00:00Z", agent: nil))
    let present = match(entry(date: "2026-01-11T10:00:00Z", agent: "codex"))

    // Assert
    #expect(missing)
    #expect(!present)
  }

  @Test func `combines with real values of the same key`() {
    // Arrange
    let match = Query(facets: ["agent": [Query.notRecorded, "codex"]]).matcher(calendar: fixedCalendar())

    // Act
    let missing = match(entry(date: "2026-01-11T10:00:00Z", agent: nil))
    let codex = match(entry(date: "2026-01-11T10:00:00Z", agent: "codex/gpt-5"))
    let claude = match(entry(date: "2026-01-11T10:00:00Z", agent: "claude"))

    // Assert
    #expect(missing)
    #expect(codex)
    #expect(!claude)
  }

  @Test func `counts entries without the field`() {
    // Arrange
    let entries = [
      entry(date: "2026-01-11T10:00:00Z", agent: nil),
      entry(date: "2026-01-11T11:00:00Z", agent: nil),
      entry(date: "2026-01-11T12:00:00Z", agent: "codex"),
    ]

    // Act
    let facets = Facets(entries: entries)

    // Assert
    #expect(facets.missing(for: "agent") == 2)
    #expect(facets.missing(for: "project") == 0)
  }
}

@Suite struct ActivityTests {
  let calendar = fixedCalendar()

  @Test func `counts entries per local hour`() {
    // Arrange
    /** Berlin is UTC+1 in January, so 22:30 UTC is 23:30 local. */
    let entries = [
      entry(date: "2026-01-11T22:30:00Z"),
      entry(date: "2026-01-11T22:45:00Z"),
      entry(date: "2026-01-11T08:00:00Z"),
    ]

    // Act
    let hours = Activity.countsPerHour(entries, calendar: calendar)

    // Assert
    #expect(hours.count == 24)
    #expect(hours[23] == 2)
    #expect(hours[9] == 1)
    #expect(hours.reduce(0, +) == 3)
  }

  @Test func `summarizes each project`() {
    // Arrange
    let now = date("2026-01-28T12:00:00Z")
    let entries = [
      entry(date: "2026-01-27T10:00:00Z", project: "a", cwd: "~/a"),
      entry(date: "2026-01-20T10:00:00Z", project: "a", cwd: "~/a.worktrees/x"),
      entry(date: "2026-01-19T10:00:00Z", project: "a", cwd: "~/a"),
      entry(date: "2025-12-01T10:00:00Z", project: "b", cwd: "~/b"),
    ]

    // Act
    let stats = ProjectStats.compute(entries, weeks: 4, now: now, calendar: calendar)

    // Assert
    #expect(stats["a"]?.count == 3)
    #expect(stats["a"]?.last == date("2026-01-27T10:00:00Z"))
    #expect(stats["a"]?.weekly == [0, 0, 2, 1])
    #expect(stats["a"]?.directories == ["~/a", "~/a.worktrees/x"])
    #expect(stats["b"]?.weekly == [0, 0, 0, 0])
  }
}

@Suite struct GitRemoteTests {
  @Test(arguments: [
    ("git@github.com:zirkelc/agent-journal.git", "github.com", "zirkelc", "agent-journal"),
    ("https://github.com/zirkelc/agent-journal.git", "github.com", "zirkelc", "agent-journal"),
    ("https://github.com/zirkelc/agent-journal", "github.com", "zirkelc", "agent-journal"),
    ("ssh://git@gitlab.com/group/sub/repo.git", "gitlab.com", "group/sub", "repo"),
    ("https://user:token@github.com/zirkelc/repo.git", "github.com", "zirkelc", "repo"),
  ])
  func `parses the remote URL forms git accepts`(url: String, host: String, owner: String, repo: String) throws {
    // Act
    let remote = try #require(GitRemote.parse(url))

    // Assert
    #expect(remote.host == host)
    #expect(remote.owner == owner)
    #expect(remote.repo == repo)
  }

  @Test func `never keeps credentials from the URL`() throws {
    // Act
    let remote = try #require(GitRemote.parse("https://user:token@github.com/zirkelc/repo.git"))

    // Assert
    #expect(remote.webURL.absoluteString == "https://github.com/zirkelc/repo")
  }

  @Test func `has an avatar only on GitHub`() throws {
    // Act
    let github = try #require(GitRemote.parse("git@github.com:zirkelc/repo.git"))
    let gitlab = try #require(GitRemote.parse("git@gitlab.com:zirkelc/repo.git"))

    // Assert
    #expect(github.avatarURL?.absoluteString == "https://github.com/zirkelc.png?size=96")
    #expect(gitlab.avatarURL == nil)
  }

  @Test func `rejects a local path`() {
    // Act
    let remote = GitRemote.parse("/srv/git/repo.git")

    // Assert
    #expect(remote == nil)
  }

  @Test func `reads origin from a repository, from a subdirectory`() throws {
    // Arrange
    let dir = try ScratchDirectory()
    try FileManager.default.createDirectory(at: dir.url.appending(path: "repo/.git"), withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: dir.url.appending(path: "repo/src/deep"), withIntermediateDirectories: true)
    try dir.write("repo/.git/config", """
      [core]
      \tbare = false
      [remote "upstream"]
      \turl = git@github.com:someone/else.git
      [remote "origin"]
      \turl = git@github.com:zirkelc/repo.git
      \tfetch = +refs/heads/*:refs/remotes/origin/*
      """)

    // Act
    let remote = GitRemote.origin(of: dir.url.appending(path: "repo/src/deep"))

    // Assert
    #expect(remote?.owner == "zirkelc")
    #expect(remote?.repo == "repo")
  }

  @Test func `reads origin from a worktree through its common directory`() throws {
    // Arrange
    let dir = try ScratchDirectory()
    let main = dir.url.appending(path: "main/.git")
    try FileManager.default.createDirectory(at: main.appending(path: "worktrees/feature"), withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: dir.url.appending(path: "feature"), withIntermediateDirectories: true)
    try dir.write("main/.git/config", "[remote \"origin\"]\n\turl = https://github.com/zirkelc/repo.git\n")
    try dir.write("main/.git/worktrees/feature/commondir", "../..\n")
    try dir.write("feature/.git", "gitdir: \(main.appending(path: "worktrees/feature").path)\n")

    // Act
    let remote = GitRemote.origin(of: dir.url.appending(path: "feature"))

    // Assert
    #expect(remote?.repo == "repo")
  }

  @Test func `has no remote outside a repository`() throws {
    // Arrange
    let dir = try ScratchDirectory()

    // Act
    let remote = GitRemote.origin(of: dir.url)

    // Assert
    #expect(remote == nil)
  }
}
