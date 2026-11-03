"""Measure Origin title write/read behavior in an owned test folder only."""
import argparse
import asyncio
import json
import os
import re
import sys
import uuid
from pathlib import Path

os.environ.setdefault('ORIGIN_MCP_TOOL_PROFILE','full')
import origin_mcp.server  # noqa: F401
from origin_mcp.tools._shared import mcp


async def call(tool_name,**args):
    result=await mcp.call_tool(tool_name,args)
    body=result[1] if isinstance(result,tuple) and len(result)>1 else None
    if body is None:body=json.loads(next(block.text for block in result[0] if hasattr(block,'text')))
    if not body.get('ok'):raise RuntimeError(body.get('message') or body.get('error') or tool_name)
    return body.get('data',{})


async def main(output):
    output.mkdir(parents=True,exist_ok=True)
    data=output/'calibration.csv';data.write_text('x,y\n0,1\n1,3\n2,4\n3,6\n4,8\n',encoding='utf-8')
    before=await call('origin_list_project_folder');original=before['folder']['path']
    active=await call('origin_run_labtalk',script='type "IBM_ACTIVE=%H";',capture_log=True)
    window=next((v.split('=',1)[1] for v in active.get('message_log',{}).get('lines',[]) if v.startswith('IBM_ACTIVE=')),'')
    folder=None;report={'values':[]}
    try:
        name='iBMCal'+uuid.uuid4().hex[:10];folder=await call('origin_create_project_folder',name=name,activate=True,reuse_existing=False)
        plotted=await call('origin_plot',path=str(data),graph_name=name,title='',kind='line',selected_cols=[0,1],style_mode='origin_default')
        graph=plotted['graph']['graph_name']
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*',graph):raise ValueError('invalid graph name')
        await call('origin_format_graph',graph_name=graph,x_label='Time (s)',y_label='Signal',show_legend=False,rescale=True)
        await call('origin_run_labtalk',script=f'win -a {graph}; layer.unit=3; layer.width=9; layer.height=8; layer.fixed=0; xb.anchor=5; yl.anchor=5; xb.anchorOnTextFrame=1; yl.anchorOnTextFrame=1; doc -uw; pfit2l margin:=border borderwid:=5 go:=1; draw -uwi;')
        for index,value in enumerate((-1.0,0.0,1.0)):
            before_read=await call('origin_run_labtalk',script=f'win -a {graph}; xb.y={value}; yl.x={value}; xb.y=; yl.x=;',capture_log=True)
            await call('origin_export_graph',path=str(output/f'axis-{index}.png'),graph_name=graph,overwrite=False,width=900)
            after_read=await call('origin_run_labtalk',script=f'win -a {graph}; xb.y=; yl.x=; layer.x.from=; layer.x.to=; layer.y.from=; layer.y.to=;',capture_log=True)
            def values(result):
                out={}
                for line in result.get('message_log',{}).get('lines',[]):
                    if '=' in line:
                        key,val=line.split('=',1)
                        try:out[key.lower()]=float(val)
                        except ValueError:pass
                return out
            report['values'].append({'set':value,'beforeExport':values(before_read),'afterExport':values(after_read)})
        report['fit']={}
        for prop in ('xb.y','yl.x'):
            points=[(row['set'],row['afterExport'].get(prop)) for row in report['values']]
            if any(y is None for _,y in points):report['fit'][prop]={'verified':False,'reason':'missing readback'};continue
            mx=sum(x for x,_ in points)/len(points);my=sum(y for _,y in points)/len(points)
            slope=sum((x-mx)*(y-my) for x,y in points)/sum((x-mx)**2 for x,_ in points);offset=my-slope*mx
            residual=max(abs(y-(slope*x+offset)) for x,y in points)
            report['fit'][prop]={'slope':slope,'offset':offset,'maxResidual':residual,'verified':residual<=.01 and abs(slope)>.01,'scope':'this graph and export only; not a universal calibration'}
        (output/'axis-calibration.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=False))
    finally:
        try:
            await call('origin_set_project_folder',path=original)
            if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*',window):await call('origin_run_labtalk',script=f'win -a {window};')
        finally:
            if folder:await call('origin_delete_project_folder',path=folder['path'],recursive=True,confirm=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True)
    asyncio.run(main(Path(parser.parse_args().output).resolve()))
