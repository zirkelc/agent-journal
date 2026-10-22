# The end of both takes: Claude exits, and the shell shows the new entry.
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
Sleep 6s
