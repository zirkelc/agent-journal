import AppKit
import Foundation
import JournalKit
import Observation

/**
 Everything the window shows, and the one place that changes it.

 The filtered results are cached and recomputed when an input changes, rather than computed in a view
 body, because a body runs many times per frame and a search over the whole journal should run once.
 */
@MainActor
@Observable
final class AppModel {
  /** Which part of the calendar the sidebar picker shows. A day is picked inside these, so it is not one of them. */
  enum PickerUnit: String, CaseIterable, Identifiable {
    case year, month, week
    var id: Self { self }

    var periodUnit: Period.Unit {
      switch self {
      case .year: .year
      case .month: .month
      case .week: .week
      }
    }
  }

  struct DayGroup: Identifiable {
    let day: Date
    let entries: [Entry]
    var id: Date { day }
  }

  let journal = Journal()
  /** The bundled CLI, given the shell's config location once that is known. */
  private(set) var cli = JournalCLI.bundled()
  @ObservationIgnored private var hasShellEnvironment = false
  private let filterStore = SavedFilterStore.default

  private(set) var config: JournalCLI.Config?
  private(set) var configError: String?

  /** The selected period, or nil for every entry. */
  var period: Period? = Period(.week, containing: .now) {
    didSet { recompute() }
  }

  var query = Query() {
    didSet {
      /** Each new search starts over all time, so the scope resets once the text is gone. */
      if !SearchScope.isSearching(query.text) && searchScope != .all {
        searchScope = .all
      } else {
        recompute()
      }
    }
  }

  /** Where a text search looks: all time, or only the selected period. */
  var searchScope: SearchScope = .all {
    didSet { recompute() }
  }

  /** The period the list shows, which a search over all time leaves out. Nil means every entry. */
  var listedPeriod: Period? {
    searchScope.period(period, text: query.text)
  }

  var pickerUnit: PickerUnit = .month
  /** A date inside the span the picker shows. Moving the picker does not change the selection. */
  var pickerAnchor = Date.now

  /** The selected entries. One shows in the detail pane; several can be removed together. */
  var selection: Set<Entry.ID> = []

  /**
   The window's undo manager, handed over by the window. It has to be the one SwiftUI connects to
   Edit > Undo, which is not necessarily the one the AppKit window reports.
   */
  @ObservationIgnored weak var undoManager: UndoManager?

  private(set) var removalError: String?

  /** Set by the Find command. The window moves keyboard focus to the search field and clears it again. */
  var wantsSearchFocus = false

  /** Whether the search field has focus, so ⌘⌫ deletes text there rather than entries. */
  var isSearchFocused = false

  /** Whether the search dropdown shows, which outlasts the field's focus while the pointer is on it. */
  var isSearchOpen = false
  /** The highlighted suggestion, or nil for none. Arrow keys move it, Return applies it. */
  var searchHighlight: Int?

  private(set) var recentSearches: [String] = UserDefaults.standard.stringArray(forKey: Preference.recentSearches) ?? []

  /** Set by the Save button. The window asks for a name and saves the current filter under it. */
  var isNamingFilter = false

  private(set) var savedFilters: [SavedFilter] = []
  private(set) var savedFiltersError: String?

  /** Entries in the period that match the query, newest first. */
  private(set) var results: [Entry] = []
  private(set) var groups: [DayGroup] = []
  /** Entries per day that match the query in any period, for the calendar marks and the shortcut counts. */
  private(set) var dayCounts: [Date: Int] = [:]
  /** Entries that match the query in any period. */
  private(set) var matchCount = 0
  /** Entries in the selected period that match the query, for the scope switch. */
  private(set) var periodMatchCount = 0
  /** Entries per local hour that match every filter except the time of day, for the time picker. */
  private(set) var hourCounts = Array(repeating: 0, count: 24)
  /** Count, recency and directories per project, over the whole journal. */
  private(set) var projectStats: [String: ProjectStats] = [:]
  /** The git remote per project, once looked up. A project without one maps to nil. */
  private(set) var remotes: [String: GitRemote?] = [:]
  @ObservationIgnored private var isLoadingRemotes = false
  /** The folded search terms, for highlighting. */
  private(set) var searchTerms: [String] = []

