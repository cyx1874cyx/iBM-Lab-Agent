"""Origin-native object adapter. No client-provided LabTalk is accepted.

Properties verified against docs.originlab.com/labtalk/ref/graphic-objs/,
layer-axis-obj/, layer-axis-label-obj/, layer-obj/ and draw-cmd/.
"""
import math
import re
import copy
import xml.etree.ElementTree as ET


TITLE_X=.5
TITLE_Y=.06
PALETTES={'classic':['#000000','#0000FF','#800020','#008B8B','#FFA500','#800080'],
          'blue':['#000000','#4169E1','#0000FF','#008B8B','#808000','#800080'],
          'warm':['#000000','#800020','#FF0000','#FFA500','#800080','#0000FF']}

def native_spec(spec):
    """The editor uses screen X/Y; Origin bar charts exchange the data axes."""
    if spec['kind']!='bar':return spec
    result=copy.deepcopy(spec)
    def style(value):
        converted={k:v for k,v in value.items() if k not in ('x','y')}
        if 'y' in value:converted['x']=1-value['y']
        if 'x' in value:converted['y']=1-value['x']
        return converted
    result['xAxis'],result['yAxis']=result['yAxis'],result['xAxis']
    result['xLabel'],result['yLabel']=spec['yLabel'],spec['xLabel']
    result['xTitleStyle'],result['yTitleStyle']=style(spec.get('yTitleStyle',{})),style(spec.get('xTitleStyle',{}))
    result['legendX'],result['legendY']=1-spec['legendY'],1-spec['legendX']
    result['titleStyle']=style({'x':TITLE_X,'y':TITLE_Y,**spec.get('titleStyle',{})})
    for note in result.get('annotations',[]):
        note['x'],note['y']=1-note['y'],1-note['x']
        if 'x2' in note and 'y2' in note:note['x2'],note['y2']=1-note['y2'],1-note['x2']
    return result


def exchanged_property(prop):
    parts=prop.split('.')
    if parts[0] in ('xb','yl'):parts[0]={'xb':'yl','yl':'xb'}[parts[0]]
    elif parts[0]=='layer' and len(parts)>1 and parts[1] in ('x','y'):parts[1]={'x':'y','y':'x'}[parts[1]]
    if parts[0]!='layer' and parts[-1] in ('x','y'):parts[-1]={'x':'y','y':'x'}[parts[-1]]
    return '.'.join(parts)


def physical_graph_info(info,spec):
    if spec['kind']!='bar':return info
    info=copy.deepcopy(info)
    for layer in info.get('layers',[]):
        axes=layer.get('axes',{})
        if 'x' in axes and 'y' in axes:axes['x'],axes['y']=axes['y'],axes['x']
    return info


def rgb(value):
    if not re.fullmatch(r'#[A-Fa-f0-9]{6}', value):
        raise ValueError('颜色必须为六位十六进制值')
    return tuple(int(value[i:i+2], 16) for i in (1, 3, 5))


def color(value):
    return 'color('+','.join(str(v) for v in rgb(value))+')'


