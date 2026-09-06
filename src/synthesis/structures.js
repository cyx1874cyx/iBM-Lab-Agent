/**
 * dsh-lab-agent: 合成路线 Step 化合物结构条目逻辑（纯规则层，0.3.2）。
 *
 * 背景：步骤 legacy reactants/products/reagents 是字符串数组（quick
 * display）；procedure.reagents/catalysts 是结构化对象。为在实验条件区把
 * 反应物/产物/试剂按名称显示结构式（Ketcher 渲染）并支持补绘，routeStep
 * 新增可选 structures[]（见 src/synthesis/models.js stepStructureSchema）。
 *
 * 本文件只做：名称收集（把 legacy + procedure 的名字并出去重）、按名称
 * 合并/更新结构条目、lazy hydrate（读取时为每个已知化合物名补一个
 * 占位条目，缺 smiles 由 UI 标记“待补绘/解析”，不写回存储）。
 * 不依赖网络、不依赖 LLM、不操作存储，便于单测与回归。
 */

const asArray = (value) => (Array.isArray(value) ? value : []);

/** 名称归一化：去首尾空白、折叠内部空白（大小写敏感度由调用方定）。 */
export function normalizeCompoundName(name) {
	return String(name ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * 名称匹配键：完整名称之外，把“英文名（中文名）/简称（系统名）”末尾的
 * 括号别名拆出基名。结构条目常由 PubChem 使用英文短名登记，而原文反应物
 * 会保留括号别名；二者应视为同一展示项。化学名内部的括号（如
 * 2-(hydroxyethyl)）不会被截断，因为右括号后仍有正文。
 */
export function compoundNameKeys(name) {
	const normalized = normalizeCompoundName(name);
	if (!normalized) return [];
	const keyOf = (value) => normalizeCompoundName(value)
		.toLowerCase()
		.replace(/[’‘`]/g, "'")
		.replace(/[‐‑‒–—−]/g, "-");
	const keys = [keyOf(normalized)];
	const opener = normalized.search(/[（(【[]/u);
	const endsWithCloser = /[）)】\]]$/u.test(normalized);
	if (opener > 0 && endsWithCloser) {
		const base = normalizeCompoundName(normalized.slice(0, opener));
		const unsafeBase = /^(?:poly|copolymer|compound|product|intermediate)$/i.test(base);
		if (base.length >= 3 && !unsafeBase) keys.push(keyOf(base));
	}
	return [...new Set(keys.filter(Boolean))];
}

/** 完整名或末尾括号别名的基名一致，即视为同一化合物展示项。 */
export function compoundNamesEquivalent(left, right) {
	const rightKeys = new Set(compoundNameKeys(right));
	return compoundNameKeys(left).some((key) => rightKeys.has(key));
}

/**
 * 清理历史 structures 中的“已解析短名 + 未解析括号别名”重复项。仅在至少
 * 一方无结构或两方 SMILES 相同时合并；两个不同结构绝不静默折叠。
 */
export function dedupeStepStructures(rows) {
	const result = [];
	for (const source of asArray(rows)) {
		if (!source || !normalizeCompoundName(source.name)) continue;
		const row = { ...source };
		const index = result.findIndex((item) => compoundNamesEquivalent(item.name, row.name)
			&& (!item.smiles || !row.smiles || item.smiles === row.smiles));
		if (index < 0) {
			result.push(row);
			continue;
		}
		const existing = result[index];
		const primary = row.smiles && !existing.smiles ? row : existing;
		const secondary = primary === existing ? row : existing;
		result[index] = {
			...secondary,
			...primary,
			name: primary.name,
			role: primary.role && primary.role !== "unknown" ? primary.role : (secondary.role ?? "unknown")
		};
	}
	return result;
}

/** 从步骤各来源收集化合物名（去重、保序）。 */
export function collectStepCompoundNames(step) {
	const procedure = step?.procedure ?? {};
	const names = [];
	const push = (name) => {
		const key = normalizeCompoundName(name);
		if (!key || names.some((item) => compoundNamesEquivalent(item.name, key))) return;
		names.push({ name: key });
	};
	for (const name of asArray(step?.reactants)) push(name);
	for (const name of asArray(step?.products)) push(name);
	for (const name of asArray(step?.reagents)) push(name);
	for (const reagent of asArray(procedure.reagents)) push(reagent?.name);
	for (const catalyst of asArray(procedure.catalysts)) push(catalyst?.name);
	return names;
}

/** 步骤里“已知化合物名集合”（归一化后），供匹配 structures 使用。 */
export function knownStepCompoundKeys(step) {
	const keys = new Set();
	for (const { name } of collectStepCompoundNames(step)) {
		for (const key of compoundNameKeys(name)) keys.add(key);
	}
	return keys;
}

/**
 * 按名称（归一化、不区分大小写）查找步骤 structures 条目。
 * @returns 条目副本或 undefined
 */
export function findStepStructure(step, name, { caseInsensitive = true } = {}) {
	const target = normalizeCompoundName(name);
	return asArray(step?.structures).find((row) => {
		const key = normalizeCompoundName(row?.name);
		return caseInsensitive ? compoundNamesEquivalent(key, target) : key === target;
	});
}

/**
 * 合并一份结构条目进步骤（按名称去重：新条目覆盖旧条目的 smiles/source/
 * entityId/role，保留旧 updatedAt 以外字段；无则追加）。返回新 structures
 * 数组（不修改入参）。
 */
export function mergeStepStructures(step, additions) {
	const current = dedupeStepStructures(step?.structures);
	const push = (addition) => {
		if (!addition || !normalizeCompoundName(addition.name)) return;
		const index = current.findIndex((row) => compoundNamesEquivalent(row.name, addition.name));
		if (index >= 0) {
			current[index] = {
				...current[index],
				...addition,
				name: current[index].name,
				updatedAt: addition.updatedAt ?? current[index].updatedAt ?? new Date().toISOString()
			};
		} else {
			current.push({ ...addition, updatedAt: addition.updatedAt ?? new Date().toISOString() });
		}
	};
	for (const addition of asArray(additions)) push(addition);
	return current;
}

/**
 * Lazy hydrate：为步骤里每个已知化合物名保证一个 structures 条目（缺失补
 * 占位，role 按来源推断；不覆盖已有 smiles/source/entityId）。
 * @returns 新 structures 数组（不写回存储）
 */
export function hydrateStepStructures(step) {
	const current = dedupeStepStructures(step?.structures);
	const has = (name) =>
		current.some((row) => compoundNamesEquivalent(row.name, name));
	const procedure = step?.procedure ?? {};
	// 推断角色：reactants 全部为 reactant；products 全部为 product；其余 reagent。
	const roleFor = (bucket) => (bucket === "reactants" ? "reactant" : bucket === "products" ? "product" : "reagent");
	const buckets = [
		["reactants", asArray(step?.reactants)],
		["products", asArray(step?.products)],
		["reagents", asArray(step?.reagents)],
		["procedure.reagents", asArray(procedure.reagents).map((r) => r?.name)],
		["procedure.catalysts", asArray(procedure.catalysts).map((r) => r?.name)]
	];
	for (const [bucket, names] of buckets) {
		for (const raw of names) {
			const name = normalizeCompoundName(raw);
			if (!name || has(name)) continue;
			current.push({ name, role: roleFor(bucket), source: "agent" });
		}
	}
	// 保留已知名集合之外的旧条目（人工改过名等），保持不丢数据。
	return current;
}

/**
 * 结构完整性：步骤中缺 SMILES 的化合物名（UI 显示“待补绘/解析”）。
 * @returns { missing: string[], total: number }（missing 归一化、保序）
 */
export function stepMissingStructures(step) {
	const hydrated = hydrateStepStructures(step);
	const missing = [];
	const seen = new Set();
	for (const row of hydrated) {
		const keys = compoundNameKeys(row.name);
		if (keys.some((key) => seen.has(key))) continue;
		for (const key of keys) seen.add(key);
		if (!row.smiles) missing.push(row.name);
	}
	return { missing, total: hydrated.length };
}

/** 从步骤 structures 构建 name→smiles 查询表（key 小写，供前端渲染/匹配）。
 *  兼容传 step 对象（读 .structures）或直接传 structures 数组。 */
export function structureLookup(stepOrRows) {
	const rows = Array.isArray(stepOrRows) ? stepOrRows : asArray(stepOrRows?.structures);
	const lookup = {};
	for (const row of rows) {
		for (const key of compoundNameKeys(row.name)) {
			if (!key || lookup[key]) continue;
			lookup[key] = row;
		}
	}
	return lookup;
}

export default {
	collectStepCompoundNames,
	compoundNameKeys,
	compoundNamesEquivalent,
	dedupeStepStructures,
	knownStepCompoundKeys,
	findStepStructure,
	mergeStepStructures,
	hydrateStepStructures,
	stepMissingStructures,
	structureLookup
};
