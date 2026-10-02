import JournalKit
import SwiftUI

/**
 The whole period as one page, day by day, to read a week the way it was lived rather than one entry
 at a time. Cards are built lazily, so a period of thousands of entries renders only what is on screen.
 */
struct FeedView: View {
  @Environment(AppModel.self) private var model
  @AppStorage(Preference.viewMode) private var viewMode = ViewMode.list

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 10, pinnedViews: [.sectionHeaders]) {
        ForEach(model.groups) { group in
          Section {
            ForEach(group.entries) { entry in
              FeedCard(entry: entry, terms: model.searchTerms)
                .onTapGesture(count: 2) {
                  model.selection = [entry.id]
                  viewMode = .list
                }
            }
          } header: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              Text(Style.dayHeading(group.day)).font(.headline)
              Text(Style.count(group.entries.count)).foregroundStyle(.secondary)
              Spacer()
            }
            .padding(.top, 14)
            .padding(.bottom, 6)
            .background(Style.pageBackground)
          }
        }
      }
      .padding(.horizontal, 28)
      .padding(.bottom, 28)
      .frame(maxWidth: 820)
      .frame(maxWidth: .infinity)
    }
    .background(Style.pageBackground)
    .id(model.period)
  }
}

private struct FeedCard: View {
  let entry: Entry
  let terms: [String]
  /** The actions show on hover only, so a page of cards reads as text rather than as rows of buttons. */
  @State private var isHovering = false
  @AppStorage(Preference.showRaw) private var showRaw = false

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        Text(Style.time(entry.date)).monospacedDigit()
        if let project = entry.project {
          ProjectDot(project: project)
          Text(project).fontWeight(.semibold)
        }
        if let agent = entry.agent { Text(agent) }
        if let cwd = entry.cwd {
          Text(cwd).lineLimit(1).truncationMode(.middle)
        }
        Spacer()
        EntryActions(entry: entry)
          .opacity(isHovering ? 1 : 0)
      }
      .font(.caption)
      .foregroundStyle(.secondary)

      if !showRaw {
        Text(Style.highlighted(entry.summary.isEmpty ? entry.id : entry.summary, terms: terms))
          .font(.body.weight(.semibold))
          .textSelection(.enabled)
      }

      EntryBody(entry: entry)
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.08)))
    .onHover { isHovering = $0 }
    .contextMenu { EntryMenuItems(entries: [entry]) }
    .help("Double-click to open in the list")
  }
}
