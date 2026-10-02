import AppKit
import JournalKit
import SwiftUI

/** A filter pill that opens a popover with a picker made for its kind of value. */
struct FilterPill<Picker: View>: View {
  @Environment(AppModel.self) private var model
  let name: String
  let value: String
  let isActive: Bool
  @ViewBuilder let picker: () -> Picker
  @State private var isPresented = false
  @State private var toggle = PopoverToggle()

  var body: some View {
    /** Records every close, so the click that closed the popover from outside does not open it again. */
    let presented = Binding(
      get: { isPresented },
      set: { open in
        if !open { toggle.closed() }
        isPresented = open
      }
    )

    Button { isPresented = toggle.click(isOpen: isPresented) } label: {
      ChipLabel(name: name, value: value, isActive: isActive)
    }
    .buttonStyle(.plain)
    .fixedSize()
    /**
     Anchored to a fixed spot at the pill's leading edge rather than to the pill. Picking a value
     changes the pill's width, and a popover anchored to its center would move with it.
     */
    .overlay(alignment: .leading) {
      Color.clear
        .frame(width: 56, height: 24)
        .allowsHitTesting(false)
        .popover(isPresented: presented, arrowEdge: .bottom) {
          picker()
            .environment(model)
        }
    }
  }
}

/** The value a pill shows for a key: Any, the one value, or how many. */
func pillValue(_ selected: Set<String>, name: (String) -> String = { $0 }) -> String {
  switch selected.count {
  case 0: "Any"
  case 1: selected.first == Query.notRecorded ? "Not recorded" : name(selected.first!)
  default: "\(selected.count) selected"
  }
}

// MARK: - Shared parts

/** The bottom bar every picker has: a hint on the left, Clear on the right. */
private struct PickerFooter: View {
  let hint: String
  let canClear: Bool
  let clear: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Text(hint)
        .font(.caption)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      Spacer()
      Button("Clear", action: clear)
        .buttonStyle(PillButtonStyle(compact: true))
        .disabled(!canClear)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
  }
}

/** A row that picks a value: a plain click picks it alone, Shift or Command adds it. */
private struct PickRow<Content: View>: View {
  let isSelected: Bool
  let action: (NSEvent.ModifierFlags) -> Void
  @ViewBuilder let content: () -> Content

