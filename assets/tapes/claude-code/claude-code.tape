# The Claude Code README image: Claude changes retry() with the journal pane
# open. The new entry shows at the top of the pane and is opened there. Then
# Claude exits, a new session opens the pane again, and answers a question
# about an older decision from the journal. A new session and not /clear,
# because after /clear the pane lists no entries until it is opened again.
Output out/claude-code-raw.mp4
Source .theme.tape
# The terminal only. The window frame is added afterwards.
Set Width 1600
Set Height 1000

# `claude` in the shell starts Claude Code the same way as the first time:
# with the demo home and the plugin from this checkout.
Hide
Type `clear && ./reset.sh && export HOME=$(cd /tmp/agent-journal-demo && pwd -P) && L=$PWD/launch.sh && claude() { "$L" "$@"; } && claude`
Enter
Wait+Screen@60s /auto mode on/
Sleep 2s
Show

Sleep 1s
Type "/agent-journal"
Sleep 500ms
Enter
Wait+Screen@20s /Date/
Sleep 1500ms

Type "Add exponential backoff to retry(), with a baseDelayMs option. Keep 3 attempts as the default."
Sleep 500ms
Enter
Wait+Screen@600s /· done /
Sleep 3s
Screenshot out/claude-code-pane.png

# After the turn, the prompt has the focus. Ctrl+X Tab moves it into the pane.
# Tab order there: Close, All, Current, Date All, Year, Month, Day, then the
# rows, newest first.
Ctrl+X
Tab
Sleep 500ms
Tab@300ms 8
Sleep 400ms
Enter
Wait+Screen@10s /Send to prompt/
Sleep 3s
Screenshot out/claude-code-pane-entry.png

# Esc goes back to the list, and a second Esc closes the pane. /exit then
# ends the session.
Escape
Sleep 800ms
Escape
Sleep 1s

Type "/exit"
Sleep 500ms
Enter
Wait+Screen@20s /--resume/
Sleep 1500ms
Type "claude"
Sleep 500ms
Enter
Wait+Screen@60s /auto mode on/
Sleep 1s
Type "/agent-journal"
Sleep 500ms
Enter
Wait+Screen@20s /Date/
Sleep 1500ms
Type "Why did we leave backoff out before?"
Sleep 500ms
Enter
Wait+Screen@300s /Why did we leave backoff out before\?[\s\S]*· done /
Sleep 3s
Screenshot out/claude-code-recall.png
Sleep 6s
