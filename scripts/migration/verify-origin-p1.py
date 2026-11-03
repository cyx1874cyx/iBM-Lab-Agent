"""Real Origin round-trip acceptance; only owned folders are loaded/deleted."""
import asyncio,csv,json,os,re,sys,uuid
import xml.etree.ElementTree as ET
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'runtime'))
import origin_mcp.server
from plot_job import render_origin,prepare_origin_data,lt_quote,pixel_fingerprint
from plot_session import call
from plot_editor import physical_graph_info

def visible_bars(svg):
 root=ET.fromstring(svg);scope='{http://www.originlab.com/namespaces/olab}scope';tag='{http://www.w3.org/2000/svg}'
 frame=next(e for e in root if e.tag==tag+'polygon' and e.get(scope)=='Layer0');points=[float(v) for v in re.split('[, ]+',frame.get('points'))];left,right=min(points[::2]),max(points[::2]);top,bottom=min(points[1::2]),max(points[1::2]);count=0
 for group in root.iter(tag+'g'):
  if not group.get('mask'):continue
  for rect in group.iter():
   if rect.tag not in (tag+'rect',tag+'polygon'):continue
   if rect.get('visibility')=='hidden' or rect.get('fill') in ('none','white',None):continue
   if rect.tag==tag+'polygon':
    xy=[float(v) for v in re.split('[, ]+',rect.get('points'))];x,y=min(xy[::2]),min(xy[1::2]);w,h=max(xy[::2])-x,max(xy[1::2])-y
   else:x,y,w,h=[float(rect.get(k,'0')) for k in ('x','y','width','height')]
   if w>0 and h>0 and left<=x+w/2<=right and top<=y+h/2<=bottom:count+=1
 return count

