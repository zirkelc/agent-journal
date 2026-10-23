# Claude Code recordings

The tapes in this folder record the images at the top of the [README](../../../README.md) and of the [Claude Code README](../../../claude-code/README.md) with [vhs](https://github.com/charmbracelet/vhs). Each one is a live take. In the first two, Claude Code changes `retry()` in a sample repository and writes a journal entry, and then a new Claude session answers a question about an older decision from the journal. Between the two sessions, the main take shows the entry in `~/agent-journal` with `ls`, `grep` and `cat`, and the Claude Code take shows it in the journal pane. The third take records the image of the Recall section, where Claude answers a question from the journal.

## Record

```sh
./record.sh               # both README sets: Graphite Dark and Graphite Light
./record.sh <name>        # one theme: settings/<name>.tape
```

It needs `vhs`, `ttyd`, `ffmpeg`, `git` and Claude Code with a login. It takes about 6 minutes and four model turns for each theme (two of about 30 seconds, two of about 10 to 15 seconds), on the account that Claude Code is logged in with. Each take is different, so look at the results before you use them, and run again if you do not like one.

The results go to `out/<theme>/`:

| File | Tape | What it shows |
| --- | --- | --- |
| `main-dark.gif`, `main-light.gif` (and `.mp4`) | `main.tape` | The main README image: the take with no pane, for any agent, with a new session that recalls an older decision at the end |
| `claude-code-dark.gif`, `claude-code-light.gif` (and `.mp4`) | `claude-code.tape` | The Claude Code README image: the take with the journal pane open, the new entry opened in it, and a new session with the pane that recalls an older decision |
| `recall-dark.gif`, `recall-light.gif` (and `.mp4`) | `recall.tape` | The Recall section image: Claude answers a question from the journal, at normal speed |
| `*-raw.mp4`, `*-plain.mp4` | all | The takes at normal speed, and the first two sped up with no window |
| `main-done-*.png`, `main-end-*.png`, `main-recall-*.png` | `main.tape` | The finished turn, the shell, and the answer of the new session |
| `claude-code-pane-*.png`, `claude-code-pane-entry-*.png`, `claude-code-recall-*.png` | `claude-code.tape` | The pane after the turn, the opened entry, and the answer of the new session |
| `recall-done-*.png` | `recall.tape` | The answer |

The dark theme (`graphite-dark`) gives the `-dark` files, and the light theme (`graphite-light`) the `-light` files. The screenshots also come as `-plain`, with no window. To use them, copy them to `assets/`: `main-<mode>.gif` to `session-<mode>.gif`, `claude-code-<mode>.gif` to `claude-code-session-<mode>.gif`, and `recall-<mode>.gif`, `claude-code-pane-<mode>.png` and `claude-code-pane-entry-<mode>.png` with the same names. The READMEs show the version that matches the reader's GitHub theme.

`resume.tape` is a short take with no model turn, for a post: the shell finds an entry with `grep -il redis *.md`, shows it with `cat`, and opens its session with `claude --resume <session_id>`. The session is a demo transcript from `fixture/sessions/`. `record.sh` does not run it. To record it in the dark version:

```sh
cp settings/graphite-dark.tape .theme.tape && printf graphite-dark > .theme-name
vhs resume.tape
ffmpeg -i out/resume-raw.mp4 -vf "drawbox=x=152:y=372:w=406:h=24:color=0x85befd@0.35:t=fill:enable='between(t,10,19.1)'" -pix_fmt yuv420p out/resume-highlight.mp4
../frame/frame.sh out/resume-highlight.mp4 out/graphite-dark/resume-dark.gif dark Terminal dark
```

The `ffmpeg` step draws a selection over the session ID, from one second after `cat` until Claude Code clears the screen. These times are from one take: find them in a contact sheet of the new take and change them if they are different.

## How it works

- **Demo home.** `reset.sh` builds a new home folder in `/tmp/agent-journal-demo` (set `AGENT_JOURNAL_DEMO_HOME` to use another one) from `fixture/`: the sample journal in `~/agent-journal`, the session of one sample entry for `claude --resume`, the sample repository in `~/Developer/my-awesome-lib` with one commit, and a config with the demo host `macbook` and the demo user `chris`. The takes run Claude Code and the shell with this folder as `HOME`, so the recordings show `~/agent-journal`, and the real home is never read or changed.
- **Login.** Claude Code finds its login on macOS in the login keychain under `~/Library/Keychains`, and elsewhere in `~/.claude/.credentials.json`. `reset.sh` links that one item into the demo home. Nothing else of the real home is in it.
- **Claude Code state.** `reset.sh` writes the demo home's `~/.claude.json` (onboarding done, the sample repository trusted, a pane width of 70 columns, and the notices, hints and promos of a new install marked as seen) and `~/.claude/settings.json` (the fullscreen renderer, which puts the pane beside the chat, auto mode accepted, and no prompt suggestions). If a new version of Claude Code shows a new notice on the start screen, find its key in a `~/.claude.json` that has seen it, and add it to `reset.sh`.
- **Launch.** `launch.sh` starts Claude Code in the sample repository with a clean environment, the plugin from this checkout (`--plugin-dir` at `claude-code/`), no MCP servers and auto mode.
- **Speed.** `record.sh` plays the parts where the model works 5 times faster. The main and Claude Code takes each have two turns, so `speed.py` finds their times in the take: Claude Code's fullscreen view has a line across the terminal and the shell has none, which gives the times when Claude exits and starts again. The other times come from the fixed waits of each tape, and are the arguments of `speed.py` in `record.sh`. The shell part between the sessions plays 1.5 times faster. If a later version of Claude Code changes these times, find the new ones on frames of the raw take and change the arguments.
- **Look.** `settings/<theme>.tape` sets the font and the theme. `graphite-dark` has the colors of Atom, and `graphite-light` the colors of Atom One Light. Each has the background of the journal pane in Claude Code's dark or light theme, so the pane and the terminal have one color. For a theme whose name ends in `-light`, `reset.sh` also sets Claude Code's own theme to light. Each tape sets its own size after it: 1400×1000 for the main take and 1600×1000 for the Claude Code take, so the pane has room beside the chat.
- **Window.** vhs draws no window title, so the takes have no window, and `record.sh` puts each output into one with [`../frame/frame.sh`](../frame): a macOS title bar with a title (`TITLE`, default `Terminal`), rounded corners and a margin of 24 pixels in GitHub's dark (`#0d1117`) or light (`#ffffff`) page color. The title bar is dark for a dark theme and light for a light theme.
- **Fixture summaries.** Each summary in `fixture/agent-journal/` is short enough that its `grep` line fits on one line of the main take (120 columns). Keep new ones as short. For the entry that Claude writes in the take, `reset.sh` puts a user preference in the demo home's `~/.claude/CLAUDE.md`: summaries under 80 characters. The plugin's own limit is 200 characters, so without the preference the summary can break onto a second line.

## Keys in the pane

After the turn, the prompt has the focus, and `Ctrl+X` `Tab` moves it into the pane. The tab order there is `Close`, `All`, `Current`, date `All`, `Year`, `Month`, `Day`, then the rows, newest first. So 8 more `Tab` presses reach the newest entry. In the opened entry, `Esc` goes back to the list, and in the list, `Esc` closes the pane and gives the focus back to the prompt.
