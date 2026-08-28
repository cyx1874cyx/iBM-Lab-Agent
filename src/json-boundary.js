/**
 * Convert service values to the subset that can cross Typert/tool JSON
 * boundaries without losing information. Zod optional fields are commonly
 * materialized as own properties whose value is `undefined`; JSON omits those
 * object properties, so the boundary correctly rejects the original value as
 * non-lossless unless we remove them first.
 */
export function cleanJson(value) {
	if (value === undefined) return undefined;
	if (Array.isArray(value)) {
		// JSON.stringify represents undefined array entries as null. Do the same
		// explicitly so the value is already lossless before it reaches Typert.
		return value.map((item) => item === undefined ? null : cleanJson(item));
	}
	if (value !== null && typeof value === "object") {
		const out = {};
		for (const [key, child] of Object.entries(value)) {
			if (child === undefined) continue;
			out[key] = cleanJson(child);
		}
		return out;
	}
	return value;
}

export default cleanJson;
