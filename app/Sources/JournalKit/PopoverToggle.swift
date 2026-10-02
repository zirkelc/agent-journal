import Foundation

/**
 Decides what a click on a button that toggles a popover should do.

 A macOS popover closes on mouse down anywhere outside it, and that includes the button that opened
 it. The button then acts on mouse up and sees a closed popover, so a plain toggle opens it again. A
 click that arrives just after the popover closed is the same click, and leaves it closed.
 */
public struct PopoverToggle: Sendable {
  /** Longer than a click takes from mouse down to mouse up, shorter than two deliberate clicks. */
  public static let window: TimeInterval = 0.3

  private var lastClosed: Date = .distantPast

  public init() {}

  /** Records that the popover closed, by any means. */
  public mutating func closed(at date: Date = .now) {
    lastClosed = date
  }

  /** Whether the popover should be open after a click on its button. */
  public func click(isOpen: Bool, at date: Date = .now) -> Bool {
    if isOpen { return false }
    return date.timeIntervalSince(lastClosed) >= Self.window
  }
}
