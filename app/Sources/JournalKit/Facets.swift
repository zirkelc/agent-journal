import Foundation

/**
 The values each frontmatter key takes across the journal, with counts, as a tree split at `/`. A
 project is a flat list, an agent is `claude` with `opus-5` below it, and a directory is a folder tree.
 */
public struct Facets: Sendable {
  public struct Node: Identifiable, Hashable, Sendable {
    /** The full value up to this node, which is also what a filter on this node stores. */
    public let id: String
    /** The last component, for display. */
    public let name: String
    /** Entries at this node or anywhere below it. */
    public let count: Int
    public let children: [Node]
  }

  /** Keys every entry has a unique or near-unique value for, which makes them useless as a list to pick from. */
  public static let excluded: Set<String> = [FieldKey.date, FieldKey.summary]

  /** The keys the journal format defines come first, in this order. Any others follow by name. */
  private static let order = [FieldKey.project, FieldKey.agent, FieldKey.cwd, FieldKey.sessionID]

  public let keys: [String]
  private let trees: [String: [Node]]
  private let present: [String: Int]
  private let total: Int

  public init() {
    keys = []
    trees = [:]
    present = [:]
    total = 0
  }

  public init(entries: some Sequence<Entry>) {
    var counts: [String: [String: Int]] = [:]
    var present: [String: Int] = [:]
    var total = 0
    for entry in entries {
      total += 1
      /** Once per key, so a key written twice in one entry still counts that entry once. */
      var seen: Set<String> = []
      for field in entry.fields where !Self.excluded.contains(field.key) && !field.value.isEmpty {
        counts[field.key, default: [:]][field.value, default: 0] += 1
        if seen.insert(field.key).inserted { present[field.key, default: 0] += 1 }
      }
    }
    self.present = present
    self.total = total

    keys = counts.keys.sorted { a, b in
      let ia = Self.order.firstIndex(of: a) ?? Int.max
      let ib = Self.order.firstIndex(of: b) ?? Int.max
      return ia != ib ? ia < ib : a < b
    }
    trees = counts.mapValues(Self.tree)
  }

  /** Entries that do not record the key, which a filter selects with ``Query/notRecorded``. */
  public func missing(for key: String) -> Int {
    total - (present[key] ?? 0)
  }

  /** The top level of the tree for a key, largest first. */
  public func nodes(for key: String) -> [Node] {
    trees[key] ?? []
  }

  private static func tree(_ counts: [String: Int]) -> [Node] {
    final class Builder {
      var count = 0
      var children: [String: Builder] = [:]
    }

    let root = Builder()
    for (value, count) in counts {
      /** An absolute path keeps its leading `/` on the first component, so `/tmp` is not a node named `tmp` at the top. */
      var parts = value.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
      if value.hasPrefix("/"), !parts.isEmpty { parts[0] = "/" + parts[0] }
      if parts.isEmpty { parts = [value] }

      var node = root
      for part in parts {
        let child = node.children[part] ?? Builder()
        node.children[part] = child
        child.count += count
        node = child
      }
    }

    /**
     A chain of single children is folded into one node, so `~/Developer/oss/my-lib` with nothing else
     beside it reads as one row rather than four nested ones.
     */
    func build(_ builder: Builder, prefix: String) -> [Node] {
      builder.children.map { name, child in
        var name = name
        var child = child
        var id = prefix.isEmpty ? name : prefix + "/" + name
        while child.children.count == 1, let (next, grandchild) = child.children.first, grandchild.count == child.count {
          name += "/" + next
          id += "/" + next
          child = grandchild
        }
        return Node(id: id, name: name, count: child.count, children: build(child, prefix: id))
      }
      .sorted { $0.count != $1.count ? $0.count > $1.count : $0.name < $1.name }
    }

    return build(root, prefix: "")
  }
}