def series_commands(spec, columns):
    """Replay every supported chart's visible styles, keyed to source columns.

    set -c only affects line/symbol edge. Filled plots require -pfb/-pbc;
    grouped templates must use independent edit mode before per-plot styling.
    Keep initial rendering and the retained-graph path on this single adapter.
    """
    commands=[];kind=spec['kind'];filled=kind in ('column','bar','box','histogram')
    for index,column in enumerate(columns):
        style=next((s for s in spec.get('series',[]) if s['column']==column),{})
        source_index=spec['yCols'].index(column)
        base=style.get('color',PALETTES[spec['palette']][source_index%6])
        fill=color(style.get('fillColor',base));edge=color(style.get('borderColor',base))
        width=style.get('lineWidth',spec['lineWidth'])
        pattern=style.get('lineStyle',0 if spec['lineStyle']=='solid' or filled else source_index%2)
        name=f'ibmSeries{index}'
        commands.extend([f'range {name}=!{index+1};',f'set {name} -gm 1;',f'set {name} -c {color(base)};',
                         f'set {name} -w {round(width*500)};',f'set {name} -wp {width};',f'set {name} -d {pattern};',
                         f'layer.plot{index+1}.transparency={(1-style.get("opacity",1))*100};',
                         f'set {name} -s {int(style.get("visible",True))};'])
        if filled:
            # Box templates store opacity on Patterns.Above; following the
            # root line alpha (which remains zero) silently cancels that value.
            commands.extend([f'set {name} -pfb {fill};',f'set {name} -pbc {edge};',
                             f'set {name} -pbw {width};',f'set {name} -pbs {pattern};',f'set {name} -paap 0;',f'set {name} -paal {0 if kind=="box" else 1};'])
        if kind in ('scatter','line_symbol'):
            commands.extend([f'set {name} -cse {edge};',f'set {name} -csf {fill};',
                             f'set {name} -k {style.get("symbolKind",source_index%5+1)};',
                             # Interior 1 allows separate fill/edge colors;
                             # solid 0 ignores fill and uses the edge color.
                             f'set {name} -kf {3 if style.get("symbolFill")=="open" else 1};',
                             f'set {name} -kh {style.get("symbolEdgeWidth",15)};',
                             f'set {name} -paas 1;',
                             f'set {name} -z {style.get("symbolSize",spec["symbolSize"])};'])
        if kind in ('line','line_symbol','scatter'):
            commands.append(f'set {name} -q 0;')
        if kind in ('column','bar'):
            commands.append(f'set {name} -vg {style.get("barGap",20)};')
        if kind=='box':
            commands.append(f'layer.plot{index+1}.boxchart.width={style.get("boxWidth",20)};')
        # Histogram bin width is set at graph creation. Updating -hbs here can
        # invalidate cached counts after rescale; plot_session rebuilds for it.
    return ' '.join(commands)


def coordinate(axis, fraction, spec):
    f = float(fraction)
    if axis == 'y':
        f = 1-f
    if spec[axis+'Axis']['scale'] == 'log10':
        return f'(10^(log(layer.{axis}.from)+({f})*(log(layer.{axis}.to)-log(layer.{axis}.from))))'
    return f'(layer.{axis}.from+({f})*(layer.{axis}.to-layer.{axis}.from))'


def rich_text(text, style):
    # Text is passed as an API value, never inserted in LabTalk source.
    if style.get('italic'):
        text = r'\i('+text+')'
    if style.get('bold'):
        text = r'\b('+text+')'
    return text


def object_style(name, style, spec, defaults=True):
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', name):
        raise ValueError('图形对象名称无效')
    font = style.get('font', spec.get('fontFamily', 'Arial'))
    if font not in ('Arial','Calibri','Helvetica','Times New Roman'):
        raise ValueError('字体无效')
    # Origin's default anchor is auto/left. Keep the centre fixed while export
    # remeasures a rich-text box or the layer-frame factor changes.
    # Centre=5 verified in installed OriginC/System/OC_const.h.
    commands = [f'{name}.attach=2;',f'{name}.anchor=5;',f'{name}.anchorOnTextFrame=1;',f'{name}.font=font({font});']
    if 'size' in style or defaults:
        commands.append(f'{name}.fsize={style.get("size", spec["fontSize"])};')
    commands.extend([f'{name}.color={color(style.get("color", "#000000"))};',f'{name}.show={int(style.get("visible", True))};'])
    if 'rotation' in style:
        commands.append(f'{name}.rotate={style["rotation"]};')
    for axis in ('x','y'):
        if axis in style:
            commands.append(f'{name}.{axis}={coordinate(axis, style[axis], spec)};')
    return ' '.join(commands)


async def position_editor(call,graph,spec,layer=0,panel_number=None,offsets=None,redraw=True):
    if spec['kind']=='bar' and offsets:offsets={exchanged_property(k):-v for k,v in offsets.items()}
    spec=native_spec(spec)
    offsets=offsets or {}
    def location(name,axis,value):return coordinate(axis,value-offsets.get(name+"."+axis,0),spec)
    positions=[]
    for axis,obj in [('x','xb'),('y','yl')]:
        style=spec.get(axis+'TitleStyle',{})
        positions.extend(f'{obj}.{key}={location(obj,key,style[key])};' for key in ('x','y') if key in style)
    if spec.get('showLegend',True):
        positions.extend(f'legend.{axis}={location("legend",axis,spec["legend"+axis.upper()])};' for axis in ('x','y'))
    if spec.get('titleText') and layer==0:
        style={'x':TITLE_X,'y':TITLE_Y,**spec.get('titleStyle',{})}
        positions.extend(f'ibmTitle.{axis}={location("ibmTitle",axis,style[axis])};' for axis in ('x','y'))
    if layer==0:
        for index,note in enumerate(spec.get('annotations',[])):
            if note['kind']=='text' and note['text'].strip():
                positions.extend(f'ibmNote{index}.{axis}={location("ibmNote"+str(index),axis,note[axis])};' for axis in ('x','y'))
    if panel_number is not None and spec['layout']['labels']:
        positions.extend(f'ibmPanel.{axis}={location("ibmPanel",axis,.04)};' for axis in ('x','y'))
    await call('origin_run_labtalk',script=f'win -a {graph}; layer -s {layer+1}; '+('draw -uwi; ' if redraw else '')+' '.join(positions))


