/**
 * dsh-lab-agent: 化合物名称 → SMILES 解析（纯逻辑层，0.3.2）。
 *
 * 目标：实验条件区的反应物/产物/试剂在缺 structures.smiles 时，可由名称
 * 自动解析补全（首选 PubChem 开放数据），解析失败保持“待补绘”，绝不臆造
 * 结构。解析函数不依赖具体网络实现，lookup 由调用方注入（服务层注入
 * lookupPubChem；单测注入 stub），保证离线可测。
 *
 * 原则（与 0.3.0 工作台一致）：不静默填默认值、不把模型猜测当事实；
 * 解析结果只做候选，人工仍可在 Ketcher 中复核/修正后回写（source=manual）。
 */

/**
 * 过滤不适合作名称解析的条目：无名称、已有 smiles（含标记性占位）、
 * 含聚合物前缀等（解析库小分子即可，聚合度不参与 PubChem 查询）。
 * @param names string[]
 * @returns string[] 需要解析的名称（去重、保序、归一化）
 */
export function namesNeedingResolve(names, { hasSmiles = () => false } = {}) {
	const seen = new Set();
	const pending = [];
	for (const raw of names ?? []) {
		const name = String(raw ?? "")
			.replace(/\s+/g, " ")
			.trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		if (hasSmiles(name)) continue;
		pending.push(name);
	}
	return pending;
}

/**
 * 逐个名称调用 lookup(name) 解析 SMILES。
 * @param names string[]
 * @param lookup async (name) => ({ canonicalSmiles?, cid? }) 或抛错
 * @returns { resolved: [{name, smiles, cid?}], failed: [{name, reason}] }
 */
export async function resolveSmilesByNames(names, lookup) {
	const resolved = [];
	const failed = [];
	for (const name of names ?? []) {
		try {
			const result = await lookup(name);
			const smiles = result?.canonicalSmiles ?? result?.smiles;
			if (smiles) resolved.push({ name, smiles, cid: result?.cid });
			else failed.push({ name, reason: "PubChem 无 CanonicalSMILES" });
		} catch (error) {
			failed.push({ name, reason: error?.message || String(error) });
		}
	}
	return { resolved, failed };
}

export default { namesNeedingResolve, resolveSmilesByNames };
