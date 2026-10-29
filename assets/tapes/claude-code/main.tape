# The main README image, for any agent: Claude changes retry() in the sample
# repository and writes a journal entry. Claude exits, and the shell finds the
# entry in ~/agent-journal as a plain markdown file. Then a new Claude session
# answers a question about an older decision from the journal.
Output out/main-raw.mp4
Source .theme.tape
# The terminal only. The window frame is added afterwards.
Set Width 1400
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
Type "Add exponential backoff to retry(), with a baseDelayMs option. Keep 3 attempts as the default."
Sleep 500ms
Enter
Wait+Screen@600s /· done /
Sleep 3s
Screenshot out/main-done.png
Sleep 2s

Type "/exit"
Sleep 500ms
Enter
Wait+Screen@20s /--resume/
Sleep 1500ms

Type "cd ~/agent-journal"
Sleep 400ms
Enter
Sleep 1s
Type "ls"
Sleep 400ms
Enter
Sleep 2s
Type "grep '^summary:' *.md"
Sleep 400ms
Enter
Sleep 4s
Type "cat $(ls | tail -1)"
Sleep 400ms
Enter
Sleep 5s
Screenshot out/main-end.png
Sleep 1s

Type "cd ~/Developer/my-awesome-lib"
Sleep 400ms
Enter
Sleep 800ms
Type "claude"
Sleep 500ms
Enter
Wait+Screen@60s /auto mode on/
Sleep 1500ms
Type "Why did we leave backoff out before?"
Sleep 500ms
Enter
# The new session starts on a clear screen, and a long answer can scroll the
# question off it, so the first "· done" is the answer.
Wait+Screen@300s /· done /
Sleep 3s
Screenshot out/main-recall.png
Sleep 5500ms
