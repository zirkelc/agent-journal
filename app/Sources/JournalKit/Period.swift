import Foundation

/**
 A day, week, month or year in a calendar. Entries are named in UTC, but a person thinks in local
 days, so every period is resolved in the calendar it is given, which is the user's own by default.
 That calendar also decides the first day of the week and how weeks are numbered.

 This can disagree with the CLI's `--date`, which filters by UTC prefix, for entries written near
 midnight. That is deliberate: the CLI matches filenames, and the app shows a person's day.
 */
public struct Period: Hashable, Codable, Sendable {
  public enum Unit: String, Hashable, Codable, Sendable, CaseIterable {
    case day, week, month, year

    var component: Calendar.Component {
      switch self {
      case .day: .day
      case .week: .weekOfYear
      case .month: .month
      case .year: .year
      }
    }
  }

  public let unit: Unit
  /** The first instant of the period. */
  public let start: Date

  /** The period of the given unit that contains the date. */
  public init(_ unit: Unit, containing date: Date, calendar: Calendar = .autoupdatingCurrent) {
    self.unit = unit
    self.start = calendar.dateInterval(of: unit.component, for: date)?.start ?? calendar.startOfDay(for: date)
  }

  public func interval(in calendar: Calendar = .autoupdatingCurrent) -> DateInterval {
    calendar.dateInterval(of: unit.component, for: start) ?? DateInterval(start: start, duration: 0)
  }

  /** Whether the date falls in the period. The end is exclusive, so midnight belongs to the next day only. */
  public func contains(_ date: Date, calendar: Calendar = .autoupdatingCurrent) -> Bool {
    let interval = interval(in: calendar)
    return date >= interval.start && date < interval.end
  }

  /** The period the given number of units away: the next week, the previous month. */
  public func advanced(by count: Int, calendar: Calendar = .autoupdatingCurrent) -> Period {
    let date = calendar.date(byAdding: unit.component, value: count, to: start) ?? start
    return Period(unit, containing: date, calendar: calendar)
  }

  /** Every day in the period, for a calendar grid or a week list. */
  public func days(calendar: Calendar = .autoupdatingCurrent) -> [Date] {
    let interval = interval(in: calendar)
    var days: [Date] = []
    var day = interval.start
    while day < interval.end {
      days.append(day)
      /**
       Back to the start of the next day, because where a clock change skips midnight that day starts
       at 01:00, and adding a day from there would keep every later day at 01:00 too.
       */
      guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
      day = calendar.startOfDay(for: next)
    }
    return days
  }
}

/** Entry counts per local day, for the activity marks in the calendar. */
public enum Activity {
  public static func countsPerDay(_ entries: some Sequence<Entry>, calendar: Calendar = .autoupdatingCurrent) -> [Date: Int] {
    var counts: [Date: Int] = [:]
    for entry in entries {
      counts[calendar.startOfDay(for: entry.date), default: 0] += 1
    }
    return counts
  }

  /** Entries per local hour, 0 to 23, for the time of day histogram. */
  public static func countsPerHour(_ entries: some Sequence<Entry>, calendar: Calendar = .autoupdatingCurrent) -> [Int] {
    var counts = Array(repeating: 0, count: 24)
    for entry in entries {
      counts[calendar.component(.hour, from: entry.date)] += 1
    }
    return counts
  }

  /** The sum of the daily counts inside a period. */
  public static func count(in period: Period, counts: [Date: Int], calendar: Calendar = .autoupdatingCurrent) -> Int {
    let interval = period.interval(in: calendar)
    return counts.reduce(0) { sum, item in
      item.key >= interval.start && item.key < interval.end ? sum + item.value : sum
    }
  }
}
