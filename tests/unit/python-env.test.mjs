import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	venvPythonPath,
	systemPythonCommand,
	preflight,
	sha256OfFile,
	pythonCandidates,
	resolvePythonExecutable,
	pythonEnvironmentStatus
} from "../../src/python-env.js";

test("venvPythonPath is platform-aware", () => {
	assert.match(venvPythonPath("/x/.venv", "win32"), /Scripts[\\/]python\.exe$/);
	assert.match(venvPythonPath("/x/.venv", "linux"), /bin[\\/]python$/);
});

test("systemPythonCommand prefers py launcher on win32", () => {
	assert.deepEqual(systemPythonCommand("win32"), ["py", "-3"]);
	assert.deepEqual(systemPythonCommand("linux"), ["python3"]);
});

test("preflight reports missing venv and lock", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-py-"));
	try {
		const state = await preflight({ venvDir: join(dir, ".venv"), lockFile: join(dir, "requirements.lock") });
		assert.equal(state.ok, false);
		assert.ok(state.issues.some((i) => i.includes("lock file")));
		assert.ok(state.issues.some((i) => i.includes("venv python")));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("sha256OfFile is stable", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-hash-"));
	try {
		const path = join(dir, "req.lock");
		await writeFile(path, "a==1\nb==2\n", "utf8");
		const one = await sha256OfFile(path);
		const two = await sha256OfFile(path);
		assert.equal(one, two);
		assert.equal(one.length, 64);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

// ---- P1-2 统一 Python Resolver ----

test("pythonCandidates on win32: py -3.11 → py -3 → python, never python3", () => {
	const candidates = pythonCandidates({ platform: "win32" });
	assert.deepEqual(candidates.map((c) => c.source), ["py", "py", "python"]);
	assert.deepEqual(candidates[0].command, ["py", "-3.11"]);
	assert.deepEqual(candidates[1].command, ["py", "-3"]);
	// Windows 不出现 python3 候选
	assert.ok(!candidates.some((c) => c.command[0] === "python3"));
});

test("pythonCandidates on unix: python3 only", () => {
	const candidates = pythonCandidates({ platform: "linux" });
	assert.deepEqual(candidates.map((c) => c.source), ["python3"]);
	assert.deepEqual(candidates[0].command, ["python3"]);
});

test("pythonCandidates prefers an existing venv, then bundled python", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-cand-"));
	try {
		const venvPy = join(dir, "Scripts", "python.exe");
		await mkdir(join(dir, "Scripts"), { recursive: true });
		await writeFile(venvPy, "");
		const withVenv = pythonCandidates({ venvPython: venvPy, platform: "win32" });
		assert.equal(withVenv[0].source, "venv");
		assert.equal(withVenv[0].command[0], venvPy);
		assert.deepEqual(withVenv.slice(1).map((c) => c.source), ["py", "py", "python"]);

		const bundled = join(dir, "bundled", "python.exe");
		await mkdir(join(dir, "bundled"), { recursive: true });
		await writeFile(bundled, "");
		const withBundled = pythonCandidates({ venvPython: venvPy, bundledPython: bundled, platform: "win32" });
		assert.deepEqual(withBundled.map((c) => c.source), ["venv", "bundled", "py", "py", "python"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("resolvePythonExecutable returns a usable candidate or unavailable (win32, real probe)", async () => {
	const resolved = await resolvePythonExecutable({ venvPython: join("C:", "definitely-missing", "python.exe"), platform: "win32" });
	assert.ok(["venv", "bundled", "py", "python", "unavailable"].includes(resolved.source), resolved.source);
	if (resolved.command) {
		assert.ok(Array.isArray(resolved.command));
		assert.ok(resolved.command.length > 0);
		assert.match(resolved.version, /^Python /, resolved.version);
	} else {
		assert.equal(resolved.source, "unavailable");
		assert.equal(resolved.version, "");
	}
});

test("resolvePythonExecutable skips a missing venv candidate", async () => {
	const resolved = await resolvePythonExecutable({ venvPython: join("C:", "missing-venv", "python.exe"), platform: "linux" });
	assert.notEqual(resolved.source, "venv");
});

test("pythonEnvironmentStatus aggregates venv/lock/resolver state", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-status-"));
	try {
		const lockFile = join(dir, "requirements.lock");
		await writeFile(lockFile, "a==1\n", "utf8");
		const status = await pythonEnvironmentStatus({ venvDir: join(dir, ".venv"), lockFile, platform: "win32" });
		assert.equal(status.venv.exists, false);
		assert.equal(status.venv.python.includes("Scripts" + (process.platform === "win32" ? "\\" : "/") + "python"), true);
		assert.equal(status.lock.exists, true);
		assert.match(status.lock.hash, /^[0-9a-f]{64}$/);
		assert.equal(typeof status.available, "boolean");
		assert.ok(status.summary.length > 0);
		assert.ok(["venv", "bundled", "py", "python", "unavailable"].includes(status.resolved.source));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
