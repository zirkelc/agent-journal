import AppKit
import SwiftUI

/**
 The search text field, in AppKit. It sits in the toolbar, where SwiftUI does not report focus
 changes, and the dropdown depends on knowing when the field gains and loses focus. An AppKit field
 reports both, and passes on the arrow, Return and Escape keys before the field editor uses them.
 */
struct SearchTextField: NSViewRepresentable {
  enum Command {
    case up, down, submit, cancel
  }

  @Binding var text: String
  let placeholder: String
  /** Whether to take keyboard focus. The caller clears it in `onFocusTaken`. */
  let wantsFocus: Bool
  let onFocusTaken: () -> Void
  let onFocusChange: (Bool) -> Void
  /** Called when the user types, as opposed to the text being set from outside. */
  let onEdit: () -> Void
  /** Returns whether the command was used, so an unused key keeps its usual meaning. */
  let onCommand: (Command) -> Bool
  /** The dropdown to show, or nil to hide it. */
  let dropdown: AnyView?
  /** The view the dropdown hangs from: the whole field, not only its text. */
  let anchor: AnchorBox
  /**
   Whether the field has focus. A click elsewhere has to end it even after the dropdown closed, for
   example after Return, since a click on a list does not take focus from a text field.
   */
  let isFocused: Bool

  final class Field: NSTextField {
    var onFocus: (() -> Void)?

    override func becomeFirstResponder() -> Bool {
      let became = super.becomeFirstResponder()
      if became { onFocus?() }
      return became
    }
  }

  func makeCoordinator() -> Coordinator {
    Coordinator(self)
  }

  func makeNSView(context: Context) -> Field {
    let field = Field()
    field.isBordered = false
    field.drawsBackground = false
    field.focusRingType = .none
    field.font = .systemFont(ofSize: NSFont.systemFontSize)
    field.placeholderString = placeholder
    field.lineBreakMode = .byTruncatingTail
    field.cell?.isScrollable = true
    field.cell?.wraps = false
    field.delegate = context.coordinator
    field.onFocus = { [weak coordinator = context.coordinator] in coordinator?.focusChanged(true) }
    field.setContentHuggingPriority(.defaultLow, for: .horizontal)
    return field
  }

  func updateNSView(_ field: Field, context: Context) {
    context.coordinator.parent = self
    if field.stringValue != text { field.stringValue = text }

    if wantsFocus {
      DispatchQueue.main.async {
        field.window?.makeFirstResponder(field)
        onFocusTaken()
      }
    }

    let dropdownWindow = context.coordinator.dropdownWindow
    dropdownWindow.onDismiss = { [weak field] in field?.window?.makeFirstResponder(nil) }
    dropdownWindow.update(content: dropdown, under: anchor.view ?? field, watching: isFocused)
  }

  static func dismantleNSView(_ field: Field, coordinator: Coordinator) {
    coordinator.dropdownWindow.update(content: nil, under: field, watching: false)
  }

  @MainActor
  final class Coordinator: NSObject, NSTextFieldDelegate {
    var parent: SearchTextField
    let dropdownWindow = DropdownWindow()

    init(_ parent: SearchTextField) {
      self.parent = parent
    }

    func focusChanged(_ focused: Bool) {
      parent.onFocusChange(focused)
    }

    func controlTextDidChange(_ notification: Notification) {
      guard let field = notification.object as? NSTextField else { return }
      parent.text = field.stringValue
      parent.onEdit()
    }

    func controlTextDidEndEditing(_ notification: Notification) {
      focusChanged(false)
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
      switch selector {
      case #selector(NSResponder.moveUp(_:)): parent.onCommand(.up)
      case #selector(NSResponder.moveDown(_:)): parent.onCommand(.down)
      case #selector(NSResponder.insertNewline(_:)): parent.onCommand(.submit)
      case #selector(NSResponder.cancelOperation(_:)): parent.onCommand(.cancel)
      default: false
      }
    }
  }
}

/** Holds the AppKit view behind a SwiftUI view, so AppKit code can measure where it is. */
@MainActor
final class AnchorBox {
  weak var view: NSView?
}

/** An empty view whose frame is the frame of whatever it is the background of. */
struct FrameAnchor: NSViewRepresentable {
  let box: AnchorBox

