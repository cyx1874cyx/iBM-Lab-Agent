/**
 * dsh-lab-agent: dev-only invariant helpers (thrown in test/debug runs).
 * Mirrors the harness packages' `./invariant` convention.
 */

export class LabAgentInvariantError extends Error {
	name = "LabAgentInvariantError";
}

/** Assert a condition; throws LabAgentInvariantError with `detail` when false. */
export function invariant(condition, detail) {
	if (!condition) throw new LabAgentInvariantError(detail);
}

/** Assert a value is a plain object (e.g. a parsed lock). */
export function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
