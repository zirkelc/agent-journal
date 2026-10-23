# The README image of the Recall section: one model turn in the sample
# repository. The question is about a bug in another project, so only the
# journal can answer it. Claude searches the journal and answers from the entry.
Output out/recall-raw.mp4
Source .theme.tape
# The terminal only. The window frame is added afterwards.
Set Width 1400
Set Height 900

Hide
Type "clear && ./reset.sh && export HOME=$(cd /tmp/agent-journal-demo && pwd -P) && ./launch.sh"
Enter
Wait+Screen@60s /auto mode on/
Sleep 2s
Show

Sleep 1s
Type "What was that CSV export bug again?"
Sleep 600ms
Enter
Wait+Screen@300s /· done /
Sleep 6s
Screenshot out/recall-done.png
Sleep 500ms
