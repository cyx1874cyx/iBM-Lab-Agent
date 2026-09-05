/**
 * 开放化合物双源确认：PubChem 与 CACTUS 分别查询、分别保留结果，
 * 只在两个来源的规范化结构一致时给出可自动采用的 dual-confirmed。
 *
 * 0.4.0-rc.4（§6.1）：禁止直接比较原始 SMILES 字符串。
 *  - 先经化学工具（RDKit calc.py，脚本 rdkit/calc.py）规范化；不可用时
 *    由调用方注入 canonizer（测试 stub / 服务层接线）；
 *  - 优先比较标准 InChIKey；无 InChIKey 时比较规范化 canonical SMILES；
 *  - 规范化失败返回明确错误/状态 unresolved，绝不误判一致。
 * 0.4.0-rc.4（§6.3）：PubChem 与 CACTUS 各自独立超时并记录；单源超时
 * 不阻塞另一源；未命中/冲突绝不自动写入。
 */

export const CAS_RE = /^\d{2,7}-\d{2}-\d$/;

/**
 * CAS 校验位验证（§6.2）：格式只是必要条件，还要验证校验位。
 * 算法：把去掉校验位的数字串从右到左编号 1..n，第 i 位乘以 i 求和，
 * 结果对 10 取模应等于校验位。例：64-17-5 → 数字 64175，校验位 5，
 * 去校验位 6417 从右到左 7*1+1*2+4*3+6*4 = 7+2+12+24 = 45 → 45%10=5 ✓
 */
export function validCas(value) {
	const text = String(value ?? "").trim();
	if (!CAS_RE.test(text)) return false;
	const digits = text.replace(/-/g, "");
	if (digits.length < 4) return false;
	const check = Number(digits[digits.length - 1]);
	const body = digits.slice(0, -1);
	let sum = 0;
	for (let i = 0; i < body.length; i += 1) {
		const digit = Number(body[body.length - 1 - i]);
		sum += digit * (i + 1);
	}
	return sum % 10 === check;
}

/** 基本空格归一化（仅作展示/回退；比较必须用化学规范化，见 normalizeCanonical）。 */
export function normalizeStructure(value) {
	return String(value ?? "").replace(/\s+/g, "").trim();
}

/**
 * 0.4.0-rc.4：经 RDKit（若可用）或注入 canonizer 规范化 SMILES。
 * 优先 InChIKey（不区分芳香写法/支链顺序/盐的表示变体等），其次
 * canonical SMILES。
 * @param value string 原始 SMILES
 * @param deps {{ rdkit?: Function, canonizer?: async (smiles)=>({inchiKey,canonicalSmiles}), timeoutMs?: number }}
 * @returns {{ status: "ok", canonicalSmiles, inchiKey } | { status: "unavailable"|"error", error }}
 */
export async function normalizeCanonical(value, deps = {}) {
	const smiles = String(value ?? "").trim();
	if (!smiles) return { status: "error", error: "empty structure to normalize" };
	// 1) 显式注入的化学规范化器（测试与服务层 stub）
	if (typeof deps.canonizer === "function") {
		try {
			const result = await deps.canonizer(smiles);
			if (!result || typeof result !== "object") return { status: "error", error: "canonizer returned no result" };
			if (result.error) return { status: "error", error: String(result.error) };
			if (!result.canonicalSmiles && !result.inchiKey) return { status: "error", error: "canonizer returned neither canonicalSmiles nor inchiKey" };
			return { status: "ok", canonicalSmiles: result.canonicalSmiles, inchiKey: result.inchiKey };
		} catch (error) {
			return { status: "error", error: `canonizer failed: ${error?.message || String(error)}` };
		}
	}
	// 2) RDKit（本仓库 python venv 可选依赖；服务层接线注入 rdkit 实现）
	if (typeof deps.rdkit === "function") {
		try {
			const rdkitResult = await deps.rdkit(smiles, { timeoutMs: deps.timeoutMs ?? 20000 });
			if (rdkitResult?.available && rdkitResult?.result?.ok) {
				return {
					status: "ok",
					canonicalSmiles: rdkitResult.result.canonicalSmiles,
					inchiKey: rdkitResult.result.inchiKey ?? rdkitResult.result.InChIKey
				};
			}
			return { status: "unavailable", error: rdkitResult?.error || "rdkit unavailable (no canonical comparator); dual-source comparison requires a chemical normalizer" };
		} catch (error) {
			return { status: "error", error: `rdkit normalize failed: ${error?.message || String(error)}` };
		}
	}
	// 3) 无任何化学规范化器：返回 unavailable（明确原因，不伪造一致）
	return {
		status: "unavailable",
		error: "no chemical normalizer available (rdkit not injected and canonizer not provided); dual-source comparison requires a chemical normalizer"
	};
}

