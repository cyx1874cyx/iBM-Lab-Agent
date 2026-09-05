/**
 * dsh-lab-agent: RDKit 可选执行器 + PubChem 开放数据查询。
 *
 * RDKit：仅当 venv python 安装了 rdkit 时可用（scripts/rdkit/calc.py）。
 * 不可用时 rdkitProperties() 返回 { available: false }，服务降级为
 * 分子式级计算（src/chemistry/elements.js）——绝不静默给出 SMILES 级数值。
 *
 * P1-2：解释器经统一 resolver 解析（venv → bundled → py -3.11/-3 → python），
 * Windows 上不再回退到不存在的 "python3"。
 *
 * PubChem：REST PUG API（无 key 开放数据）；查询结果标记
 * sourceKind: "db-measured"（数据库实测值），区别于 computed/model-predicted。
 * 网络依赖，自动化测试以 stub 代替。
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bundledPythonFromEnv, resolvePythonExecutable } from "../python-env.js";

export class RdkitUnavailableError extends Error {
	name = "RdkitUnavailableError";
}

/** 运行 rdkit calc.py；返回 { available, result }。 */
export async function runRdkitCalc(venvPython, smiles, { timeoutMs = 30000, platform = process.platform } = {}) {
	const script = fileURLToPath(new URL("../../scripts/rdkit/calc.py", import.meta.url));
	const resolved = await resolvePythonExecutable({ venvPython, bundledPython: bundledPythonFromEnv(), platform });
	if (!resolved.command) {
		return { available: false, result: undefined, error: "no python available (venv missing and no py/python on PATH)" };
	}
	const command = resolved.command;
	return new Promise((resolve) => {
		const child = spawn(command[0], [...command.slice(1), script], {
			env: { ...process.env },
			stdio: ["pipe", "pipe", "pipe"]
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve({ available: false, result: undefined, error: "rdkit calc timed out" });
		}, timeoutMs);
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ available: false, result: undefined, error: error.message });
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			if (code === 2) {
				resolve({ available: false, result: undefined, error: "rdkit not installed in python" });
				return;
			}
			try {
				const result = JSON.parse(stdout);
				resolve({ available: true, result, error: undefined });
			} catch {
				resolve({ available: true, result: undefined, error: `rdkit calc output not JSON: ${(stdout || stderr).slice(0, 200)}` });
			}
		});
		child.stdin.end(JSON.stringify({ smiles }));
	});
}

/**
 * PubChem 名称 → 属性查询（PUG REST，开放数据）。
 * 0.4.0-rc.4（§6.3）：独立超时，失败不无限阻塞。
 * @returns { cid?, formula?, molecularWeight?, canonicalSmiles?, inchiKey?, iupacName? } 或抛错
 */
export async function lookupPubChem(name, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
	const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/MolecularFormula,MolecularWeight,CanonicalSMILES,InChIKey,IUPACName/JSON`;
	const attempt = await fetchWithTimeout(fetchImpl, url, { timeoutMs, label: "PubChem" });
	if (!attempt.ok) throw new Error(attempt.error);
	const props = attempt.body?.PropertyTable?.Properties?.[0];
	if (!props) throw new Error(`PubChem returned no properties for '${name}'`);
	return {
		cid: props.CID,
		formula: props.MolecularFormula,
		molecularWeight: props.MolecularWeight,
		canonicalSmiles: props.CanonicalSMILES,
		inchiKey: props.InChIKey,
		iupacName: props.IUPACName,
		queryTime: new Date().toISOString()
	};
}

/**
 * 0.4.0-rc.4（§6.2）：PubChem 名称查询成功后，再查该 CID 的 synonyms，
 * 从可验证的同义词中筛出满足 CAS 校验位的编号（casSource=pubchem-synonym）。
 * PUG property 请求不返回 CAS；synonyms 中同一化合物可能出现多个 CAS（盐、
 * 别名），按“校验位正确”白名单筛选后取第一个。
 * @returns { casNumber?, casSource?, cid? } 或抛错（synonyms 查询本身失败）
 */
export async function lookupPubChemCas(name, { fetchImpl = fetch, timeoutMs = 15000, cid } = {}) {
	const { validCas } = await import("../synthesis/compound-resolve.js");
	let resolvedCid = cid;
	if (resolvedCid === undefined) {
		const props = await lookupPubChem(name, { fetchImpl, timeoutMs });
		resolvedCid = props.cid;
	}
	if (resolvedCid === undefined) throw new Error(`PubChem returned no CID for '${name}'`);
	const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${resolvedCid}/synonyms/JSON`;
	const attempt = await fetchWithTimeout(fetchImpl, url, { timeoutMs, label: "PubChem synonyms" });
	if (!attempt.ok) throw new Error(attempt.error);
	const synonyms = attempt.body?.InformationList?.Information?.[0]?.Synonym ?? [];
	const cas = synonyms.find((row) => validCas(row));
	if (!cas) return { casNumber: undefined, casSource: undefined, cid: resolvedCid, queriedAt: new Date().toISOString() };
	return { casNumber: String(cas), casSource: "pubchem-synonym", cid: resolvedCid, queriedAt: new Date().toISOString() };
}

/** 带超时的 JSON fetch（§6.3 独立超时降级）。 */
async function fetchWithTimeout(fetchImpl, url, { timeoutMs = 15000, label = "request" } = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchImpl(url, { signal: controller.signal });
		if (!response.ok) return { ok: false, error: `${label} lookup failed (${response.status})` };
		let body;
		try {
			body = await response.json();
		} catch {
			body = undefined;
		}
		return { ok: true, body };
	} catch (error) {
		if (error?.name === "AbortError") return { ok: false, error: `${label} lookup timed out after ${timeoutMs}ms` };
		return { ok: false, error: `${label} lookup failed: ${error?.message || String(error)}` };
	} finally {
		clearTimeout(timer);
	}
}
