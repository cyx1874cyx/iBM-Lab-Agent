#!/usr/bin/env python3
"""dsh-lab-agent RDKit property calculator (optional; requires rdkit in the venv).

Input:  JSON via --input file or stdin: {"smiles": "...", "formula": "..."}
Output: JSON: {"ok": true, "canonicalSmiles", "molecularWeight", "logP",
               "tpsa", "hbd", "hba", "formula"} or {"ok": false, "error": "..."}

Exit codes: 0 ok, 1 compute error, 2 rdkit unavailable.
"""
import json
import sys


def main() -> int:
    try:
        import rdkit  # noqa: F401
        from rdkit import Chem
        from rdkit.Chem import Crippen, Descriptors, rdMolDescriptors
    except ImportError:
        print(json.dumps({"ok": False, "error": "rdkit is not installed in this python"}))
        return 2

    try:
        payload = json.loads(sys.stdin.read())
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": f"bad input JSON: {exc}"}))
        return 1

    smiles = payload.get("smiles")
    if not smiles:
        print(json.dumps({"ok": False, "error": "missing 'smiles'"}))
        return 1

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        print(json.dumps({"ok": False, "error": f"unparseable SMILES: {smiles}"}))
        return 1

    canon = Chem.MolToSmiles(mol)
    result = {
        "ok": True,
        "canonicalSmiles": canon,
        "molecularWeight": round(Descriptors.MolWt(mol), 3),
        "logP": round(Crippen.MolLogP(mol), 3),
        "tpsa": round(rdMolDescriptors.CalcTPSA(mol), 3),
        "hbd": rdMolDescriptors.CalcNumHBD(mol),
        "hba": rdMolDescriptors.CalcNumHBA(mol),
        "formula": rdMolDescriptors.CalcMolFormula(mol),
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
