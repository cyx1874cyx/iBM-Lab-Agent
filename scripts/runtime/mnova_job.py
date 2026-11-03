"""Fixed desktop tool dispatcher; uses the installed Mnova bridge unchanged."""
import json
import os
import sys
from pathlib import Path
vendored = Path(__file__).resolve().parents[2] / 'vendor' / 'mnova-mcp' / 'src'
if (vendored / 'mnova_mcp' / 'runner.py').is_file():
    sys.path.insert(0, str(vendored))
from mnova_mcp import runner

OPERATIONS = {
    'mnova_status': runner.status,
    'mnova_probe_runtime': runner.probe_runtime,
    'mnova_process_1d': runner.process_1d,
    'mnova_prepare_structure_1d': runner.prepare_structure_1d,
    'mnova_apply_assignments_1d': runner.apply_assignments_1d,
}

try:
    arguments = json.loads(sys.argv[2])
    is_synthetic = sys.argv[1] == 'mnova_prepare_structure_1d' and 'synthetic_1d.fid' in str(arguments.get('input_path', '')).lower()
    if sys.argv[1] == 'mnova_apply_assignments_1d':
        plan_path = Path(arguments.get('assignment_plan_path', ''))
        if plan_path.is_file():
            is_synthetic = json.loads(plan_path.read_text(encoding='utf-8')).get('synthetic') is True
    if is_synthetic:
        bridge = Path(__file__).resolve().parents[2] / 'vendor' / 'mnova-mcp' / 'src' / 'mnova_mcp' / 'assets' / 'bridge.qs'
        if not bridge.is_file():
            raise RuntimeError('模拟谱专用 Mnova 桥接脚本缺失')
        if 'IBM_SYNTHETIC_FID_BRIDGE_V1' not in bridge.read_text(encoding='utf-8'):
            raise RuntimeError('模拟谱 Mnova 桥接脚本版本过旧，请重启开发版以同步更新')
        os.environ['MNOVA_MCP_BRIDGE_SCRIPT'] = str(bridge)
    result = OPERATIONS[sys.argv[1]](**arguments)
    print(json.dumps({'ok': True, 'result': result}, ensure_ascii=True))
except Exception as error:
    print(json.dumps({'ok': False, 'error': str(error), 'errorType': type(error).__name__}, ensure_ascii=True))
    sys.exit(1)
