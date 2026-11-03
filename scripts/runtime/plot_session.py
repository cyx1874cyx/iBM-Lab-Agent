"""Owned sequential Origin session worker. Protocol is newline-delimited JSON."""
import asyncio,contextlib,json,sys,hashlib,re,shutil,time
from pathlib import Path
sys.stdin.reconfigure(encoding='utf-8')
sys.path.insert(0,str(Path(__file__).resolve().parent))
from plot_job import render_origin,lt_quote,pixel_fingerprint,page_fit_command,stabilize_geometry
from plot_editor import apply_editor,editor_readback,svg_scene,coordinate,series_commands,native_spec

sessions={}
call_timings=[]
async def call(tool_name,/,**fields):
 from origin_mcp.tools._shared import mcp
 start=time.perf_counter();r=await mcp.call_tool(tool_name,fields);b=r[1]
 script=fields.get('script','');phase='export-svg' if 'type:=svg' in script else 'export-png' if 'type:=png' in script else 'fit' if 'pfit2l' in script else tool_name
 call_timings.append({'phase':phase,'ms':round((time.perf_counter()-start)*1000,2)})
 if not b.get('ok'):raise RuntimeError(b.get('message') or str(b))
 return b.get('data',{})
def structural(s):
 result={k:s.get(k) for k in ('kind','xCol','yCols','layout','widthCm','heightCm')}
 # Binning changes derived data, so rebuild the histogram with its requested
 # bin width rather than merely restyling stale cached counts.
 if s.get('kind')=='histogram':result['binWidths']=[(s0['column'],s0.get('binWidth')) for s0 in s.get('series',[]) if s0.get('binWidth') is not None]
 return result
