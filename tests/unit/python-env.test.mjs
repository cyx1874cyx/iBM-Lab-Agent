import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { venvPythonPath, systemPythonCommand, preflight, sha256OfFile } from "../../src/python-env.js";

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
