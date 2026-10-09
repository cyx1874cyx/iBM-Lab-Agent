"""Read-only Windows-shell acceptance using an explicitly synthetic FID copy."""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True, help="Existing synthetic .fid directory")
parser.add_argument("--provenance", required=True, help="simulation_metadata.json")
parser.add_argument("--output", required=True)
parser.add_argument("--through-mcp", action="store_true", help="Use the product's owned-process guardian and real MCP stdio")
parser.add_argument("--installed-package", action="store_true", help="Verify the bundled installed module without a source override")
args = parser.parse_args()
source = Path(args.input).resolve()
output = Path(args.output).resolve()
provenance = json.loads(Path(args.provenance).read_text(encoding="utf-8"))
assert provenance.get("synthetic") is True, "Acceptance uses synthetic data only"
assert not output.exists(), "Use a new output directory"
assert output != source and source not in output.parents
output.mkdir(parents=True)
dataset = output / "synthetic.fid"
shutil.copytree(source, dataset)
shutil.copy2(args.provenance, output / "simulation_metadata.json")

def hashes(path):
    return {str(file.relative_to(path)): hashlib.sha256(file.read_bytes()).hexdigest()
            for file in sorted(path.rglob("*")) if file.is_file()}

before = hashes(dataset)
original = hashes(source)
root = Path(__file__).resolve().parents[2]
if not args.installed_package:
    sys.path.insert(0, str(root / "vendor/mnova-mcp/src"))
else:
    import mnova_mcp
    assert Path(mnova_mcp.__file__).resolve().is_relative_to(Path(sys.prefix).resolve()), "Expected the bundled installed Mnova package"
from mnova_mcp.config import Settings
from mnova_mcp.runner import probe_runtime, status
import numpy
import scipy
import matplotlib
import nmrglue

_, data = nmrglue.varian.read(str(dataset))
os.environ["MNOVA_MCP_WORKSPACE"] = str(output)
os.environ["MNOVA_MCP_OUTPUT_ROOT"] = str(output / "mnova-output")
os.environ["MNOVA_MCP_RUNTIME_ROOT"] = str(output / "mnova-runtime")
settings = Settings.from_environment()
report = {"ok": False, "synthetic": True, "python": sys.executable,
          "pythonVersion": sys.version.split()[0], "reader": "nmrglue.varian",
          "dataShape": list(data.shape), "launch": status(settings)}

async def managed_probe():
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    module_args = (["-m", "mnova_mcp"] if args.installed_package else
                   ["-c", "import sys;sys.path.insert(0,sys.argv[1]);from mnova_mcp.server import main;main()",
                    str(root / "vendor/mnova-mcp/src")])
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-I", str(root / "scripts/runtime/owned_process.py"), sys.executable,
              "-I", *module_args],
        cwd=str(output),
        env={key: str(value) for key, value in {
            "MNOVA_MCP_WORKSPACE": output, "MNOVA_MCP_OUTPUT_ROOT": settings.output_root,
            "MNOVA_MCP_RUNTIME_ROOT": output / "mnova-runtime",
        }.items()},
    )
    async with stdio_client(parameters) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            tools = await session.list_tools()
            assert "mnova_probe_runtime" in [tool.name for tool in tools.tools]
            result = await session.call_tool("mnova_probe_runtime", {"input_path": str(dataset)})
            assert not result.isError, result.content
            report["managedMcpGuardian"] = True
            return result.structuredContent or json.loads(result.content[0].text)
started = time.monotonic()
try:
    assert report["launch"]["launch_channel"] == "windows-shell"
    response = asyncio.run(managed_probe()) if args.through_mcp else probe_runtime(str(dataset), settings)
    assert response["nmr_type"] == "object"
    assert response["open_fid"] is True
    assert hashes(dataset) == before
    assert hashes(source) == original
    assert not list((output / "mnova-output").rglob("*.mnova"))
    assert not list((output / "mnova-output").rglob("*.pdf"))
    report.update(ok=True, probe=response,
                  checks=["windows-shell-launch", "nmr-module-object", "fid-open-true",
                          "raw-inputs-unchanged", "no-processing-or-document-export"])
except Exception as error:
    report["error"] = str(error)
    raise
finally:
    report["elapsedSeconds"] = round(time.monotonic() - started, 3)
    (output / "verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("ok", "elapsedSeconds")}, ensure_ascii=False))
