import JournalKit
import SwiftUI

/**
 A menu for each frontmatter key, plus time of day. The keys the format defines are always shown; any
 other key an entry carries shows here once it is in use, for example from a `key:value` search.
 */
struct FilterBar: View {
  @Environment(AppModel.self) private var model
  @AppStorage(Preference.viewMode) private var viewMode = ViewMode.list

  private static let pinned = [FieldKey.project, FieldKey.agent, FieldKey.cwd]

  var body: some View {
    let keys = model.journal.facets.keys
    let others = keys.filter { !Self.pinned.contains($0) }

    HStack(spacing: 6) {
      /** While searching within a period, where to look, with the number of matches each way. */
      if let period = model.period, SearchScope.offersChoice(period: period, text: model.query.text) {
        @Bindable var model = model
        PillSegments(selection: $model.searchScope, options: [
          .init(value: .all, title: "All time", badge: model.matchCount, help: "Search the whole journal"),
          .init(value: .period, title: Style.title(for: period).0, badge: model.periodMatchCount, help: "Search only the period the calendar shows"),
        ])
        .padding(.trailing, 6)
      }
      if keys.contains(FieldKey.project) {
        FilterPill(name: "Project", value: pillValue(selected(FieldKey.project)), isActive: isActive(FieldKey.project)) {
          ProjectPicker()
        }
      }
      if keys.contains(FieldKey.agent) {
        FilterPill(name: "Agent", value: pillValue(selected(FieldKey.agent), name: AgentBadge.displayName), isActive: isActive(FieldKey.agent)) {
          AgentPicker()
        }
      }
      if keys.contains(FieldKey.cwd) {
        FilterPill(name: "Directory", value: pillValue(selected(FieldKey.cwd), name: lastComponent), isActive: isActive(FieldKey.cwd)) {
          DirectoryPicker()
        }
      }
      FilterPill(name: "Time", value: hoursLabel, isActive: model.query.hours != nil) {
        TimePicker()
      }
      /** A key outside the format, set from a `key:value` search, keeps a plain menu. */
      ForEach(others.filter { model.query.facets[$0] != nil }, id: \.self) { key in
        FacetMenu(key: key)
      }

      Button { model.isNamingFilter = true } label: {
        HStack(spacing: 4) {
          Image(systemName: "square.and.arrow.down")
          Text("Save")
        }
        .chip(isActive: false, isDashed: true)
      }
      .buttonStyle(.plain)
      .disabled(model.query.isEmpty)
      .opacity(model.query.isEmpty ? 0.5 : 1)
      .help("Save these filters in the sidebar")

      if !model.query.isEmpty {
        Button("Clear") { model.clearFilters() }
          .buttonStyle(PillButtonStyle())
      }

      Spacer()

      SourceToggle()
      LayoutToggle(mode: $viewMode)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
  }

  private func selected(_ key: String) -> Set<String> {
    model.query.facets[key] ?? []
  }

  private func isActive(_ key: String) -> Bool {
    !selected(key).isEmpty
  }

  private func lastComponent(_ path: String) -> String {
    path.split(separator: "/").last.map(String.init) ?? path
  }

  private var hoursLabel: String {
    guard let hours = model.query.hours else { return "Any" }
    return hours.presetName ?? String(format: "%02d:00 – %02d:00", hours.from, hours.to)
  }
}

/** A pop-up for one key that reads "Project: Any" or "Project: nebula" and lists the values as a tree. */
private struct FacetMenu: View {
  @Environment(AppModel.self) private var model
  let key: String

  var body: some View {
    let selected = model.query.facets[key] ?? []
    let value = pillValue(selected)

    Menu {
      if !selected.isEmpty {
        Button("Any \(FieldLabel.name(key))") { model.query.facets[key] = nil }
        Divider()
      }
      FacetItems(key: key, nodes: model.journal.facets.nodes(for: key), title: nil)
    } label: {
      ChipLabel(name: FieldLabel.name(key), value: value, isActive: !selected.isEmpty)
    }
    .chipMenu()
  }
}

/** The values of a key as menu toggles. A value with children becomes a submenu, which can also be picked whole. */
private struct FacetItems: View {
  @Environment(AppModel.self) private var model
  let key: String
  let nodes: [Facets.Node]
  /** When set, the items are wrapped in a submenu with this title. */
  let title: String?

  var body: some View {
    if let title {
      Menu(title) { items }
    } else {
      items
    }
  }

  private var items: some View {
    ForEach(nodes) { node in
      if node.children.isEmpty {
        toggle(node, label: "\(node.name)  \(node.count)")
      } else {
        Menu("\(node.name)  \(node.count)") {
          toggle(node, label: "All of \(node.name)")
          Divider()
          FacetItems(key: key, nodes: node.children, title: nil)
        }
      }
    }
  }

  private func toggle(_ node: Facets.Node, label: String) -> some View {
    Toggle(label, isOn: Binding(
      get: { model.query.contains(key, node.id) },
      set: { _ in model.query.toggle(key, node.id) }
    ))
  }
}

/** "Project Any ⌄": the name, the current value in bold, and a small chevron, as one pill. */
struct ChipLabel: View {
  let name: String
  let value: String
  let isActive: Bool