async def process(args):
 source=Path(args['path']).resolve();key=str(source)+':'+hashlib.sha256(source.read_bytes()).hexdigest();old=sessions.get(key);spec=args['spec'];out=Path(args['output']);out.mkdir(parents=True,exist_ok=True)
 if not old or structural(old['spec'])!=structural(spec):
  initial=await render_origin({**args,'tier':'full','_retain':True});session=initial.pop('_session');sessions[key]=session
  if old:await call('origin_delete_project_folder',path=old['folder'],recursive=True,confirm=True)
  if args.get('tier')=='preview':
   shutil.copyfile(out/'figure.png',out/'quick.png');data=(out/'quick.png').read_bytes()
   return {'preview':{'path':str(out/'quick.png'),'fileName':'quick.png','byteLength':len(data),'sha256':hashlib.sha256(data).hexdigest()},'pixels':pixel_fingerprint(out/'quick.png'),'svg':initial['svg'],'scene':initial['scene'],'canvas':initial.get('canvas'),'tier':'preview'}
  return initial
 graph=old['graph'];folder=(await call('origin_list_project_folder'))['folder']['path']
 active=await call('origin_run_labtalk',script='type "IBM_ACTIVE=%H";',capture_log=True)
 window=next((x.split('=',1)[1] for x in active.get('message_log',{}).get('lines',[]) if x.startswith('IBM_ACTIVE=')),'')
 try:
  # Remove app-owned labels before replay so deleted notes never survive.
  names=['ibmTitle']+[f'ibmNote{i}{suffix}' for i in range(len(old['spec'].get('annotations',[]))) for suffix in ('','A','B')]
  changed={k for k in spec if spec[k]!=old['spec'].get(k)}
  text_positions={'titleStyle':'ibmTitle','xTitleStyle':'xb','yTitleStyle':'yl'}
  fast=changed <= {'lineWidth','legendX','legendY','pageFit',*text_positions} and spec['layout']['mode']!='panels' and spec['kind']!='bar'
  for key in changed.intersection(text_positions):
   old_style=old['spec'].get(key,{})
   if {k for k in set(old_style)|set(spec[key]) if old_style.get(k)!=spec[key].get(k)}-{'x','y'}:fast=False
  multi=spec['layout']['mode']=='panels'
  if not fast:
   for layer in range(len(spec['yCols']) if multi else 1):
    await call('origin_run_labtalk',script=f'win -a {graph}; layer -s {layer+1}; '+''.join(f'label -r {n};' for n in names))
  if fast and 'lineWidth' in changed:
   await call('origin_run_labtalk',script=f'win -a {graph}; layer -s 1; '+series_commands(spec,spec['yCols']))
  if fast:
   positions=' '.join(f'legend.{a}={coordinate(a,spec["legend"+a.upper()],spec)};' for a in ('x','y') if 'legend'+a.upper() in changed)
   for key in changed.intersection(text_positions):
    positions+=' '.join(f'{text_positions[key]}.{axis}={coordinate(axis,spec[key][axis],spec)};' for axis in ('x','y') if axis in spec[key])
   if positions:await call('origin_run_labtalk',script=f'win -a {graph}; '+positions)
  else:
   for layer in range(len(spec['yCols']) if multi else 1):
    for axis in ('x','y'):
     await call('origin_set_axis',graph_name=graph,layer_index=layer,axis=axis,scale=native_spec(spec)[axis+'Axis']['scale'])
    await apply_editor(call,graph,spec,[spec['yCols'][layer]] if multi else spec['yCols'],layer=layer,panel_number=layer if multi else None,column_names=old['columns'],settle=False)
  await call('origin_run_labtalk',script=f'win -a {graph}; legend.show={int(spec["showLegend"])}; draw -uwi;')
  if 'pageFit' in changed and spec.get('pageFit')!='tight':
   await call('origin_run_labtalk',script=f'win -a {graph}; '+page_fit_command(spec))
  async def export(stem,kind,width=1800):
   await call('origin_run_labtalk',script=f'win -o {graph} {{expGraph -sw '+(f'tr1.width:={width} tr1.unit:=2 ' if kind=='png' else '')+f'type:={kind} path:={lt_quote(out)} filename:="{stem}" overwrite:=replace;}};')
  def artifact(name):
   p=out/name;b=p.read_bytes();return {'path':str(p),'fileName':name,'byteLength':len(b),'sha256':hashlib.sha256(b).hexdigest()}
  # A validated session retains font metrics for position/stroke-only edits.
  # Tight validation itself renders both snapshots; warming again is redundant.
  if not (fast and spec.get('pageFit')=='tight'):
   await export('quick' if args.get('tier')=='preview' else 'figure','png',900 if args.get('tier')=='preview' else 1800)
  old['spec']=spec
  if args.get('tier')=='preview':
   await stabilize_geometry(call,graph,out,out/'quick.png',900,tight=spec.get('pageFit')=='tight')
   return {'preview':artifact('quick.png'),'pixels':pixel_fingerprint(out/'quick.png'),'svg':artifact('figure.svg'),'scene':svg_scene(out/'figure.svg'),'tier':'preview'}
  page_bounds=await stabilize_geometry(call,graph,out,out/'figure.png',1800,tight=spec.get('pageFit')=='tight')
  await export('figure','pdf')
  await call('origin_run_labtalk',script=f'pe_save fname:={lt_quote(out/"figure.opju")} path:={lt_quote(old["folder"])} sub:=1 proj:=0;')
  readback=await editor_readback(call,graph,spec);readback['pageBounds']=page_bounds;readback['collision']={'status':'unverified','reason':'增量布局需检查文字区域'}
  await export('final-check','png')
  first=pixel_fingerprint(out/'figure.png');final=pixel_fingerprint(out/'final-check.png')
  if first!=final:raise RuntimeError('Origin 增量导出发生布局变化，请重试')
  return {'preview':artifact('figure.png'),'pdf':artifact('figure.pdf'),'origin':artifact('figure.opju'),'svg':artifact('figure.svg'),'scene':svg_scene(out/'figure.svg'),'readback':readback,'pixelVerification':{'probe':first,'final':final,'equal':first==final}}
 except Exception:
  sessions.pop(key,None)
  await call('origin_delete_project_folder',path=old['folder'],recursive=True,confirm=True)
  raise
 finally:
  await call('origin_set_project_folder',path=folder)
  if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*',window):await call('origin_run_labtalk',script=f'win -a {window};')
async def main():
 for line in sys.stdin:
  try:
   req=json.loads(line)
   if req.get('close'):break
   call_timings.clear()
   with contextlib.redirect_stdout(sys.stderr):result=await process(req['args'])
   if req['args'].get('_profile'):result['_timings']=list(call_timings)
   print(json.dumps({'ok':True,'result':result},ensure_ascii=False),flush=True)
  except Exception as e:print(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False),flush=True)
 for s in sessions.values():
  try:await call('origin_delete_project_folder',path=s['folder'],recursive=True,confirm=True)
  except Exception:pass
if __name__=='__main__':asyncio.run(main())
