import Foundation
import Testing

@testable import JournalKit

@Suite struct AvatarCacheTests {
  /** Counts downloads and answers with the data it is given, or fails when it has none. */
  final class FakeFetch: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var calls = 0
    var data: Data?

    init(_ data: Data?) { self.data = data }

    func callAsFunction(_ url: URL) async throws -> Data {
      lock.withLock { calls += 1 }
      guard let data else { throw URLError(.notConnectedToInternet) }
      return data
    }
  }

  let url = URL(string: "https://github.com/zirkelc.png?size=96")!

  func cache(_ dir: ScratchDirectory, _ fetch: FakeFetch, maxAge: TimeInterval = 3_600) -> AvatarCache {
    AvatarCache(directory: dir.url, maxAge: maxAge) { try await fetch($0) }
  }

  @Test func `downloads once and serves later requests from the cache`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    let fetch = FakeFetch(Data("png".utf8))
    let cache = cache(dir, fetch)

    // Act
    let first = await cache.image(for: "zirkelc", url: url)
    let second = await cache.image(for: "ZirkelC", url: url)

    // Assert
    #expect(first == Data("png".utf8))
    #expect(second == Data("png".utf8))
    #expect(fetch.calls == 1)
  }

  @Test func `serves a file from an earlier launch without downloading`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    _ = await cache(dir, FakeFetch(Data("old".utf8))).image(for: "zirkelc", url: url)
    let fetch = FakeFetch(Data("new".utf8))

    // Act
    let result = await cache(dir, fetch).image(for: "zirkelc", url: url)

    // Assert
    #expect(result == Data("old".utf8))
    #expect(fetch.calls == 0)
  }

  @Test func `downloads again once the file is older than the maximum age`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    let cache = cache(dir, FakeFetch(Data("old".utf8)))
    _ = await cache.image(for: "zirkelc", url: url)
    let file = try #require(FileManager.default.contentsOfDirectory(at: dir.url, includingPropertiesForKeys: nil).first)
    try FileManager.default.setAttributes([.modificationDate: Date.now.addingTimeInterval(-7_200)], ofItemAtPath: file.path)
    let fetch = FakeFetch(Data("new".utf8))

    // Act
    let result = await self.cache(dir, fetch).image(for: "zirkelc", url: url)

    // Assert
    #expect(result == Data("new".utf8))
    #expect(fetch.calls == 1)
  }

  @Test func `keeps an old file when the download fails`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    _ = await cache(dir, FakeFetch(Data("old".utf8))).image(for: "zirkelc", url: url)
    let file = try #require(FileManager.default.contentsOfDirectory(at: dir.url, includingPropertiesForKeys: nil).first)
    try FileManager.default.setAttributes([.modificationDate: Date.now.addingTimeInterval(-7_200)], ofItemAtPath: file.path)

    // Act
    let result = await cache(dir, FakeFetch(nil)).image(for: "zirkelc", url: url)

    // Assert
    #expect(result == Data("old".utf8))
  }

  @Test func `returns a stored file at once, however old`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    _ = await cache(dir, FakeFetch(Data("old".utf8))).image(for: "zirkelc", url: url)
    let fetch = FakeFetch(nil)

    // Act
    let stored = await cache(dir, fetch, maxAge: 0).stored(for: "zirkelc")
    let missing = await cache(dir, fetch).stored(for: "someone-else")

    // Assert
    #expect(stored == Data("old".utf8))
    #expect(missing == nil)
    #expect(fetch.calls == 0)
  }

  @Test func `shares one download between requests made at the same time`() async throws {
    // Arrange
    let dir = try ScratchDirectory()
    let fetch = FakeFetch(Data("png".utf8))
    let cache = cache(dir, fetch)

    // Act
    async let a = cache.image(for: "zirkelc", url: url)
    async let b = cache.image(for: "zirkelc", url: url)
    let results = await [a, b]

    // Assert
    #expect(results == [Data("png".utf8), Data("png".utf8)])
    #expect(fetch.calls == 1)
  }
}
