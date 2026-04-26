# draw-prompt

Use the local `draw-prompt` CLI.

Argument behavior:

- `latest`: run `draw-prompt latest`
- `open`: run `draw-prompt open`
- `stop`: run `draw-prompt stop`
- empty or anything else: run `draw-prompt`

After running:

- If stdout contains a `/tmp/draw-prompt-*.png` path, respond with exactly `@<path>`.
- If no saved image exists, say `No saved draw-prompt image yet.`
- Do not invent paths.

Arguments: $ARGUMENTS
