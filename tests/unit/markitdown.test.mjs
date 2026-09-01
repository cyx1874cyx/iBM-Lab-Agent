import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { probeMarkitdown } from "../../src/markitdown.js";

test("probeMarkitdown reports availability with a clear error when unavailable", async () => {
	const result = await probeMarkitdown({});
	assert.equal(typeof result.available, "boolean");
	if (result.available === false) {
		assert.ok(result.error, "unavailable must carry an install hint");
		assert.match(result.error, /markitdown/);
	}
});

test("MarkItDown invokes Python without a Windows shell", async () => {
	const source = await readFile(fileURLToPath(new URL("../../src/markitdown.js", import.meta.url)), "utf8");
	assert.doesNotMatch(source, /shell\s*:/, "shell 会把 C:\\Program Files 中的脚本路径拆开");
});

test("MarkItDown converter fixes its JSON protocol to UTF-8", async () => {
	const source = await readFile(fileURLToPath(new URL("../../scripts/markitdown/convert.py", import.meta.url)), "utf8");
	assert.match(source, /reconfigure\(encoding="utf-8"/, "Windows GBK stdout must not reject extracted Unicode symbols");
	assert.match(source, /open\(output, "w", encoding="utf-8"/, "Markdown output must remain UTF-8");
});
