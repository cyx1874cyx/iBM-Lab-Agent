"""Read and probe an owned acceptance OPJU without replacing the user project."""
import asyncio,json,os,re,sys,uuid
from pathlib import Path
os.environ['ORIGIN_MCP_TOOL_PROFILE']='full'
sys.stdout.reconfigure(encoding='utf-8')
import origin_mcp.server
from origin_mcp.tools._shared import mcp

async def main(path):
 async def call(tool,**args):
  result=await mcp.call_tool(tool,args)
  body=result[1] if isinstance(result,tuple) else json.loads(result[0].text)
  assert body['ok'],body
  return body['data']
 original=(await call('origin_list_project_folder'))['folder']['path']
 active=await call('origin_run_labtalk',script='type "IBM_ACTIVE=%H";',capture_log=True)
 window=next((s.split('=',1)[1] for s in active['message_log']['lines'] if s.startswith('IBM_ACTIVE=')),'')
 folder=await call('origin_create_project_folder',name='iBMProbe'+uuid.uuid4().hex[:8],activate=True,reuse_existing=False)
 try:
  source=str(Path(path).resolve()).replace('\\','/')
  assert '"' not in source
  await call('origin_run_labtalk',script=f'pe_load fname:="{source}" path:="{folder["path"]}";')
  entries=(await call('origin_list_project_folder',path=folder['path'],recursive=True))['folder']['entries']
  graphs=[g for g in (await call('origin_list_project'))['graphs'] if g['name'] in entries]
  graph=graphs[0]['name']
  info=await call('origin_get_graph_info',graph_name=graph)
  print(json.dumps(info,ensure_ascii=False))
  props=['layer.width','layer.height','layer.factor','xb.fsize','yl.fsize','ibmTitle.x','ibmTitle.y','ibmTitle.dx','ibmTitle.dy','legend.x','legend.y','legend.dx','legend.dy','legend.attach','ibmTitle.attach','legend.anchor','ibmTitle.anchor','ibmNote0.x','ibmNote0.y','layer.x.inc','layer.x.label.decPlaces']
  for i in range(len(info['layers'])):
   result=await call('origin_run_labtalk',script=f'win -a {graph}; layer -s {i+1}; '+' '.join(p+'=;' for p in props),capture_log=True)
   print(i,json.dumps(result))
   print('direct',await call('origin_run_labtalk',script='legend.x=2; legend.y=8; ibmTitle.x=2; ibmTitle.y=11.5; legend.x=; legend.y=; ibmTitle.x=; ibmTitle.y=;',capture_log=True))
   print('expression',await call('origin_run_labtalk',script='legend.x=(layer.x.from+(0.27)*(layer.x.to-layer.x.from)); legend.y=(layer.y.from+(0.83)*(layer.y.to-layer.y.from)); ibmTitle.x=(layer.x.from+(0.5)*(layer.x.to-layer.x.from)); legend.x=; legend.y=; ibmTitle.x=; ibmNote1.arrowBeginShape=1; ibmNote1.arrowEndShape=1; ibmNote1.arrowPosition=2; ibmNote1.arrowPosition=;',capture_log=True))
   print('refresh-before',await call('origin_run_labtalk',script=f'win -a {graph}; layer -s {i+1}; doc -uw; legend.x=3; legend.x=; ibmTitle.x=1; ibmTitle.x=;',capture_log=True))
   print('refresh-readback',await call('origin_run_labtalk',script='legend.x=; ibmTitle.x=;',capture_log=True))
   print('fitted',await call('origin_run_labtalk',script='doc -uw; pfit2l margin:=tight go:=1; doc -uw; legend.x=; ibmTitle.x=;',capture_log=True))
  await call('origin_export_graph',graph_name=graph,path=str(Path(path).parent/'probe.png'),overwrite=True,width=1800)
 finally:
  await call('origin_set_project_folder',path=original)
  if re.fullmatch('[A-Za-z][A-Za-z0-9_]*',window):await call('origin_run_labtalk',script=f'win -a {window};')
  await call('origin_delete_project_folder',path=folder['path'],recursive=True,confirm=True)

asyncio.run(main(sys.argv[1]))
