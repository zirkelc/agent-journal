import JournalKit
import SwiftUI

enum Style {
  /**
   The background of reading surfaces. Set explicitly, because a pinned header has to paint the same
   color as the page under it, and the default behind a scroll view is not one a view can name.
   */
  static let pageBackground = Color(nsColor: .textBackgroundColor)

  private static let palette: [Color] = [.orange, .green, .purple, .teal, .pink, .blue, .indigo, .mint, .red, .yellow, .cyan, .brown]

  /**
   A color per project, the same on every launch and machine. Swift's own hash is seeded per process,
   so this uses FNV-1a over the name's bytes instead.
   */
  static func color(for project: String) -> Color {
    var hash: UInt64 = 0xcbf2_9ce4_8422_2325
    for byte in project.utf8 {
      hash ^= UInt64(byte)
      hash &*= 0x100_0000_01b3
    }
    return palette[Int(hash % UInt64(palette.count))]
  }

  /** The text with every search term highlighted. */
  static func highlighted(_ text: String, terms: [String]) -> AttributedString {
    var attributed = AttributedString(text)
    guard !terms.isEmpty else { return attributed }
    for range in TextSearch.ranges(of: terms, in: text) {
      guard let lower = AttributedString.Index(range.lowerBound, within: attributed),
        let upper = AttributedString.Index(range.upperBound, within: attributed)
      else { continue }
      attributed[lower..<upper].backgroundColor = .yellow.opacity(0.45)
    }
    return attributed
  }

  static func time(_ date: Date) -> String {
    date.formatted(date: .omitted, time: .shortened)
  }

  static func dayHeading(_ date: Date) -> String {
    let calendar = Calendar.autoupdatingCurrent
    let prefix = calendar.isDateInToday(date) ? "Today · " : calendar.isDateInYesterday(date) ? "Yesterday · " : ""
    return prefix + date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day().year())
  }

  /** The title and subtitle for a period: "Week 40" over "Sep 28 – Oct 4, 2026". */
  static func title(for period: Period?) -> (String, String?) {
    guard let period else { return ("All entries", nil) }
    let calendar = Calendar.autoupdatingCurrent
    let interval = period.interval(in: calendar)
    let last = interval.end.addingTimeInterval(-1)

    switch period.unit {
    case .day:
      return (period.start.formatted(.dateTime.weekday(.wide).month(.wide).day()), period.start.formatted(.dateTime.year()))
    case .week:
      let week = calendar.component(.weekOfYear, from: period.start)
      return ("Week \(week)", (period.start..<last).formatted(.interval.month(.abbreviated).day().year()))
    case .month:
      return (period.start.formatted(.dateTime.month(.wide).year()), nil)
    case .year:
      return (period.start.formatted(.dateTime.year()), nil)
    }
  }

  static func count(_ count: Int) -> String {
    count == 1 ? "1 entry" : "\(count.formatted()) entries"
  }

  /** `~` expanded, for opening a recorded directory in Finder. */
  static func expandHome(_ path: String) -> URL {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    if path == "~" { return URL(fileURLWithPath: home) }
    if path.hasPrefix("~/") { return URL(fileURLWithPath: home + path.dropFirst()) }
    return URL(fileURLWithPath: path)
  }
}

/** The project dot used in rows, cards and the sidebar. */
struct ProjectDot: View {
  let project: String?

  var body: some View {
    Circle()
      .fill(project.map(Style.color(for:)) ?? .secondary.opacity(0.4))
      .frame(width: 8, height: 8)
  }
}

/** Display names for the frontmatter keys the format defines. Any other key shows as written. */
enum FieldLabel {
  static func name(_ key: String) -> String {
    switch key {
    case FieldKey.project: "Project"
    case FieldKey.agent: "Agent"
    case FieldKey.cwd: "Directory"
    case FieldKey.sessionID: "Session"
    default: key
    }
  }
}
