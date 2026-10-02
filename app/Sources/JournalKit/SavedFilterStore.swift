import Foundation

/**
 Saved filters, as one JSON file. They belong to the app rather than to the journal, so they live in
 Application Support and never in the journal directory, where they would sync and show up as files.
 */
public struct SavedFilterStore: Sendable {
  public let url: URL

  public init(url: URL) {
    self.url = url
  }

  public static var `default`: SavedFilterStore {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return SavedFilterStore(url: support.appending(path: "AgentJournal/filters.json"))
  }

  /** No file means no saved filters yet, which is the state of every new install. */
  public func load() throws -> [SavedFilter] {
    guard FileManager.default.fileExists(atPath: url.path) else { return [] }
    let data = try Data(contentsOf: url)
    return try JSONDecoder().decode([SavedFilter].self, from: data)
  }

  public func save(_ filters: [SavedFilter]) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    try encoder.encode(filters).write(to: url, options: .atomic)
  }
}