async def editor_readback(call,graph,spec):
    bar=spec['kind']=='bar';spec=native_spec(spec)
    rows=[];passed=True;multi=spec['layout']['mode']=='panels'
    for index in range(len(spec['yCols']) if multi else 1):
        positions={}
        for axis,obj in [('x','xb'),('y','yl')]:
            for key in ('x','y'):
                if key in spec[axis+'TitleStyle']:positions[obj+'.'+key]=spec[axis+'TitleStyle'][key]
        if spec['showLegend']:positions.update({'legend.x':spec['legendX'],'legend.y':spec['legendY']})
        if index==0:
            if spec['titleText']:positions.update({'ibmTitle.x':spec['titleStyle'].get('x',TITLE_X),'ibmTitle.y':spec['titleStyle'].get('y',TITLE_Y)})
            for i,note in enumerate(spec['annotations']):
                if note['kind']=='text' and note['text'].strip():positions.update({f'ibmNote{i}.x':note['x'],f'ibmNote{i}.y':note['y']})
        tick_props=[f'layer.{axis}.ticks' for axis in ('x','y')]+[f'layer.{axis}.label.{prop}' for axis in ('x','y') for prop in ('offsetH','offsetV')]
        props=tick_props+['layer.unit','layer.width','layer.height','layer.fixed','layer.factor','xb.fsize','yl.fsize','layer.x.label.pt','layer.y.label.pt','layer.x.from','layer.x.to','layer.y.from','layer.y.to',*positions]
        result=await call('origin_run_labtalk',script=f'win -a {graph}; layer -s {index+1}; '+' '.join(p+'=;' for p in props),capture_log=True)
        values={}
        for line in result.get('message_log',{}).get('lines',[]):
            if '=' in line:
                key,value=line.split('=',1)
                try:values[key.lower()]=float(value)
                except ValueError:pass
        checks=[]
        for prop,target in positions.items():
            axis=prop[-1];value=values.get(prop.lower());lo=values.get('layer.'+axis+'.from');hi=values.get('layer.'+axis+'.to')
            if value is None or lo is None or hi is None or hi==lo:
                error=1e6
            elif spec[axis+'Axis']['scale']=='log10':
                error=abs((math.log10(value)-math.log10(lo))/(math.log10(hi)-math.log10(lo))-(1-target if axis=='y' else target)) if value>0 else 1e6
            else:error=abs((value-lo)/(hi-lo)-(1-target if axis=='y' else target))
            actual=((math.log10(value)-math.log10(lo))/(math.log10(hi)-math.log10(lo))) if spec[axis+'Axis']['scale']=='log10' and value and value>0 else (value-lo)/(hi-lo) if value is not None and hi!=lo else 1e6
            signed=(1-actual if axis=='y' else actual)-target
            checks.append({'property':prop,'target':target,'errorFraction':error,'signedError':signed,'passed':error<=.012})
        passed=passed and all(check['passed'] for check in checks)
        rows.append({'layer':index,'properties':values,'positions':checks})
    if bar:
        for row in rows:
            row['properties']={exchanged_property(k):v for k,v in row['properties'].items()}
            for check in row['positions']:
                check['property']=exchanged_property(check['property']);check['target']=1-check['target'];check['signedError']=-check['signedError']
    return {'passed':passed,'layers':rows}


