import JournalKit
import SwiftUI

/** Summaries grouped by local day, newest first. Selecting one shows it in the detail pane. */
struct EntryList: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    @Bindable var model = model

    List(selection: $model.selection) {
      ForEach(model.groups) { group in
        Section(Style.dayHeading(group.day)) {
          ForEach(group.entries) { entry in
            EntryRow(entry: entry, terms: model.searchTerms)
              .tag(entry.id)
          }
        }
      }
    }
    .listStyle(.inset)
    /** For the clicked row, or for every selected row when the click is inside the selection. */
    .contextMenu(forSelectionType: Entry.ID.self) { ids in
      EntryMenuItems(entries: model.results.filter { ids.contains($0.id) })
    }
    /** A new period starts at its top. Scrolling to the first row instead leaves it under the pinned day header. */
    .id(model.period)
  }
}

struct EntryRow: View {
  let entry: Entry
  let terms: [String]

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 6) {
        Text(Style.time(entry.date))
          .monospacedDigit()
        if let project = entry.project {
          ProjectDot(project: project)
          Text(project).fontWeight(.semibold)
        }
        if let agent = entry.agent {
          Text(agent.split(separator: "/").first.map(String.init) ?? agent)
        }
      }
      .font(.caption)
      .foregroundStyle(.secondary)

      Text(Style.highlighted(entry.summary.isEmpty ? entry.id : entry.summary, terms: terms))
        .lineLimit(2)
    }
    .padding(.vertical, 3)
  }
}
