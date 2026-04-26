#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import qrcode from "qrcode-terminal";
import { renderDrawPage } from "./page.js";

const LOCALHOST = "127.0.0.1";
const TMP_DIR = "/tmp";
const SERVER_INFO_PATH = "/tmp/draw-prompt-server.json";
const DEFAULT_SERVER_PORT = 49573;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

type Options = {
	listenHost: string;
	displayHost: string;
	openBrowser: boolean;
	showQr: boolean;
	port: number;
};

type Outcome =
	| { code: 0; path: string }
	| { code: 1; error?: string };

type RequestContext =
	| {
			mode: "oneshot";
			token: string;
			finish: (outcome: Outcome) => void;
	  }
	| {
			mode: "server";
			token: string;
			latestPath: string | undefined;
			documentSnapshot: unknown;
			stop: () => void;
	  };

type ServerInfo = {
	pid: number;
	token: string;
	url: string;
	localUrl: string;
	startedAt: string;
};

async function main(): Promise<number> {
	const args = process.argv.slice(2);
	const command = args[0];

	if (command === "serve") {
		return runServe(args.slice(1));
	}
	if (command === "latest") {
		return runLatest();
	}
	if (command === "open") {
		return runOpen(args.slice(1));
	}
	if (command === "stop") {
		return runStop();
	}

	const options = parseOptions(args, 0);
	if (!options) {
		process.stdout.write(renderUsage());
		return 0;
	}

	return runOneShot(options);
}

async function runOneShot(options: Options): Promise<number> {
	const token = randomUUID();
	let finished = false;
	let settle!: (outcome: Outcome) => void;
	const outcome = new Promise<Outcome>((resolve) => {
		settle = resolve;
	});

	const finish = (result: Outcome) => {
		if (finished) return;
		finished = true;
		settle(result);
	};

	const server = createServer((req, res) => {
		void handleRequest(req, res, { mode: "oneshot", token, finish }).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			if (!res.headersSent) {
				writeJson(res, 500, { ok: false, error: message });
			} else {
				res.end();
			}
			finish({ code: 1, error: message });
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port, options.listenHost, () => resolve());
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Could not determine draw server port.");
	}

	const url = `http://${options.displayHost}:${address.port}/draw?token=${encodeURIComponent(token)}`;
	if (options.showQr) {
		printQr(url);
	}
	if (!options.openBrowser) {
		process.stderr.write(`Open on device: ${url}\n`);
	} else {
		try {
			await openBrowser(url);
		} catch (error) {
			process.stderr.write(`Could not open browser. Open manually: ${url}\n`);
			process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		}
	}

	const onSignal = () => finish({ code: 1, error: "Interrupted" });
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);

	const result = await outcome;
	process.off("SIGINT", onSignal);
	process.off("SIGTERM", onSignal);
	await closeServer(server);

	if (result.code === 0) {
		process.stdout.write(`${result.path}\n`);
		return 0;
	}

	if (result.error) {
		process.stderr.write(`${result.error}\n`);
	}
	return 1;
}

