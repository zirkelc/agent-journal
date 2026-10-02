import Foundation

@testable import JournalKit

/** A calendar pinned to one zone and week rule, so tests do not depend on the machine they run on. */
func fixedCalendar(timeZone: String = "Europe/Berlin", firstWeekday: Int = 2) -> Calendar {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: timeZone)!
  calendar.firstWeekday = firstWeekday
  calendar.minimumDaysInFirstWeek = 4
  return calendar
}

func date(_ iso: String) -> Date {
  try! Date(iso, strategy: .iso8601)
}

/** The text of an entry file, in the format the instructions ask agents to write. */
func entryText(
  date: String,
  project: String? = "nebula",
  summary: String = "Did a thing",
  cwd: String = "~/Developer/nebula",
  agent: String? = "claude/opus-5",
  body: String = "Body text."
) -> String {
  var lines = ["---", "date: \(date)"]
  if let project { lines.append("project: \(project)") }
  lines.append("summary: \"\(summary)\"")
  lines.append("cwd: \(cwd)")
  if let agent { lines.append("agent: \(agent)") }
  lines.append(contentsOf: ["---", "", body, ""])
  return lines.joined(separator: "\n")
}

/** Parses an entry from its text, named after its `date` field the way the format names files. */
func entry(
  date: String,
  project: String? = "nebula",
  summary: String = "Did a thing",
  cwd: String = "~/Developer/nebula",
  agent: String? = "claude/opus-5",
  body: String = "Body text."
) -> Entry {
  let stem = date.replacingOccurrences(of: ":", with: "")
  let text = entryText(date: date, project: project, summary: summary, cwd: cwd, agent: agent, body: body)
  return EntryParser.parse(url: URL(fileURLWithPath: "/journal/\(stem).md"), text: text)!
}

/** A fresh directory under the temporary directory, removed when the test is done with it. */
final class ScratchDirectory {
  let url: URL

  init() throws {
    url = FileManager.default.temporaryDirectory.appending(path: "journalkit-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  }

  func write(_ name: String, _ text: String) throws {
    try text.write(to: url.appending(path: name), atomically: true, encoding: .utf8)
  }

  deinit {
    try? FileManager.default.removeItem(at: url)
  }
}
