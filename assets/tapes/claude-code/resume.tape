# The shell only, with no model turn: find an entry by a keyword, read it, and
# resume the session it came from with the session_id in its frontmatter.
Output out/resume-raw.mp4
Source .theme.tape
# The terminal only. The window frame is added afterwards.
Set Width 1400
Set Height 720

Hide
Type "./reset.sh && exec env -i HOME=$(cd /tmp/agent-journal-demo && pwd -P) USER=$USER LOGNAME=$LOGNAME PATH=$PATH TERM=$TERM TMPDIR=$TMPDIR LANG=en_US.UTF-8 SHELL=/bin/zsh DISABLE_AUTOUPDATER=1 zsh -f"
Enter
Sleep 3s
Type "PROMPT='%F{blue}>%f ' && cd ~ && clear"
Enter
Sleep 500ms
Show

Sleep 800ms
Type "cd ~/agent-journal"
Sleep 400ms
Enter
Sleep 800ms
Type "ls"
Sleep 400ms
Enter
Sleep 1500ms
Type "grep -il redis *.md"
Sleep 400ms
Enter
Sleep 1500ms
Type "cat 2026-10-09T111500Z.md"
Sleep 400ms
Enter
Sleep 4s
Screenshot out/resume-entry.png
Type "cd ~/Developer/api-gateway"
Sleep 400ms
Enter
Sleep 800ms
Type "claude --resume 387453c4-8de8-42d6-ad76-f69414dc597f"
Sleep 600ms
Enter
Wait+Screen@30s /4 percent CPU/
Sleep 5s
Screenshot out/resume-session.png
Sleep 500ms
