"""Archive already installed dependency files without executing package lifecycle scripts."""
import pathlib
import sys
import tarfile

source = pathlib.Path(sys.argv[1]).resolve(strict=True)
target = pathlib.Path(sys.argv[2]).resolve()
assert (source / "package.json").is_file()
with tarfile.open(target, "w:gz", dereference=True) as archive:
    for item in sorted(source.rglob("*")):
        relative = item.relative_to(source)
        if any(part in {"node_modules", ".git", "__pycache__"} for part in relative.parts):
            continue
        if item.is_symlink():
            raise RuntimeError(f"Unexpected symlink in installed package: {relative}")
        if item.is_file():
            archive.add(item, arcname="package/" + relative.as_posix(), recursive=False)
