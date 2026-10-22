# The main README image, for any agent: Claude changes retry() in the sample
# repository and writes a journal entry. Then Claude exits, and the shell finds
# the entry in ~/agent-journal as a plain markdown file.
Output out/main-raw.mp4
Source .theme.tape
# The terminal only. The window frame is added afterwards.
Set Width 1400
Set Height 1000

Hide
Type "clear && ./reset.sh && export HOME=$(cd /tmp/agent-journal-demo && pwd -P) && ./launch.sh"
Enter
Wait+Screen@60s /auto mode on/
Sleep 2s
Show

Sleep 1s
Type "Add exponential backoff to retry(), with a baseDelayMs option. Keep 3 attempts as the default."
Sleep 500ms
Enter
Wait+Screen@600s /· done /
Sleep 3s
Screenshot out/main-done.png

Source shell.tape
Screenshot out/main-end.png
Sleep 1s