  var body: some View {
    Button { action(NSEvent.modifierFlags) } label: {
      HStack(spacing: 10) {
        content()
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 5)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(isSelected ? Color.accentColor.opacity(0.18) : .clear, in: RoundedRectangle(cornerRadius: 7))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

private struct Checkbox: View {
  let isOn: Bool

  var body: some View {
    Image(systemName: isOn ? "checkmark.square.fill" : "square")
      .foregroundStyle(isOn ? Color.accentColor : .secondary)
      .font(.system(size: 13))
  }
}

/** A rounded square with a letter or symbol, for anything without a picture of its own. */
struct Monogram: View {
  let text: String
  let color: Color
  var size: CGFloat = 28

  var body: some View {
    RoundedRectangle(cornerRadius: size * 0.25)
      .fill(color.gradient)
      .frame(width: size, height: size)
      .overlay {
        Text(text)
          .font(.system(size: size * 0.46, weight: .bold))
          .foregroundStyle(.white)
      }
  }
}

private struct CountColumn: View {
  let count: Int
  var detail: String? = nil

  var body: some View {
    VStack(alignment: .trailing, spacing: 1) {
      Text(count.formatted())
        .monospacedDigit()
      if let detail {
        Text(detail)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .foregroundStyle(.secondary)
  }
}

private func relativeDay(_ date: Date) -> String {
  let calendar = Calendar.autoupdatingCurrent
  if calendar.isDateInToday(date) { return "today" }
  if calendar.isDateInYesterday(date) { return "yesterday" }
  let sameYear = calendar.isDate(date, equalTo: .now, toGranularity: .year)
  return sameYear ? date.formatted(.dateTime.month(.abbreviated).day()) : date.formatted(.dateTime.month(.abbreviated).day().year())
}

// MARK: - Project

struct ProjectPicker: View {
  @Environment(AppModel.self) private var model
  @AppStorage(Preference.showAvatars) private var showAvatars = true
  @State private var search = ""
  @State private var order = Order.recent

  enum Order: String, CaseIterable {
    case recent = "Recent"
    case count = "Most entries"
    case name = "Name"
  }

  var body: some View {
    let key = FieldKey.project
    let projects = sorted(model.journal.facets.nodes(for: key).map(\.id).filter(matchesSearch))
    let missing = model.journal.facets.missing(for: key)

    VStack(spacing: 0) {
      HStack(spacing: 8) {
        TextField("Filter projects", text: $search)
          .textFieldStyle(.roundedBorder)
        Menu {
          Picker("Sort", selection: $order) {
            ForEach(Order.allCases, id: \.self) { Text($0.rawValue).tag($0) }
          }
          .pickerStyle(.inline)
        } label: {
          ChipLabel(name: "Sort", value: order.rawValue, isActive: false)
        }
        .chipMenu()
      }
      .padding(10)
      Divider()

      ScrollView {
        LazyVStack(spacing: 1) {
          ForEach(projects, id: \.self) { project in
            row(project)
          }
          if missing > 0 && search.isEmpty {
            PickRow(isSelected: model.query.contains(key, Query.notRecorded)) { modifiers in
              model.pick(key, Query.notRecorded, modifiers: modifiers)
            } content: {
              Monogram(text: "?", color: .gray)
              VStack(alignment: .leading, spacing: 1) {
                Text("Not recorded")
                Text("Entries written outside a repository").font(.caption).foregroundStyle(.secondary)
              }
              Spacer()
              CountColumn(count: missing)
            }
          }
        }
        .padding(6)
      }
      .frame(height: 360)

      Divider()
      PickerFooter(
        hint: showAvatars ? "Remotes come from each project's git config. Avatars load from GitHub." : "Remotes come from each project's git config.",
        canClear: model.query.facets[key] != nil
      ) {
        model.query.facets[key] = nil
      }
    }
    .frame(width: 500)
    .onAppear { model.loadRemotes() }
  }

  private func matchesSearch(_ project: String) -> Bool {
    guard !search.isEmpty else { return true }
    let remote = model.remotes[project].flatMap { $0 }?.display ?? ""
    return project.localizedCaseInsensitiveContains(search) || remote.localizedCaseInsensitiveContains(search)
  }

  private func sorted(_ projects: [String]) -> [String] {
    let stats = model.projectStats
    switch order {
    case .recent: return projects.sorted { (stats[$0]?.last ?? .distantPast) > (stats[$1]?.last ?? .distantPast) }
    case .count: return projects.sorted { (stats[$0]?.count ?? 0) > (stats[$1]?.count ?? 0) }
    case .name: return projects.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }
  }

  private func row(_ project: String) -> some View {
    let stats = model.projectStats[project]
    let remote = model.remotes[project].flatMap { $0 }

    return PickRow(isSelected: model.query.contains(FieldKey.project, project)) { modifiers in
      model.pick(FieldKey.project, project, modifiers: modifiers)
    } content: {
      ProjectAvatar(project: project, remote: showAvatars ? remote : nil)
      VStack(alignment: .leading, spacing: 1) {
        Text(project).lineLimit(1)
        Text(remote?.display ?? (model.remotes[project] == nil ? " " : "no remote"))
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.middle)
      }
      Spacer(minLength: 8)
      if let stats {
        Sparkline(values: stats.weekly)
        CountColumn(count: stats.count, detail: relativeDay(stats.last))
          .frame(minWidth: 64, alignment: .trailing)
      }
    }
    .contextMenu {
      if let remote {
        Button("Open \(remote.display)") { NSWorkspace.shared.open(remote.webURL) }
        Button("Copy Remote URL") { copy(remote.webURL.absoluteString) }
      }
    }
  }
}

/**
 The owner's avatar when there is one, and the project's letter in its color otherwise or while it
 loads. A stored avatar shows at once; a fresher one replaces it when the download finishes.
 */
struct ProjectAvatar: View {
  let project: String
  let remote: GitRemote?
  var size: CGFloat = 28
  @State private var image: NSImage?

  var body: some View {
    Group {
      if let image {
        Image(nsImage: image)
          .resizable()
          .scaledToFill()
          .frame(width: size, height: size)
          .clipShape(RoundedRectangle(cornerRadius: size * 0.25))
      } else {
        Monogram(text: String(project.trimmingCharacters(in: .punctuationCharacters).prefix(1)).uppercased(), color: Style.color(for: project), size: size)
      }
    }
    .task(id: remote) {
      image = nil
      guard let remote, let url = remote.avatarURL else { return }
      let owner = "\(remote.host)/\(remote.owner)"
      if let data = await AvatarCache.shared.stored(for: owner) { image = NSImage(data: data) }
      if let data = await AvatarCache.shared.image(for: owner, url: url) { image = NSImage(data: data) }
    }
  }
}

/** Entries per week as small bars, oldest on the left. */
private struct Sparkline: View {
  let values: [Int]

  var body: some View {
    let maximum = max(values.max() ?? 0, 1)
    HStack(alignment: .bottom, spacing: 1.5) {
      ForEach(Array(values.enumerated()), id: \.offset) { _, value in
        RoundedRectangle(cornerRadius: 1)
          .fill(Color.accentColor.opacity(value == 0 ? 0.15 : 0.7))
          .frame(width: 5, height: max(2, 18 * CGFloat(value) / CGFloat(maximum)))
      }
    }
    .frame(height: 18, alignment: .bottom)
    .help("Entries per week, last \(values.count) weeks")
  }
}

// MARK: - Directory

/**
 Folders as columns, like Finder. Clicking a folder filters by it and everything below it, and opens
 its subfolders in the next column. Typing searches every folder at once.
 */
struct DirectoryPicker: View {
  @Environment(AppModel.self) private var model
  @State private var path: [Facets.Node] = []
  @State private var search = ""

  private let key = FieldKey.cwd
  private static let visibleColumns = 3

  var body: some View {
    let roots = model.journal.facets.nodes(for: key)

    VStack(spacing: 0) {
      HStack(spacing: 8) {
        breadcrumbs
        Spacer(minLength: 12)
        TextField("Find a folder", text: $search)
          .textFieldStyle(.roundedBorder)
          .frame(width: 190)
      }
      .padding(10)
      Divider()

      Group {
        if search.isEmpty {
          columns(roots)
        } else {
          results(roots)
        }
      }
      .frame(height: 300)

      Divider()
      PickerFooter(hint: "A folder includes everything below it.", canClear: model.query.facets[key] != nil) {
        model.query.facets[key] = nil
      }
    }
    .frame(width: 680)
    .onAppear { restorePath(roots) }
  }

  private var breadcrumbs: some View {
    HStack(spacing: 4) {
      Button("Folders") { path = [] }
        .buttonStyle(.plain)
        .foregroundStyle(path.isEmpty ? .primary : .secondary)
      ForEach(Array(path.enumerated()), id: \.offset) { index, node in
        Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(.tertiary)
        Button(node.name) { path = Array(path.prefix(index + 1)) }
          .buttonStyle(.plain)
          .fontWeight(index == path.count - 1 ? .semibold : .regular)
          .foregroundStyle(index == path.count - 1 ? .primary : .secondary)
          .lineLimit(1)
      }
    }
    .font(.callout)
  }

  private func columns(_ roots: [Facets.Node]) -> some View {
    /** Column i lists the children of path[i - 1]; the first lists the top folders. A leaf opens no column. */
    var all: [[Facets.Node]] = [roots]
    for node in path where !node.children.isEmpty {
      all.append(node.children)
    }
    let shown = Array(all.enumerated()).suffix(Self.visibleColumns)

    return HStack(spacing: 0) {
      ForEach(Array(shown), id: \.offset) { depth, nodes in
        ScrollView {
          LazyVStack(spacing: 1) {
            ForEach(nodes) { node in
              folderRow(node, depth: depth)
            }
          }
          .padding(4)
        }
        .frame(maxWidth: .infinity)
        if depth != shown.last?.offset { Divider() }
      }
      ForEach(0..<max(0, Self.visibleColumns - shown.count), id: \.self) { _ in
        Divider()
        Color.clear.frame(maxWidth: .infinity)
      }
    }
  }

  private func folderRow(_ node: Facets.Node, depth: Int) -> some View {
    let isOpen = path.indices.contains(depth) && path[depth].id == node.id
    return PickRow(isSelected: model.query.contains(key, node.id)) { modifiers in
      model.pick(key, node.id, modifiers: modifiers)
      path = Array(path.prefix(depth)) + [node]
    } content: {
      Checkbox(isOn: model.query.contains(key, node.id))
      Image(systemName: "folder.fill").foregroundStyle(.secondary)
      Text(node.name).lineLimit(1).truncationMode(.middle)
      Spacer(minLength: 4)
      Text(node.count.formatted()).monospacedDigit().foregroundStyle(.secondary)
      Image(systemName: "chevron.right")
        .font(.system(size: 9, weight: .semibold))
        .foregroundStyle(.tertiary)
        .opacity(node.children.isEmpty ? 0 : 1)
    }
    .background(isOpen ? Color.primary.opacity(0.06) : .clear, in: RoundedRectangle(cornerRadius: 7))
    .help(node.id)
  }

  private func results(_ roots: [Facets.Node]) -> some View {
    func flatten(_ nodes: [Facets.Node]) -> [Facets.Node] {
      nodes.flatMap { [$0] + flatten($0.children) }
    }
    let matches = flatten(roots).filter { $0.id.localizedCaseInsensitiveContains(search) }

    return ScrollView {
      LazyVStack(spacing: 1) {
        ForEach(matches) { node in
          PickRow(isSelected: model.query.contains(key, node.id)) { modifiers in
            model.pick(key, node.id, modifiers: modifiers)
          } content: {
            Checkbox(isOn: model.query.contains(key, node.id))
            Image(systemName: "folder.fill").foregroundStyle(.secondary)
            Text(node.id).lineLimit(1).truncationMode(.head)
            Spacer(minLength: 4)
            Text(node.count.formatted()).monospacedDigit().foregroundStyle(.secondary)
          }
        }
        if matches.isEmpty {
          Text("No folder matches").foregroundStyle(.secondary).padding(.top, 40)
        }
      }
      .padding(6)
    }
  }

  /** Opens the columns at the selected folder, so the picker shows where the filter is. */
  private func restorePath(_ roots: [Facets.Node]) {
    /** With nothing selected, the largest folder is open, so the columns are not empty on first sight. */
    guard let selected = model.query.facets[key]?.first(where: { $0 != Query.notRecorded }) else {
      if let first = roots.first, !first.children.isEmpty { path = [first] }
      return
    }
    var chain: [Facets.Node] = []
    var level = roots
    while let next = level.first(where: { Query.value(selected, matches: $0.id) }) {
      chain.append(next)
      if next.id == selected { break }
      level = next.children
    }
    path = chain
  }
}

// MARK: - Time of day

/**
 When entries were written, as a histogram of the local hours, with a range that can wrap past
 midnight. The bars count every entry the other filters let through, in any period.
 */
struct TimePicker: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    let counts = model.hourCounts
    let range = model.query.hours
    let inRange = (0..<24).filter { range?.contains(hour: $0) ?? true }.map { counts[$0] }.reduce(0, +)

    VStack(spacing: 0) {
      VStack(spacing: 6) {
        histogram(counts, range: range)
        HourRangeSlider(range: Binding(get: { model.query.hours }, set: { model.query.hours = $0 }))
      }
      .padding(.horizontal, 16)
      .padding(.top, 16)

      HStack(spacing: 8) {
        Text("From").foregroundStyle(.secondary)
        hourMenu(range?.from ?? 0) { model.query.hours = HourRange.normalized(from: $0, to: range?.to ?? 24) }
        Text("to").foregroundStyle(.secondary)
        hourMenu(range?.to ?? 24, includesMidnightEnd: true) { model.query.hours = HourRange.normalized(from: range?.from ?? 0, to: $0) }
        Spacer()
        Text(Style.count(inRange)).foregroundStyle(.secondary)
      }
      .padding(.horizontal, 16)
      .padding(.top, 10)

      HStack(spacing: 6) {
        ForEach(HourRange.presets, id: \.name) { name, preset in
          Button(name) { model.query.hours = range == preset ? nil : preset }
            .buttonStyle(PillButtonStyle(isActive: range == preset))
        }
        Spacer()
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)

      Divider()
      PickerFooter(hint: "The bars show when entries were written, under the other filters.", canClear: range != nil) {
        model.query.hours = nil
      }
    }
    .frame(width: 440)
  }

  private func histogram(_ counts: [Int], range: HourRange?) -> some View {
    let maximum = max(counts.max() ?? 0, 1)
    return VStack(spacing: 3) {
      HStack(alignment: .bottom, spacing: 2) {
        ForEach(0..<24, id: \.self) { hour in
          RoundedRectangle(cornerRadius: 2)
            /** Without a range the whole day counts, so every bar is in it. */
            .fill(range.map { $0.contains(hour: hour) } ?? true ? Color.accentColor : Color.primary.opacity(0.12))
            .frame(height: max(2, 90 * CGFloat(counts[hour]) / CGFloat(maximum)))
            .frame(maxWidth: .infinity)
            .help("\(hour):00 – \(hour + 1):00 · \(Style.count(counts[hour]))")
        }
      }
      .frame(height: 90, alignment: .bottom)
      HStack {
        ForEach([0, 6, 12, 18, 24], id: \.self) { hour in
          Text("\(hour)")
          if hour != 24 { Spacer() }
        }
      }
      .font(.caption2)
      .foregroundStyle(.secondary)
    }
  }

  private func hourMenu(_ hour: Int, includesMidnightEnd: Bool = false, set: @escaping (Int) -> Void) -> some View {
    Menu {
      ForEach(includesMidnightEnd ? Array(1...24) : Array(0..<24), id: \.self) { value in
        Button(String(format: "%02d:00", value)) { set(value) }
      }
    } label: {
      HStack(spacing: 4) {
        Text(String(format: "%02d:00", hour)).monospacedDigit()
        Image(systemName: "chevron.down")
          .font(.system(size: 8, weight: .bold))
          .foregroundStyle(.secondary)
      }
      .chip(isActive: false)
    }
    .chipMenu()
  }

}

/** Two knobs on a 24 hour track. When the start is after the end, the range wraps past midnight. */
private struct HourRangeSlider: View {
  @Binding var range: HourRange?

  var body: some View {
    GeometryReader { geometry in
      let width = geometry.size.width
      let from = range?.from ?? 0
      let to = range?.to ?? 24
      let x: (Int) -> CGFloat = { CGFloat($0) / 24 * width }

      ZStack(alignment: .leading) {
        Capsule().fill(Color.primary.opacity(0.1)).frame(height: 4)
        if from <= to {
          Capsule().fill(Color.accentColor).frame(width: x(to) - x(from), height: 4).offset(x: x(from))
        } else {
          Capsule().fill(Color.accentColor).frame(width: x(to), height: 4)
          Capsule().fill(Color.accentColor).frame(width: width - x(from), height: 4).offset(x: x(from))
        }
        knob.offset(x: x(from) - 9).gesture(drag(width: width) { hour in update(from: hour, to: to) })
        knob.offset(x: x(to) - 9).gesture(drag(width: width) { hour in update(from: from, to: max(hour, 1)) })
      }
      .frame(height: 22)
      .coordinateSpace(name: "track")
    }
    .frame(height: 22)
  }

  private var knob: some View {
    Circle()
      .fill(.white)
      .shadow(color: .black.opacity(0.3), radius: 1.5, y: 1)
      .frame(width: 18, height: 18)
  }

  private func drag(width: CGFloat, set: @escaping (Int) -> Void) -> some Gesture {
    DragGesture(minimumDistance: 0, coordinateSpace: .named("track"))
      .onChanged { value in
        let hour = Int((value.location.x / width * 24).rounded())
        set(min(max(hour, 0), 24))
      }
  }

  private func update(from: Int, to: Int) {
    range = HourRange.normalized(from: from, to: to)
  }
}

// MARK: - Agent

/** Agents and the models they ran as, as a two level list. */
struct AgentPicker: View {
  @Environment(AppModel.self) private var model
  private let key = FieldKey.agent

  var body: some View {
    let agents = model.journal.facets.nodes(for: key)
    let missing = model.journal.facets.missing(for: key)

    VStack(spacing: 0) {
      ScrollView {
        LazyVStack(spacing: 1) {
          ForEach(agents) { agent in
            let name = String(agent.id.split(separator: "/").first ?? Substring(agent.id))
            PickRow(isSelected: model.query.contains(key, name)) { modifiers in
              model.pick(key, name, modifiers: modifiers)
            } content: {
              AgentBadge(agent: name)
              VStack(alignment: .leading, spacing: 1) {
                Text(AgentBadge.displayName(name))
                Text(name).font(.caption).foregroundStyle(.secondary)
              }
              Spacer()
              CountColumn(count: agent.count)
            }
            ForEach(models(of: agent, agent: name)) { node in
              PickRow(isSelected: model.query.contains(key, node.id)) { modifiers in
                model.pick(key, node.id, modifiers: modifiers)
              } content: {
                Checkbox(isOn: model.query.contains(key, node.id))
                Text(String(node.id.dropFirst(name.count + 1)))
                Spacer()
                CountColumn(count: node.count)
              }
              .padding(.leading, 38)
            }
          }
          if missing > 0 {
            PickRow(isSelected: model.query.contains(key, Query.notRecorded)) { modifiers in
              model.pick(key, Query.notRecorded, modifiers: modifiers)
            } content: {
              Monogram(text: "?", color: .gray)
              VStack(alignment: .leading, spacing: 1) {
                Text("Not recorded")
                Text("Entries without an agent field").font(.caption).foregroundStyle(.secondary)
              }
              Spacer()
              CountColumn(count: missing)
            }
          }
        }
        .padding(6)
      }
      .frame(maxHeight: 320)
      .fixedSize(horizontal: false, vertical: true)

      Divider()
      PickerFooter(hint: "Grouped by agent, then by model.", canClear: model.query.facets[key] != nil) {
        model.query.facets[key] = nil
      }
    }
    .frame(width: 420)
  }

  /**
   The models below an agent. The facet tree folds an agent with a single model into one node, such as
   `codex/gpt-5`, and that node is then the agent's only model.
   */
  private func models(of node: Facets.Node, agent: String) -> [Facets.Node] {
    if node.id == agent { return node.children }
    return [node]
  }
}

struct AgentBadge: View {
  let agent: String

  static func displayName(_ agent: String) -> String {
    switch agent {
    case "claude": "Claude Code"
    case "codex": "Codex"
    default: agent.prefix(1).uppercased() + agent.dropFirst()
    }
  }

  var body: some View {
    switch agent {
    case "claude": Monogram(text: "✳", color: Color(red: 0.85, green: 0.47, blue: 0.34))
    case "codex": Monogram(text: "◎", color: Color(white: 0.15))
    default: Monogram(text: String(agent.prefix(1)).uppercased(), color: Style.color(for: agent))
    }
  }
}
