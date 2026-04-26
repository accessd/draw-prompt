const TLDRAW_VERSION = "4.5.10";
const REACT_VERSION = "19.2.1";

export function renderDrawPage(token: string, persistent: boolean): string {
	const tokenJson = JSON.stringify(token);
	const persistentJson = JSON.stringify(persistent);
	const tldrawVersion = encodeURIComponent(TLDRAW_VERSION);
	const reactVersion = encodeURIComponent(REACT_VERSION);

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>draw-prompt</title>
	<link rel="stylesheet" href="https://unpkg.com/tldraw@${tldrawVersion}/tldraw.css" />
	<style>
		* { box-sizing: border-box; }
		html, body, #root { width: 100%; height: 100%; margin: 0; }
		body {
			overflow: hidden;
			background: #f8f7f2;
			color: #181818;
			font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		}
		#root { position: fixed; inset: 0; }
		.actions {
			position: fixed;
			right: 12px;
			bottom: 12px;
			z-index: 10000;
			display: flex;
			gap: 8px;
			padding: 8px;
			border: 1px solid rgba(24, 24, 24, 0.12);
			border-radius: 8px;
			background: rgba(255, 255, 255, 0.92);
			box-shadow: 0 10px 28px rgba(24, 24, 24, 0.18);
			backdrop-filter: blur(16px);
		}
		.actions button {
			appearance: none;
			min-width: 72px;
			border: 0;
			border-radius: 6px;
			cursor: pointer;
			font: inherit;
			font-weight: 650;
			line-height: 1;
			padding: 12px 14px;
		}
		#cancel {
			background: #ece8df;
			color: #222;
		}
		#clear {
			background: #ece8df;
			color: #222;
		}
		#save {
			background: #2457d6;
			color: white;
		}
		#save:disabled, #cancel:disabled, #clear:disabled {
			cursor: default;
			opacity: 0.55;
		}
		#status {
			position: fixed;
			left: 12px;
			bottom: 12px;
			z-index: 10000;
			max-width: min(640px, calc(100vw - 24px));
			border-radius: 6px;
			background: rgba(24, 24, 24, 0.84);
			color: white;
			font-size: 13px;
			line-height: 1.35;
			padding: 8px 10px;
			opacity: 0;
			pointer-events: none;
			transition: opacity 120ms ease;
		}
		#status.visible { opacity: 1; }
		@media (max-width: 600px) {
			.actions {
				top: calc(env(safe-area-inset-top, 0px) + 86px);
				right: 8px;
				bottom: auto;
				flex-direction: column;
				gap: 6px;
				padding: 6px;
				border-radius: 8px;
				box-shadow: 0 6px 18px rgba(24, 24, 24, 0.14);
			}
			.actions button {
				min-width: 76px;
				padding: 10px 12px;
				font-size: 14px;
			}
			#status {
				left: 8px;
				right: 8px;
				bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
				max-width: none;
			}
		}
	</style>
