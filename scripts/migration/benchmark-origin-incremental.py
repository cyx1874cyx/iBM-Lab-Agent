"""Benchmark edits to one owned Origin graph; restore the user's context."""
import argparse
import asyncio
import hashlib
import json
import os
import re
import time
import uuid
from pathlib import Path

os.environ.setdefault('ORIGIN_MCP_TOOL_PROFILE', 'full')
import origin_mcp.server  # noqa: F401
from origin_mcp.tools._shared import mcp
from PIL import Image, ImageChops


async def call(tool_name, **fields):
    result = await mcp.call_tool(tool_name, fields)
    body = result[1] if isinstance(result, tuple) and len(result) > 1 else None
    if body is None:
        body = json.loads(next(block.text for block in result[0] if hasattr(block, 'text')))
    if not body.get('ok'):
        raise RuntimeError(body.get('message') or body.get('error') or tool_name)
    return body.get('data', {})


def fingerprint(path):
    with Image.open(path) as image:
        image = image.convert('RGBA')
        return {'size': list(image.size), 'sha256': hashlib.sha256(image.tobytes()).hexdigest()}


def changed_pixels(first, second):
    with Image.open(first) as a, Image.open(second) as b:
        a, b = a.convert('RGB'), b.convert('RGB')
        if a.size != b.size:
            return None
        return sum(1 for pixel in ImageChops.difference(a, b).getdata() if pixel != (0, 0, 0))


async def main(output):
    output.mkdir(parents=True, exist_ok=True)
    data = output / 'data.csv'
    data.write_text('Time,Signal\n0,2\n1,3\n2,5\n3,6\n4,8\n', encoding='utf-8')
    original = (await call('origin_list_project_folder'))['folder']['path']
    active = await call('origin_run_labtalk', script='type "IBM_ACTIVE=%H";', capture_log=True)
    window = next((line.split('=', 1)[1] for line in active.get('message_log', {}).get('lines', []) if line.startswith('IBM_ACTIVE=')), '')
    folder = None
    report = {'operations': []}
    try:
        start = time.perf_counter()
        graph = 'iBMInc' + uuid.uuid4().hex[:10]
        folder = await call('origin_create_project_folder', name=graph, activate=True, reuse_existing=False)
        plotted = await call('origin_plot', path=str(data), graph_name=graph, title='', kind='line', selected_cols=[0, 1], style_mode='origin_default')
        graph = plotted['graph']['graph_name']
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', graph):
            raise ValueError('Invalid graph name')
        await call('origin_format_graph', graph_name=graph, x_label='Time (s)', y_label='Signal', show_legend=True, rescale=True)
        await call('origin_set_plot_style', graph_name=graph, plot_index=0, line_width=1)
        await call('origin_run_labtalk', script=f'win -a {graph}; layer.unit=3; layer.width=9; layer.height=8; layer.fixed=0; xb.fsize=24; legend.x=layer.x.from+.7*(layer.x.to-layer.x.from); doc -uw; pfit2l margin:=border borderwid:=5 go:=1; draw -uwi;')
        async def export(path):
            destination = str(output).replace('\\', '/')
            if '"' in destination or '"' in path.stem:
                raise ValueError('Invalid export path')
            await call('origin_run_labtalk', script=f'win -o {graph} {{expGraph -sw tr1.width:=900 tr1.unit:=2 type:=png path:="{destination}" filename:="{path.stem}" overwrite:=replace;}};')
        baseline = output / 'baseline.png'
        await export(baseline)
        report['initialSetupMs'] = round((time.perf_counter() - start) * 1000)
        report['baseline'] = fingerprint(baseline)
        # Only fixed, local test commands are used; no user text is executed.
        changes = [
            ('axis_title_font', 'xb.fsize=32;', 'xb.fsize=24;'),
            ('legend_position', 'legend.x=layer.x.from+.4*(layer.x.to-layer.x.from);', 'legend.x=layer.x.from+.7*(layer.x.to-layer.x.from);'),
            ('line_width', 5, 1),
        ]
        # Establish each operation's own pre-edit image. Restoring title/legend
        # can itself trigger Origin layout, so do not compare unrelated steps.
        for index, (name, edit, undo) in enumerate(changes):
            before = output / f'{index}-before.png'
            changed = output / f'{index}-changed.png'
            restored = output / f'{index}-restored.png'
            await export(before)
            start = time.perf_counter()
            if name == 'line_width':
                await call('origin_set_plot_style', graph_name=graph, plot_index=0, line_width=edit)
            else:
                await call('origin_run_labtalk', script=f'win -a {graph}; {edit} draw -uwi;')
            update_ms = round((time.perf_counter() - start) * 1000)
            await export(changed)
            total_ms = round((time.perf_counter() - start) * 1000)
            if name == 'line_width':
                await call('origin_set_plot_style', graph_name=graph, plot_index=0, line_width=undo)
            else:
                await call('origin_run_labtalk', script=f'win -a {graph}; {undo} draw -uwi;')
            await export(restored)
            entry = {'operation': name, 'updateMs': update_ms, 'updateAndExportMs': total_ms,
                     'changedPixels': changed_pixels(before, changed), 'restorePixelEqual': fingerprint(before) == fingerprint(restored),
                     'before': fingerprint(before), 'changed': fingerprint(changed), 'restored': fingerprint(restored)}
            report['operations'].append(entry)
        (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False))
    finally:
        try:
            await call('origin_set_project_folder', path=original)
            if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', window):
                await call('origin_run_labtalk', script=f'win -a {window};')
        finally:
            if folder:
                await call('origin_delete_project_folder', path=folder['path'], recursive=True, confirm=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    asyncio.run(main(Path(parser.parse_args().output).resolve()))
