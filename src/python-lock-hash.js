/**
 * Hash Python lockfiles as LF-normalized UTF-8 text.
 *
 * `.gitattributes` intentionally checks requirements.lock out as LF, but a
 * Windows checkout with core.autocrlf may still present CRLF bytes to Node.
 * The vendor lock must identify dependency content, not the checkout's line
 * ending conversion.
 */

import { createHash } from "node:crypto";

export function canonicalPythonLockBytes(source) {
	const text = Buffer.isBuffer(source) ? source.toString("utf8") : String(source);
	return Buffer.from(text.replaceAll("\r\n", "\n"), "utf8");
}

export function pythonLockSha256(source) {
	return createHash("sha256").update(canonicalPythonLockBytes(source)).digest("hex");
}
