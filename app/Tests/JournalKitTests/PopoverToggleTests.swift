import Foundation
import Testing

@testable import JournalKit

@Suite struct PopoverToggleTests {
  let start = Date(timeIntervalSince1970: 1_000)

  @Test func `opens on a click when closed`() {
    // Arrange
    var toggle = PopoverToggle()

    // Act
    let result = toggle.click(isOpen: false, at: start)

    // Assert
    #expect(result == true)
  }

  @Test func `closes on a click when open`() {
    // Arrange
    var toggle = PopoverToggle()

    // Act
    let result = toggle.click(isOpen: true, at: start)

    // Assert
    #expect(result == false)
  }

  @Test func `stays closed when the click itself just closed it`() {
    // Arrange
    var toggle = PopoverToggle()
    toggle.closed(at: start)

    // Act
    /** The popover closes on mouse down, the button acts on mouse up a moment later. */
    let result = toggle.click(isOpen: false, at: start.addingTimeInterval(0.15))

    // Assert
    #expect(result == false)
  }

  @Test func `opens again on a later click`() {
    // Arrange
    var toggle = PopoverToggle()
    toggle.closed(at: start)

    // Act
    let result = toggle.click(isOpen: false, at: start.addingTimeInterval(1))

    // Assert
    #expect(result == true)
  }
}
