import Foundation
import Testing

@testable import JournalKit

@Suite struct EntryRemovalTests {
  @Test func `moves entries to the Trash and puts them back`() throws {
    // Arrange
    let dir = try ScratchDirectory()
    try dir.write("2026-01-11T100000Z.md", "first")
    try dir.write("2026-01-12T100000Z.md", "second")
    let urls = ["2026-01-11T100000Z.md", "2026-01-12T100000Z.md"].map { dir.url.appending(path: $0) }

    // Act
    let removed = try EntryRemoval.remove(urls, mode: .trash)
    let goneAfterRemove = urls.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) }
    try EntryRemoval.restore(removed)

    // Assert
    #expect(removed.count == 2)
    #expect(removed.allSatisfy { $0.trashed != nil })
    #expect(goneAfterRemove)
    #expect(try String(contentsOf: urls[0], encoding: .utf8) == "first")
    #expect(try String(contentsOf: urls[1], encoding: .utf8) == "second")
  }

  @Test func `deletes permanently with nothing to restore`() throws {
    // Arrange
    let dir = try ScratchDirectory()
    try dir.write("2026-01-11T100000Z.md", "first")
    let url = dir.url.appending(path: "2026-01-11T100000Z.md")

    // Act
    let removed = try EntryRemoval.remove([url], mode: .permanent)

    // Assert
    #expect(removed.count == 1)
    #expect(removed[0].trashed == nil)
    #expect(!FileManager.default.fileExists(atPath: url.path))
  }

  @Test func `stops at the first file it cannot remove and reports what it did`() throws {
    // Arrange
    let dir = try ScratchDirectory()
    try dir.write("2026-01-11T100000Z.md", "first")
    let present = dir.url.appending(path: "2026-01-11T100000Z.md")
    let missing = dir.url.appending(path: "2026-01-12T100000Z.md")

    // Act
    let result = Result { try EntryRemoval.remove([present, missing], mode: .trash) }
    let error = try #require(result.failureValue as? EntryRemoval.PartialFailure)
    try EntryRemoval.restore(error.removed)

    // Assert
    #expect(error.removed.map(\.original) == [present])
    #expect(FileManager.default.fileExists(atPath: present.path))
  }
}

extension Result {
  var failureValue: Failure? {
    if case .failure(let error) = self { return error }
    return nil
  }
}
