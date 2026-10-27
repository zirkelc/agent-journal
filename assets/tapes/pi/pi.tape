# The Pi image of the README: the same take as ../claude-code/claude-code.tape, in Pi and
# without the pane. Pi changes retry() and writes a journal entry with its
# journal_write tool. Then Pi quits, a new session starts, and Pi answers a
# question about an older decision from the journal.
Output out/pi-raw.mp4
Source .theme.tape
# The terminal only. The window frame is added afterwards.
Set Width 1400
Set Height 1000

# `pi` in the shell starts Pi the same way as the first time: with the demo
# home and the extension from this checkout.
Hide
Type `clear && ./reset.sh && export HOME=$(cd /tmp/agent-journal-demo && pwd -P) && L=$PWD/launch.sh && pi() { "$L" "$@"; } && pi`
Enter
Wait+Screen@60s /claude-opus-5-5/
Sleep 2s
Show

Sleep 1s
Type "Add exponential backoff to retry(), with a baseDelayMs option. Keep 3 attempts as the default."
Sleep 500ms
Enter
# During a turn, the line above the prompt shows "Working". When the turn is
# done, it is a plain line again, as is the line below the prompt.
Sleep 3s
Wait+Screen@600s /Wrote the journal entry[\s\S]*\n\s*─{50}[^\n]*\n[^\n]*\n\s*─{50}/
Sleep 3s
Screenshot out/pi-done.png
Sleep 2s

Type "/quit"
Sleep 500ms
Enter
# vhs does not read the shell screen after Pi leaves its full-screen view,
# so a fixed wait. Pi quits in under a second.
Sleep 3500ms
Type "pi"
Sleep 500ms
Enter
Wait+Screen@60s /claude-opus-5-5/
Sleep 1500ms
Type "Why did we leave backoff out before?"
Sleep 500ms
Enter
# The question can scroll off the screen, so only the two plain lines.
Sleep 5s
Wait+Screen@300s /\n\s*─{50}[^\n]*\n[^\n]*\n\s*─{50}/
Sleep 3s
Screenshot out/pi-recall.png
Sleep 6s
