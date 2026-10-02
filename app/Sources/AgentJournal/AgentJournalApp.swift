import AppKit
import JournalKit
import SwiftUI

@main
struct AgentJournalApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate
  @State private var model = AppModel()

  var body: some Scene {
    /** One window, because there is one journal. A second window would only be a second view of the same state. */
    Window("Agent Journal", id: "main") {
      ContentView()
        .environment(model)
        .task { await model.start() }
    }
    .defaultSize(width: 1_280, height: 820)
    .commands {
      JournalCommands(model: model)
    }

    Settings {
      SettingsView()
        .environment(model)
    }
  }
}

/**
 Makes a plain executable behave as an app. Run from the bundle it already is one; run with
 `swift run` it would otherwise start without a Dock icon, a menu bar or keyboard focus.
 */
final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }
}

struct JournalCommands: Commands {
  let model: AppModel
  @AppStorage(Preference.viewMode) private var viewMode = ViewMode.list
  @AppStorage(Preference.showRaw) private var showRaw = false
  @AppStorage(Preference.removalMode) private var removalMode = EntryRemoval.Mode.trash

  var body: some Commands {
    CommandGroup(after: .textEditing) {
      Button("Find") { model.wantsSearchFocus = true }
        .keyboardShortcut("f", modifiers: [.command])
    }
    CommandGroup(after: .pasteboard) {
      Divider()
      Button(removalMode.title(count: max(model.selection.count, 1))) { model.requestRemoval(model.selectedEntries) }
        .keyboardShortcut(.delete, modifiers: [.command])
        .disabled(model.selection.isEmpty || viewMode == .feed || model.isSearchFocused)
    }
    CommandMenu("Go") {
      Button("Previous Period") { model.step(-1) }
        .keyboardShortcut(.leftArrow, modifiers: [.command])
        .disabled(model.period == nil)
      Button("Next Period") { model.step(1) }
        .keyboardShortcut(.rightArrow, modifiers: [.command])
        .disabled(model.period == nil)
      Divider()
      Button("Today") { model.select(Period(.day, containing: .now)) }
        .keyboardShortcut("t", modifiers: [.command])
      Button("This Week") { model.select(Period(.week, containing: .now)) }
      Button("This Month") { model.select(Period(.month, containing: .now)) }
      Button("All Entries") { model.select(nil) }
      Divider()
      Button("Clear Filters") { model.clearFilters() }
        .keyboardShortcut("k", modifiers: [.command, .shift])
        .disabled(model.query.isEmpty)
    }
    CommandGroup(after: .toolbar) {
      Picker("Layout", selection: $viewMode) {
        Text("List").tag(ViewMode.list).keyboardShortcut("1", modifiers: [.command])
        Text("Feed").tag(ViewMode.feed).keyboardShortcut("2", modifiers: [.command])
      }
      .pickerStyle(.inline)
      Toggle("Show Source", isOn: $showRaw)
        .keyboardShortcut("r", modifiers: [.command, .shift])
      Divider()
    }
  }
}

/** Keys for the preferences the views share through user defaults. */
enum Preference {
  static let viewMode = "viewMode"
  static let showRaw = "showRaw"
  static let showAvatars = "showAvatars"
  static let removalMode = "removalMode"
  static let recentSearches = "recentSearches"
}

enum ViewMode: String {
  case list, feed
}