  var body: some View {
    HStack(spacing: 4) {
      Text(name)
        .foregroundStyle(isActive ? Color.accentColor.opacity(0.8) : .secondary)
      Text(value)
        .fontWeight(.semibold)
        .lineLimit(1)
        .truncationMode(.middle)
        .frame(maxWidth: 160)
        .fixedSize()
      Image(systemName: "chevron.down")
        .font(.system(size: 8, weight: .bold))
        .foregroundStyle(.secondary)
    }
    .chip(isActive: isActive)
  }
}

extension View {
  /** The pill every filter control shares. An active filter is tinted, an inactive one only outlined. */
  func chip(isActive: Bool, isDashed: Bool = false, compact: Bool = false) -> some View {
    self
      .font(compact ? .caption : .callout)
      .foregroundStyle(isActive ? Color.accentColor : isDashed ? .secondary : .primary)
      .padding(.horizontal, compact ? 7 : 9)
      .frame(height: compact ? 20 : 24)
      .background(isActive ? Color.accentColor.opacity(0.15) : .clear, in: RoundedRectangle(cornerRadius: 6))
      .overlay {
        RoundedRectangle(cornerRadius: 6)
          .strokeBorder(
            isActive ? .clear : Color.primary.opacity(0.15),
            style: StrokeStyle(lineWidth: 1, dash: isDashed ? [3, 2] : [])
          )
      }
      .contentShape(RoundedRectangle(cornerRadius: 6))
  }

  /** A menu that draws its label as is, without the system pop-up button around it. */
  func chipMenu() -> some View {
    self
      .menuStyle(.button)
      .buttonStyle(.plain)
      .menuIndicator(.hidden)
      .fixedSize()
  }
}

/**
 A square icon in the pill style, for a control that has no value to show. Active is tinted like an
 active filter.
 */
struct IconChip: View {
  let systemImage: String
  var isActive = false
  var size: CGFloat = 12

  var body: some View {
    Image(systemName: systemImage)
      .font(.system(size: size, weight: .medium))
      .frame(width: 30, height: 24)
      .foregroundStyle(isActive ? Color.accentColor : .secondary)
      .background(isActive ? Color.accentColor.opacity(0.15) : .clear, in: RoundedRectangle(cornerRadius: 6))
      .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(isActive ? .clear : Color.primary.opacity(0.15)))
      .contentShape(RoundedRectangle(cornerRadius: 6))
  }
}

/** A button drawn as a pill. Compact is for footers and section headers, where a full pill is too heavy. */
struct PillButtonStyle: ButtonStyle {
  var isActive = false
  var isDashed = false
  var compact = false

  func makeBody(configuration: Configuration) -> some View {
    PillButton(configuration: configuration, style: self)
  }

  /** A view of its own, because only a view can read whether the button is enabled. */
  private struct PillButton: View {
    let configuration: Configuration
    let style: PillButtonStyle
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
      configuration.label
        .lineLimit(1)
        .chip(isActive: style.isActive, isDashed: style.isDashed, compact: style.compact)
        .opacity(isEnabled ? (configuration.isPressed ? 0.6 : 1) : 0.4)
    }
  }
}

/**
 Options in one outlined pill, the current one tinted like an active filter. An option is text, an
 icon, or both. Filling the width spreads the options evenly, as the calendar's Year, Month, Week do.
 */
struct PillSegments<Value: Hashable>: View {
  struct Option {
    let value: Value
    var title: String? = nil
    var systemImage: String? = nil
    /** A count shown as a badge after the title, kept apart from any number in the title itself. */
    var badge: Int? = nil
    var help: String? = nil
  }

  @Binding var selection: Value
  let options: [Option]
  var fillsWidth = false

  var body: some View {
    HStack(spacing: 2) {
      ForEach(Array(options.enumerated()), id: \.offset) { _, option in
        segment(option)
      }
    }
    .padding(2)
    .frame(height: 24)
    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.15)))
    .fixedSize(horizontal: !fillsWidth, vertical: false)
  }

  private func segment(_ option: Option) -> some View {
    let isOn = selection == option.value
    return Button { selection = option.value } label: {
      HStack(spacing: 0) {
        if let systemImage = option.systemImage {
          Image(systemName: systemImage).font(.system(size: 12, weight: .medium))
        }
        if let title = option.title {
          Text(title).font(.callout)
        }
        if let badge = option.badge {
          Text(badge.formatted())
            .font(.caption2.weight(.semibold))
            .monospacedDigit()
            .padding(.horizontal, 5)
            .frame(minWidth: 18, minHeight: 15)
            .background(isOn ? Color.accentColor.opacity(0.25) : Color.primary.opacity(0.1), in: Capsule())
            .padding(.leading, 5)
        }
      }
      .padding(.horizontal, option.title == nil ? 0 : 8)
      .frame(minWidth: 28, maxWidth: fillsWidth ? .infinity : nil)
      .frame(height: 20)
      .foregroundStyle(isOn ? Color.accentColor : .secondary)
      .background(isOn ? Color.accentColor.opacity(0.15) : .clear, in: RoundedRectangle(cornerRadius: 4))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help(option.help ?? "")
  }
}

/** List or Feed, as two icons. */
struct LayoutToggle: View {
  @Binding var mode: ViewMode

  var body: some View {
    PillSegments(selection: $mode, options: [
      .init(value: .list, systemImage: "rectangle.split.2x1", help: "List: one entry at a time (⌘1)"),
      .init(value: .feed, systemImage: "text.justify.left", help: "Feed: the whole period as one page (⌘2)"),
    ])
  }
}
