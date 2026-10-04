"""Read-only verification of the full pinned dependency archive set before installation."""
import hashlib
import json
import pathlib
import sys
import tarfile

root = pathlib.Path(sys.argv[1]).resolve(strict=True)
release = json.loads((root / "release-archives.json").read_text(encoding="utf-8"))
assert release["ok"]
seen = set()
for row in release["packages"]:
    path = pathlib.Path(row["path"]).resolve(strict=True)
    assert path.parent == root
    assert path.stat().st_size == row["bytes"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"]
    assert row["name"] not in seen
    seen.add(row["name"])
    with tarfile.open(path) as archive:
        for member in archive.getmembers():
            parts = pathlib.PurePosixPath(member.name).parts
            assert parts and parts[0] == "package" and ".." not in parts
            assert not pathlib.PurePosixPath(member.name).is_absolute()
            assert member.isfile() or member.isdir(), "Unsupported archive link: " + member.name
            if member.isfile() and member.name.endswith("package.json"):
                json.load(archive.extractfile(member))
        manifest = json.load(archive.extractfile("package/package.json"))
        assert manifest["name"] == row["name"] and manifest["version"] == row["version"]
        if row["name"].startswith("@deepseek-ai/dsh-"):
            assert row["version"] == "0.2.0-rc.2"
        if row["name"] == "@deepseek-ai/cordis":
            assert row["version"] == "4.0.4"
assert all("dsh-lab-" + name in seen for name in ["agent", "core", "runtime", "documents", "literature", "design", "analysis", "ui"])
report = {"ok": True, "archives": len(seen), "scope": "Content, manifest, path, link and fixed kernel checks; not an installation result"}
(root / "archive-verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