async function runServe(args: string[]): Promise<number> {
	const options = parseOptions(args, DEFAULT_SERVER_PORT);
	if (!options) {
		process.stdout.write(renderUsage());
		return 0;
	}

	const existing = await readServerInfo().catch(() => undefined);
	if (existing && (await isServerAlive(existing))) {
		process.stderr.write(`draw-prompt server already running: ${existing.url}\n`);
		if (options.showQr) printQr(existing.url);
		return 0;
	}

	const token = randomUUID();
	let stopServer!: () => void;
	const stopped = new Promise<void>((resolve) => {
		stopServer = resolve;
	});

	const context: RequestContext = {
		mode: "server",
		token,
		latestPath: undefined,
		documentSnapshot: undefined,
		stop: stopServer,
	};

	const server = createServer((req, res) => {
		void handleRequest(req, res, context).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			if (!res.headersSent) {
				writeJson(res, 500, { ok: false, error: message });
			} else {
				res.end();
			}
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port, options.listenHost, () => resolve());
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Could not determine draw server port.");
	}

	const url = `http://${options.displayHost}:${address.port}/draw?token=${encodeURIComponent(token)}`;
	const localUrl = `http://${LOCALHOST}:${address.port}`;
	await writeServerInfo({
		pid: process.pid,
		token,
		url,
		localUrl,
		startedAt: new Date().toISOString(),
	});

	if (options.showQr) printQr(url);
	process.stderr.write(`Open on device: ${url}\n`);
	if (options.openBrowser) {
		await openBrowser(url);
	}

	const onSignal = () => stopServer();
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);

	await stopped;
	process.off("SIGINT", onSignal);
	process.off("SIGTERM", onSignal);
	await closeServer(server);
	await unlink(SERVER_INFO_PATH).catch(() => undefined);
	return 0;
}

async function runLatest(): Promise<number> {
	const info = await readServerInfo();
	const response = await fetch(`${info.localUrl}/latest?token=${encodeURIComponent(info.token)}`);
	const data = await response.json().catch(() => ({}));
	if (!response.ok || !data.ok || typeof data.path !== "string") {
		throw new Error(data.error || response.statusText || "No saved image yet");
	}
	process.stdout.write(`${data.path}\n`);
	return 0;
}

async function runOpen(args: string[]): Promise<number> {
	const showQr = !args.includes("--no-qr");
	const info = await readServerInfo();
	if (showQr) printQr(info.url);
	process.stderr.write(`Open on device: ${info.url}\n`);
	return 0;
}

async function runStop(): Promise<number> {
	const info = await readServerInfo();
	const response = await fetch(`${info.localUrl}/stop?token=${encodeURIComponent(info.token)}`, {
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(`Stop failed: ${response.statusText}`);
	}
	await unlink(SERVER_INFO_PATH).catch(() => undefined);
	return 0;
}

async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse,
	context: RequestContext,
) {
	const url = new URL(req.url ?? "/", `http://${LOCALHOST}`);

	if (req.method === "GET" && url.pathname === "/favicon.ico") {
		res.writeHead(204);
		res.end();
		return;
	}

	if (url.searchParams.get("token") !== context.token) {
		writeJson(res, 403, { ok: false, error: "Forbidden" });
		return;
	}

	if (req.method === "GET" && url.pathname === "/health") {
		writeJson(res, 200, { ok: true });
		return;
	}

	if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/draw")) {
		writeHtml(res, renderDrawPage(context.token, context.mode === "server"));
		return;
	}

	if (req.method === "POST" && url.pathname === "/cancel") {
		if (context.mode === "oneshot") {
			res.once("finish", () => context.finish({ code: 1, error: "Cancelled" }));
		}
		writeJson(res, 200, { ok: true });
		return;
	}

	if (req.method === "POST" && url.pathname === "/submit") {
		try {
			const path = await savePng(req);
			if (context.mode === "oneshot") {
				res.once("finish", () => context.finish({ code: 0, path }));
			} else {
				setLatestPath(context, path);
			}
			writeJson(res, 200, { ok: true, path });
		} catch (error) {
			const statusCode = getHttpStatus(error);
			const message = error instanceof Error ? error.message : String(error);
			if (context.mode === "oneshot") {
				res.once("finish", () => context.finish({ code: 1, error: message }));
			}
			writeJson(res, statusCode, { ok: false, error: message });
		}
		return;
	}

	if (context.mode === "server" && req.method === "GET" && url.pathname === "/snapshot") {
		writeJson(res, 200, { ok: true, snapshot: context.documentSnapshot ?? null });
		return;
	}

	if (context.mode === "server" && req.method === "PUT" && url.pathname === "/snapshot") {
		try {
			const snapshot = await readJsonBody(req, MAX_UPLOAD_BYTES);
			if (!snapshot || typeof snapshot !== "object") {
				throw httpError(400, "Expected a snapshot object.");
			}
			context.documentSnapshot = snapshot;
			writeJson(res, 200, { ok: true });
		} catch (error) {
			const statusCode = getHttpStatus(error);
			const message = error instanceof Error ? error.message : String(error);
			writeJson(res, statusCode, { ok: false, error: message });
		}
		return;
	}

	if (context.mode === "server" && req.method === "GET" && url.pathname === "/latest") {
		if (!context.latestPath) {
			writeJson(res, 404, { ok: false, error: "No saved image yet" });
			return;
		}
		writeJson(res, 200, { ok: true, path: context.latestPath });
		return;
	}

	if (context.mode === "server" && req.method === "POST" && url.pathname === "/stop") {
		res.once("finish", () => context.stop());
		writeJson(res, 200, { ok: true });
		return;
	}

	writeJson(res, 404, { ok: false, error: "Not found" });
}

