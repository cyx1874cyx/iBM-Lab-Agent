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

/** 从步骤各来源收集化合物名（去重、保序）。 */
export function collectStepCompoundNames(step) {
	const procedure = step?.procedure ?? {};
	const seen = new Set();
	const names = [];
	const push = (name) => {
		const key = normalizeCompoundName(name);
		if (!key || seen.has(key)) return;
		seen.add(key);
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
	for (const { name } of collectStepCompoundNames(step)) keys.add(normalizeCompoundName(name));
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
		return caseInsensitive ? key.toLowerCase() === target.toLowerCase() : key === target;
	});
}

/**
 * 合并一份结构条目进步骤（按名称去重：新条目覆盖旧条目的 smiles/source/
 * entityId/role，保留旧 updatedAt 以外字段；无则追加）。返回新 structures
 * 数组（不修改入参）。
 */
export function mergeStepStructures(step, additions) {
	const current = asArray(step?.structures).map((row) => ({ ...row }));
	const push = (addition) => {
		if (!addition || !normalizeCompoundName(addition.name)) return;
		const index = current.findIndex((row) => normalizeCompoundName(row.name).toLowerCase() === normalizeCompoundName(addition.name).toLowerCase());
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
	const current = asArray(step?.structures).map((row) => ({ ...row }));
	const has = (name) =>
		current.some((row) => normalizeCompoundName(row.name).toLowerCase() === normalizeCompoundName(name).toLowerCase());
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
		const key = normalizeCompoundName(row.name);
		if (seen.has(key)) continue;
		seen.add(key);
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
		const key = normalizeCompoundName(row.name).toLowerCase();
		if (!key || lookup[key]) continue;
		lookup[key] = row;
	}
	return lookup;
}

export default {
	collectStepCompoundNames,
	knownStepCompoundKeys,
	findStepStructure,
	mergeStepStructures,
	hydrateStepStructures,
	stepMissingStructures,
	structureLookup
};