  init() {
    journal.onChange = { [weak self] in
      guard let self else { return }
      projectStats = ProjectStats.compute(journal.entries)
      recompute()
    }
    loadSavedFilters()
  }

  /** The entry the detail pane shows, which needs exactly one selected. */
  var selectedEntry: Entry? {
    guard selection.count == 1, let id = selection.first else { return nil }
    return results.first { $0.id == id }
  }

  var selectedEntries: [Entry] {
    results.filter { selection.contains($0.id) }
  }

  // MARK: - Removing

  /**
   Removes entries, after a confirmation when that is needed: always for a permanent delete, and for
   more than one entry. A single entry going to the Trash needs none, since Undo brings it back.
   */
  func requestRemoval(_ entries: [Entry]) {
    guard !entries.isEmpty else { return }
    let mode = Self.removalMode
    guard mode == .permanent || entries.count > 1 else {
      remove(entries)
      return
    }

    /**
     An AppKit alert rather than a SwiftUI dialog, because it is asked for from menu commands and
     context menus as well as from views, and a sheet shown from here does not depend on which view
     is on screen.
     */
    let what = entries.count == 1 ? "this entry" : "\(entries.count) entries"
    let alert = NSAlert()
    alert.alertStyle = mode == .permanent ? .critical : .warning
    alert.messageText = mode == .trash ? "Move \(what) to the Trash?" : "Delete \(what) permanently?"
    alert.informativeText = mode == .trash ? "You can put them back with Undo or from the Trash." : "This cannot be undone."
    alert.addButton(withTitle: mode.title(count: entries.count))
    alert.addButton(withTitle: "Cancel")
    alert.buttons.first?.hasDestructiveAction = true

    let respond: (NSApplication.ModalResponse) -> Void = { [weak self] response in
      if response == .alertFirstButtonReturn { self?.remove(entries) }
    }
    if let window = NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first(where: \.isVisible) {
      alert.beginSheetModal(for: window, completionHandler: respond)
    } else {
      respond(alert.runModal())
    }
  }

  func remove(_ entries: [Entry]) {
    let mode = Self.removalMode
    let urls = entries.map(\.url)

    var removed: [EntryRemoval.Removed] = []
    do {
      removed = try EntryRemoval.remove(urls, mode: mode)
      removalError = nil
    } catch let failure as EntryRemoval.PartialFailure {
      removed = failure.removed
      removalError = failure.localizedDescription
    } catch {
      removalError = error.localizedDescription
    }

    if mode == .trash, !removed.isEmpty {
      registerUndo(for: removed)
    }
    Task { await journal.refresh() }
  }

  /** Undo puts the files back from the Trash, and its redo sends them there again. */
  private func registerUndo(for removed: [EntryRemoval.Removed]) {
    guard let undoManager else { return }
    let ids = Set(removed.map { $0.original.deletingPathExtension().lastPathComponent })
    undoManager.registerUndo(withTarget: self) { model in
      do {
        try EntryRemoval.restore(removed)
        model.selection = ids
      } catch {
        model.removalError = error.localizedDescription
      }
      Task { await model.journal.refresh() }
      undoManager.registerUndo(withTarget: model) { model in
        model.remove(model.journal.entries.filter { ids.contains($0.id) })
      }
    }
    undoManager.setActionName(removed.count == 1 ? "Move to Trash" : "Move \(removed.count) Entries to Trash")
  }

  static var removalMode: EntryRemoval.Mode {
    EntryRemoval.Mode(rawValue: UserDefaults.standard.string(forKey: Preference.removalMode) ?? "") ?? .trash
  }


  func clearRemovalError() {
    removalError = nil
  }


  // MARK: - Loading

