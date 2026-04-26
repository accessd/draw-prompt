# draw-prompt

Draw a quick sketch in a browser and send the saved PNG path back to your terminal.

`draw-prompt` is useful when a terminal workflow accepts file references, for example prompt text like:

```text
@/tmp/draw-prompt-2026-04-26T11-55-32-325Z-09426c68.png
```

It opens a local tldraw canvas, saves the drawing as a PNG under `/tmp`, and prints only the file path to stdout.

## Features

- Browser-based drawing with tldraw.
- One-shot terminal mode for quick local sketches.
- Persistent remote mode for phones, tablets, and other computers on your LAN.
- QR code for opening the remote canvas.
- Latest-saved-image command for tmux bindings.
- Server-backed drawing snapshot in persistent mode, so another device can open the same current drawing.
- PNG paths are stdout-only, so shell scripts and tmux bindings stay simple.

## Requirements

- Bun.
- A browser.
- macOS, Linux, or Windows. The remote workflow is mostly tested on macOS.

## Install

### From npm

```sh
npm install -g draw-prompt
```

`draw-prompt` is installed through npm, but it still requires Bun at runtime:

```sh
curl -fsSL https://bun.sh/install | bash
```

### From source

Clone the repo and link the local CLI:

```sh
git clone https://github.com/accessd/draw-prompt.git
cd draw-prompt
bun install
bun link
```

Check that the command resolves:

```sh
draw-prompt --help
```

## Quick Start

Run:

```sh
draw-prompt
```

The command starts a local server, opens your browser, and keeps running until you click `Save` or `Cancel`.

Draw something, click `Save`, and the command prints a path:

```text
/tmp/draw-prompt-2026-04-26T11-55-32-325Z-09426c68.png
```

stdout contains only that path. Status text, QR codes, and URLs go to stderr.

## Remote Mode

Use remote mode when you want to draw on a phone, tablet, or another computer.

```sh
draw-prompt serve --remote
```

This starts a long-lived server on your LAN, prints a QR code and URL, and keeps running.

Open the URL on another device. The browser tab can stay open.

When you click `Save`, the server writes a PNG under `/tmp`. To print the latest saved path:

```sh
draw-prompt latest
```

To show the QR code and URL again:

```sh
draw-prompt open
```

To stop the server:

```sh
draw-prompt stop
```

## Cross-Device Editing

Persistent remote mode stores the current tldraw document snapshot on the server.

That means you can:

1. Open the canvas on desktop.
2. Draw or edit.
3. Open the same URL on your phone or tablet.
4. Continue from the latest saved document state.

This is not live multiplayer. A newly opened device loads the latest server snapshot, and active browsers autosave their edits back to the server.

## tmux

Example bindings:

```tmux
bind-key -n M-3 run-shell -b '\
  tmpfile=/tmp/tmux_draw_prompt_$$.tmp; \
  draw-prompt > "$tmpfile"; \
  [ -s "$tmpfile" ] && tmux send-keys -t "#{pane_id}" -l "@$(cat "$tmpfile") "; \
  rm -f "$tmpfile"'

bind-key -n M-4 run-shell -b '\
  tmpfile=/tmp/tmux_draw_prompt_remote_$$.tmp; \
  draw-prompt latest > "$tmpfile"; \
  if [ -s "$tmpfile" ]; then \
    tmux send-keys -t "#{pane_id}" -l "@$(cat "$tmpfile") "; \
  else \
    tmux display-message "draw-prompt: no saved remote image yet"; \
  fi; \
  rm -f "$tmpfile"'

bind-key -n M-5 display-popup -w 70% -h 80% -E "draw-prompt open"
```

Suggested flow:

1. Start remote mode once:

```sh
draw-prompt serve --remote
```

2. Open the canvas from the QR code.
3. Draw and click `Save`.
4. Press `M-4` in tmux to paste the latest image reference into the active pane.

## Commands

```text
draw-prompt [command] [options]
```

Commands:

- `draw-prompt`: open a one-shot local browser canvas.
- `draw-prompt serve`: start a persistent draw server.
- `draw-prompt latest`: print the latest saved PNG path from the persistent server.
- `draw-prompt open`: print the persistent server URL and QR code again.
- `draw-prompt stop`: stop the persistent server.

Options:

- `--remote`: listen on the LAN, print a device URL and QR code, and do not open the local browser.
- `--qr`: print a QR code to stderr.
- `--no-qr`: do not print a QR code.
- `--no-open`: do not open the browser.
- `--listen <ip>`: bind the server to an address.
- `--host <ip>`: use this host in the printed or opened URL.
- `--port <port>`: bind the server to a specific port.

## Security Model

By default, `draw-prompt` binds to `127.0.0.1`.

`--remote` binds to `0.0.0.0` so other devices on your LAN can reach it. The URL includes a random token. Requests without that token are rejected.

This is intended for trusted local networks. Do not expose it to the public internet.

## Files

- PNG output: `/tmp/draw-prompt-*.png`
- Persistent server info: `/tmp/draw-prompt-server.json`

Persistent drawing snapshots live in memory. Restarting `draw-prompt serve --remote` clears the current editable drawing state.

## Development

```sh
bun install
bun run typecheck
```

The CLI entrypoint is `src/cli.ts`. The served browser UI lives in `src/page.ts`.

## Agent Integrations

The repo includes project-local agent integrations:

- Claude Code skill: `.claude/skills/draw-prompt/SKILL.md`
- Codex skill: `.codex/skills/draw-prompt/SKILL.md`
- Codex prompt command: `.codex/prompts/draw-prompt.md`

In Claude Code, the skill creates `/draw-prompt`. Invoke it with:

```text
/draw-prompt
/draw-prompt latest
/draw-prompt open
/draw-prompt stop
```

Behavior:

- `/draw-prompt` runs one-shot drawing and returns `@/tmp/...png`.
- `/draw-prompt latest` returns the latest saved remote image as `@/tmp/...png`.
- `/draw-prompt open` shows the persistent remote URL and QR code again.
- `/draw-prompt stop` stops the persistent remote server.

To install globally for Claude Code:

```sh
mkdir -p ~/.claude/skills
cp -R .claude/skills/draw-prompt ~/.claude/skills/
```

To install globally for Codex:

```sh
mkdir -p ~/.codex/skills ~/.codex/prompts
cp -R .codex/skills/draw-prompt ~/.codex/skills/
cp .codex/prompts/draw-prompt.md ~/.codex/prompts/
```

Claude Code skills are documented at https://code.claude.com/docs/en/skills.
