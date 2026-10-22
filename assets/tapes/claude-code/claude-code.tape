# The Claude Code README image: as main.tape, with the journal pane open. The
# new entry shows at the top of the pane, and is opened there before Claude exits.
Output out/claude-code-raw.mp4
Source .theme.tape
# The terminal only. The window frame is added afterwards.
Set Width 1600
Set Height 1000

Hide
Type "clear && ./reset.sh && export HOME=$(cd /tmp/agent-journal-demo && pwd -P) && ./launch.sh"
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

# Esc goes back to the list, and a second Esc closes the pane.
Escape
Sleep 800ms
Escape
Sleep 1s

Source shell.tape
Screenshot out/claude-code-end.png
Sleep 1s
