"""Build an offline, relocatable Python resource from an already pinned runtime."""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--seal-existing', action='store_true', help='Verify and hash an already prepared resource without copying')
args = parser.parse_args()
source, output = Path(args.source).resolve(), Path(args.output).resolve()
if output.exists() and not args.seal_existing:
    raise SystemExit('Refusing to overwrite an existing Python resource')
if output == source or source in output.parents:
    raise SystemExit('Resource output must be separate from its source')
facts = json.loads(subprocess.check_output([str(source), '-I', '-c',
    'import json,sys,sysconfig;print(json.dumps(dict(version=list(sys.version_info[:3]),base=sys.base_prefix,packages=sysconfig.get_path("purelib"))))'], text=True))
assert facts['version'] == [3, 12, 11], facts['version']
if not args.seal_existing:
    shutil.copytree(facts['base'], output, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    shutil.copytree(facts['packages'], output / 'Lib/site-packages', dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
python = output / 'python.exe'
probe = subprocess.check_output([str(python), '-I', '-c',
    'import sys,numpy,pymupdf,pptx,mcp,origin_mcp,mnova_mcp;assert sys.version_info[:3]==(3,12,11);assert all(m.__file__.startswith(sys.prefix) for m in [numpy,pymupdf,pptx,mcp,origin_mcp,mnova_mcp]);print(sys.prefix)'], text=True).strip()
assert Path(probe).resolve() == output, probe
root = Path(__file__).resolve().parents[2]
manifest = {'version': 1, 'python': '3.12.11', 'platform': 'windows-x64',
            'requirementsSha256': hashlib.sha256((root/'python/requirements.lock').read_bytes()).hexdigest(),
            'nativeRequirementsSha256': hashlib.sha256((root/'python/requirements-electron-native.lock').read_bytes()).hexdigest(),
            'files': [{'path': str(p.relative_to(output)).replace('\\', '/'), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                      for p in sorted(output.rglob('*')) if p.is_file() and p.name != 'resource-manifest.json' and '__pycache__' not in p.parts and p.suffix != '.pyc']}
(output/'resource-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'ok': True, 'python': str(python), 'files': len(manifest['files'])}))
