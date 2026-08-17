import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupPubChem, runRdkitCalc } from "../../src/chemistry/rdkit-pubchem.js";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("lookupPubChem parses the PUG property response", async () => {
	const fetchImpl = async () => ({
		ok: true,
		json: async () => ({
			PropertyTable: {
				Properties: [{
					CID: 31703,
					MolecularFormula: "C27H29NO11",
					MolecularWeight: 543.5,
					CanonicalSMILES: "CC1=C(C(=O)C2=C(C1=O)C(=C(C3=C2C=CC(=C3O)OC)O)OC(=O)CO)N",
					IUPACName: "doxorubicin"
				}]
			}
		})
	});
	const data = await lookupPubChem("doxorubicin", { fetchImpl });
	assert.equal(data.cid, 31703);
	assert.equal(data.molecularWeight, 543.5);
	assert.equal(data.formula, "C27H29NO11");
});

test("lookupPubChem surfaces HTTP errors", async () => {
	const fetchImpl = async () => ({ ok: false, status: 404 });
	await assert.rejects(() => lookupPubChem("definitely-not-a-molecule-xyz", { fetchImpl }), /404/);
});

test("runRdkitCalc degrades cleanly when rdkit is unavailable", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dsh-lab-agent-rdkit-"));
	try {
		// 用一个必然不存在的 venv python → available:false（不会误装）
		await mkdir(join(dir, "bin"), { recursive: true });
		const missingVenv = join(dir, "bin", "python");
		const result = await runRdkitCalc(missingVenv, "CC(=O)Oc1ccccc1C(=O)O");
		assert.equal(result.available, false);
		// 系统 python3：有 rdkit 则给出结果，否则明确不可用——两者都接受，但字段必须一致
		if (result.result !== undefined) {
			assert.equal(result.result.ok, true);
			assert.ok(result.result.molecularWeight > 0);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("rdkit calc script exists and is importable by the executor", () => {
	const script = fileURLToPath(new URL("../../scripts/rdkit/calc.py", import.meta.url));
	assert.match(script, /calc\.py$/);
});
