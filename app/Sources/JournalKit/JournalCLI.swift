import Foundation

/**
 The `agent-journal` CLI, for the things it owns.

 The app reads entries itself, because the file format is the contract and reading in process is
 orders of magnitude faster than a shell per query. Settings are different: the session hook reads
 them through the CLI, and the CLI is the only thing that knows the config file's syntax. Going
 through it keeps one owner of that format, so a setting changed here is the one every agent sees.
 */
public struct JournalCLI: Sendable {
  public struct Config: Equatable, Sendable {
    public let journalDir: URL
    /** Whether the directory comes from the config file or is the shipped default. */
    public let isDefault: Bool
    public let configFile: URL
  }

  public enum Failure: Error, LocalizedError {
    case exited(Int32, String)
    case unreadable(String)

    public var errorDescription: String? {
      switch self {
      case .exited(let status, let message): "agent-journal exited with \(status): \(message)"
      case .unreadable(let output): "agent-journal printed something unexpected: \(output)"
      }
    }
  }

  public let executable: URL
  /** Overrides for the child's environment, which tests use to point it at a scratch config. */
  public let environment: [String: String]

  public init(executable: URL, environment: [String: String] = [:]) {
    self.executable = executable
    self.environment = environment
  }

  /**
   The copy shipped inside the app, so that the app and the CLI it talks to are always the same
   version. Outside a bundle, during development, it is the checkout's own copy.
   */
  public static func bundled() -> JournalCLI? {
    if let path = ProcessInfo.processInfo.environment["AGENT_JOURNAL_CLI"] {
      return JournalCLI(executable: URL(fileURLWithPath: path))
    }
    if let resources = Bundle.main.resourceURL {
      let url = resources.appending(path: "cli/bin/agent-journal")
      if FileManager.default.isExecutableFile(atPath: url.path) { return JournalCLI(executable: url) }
    }
    let checkout = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // JournalKit
      .deletingLastPathComponent()  // Sources
      .deletingLastPathComponent()  // app
      .deletingLastPathComponent()  // repository
      .appending(path: "bin/agent-journal")
    if FileManager.default.isExecutableFile(atPath: checkout.path) { return JournalCLI(executable: checkout) }
    return nil
  }

  public func config() async throws -> Config {
    let output = try await run(["config"])
    var values: [String: String] = [:]
    for line in output.split(separator: "\n") {
      guard let equals = line.firstIndex(of: "=") else { continue }
      values[String(line[..<equals])] = String(line[line.index(after: equals)...])
    }
    guard let dir = values["journal_dir"], let file = values["config_file"] else {
      throw Failure.unreadable(output)
    }
    return Config(
      journalDir: URL(fileURLWithPath: dir, isDirectory: true),
      isDefault: values["journal_dir_from"] != "config",
      configFile: URL(fileURLWithPath: file)
    )
  }

  /** Sets the journal directory. The CLI drops the key when the value is the default, and creates the directory. */
  public func setJournalDir(_ path: String) async throws {
    _ = try await run(["config", "set", "journal_dir", path])
  }

  /** Goes back to the default directory. */
  public func resetJournalDir() async throws {
    _ = try await run(["config", "unset", "journal_dir"])
  }

  private func run(_ arguments: [String]) async throws -> String {
    let executable = executable
    let environment = ProcessInfo.processInfo.environment.merging(environment) { _, new in new }
    return try await Task.detached {
      try Self.runBlocking(executable, arguments, environment: environment)
    }.value
  }

  /** Runs the CLI to completion on the calling thread, which must not be one that others wait on. */
  private static func runBlocking(_ executable: URL, _ arguments: [String], environment: [String: String]) throws -> String {
    let process = Process()
    process.executableURL = executable
    process.arguments = arguments
    process.environment = environment
    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr
    process.standardInput = FileHandle.nullDevice

    try process.run()
    /**
     Both pipes are drained at once, before waiting. Reading one to its end first would block when the
     child fills the other one, and the child would block on it in turn.
     */
    final class Box: @unchecked Sendable { var data = Data() }
    let err = Box()
    let group = DispatchGroup()
    group.enter()
    DispatchQueue.global().async {
      err.data = stderr.fileHandleForReading.readDataToEndOfFile()
      group.leave()
    }
    let out = stdout.fileHandleForReading.readDataToEndOfFile()
    group.wait()
    process.waitUntilExit()

    guard process.terminationStatus == 0 else {
      throw Failure.exited(process.terminationStatus, String(decoding: err.data, as: UTF8.self))
    }
    return String(decoding: out, as: UTF8.self)
  }
}