async def apply_editor(call, graph, spec, columns, layer=0, panel_number=None,settle=True,column_names=None):
    spec=native_spec(spec)
    await call('origin_run_labtalk',script=f'win -a {graph}; layer -s {layer+1};')
    commands = [f'layer.color={color(spec.get("background", "#FFFFFF"))};',
                f'layer.x.label.font=font({spec["fontFamily"]}); layer.y.label.font=font({spec["fontFamily"]}); layer.x.label.pt={spec["fontSize"]}; layer.y.label.pt={spec["fontSize"]};']
    positions=[]
    commands.append(series_commands(spec,columns))
    for axis, obj in [('x','xb'),('y','yl')]:
        settings=spec[axis+'Axis']
        # Setting the other auto axis must not undo this axis's manual limits.
        for field, prop in [('min','from'),('max','to'),('step','inc')]:
            if field in settings:
                commands.append(f'layer.{axis}.{prop}={settings[field]};')
        commands.extend([f'layer.{axis}.color={color(settings.get("color", "#000000"))};',
                         f'layer.{axis}.thickness={settings.get("lineWidth",3)};',
                         f'layer.show{axis}={int(settings.get("visible", True))};',
                         f'layer.{axis}.grid.show={dict(none=0,major=1,both=3)[settings.get("grid","none")]};',
                         f'layer.{axis}.ticks={dict(none=0,out=10,**{"in":5},both=15)[settings.get("ticks","in")]};'])
        if 'minorTicks' in settings:
            commands.append(f'layer.{axis}.minorTicks={settings["minorTicks"]};')
        for field, prop in [('tickSize','pt'),('tickRotation','rotate'),('decimals','decPlaces')]:
            if field in settings:
                commands.append(f'layer.{axis}.label.{prop}={settings[field]};')
        if 'tickOffsetX' in settings:
            commands.append(f'layer.{axis}.label.offsetH={settings["tickOffsetX"]};')
        if 'tickOffsetY' in settings:
            commands.append(f'layer.{axis}.label.offsetV={-settings["tickOffsetY"]};')
        if 'tickColor' in settings:
            commands.append(f'layer.{axis}.label.color={color(settings["tickColor"])};')
        if 'tickFont' in settings:
            commands.append(f'layer.{axis}.label.font=font({settings["tickFont"]});')
        if 'format' in settings:
            commands.append(f'layer.{axis}.label.numFormat={dict(decimal=1,scientific=2,engineering=3)[settings["format"]]};')
        style=spec.get(axis+'TitleStyle',{})
        await call('origin_set_axis',graph_name=graph,layer_index=layer,axis=axis,title=rich_text(spec[axis+'Label'],style),
                   start=settings.get('min'),end=settings.get('max'),step=settings.get('step'))
        commands.append(object_style(obj,{"size":spec['titleSize'],**style},spec))
        positions.extend(f'{obj}.{axis_name}={coordinate(axis_name,style[axis_name],spec)};' for axis_name in ('x','y') if axis_name in style)
    # Apply full text through the native value API. Reorder only legend entries;
    # series and original worksheet order remain unchanged.
    if spec.get('showLegend',True):
        order=[c for c in spec.get('legendOrder',[]) if c in columns]+[c for c in columns if c not in spec.get('legendOrder',[])]
        entries=[]
        for column in order:
            style=next((s for s in spec.get('series',[]) if s['column']==column),{})
            if style.get('visible') is False:
                continue
            label=style.get('label')
            if label is None:
                label=column_names[column] if column_names is not None else r'%('+str(columns.index(column)+1)+')'
            entries.append(r'\l('+str(columns.index(column)+1)+') '+label)
        # The formatting API addresses the first layer; other layers are rebuilt
        # with a native named Legend text object in their own layer.
        legend_text=rich_text('\n'.join(entries),spec.get('legendStyle',{}))
        if layer==0:
            await call('origin_format_legend',graph_name=graph,text=legend_text,font_size=round(spec.get('legendStyle',{}).get('size',spec['fontSize'])),font_family=spec.get('fontFamily','Arial'),show_frame=spec.get('legendFrame',False))
        else:
            await call('origin_add_graph_label',graph_name=graph,layer_index=layer,name='Legend',text=legend_text,font_size=spec['fontSize'])
        commands.append(f'layer -s {layer+1};')
        commands.append(object_style('legend',spec.get('legendStyle',{}),spec))
        commands.append(f'legend.showframe={int(spec.get("legendFrame",False))};')
        positions.append(f'legend.x={coordinate("x",spec["legendX"],spec)}; legend.y={coordinate("y",spec["legendY"],spec)};')
    if spec.get('titleText') and layer==0:
        await call('origin_add_graph_label',graph_name=graph,layer_index=layer,name='ibmTitle',text=rich_text(spec['titleText'],spec.get('titleStyle',{})),font_size=round(spec.get('titleStyle',{}).get('size',spec['titleSize'])))
        commands.append(f'layer -s {layer+1}; '+object_style('ibmTitle',{'x':TITLE_X,'y':TITLE_Y,'size':spec['titleSize'],**spec.get('titleStyle',{})},spec))
        positions.extend(f'ibmTitle.{axis_name}={coordinate(axis_name,{"x":TITLE_X,"y":TITLE_Y,**spec.get("titleStyle",{})}[axis_name],spec)};' for axis_name in ('x','y'))
    for index,note in enumerate(spec.get('annotations',[]) if layer==0 else []):
        name='ibmNote'+str(index)
        style={'x':note['x'],'y':note['y'],**note.get('style',{})}
        if note['kind']=='text':
            if not note['text'].strip():
                continue
            await call('origin_add_graph_label',graph_name=graph,layer_index=layer,name=name,text=rich_text(note['text'],style),font_size=style.get('size',spec['fontSize']))
            commands.append(f'layer -s {layer+1}; '+object_style(name,style,spec))
            positions.extend(f'{name}.{axis_name}={coordinate(axis_name,style[axis_name],spec)};' for axis_name in ('x','y'))
        else:
            # draw -l creates an ordinary two-point line; arrow heads and
            # rectangle shape are documented graphic-object properties.
            x1,y1=coordinate('x',note['x'],spec),coordinate('y',note['y'],spec)
            x2,y2=coordinate('x',note.get('x2',note['x']+.15),spec),coordinate('y',note.get('y2',note['y']+.15),spec)
            if note['kind'] in ('rectangle','ellipse'):
                # draw -b is the documented rectangle route. Ellipses use the
                # documented draw -c circle/ellipse route (verified separately).
                if note['kind']=='ellipse':
                    raise ValueError('当前 Origin 桥接未验证椭圆写入，请使用矩形、线条或箭头')
                commands.append(f'draw -n {name} -b; {name}.x1=({x1}); {name}.y1=({y1}); {name}.x3=({x2}); {name}.y3=({y2});')
                commands.append(f'{name}.fillcolor={color(note["fill"] or "#FFFFFF") if note.get("fill") else color("#FFFFFF")}; {name}.transparency={(1-note.get("opacity",1))*100};')
            else:
                commands.append(f'draw -n {name} -lm {{({x1}),({y1}),({x2}),({y2})}};')
                if note['kind']=='arrow':
                    # draw -l creates a reference line whose arrowhead flags are
                    # ignored by some Origin versions. Use an editable native
                    # open-chevron head, preserving a single logical endpoint
                    # pair in the replayable figure spec.
                    end_x,end_y=note.get('x2',note['x']+.15),note.get('y2',note['y']+.15)
                    vx=(end_x-note['x'])*spec['widthCm'];vy=(end_y-note['y'])*spec['heightCm']
                    length=math.hypot(vx,vy)
                    if length>0:
                        ux,uy=vx/length,vy/length;head=min(.30,length*.3);half=head*.45
                        for side in (-1,1):
                            hx=end_x+(-ux*head-side*uy*half)/spec['widthCm'];hy=end_y+(-uy*head+side*ux*half)/spec['heightCm']
                            head_name=name+('A' if side<0 else 'B')
                            commands.append(f'draw -n {head_name} -lm {{({coordinate("x",hx,spec)}),({coordinate("y",hy,spec)}),({x2}),({y2})}}; {head_name}.color={color(style.get("color","#000000"))}; {head_name}.lineWidth={note["lineWidth"]}; {head_name}.show={int(style.get("visible",True))};')
            commands.append(f'{name}.color={color(style.get("color","#000000"))}; {name}.lineWidth={note["lineWidth"]}; {name}.show={int(style.get("visible",True))};')
            commands.append(f'draw -n {name} -u;')
    if panel_number is not None and spec.get('layout',{}).get('labels',True):
        await call('origin_add_graph_label',graph_name=graph,layer_index=layer,name='ibmPanel',text='('+chr(97+panel_number)+')',font_size=spec['fontSize'])
        commands.append(f'layer -s {layer+1}; '+object_style('ibmPanel',{'x':.04,'y':.04},spec))
        positions.append(f'ibmPanel.x={coordinate("x",.04,spec)}; ibmPanel.y={coordinate("y",.04,spec)};')
    await call('origin_run_labtalk',script=f'win -a {graph}; layer -s {layer+1}; '+' '.join(commands))
    # Origin measures rich text lazily. Position after the new metrics exist,
    # otherwise a font/text change moves the centre by half the new box size.
    if settle:
        await call('origin_run_labtalk',script=f'win -a {graph}; layer -s {layer+1}; draw -uwi;')
        await call('origin_run_labtalk',script=f'win -a {graph}; layer -s {layer+1}; '+' '.join(positions)+' draw -uwi;')


