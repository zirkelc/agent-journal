import JournalKit
import SwiftUI

/**
 The search field in the middle of the toolbar, like the command center in VS Code. The list filters
 while typing; the dropdown below the field offers earlier searches and projects, and Return applies
 the highlighted one.
 */
struct SearchField: View {
  @Environment(AppModel.self) private var model

  static let width: CGFloat = 480
  static let radius: CGFloat = 8
  /** One surface for the open field and its dropdown, so the two read as one control. */
  static let surface = Color(nsColor: .controlBackgroundColor)

  @State private var anchor = AnchorBox()

  var body: some View {
    @Bindable var model = model
    let suggestions = model.searchSuggestions

    HStack(spacing: 6) {
      Image(systemName: "magnifyingglass")
        .foregroundStyle(.secondary)
        .frame(width: 16)
      SearchTextField(
        text: $model.query.text,
        placeholder: "Search entries, or type project:name",
        /** Read here, in the body, so that a request to focus re-renders the field and reaches it. */
        wantsFocus: model.wantsSearchFocus,
        onFocusTaken: { model.wantsSearchFocus = false },
        onFocusChange: { focused in
          model.isSearchFocused = focused
          model.isSearchOpen = focused
          if !focused { model.searchHighlight = nil }
        },
        /**
         Only typing opens the dropdown. Picking a suggestion also changes the text, and reacting to
         every change would open the dropdown again right after the pick closed it.
         */
        onEdit: {
          model.isSearchOpen = true
          model.searchHighlight = model.query.text.trimmingCharacters(in: .whitespaces).isEmpty ? nil : 0
        },
        onCommand: { command in handle(command, suggestions: suggestions) },
        dropdown: model.isSearchOpen ? AnyView(SearchDropdown().environment(model)) : nil,
        anchor: anchor,
        isFocused: model.isSearchFocused
      )

      if !model.query.text.isEmpty {
        Button { model.query.text = "" } label: {
          Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
        .help("Clear the search")
      } else {
        Text("⌘F")
          .font(.caption)
          .foregroundStyle(.tertiary)
      }
    }
    .padding(.horizontal, 10)
    .frame(width: Self.width, height: 28)
    /**
     Open, the field drops its bottom corners and takes the dropdown's surface, and the dropdown below
     drops its top corners, so the two form one block.
     */
    .background(model.isSearchOpen ? Self.surface : Color.primary.opacity(0.07), in: shape)
    .overlay {
      let color = model.isSearchFocused ? Color.accentColor.opacity(0.8) : Color.primary.opacity(0.12)
      let width: CGFloat = model.isSearchFocused ? 1.5 : 1
      if model.isSearchOpen {
        OpenBorder(openEdge: .bottom, radius: Self.radius, lineWidth: width).stroke(color, lineWidth: width)
      } else {
        shape.strokeBorder(color, lineWidth: width)
      }
    }
    .background(FrameAnchor(box: anchor))
  }

  private var shape: UnevenRoundedRectangle {
    let bottom = model.isSearchOpen ? 0 : Self.radius
    return UnevenRoundedRectangle(topLeadingRadius: Self.radius, bottomLeadingRadius: bottom, bottomTrailingRadius: bottom, topTrailingRadius: Self.radius)
  }

  private func handle(_ command: SearchTextField.Command, suggestions: [SearchSuggestion]) -> Bool {
    switch command {
    case .down:
      guard !suggestions.isEmpty else { return false }
      model.isSearchOpen = true
      model.searchHighlight = min((model.searchHighlight ?? -1) + 1, suggestions.count - 1)
      return true
    case .up:
      guard let index = model.searchHighlight else { return false }
      model.searchHighlight = index > 0 ? index - 1 : nil
      return true
    case .submit:
      if let index = model.searchHighlight, suggestions.indices.contains(index) {
        model.applySuggestion(suggestions[index])
      } else if !model.query.text.trimmingCharacters(in: .whitespaces).isEmpty {
        model.applySuggestion(.search(model.query.text))
      }
      return true
    case .cancel:
      /** Escape leaves the search altogether, as it does in VS Code. The text and its filtering stay. */
      model.isSearchOpen = false
      NSApp.keyWindow?.makeFirstResponder(nil)
      return true
    }
  }
}

/** The suggestions under the search field, shown in a window of their own attached below it. */
struct SearchDropdown: View {
  @Environment(AppModel.self) private var model
  @AppStorage(Preference.showAvatars) private var showAvatars = true

