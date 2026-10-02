import Foundation
import Testing

@testable import JournalKit

@Suite struct PeriodTests {
  let calendar = fixedCalendar()

  @Test func `groups by the local day, not the UTC day`() {
    // Arrange
    /** 23:30 UTC on Jan 11 is 00:30 on Jan 12 in Berlin. */
    let late = date("2026-01-11T23:30:00Z")

    // Act
    let period = Period(.day, containing: late, calendar: calendar)

    // Assert
    #expect(period.start == date("2026-01-11T23:00:00Z"))
    #expect(period.contains(late, calendar: calendar))
    #expect(!period.contains(date("2026-01-11T22:59:59Z"), calendar: calendar))
  }

  @Test func `starts the week on the calendar's first weekday`() {
    // Arrange
    let thursday = date("2026-10-01T12:00:00Z")
    let sundayFirst = fixedCalendar(firstWeekday: 1)

    // Act
    let monday = Period(.week, containing: thursday, calendar: calendar)
    let sunday = Period(.week, containing: thursday, calendar: sundayFirst)

    // Assert
    #expect(monday.start == date("2026-09-27T22:00:00Z"))
    #expect(sunday.start == date("2026-09-26T22:00:00Z"))
  }

  @Test func `steps by its unit`() {
    // Arrange
    let january = Period(.month, containing: date("2026-01-15T12:00:00Z"), calendar: calendar)

    // Act
    let next = january.advanced(by: 1, calendar: calendar)
    let previous = january.advanced(by: -1, calendar: calendar)

    // Assert
    #expect(next.start == date("2026-01-31T23:00:00Z"))
    #expect(previous.start == date("2025-11-30T23:00:00Z"))
  }

  @Test func `lists the days of a month across a daylight saving change`() {
    // Arrange
    let march = Period(.month, containing: date("2026-03-15T12:00:00Z"), calendar: calendar)

    // Act
    let days = march.days(calendar: calendar)

    // Assert
    #expect(days.count == 31)
    #expect(days.last == date("2026-03-30T22:00:00Z"))
  }

  @Test func `counts entries per local day`() {
    // Arrange
    let entries = [
      entry(date: "2026-01-11T10:00:00Z"),
      entry(date: "2026-01-11T22:30:00Z"),
      entry(date: "2026-01-11T23:30:00Z"),
    ]

    // Act
    let counts = Activity.countsPerDay(entries, calendar: calendar)
    let month = Activity.count(in: Period(.month, containing: date("2026-01-11T10:00:00Z"), calendar: calendar), counts: counts, calendar: calendar)

    // Assert
    #expect(counts[date("2026-01-10T23:00:00Z")] == 2)
    #expect(counts[date("2026-01-11T23:00:00Z")] == 1)
    #expect(month == 3)
  }
}