  /** Reads the configured directory through the CLI and opens it. */
  func start() async {
    /**
     Agents started from a terminal see the shell's XDG_CONFIG_HOME and an app started from Finder
     does not, so it is read from the shell once, or the app and the agents could use different
     config files and directories.
     */
    if !hasShellEnvironment, let bundled = cli {
      hasShellEnvironment = true
      if ProcessInfo.processInfo.environment["XDG_CONFIG_HOME"] == nil,
        let value = await Task.detached(operation: { ShellEnvironment.value(of: "XDG_CONFIG_HOME") }).value
      {
        cli = JournalCLI(executable: bundled.executable, environment: bundled.environment.merging(["XDG_CONFIG_HOME": value]) { $1 })
      }
    }
    guard let cli else {
      configError = "The agent-journal CLI is missing from the app bundle."
      await journal.open(FileManager.default.homeDirectoryForCurrentUser.appending(path: "agent-journal"))
      return
    }
    do {
      let config = try await cli.config()
      self.config = config
      configError = nil
      if config.journalDir != journal.directory {
        await journal.open(config.journalDir)
      }
    } catch {
      configError = error.localizedDescription
    }
  }

  func setJournalDir(_ url: URL) async {
    guard let cli else { return }
    do {
      try await cli.setJournalDir(url.path)
      await start()
    } catch {
      configError = error.localizedDescription
    }
  }

  func resetJournalDir() async {
    guard let cli else { return }
    do {
      try await cli.resetJournalDir()
      await start()
    } catch {
      configError = error.localizedDescription
    }
  }

  // MARK: - Periods

  func select(_ period: Period?) {
    /** Picking a period while searching asks for the matches in it. */
    if SearchScope.isSearching(query.text) && period != nil {
      searchScope = .period
    }
    self.period = period
    if let period { pickerAnchor = period.start }
  }

  func step(_ count: Int) {
    guard let period else { return }
    select(period.advanced(by: count))
  }

  func count(in period: Period) -> Int {
    Activity.count(in: period, counts: dayCounts)
  }

  // MARK: - Filters

  func clearFilters() {
    query = Query()
  }

  /** What the dropdown offers for the current text. Projects come most recently used first. */
  var searchSuggestions: [SearchSuggestion] {
    let projects = projectStats.sorted { $0.value.last > $1.value.last }.map(\.key)
      .filter { !query.contains(FieldKey.project, $0) }
    return SearchSuggestions.build(text: query.text, recents: recentSearches, projects: projects)
  }

  func applySuggestion(_ suggestion: SearchSuggestion) {
    switch suggestion {
    case .search(let text):
      remember(text)
      submitSearch()
    case .recent(let text):
      query.text = text
      remember(text)
      submitSearch()
    case .project(let project):
      var next = query
      next.text = SearchSuggestions.removingLastWord(next.text)
      next.facets[FieldKey.project] = [project]
      query = next
    }
    isSearchOpen = false
    searchHighlight = nil
  }

  func clearRecentSearches() {
    recentSearches = []
    UserDefaults.standard.removeObject(forKey: Preference.recentSearches)
  }

  private func remember(_ text: String) {
    recentSearches = SearchSuggestions.remember(text, in: recentSearches)
    UserDefaults.standard.set(recentSearches, forKey: Preference.recentSearches)
  }

  /** Applies typed `key:value` words as filters and keeps the rest as search text. */
  func submitSearch() {
    let parsed = SearchInput.parse(query.text, keys: Set(journal.facets.keys))
    guard !parsed.tokens.isEmpty else { return }
    var next = query
    for token in parsed.tokens where !next.contains(token.key, token.value) {
      next.toggle(token.key, token.value)
    }
    next.text = parsed.text
    query = next
  }

  /**
   Applies a click on a filter value. A plain click picks the value alone, and Shift or Command adds it
   to the others, the way selection works in Finder.
   */
  func pick(_ key: String, _ value: String, modifiers: NSEvent.ModifierFlags) {
    if modifiers.contains(.shift) || modifiers.contains(.command) {
      query.toggle(key, value)
    } else {
      query.select(key, value)
    }
  }