function setLatestPath(context: Extract<RequestContext, { mode: "server" }>, path: string) {
	context.latestPath = path;
}

async function savePng(req: IncomingMessage): Promise<string> {
	const body = await readRequestBody(req, MAX_UPLOAD_BYTES);
	if (body.length === 0) {
		throw httpError(400, "Empty upload.");
	}
	if (!isPng(body)) {
		throw httpError(415, "Expected a PNG upload.");
	}

	const fileName = `draw-prompt-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.png`;
	const filePath = join(TMP_DIR, fileName);
	await writeFile(filePath, body, { mode: 0o600 });
	return filePath;
}

async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let total = 0;

	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.length;
		if (total > maxBytes) {
			throw httpError(413, `Upload is too large. Maximum size is ${Math.round(maxBytes / 1024 / 1024)}MB.`);
		}
		chunks.push(buffer);
	}

	return Buffer.concat(chunks);
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
	const body = await readRequestBody(req, maxBytes);
	if (body.length === 0) {
		throw httpError(400, "Empty JSON upload.");
	}
	try {
		return JSON.parse(body.toString("utf8"));
	} catch {
		throw httpError(400, "Invalid JSON.");
	}
}

function isPng(buffer: Buffer): boolean {
	return (
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	);
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
	const error = new Error(message) as Error & { statusCode: number };
	error.statusCode = statusCode;
	return error;
}

function getHttpStatus(error: unknown): number {
	if (error && typeof error === "object" && "statusCode" in error) {
		const statusCode = Number((error as { statusCode: unknown }).statusCode);
		if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) return statusCode;
	}
	return 500;
}

function writeHtml(res: ServerResponse, html: string) {
	res.writeHead(200, {
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "no-cache, no-store, must-revalidate",
	});
	res.end(html);
}

function writeJson(res: ServerResponse, statusCode: number, value: unknown) {
	res.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-cache, no-store, must-revalidate",
	});
	res.end(JSON.stringify(value));
}

function openBrowser(url: string): Promise<void> {
	const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { detached: true, stdio: "ignore" });
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}

function parseOptions(args: string[], defaultPort: number): Options | undefined {
	const options: Options = {
		listenHost: LOCALHOST,
		displayHost: LOCALHOST,
		openBrowser: true,
		showQr: false,
		port: defaultPort,
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") return undefined;

		if (arg === "--remote") {
			const lanIp = getLanIp();
			options.listenHost = "0.0.0.0";
			options.displayHost = lanIp ?? LOCALHOST;
			options.openBrowser = false;
			options.showQr = true;
			continue;
		}

		if (arg === "--qr") {
			options.showQr = true;
			continue;
		}

		if (arg === "--no-qr") {
			options.showQr = false;
			continue;
		}

		if (arg === "--no-open") {
			options.openBrowser = false;
			continue;
		}

		if (arg === "--listen" || arg === "--host" || arg === "--port") {
			const value = args[index + 1];
			if (!value) throw new Error(`${arg} requires a value.`);
			if (arg === "--listen") options.listenHost = value;
			if (arg === "--host") options.displayHost = value;
			if (arg === "--port") options.port = Number(value);
			index += 1;
			continue;
		}

		throw new Error(`Unknown option: ${arg}`);
	}

	if (options.listenHost === "0.0.0.0" && options.displayHost === LOCALHOST) {
		process.stderr.write("No LAN IPv4 address found. Use --host <ip> if the device cannot connect.\n");
	}
	if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
		throw new Error("--port must be an integer from 0 to 65535.");
	}

	return options;
}