/**
 * 带独立超时的 fetch 包装（§6.3：一个源超时不能无限阻塞整个步骤）。
 * @returns {{ ok: true, value } | { ok: false, error }}
 */
export async function withTimeout(fetchImpl, url, { timeoutMs = 15000, label = "request" } = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchImpl(url, { signal: controller.signal });
		if (!response.ok) return { ok: false, error: `${label} lookup failed (${response.status})` };
		const text = await response.text();
		return { ok: true, value: text };
	} catch (error) {
		if (error?.name === "AbortError") return { ok: false, error: `${label} lookup timed out after ${timeoutMs}ms` };
		return { ok: false, error: `${label} lookup failed: ${error?.message || String(error)}` };
	} finally {
		clearTimeout(timer);
	}
}

export async function lookupCactus(identifier, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
	const smilesUrl = `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(identifier)}/smiles`;
	const smilesAttempt = await withTimeout(fetchImpl, smilesUrl, { timeoutMs, label: "CACTUS" });
	if (!smilesAttempt.ok) throw new Error(smilesAttempt.error);
	const smiles = normalizeStructure(smilesAttempt.value);
	if (!smiles) throw new Error(`CACTUS returned no SMILES for '${identifier}'`);
	// 0.4.0-rc.4：一并取标准 InChIKey（两源都以标准 key 比较，杜绝字符串误判）；
	// stdinchikey 失败不致命——仍返回 smiles，比较侧会走本地化学规范化兜底。
	let inchiKey;
	try {
		const keyUrl = `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(identifier)}/stdinchikey`;
		const keyAttempt = await withTimeout(fetchImpl, keyUrl, { timeoutMs, label: "CACTUS key" });
		if (keyAttempt.ok) {
			const raw = String(keyAttempt.value ?? "").trim();
			if (raw && /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/.test(raw)) inchiKey = raw;
		}
	} catch {
		inchiKey = undefined;
	}
	return { smiles, inchiKey, queryTime: new Date().toISOString() };
}

/**
 * 双源结构确认（0.4.0-rc.4 §6.1）：
 *  1. 两源结果分别化学规范化（normalizeCanonical：RDKit/注入 canonizer）；
 *  2. 优先比较标准 InChIKey，其次规范化 canonical SMILES；
 *  3. 无法规范化（rdkit 不可用且无注入）→ 状态 unresolved + 明确原因，
 *     不把字符串相等误判为结构一致；
 *  4. 两源都失败但结构相同 → dual-confirmed；不同 → conflict；
 *     单源 → single-source（候选，不自动写入）。
 * @returns {{ query, casNumber, casSource, smiles, inchiKey, status, queriedAt, sources }}
 */
