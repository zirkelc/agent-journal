import Foundation
import Observation

/**
 Every entry in one journal directory, kept in memory and in step with the directory.

 Agents write entries while the app is open, so the directory is watched, and every change rescans it.
 A rescan lists the directory and reads only the files whose size or modification time changed, so it
 costs a directory listing rather than a reload. Listing rather than trusting the paths an event names
 is what keeps it correct through renames, atomic saves and editors that write a temporary file first.
 */
@MainActor
@Observable
public final class Journal {
  public enum State: Equatable, Sendable {
    case idle
    case loading
    case ready
    /** The directory does not exist. Not an error: it is created when the first entry is written. */
    case missing
    case failed(String)
  }

  public private(set) var directory: URL?
  /** Newest first, which is the order every view shows them in. */
  public private(set) var entries: [Entry] = []
  public private(set) var facets = Facets()
  public private(set) var state: State = .idle

  /** Called after the entries change, so that a dependent cache recomputes once rather than on every read. */
  @ObservationIgnored public var onChange: (@MainActor () -> Void)?

  @ObservationIgnored private var files: [String: Snapshot] = [:]
  @ObservationIgnored private var watcher: DirectoryWatcher?
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var isScanning = false
  @ObservationIgnored private var needsScan = false

  public init() {}

  /** Switches to a directory, loads it, and starts watching it. */
  public func open(_ directory: URL) async {
    generation += 1
    watcher = nil
    self.directory = directory
    files = [:]
    entries = []
    facets = Facets()
    state = .loading
    onChange?()

    let generation = generation
    await refresh()

    /** A later call to open has taken over while this one scanned, and it installs its own watcher. */
    guard generation == self.generation else { return }
    watcher = DirectoryWatcher(url: directory) { [weak self] in
      Task { @MainActor in
        guard let self, self.generation == generation else { return }
        await self.refresh()
      }
    }
  }

  /**
   Rescans the directory. Scans never overlap: a request that arrives during one is folded into a
   single scan after it, so a burst of events costs at most two scans and a slow scan never overwrites
   a newer one. A scan of a directory that was switched away from is dropped and the new one scanned.
   */
  public func refresh() async {
    guard !isScanning else {
      needsScan = true
      return
    }
    isScanning = true
    defer { isScanning = false }

    repeat {
      needsScan = false
      guard let directory else { return }
      let generation = generation
      let previous = files
      let result = await Task.detached(priority: .userInitiated) {
        Journal.scan(directory, previous: previous)
      }.value
      guard generation == self.generation else {
        needsScan = true
        continue
      }
      apply(result)
    } while needsScan
  }

  private func apply(_ result: ScanResult) {
    switch result {
    case .missing:
      files = [:]
      entries = []
      facets = Facets()
      state = .missing
      onChange?()
    case .failed(let message):
      state = .failed(message)
    case .scanned(let scanned, let changed):
      files = scanned
      state = .ready
      guard changed else { return }
      entries = scanned.values.map(\.entry).sorted { $0.id > $1.id }
      facets = Facets(entries: entries)
      onChange?()
    }
  }

  // MARK: - Scanning

  struct Snapshot: Sendable {
    let modified: Date
    let size: Int
    let entry: Entry
  }

  enum ScanResult: Sendable {
    case missing
    case failed(String)
    case scanned([String: Snapshot], changed: Bool)
  }

  nonisolated static func scan(_ directory: URL, previous: [String: Snapshot]) -> ScanResult {
    let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey]
    let urls: [URL]
    do {
      urls = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])
    } catch CocoaError.fileReadNoSuchFile {
      return .missing
    } catch {
      var isDirectory: ObjCBool = false
      if !FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory) { return .missing }
      return .failed(error.localizedDescription)
    }

    var kept: [String: Snapshot] = [:]
    var toRead: [(URL, Date, Int)] = []

    for url in urls {
      let name = url.lastPathComponent
      guard url.pathExtension == "md", EntryParser.date(fromStem: url.deletingPathExtension().lastPathComponent) != nil,
        let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true
      else { continue }

      let modified = values.contentModificationDate ?? .distantPast
      let size = values.fileSize ?? 0
      if let old = previous[name], old.modified == modified, old.size == size {
        kept[name] = old
      } else {
        toRead.append((url, modified, size))
      }
    }

    let read = readAll(toRead)
    for snapshot in read {
      kept[snapshot.entry.url.lastPathComponent] = snapshot
    }

    let changed = !read.isEmpty || kept.count != previous.count
    return .scanned(kept, changed: changed)
  }

  /** Reads and parses files in parallel. The first load of a large journal is almost all of its time here. */
  private nonisolated static func readAll(_ files: [(URL, Date, Int)]) -> [Snapshot] {
    guard !files.isEmpty else { return [] }

    final class Results: @unchecked Sendable {
      let lock = NSLock()
      var items: [Snapshot] = []
    }
    let results = Results()

    DispatchQueue.concurrentPerform(iterations: files.count) { index in
      let (url, modified, size) = files[index]
      /** A file that is not valid UTF-8 is not an entry this app can show, and one unreadable file must not hide the others. */
      guard let text = try? String(contentsOf: url, encoding: .utf8), let entry = EntryParser.parse(url: url, text: text) else {
        return
      }
      results.lock.lock()
      results.items.append(Snapshot(modified: modified, size: size, entry: entry))
      results.lock.unlock()
    }
    return results.items
  }
}
