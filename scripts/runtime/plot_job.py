"""Fixed iBM Lab data inspection / Origin renderer; never executes uploaded code."""
import asyncio
import contextlib
import csv
import datetime
import hashlib
import io
import json
import math
from pathlib import Path
import re
import shutil
import sys
import uuid
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parent))
from plot_editor import apply_editor,add_panels,svg_scene,position_editor,editor_readback,native_spec,physical_graph_info
from plot_collision import text_boxes,page_text_bounds

# Embedded Windows Python otherwise writes JSON in the local ANSI code page.
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')


def pixel_fingerprint(path):
    from PIL import Image
    with Image.open(path) as image:
        image=image.convert('RGBA')
        width,height=image.size
        pixels=hashlib.sha256(f'{width}x{height}:RGBA:'.encode()+image.tobytes()).hexdigest()
    return {'width':width,'height':height,'pixels':pixels}


def progress_preview(path,args):
    if not args.get('renderId') or not args.get('specHash'):
        return
    data=path.read_bytes()
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Origin 进度预览不是有效 PNG')
    info={'path':str(path),'fileName':path.name,'byteLength':len(data),'sha256':hashlib.sha256(data).hexdigest(),**pixel_fingerprint(path),'specHash':args['specHash'],'renderId':args['renderId'],'tier':'progress'}
    print(json.dumps({'event':'plot-preview','preview':info},ensure_ascii=False,allow_nan=False),file=sys.__stdout__,flush=True)


def inspect_table(args):
    import pandas as pd
    source = Path(args['path']).resolve(strict=True)
    output = Path(args['output']).resolve()
    output.mkdir(parents=True, exist_ok=True)
    header = int(args.get('headerRow', 0))
    if not -1 <= header <= 100:
        raise ValueError('表头行必须为 0–100 或 -1（无表头）')
    header = None if header == -1 else header
    extension = source.suffix.lower()
    if extension in ('.xlsx', '.xls'):
        if extension == '.xlsx':
            with zipfile.ZipFile(source) as archive:
                if sum(item.file_size for item in archive.infolist()) > 200 * 1024 * 1024:
                    raise ValueError('Excel 解压后超过 200 MB，请选择较小的工作簿')
        book = pd.ExcelFile(source)
        sheets = book.sheet_names
        sheet = args.get('sheet') or sheets[0]
        if sheet not in sheets:
            raise ValueError('所选工作表不存在')
        with book:
            try:
                frame = pd.read_excel(book, sheet_name=sheet, header=header, nrows=100001, keep_default_na=False, na_values=[''])
            except ValueError as error:
                if 'header' not in str(error).lower():raise
                frame=pd.DataFrame()
    elif extension in ('.csv', '.tsv', '.txt'):
        sheets, sheet = ['数据'], '数据'
        raw = source.read_bytes()
        encodings = ['utf-16'] if raw[:2] in (b'\xff\xfe', b'\xfe\xff') else ['utf-8-sig', 'gb18030', 'cp1252']
        for encoding in encodings:
            try:
                text = raw.decode(encoding)
                break
            except UnicodeError:
                text = None
        if text is None:
            raise ValueError('无法识别文本编码，请另存为 UTF-8 CSV')
        # csv.Sniffer chooses separators only; no values or rows are modified.
        try:
            delimiter = csv.Sniffer().sniff(text[:65536], delimiters=',\t;|').delimiter
        except csv.Error:
            delimiter = '\t' if extension == '.tsv' else ','
        frame = pd.read_csv(io.StringIO(text), sep=delimiter, header=header, nrows=100001, keep_default_na=False, na_values=[''])
    else:
        raise ValueError('支持 CSV、TSV、TXT、XLSX 和 XLS 文件')
    if len(frame) > 100000 or frame.shape[1] > 256 or frame.size > 2000000:
        raise ValueError('数据超过 10 万行、256 列或 200 万单元格，请拆分后导入')
    frame.columns = [str(name) if header is not None else f'Column {i+1}' for i, name in enumerate(frame.columns)]
    if any(len(name) > 160 or re.search(r'[\x00-\x1f]', name) for name in frame.columns):
        if extension in ('.xlsx','.xls'):frame=pd.DataFrame()
        else:raise ValueError('列名过长或含控制字符，请调整表头行')
    columns, warnings = [], []
    if frame.empty:warnings.append('所选工作表没有数据，请选择其他工作表或调整表头行')
    for i in range(frame.shape[1]):
        series = frame.iloc[:, i]
        present = series.dropna()
        values = pd.to_numeric(present, errors='coerce')
        numeric = len(present) > 0 and values.notna().all() and all(math.isfinite(float(v)) for v in values)
        is_date = len(present) > 0 and all(isinstance(v, (datetime.date, datetime.datetime, pd.Timestamp)) for v in present)
        kind = 'empty' if not len(present) else 'number' if numeric else 'date' if is_date else 'category'
        if numeric:
            frame.isetitem(i, pd.to_numeric(series, errors='coerce'))
        columns.append({'index': i, 'name': frame.columns[i], 'type': kind, 'count': len(present),
                        'missing': int(series.isna().sum()), 'unique': int(present.nunique()),
                        'min': float(values.min()) if numeric else None, 'max': float(values.max()) if numeric else None,
                        'monotonic': bool(values.is_monotonic_increasing or values.is_monotonic_decreasing) if numeric else False})
        if series.isna().any():
            warnings.append(f'{frame.columns[i]}：{int(series.isna().sum())} 个空值，绘图时保留缺失值')
        if not numeric and values.notna().any():
            warnings.append(f'{frame.columns[i]} 混有文本和数字，按类别处理；请核对表头行和单位行')
    destination = output / ('table-' + uuid.uuid4().hex[:12] + '.csv')
    frame.to_csv(destination, index=False, encoding='utf-8-sig')
    sample = []
    for row in frame.head(8).itertuples(index=False, name=None):
        sample.append([None if pd.isna(v) else float(v) if isinstance(v, (float, int)) else str(v)[:200] for v in row])
    return {'sheets': sheets, 'sheet': sheet, 'rows': len(frame), 'columns': columns, 'sample': sample,
            'warnings': warnings, 'normalizedPath': str(destination), 'normalizedSha256': hashlib.sha256(destination.read_bytes()).hexdigest()}


