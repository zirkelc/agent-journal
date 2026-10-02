import Foundation

/**
 Owner avatars, kept in memory and on disk, one per owner rather than per project, since most
 projects share an owner.

 A stored avatar is shown at once, also offline, and downloaded again only once it is older than the
 maximum age, so a changed picture still arrives. A failed download keeps the old one.
 */
public actor AvatarCache {
  public typealias Fetch = @Sendable (URL) async throws -> Data

  private let directory: URL
  private let maxAge: TimeInterval
  private let fetch: Fetch
  private var memory: [String: Data] = [:]
  /** Downloads under way, so two rows asking for the same owner share one request. */
  private var pending: [String: Task<Data?, Never>] = [:]

  public init(directory: URL, maxAge: TimeInterval = 7 * 24 * 3_600, fetch: @escaping Fetch = AvatarCache.download) {
    self.directory = directory
    self.maxAge = maxAge
    self.fetch = fetch
  }

  public static let shared = AvatarCache(
    directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "AgentJournal/avatars")
  )

  @Sendable public static func download(_ url: URL) async throws -> Data {
    let (data, response) = try await URLSession.shared.data(from: url)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
    return data
  }

  /** Whatever is stored for the owner, however old, without a download. For showing something at once. */
  public func stored(for owner: String) -> Data? {
    let key = Self.key(owner)
    if let data = memory[key] { return data }
    guard let data = try? Data(contentsOf: file(key)) else { return nil }
    memory[key] = data
    return data
  }

  /** The owner's avatar, downloaded when nothing fresh is stored. Nil only when there is none at all. */
  public func image(for owner: String, url: URL) async -> Data? {
    let key = Self.key(owner)
    if isFresh(key), let data = stored(for: owner) { return data }
    if let task = pending[key] { return await task.value }

    let fetch = fetch
    let task = Task<Data?, Never> { try? await fetch(url) }
    pending[key] = task
    let downloaded = await task.value
    pending[key] = nil

    guard let downloaded else { return stored(for: owner) }
    memory[key] = downloaded
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try? downloaded.write(to: file(key), options: .atomic)
    return downloaded
  }

  private func isFresh(_ key: String) -> Bool {
    guard let modified = try? file(key).resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate else {
      return false
    }
    return Date.now.timeIntervalSince(modified) < maxAge
  }

  private func file(_ key: String) -> URL {
    directory.appending(path: key)
  }

  /** Owner names are case-insensitive on GitHub, and a group path holds slashes a filename cannot. */
  static func key(_ owner: String) -> String {
    owner.lowercased().replacingOccurrences(of: "/", with: "_")
  }
}
