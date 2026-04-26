---
name: draw-prompt
description: Use the local draw-prompt CLI to open a browser drawing canvas or return the latest saved draw-prompt image path for terminal/AI prompt references.
---

Use this when the user asks to run draw-prompt, open a browser drawing canvas, or paste the latest saved drawing.

Commands:

- One-shot drawing: `draw-prompt`
- Latest persistent remote image: `draw-prompt latest`
- Show persistent remote QR/URL: `draw-prompt open`
- Stop persistent remote server: `draw-prompt stop`

Rules:

- Confirm `draw-prompt` exists with `command -v draw-prompt` before running it.
- If stdout is a `/tmp/draw-prompt-*.png` path, return `@<path>` to the user.
- Keep stdout path-only behavior intact. Do not wrap the command in extra output.
- If `draw-prompt latest` reports no saved image, tell the user no saved draw-prompt image exists yet.