async def add_panels(call,graph,sheet,spec,column_names=None):
    count=len(spec['yCols']);layout=spec['layout'];columns=min(layout['columns'],count);rows=math.ceil(count/columns)
    await call('origin_run_labtalk',script=f'win -a {graph}; layer -s 1; layer.unit=3; double ibmBaseFactor=layer.factor;')
    for index,column in enumerate(spec['yCols'][1:],1):
        await call('origin_add_inset',graph_name=graph,worksheet=f'[{sheet["book_name"]}]{sheet["sheet_name"]}!',x_col=spec['xCol'],y_cols=[column],plot_type=spec['kind'])
    geometry=[]
    gap=layout['gap'];width=(80-(columns-1)*gap)/columns;height=(76-(rows-1)*gap)/rows
    if width<5 or height<5:
        raise ValueError('面板间距过大，请减少列数或间距')
    for index in range(count):
        saved=next((p for p in layout['panels'] if p['index']==index),None)
        geometry.append(saved or {'index':index,'left':14+(index%columns)*(width+gap),'top':6+(index//columns)*(height+gap),'width':width,'height':height})
    await call('origin_run_labtalk',script=f'win -a {graph}; '+' '.join(f'layer -s {i+1}; layer.unit=1;' for i in range(count)))
    await call('origin_arrange_layers',graph_name=graph,rows=rows,columns=columns,layer_geometries=[{'layer_index':g['index'],**{k:g[k] for k in ('left','top','width','height')}} for g in geometry])
    # Resize-driven scale factors differ between a template layer and layadd.
    # Normalize them to the measured final layer width, keeping frame scaling.
    # This is per-panel geometry, not a universal fixed factor.
    for index in range(count):
        await call('origin_run_labtalk',script=f'win -a {graph}; layer -s {index+1}; layer.unit=3; layer.fixed=0; layer.factor=(ibmBaseFactor*layer.width/{spec["widthCm"]});')
    for index,column in enumerate(spec['yCols']):
        await apply_editor(call,graph,spec,[column],layer=index,panel_number=index,column_names=column_names)
    await call('origin_run_labtalk',script=f'win -a {graph}; doc -uw; pfit2l margin:=tight go:=1; doc -uw;')
    return geometry


def svg_scene(path):
    root=ET.parse(path).getroot();namespace='{http://www.originlab.com/namespaces/olab}'
    view=[float(n) for n in re.split(r'[, ]+',root.attrib['viewBox']) if n]
    objects={};frames={}
    for element in root.iter():
        scope=element.get(namespace+'scope','');match=re.match(r'Layer(\d+)\.(Plot(\d+)|Axis(\d+))',scope)
        if not match:
            continue
        layer=int(match[1]);key=f'series:{layer}:{match[3]}' if match[3] is not None else f'axis:{layer}:{match[4]}'
        objects.setdefault(key,{'key':key,'layer':layer,'scope':scope})
        if '.SubAxis0.Line' in scope and element.tag.endswith('polyline'):
            values=[float(n) for n in re.split(r'[, ]+',element.get('points','')) if n]
            if len(values)>=4:
                points=list(zip(values[::2],values[1::2]));frames.setdefault(layer,[]).extend(points)
    bounds=[]
    for layer,points in sorted(frames.items()):
        xs,ys=zip(*points)
        bounds.append({'index':layer,'left':min(xs)/view[2],'top':min(ys)/view[3],'width':(max(xs)-min(xs))/view[2],'height':(max(ys)-min(ys))/view[3]})
    return {'viewBox':view,'layers':bounds,'objects':list(objects.values())}
