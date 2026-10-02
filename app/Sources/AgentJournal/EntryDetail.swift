import AppKit
import JournalKit
import SwiftUI
import Textual

struct EntryDetail: View {
  @Environment(AppModel.self) private var model
  @AppStorage(Preference.showRaw) private var showRaw = false
  let entry: Entry

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        HStack {
          Text(entry.date.formatted(.dateTime.weekday(.wide).month(.wide).day().year().hour().minute()))
            .foregroundStyle(.secondary)
          Spacer()
          EntryActions(entry: entry)
        }

        /** The raw view is the file alone. The frontmatter already says what the title and fields would. */
        if !showRaw {
          Text(Style.highlighted(entry.summary.isEmpty ? entry.id : entry.summary, terms: model.searchTerms))
            .font(.title2.weight(.semibold))
            .textSelection(.enabled)

          FieldGrid(entry: entry)
        }

        EntryBody(entry: entry)
      }
      .padding(.horizontal, 28)
      .padding(.vertical, 22)
      .frame(maxWidth: 860, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(Style.pageBackground)
    .id(entry.id)
  }
}

/**
 The body as rendered Markdown or as the file on disk. The raw view is the whole file, frontmatter
 included, because it answers "what did the agent actually write".
 */
struct EntryBody: View {
  let entry: Entry
  @AppStorage(Preference.showRaw) private var showRaw = false

  var body: some View {
    if showRaw {
      Text(entry.raw)
        .font(.system(.callout, design: .monospaced))
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    } else if !entry.body.isEmpty {
      StructuredText(markdown: entry.body)
        .textual.structuredTextStyle(.gitHub)
        .textual.textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

/** Every field except the summary and date, which the header already shows. A value is also a filter. */
private struct FieldGrid: View {
  let entry: Entry

  var body: some View {
    let fields = entry.fields.filter { $0.key != FieldKey.summary && $0.key != FieldKey.date }

    if !fields.isEmpty {
      Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 5) {
        /** By position, since a hand-written entry can repeat a key. */
        ForEach(Array(fields.enumerated()), id: \.offset) { _, field in
          FieldRow(field: field)
        }
      }
      .font(.callout)
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
      .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.08)))
    }
  }
}

/** One field. Its actions appear on hover, so the box reads as data rather than as a row of buttons. */
private struct FieldRow: View {
  @Environment(AppModel.self) private var model
  let field: Entry.Field
  @State private var isHovering = false

  var body: some View {
    GridRow {
      Text(FieldLabel.name(field.key))
        .foregroundStyle(.secondary)
        .gridColumnAlignment(.leading)
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        if field.key == FieldKey.project { ProjectDot(project: field.value) }
        Text(field.value)
          .font(field.key == FieldKey.cwd || field.key == FieldKey.sessionID ? .system(.callout, design: .monospaced) : .callout)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
        HStack(spacing: 4) {
          Button {
            if !model.query.contains(field.key, field.value) { model.query.toggle(field.key, field.value) }
          } label: {
            Image(systemName: "line.3.horizontal.decrease.circle")
          }
          .help("Show only entries with this \(FieldLabel.name(field.key).lowercased())")
          Button { copy(field.value) } label: { Image(systemName: "doc.on.doc") }
            .help("Copy")
        }
        .buttonStyle(.borderless)
        .foregroundStyle(.secondary)
        .opacity(isHovering ? 1 : 0)
      }
    }
    .onHover { isHovering = $0 }
  }
}

struct EntryActions: View {
  let entry: Entry

  var body: some View {
    HStack(spacing: 6) {
      Button { NSWorkspace.shared.open(entry.url) } label: {
        Text("Open in Editor")
          .font(.callout)
          .padding(.horizontal, 9)
          .frame(height: 24)
          .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.15)))
          .contentShape(RoundedRectangle(cornerRadius: 6))
      }
      .buttonStyle(.plain)
      .help("Open the entry in the default app for Markdown files")

      Menu {
        EntryMenuItems(entries: [entry])
      } label: {
        IconChip(systemImage: "ellipsis")
      }
      .chipMenu()
      .help("More actions")
    }
  }
}

/** The actions on one or more entries, shared by the ⋯ menu and the context menus of the list and the feed. */
struct EntryMenuItems: View {
  @Environment(AppModel.self) private var model
  @AppStorage(Preference.removalMode) private var removalMode = EntryRemoval.Mode.trash
  let entries: [Entry]

  var body: some View {
    if entries.count == 1, let entry = entries.first {
      Button("Open in Editor") { NSWorkspace.shared.open(entry.url) }
      Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([entry.url]) }
      if let cwd = entry.cwd {
        Button("Open Working Directory") { NSWorkspace.shared.open(Style.expandHome(cwd)) }
      }
      Divider()
      Button("Copy Path") { copy(entry.url.path) }
      Button("Copy Markdown") { copy(entry.raw) }
      if let session = entry.sessionID {
        Button("Copy Session ID") { copy(session) }
      }
    } else {
      Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting(entries.map(\.url)) }
    }
    Divider()
    Button(removalMode.title(count: entries.count), role: .destructive) {
      model.requestRemoval(entries)
    }
  }
}

/** Shows the entry as the file on disk. On means source, so the button reads as "show the source". */
struct SourceToggle: View {
  @AppStorage(Preference.showRaw) private var showRaw = false

  var body: some View {
    Button { showRaw.toggle() } label: {
      IconChip(systemImage: "chevron.left.forwardslash.chevron.right", isActive: showRaw, size: 11)
    }
    .buttonStyle(.plain)
    .help(showRaw ? "Show rendered Markdown (⇧⌘R)" : "Show the source (⇧⌘R)")
  }
}

func copy(_ text: String) {
  NSPasteboard.general.clearContents()
  NSPasteboard.general.setString(text, forType: .string)
}