</head>
<body>
	<div id="root"></div>
	<div class="actions">
		<button id="cancel" type="button">Cancel</button>
		<button id="clear" type="button" disabled>Clear</button>
		<button id="save" type="button" disabled>Save</button>
	</div>
	<div id="status"></div>

	<script type="module">
		import React from "https://esm.sh/react@${reactVersion}";
		import { createRoot } from "https://esm.sh/react-dom@${reactVersion}/client";
		import { Tldraw, getSnapshot, loadSnapshot } from "https://esm.sh/tldraw@${tldrawVersion}?deps=react@${reactVersion},react-dom@${reactVersion}";

		const TOKEN = ${tokenJson};
		const PERSISTENT = ${persistentJson};
		const saveButton = document.getElementById("save");
		const clearButton = document.getElementById("clear");
		const cancelButton = document.getElementById("cancel");
		const status = document.getElementById("status");
		let editor = null;
		let busy = false;
		let finished = false;
		let statusTimer = null;
		let snapshotSaveTimer = null;

		function showStatus(message) {
			status.textContent = message;
			status.classList.add("visible");
			if (statusTimer) clearTimeout(statusTimer);
			statusTimer = setTimeout(() => status.classList.remove("visible"), 2600);
		}

		function setBusy(value) {
			busy = value;
			saveButton.disabled = !editor || busy;
			clearButton.disabled = !editor || busy;
			cancelButton.disabled = busy;
			saveButton.textContent = busy ? "Saving" : "Save";
		}

		function nextFrame() {
			return new Promise((resolve) => requestAnimationFrame(() => resolve()));
		}

		async function flushEditor() {
			if (document.activeElement instanceof HTMLElement) {
				document.activeElement.blur();
			}
			await nextFrame();
			await nextFrame();
		}

		async function post(path, body) {
			const response = await fetch(path + "?token=" + encodeURIComponent(TOKEN), {
				method: "POST",
				headers: body ? { "Content-Type": "image/png" } : {},
				body,
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.ok) {
				throw new Error(data.error || response.statusText || "Request failed");
			}
			return data;
		}

		async function getJson(path) {
			const response = await fetch(path + "?token=" + encodeURIComponent(TOKEN));
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.ok) {
				throw new Error(data.error || response.statusText || "Request failed");
			}
			return data;
		}

		async function putJson(path, value) {
			const response = await fetch(path + "?token=" + encodeURIComponent(TOKEN), {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(value),
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !data.ok) {
				throw new Error(data.error || response.statusText || "Request failed");
			}
			return data;
		}

		async function saveSnapshotNow() {
			if (!PERSISTENT || !editor) return;
			if (snapshotSaveTimer) {
				clearTimeout(snapshotSaveTimer);
				snapshotSaveTimer = null;
			}
			await putJson("/snapshot", getSnapshot(editor.store));
		}

		function scheduleSnapshotSave() {
			if (!PERSISTENT || !editor) return;
			if (snapshotSaveTimer) clearTimeout(snapshotSaveTimer);
			snapshotSaveTimer = setTimeout(() => {
				snapshotSaveTimer = null;
				void saveSnapshotNow().catch((error) => console.error(error));
			}, 350);
		}

		async function loadServerSnapshot() {
			if (!PERSISTENT || !editor) return;
			const data = await getJson("/snapshot");
			if (data.snapshot) {
				loadSnapshot(editor.store, data.snapshot);
			}
		}

		async function saveDrawing() {
			if (!editor || busy || finished) return;

			await flushEditor();
			const ids = Array.from(editor.getCurrentPageShapeIds());
			if (ids.length === 0) {
				showStatus("Nothing to save");
				return;
			}

			setBusy(true);
			try {
				await saveSnapshotNow();
				if (editor.fonts?.loadRequiredFontsForCurrentPage) {
					await editor.fonts.loadRequiredFontsForCurrentPage(editor.options.maxFontsToLoadBeforeRender);
				}

				const result = await editor.toImage(ids, {
					format: "png",
					background: true,
					padding: 48,
					pixelRatio: 2,
					darkMode: false,
				});
				if (!result?.blob) throw new Error("Export failed");

				const data = await post("/submit", result.blob);
				showStatus(data.path);
				if (PERSISTENT) {
					setBusy(false);
				} else {
					finished = true;
					setTimeout(() => window.close(), 120);
				}
			} catch (error) {
				console.error(error);
				showStatus(error instanceof Error ? error.message : String(error));
				setBusy(false);
			}
		}

		async function clearDrawing() {
			if (!editor || busy) return;
			await flushEditor();
			const ids = Array.from(editor.getCurrentPageShapeIds());
			if (ids.length === 0) return;
			editor.deleteShapes(ids);
			await saveSnapshotNow();
			showStatus("Cleared");
		}

		async function cancelDrawing() {
			if (busy || finished) return;
			finished = true;
			try {
				if (!PERSISTENT) await post("/cancel");
			} finally {
				window.close();
			}
		}

		function notifyClosed() {
			if (finished) return;
			finished = true;
			if (PERSISTENT) return;
			try {
				navigator.sendBeacon("/cancel?token=" + encodeURIComponent(TOKEN), new Blob([], { type: "text/plain" }));
			} catch (_) {
			}
		}

		saveButton.addEventListener("click", saveDrawing);
		clearButton.addEventListener("click", clearDrawing);
		cancelButton.addEventListener("click", cancelDrawing);
		window.addEventListener("pagehide", notifyClosed);
		window.addEventListener("beforeunload", notifyClosed);

		function App() {
			return React.createElement(Tldraw, {
				persistenceKey: PERSISTENT ? undefined : "draw-prompt-canvas",
				autoFocus: true,
				onMount: (mountedEditor) => {
					editor = mountedEditor;
					setBusy(false);
					let cleanup = () => {};
					void loadServerSnapshot()
						.catch((error) => {
							console.error(error);
							showStatus(error instanceof Error ? error.message : String(error));
						})
						.finally(() => {
							cleanup = editor?.store.listen(scheduleSnapshotSave, { source: "user", scope: "document" }) ?? cleanup;
						});
					return () => {
						cleanup();
						if (snapshotSaveTimer) clearTimeout(snapshotSaveTimer);
						editor = null;
						setBusy(false);
					};
				},
			});
		}

		createRoot(document.getElementById("root")).render(React.createElement(App));
	</script>
</body>
</html>`;
}
