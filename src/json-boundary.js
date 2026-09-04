/**
 * Convert service values to the subset that can cross Typert/tool JSON
 * boundaries without losing information.
 *
 * The boundary rejects values that JSON cannot round-trip losslessly, so this
 * module normalizes every non-lossless shape BEFORE it reaches the serializer:
 *
 *   - `undefined` object fields   → dropped (JSON omits them anyway);
 *   - `undefined` array entries   → `null` (JSON.stringify does the same);
 *   - `NaN` / `±Infinity` numbers → `null` (JSON has no representation);
 *   - `BigInt`                    → decimal string (JSON.stringify throws);
 *   - `Date`                      → ISO 8601 string (reversible);
 *   - `Map` / `Set`               → plain object / array (not `{}` as
 *                                    JSON.stringify would produce);
 *   - typed arrays / DataView     → plain number array (Buffer included);
 *   - functions / symbols         → dropped like `undefined`;
 *   - circular references         → dropped property (prevents stack overflow).
 *
 * After cleaning, `JSON.parse(JSON.stringify(value))` deep-equals the cleaned
 * value (typed-array/BigInt/Date conversions excepted by design).
 */
export function cleanJson(value, _seen) {
	if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "number" && !Number.isFinite(value)) return null; // NaN / ±Infinity
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) {
		return value.map((item) => item === undefined ? null : cleanJson(item, _seen));
	}
	if (value instanceof Map) {
		const out = {};
		for (const [key, child] of value.entries()) out[String(key)] = cleanJson(child, _seen);
		return out;
	}
	if (value instanceof Set) {
		return [...value].map((item) => cleanJson(item, _seen));
	}
	if (ArrayBuffer.isView(value)) {
		// Buffer / Uint8Array / DataView … → plain number array
		return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
	}
	if (value !== null && typeof value === "object") {
		const seen = _seen ?? new Set();
		if (seen.has(value)) return undefined; // 循环引用：跳过该属性
		seen.add(value);
		const out = {};
		for (const [key, child] of Object.entries(value)) {
			if (child === undefined) continue;
			const cleaned = cleanJson(child, seen);
			if (cleaned !== undefined) out[key] = cleaned;
		}
		seen.delete(value);
		return out;
	}
	return value;
}

export default cleanJson;
