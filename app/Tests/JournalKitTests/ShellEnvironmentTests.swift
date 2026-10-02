import Foundation
import Testing

@testable import JournalKit

@Suite struct ShellEnvironmentTests {
  /** A stand-in for the user's shell: prints noise like a shell profile does, then runs the command. */
  func shell(_ dir: ScratchDirectory, _ body: String) throws -> URL {
    let url = dir.url.appending(path: "fake-shell")
    try "#!/bin/sh\n\(body)\n".write(to: url, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
    return url
  }

  @Test func `reads a variable the shell profile sets, ignoring other output`() throws {
    // Arrange
    let dir = try ScratchDirectory()
    let fake = try shell(dir, "echo 'Welcome back'\nXDG_CONFIG_HOME=/home/me/.xdg\nexport XDG_CONFIG_HOME\nshift\nsh -c \"$1\"")

    // Act
    let value = ShellEnvironment.value(of: "XDG_CONFIG_HOME", shell: fake, environment: [:])

    // Assert
    #expect(value == "/home/me/.xdg")
  }

  @Test func `has no value for a variable the shell does not set`() throws {
    // Arrange
    let dir = try ScratchDirectory()
    let fake = try shell(dir, "shift\nsh -c \"$1\"")

    // Act
    let value = ShellEnvironment.value(of: "XDG_CONFIG_HOME", shell: fake, environment: [:])

    // Assert
    #expect(value == nil)
  }

  @Test func `gives up on a shell that does not finish`() throws {
    // Arrange
    let dir = try ScratchDirectory()
    let fake = try shell(dir, "sleep 30")
    let clock = ContinuousClock()

    // Act
    var value: String?
    let elapsed = clock.measure { value = ShellEnvironment.value(of: "XDG_CONFIG_HOME", shell: fake, environment: [:], timeout: 0.5) }

    // Assert
    #expect(value == nil)
    #expect(elapsed < .seconds(5))
  }
}
