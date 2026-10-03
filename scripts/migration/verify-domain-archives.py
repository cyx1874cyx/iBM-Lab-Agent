"""Read-only local bundle archive validation; never extracts files or reads user profiles."""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument("--directory", required=True, type=Path)
args = parser.parse_args()
report = {"phase": "P5", "scope": "bundle archive structure, not installation", "ok": False, "packages": []}
ids = set()
for domain in ("core", "runtime", "documents", "literature", "design", "analysis", "ui"):
    path = args.directory / f"dsh-lab-{domain}-0.5.8-rc.1.tgz"
    with tarfile.open(path, "r:gz") as archive:
        names = set(archive.getnames())
        manifest = json.load(archive.extractfile("package/package.json"))
        assert manifest["name"] == f"dsh-lab-{domain}"
        assert manifest["version"] == "0.5.8-rc.1"
        assert manifest["dependencies"] == {"dsh-lab-agent": "0.5.8-rc.1"}
        for exported in manifest["exports"].values():
            assert "package/" + exported.removeprefix("./") in names, exported
        for patch in manifest["dsh"]["bundle"]["patch"]:
            assert "package/" + patch.removeprefix("./") in names
        text = archive.extractfile("package/cordis.patch.yml").read().decode()
        for line in text.splitlines():
            if line.startswith("    - id: "):
                identity = line.removeprefix("    - id: ")
                assert identity not in ids, f"Duplicate provider: {identity}"
                ids.add(identity)
        assert not any("node_modules/" in name for name in names)
    data = path.read_bytes()
    report["packages"].append({"name": manifest["name"], "path": path.resolve().as_posix(),
                               "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
report["uniqueHostRows"] = len(ids)
report["ok"] = True
(args.directory / "verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(f"Seven archives verified, {len(ids)} unique Host rows; shared implementation remains a separate dependency.")
