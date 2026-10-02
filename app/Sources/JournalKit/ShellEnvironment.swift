import Foundation

/**
 Variables from the user's shell. An app started from Finder or the Dock does not inherit the shell's
 environment, while agents started from a terminal do, so a variable that moves the config file
 has to be read from the shell for the app to find the config the agents use.
 */
public enum ShellEnvironment {
  /** Between these the value is printed, so whatever a shell profile prints around it is ignored. */
  private static let marker = "__AGENT_JOURNAL__"

  /**
   The value of a variable in an interactive login shell, or nil when it is unset, empty, or the
   shell does not answer in time. Interactive, because many people set variables in `.zshrc`.
   */
  public static func value(
    of name: String,
    shell: URL = defaultShell,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    timeout: TimeInterval = 5
  ) -> String? {
    let process = Process()
    process.executableURL = shell
    process.arguments = ["-ilc", "printf '%s%s%s' '\(marker)' \"$\(name)\" '\(marker)'"]
    process.environment = environment
    let output = Pipe()
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    process.standardInput = FileHandle.nullDevice

    do { try process.run() } catch { return nil }
    DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
      if process.isRunning { process.terminate() }
    }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()

    let text = String(decoding: data, as: UTF8.self)
    let parts = text.components(separatedBy: marker)
    guard parts.count >= 3, !parts[1].isEmpty else { return nil }
    return parts[1]
  }

  public static var defaultShell: URL {
    URL(fileURLWithPath: ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh")
  }
}
