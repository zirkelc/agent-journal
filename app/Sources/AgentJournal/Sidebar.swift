import AppKit
import JournalKit
import SwiftUI

/** The sidebar's grid. Section titles, row icons and the calendar all start at `outer + inner`. */
private enum Metrics {
  /** From the sidebar edge to a row's highlight. */
  static let outer: CGFloat = 10
  /** From a row's highlight to its content. */
  static let inner: CGFloat = 8
  /** Per tree level, and the width a disclosure chevron takes. */
  static let indent: CGFloat = 14
  static let chevron: CGFloat = 10
  static let rowHeight: CGFloat = 26
}

/**
 Laid out by hand rather than as a `List`. A list adds its own insets, indents children by a fixed
 amount and reserves room for a scroller, which is what put the rows, the calendar and the section
 titles on different edges.
 */
struct Sidebar: View {
  @Environment(AppModel.self) private var model
  @AppStorage("sidebar.expanded.project") private var projectExpanded = true
  @AppStorage("sidebar.expanded.agent") private var agentExpanded = true

  @State private var renaming: SavedFilter?
  @State private var name = ""

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 1) {
        shortcut("All entries", systemImage: "tray.full", period: nil, count: model.matchCount)
        shortcut("Today", systemImage: "sun.max", period: Period(.day, containing: .now))
        shortcut("This week", systemImage: "calendar.day.timeline.left", period: Period(.week, containing: .now))
        shortcut("This month", systemImage: "calendar", period: Period(.month, containing: .now))

        SectionTitle("Calendar")
        CalendarPicker()
          .padding(.horizontal, Metrics.inner)

        SectionTitle("Filters") {
          if !model.query.isEmpty {
            Button("Clear") { model.clearFilters() }
              .buttonStyle(PillButtonStyle(compact: true))
          }
        }
        ForEach(model.savedFilters) { filter in
          savedFilter(filter)
        }
        FacetGroup(key: FieldKey.project, isExpanded: $projectExpanded)
        FacetGroup(key: FieldKey.agent, isExpanded: $agentExpanded)
      }
      .padding(.horizontal, Metrics.outer)
      .padding(.bottom, 12)
      .background(OverlayScrollers())
    }
    .safeAreaInset(edge: .bottom, spacing: 0) {
      footer
    }
    .alert("Rename Filter", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
      TextField("Name", text: $name)
      Button("Rename") {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        if let renaming, !trimmed.isEmpty { model.renameSavedFilter(renaming, to: trimmed) }
      }
      Button("Cancel", role: .cancel) {}
    }
  }

  private func shortcut(_ title: String, systemImage: String, period: Period?, count: Int? = nil) -> some View {
    SidebarRow(
      title: title,
      systemImage: systemImage,
      count: count ?? period.map(model.count(in:)),
      isSelected: model.period == period
    ) { _ in
      model.select(period)
    }
  }

  private func savedFilter(_ filter: SavedFilter) -> some View {
    SidebarRow(
      title: filter.name,
      systemImage: "line.3.horizontal.decrease.circle",
      isSelected: model.query == filter.query && !filter.query.isEmpty
    ) { _ in
      model.apply(filter)
    }
    .contextMenu {
      Button("Rename…") {
        name = filter.name
        renaming = filter
      }
      Button("Replace with Current Filter") { model.updateSavedFilter(filter) }
        .disabled(model.query.isEmpty)
      Divider()
      Button("Delete", role: .destructive) { model.deleteSavedFilter(filter) }
    }
  }

  private var footer: some View {
    HStack {
      SettingsLink {
        Image(systemName: "gearshape")
          .font(.system(size: 14))
          .frame(width: 24, height: 24)
          .contentShape(Rectangle())
      }
      .buttonStyle(.borderless)
      .help("Settings (⌘,)")
      Spacer()
    }
    .foregroundStyle(.secondary)
    .padding(.horizontal, Metrics.outer + Metrics.inner - 4)
    .padding(.vertical, 8)
  }
}

private struct SectionTitle<Accessory: View>: View {
  let title: String
  let accessory: Accessory

  init(_ title: String, @ViewBuilder accessory: () -> Accessory = { EmptyView() }) {
    self.title = title
    self.accessory = accessory()
  }

  var body: some View {
    HStack {
      Text(title)
      Spacer()
      accessory
    }
    .font(.system(size: 11, weight: .semibold))
    .foregroundStyle(.secondary)
    .padding(.horizontal, Metrics.inner)
    .padding(.top, 16)
    .padding(.bottom, 6)
  }
}

/** A collapsible group of values for one key. Its children line up with its own title, not further in. */
private struct FacetGroup: View {
  @Environment(AppModel.self) private var model
  let key: String
  @Binding var isExpanded: Bool