  func makeNSView(context: Context) -> NSView {
    let view = NSView()
    box.view = view
    return view
  }

  func updateNSView(_ view: NSView, context: Context) {
    box.view = view
  }
}

/**
 A borderless window hanging from the bottom edge of a view, as wide as the view, for a dropdown that
 has to lie over everything else in the window. It never becomes key, so clicking in it leaves the
 keyboard focus in the field above. As a child window it moves with its parent.

 While it shows, a click anywhere else in the app, or the app losing focus, dismisses it. A click on
 a list or a page does not take focus from a text field, so without this the dropdown would stay.
 */
@MainActor
final class DropdownWindow {
  private final class Panel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
  }

  /**
   Room around the content for the shadow it draws itself, on the sides and below only. A window
   shadow would also fall on the field above and draw a line between the two.
   */
  static let shadowMargin: CGFloat = 24

  /** Called when the dropdown should go away because the user went elsewhere. */
  var onDismiss: (() -> Void)?

  private var panel: Panel?
  private var hosting: NSHostingView<AnyView>?
  private weak var anchor: NSView?
  private var clickMonitor: Any?
  private var resignObserver: NSObjectProtocol?
  private var deactivateObserver: NSObjectProtocol?

  /** Shows the content under the anchor, or hides it for nil. Clicks are watched while `watching` or shown. */
  func update(content: AnyView?, under anchor: NSView, watching: Bool) {
    guard let window = anchor.window else {
      close()
      return
    }
    self.anchor = anchor

    if watching || content != nil {
      watch(window)
    } else {
      stopWatching()
    }

    guard let content else {
      hidePanel()
      return
    }

    let panel = self.panel ?? makePanel()
    guard let hosting else { return }
    hosting.rootView = content
    hosting.layoutSubtreeIfNeeded()

    let anchorFrame = window.convertToScreen(anchor.convert(anchor.bounds, to: nil))
    let height = max(hosting.fittingSize.height, 1)
    /** Flush with the field, so the side lines of both borders meet without a gap. */
    let top = anchorFrame.minY
    let margin = Self.shadowMargin
    panel.setFrame(NSRect(x: anchorFrame.minX - margin, y: top - height, width: anchorFrame.width + 2 * margin, height: height), display: true)

    if panel.parent == nil {
      window.addChildWindow(panel, ordered: .above)
    }
    panel.orderFront(nil)
  }

  private func makePanel() -> Panel {
    let panel = Panel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.becomesKeyOnlyIfNeeded = true
    let hosting = NSHostingView(rootView: AnyView(EmptyView()))
    panel.contentView = hosting
    self.panel = panel
    self.hosting = hosting
    return panel
  }

  private func watch(_ window: NSWindow) {
    if clickMonitor == nil {
      clickMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] event in
        MainActor.assumeIsolated { self?.handleClick(event) }
        return event
      }
    }
    if resignObserver == nil {
      resignObserver = NotificationCenter.default.addObserver(
        forName: NSWindow.didResignKeyNotification, object: window, queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated { self?.onDismiss?() }
      }
    }
    /** Switching to another app need not change the key window, so that is watched on its own. */
    if deactivateObserver == nil {
      deactivateObserver = NotificationCenter.default.addObserver(
        forName: NSApplication.didResignActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated { self?.onDismiss?() }
      }
    }
  }

  /** A click in the dropdown or on the field itself is part of using them; any other click leaves. */
  private func handleClick(_ event: NSEvent) {
    if let panel, event.window === panel { return }
    if let anchor, event.window === anchor.window, anchor.bounds.contains(anchor.convert(event.locationInWindow, from: nil)) {
      return
    }
    onDismiss?()
  }

  func close() {
    stopWatching()
    hidePanel()
  }

  private func stopWatching() {
    if let clickMonitor { NSEvent.removeMonitor(clickMonitor) }
    clickMonitor = nil
    if let resignObserver { NotificationCenter.default.removeObserver(resignObserver) }
    resignObserver = nil
    if let deactivateObserver { NotificationCenter.default.removeObserver(deactivateObserver) }
    deactivateObserver = nil
  }

  private func hidePanel() {
    guard let panel else { return }
    panel.parent?.removeChildWindow(panel)
    panel.orderOut(nil)
  }
}
