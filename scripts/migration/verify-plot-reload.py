"""Verify an owned UI acceptance OPJU in a temporary Origin folder."""
import asyncio
import json
import os
from pathlib import Path
import re
import sys
import uuid

os.environ['ORIGIN_MCP_TOOL_PROFILE'] = 'full'
sys.stdout.reconfigure(encoding='utf-8')
import origin_mcp.server
from origin_mcp.tools._shared import mcp


async def main(report_path):
    report_path = Path(report_path)
    ui = json.loads(report_path.read_text(encoding='utf-8'))
    target = Path(ui['saved']['origin']['path'])
    assert target.is_file() and target.stat().st_size > 100

    async def call(tool_name, **args):
        result = await mcp.call_tool(tool_name, args)
        body = result[1] if isinstance(result, tuple) else json.loads(result[0].text)
        assert body['ok'], body
        return body['data']

    def quoted(value):
        text = str(value).replace('\\', '/')
        assert not any(c in text for c in ('"', '\n', '\r'))
        return '"' + text + '"'

    original = (await call('origin_list_project_folder'))['folder']['path']
    active = await call('origin_run_labtalk', script='type "IBM_ACTIVE=%H";', capture_log=True)
    window = next((line.split('=', 1)[1] for line in active['message_log']['lines'] if line.startswith('IBM_ACTIVE=')), '')
    owned = await call('origin_create_project_folder', name='iBMReload'+uuid.uuid4().hex[:8], activate=True, reuse_existing=False)
    try:
        await call('origin_run_labtalk', script=f'pe_load fname:={quoted(target)} path:={quoted(owned["path"])};')
        entries = set((await call('origin_list_project_folder', path=owned['path'], recursive=True))['folder']['entries'])
        project = await call('origin_list_project')
        graphs = [graph for graph in project['graphs'] if graph['name'] in entries]
        books = [book for book in project['workbooks'] if book['name'] in entries]
        assert len(graphs) == 1 and len(books) >= 1, (graphs, books)
        info = await call('origin_get_graph_info', graph_name=graphs[0]['name'])
        assert info['layers'][0]['axes']['x']['title'] == 'Elapsed time (s)', info
        assert info['layers'][0]['plots_count'] == 2, info
        assert any(sheet['rows'] == 5 for book in books for sheet in book['sheets']), books
        await call('origin_export_graph',graph_name=graphs[0]['name'],path=str(report_path.parent/'reload-scene.svg'))
        result = {'ok': True, 'project': str(target), 'checks': ['saved-opju-reopens-with-data-and-two-series', 'edited-axis-title-survives-Origin-reload'], 'graph': info}
        (report_path.parent/'reload-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'ok': True, 'checks': result['checks']}, ensure_ascii=False))
    finally:
        await call('origin_set_project_folder', path=original)
        if re.fullmatch('[A-Za-z][A-Za-z0-9_]*', window):
            await call('origin_run_labtalk', script=f'win -a {window};')
        await call('origin_delete_project_folder', path=owned['path'], recursive=True, confirm=True)


asyncio.run(main(sys.argv[1]))
