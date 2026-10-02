// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "AgentJournal",
  platforms: [
    .macOS(.v15)
  ],
  products: [
    .executable(name: "AgentJournal", targets: ["AgentJournal"])
  ],
  dependencies: [
    .package(url: "https://github.com/gonzalezreal/textual", from: "0.5.0")
  ],
  targets: [
    /**
     Everything that does not draw: reading entries, periods, filters, search and the CLI. Kept free
     of SwiftUI so that it is tested on its own, and so that a later agent or index backend plugs in
     here without touching a view.
     */
    .target(name: "JournalKit"),
    .executableTarget(
      name: "AgentJournal",
      dependencies: [
        "JournalKit",
        .product(name: "Textual", package: "textual"),
      ]
    ),
    .testTarget(
      name: "JournalKitTests",
      dependencies: ["JournalKit"]
    ),
  ]
)
