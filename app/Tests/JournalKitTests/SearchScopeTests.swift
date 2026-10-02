import Foundation
import Testing

@testable import JournalKit

@Suite struct SearchScopeTests {
  let week = Period(.week, containing: date("2026-10-01T12:00:00Z"), calendar: fixedCalendar())

  @Test func `applies the period when nothing is searched`() {
    // Act
    let result = SearchScope.all.period(week, text: "  ")

    // Assert
    #expect(result == week)
  }

  @Test func `searches all time by default`() {
    // Act
    let result = SearchScope.all.period(week, text: "test")

    // Assert
    #expect(result == nil)
  }

  @Test func `searches the period when asked to`() {
    // Act
    let result = SearchScope.period.period(week, text: "test")

    // Assert
    #expect(result == week)
  }

  @Test func `has no period to search when none is selected`() {
    // Act
    let result = SearchScope.period.period(nil, text: "test")

    // Assert
    #expect(result == nil)
  }

  @Test func `offers a choice only while searching within a period`() {
    // Act
    let searching = SearchScope.offersChoice(period: week, text: "test")
    let idle = SearchScope.offersChoice(period: week, text: "")
    let everything = SearchScope.offersChoice(period: nil, text: "test")

    // Assert
    #expect(searching)
    #expect(!idle)
    #expect(!everything)
  }
}