  var body: some View {
    let suggestions = model.searchSuggestions

    VStack(alignment: .leading, spacing: 0) {
      if suggestions.isEmpty {
        Text("Type to search summaries and bodies. Use project:name to filter.")
          .font(.callout)
          .foregroundStyle(.secondary)
          .padding(12)
      } else {
        ForEach(Array(suggestions.enumerated()), id: \.element) { index, suggestion in
          if let title = sectionTitle(at: index, in: suggestions) {
            HStack {
              Text(title)
              Spacer()
              if title == "Recent searches" {
                Button("Clear") { model.clearRecentSearches() }
                  .buttonStyle(PillButtonStyle(compact: true))
              }
            }
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.secondary)
            /** The title lines up with the rows' content, and Clear with the rows' right edge. */
            .padding(.leading, 10)
            .padding(.top, index == 0 ? 6 : 10)
            .padding(.bottom, 4)
          }
          row(suggestion, isHighlighted: model.searchHighlight == index)
            .onHover { if $0 { model.searchHighlight = index } }
        }
      }
    }
    .padding(6)
    .frame(width: SearchField.width, alignment: .leading)
    .background(SearchField.surface, in: dropdownShape)
    .overlay(OpenBorder(openEdge: .top, radius: SearchField.radius, lineWidth: 1.5).stroke(Color.accentColor.opacity(0.8), lineWidth: 1.5))
    .clipShape(dropdownShape)
    .shadow(color: .black.opacity(0.35), radius: 14, y: 8)
    .padding([.horizontal, .bottom], DropdownWindow.shadowMargin)
    .onAppear { model.loadRemotes() }
  }

  private var dropdownShape: UnevenRoundedRectangle {
    UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: SearchField.radius, bottomTrailingRadius: SearchField.radius, topTrailingRadius: 0)
  }

  /** A heading before the first suggestion of each kind. The search itself needs none. */
  private func sectionTitle(at index: Int, in suggestions: [SearchSuggestion]) -> String? {
    func kind(_ suggestion: SearchSuggestion) -> Int {
      switch suggestion {
      case .search: 0
      case .recent: 1
      case .project: 2
      }
    }
    let current = kind(suggestions[index])
    guard index == 0 || kind(suggestions[index - 1]) != current else { return nil }
    switch current {
    case 1: return "Recent searches"
    case 2: return "Projects"
    default: return nil
    }
  }

  private func row(_ suggestion: SearchSuggestion, isHighlighted: Bool) -> some View {
    Button { model.applySuggestion(suggestion) } label: {
      HStack(spacing: 10) {
        switch suggestion {
        case .search(let text):
          Image(systemName: "magnifyingglass").frame(width: 22).foregroundStyle(.secondary)
          Text("Search for ") + Text(text).fontWeight(.semibold)
          Spacer()
          Text("↩").foregroundStyle(.secondary)
        case .recent(let text):
          Image(systemName: "clock.arrow.circlepath").frame(width: 22).foregroundStyle(.secondary)
          Text(text).lineLimit(1)
          Spacer()
        case .project(let project):
          ProjectAvatar(project: project, remote: showAvatars ? model.remotes[project].flatMap { $0 } : nil, size: 22)
          Text(project)
          if let remote = model.remotes[project].flatMap({ $0 }) {
            Text(remote.display).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
          Spacer()
          if let count = model.projectStats[project]?.count {
            Text(count.formatted()).font(.caption).monospacedDigit().foregroundStyle(.secondary)
          }
        }
      }
      .font(.callout)
      .padding(.horizontal, 8)
      .frame(height: 30)
      .background(isHighlighted ? Color.accentColor.opacity(0.25) : .clear, in: RoundedRectangle(cornerRadius: 6))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

/**
 A rounded border with one straight edge left out, so a field and the dropdown under it share one
 outline without a line between them. Drawn inside the rect by half the line width, like a stroked
 border, so it lines up with the fill.
 */
struct OpenBorder: Shape {
  enum Edge {
    case top, bottom
  }

  let openEdge: Edge
  let radius: CGFloat
  let lineWidth: CGFloat

  func path(in rect: CGRect) -> Path {
    let rect = rect.insetBy(dx: lineWidth / 2, dy: 0)
    let r = max(radius - lineWidth / 2, 0)
    var path = Path()
    switch openEdge {
    case .top:
      let bottom = rect.maxY - lineWidth / 2
      path.move(to: CGPoint(x: rect.minX, y: rect.minY))
      path.addLine(to: CGPoint(x: rect.minX, y: bottom - r))
      path.addArc(center: CGPoint(x: rect.minX + r, y: bottom - r), radius: r, startAngle: .degrees(180), endAngle: .degrees(90), clockwise: true)
      path.addLine(to: CGPoint(x: rect.maxX - r, y: bottom))
      path.addArc(center: CGPoint(x: rect.maxX - r, y: bottom - r), radius: r, startAngle: .degrees(90), endAngle: .degrees(0), clockwise: true)
      path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
    case .bottom:
      let top = rect.minY + lineWidth / 2
      path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
      path.addLine(to: CGPoint(x: rect.minX, y: top + r))
      path.addArc(center: CGPoint(x: rect.minX + r, y: top + r), radius: r, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
      path.addLine(to: CGPoint(x: rect.maxX - r, y: top))
      path.addArc(center: CGPoint(x: rect.maxX - r, y: top + r), radius: r, startAngle: .degrees(270), endAngle: .degrees(0), clockwise: false)
      path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
    }
    return path
  }
}