  var body: some View {
    let nodes = model.journal.facets.nodes(for: key)
    if !nodes.isEmpty {
      VStack(alignment: .leading, spacing: 1) {
        Button {
          withAnimation(.snappy(duration: 0.2)) { isExpanded.toggle() }
        } label: {
          HStack(spacing: 6) {
            Chevron(isExpanded: isExpanded)
            Text(FieldLabel.name(key))
            Spacer()
          }
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(.secondary)
          .padding(.horizontal, Metrics.inner)
          .frame(height: Metrics.rowHeight)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)

        if isExpanded {
          /** Values that have values below them get a chevron, so every row of the tree reserves its slot. */
          let isTree = nodes.contains { !$0.children.isEmpty }
          ForEach(nodes) { node in
            FacetRow(key: key, node: node, depth: 0, isTree: isTree)
          }
        }
      }
      .padding(.top, 2)
    }
  }
}

private struct FacetRow: View {
  @Environment(AppModel.self) private var model
  let key: String
  let node: Facets.Node
  let depth: Int
  let isTree: Bool
  @State private var isExpanded = false

  var body: some View {
    SidebarRow(
      title: node.name,
      dot: key == FieldKey.project ? node.id : nil,
      systemImage: key == FieldKey.project ? nil : icon,
      count: node.count,
      isSelected: model.query.contains(key, node.id),
      leading: Metrics.chevron + 6 + CGFloat(depth) * Metrics.indent,
      disclosure: isTree ? (node.children.isEmpty ? .some(nil) : .some($isExpanded)) : nil
    ) { modifiers in
      model.pick(key, node.id, modifiers: modifiers)
    }
    .help("\(node.id)\nClick to show only this, Shift-click to add it")

    if isExpanded {
      ForEach(node.children) { child in
        FacetRow(key: key, node: child, depth: depth + 1, isTree: true)
      }
    }
  }

  private var icon: String {
    switch key {
    case FieldKey.agent: "cpu"
    case FieldKey.cwd: "folder"
    default: "tag"
    }
  }
}

private struct Chevron: View {
  let isExpanded: Bool

  var body: some View {
    Image(systemName: "chevron.right")
      .font(.system(size: 9, weight: .bold))
      .rotationEffect(.degrees(isExpanded ? 90 : 0))
      .frame(width: Metrics.chevron)
  }
}

/** A sidebar row that acts on click and shows whether it is selected. Several can be selected at once. */
private struct SidebarRow: View {
  let title: String
  var dot: String? = nil
  var systemImage: String? = nil
  var count: Int? = nil
  let isSelected: Bool
  /** Extra space before the icon, for nesting. */
  var leading: CGFloat = 0
  /**
   A chevron slot before the icon. Nil means no slot, `.some(nil)` an empty slot that keeps a leaf in
   line with its siblings, and a binding a chevron that expands the row.
   */
  var disclosure: Binding<Bool>?? = nil
  let action: (NSEvent.ModifierFlags) -> Void

  var body: some View {
    HStack(spacing: 6) {
      if let disclosure {
        if let isExpanded = disclosure {
          Button {
            withAnimation(.snappy(duration: 0.2)) { isExpanded.wrappedValue.toggle() }
          } label: {
            Chevron(isExpanded: isExpanded.wrappedValue)
              .frame(height: Metrics.rowHeight)
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .foregroundStyle(.secondary)
        } else {
          Color.clear.frame(width: Metrics.chevron)
        }
      }

      Button {
        action(NSEvent.modifierFlags)
      } label: {
        HStack(spacing: 8) {
          if let dot {
            ProjectDot(project: dot)
              .frame(width: 16)
          } else if let systemImage {
            Image(systemName: systemImage)
              .foregroundStyle(isSelected ? Color.accentColor : .secondary)
              .frame(width: 16)
          }
          Text(title)
            .lineLimit(1)
            .truncationMode(.middle)
          Spacer(minLength: 4)
          if let count {
            Text(count.formatted())
              .font(.caption)
              .monospacedDigit()
              .foregroundStyle(.secondary)
          }
        }
        .frame(height: Metrics.rowHeight)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
    }
    .padding(.leading, Metrics.inner + leading)
    .padding(.trailing, Metrics.inner)
    .background(isSelected ? Color.accentColor.opacity(0.2) : .clear, in: RoundedRectangle(cornerRadius: 6))
  }
}

/**
 Turns the scroll view around it to overlay scrollers. A legacy scroller takes a column of its own and
 appears once the content outgrows the sidebar, which shifts every row sideways. An overlay scroller
 floats above the content and only shows while scrolling. The system switches styles when its
 preference changes, so the style is applied again then.
 */
private struct OverlayScrollers: NSViewRepresentable {
  final class Probe: NSView {
    private var isObserving = false

    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      apply()
      guard !isObserving else { return }
      isObserving = true
      /** A selector observer is removed by the system when the view goes away. */
      NotificationCenter.default.addObserver(
        self, selector: #selector(apply), name: NSScroller.preferredScrollerStyleDidChangeNotification, object: nil)
    }

    @objc func apply() {
      guard let scrollView = enclosingScrollView else { return }
      scrollView.scrollerStyle = .overlay
      scrollView.autohidesScrollers = true
    }
  }

  func makeNSView(context: Context) -> Probe { Probe() }
  func updateNSView(_ view: Probe, context: Context) { view.apply() }
}
