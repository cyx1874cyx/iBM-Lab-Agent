/**
 * dsh-lab-agent: RDKit 可选执行器 + PubChem 开放数据查询。
 *
 * RDKit：仅当 venv python 安装了 rdkit 时可用（scripts/rdkit/calc.py）。
 * 不可用时 rdkitProperties() 返回 { available: false }，服务降级为
 * 分子式级计算（src/chemistry/elements.js）——绝不静默给出 SMILES 级数值。
 *
 * PubChem：REST PUG API（无 key 开放数据）；查询结果标记
 * sourceKind: "db-measured"（数据库实测值），区别于 computed/model-predicted。
 * 网络依赖，自动化测试以 stub 代替。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export class RdkitUnavailableError extends Error {
	name = "RdkitUnavailableError";
}

/** 运行 rdkit calc.py；返回 { available, result }。 */
export function runRdkitCalc(venvPython, smiles, { timeoutMs = 30000 } = {}) {
	const script = fileURLToPath(new URL("../../scripts/rdkit/calc.py", import.meta.url));
	const python = venvPython && existsSync(venvPython) ? venvPython : "python3";
	return new Promise((resolve) => {
		const child = spawn(python, [script], {
			env: { ...process.env },
			stdio: ["pipe", "pipe", "pipe"],
			shell: process.platform === "win32"
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
 * @returns { cid?, formula?, molecularWeight?, canonicalSmiles?, iupacName? } 或抛错
 */
export async function lookupPubChem(name, { fetchImpl = fetch } = {}) {
	const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName/JSON`;
	const response = await fetchImpl(url);
	if (!response.ok) {
		throw new Error(`PubChem lookup failed (${response.status}) for '${name}'`);
	}
	const body = await response.json();
	const props = body?.PropertyTable?.Properties?.[0];
	if (!props) throw new Error(`PubChem returned no properties for '${name}'`);
	return {
		cid: props.CID,
		formula: props.MolecularFormula,
		molecularWeight: props.MolecularWeight,
		canonicalSmiles: props.CanonicalSMILES,
		iupacName: props.IUPACName
	};
}
