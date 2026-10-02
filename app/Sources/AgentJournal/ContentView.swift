import JournalKit
import SwiftUI

struct ContentView: View {
  @Environment(AppModel.self) private var model
  @AppStorage(Preference.viewMode) private var viewMode = ViewMode.list
  @State private var filterName = ""
  @Environment(\.undoManager) private var undoManager
  @AppStorage(Preference.removalMode) private var removalMode = EntryRemoval.Mode.trash

  var body: some View {
    @Bindable var model = model
    let (periodTitle, periodSubtitle) = Style.title(for: model.period)
    let searching = SearchScope.isSearching(model.query.text)
    /** A search names itself and where it looked, since the list may not be the calendar's period. */
    let title = searching ? "Search: “\(model.query.text.trimmingCharacters(in: .whitespaces))”" : periodTitle
    let subtitle = searching ? (model.listedPeriod.map { Style.title(for: $0).0 } ?? "All time") : periodSubtitle

    NavigationSplitView {
      Sidebar()
        .navigationSplitViewColumnWidth(min: 240, ideal: 260, max: 340)
    } detail: {
      VStack(spacing: 0) {
        FilterBar()
        Divider()
        /** Every state fills the pane, so an empty one cannot shrink it and pull the filter bar down. */
        content
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(Style.pageBackground)
          .alert("Could not remove the entry", isPresented: Binding(get: { model.removalError != nil }, set: { if !$0 { model.clearRemovalError() } })) {
            Button("OK") { model.clearRemovalError() }
          } message: {
            Text(model.removalError ?? "")
          }
      }
      .navigationTitle(title)
      .toolbar(removing: .title)
      .toolbar { toolbar(title: title, subtitle: [subtitle, Style.count(model.results.count)].compactMap(\.self).joined(separator: " · ")) }
    }
    .alert("Save Filter", isPresented: $model.isNamingFilter) {
      TextField("Name", text: $filterName)
      Button("Save") {
        let trimmed = filterName.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { model.saveCurrentFilter(named: trimmed) }
        filterName = ""
      }
      Button("Cancel", role: .cancel) { filterName = "" }
    } message: {
      Text("Saves the current filters and search text in the sidebar. The period is not part of it, so the filter applies to any period you open.")
    }
    .onAppear { model.undoManager = undoManager }
    .onChange(of: undoManager) { model.undoManager = undoManager }
  }

  @ViewBuilder private var content: some View {
    switch model.journal.state {
    case .idle, .loading:
      ProgressView()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    case .missing:
      ContentUnavailableView {
        Label("No journal yet", systemImage: "book.closed")
      } description: {
        Text("\(model.journal.directory?.path ?? "The journal directory") does not exist yet. Your agent creates it with the first entry, or choose another directory in Settings.")
      } actions: {
        SettingsLink { Text("Open Settings") }
          .buttonStyle(PillButtonStyle())
      }
    case .failed(let message):
      ContentUnavailableView("Cannot read the journal", systemImage: "exclamationmark.triangle", description: Text(message))
    case .ready where model.journal.entries.isEmpty:
      ContentUnavailableView("No entries yet", systemImage: "book", description: Text("Your agent writes entries on its own. They appear here as soon as they are written."))
    case .ready where model.results.isEmpty:
      ContentUnavailableView {
        Label("No entries", systemImage: model.query.isEmpty ? "calendar" : "line.3.horizontal.decrease.circle")
      } description: {
        Text(model.query.isEmpty ? "Nothing was written in this period." : model.listedPeriod == nil ? "No entries match the search and filters." : "No entries in this period match the filters.")
      } actions: {
        HStack(spacing: 8) {
          if !model.query.isEmpty { Button("Clear Filters") { model.clearFilters() } }
          if model.listedPeriod != nil { Button("Show All Periods") { model.select(nil) } }
        }
        .buttonStyle(PillButtonStyle())
      }
    case .ready:
      switch viewMode {
      case .list:
        HSplitView {
          EntryList()
            .frame(minWidth: 280, idealWidth: 360, maxWidth: 520)
          Group {
            if let entry = model.selectedEntry {
              EntryDetail(entry: entry)
            } else if model.selection.count > 1 {
              ContentUnavailableView {
                Label("\(model.selection.count) entries selected", systemImage: "doc.on.doc")
              } actions: {
                Button(removalMode.title(count: model.selection.count), role: .destructive) { model.requestRemoval(model.selectedEntries) }
                  .buttonStyle(PillButtonStyle())
              }
            } else {
              ContentUnavailableView("No entry selected", systemImage: "doc.text")
            }
          }
          .frame(minWidth: 380, maxWidth: .infinity, maxHeight: .infinity)
        }
      case .feed:
        FeedView()
      }
    }
  }

  /**
   The period controls sit before the title, as in a calendar app, so the title is drawn here rather
   than by the window. The window still gets the title, which the Window menu shows.
   */
  @ToolbarContentBuilder private func toolbar(title: String, subtitle: String) -> some ToolbarContent {
    ToolbarItem(placement: .navigation) {
      HStack(spacing: 12) {
        ControlGroup {
          Button { model.step(-1) } label: { Label("Previous", systemImage: "chevron.left") }
            .help("Previous period (⌘←)")
          Button { model.step(1) } label: { Label("Next", systemImage: "chevron.right") }
            .help("Next period (⌘→)")
        }
        .disabled(model.period == nil)
        .fixedSize()

        VStack(alignment: .leading, spacing: 0) {
          Text(title)
            .font(.headline)
          Text(subtitle)
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .lineLimit(1)
        .fixedSize()
        /**
         A stable width, so a shorter count or period name does not resize the toolbar item, which
         the toolbar answers by moving it and everything in it.
         */
        .frame(minWidth: 240, alignment: .leading)
      }
    }
    ToolbarItem(placement: .principal) {
      SearchField()
    }
  }
}