export async function resolveCompoundDual(identifier, deps = {}) {
	const query = String(identifier ?? "").trim();
	if (!query) throw new Error("compound name or CAS required");
	const pubchemLookup = deps.pubchem;
	const cactusLookup = deps.cactus;
	if (typeof pubchemLookup !== "function" || typeof cactusLookup !== "function") {
		throw new Error("resolveCompoundDual requires both pubchem and cactus lookup functions");
	}
	const queriedAt = new Date().toISOString();
	const [pubchemResult, cactusResult] = await Promise.allSettled([pubchemLookup(query), cactusLookup(query)]);
	const pubchem = pubchemResult.status === "fulfilled" ? pubchemResult.value : null;
	const cactus = cactusResult.status === "fulfilled" ? cactusResult.value : null;
	const pubchemRaw = pubchem?.canonicalSmiles ?? pubchem?.smiles;
	const cactusRaw = cactus?.smiles ?? cactus?.canonicalSmiles;

	// 每源化学身份：标准 InChIKey 优先（PubChem property / CACTUS stdinchikey
	// 均为来源方化学工具产出的标准值，可直接用于跨源比较）；缺 key 的一侧才
	// 用本地化学规范化（rdkit/注入 canonizer）兜底；两侧都不可得规范化身份
	// 时绝不把原始字符串相等误判为一致（§6.1）。
	async function chemicalIdentity(raw, knownKey, sourceLabel) {
		if (!raw) return { present: false };
		if (knownKey && /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/.test(String(knownKey).trim())) {
			return { present: true, inchiKey: String(knownKey).trim(), canonicalSmiles: undefined, keyed: true };
		}
		const normalized = await normalizeCanonical(raw, deps);
		if (normalized.status === "ok") {
			return { present: true, inchiKey: normalized.inchiKey, canonicalSmiles: normalized.canonicalSmiles, keyed: false };
		}
		return {
			present: false,
			unavailable: true,
			error: `${sourceLabel} structure lacks a standard InChIKey and local chemical normalization failed: ${normalized.error || "unavailable"}`
		};
	}

	const pubchemIdentity = await chemicalIdentity(pubchemRaw, pubchem?.inchiKey, "PubChem");
	const cactusIdentity = await chemicalIdentity(cactusRaw, cactus?.inchiKey, "CACTUS");

	const sources = {
		pubchem: pubchem
			? {
					smiles: pubchemRaw || undefined,
					canonicalSmiles: pubchemIdentity.present ? (pubchemIdentity.canonicalSmiles ?? pubchemRaw) : undefined,
					inchiKey: pubchem?.inchiKey || pubchemIdentity.inchiKey,
					cid: pubchem.cid,
					casNumber: validCas(pubchem?.casNumber) ? pubchem.casNumber : undefined,
					queryTime: pubchem?.queryTime ?? queriedAt
				}
			: { error: pubchemResult.reason?.message || "not found" },
		cactus: cactus
			? {
					smiles: cactusRaw || undefined,
					canonicalSmiles: cactusIdentity.present ? (cactusIdentity.canonicalSmiles ?? cactusRaw) : undefined,
					inchiKey: cactus?.inchiKey || cactusIdentity.inchiKey,
					queryTime: cactus?.queryTime ?? queriedAt
				}
			: { error: cactusResult.reason?.message || "not found" }
	};

	// CAS：入参本身合法 CAS 优先；否则 PubChem 可追溯 casNumber（校验位验证）
	let casNumber;
	let casSource;
	if (validCas(query)) {
		casNumber = query;
		casSource = "query";
	} else if (pubchem?.casNumber && validCas(pubchem.casNumber)) {
		casNumber = pubchem.casNumber;
		casSource = "pubchem-synonym";
	}

	// 双源都有 SMILES：必须两源都具备化学身份（标准 key 或本地规范化）后比较
	const both = Boolean(pubchemRaw && cactusRaw);
	if (both) {
		const identityOk = pubchemIdentity.present && cactusIdentity.present;
		if (!identityOk) {
			const reason = [pubchemIdentity, cactusIdentity]
				.filter((row) => row?.present === false && row?.unavailable)
				.map((row) => row?.error)
				.filter(Boolean)
				.join("; ") || "dual-source comparison requires a chemical identity for both sources";
			return {
				query,
				casNumber,
				casSource,
				smiles: undefined,
				inchiKey: undefined,
				status: "unresolved",
				queriedAt,
				sources,
				reason
			};
		}
		// ① 标准 InChIKey 优先；② 均无 key 时用本地规范化 canonical SMILES
		const keyA = pubchemIdentity.inchiKey;
		const keyB = cactusIdentity.inchiKey;
		const canonA = pubchemIdentity.canonicalSmiles;
		const canonB = cactusIdentity.canonicalSmiles;
		const same = keyA && keyB ? keyA === keyB : Boolean(canonA && canonB && canonA === canonB);
		const status = same ? "dual-confirmed" : "conflict";
		return {
			query,
			casNumber,
			casSource,
			smiles: same ? (canonA || canonB || pubchemRaw) : undefined,
			inchiKey: same ? (keyA || keyB) : undefined,
			status,
			queriedAt,
			sources
		};
	}

	// 单源（另一源未命中/超时）：返回候选，绝不自动写入
	const only = pubchemRaw || cactusRaw;
	const status = only ? "single-source" : "unresolved";
	return {
		query,
		casNumber,
		casSource,
		smiles: status === "single-source" ? only : undefined,
		inchiKey: pubchem?.inchiKey || cactus?.inchiKey || (status === "single-source" ? (pubchemIdentity.inchiKey || cactusIdentity.inchiKey) : undefined),
		status,
		queriedAt,
		sources
	};
}

export default { CAS_RE, validCas, normalizeStructure, normalizeCanonical, resolveCompoundDual, lookupCactus };