def lt_quote(value):
    text = str(value).replace('\\', '/')
    if any(c in text for c in ('"', '\n', '\r', '\x00')):
        raise ValueError('Origin 文件路径包含不支持的字符')
    return '"' + text + '"'


def page_fit_command(spec):
    return 'pfit2l margin:=tight go:=1;' if spec.get('pageFit')=='tight' else 'pfit2l margin:=border borderwid:=5 go:=1;'


async def stabilize_geometry(call,graph,output,raster,width,tight=False):
    """Bracket SVG export with identical raster renders before publishing hits."""
    check=output/'geometry-check.png'
    for attempt in range(3):
        commands=[]
        if tight:
            # The initial raster has settled native font metrics. Fit using
            # those metrics, with a small safety rim on bounded retries.
            fit='pfit2l margin:=tight go:=1;' if attempt==0 else f'pfit2l margin:=border borderwid:={attempt} go:=1;'
            commands.extend([fit,f'expGraph -sw tr1.width:={width} tr1.unit:=2 type:=png path:={lt_quote(output)} filename:="{raster.stem}" overwrite:=replace;'])
        commands.extend([f'expGraph -sw type:=svg path:={lt_quote(output)} filename:="figure" overwrite:=replace;',f'expGraph -sw tr1.width:={width} tr1.unit:=2 type:=png path:={lt_quote(output)} filename:="geometry-check" overwrite:=replace;'])
        # Commands remain sequential inside Origin. Separate files preserve
        # both raster snapshots while avoiding a bridge round trip per export.
        await call('origin_run_labtalk',script=f'win -o {graph} {{'+''.join(commands)+'};')
        before=pixel_fingerprint(raster)
        after=pixel_fingerprint(check)
        shutil.copyfile(check,raster)
        bounds=page_text_bounds(output/'figure.svg') if tight else None
        if before==after and (not tight or bounds['status']=='clear'):return bounds
    raise RuntimeError('Tight 页面仍有文字越界、无法验证的文字边界或不稳定布局；已保留上次有效图片，请调整文字后重试')


def make_native_input(source,output,columns=None):
    """Rename only a derived table's header, leaving every data field intact."""
    csv.field_size_limit(10_000_000)
    with Path(source).open('r',encoding='utf-8-sig',newline='') as original,Path(output).open('w',encoding='utf-8-sig',newline='') as derived:
        reader=csv.reader(original);writer=csv.writer(derived,lineterminator='\n')
        column_names=next(reader)
        selected=list(range(len(column_names))) if columns is None else columns
        writer.writerow(['iBMColumn_'+str(index+1) for index in selected])
        writer.writerows([row[index] if index<len(row) else '' for index in selected] for row in reader)
    return column_names