async def main(request):
 root=Path(request['output']);report=[]
 original=(await call('origin_list_project_folder'))['folder']['path']
 active=await call('origin_run_labtalk',script='type "IBM_ACTIVE=%H";',capture_log=True)
 window=next((s.split('=',1)[1] for s in active.get('message_log',{}).get('lines',[]) if s.startswith('IBM_ACTIVE=')),'')
 try:
  for case in request['cases']:
   owned=None;out=root/case['name'];out.mkdir(parents=True,exist_ok=True)
   try:
    spec=case['spec']
    if case.get('artifacts'):result=case['artifacts']
    else:
     prepared=await prepare_origin_data({'path':case['path'],'output':str(out/'data')})
     result=await render_origin({'path':case['path'],'dataOrigin':prepared['path'],'output':str(out/'figure'),'spec':spec})
    if result.get('readback',{}).get('graph'):assert result['readback']['graph']['layers'][0]['plots_count']==len(spec['yCols'])
    source_svg=Path(result['svg']['path']).read_text(encoding='utf8')
    if spec['kind'] in ('bar','column'):
     with Path(case['path']).open(encoding='utf-8-sig',newline='') as stream:
      rows=csv.reader(stream);next(rows);expected=sum(float(row[c])!=0 for row in rows for c in spec['yCols'])
     assert visible_bars(source_svg)>=expected,'Bars are clipped outside the actual plot frame'
    for style in spec['series']:
     assert style['color'].lower() in source_svg.lower(),('visible color missing',style)
     if style.get('label') and spec['showLegend']:assert style['label'] in source_svg,('legend name missing',style)
    if case.get('expectedFirst'):
     with (Path(result['origin']['path']).parent/'origin-input.csv').open(encoding='utf-8-sig',newline='') as stream:
      rows=list(csv.reader(stream));assert rows[1]==[str(v) for v in case['expectedFirst']],rows[1]
    owned=await call('origin_create_project_folder',name='iBMP1'+uuid.uuid4().hex[:10],activate=True,reuse_existing=False)
    await call('origin_run_labtalk',script=f'pe_load fname:={lt_quote(result["origin"]["path"])} path:={lt_quote(owned["path"])};')
    entries=set((await call('origin_list_project_folder',path=owned['path'],recursive=True))['folder']['entries']);project=await call('origin_list_project')
    graphs=[g for g in project['graphs'] if g['name'] in entries];books=[b for b in project['workbooks'] if b['name'] in entries]
    assert len(graphs)==1 and books,(graphs,books)
    graph=graphs[0]['name'];info=physical_graph_info(await call('origin_get_graph_info',graph_name=graph),spec);assert info['layers'][0]['plots_count']==len(spec['yCols'])
    assert any(s['rows']==case['expectedRows'] for b in books for s in b['sheets']),books
    if case.get('expectedFirst'):
     b=books[0];sheet=b['sheets'][0];read=await call('origin_read_worksheet',book_name=b['name'],sheet_name=sheet['name'],max_rows=1)
     (out/'reopened-data.json').write_text(json.dumps(read,ensure_ascii=False,indent=2),encoding='utf8')
     values=read.get('rows');assert values is not None,read
     assert list(values[0].values())==case['expectedFirst'],(values,case['expectedFirst'])
    if case.get('zeroAxis'):
     limits=info['layers'][0]['axes'][case['zeroAxis']]['limits'];assert limits[0]<=0<=limits[1],limits
    for axis in ('x','y'):
     limits=info['layers'][0]['axes'][axis]['limits']
     for key,i in [('min',0),('max',1)]:
      if key in spec[axis+'Axis']:assert abs(limits[i]-spec[axis+'Axis'][key])<1e-6,(axis,key,limits)
    commands=[f'win -a {graph}; layer -s 1;']
    for i,style in enumerate(spec['series']):
     name=f'p1Plot{i}';commands.append(f'range {name}=!{i+1};')
     fields={'width':'pbw','dash':'pbs','border':'pbc','fill':'pfb'} if spec['kind'] in ('column','bar','box','histogram') else {'width':'wp','dash':'d'}
     if spec['kind'] in ('scatter','line_symbol'):fields.update({'symbol':'k','size':'z','symbol_edge':'cse','symbol_fill':'csf'})
     if spec['kind']=='histogram':fields['bin']='hbs'
     for field,flag in fields.items():commands.append(f'get {name} -{flag} p1_{i}_{field}; p1_{i}_{field}=;')
     if spec['kind']=='box':commands.append(f'layer.plot{i+1}.boxchart.width=;')
    readback=await call('origin_run_labtalk',script=' '.join(commands),capture_log=True)
    (out/'reopened-properties.json').write_text(json.dumps(readback,ensure_ascii=False,indent=2),encoding='utf8')
    values={}
    for line in readback.get('message_log',{}).get('lines',[]):
     if '=' in line:
      key,value=line.split('=',1)
      try:values[key.lower()]=float(value)
      except ValueError:pass
    for i,style in enumerate(spec['series']):
     assert abs(values[f'p1_{i}_width']-style['lineWidth'])<.005,values
     expected_dash=style.get('lineStyle',0 if spec['kind'] in ('column','bar','box','histogram') or spec['lineStyle']=='solid' else i%2)
     assert values[f'p1_{i}_dash']==expected_dash,values
     if spec['kind'] in ('scatter','line_symbol'):assert values[f'p1_{i}_symbol']==style.get('symbolKind',i%5+1) and values[f'p1_{i}_size']==style.get('symbolSize',spec['symbolSize']),values
     if spec['kind']=='histogram':assert values[f'p1_{i}_bin']==style['binWidth'],values
     if spec['kind']=='box':assert abs(values[f'layer.plot{i+1}.boxchart.width']-style['boxWidth'])<.01,values
     def ocolor(hex):
      rgb=[int(hex[n:n+2],16) for n in (1,3,5)];return 16777216+rgb[0]+256*rgb[1]+65536*rgb[2]
     if spec['kind'] in ('column','bar','box','histogram'):
      assert values[f'p1_{i}_border']==ocolor(style['borderColor']),values
      assert values[f'p1_{i}_fill']==ocolor(style['fillColor']),values
     if spec['kind'] in ('scatter','line_symbol'):
      assert values[f'p1_{i}_symbol_edge']==ocolor(style['borderColor']),values
      assert values[f'p1_{i}_symbol_fill']==ocolor(style['fillColor']),values
    exported=await call('origin_export_graph',graph_name=graph,path=str(out/'reopened.png'),width=1800,overwrite=True)
    await call('origin_export_graph',graph_name=graph,path=str(out/'reopened.svg'),overwrite=True)
    (out/'reopened-export.json').write_text(json.dumps(exported,ensure_ascii=False,indent=2),encoding='utf8')
    assert exported.get('result') is not False,exported
    reopened=(out/'reopened.svg').read_text(encoding='utf8')
    for style in spec['series']:assert style['color'].lower() in reopened.lower(),style
    equal=pixel_fingerprint(out/'reopened.png')==pixel_fingerprint(Path(result['preview']['path']))
    assert equal,'Saved/reopened PNG differs from the archived preview'
    report.append({'case':case['name'],'ok':True,'pixelEqualAfterReopen':equal,'origin':result['origin']['path'],'preview':result['preview']['path']})
   except Exception as error:report.append({'case':case['name'],'ok':False,'error':str(error)})
   finally:
    await call('origin_set_project_folder',path=original)
    if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*',window):await call('origin_run_labtalk',script=f'win -a {window};')
    if owned:await call('origin_delete_project_folder',path=owned['path'],recursive=True,confirm=True)
   (root/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(report[-1],ensure_ascii=False),flush=True)
 finally:
  await call('origin_set_project_folder',path=original)
 assert report and all(r['ok'] for r in report),'Origin P1 acceptance failed'
asyncio.run(main(json.loads(Path(sys.argv[1]).read_text(encoding='utf8'))))