async function readServerInfo(): Promise<ServerInfo> {
	let value: unknown;
	try {
		value = JSON.parse(await readFile(SERVER_INFO_PATH, "utf8"));
	} catch {
		throw new Error("No draw-prompt server is running. Start it with: draw-prompt serve --remote");
	}

	if (!isServerInfo(value)) {
		throw new Error(`Invalid server info at ${SERVER_INFO_PATH}`);
	}
	return value;
}

async function writeServerInfo(info: ServerInfo): Promise<void> {
	await writeFile(SERVER_INFO_PATH, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
}

function isServerInfo(value: unknown): value is ServerInfo {
	if (!value || typeof value !== "object") return false;
	const info = value as Record<string, unknown>;
	return (
		typeof info.pid === "number" &&
		typeof info.token === "string" &&
		typeof info.url === "string" &&
		typeof info.localUrl === "string" &&
		typeof info.startedAt === "string"
	);
}

async function isServerAlive(info: ServerInfo): Promise<boolean> {
	try {
		const response = await fetch(`${info.localUrl}/health?token=${encodeURIComponent(info.token)}`, {
			signal: AbortSignal.timeout(500),
		});
		return response.ok;
	} catch {
		return false;
	}
}

function getLanIp(): string | undefined {
	const candidates: Array<{ name: string; address: string; cidr?: string | null }> = [];
	for (const [name, entries] of Object.entries(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family === "IPv4" && !entry.internal) {
				candidates.push({ name, address: entry.address, cidr: entry.cidr });
			}
		}
	}

	candidates.sort((left, right) => scoreLanCandidate(right) - scoreLanCandidate(left));
	return candidates[0]?.address;
}

function scoreLanCandidate(candidate: { name: string; address: string; cidr?: string | null }): number {
	let score = 0;
	if (/^en\d+$/.test(candidate.name)) score += 100;
	if (isPrivateIpv4(candidate.address)) score += 50;
	if (!candidate.cidr?.endsWith("/32")) score += 10;
	return score;
}

function isPrivateIpv4(address: string): boolean {
	const parts = address.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
		return false;
	}
	return (
		parts[0] === 10 ||
		(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
		(parts[0] === 192 && parts[1] === 168)
	);
}

function printQr(url: string) {
	process.stderr.write("\n");
	qrcode.generate(url, { small: true }, (qr) => {
		process.stderr.write(`${qr}\n`);
	});
}

function renderUsage(): string {
	return `Usage: draw-prompt [command] [options]

Commands:
  serve           Start a long-lived draw server
  latest          Print the latest saved image path from the server
  open            Print the server URL and QR code again
  stop            Stop the long-lived draw server

Options:
  --remote        Listen on the LAN, print a device URL and QR code, and do not open the Mac browser
  --qr            Print a QR code to stderr
  --no-qr         Do not print a QR code
  --no-open       Do not open the browser
  --listen <ip>   Bind the server to an address
  --host <ip>     Use this host in the printed/opened URL
  --port <port>   Bind the server to a specific port
  -h, --help      Show help
`;
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
	return new Promise((resolve) => {
		server.close(() => resolve());
	});
}

main().then(
	(code) => {
		process.exitCode = code;
	},
	(error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	},
);
