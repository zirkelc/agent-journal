import CoreServices
import Foundation

/**
 Calls back when anything in a directory changes, through FSEvents.

 The events are coalesced over a short latency, so an agent writing a file in several steps produces
 one callback. The callback says only that something changed, because the store rescans the directory
 instead of trusting individual paths. FSEvents matches by path, so a directory that does not exist yet
 is still watched and reports once it is created.
 */
final class DirectoryWatcher: @unchecked Sendable {
  /**
   What the stream calls into. The stream retains it and releases it on invalidation, so a callback
   already in flight when the watcher goes away still finds it alive.
   */
  private final class Box {
    let onChange: @Sendable () -> Void
    init(_ onChange: @escaping @Sendable () -> Void) { self.onChange = onChange }
  }

  private let stream: FSEventStreamRef
  private let queue = DispatchQueue(label: "agent-journal.watcher")

  init?(url: URL, latency: TimeInterval = 0.25, onChange: @escaping @Sendable () -> Void) {
    var context = FSEventStreamContext(
      version: 0,
      info: Unmanaged.passRetained(Box(onChange)).toOpaque(),
      retain: nil,
      release: { info in
        guard let info else { return }
        Unmanaged<Box>.fromOpaque(info).release()
      },
      copyDescription: nil
    )

    let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
      guard let info else { return }
      Unmanaged<Box>.fromOpaque(info).takeUnretainedValue().onChange()
    }

    let flags = UInt32(kFSEventStreamCreateFlagNoDefer | kFSEventStreamCreateFlagWatchRoot)
    guard
      let stream = FSEventStreamCreate(
        kCFAllocatorDefault, callback, &context, [url.path] as CFArray,
        FSEventStreamEventId(kFSEventStreamEventIdSinceNow), latency, flags)
    else {
      Unmanaged<Box>.fromOpaque(context.info!).release()
      return nil
    }

    self.stream = stream
    FSEventStreamSetDispatchQueue(stream, queue)
    FSEventStreamStart(stream)
  }

  deinit {
    FSEventStreamStop(stream)
    FSEventStreamInvalidate(stream)
    FSEventStreamRelease(stream)
  }
}
