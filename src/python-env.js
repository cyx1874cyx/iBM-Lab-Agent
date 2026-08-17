/**
 * dsh-lab-agent: python environment management (pure logic).
 *
 * The vendored nature skills run their own python scripts (pdf parsing,
 * academic search, pptx generation). This module owns a pinned, managed
 * virtualenv at $DSH_HOME/lab-agent/.venv installed from a hash-pinned
 * requirements.lock — no system-site mutation, no auto-install at boot.
 *
 * Platform-aware (win32 venv layout and `py` launcher support).
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

/** sha256 of a lock file — the pin the venv was installed from. */
export async function sha256OfFile(path) {
	const buffer = await readFile(path);
	return createHash("sha256").update(buffer).digest("hex");
}

export function venvPythonPath(venvDir, platform = process.platform) {
	return platform === "win32" ? join(venvDir, "Scripts", "python.exe") : join(venvDir, "bin", "python");
}

/** Locate a system python for creating the venv (prefers py launcher on win32). */
export function systemPythonCommand(platform = process.platform) {
	return platform === "win32" ? ["py", "-3"] : ["python3"];
}

/** Run a command, streaming output, resolving on exit code 0. */
export function runCommand(args, { cwd, env }) {
	return new Promise((resolve, reject) => {
		const child = spawn(args[0], args.slice(1), {
			cwd,
			env: { ...process.env, ...env },
			stdio: ["ignore", "inherit", "inherit"],
			shell: process.platform === "win32"
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`command exited with ${signal ?? code}: ${args.join(" ")}`));
		});
	});
}

/** Synchronous-ish state probe: what exists where, and the lock's hash. */
export async function preflight({ venvDir, lockFile, platform = process.platform }) {
	const python = venvPythonPath(venvDir, platform);
	const lockExists = existsSync(lockFile);
	const venvExists = existsSync(python);
	const issues = [];
	if (!lockExists) issues.push(`missing lock file: ${lockFile}`);
	if (!venvExists) issues.push(`missing venv python: ${python}`);
	const lockHash = lockExists ? await sha256OfFile(lockFile) : undefined;
	return { venvDir, python, lockFile, lockExists, venvExists, lockHash, ok: issues.length === 0, issues };
}

/** Parse 'Python 3.11.9' → [3, 11]. */
export function parsePythonVersion(text) {
	const match = /Python\s+(\d+)\.(\d+)/.exec(text);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2])];
}

/**
 * Create the venv and install the pinned lock. Idempotent-ish: a venv whose
 * lock hash differs is reinstalled (pip install -r is incremental).
 */
export async function bootstrap({ venvDir, lockFile, platform = process.platform }) {
	const state = await preflight({ venvDir, lockFile, platform });
	if (!state.lockExists) throw new Error(`cannot bootstrap python env: ${state.issues[0]}`);

	const py = systemPythonCommand(platform);
	const sysVersion = await pythonVersionFrom(py, platform);
	const parsed = sysVersion ? parsePythonVersion(sysVersion) : undefined;
	if (parsed && (parsed[0] > 3 || (parsed[0] === 3 && parsed[1] >= 13))) {
		console.warn(`WARNING: system python ${sysVersion} >= 3.13; the pinned lock targets Python 3.11 ` +
			"(nature-skills CI environment). Some wheels may not exist for this version — expect possible build failures.");
	}

	if (!state.venvExists) {
		await runCommand([...py, "-m", "venv", venvDir], {});
	}
	await runCommand([venvPythonPath(venvDir, platform), "-m", "pip", "install", "--disable-pip-version-check", "-r", lockFile], {});
	return await preflight({ venvDir, lockFile, platform });
}

/** Run a python command and return its version line ('' when unavailable). */
async function pythonVersionFrom(args, platform) {
	try {
		const child = spawn(args[0], [...args.slice(1), "--version"], {
			stdio: ["ignore", "pipe", "pipe"],
			shell: platform === "win32"
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		await new Promise((resolve, reject) => {
			child.on("error", reject);
			child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("python --version failed"))));
		});
		return (stdout || stderr).trim();
	} catch {
		return "";
	}
}

/** Report the venv's python version (null when the venv does not exist). */
export async function pythonVersion(venvDir, platform = process.platform) {
	const python = venvPythonPath(venvDir, platform);
	if (!existsSync(python)) return null;
	const { stdout } = await new Promise((resolve, reject) => {
		const child = spawn(python, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		child.on("exit", (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`python --version failed: ${stderr || stdout}`))));
	});
	return (stdout || stderr).trim();
}
