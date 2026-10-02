import Foundation

/** What the project picker shows for a project besides its name: how much, how recently, and where. */
public struct ProjectStats: Sendable, Equatable {
  public let count: Int
  public let last: Date
  /** Entries per week, oldest first, ending with the current week. */
  public let weekly: [Int]
  /** The directories the project's entries were written in, most used first. Where to look for its git remote. */
  public let directories: [String]

  private struct Accumulator {
    var count = 0
    var last = Date.distantPast
    var weekly: [Int]
    var directories: [String: Int] = [:]
  }

  public static func compute(
    _ entries: some Sequence<Entry>,
    weeks: Int = 8,
    now: Date = .now,
    calendar: Calendar = .autoupdatingCurrent
  ) -> [String: ProjectStats] {
    let current = Period(.week, containing: now, calendar: calendar)
    let first = current.advanced(by: -(weeks - 1), calendar: calendar).start
    var byProject: [String: Accumulator] = [:]

    for entry in entries {
      guard let project = entry.project, !project.isEmpty else { continue }
      var stats = byProject[project] ?? Accumulator(weekly: Array(repeating: 0, count: weeks))
      stats.count += 1
      stats.last = max(stats.last, entry.date)
      if let cwd = entry.cwd { stats.directories[cwd, default: 0] += 1 }
      if entry.date >= first, let offset = calendar.dateComponents([.weekOfYear], from: first, to: entry.date).weekOfYear, offset < weeks {
        stats.weekly[offset] += 1
      }
      byProject[project] = stats
    }

    return byProject.mapValues { stats in
      ProjectStats(
        count: stats.count,
        last: stats.last,
        weekly: stats.weekly,
        directories: stats.directories.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }.map(\.key)
      )
    }
  }
}
