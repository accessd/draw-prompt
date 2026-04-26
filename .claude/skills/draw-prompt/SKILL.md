---
name: draw-prompt
description: Open draw-prompt to create a browser drawing for the current AI prompt, or paste the latest saved draw-prompt image path. Use when the user invokes /draw-prompt or asks to draw/sketch something for the prompt.
argument-hint: "[latest|one-shot|open|stop]"
disable-model-invocation: true
allowed-tools: Bash(command -v draw-prompt), Bash(draw-prompt *)
---

Use the local `draw-prompt` CLI to produce an image reference for the conversation.

Arguments:

- `latest`: run `draw-prompt latest`.
- `open`: run `draw-prompt open`.
- `stop`: run `draw-prompt stop`.
- empty, `one-shot`, or anything else: run `draw-prompt`.

Workflow:

1. Check `draw-prompt` exists with `command -v draw-prompt`.
2. Run the selected command.
3. If the command prints a `/tmp/draw-prompt-*.png` path, respond with exactly `@<path>` and no extra text.
4. If the command fails because no remote image has been saved yet, say `No saved draw-prompt image yet.`

Do not summarize the image. Do not invent a file path.

