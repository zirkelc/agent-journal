import Foundation

/**
 Removes entry files, to the Trash by default. An entry is a plain file, so removing it needs no
 knowledge of the format and does not go through the CLI.
 */
public enum EntryRemoval {
  public enum Mode: String, CaseIterable, Sendable {
    /** Recoverable from the Trash, and by undo while the app runs. */
    case trash
    /** Gone at once. */
    case permanent
  }

  /** One removed file: where it was, and where the Trash put it, if it went there. */
  public struct Removed: Sendable, Equatable {
    public let original: URL
    public let trashed: URL?
  }

  /**
   Thrown when a file cannot be removed. It carries the files already removed, so the caller can still
   offer to undo those rather than lose track of them.
   */
  public struct PartialFailure: Error, LocalizedError {
    public let removed: [Removed]
    public let failed: URL
    public let underlying: Error

    public var errorDescription: String? {
      "Could not remove \(failed.lastPathComponent): \(underlying.localizedDescription)"
    }
  }

  @discardableResult
  public static func remove(_ urls: [URL], mode: Mode) throws -> [Removed] {
    var removed: [Removed] = []
    for url in urls {
      do {
        switch mode {
        case .trash:
          var trashed: NSURL?
          try FileManager.default.trashItem(at: url, resultingItemURL: &trashed)
          removed.append(Removed(original: url, trashed: trashed as URL?))
        case .permanent:
          try FileManager.default.removeItem(at: url)
          removed.append(Removed(original: url, trashed: nil))
        }
      } catch {
        throw PartialFailure(removed: removed, failed: url, underlying: error)
      }
    }
    return removed
  }

  /** Moves trashed files back where they were. Files removed permanently are skipped, there is nothing to restore. */
  public static func restore(_ removed: [Removed]) throws {
    for item in removed {
      guard let trashed = item.trashed else { continue }
      try FileManager.default.moveItem(at: trashed, to: item.original)
    }
  }
}
