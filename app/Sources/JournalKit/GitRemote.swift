import Foundation

/**
 Where a project lives online, read from its local git config.

 The config is read as a file rather than through `git`, because on a Mac without the developer tools
 `/usr/bin/git` is a stub that opens an install dialog, and because this runs for every project in the
 picker. Only `origin` is read: it is the remote a person cloned from, which is what they mean by
 where a project lives.
 */
public struct GitRemote: Hashable, Sendable {
  public let host: String
  /** The owner, or for hosts with nested groups the whole group path. */
  public let owner: String
  public let repo: String

  /** The repository's page. Built from the parts, so credentials in the configured URL never reach it. */
  public var webURL: URL {
    URL(string: "https://\(host)/\(owner)/\(repo)")!
  }

  /** `github.com/owner/repo`, for display. */
  public var display: String {
    "\(host)/\(owner)/\(repo)"
  }

  /** The owner's avatar. Only GitHub serves one at a predictable address without an API call. */
  public var avatarURL: URL? {
    guard host == "github.com", !owner.contains("/") else { return nil }
    return URL(string: "https://github.com/\(owner).png?size=96")
  }

  /**
   Parses the forms git accepts for a network remote: `git@host:owner/repo.git`, `ssh://git@host/owner/repo`
   and `https://host/owner/repo.git`. A local path is not a place online, so it is nil.
   */
  public static func parse(_ url: String) -> GitRemote? {
    let url = url.trimmingCharacters(in: .whitespacesAndNewlines)
    var host: String
    var path: String

    if let components = URLComponents(string: url), let scheme = components.scheme, ["https", "http", "ssh", "git"].contains(scheme), let h = components.host {
      host = h
      path = components.path
    } else if let at = url.firstIndex(of: "@"), let colon = url[at...].firstIndex(of: ":") {
      host = String(url[url.index(after: at)..<colon])
      path = String(url[url.index(after: colon)...])
    } else {
      return nil
    }

    host = host.lowercased()
    path = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    if path.hasSuffix(".git") { path.removeLast(4) }

    let parts = path.split(separator: "/").map(String.init)
    guard parts.count >= 2, !host.isEmpty else { return nil }
    return GitRemote(host: host, owner: parts.dropLast().joined(separator: "/"), repo: parts.last!)
  }

  /** The `origin` remote of the repository that contains a directory, or nil when there is none. */
  public static func origin(of directory: URL) -> GitRemote? {
    guard let config = configFile(for: directory), let text = try? String(contentsOf: config, encoding: .utf8) else {
      return nil
    }
    return originURL(inConfig: text).flatMap(parse)
  }

  /**
   The config of the repository around a directory. A worktree's `.git` is a file that points to its
   own git directory, whose `commondir` points to the main one, and the config lives in the main one.
   */
  static func configFile(for directory: URL) -> URL? {
    let fileManager = FileManager.default
    var current = directory.standardizedFileURL

    while true {
      let dotGit = current.appending(path: ".git")
      var isDirectory: ObjCBool = false
      if fileManager.fileExists(atPath: dotGit.path, isDirectory: &isDirectory) {
        if isDirectory.boolValue { return dotGit.appending(path: "config") }

        guard let pointer = try? String(contentsOf: dotGit, encoding: .utf8),
          let line = pointer.split(whereSeparator: \.isNewline).first(where: { $0.hasPrefix("gitdir:") })
        else { return nil }
        let path = line.dropFirst("gitdir:".count).trimmingCharacters(in: .whitespaces)
        let gitDir = path.hasPrefix("/") ? URL(fileURLWithPath: path) : current.appending(path: path)

        if let common = try? String(contentsOf: gitDir.appending(path: "commondir"), encoding: .utf8) {
          let commonPath = common.trimmingCharacters(in: .whitespacesAndNewlines)
          let commonDir = commonPath.hasPrefix("/") ? URL(fileURLWithPath: commonPath) : gitDir.appending(path: commonPath)
          return commonDir.standardizedFileURL.appending(path: "config")
        }
        return gitDir.appending(path: "config")
      }

      /** Stops at the root by path, because the parent of `/` as a URL is `/..` rather than `/` itself. */
      if current.path == "/" { return nil }
      current = current.deletingLastPathComponent().standardizedFileURL
    }
  }

  /** The `url` of `[remote "origin"]` in a git config. */
  static func originURL(inConfig text: String) -> String? {
    var inOrigin = false
    for raw in text.split(whereSeparator: \.isNewline) {
      let line = raw.trimmingCharacters(in: .whitespaces)
      if line.hasPrefix("[") {
        inOrigin = line.replacingOccurrences(of: " ", with: "") == "[remote\"origin\"]"
        continue
      }
      guard inOrigin, let equals = line.firstIndex(of: "=") else { continue }
      if line[..<equals].trimmingCharacters(in: .whitespaces) == "url" {
        return line[line.index(after: equals)...].trimmingCharacters(in: .whitespaces)
      }
    }
    return nil
  }
}
