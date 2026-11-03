import asyncio, json, os, argparse, csv, uuid
from pathlib import Path
os.environ['ORIGIN_MCP_TOOL_PROFILE']='full'
import origin_mcp.server
from origin_mcp.tools._shared import mcp

async def run(out, test_ppt=False):
    out.mkdir(parents=True,exist_ok=True)
    events=[]
    async def call(tool_name, **args):
        result=await mcp.call_tool(tool_name,args)
        data=result[1] if isinstance(result,tuple) else None
        if data is None: data=json.loads(result[0].text)
        events.append({'tool':tool_name,'arguments':args,'result':data})
        (out/'tool-results.json').write_text(json.dumps(events,ensure_ascii=False,indent=2),encoding='utf-8')
        if not data.get('ok'): raise RuntimeError(data)
        return data['data']
    before=await call('origin_list_project')
    if test_ppt and (before['graphs'] or before['matrixbooks'] or before['images'] or any(sheet['rows'] for book in before['workbooks'] for sheet in book['sheets'])):
        raise RuntimeError('PPT OLE activation requires a dedicated empty Origin session: closing an OLE presentation can terminate the Origin bridge. Preserve the user project and start an isolated session first.')
    original_folder=(await call('origin_list_project_folder'))['folder']['path']
    active=await call('origin_run_labtalk',script='type "IBM_ACTIVE=%H";',capture_log=True)
    original_window=next((x.split('=',1)[1] for x in active['message_log']['lines'] if x.startswith('IBM_ACTIVE=')), '')
    name='iBMQA'+uuid.uuid4().hex[:6]
    folder=await call('origin_create_project_folder',name=name,activate=True,reuse_existing=False)
    source=out/'synthetic.csv'
    with source.open('w',newline='',encoding='utf-8') as f:
        w=csv.writer(f); w.writerow(['Freq (Hz)','Sample A','Sample B'])
        for i in range(81):
            x=20*10**(i/20);w.writerow([x,500/(1+(x/500)**.6),320/(1+(x/1000)**.7)])
    try:
        plot=await call('origin_plot',path=str(source),kind='line',graph_name=name,selected_cols=[0,1,2],style_mode='origin_default',show_legend=True)
        name=plot['graph']['graph_name']
        await call('origin_set_axis',graph_name=name,axis='x',scale='log10',start=20,end=200000,title='Freq (Hz)')
        await call('origin_set_axis',graph_name=name,axis='y',scale='linear',start=0,end=500,step=100,title='|Z| (ohm)')
        for index,color in enumerate(['Black','Blue']):
            await call('origin_set_plot_style',graph_name=name,plot_index=index,color=color,line_width=3,line_style=index)
        await call('origin_format_legend',graph_name=name,font_size=32,font_family='Arial',show_frame=False,position='inside_upper_right')
        await call('origin_run_labtalk',script=f'win -a {name}; range qaA=!1; range qaB=!2; set qaA -q 0; set qaB -q 0; layer.x.grid.show=0; layer.y.grid.show=0; layer.x.thickness=3; layer.y.thickness=3; layer.x2.thickness=3; layer.y2.thickness=3; layer.x.ticks=5; layer.y.ticks=5; layer.x2.ticks=0; layer.y2.ticks=0; layer.y.minorTicks=3;',capture_log=True)
        (out/'plot-result.json').write_text(json.dumps(plot,ensure_ascii=False,indent=2),encoding='utf-8')
        readback=await call('origin_run_labtalk',script=f'win -a {name}; layer.unit=3; layer.width=9; layer.height=8; layer.fixed=0; xb.font=font(Arial); yl.font=font(Arial); xb.fsize=36; yl.fsize=36; legend.font=font(Arial); legend.fsize=32; layer.x.label.font=font(Arial); layer.y.label.font=font(Arial); layer.x.label.pt=32; layer.y.label.pt=32; legend.x1=5000; legend.y1=480; layer.x.label.numFormat=0; layer.x.label.decPlaces=0; pfit2l margin:=tight; layer.unit=; layer.width=; layer.height=; layer.fixed=; xb.fsize=; yl.fsize=; layer.x.label.pt=; layer.y.label.pt=; legend.fsize=; layer.x.type=; layer.x.from=; layer.x.to=; layer.y.from=; layer.y.to=; layer.y.inc=; layer.x.thickness=; layer.y.thickness=; layer.x.ticks=; layer.y.ticks=; layer.x2.ticks=; layer.y2.ticks=; xb.font=; yl.font=; layer.x.label.font=; layer.y.label.font=; legend.font=; qaArial=font(Arial); qaArial=; get qaA -wp qaWidthA; qaWidthA=; get qaB -wp qaWidthB; qaWidthB=; get qaA -d qaDashA; qaDashA=; get qaB -d qaDashB; qaDashB=;',capture_log=True)
        values={}
        for line in readback['message_log']['lines']:
            if '=' in line:
                key,value=line.split('=',1)
                try: values[key.lower()]=float(value)
                except ValueError: pass
        expected={'layer.unit':3,'layer.width':9,'layer.height':8,'layer.fixed':0,'xb.fsize':36,'yl.fsize':36,'layer.x.label.pt':32,'layer.y.label.pt':32,'legend.fsize':32,'layer.x.type':2,'layer.x.from':20,'layer.x.to':200000,'layer.y.from':0,'layer.y.to':500,'layer.y.inc':100,'layer.x.thickness':3,'layer.y.thickness':3,'layer.x.ticks':5,'layer.y.ticks':5,'layer.x2.ticks':0,'layer.y2.ticks':0,'qawidtha':3,'qawidthb':3,'qadasha':0,'qadashb':1}
        for key,value in expected.items():
            assert key in values and abs(values[key]-value)<0.005, (key,values.get(key),value)
        for key in ['xb.font','yl.font','layer.x.label.font','layer.y.label.font','legend.font']:
            assert values[key]==values['qaarial'], (key,values)
        info=await call('origin_get_graph_info',graph_name=name)
        assert info['layers_count']==1 and info['layers'][0]['plots_count']==2
        assert [p['color'] for p in info['layers'][0]['plots']]==[[0,0,0],[0,0,255]]
        for ext in ['png','pdf']:
            await call('origin_export_graph',path=str(out/f'{name}.{ext}'),graph_name=name,width=1800 if ext=='png' else 0)
            assert (out/f'{name}.{ext}').stat().st_size>1000
        target=(out/f'{name}.opju').as_posix()
        await call('origin_run_labtalk',script=f'pe_save fname:="{target}" path:="{folder["path"]}" sub:=1 proj:=0;',capture_log=True)
        assert Path(target).exists() and Path(target).stat().st_size>1000
        reload_folder=await call('origin_create_project_folder',name=name+'Reload',activate=False,reuse_existing=False)
        await call('origin_run_labtalk',script=f'pe_load fname:="{target}" path:="{reload_folder["path"]}";')
        reloaded=await call('origin_list_project_folder',path=reload_folder['path'],recursive=True)
        assert reloaded['folder']['count']>=2, reloaded
        restored=await call('origin_list_project')
        entries=set(reloaded['folder']['entries'])
        assert any(b['name'] in entries and b['sheets'][0]['rows']==81 for b in restored['workbooks'])
        assert any(g['name'] in entries for g in restored['graphs'])
        template=(out/f'{name}.otpu').as_posix()
        await call('origin_run_labtalk',script=f'win -a {name}; save -t {name} "{template}";')
        assert Path(template).stat().st_size>1000
        book=plot['worksheet']['book_name']; sheet=plot['worksheet']['sheet_name']
        await call('origin_run_labtalk',script=f'plotxy iy:=[{book}]{sheet}!(1,2:3) plot:=200 template:="{template}"; type "IBM_TEMPLATE_GRAPH=%H";',capture_log=True)
        template_graph=(await call('origin_get_graph_info'))
        assert template_graph['layers'][0]['plots_count']==2
        ole=[]
        if test_ppt:
            import win32com.client, zipfile
            ppt=win32com.client.Dispatch('PowerPoint.Application')
            blank=ppt.Presentations.Add(0)
            try:
                blank.Slides.Add(1,12)
                blank.SaveAs(str(out/'blank.pptx'),24)
            finally:
                blank.Close()
            destination=out/'editable-origin.pptx'
            await call('origin_run_labtalk',script=f'win -a {name}; pef_pptslide export:=page insert:=embed title:=none slidemode:=insert srcf:="{(out/"blank.pptx").as_posix()}" dstf:="{destination.as_posix()}";')
            with zipfile.ZipFile(destination) as archive:
                assert any(x.startswith('ppt/embeddings/') for x in archive.namelist())
            presentation=next((p for p in ppt.Presentations if p.FullName.lower()==str(destination).lower()),None)
            if presentation is None:
                presentation=ppt.Presentations.Open(str(destination),0,0,-1)
            try:
                if presentation.Windows.Count==0:
                    presentation.NewWindow()
                window=presentation.Windows(1); window.Activate(); window.ViewType=1
                for slide in presentation.Slides:
                    window.View.GotoSlide(slide.SlideIndex)
                    for shape in slide.Shapes:
                        if shape.Type==7:
                            progid=shape.OLEFormat.ProgID
                            assert progid.startswith('Origin') and progid.endswith('.Graph'),progid
                            shape.OLEFormat.DoVerb(0)
                            ole.append({'progid':progid,'activation':True})
                assert ole, 'No editable Origin OLE object'
            finally:
                presentation.Saved=True; presentation.Close()
        (out/'checks.json').write_text(json.dumps({'readback':values,'opju_reloaded':True,'template_reused':True,'visual_review':'required','ole_ppt':ole or 'not requested','ole_lifecycle':'Closing an activated OLE presentation may exit Origin; only run --ppt in a dedicated empty session' if test_ppt else 'not applicable'},indent=2),encoding='utf-8')
    finally:
        if not test_ppt:
            await call('origin_set_project_folder',path=original_folder)
        if original_window and not test_ppt:
            await call('origin_run_labtalk',script=f'win -a {original_window};',capture_log=True)
    print(json.dumps({'output':str(out),'graph':name,'project':target},ensure_ascii=False))

if __name__=='__main__':
    p=argparse.ArgumentParser(description='Live Origin MCP smoke test; creates an isolated folder; does not replace the open project.')
    p.add_argument('--output',required=True,type=Path)
    p.add_argument('--ppt',action='store_true',help='Also export and activate an editable Origin OLE object in a new PowerPoint fixture')
    args=p.parse_args()
    asyncio.run(run(args.output.resolve(),args.ppt))

