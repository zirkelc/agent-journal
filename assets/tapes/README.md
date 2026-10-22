# Recordings

The images in the READMEs are live takes, recorded with [vhs](https://github.com/charmbracelet/vhs). Each folder holds the tapes of one agent:

- [`claude-code/`](claude-code): the main README image and the Claude Code README images.

[`frame/`](frame) puts a take into a macOS window with a title on GitHub's dark or light page background. vhs draws no window title, so the takes are recorded without a window. `frame.sh` draws the window with headless Chrome from `frame.html`, and ffmpeg puts the take under it.