  /**
   Looks up the git remote of every project, off the main thread. Each project is tried in the
   directories its entries were written in, most used first, since a worktree may have been removed
   since and the main checkout may have moved.
   */
  func loadRemotes() {
    guard !isLoadingRemotes else { return }
    let pending = projectStats.filter { remotes[$0.key] == nil }.mapValues(\.directories)
    guard !pending.isEmpty else { return }
    isLoadingRemotes = true

    Task {
      let found = await Task.detached(priority: .utility) {
        pending.mapValues { directories -> GitRemote? in
          for directory in directories.prefix(5) {
            if let remote = GitRemote.origin(of: Style.expandHome(directory)) { return remote }
          }
          return nil
        }
      }.value
      for (project, remote) in found { remotes[project] = .some(remote) }
      isLoadingRemotes = false
    }
  }

  func apply(_ filter: SavedFilter) {
    query = filter.query
  }

  func saveCurrentFilter(named name: String) {
    savedFilters.append(SavedFilter(name: name, query: query))
    persistSavedFilters()
  }

  func updateSavedFilter(_ filter: SavedFilter) {
    guard let index = savedFilters.firstIndex(where: { $0.id == filter.id }) else { return }
    savedFilters[index].query = query
    persistSavedFilters()
  }

  func renameSavedFilter(_ filter: SavedFilter, to name: String) {
    guard let index = savedFilters.firstIndex(where: { $0.id == filter.id }) else { return }
    savedFilters[index].name = name
    persistSavedFilters()
  }

  func deleteSavedFilter(_ filter: SavedFilter) {
    savedFilters.removeAll { $0.id == filter.id }
    persistSavedFilters()
  }

  func moveSavedFilters(from source: IndexSet, to destination: Int) {
    savedFilters.move(fromOffsets: source, toOffset: destination)
    persistSavedFilters()
  }

  private func loadSavedFilters() {
    do {
      savedFilters = try filterStore.load()
    } catch {
      savedFiltersError = error.localizedDescription
    }
  }

  private func persistSavedFilters() {
    do {
      try filterStore.save(savedFilters)
      savedFiltersError = nil
    } catch {
      savedFiltersError = error.localizedDescription
    }
  }

  // MARK: - Results

  private func recompute() {
    let match = query.matcher()
    let matching = journal.entries.filter(match)
    let calendar = Calendar.autoupdatingCurrent

    matchCount = matching.count
    var withoutHours = query
    withoutHours.hours = nil
    hourCounts = Activity.countsPerHour(query.hours == nil ? matching : journal.entries.filter(withoutHours.matcher()), calendar: calendar)
    dayCounts = Activity.countsPerDay(matching, calendar: calendar)
    searchTerms = TextSearch.terms(query.text)

    var inPeriod = matching
    if let period {
      let interval = period.interval(in: calendar)
      inPeriod = matching.filter { $0.date >= interval.start && $0.date < interval.end }
    }
    periodMatchCount = inPeriod.count
    results = listedPeriod == nil ? matching : inPeriod

    var groups: [DayGroup] = []
    var day: Date?
    var current: [Entry] = []
    for entry in results {
      let start = calendar.startOfDay(for: entry.date)
      if start != day, let day {
        groups.append(DayGroup(day: day, entries: current))
        current = []
      }
      day = start
      current.append(entry)
    }
    if let day { groups.append(DayGroup(day: day, entries: current)) }
    self.groups = groups

    /** A selection the filters removed would leave the detail pane showing an entry the list does not. */
    let visible = Set(results.map(\.id))
    selection.formIntersection(visible)
    if selection.isEmpty, let first = results.first {
      selection = [first.id]
    }
  }
}

/**
 The wording for the removal setting. Views read the setting through `@AppStorage` and use these, so a
 menu title changes as soon as the setting does.
 */
extension EntryRemoval.Mode {
  /** Names the entry, so it is never mistaken for the Edit menu's own Delete, which acts on text. */
  var title: String {
    title(count: 1)
  }

  func title(count: Int) -> String {
    switch (self, count) {
    case (.trash, 1): "Move to Trash"
    case (.trash, _): "Move \(count) Entries to Trash"
    case (.permanent, 1): "Delete Entry"
    case (.permanent, _): "Delete \(count) Entries"
    }
  }
}