async def render_origin(args):
    import origin_mcp.server  # registers only the installed tool implementations
    from origin_mcp.tools._shared import mcp

    async def call(tool_name, **fields):
        result = await mcp.call_tool(tool_name, fields)
        body = result[1] if isinstance(result, tuple) and len(result) > 1 else None
        if body is None:
            blocks = result[0] if isinstance(result, tuple) else result
            body = json.loads(next(block.text for block in blocks if hasattr(block, 'text')))
        if not body.get('ok'):
            raise RuntimeError(body.get('message') or body.get('error') or tool_name + ' 调用失败')
        return body.get('data', {})

    source = Path(args['path']).resolve(strict=True)
    output = Path(args['output']).resolve()
    output.mkdir(parents=True, exist_ok=True)
    spec = args['spec']
    # Origin resolves names such as A/B as worksheet short names even when
    # those strings are CSV long names of other columns. Import a derived CSV
    # with unambiguous headers; restore display labels after plot binding.
    native_input=output/'origin-input.csv'
    column_names=make_native_input(source,native_input)
    kind = spec['kind']
    requested=spec['yCols'] if kind in ('box','histogram') else [spec['xCol']]+spec['yCols']
    packed=kind in ('bar','box') and requested!=list(range(requested[0],requested[0]+len(requested)))
    native_columns={column:index for index,column in enumerate(requested)} if packed else None
    if packed:make_native_input(source,native_input,columns=requested)
    native_names=[column_names[column] for column in requested] if packed else column_names
    if kind not in ('line', 'line_symbol', 'scatter', 'column', 'bar', 'box', 'histogram'):
        raise ValueError('不支持的图样式')
    before = await call('origin_list_project_folder')
    original_folder = before['folder']['path']
    active = await call('origin_run_labtalk', script='type "IBM_ACTIVE=%H";', capture_log=True)
    original_window = next((line.split('=', 1)[1] for line in active.get('message_log', {}).get('lines', []) if line.startswith('IBM_ACTIVE=')), '')
    name = 'iBM' + uuid.uuid4().hex[:12]
    folder = None
    try:
        folder = await call('origin_create_project_folder', name=name, activate=True, reuse_existing=False)
        fields = {'path': str(native_input), 'graph_name': name, 'title': spec['title']}
        panel_mode=spec.get('layout',{}).get('mode')=='panels'
        fixed_layout=args.get('layoutMode') in ('fixed','fixed-test','fixed-probe-test') and not panel_mode and args.get('tier')!='preview'
        initial_columns=spec['yCols'][:1] if panel_mode else spec['yCols']
        if args.get('dataOrigin') or packed:
            # Load the pre-imported workbook into our owned folder, not into a
            # replacement Origin project. Resolve names after load because
            # Origin may rename pages that collide with the user's project.
            if packed:
                imported=await call('origin_import_file',path=str(native_input),book_name='iBMPacked'+uuid.uuid4().hex[:10],sheet_name='Data',dctype='CSV',keep_dc=False)
                book={'name':imported['worksheet']['book_name']};loaded_sheet={'name':imported['worksheet']['sheet_name']}
                await call('origin_set_column_labels',book_name=book['name'],sheet_name=loaded_sheet['name'],labels=native_names,label_type='L')
            else:
                data_project=Path(args['dataOrigin']).resolve(strict=True)
                await call('origin_run_labtalk',script=f'pe_load fname:={lt_quote(data_project)} path:={lt_quote(folder["path"])};')
                entries=set((await call('origin_list_project_folder',path=folder['path'],recursive=True))['folder']['entries'])
                project=await call('origin_list_project')
                books=[book for book in project['workbooks'] if book['name'] in entries]
                if len(books)!=1 or len(books[0]['sheets'])!=1:
                    raise RuntimeError('Origin 数据工程工作表数量异常，无法安全绑定')
                book=books[0];loaded_sheet=book['sheets'][0]
            if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*',book['name']) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*',loaded_sheet['name']):
                raise RuntimeError('Origin 数据工作表名称无法安全绑定')
            templates={'line':('line','l'),'scatter':('scatter','s'),'line_symbol':('line','y'),'column':('column','c'),'bar':('bar','215'),'box':('box','206'),'histogram':('hist','219')}
            template,plot_type=templates[kind]
            selected=initial_columns if kind in ('box','histogram') else [spec['xCol']]+initial_columns
            if packed:selected=[native_columns[column] for column in selected]
            data_range=f'[{book["name"]}]{loaded_sheet["name"]}!('+','.join(str(c+1) for c in selected)+')'
            if plot_type.isdigit():
                if selected!=list(range(selected[0],selected[0]+len(selected))):
                    raise RuntimeError('此图型需要选择相邻的数据列')
                bin_width=next((s['binWidth'] for s in spec.get('series',[]) if s['column']==initial_columns[0] and s.get('binWidth') is not None),None) if kind=='histogram' else None
                if bin_width is not None:await call('origin_run_labtalk',script=f'double ibmPreviousHBS=@HBS; @HBS={bin_width};')
                try:
                    await call('origin_run_labtalk',script=f'win -a {book["name"]}; worksheet -s {selected[0]+1} 0 {selected[-1]+1} 0; worksheet -p {plot_type} {template}; win -r %H {name};')
                    if bin_width is not None:
                        # worksheet -p can ignore @HBS for the hist template.
                        # Materialize the requested bins before axis rescaling
                        # and styling; never touch binning in later replays.
                        await call('origin_run_labtalk',script=f'win -a {name}; range ibmHistogram=!1; set ibmHistogram -hbs {bin_width}; draw -uwi; layer -a;')
                finally:
                    if bin_width is not None:await call('origin_run_labtalk',script='@HBS=ibmPreviousHBS;')
                created={'graph':{'graph_name':name}}
            else:
                # add_plot(range) accepts one X/Y pair. Passing (X,Y1,Y2,...)
                # may create an empty graph or silently omit later series.
                pair=f'[{book["name"]}]{loaded_sheet["name"]}!({spec["xCol"]+1},{initial_columns[0]+1})'
                created=await call('origin_plot_from_range',data_range=pair,template=template,plot_type=plot_type,graph_name=name,title=spec['title'])
                for column in initial_columns[1:]:
                    await call('origin_add_plot_to_graph',worksheet=f'[{book["name"]}]{loaded_sheet["name"]}!',x_col=spec['xCol'],y_col=column,graph_name=created['graph']['graph_name'],plot_type=plot_type)
            plotted={'graph':created['graph'],'worksheet':{'book_name':book['name'],'sheet_name':loaded_sheet['name']}}
        elif kind in ('box', 'histogram'):
            histogram_options={'histogram_bin_width':next((s['binWidth'] for s in spec.get('series',[]) if s['column']==initial_columns[0] and s.get('binWidth') is not None),'auto')} if kind=='histogram' else {}
            plotted = await call('origin_plot_' + kind, **fields, y_cols=spec['yCols'], style_mode='origin_default',**histogram_options)
        else:
            plotted = await call('origin_plot', **fields, kind=kind, selected_cols=[spec['xCol']] + initial_columns, style_mode='origin_default')
        graph = plotted['graph']['graph_name']
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', graph):
            raise ValueError('Origin 返回了无效图名')
        # Confirm the imported roles and missing values before styling/export.
        # In particular, do not silently lose literal category codes such as NA
        # to the native importer's missing-value defaults.
        chosen = spec['yCols'] if kind in ('box', 'histogram') else [spec['xCol']] + spec['yCols']
        sheet = {key: plotted['worksheet'][key] for key in ('book_name', 'sheet_name')}
        if args.get('tier')!='preview':
            import pandas as pd
            expected = pd.read_csv(source, keep_default_na=False, na_values=[''])
            diagnosis = await call('origin_diagnose_worksheet', **sheet, columns=[native_columns[c] for c in chosen] if packed else chosen)
            if not diagnosis['passed'] or diagnosis['rows'] != len(expected):
                raise RuntimeError('Origin 导入后行数或有效数据异常，请检查缺失值及列映射')
            for col, report in zip(chosen, diagnosis['column_reports']):
                if report['missing'] != int(expected.iloc[:, col].isna().sum()):
                    raise RuntimeError('Origin 导入改变了缺失值数量，请核对类别代码（如 NA）或数据格式')
            if args.get('layoutMode')!='fast-legacy-test':
                await call('origin_read_worksheet', **sheet, columns=[native_columns[c] for c in chosen] if packed else chosen, max_rows=8)
        native=native_spec(spec)
        await call('origin_format_graph', graph_name=graph, x_label=native['xLabel'], y_label=native['yLabel'], show_legend=spec['showLegend'], rescale=True)
        for axis in ('x', 'y'):
            settings = native[axis + 'Axis']
            await call('origin_set_axis', graph_name=graph, axis=axis, scale=settings['scale'], title=native[axis+'Label'],
                       **({'start': settings['min']} if 'min' in settings else {}),
                       **({'end': settings['max']} if 'max' in settings else {}))
        info = await call('origin_get_graph_info', graph_name=graph)
        count = info['layers'][0]['plots_count']
        if count!=len(initial_columns):
            raise RuntimeError(f'Origin 曲线数量不匹配：期望 {len(initial_columns)}，实际 {count}')
        if spec['showLegend']:
            await call('origin_format_legend', graph_name=graph, font_size=spec['fontSize'], font_family='Arial', show_frame=False)
        # Values below are validated numbers. Labels go through declared MCP tools,
        # never through interpolated LabTalk source.
        script = (f'win -a {graph}; layer.unit=3; layer.fixed=0; layer.width={spec["widthCm"]}; layer.height={spec["heightCm"]}; '
                  f'xb.font=font(Arial); yl.font=font(Arial); xb.fsize={spec["titleSize"]}; yl.fsize={spec["titleSize"]}; '
                  f'layer.x.label.font=font(Arial); layer.y.label.font=font(Arial); layer.x.label.pt={spec["fontSize"]}; layer.y.label.pt={spec["fontSize"]}; '
                  'layer.x.thickness=3; layer.y.thickness=3; layer.x2.thickness=3; layer.y2.thickness=3; '
                  'layer.x.ticks=5; layer.y.ticks=5; layer.x2.ticks=0; layer.y2.ticks=0; ')
        if kind in ('line', 'line_symbol', 'scatter'):
            for i in range(count):
                script += f'range ibmP{i}=!{i+1}; set ibmP{i} -q 0; '
        if spec['showLegend']:
            # Fractions are in the layer frame, including logarithmic coordinates.
            for axis, fraction in [('x', native['legendX']), ('y', 1-native['legendY'])]:
                expression = (f'10^(log(layer.{axis}.from)+{fraction}*(log(layer.{axis}.to)-log(layer.{axis}.from)))'
                              if native[axis+'Axis']['scale'] == 'log10' else f'layer.{axis}.from+{fraction}*(layer.{axis}.to-layer.{axis}.from)')
                script += f'legend.{axis}={expression}; '
        if args.get('tier')!='preview' and not fixed_layout:
            script += 'pfit2l margin:=tight; layer.unit=; layer.width=; layer.height=; layer.fixed=; xb.fsize=; yl.fsize=; layer.x.label.pt=; layer.y.label.pt=;'
        readback = await call('origin_run_labtalk', script=script, capture_log=True)
        panel_geometry=await add_panels(call,graph,sheet,spec,column_names=column_names) if panel_mode else []
        if not panel_mode:
            await apply_editor(call,graph,spec,initial_columns,settle=not fixed_layout,column_names=column_names)
        await call('origin_set_column_labels',**sheet,labels=native_names,label_type='L')
        if args.get('tier')=='preview':
            # A quick raster is an editable-design aid, not a final export.
            # The full tier runs its own layout, readback and project export.
            await call('origin_run_labtalk',script=f'win -a {graph}; doc -uw; {page_fit_command(spec)} draw -uwi;')
            for index in range(len(spec['yCols']) if panel_mode else 1):
                await position_editor(call,graph,spec,layer=index,panel_number=index if panel_mode else None)
            raster=output/'quick.png'
            await call('origin_run_labtalk',script=f'win -o {graph} {{expGraph -sw tr1.width:=900 tr1.unit:=2 type:=png path:={lt_quote(output)} filename:="quick" overwrite:=replace;}};')
            data=raster.read_bytes()
            if len(data)<100 or not data.startswith(b'\x89PNG\r\n\x1a\n'):
                raise RuntimeError('Origin 快速预览无效')
            return {'preview':{'path':str(raster),'fileName':raster.name,'byteLength':len(data),'sha256':hashlib.sha256(data).hexdigest()},'pixels':pixel_fingerprint(raster),'tier':'preview','seriesCount':count}
        if fixed_layout:
            # Experimental fixed-page route. The caller must validate its
            # geometry and typography before using it as a production default.
            await call('origin_run_labtalk',script=f'win -a {graph}; doc -uw; draw -uwi;')
            await position_editor(call,graph,spec,redraw=False)
            if args.get('layoutMode')=='fixed-probe-test':
                await call('origin_run_labtalk',script=f'win -o {graph} {{expGraph -sw tr1.width:=900 tr1.unit:=2 type:=png path:={lt_quote(output)} filename:="metrics-probe" overwrite:=replace;}};')
            await call('origin_run_labtalk',script=f'win -a {graph}; {page_fit_command(spec)}')
            await call('origin_run_labtalk',script=f'win -o {graph} {{expGraph -sw tr1.width:=1800 tr1.unit:=2 type:=png path:={lt_quote(output)} filename:="figure" overwrite:=replace;}};')
            shutil.copyfile(output/'figure.png',output/'layout-probe-2.png')
            progress_preview(output/'layout-probe-2.png',args)
            for extension in ('pdf','svg'):
                await call('origin_run_labtalk',script=f'win -o {graph} {{expGraph -sw type:={extension} path:={lt_quote(output)} filename:="figure" overwrite:=replace;}};')
            await call('origin_run_labtalk',script=f'win -o {graph} {{expGraph -sw tr1.width:=1800 tr1.unit:=2 type:=png path:={lt_quote(output)} filename:="final-check" overwrite:=replace;}};')
            if pixel_fingerprint(output/'figure.png')!=pixel_fingerprint(output/'final-check.png'):
                if args.get('layoutMode')=='fixed':
                    fallback=await render_origin({**args,'layoutMode':'legacy','output':str(output/('legacy-'+uuid.uuid4().hex))})
                    fallback['readback']['layoutFallback']='固定页面的预览与最终导出不一致，已回退原布局。'
                    (Path(fallback['origin']['path']).parent/'layout-readback.json').write_text(json.dumps(fallback['readback'],ensure_ascii=False,indent=2),encoding='utf-8')
                    return fallback
                raise RuntimeError('固定页面在最终导出后发生变化，不能确认预览与工程一致；请使用原布局流程')
            readback=await editor_readback(call,graph,spec)
        else:
            readback=None
        if not panel_mode and not fixed_layout:
            await call('origin_run_labtalk',script=f'win -a {graph}; doc -uw; pfit2l margin:=tight go:=1; doc -uw; pfit2l margin:=tight go:=1;')
        # Native export settles rich-text metrics (including the output DPI).
        # Reapply centres after that first layout, then fit and publish exports.
        if not fixed_layout:
            await call('origin_export_graph',path=str(output/'layout-probe.png'),graph_name=graph,overwrite=False,width=1800)
            await call('origin_run_labtalk',script=f'win -a {graph}; {page_fit_command(spec)} draw -uwi;')
            await call('origin_export_graph',path=str(output/'layout-probe-2.png'),graph_name=graph,overwrite=False,width=1800)
            progress_preview(output/'layout-probe-2.png',args)
            offsets={}
            for attempt in range(2):
                for index in range(len(spec['yCols']) if panel_mode else 1):
                    await position_editor(call,graph,spec,layer=index,panel_number=index if panel_mode else None,offsets=offsets.get(index,{}))
                if spec.get('pageFit')=='tight':
                    await call('origin_run_labtalk',script=f'win -a {graph}; '+page_fit_command(spec))
                if args.get('layoutMode')=='fast-legacy-test':
                    commands=' '.join(f'expGraph -sw {"tr1.width:=1800 tr1.unit:=2 " if extension=="png" else ""}type:={extension} path:={lt_quote(output)} filename:="figure" overwrite:=replace;' for extension in ('png','pdf','svg'))
                    await call('origin_run_labtalk',script=f'win -o {graph} {{{commands}}};')
                else:
                    for extension in ('png', 'pdf','svg'):
                        raster='tr1.width:=1800 tr1.unit:=2 ' if extension=='png' else ''
                        await call('origin_run_labtalk',script=f'win -o {graph} {{expGraph -sw {raster}type:={extension} path:={lt_quote(output)} filename:="figure" overwrite:=replace;}};')
                readback=await editor_readback(call,graph,spec)
                if readback['passed']:break
                for row in readback['layers']:
                    previous=offsets.setdefault(row['layer'],{})
                    for check in row['positions']:
                        previous[check['property']]=previous.get(check['property'],0)+.5*check['signedError']
        page_bounds=await stabilize_geometry(call,graph,output,output/'figure.png',1800,tight=spec.get('pageFit')=='tight')
        if spec.get('pageFit')=='tight':
            await call('origin_run_labtalk',script=f'win -o {graph} {{expGraph -sw type:=pdf path:={lt_quote(output)} filename:="figure" overwrite:=replace;}};')
            await call('origin_run_labtalk',script=f'win -o {graph} {{expGraph -sw tr1.width:=1800 tr1.unit:=2 type:=png path:={lt_quote(output)} filename:="tight-final-check" overwrite:=replace;}};')
            if pixel_fingerprint(output/'figure.png')!=pixel_fingerprint(output/'tight-final-check.png'):
                raise RuntimeError('Tight 最终文档导出后布局变化，已保留原工程，请重试')
        # Refinement can intentionally compensate the requested Origin position.
        # Keep that diagnostic, but judge the saved result against the user's
        # local target, not against the intermediate compensated command.
        if args.get('referenceSpec') is not None:
            requested_readback=readback
            readback=await editor_readback(call,graph,args['referenceSpec'])
            readback['requestedPositionReadback']=requested_readback
            readback['targetBasis']='local-preview'
        else:
            readback['targetBasis']='requested-spec'
        if not readback['passed']:
            readback['warning']='Origin 导出后的文字位置存在偏差，请以实际预览为准；需要精确定位时请在 Origin 工程中调整。'
        try:
            readback['collision']=text_boxes(output/'figure.svg',[spec.get('xLabel'),spec.get('yLabel')])
        except Exception as error:
            readback['collision']={'status':'unverified','method':'estimated-svg-font-boxes','conflicts':[],'unverified':[str(error)[:200]],'boxes':[]}
        if fixed_layout and args.get('layoutMode')=='fixed' and (not readback['passed'] or readback['collision']['status']!='clear'):
            fallback=await render_origin({**args,'layoutMode':'legacy','output':str(output/('legacy-'+uuid.uuid4().hex))})
            fallback['readback']['layoutFallback']='固定页面未通过位置或文字验收，已回退原布局。'
            (Path(fallback['origin']['path']).parent/'layout-readback.json').write_text(json.dumps(fallback['readback'],ensure_ascii=False,indent=2),encoding='utf-8')
            return fallback
        (output/'layout-readback.json').write_text(json.dumps(readback,ensure_ascii=False,indent=2),encoding='utf-8')
        readback['pageBounds']=page_bounds
        readback['graph']=physical_graph_info(await call('origin_get_graph_info',graph_name=graph),spec)
        project = output / 'figure.opju'
        await call('origin_run_labtalk', script=f'pe_save fname:={lt_quote(project)} path:={lt_quote(folder["path"])} sub:=1 proj:=0;', capture_log=True)
        result = {'readback': readback,'scene':svg_scene(output/'figure.svg')}
        probe_fingerprint=pixel_fingerprint(output/'layout-probe-2.png')
        final_fingerprint=pixel_fingerprint(output/'figure.png')
        result['pixelVerification']={'probe':probe_fingerprint,'final':final_fingerprint,'equal':probe_fingerprint==final_fingerprint}
        result['scene']['panelGeometry']=panel_geometry
        # Map canvas handles to the actual exported layer frame, rather than
        # guessing page margins. Do not expose a handle if detection is ambiguous.
        from PIL import Image
        import numpy as np
        with Image.open(output / 'figure.png') as image:
            pixels = np.array(image.convert('RGB'))
        dark = pixels.max(axis=2) < 100
        height, width = dark.shape
        ys = np.flatnonzero(dark.sum(axis=1) > width * .5)
        xs = np.flatnonzero(dark.sum(axis=0) > height * .5)
        if len(xs) > 1 and len(ys) > 1 and xs[-1]-xs[0] > width*.3 and ys[-1]-ys[0] > height*.3:
            result['canvas'] = {'left': float(xs[0]/width), 'top': float(ys[0]/height),
                                'width': float((xs[-1]-xs[0])/width), 'height': float((ys[-1]-ys[0])/height)}
        for slot, extension in [('preview', 'png'), ('pdf', 'pdf'), ('origin', 'opju'),('svg','svg')]:
            path = output / ('figure.'+extension)
            data = path.read_bytes()
            if len(data) < 100:
                raise RuntimeError('Origin 输出文件为空或不完整：'+extension)
            if extension == 'png' and not data.startswith(b'\x89PNG\r\n\x1a\n'):
                raise RuntimeError('Origin 未输出有效的 PNG 图片')
            if extension == 'pdf' and not data.startswith(b'%PDF-'):
                raise RuntimeError('Origin 未输出有效的 PDF')
            result[slot] = {'path': str(path), 'fileName': path.name, 'byteLength': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        if args.get('_retain'):
            result['_session']={'graph':graph,'folder':folder['path'],'sheet':sheet,'columns':column_names,'spec':spec}
        return result
    finally:
        # Only the folder created by this invocation is owned by the workbench.
        # Restore the user context even when plotting/export fails.
        try:
            await call('origin_set_project_folder', path=original_folder)
            if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', original_window):
                await call('origin_run_labtalk', script=f'win -a {original_window};')
        finally:
            if folder and not (args.get('_retain') and locals().get('result',{}).get('_session')):
                await call('origin_delete_project_folder', path=folder['path'], recursive=True, confirm=True)


async def prepare_origin_data(args):
    """Save imported data in an isolated Origin folder without replacing the user's project."""
    import origin_mcp.server  # noqa: F401
    from origin_mcp.tools._shared import mcp

    async def call(tool_name, **fields):
        result = await mcp.call_tool(tool_name, fields)
        body = result[1] if isinstance(result, tuple) and len(result) > 1 else None
        if body is None:
            body = json.loads(next(block.text for block in result[0] if hasattr(block, 'text')))
        if not body.get('ok'):
            raise RuntimeError(body.get('message') or body.get('error') or tool_name + ' 调用失败')
        return body.get('data', {})

    source = Path(args['path']).resolve(strict=True)
    output = Path(args['output']).resolve()
    output.mkdir(parents=True, exist_ok=True)
    native_input = output / 'origin-input.csv'
    column_names = make_native_input(source, native_input)
    original = (await call('origin_list_project_folder'))['folder']['path']
    active = await call('origin_run_labtalk', script='type "IBM_ACTIVE=%H";', capture_log=True)
    window = next ( (line.split('=', 1)[1] for line in active.get('message_log', {}).get('lines', []) if line.startswith('IBM_ACTIVE=')), '')
    folder = None
    try:
        folder = await call('origin_create_project_folder', name='iBMData'+uuid.uuid4().hex[:10], activate=True, reuse_existing=False)
        # New pandas string dtypes are incompatible with Origin's from_df
        # adapter. Use its native CSV connector for categorical tables.
        categorical=False
        with native_input.open(encoding='utf-8-sig',newline='') as stream:
            rows=csv.reader(stream);next(rows)
            for row in rows:
                for value in row:
                    if value.strip():
                        try:float(value)
                        except ValueError:categorical=True;break
                if categorical:break
        imported = await call('origin_import_file',path=str(native_input),book_name='iBMTable'+uuid.uuid4().hex[:10],sheet_name='Data',dctype='CSV',keep_dc=False) if categorical else await call('origin_import_table', path=str(native_input))
        sheet = imported['worksheet']
        await call('origin_set_column_labels', book_name=sheet['book_name'], sheet_name=sheet['sheet_name'], labels=column_names, label_type='L')
        project = output / 'data.opju'
        await call('origin_run_labtalk', script=f'pe_save fname:={lt_quote(project)} path:={lt_quote(folder["path"])} sub:=1 proj:=0;', capture_log=True)
        data = project.read_bytes()
        if len(data) < 100:
            raise RuntimeError('Origin 数据工程为空或不完整')
        return {'path': str(project), 'fileName': project.name, 'byteLength': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    finally:
        try:
            await call('origin_set_project_folder', path=original)
            if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', window):
                await call('origin_run_labtalk', script=f'win -a {window};')
        finally:
            if folder:
                await call('origin_delete_project_folder', path=folder['path'], recursive=True, confirm=True)


def origin_connection_status():
    # Probe the existing GUI bridge only; never launch, hide or alter Origin.
    from origin_mcp.bridge_client import request_bridge
    info = request_bridge('ping', timeout=2.0)
    return {'bridgeVersion': info.get('version', ''), 'originPid': info.get('origin_pid')}


def main():
    payload=sys.argv[2]
    action, args = sys.argv[1], json.loads(Path(payload[1:]).read_text(encoding='utf-8') if payload.startswith('@') else payload)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            if action == 'layout':
                from plot_layout import compose_layout
                result = compose_layout(args)
            elif action == 'image':
                from plot_image import image_job
                result = image_job(args)
            else:
                result = inspect_table(args) if action == 'inspect' else asyncio.run(render_origin(args)) if action == 'render' else asyncio.run(prepare_origin_data(args)) if action == 'prepare' else origin_connection_status() if action == 'status' else None
            if result is None:
                raise ValueError('不支持的绘图操作')
        print(json.dumps({'ok': True, 'result': result}, ensure_ascii=False, allow_nan=False))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == '__main__':
    main()
