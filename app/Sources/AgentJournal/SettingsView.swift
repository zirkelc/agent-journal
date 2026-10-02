import AppKit
import JournalKit
import SwiftUI

/**
 The settings agents also read live in the CLI's config file, so this view changes them through the
 CLI rather than storing its own copy. The app and every agent session then agree on the directory.
 */
struct SettingsView: View {
  @Environment(AppModel.self) private var model
  @AppStorage(Preference.showAvatars) private var showAvatars = true
  @AppStorage(Preference.removalMode) private var removalMode = EntryRemoval.Mode.trash

  var body: some View {
    Form {
      Section {
        LabeledContent("Journal directory") {
          VStack(alignment: .trailing, spacing: 6) {
            Text(model.config?.journalDir.path ?? model.journal.directory?.path ?? "Unknown")
              .font(.system(.body, design: .monospaced))
              .textSelection(.enabled)
              .lineLimit(1)
              .truncationMode(.middle)
            HStack {
              if model.config?.isDefault == false {
                Button("Use Default") { Task { await model.resetJournalDir() } }
              }
              Button("Reveal") {
                if let url = model.journal.directory { NSWorkspace.shared.activateFileViewerSelecting([url]) }
              }
              .disabled(model.journal.state == .missing)
              Button("Choose…") { choose() }
            }
          }
        }
      } footer: {
        VStack(alignment: .leading, spacing: 4) {
          if let config = model.config {
            Text(config.isDefault ? "The default. Agents write here unless you choose another directory." : "Set in \(config.configFile.path). Agents write here too.")
          }
          if let error = model.configError {
            Text(error).foregroundStyle(.red)
          }
          if let error = model.savedFiltersError {
            Text("Saved filters: \(error)").foregroundStyle(.red)
          }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
      }
      Section {
        Picker("Removing an entry", selection: $removalMode) {
          Text("Moves it to the Trash").tag(EntryRemoval.Mode.trash)
          Text("Deletes it permanently").tag(EntryRemoval.Mode.permanent)
        }
      } footer: {
        Text(removalMode == .permanent
          ? "Deleted entries cannot be recovered, and the app always asks first."
          : "Undo puts an entry back, and so does Put Back in the Trash.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      Section {
        Toggle("Show project avatars", isOn: $showAvatars)
      } footer: {
        Text("Loads the avatar of each project's GitHub owner from github.com. This is the only network request the app makes, and it sends nothing from your journal.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .frame(width: 560)
    .fixedSize(horizontal: false, vertical: true)
  }

  private func choose() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.canCreateDirectories = true
    panel.prompt = "Use This Directory"
    panel.message = "Choose where agents write journal entries."
    panel.directoryURL = model.journal.directory
    guard panel.runModal() == .OK, let url = panel.url else { return }
    Task { await model.setJournalDir(url) }
  }
}
