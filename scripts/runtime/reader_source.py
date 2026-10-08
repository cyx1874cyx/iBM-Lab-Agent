"""Fixed, local PDF extraction. No network or model credentials."""
import json, pathlib, sys, zipfile, re, math

def emit_result(result):
    """Frame one machine result independently of native-library diagnostics."""
    print('\nIBM_READER_RESULT_V1:' + json.dumps(result, ensure_ascii=True), flush=True)

def reading_context(blocks, dimensions):
    """Column order within full-width bands, then cross-column/page continuity."""
    ordered = []
    for page_no, width, height in dimensions:
        text = [b for b in blocks if b['page'] == page_no and b['kind'] == 'text']
        wide = [b for b in text if b['bbox'][2] - b['bbox'][0] > width * .65]
        narrow = [b for b in text if b not in wide]
        left = [b for b in narrow if b['bbox'][0] < width * .45]
        right = [b for b in narrow if b['bbox'][0] >= width * .45]
        columns = any(len(b['original']) > 70 for b in left) and any(len(b['original']) > 70 for b in right)
        for b in text:
            b['column'] = (0 if b in left else 1) if columns and b not in wide else -1
            b['role'] = 'margin' if b['bbox'][1] < height * .055 or b['bbox'][3] > height * .945 else 'body'
        remaining = list(narrow)
        for anchor in sorted(wide, key=lambda b:(b['bbox'][1],b['id'])):
            band = [b for b in remaining if b['bbox'][1] < anchor['bbox'][1]]
            ordered.extend(sorted(band, key=lambda b:(b['column'] if columns else 0,b['bbox'][1],b['bbox'][0],b['id'])))
            remaining = [b for b in remaining if b not in band]
            ordered.append(anchor)
        ordered.extend(sorted(remaining, key=lambda b:(b['column'] if columns else 0,b['bbox'][1],b['bbox'][0],b['id'])))
    body = [b for b in ordered if b['role'] == 'body']
    groups = []
    for previous, current in zip(body, body[1:]):
        across = previous['page'] != current['page'] or previous['column'] != current['column'] or previous['id'].rsplit('-',1)[0] == current['id'].rsplit('-',1)[0]
        a, b = previous['original'].rstrip(), current['original'].lstrip()
        if across and a and b and not re.search(r'[.!?。！？:;]$',a) and re.match(r'[a-z(]',b) and abs(previous.get('fontSize',10)-current.get('fontSize',10)) < 2.5:
            if groups and groups[-1]['ids'][-1] == previous['id']:
                group = groups[-1]
            else:
                group = {'id':'continuity-'+previous['id'],'ids':[previous['id']]}
                groups.append(group)
            group['ids'].append(current['id'])
    by_id = {b['id']:b for b in ordered}
    for group in groups:
        original = ''
        for identity in group['ids']:
            fragment = by_id[identity]['original']
            original = original[:-1]+fragment if original.endswith('-') else original+(' ' if original else '')+fragment
            by_id[identity]['continuationGroup'] = group['id']
        group['original'] = original
    for i, block in enumerate(ordered):
        block['readingOrder'] = i
    return sorted(blocks,key=lambda b:(b['page'],b.get('readingOrder',100000),b['id'])),groups

def figure_ocr(image_path, clip, identity, page_no, engine):
    from PIL import Image
    import numpy as np
    image = Image.open(image_path).convert('RGB')
    result, _ = engine(str(image_path))
    result = list(result or [])
    # A second orientation recovers vertical axes that the line detector misses.
    rotated, _ = engine(np.ascontiguousarray(np.rot90(np.asarray(image)[:, :, ::-1])))
    for quad, text, confidence in rotated or []:
        mapped = [[image.width-1-p[1],p[0]] for p in quad]
        box = [min(p[0] for p in mapped),min(p[1] for p in mapped),max(p[0] for p in mapped),max(p[1] for p in mapped)]
        if box[3]-box[1] < (box[2]-box[0])*1.8:
            continue
        duplicate = False
        for existing, _, _ in result:
            other = [min(p[0] for p in existing),min(p[1] for p in existing),max(p[0] for p in existing),max(p[1] for p in existing)]
            overlap = max(0,min(box[2],other[2])-max(box[0],other[0]))*max(0,min(box[3],other[3])-max(box[1],other[1]))
            if overlap > .35*min((box[2]-box[0])*(box[3]-box[1]),(other[2]-other[0])*(other[3]-other[1])):
                duplicate = True
                break
        if not duplicate:
            result.append([mapped,text,confidence])
    found=[]
    for index, (quad, text, confidence) in enumerate(result or [],1):
        if len(re.findall('[A-Za-z]',text)) < 2:
            continue
        x0,y0,x1,y1=min(p[0] for p in quad),min(p[1] for p in quad),max(p[0] for p in quad),max(p[1] for p in quad)
        if x1-x0 < 2 or y1-y0 < 2:
            continue
        # Most frequent edge color, to cover only lettering rather than the diagram.
        edge=[]
        for x in range(max(0,int(x0)-1),min(image.width,int(x1)+2)):
            for y in [max(0,int(y0)-1),min(image.height-1,int(y1)+1)]:
                edge.append(image.getpixel((x,y)))
        background=max(set(edge),key=edge.count) if edge else (255,255,255)
        sx,sy=clip.width/image.width,clip.height/image.height
        found.append({'id':f'{identity}-ocr{index}','page':page_no,'kind':'figure-text','original':text,
                      'bbox':[clip.x0+x0*sx,clip.y0+y0*sy,clip.x0+x1*sx,clip.y0+y1*sy],
                      'image':pathlib.Path(image_path).name,'confidence':float(confidence),
                      'background':[c/255 for c in background], 'rotation':90 if y1-y0 > (x1-x0)*1.8 else 0,
                      'fontSize':max(5,min((x1-x0)*sx,(y1-y0)*sy)*.85)})
    return found

def compose_pdf(source, directory):
    """Replace translated text in its original page regions; keep source artwork."""
    import pymupdf, html, os
    out = pathlib.Path(directory)
    data = json.loads((out / 'reader.json').read_text(encoding='utf-8'))
    warnings, translated = [], 0
    with pymupdf.open(source) as doc:
        for number, page in enumerate(doc, 1):
            native = page.get_text('dict', sort=True)['blocks']
            jobs = []
            for index, block in enumerate(native, 1):
                if block['type'] != 0:
                    continue
                prefix = f'p{number}-b{index}-'
                parts = [b for b in data['blocks'] if b['kind'] == 'text' and b['id'].startswith(prefix)]
                if not parts:
                    continue
                zh = ''.join(data['translations'].get(b['id'], {}).get('zh', '') for b in parts)
                if not zh.strip():
                    raise ValueError(f'第 {number} 页存在未翻译文本')
                spans = [s for line in block['lines'] for s in line['spans']]
                size = max(s['size'] for s in spans)
                color = spans[0].get('color', 0)
                rect = pymupdf.Rect(block['bbox']) & page.rect
                direction = block['lines'][0].get('dir', (1, 0))
                rotation = (round(-math.degrees(math.atan2(direction[1], direction[0])) / 90) * 90) % 360
                # Allow a little leading without crossing neighbouring artwork/text.
                bottom = min(page.rect.y1 - 2, rect.y1 + max(2, size * .5))
                for other in native:
                    r = pymupdf.Rect(other['bbox'])
                    if r.y0 >= rect.y1 - .2 and r.x0 < rect.x1 and r.x1 > rect.x0:
                        bottom = min(bottom, r.y0 - .5)
                if rotation not in (90, 270):
                    rect.y1 = max(rect.y1, bottom)
                flags = spans[0].get('flags', 0)
                jobs.append((rect, zh, size, color, bool(flags & 16), rotation, parts[0]['id']))
                # No white paint over figures/backgrounds; remove only source text.
                page.add_redact_annot(block['bbox'], fill=None, cross_out=False)
            scanned = [b for b in data['blocks'] if b['page'] == number and b['kind'] == 'scan']
            if scanned:
                raise ValueError(f'第 {number} 页为扫描页，需要带位置的 OCR 后才能生成保留版式 PDF；已保存译文，可继续处理')
            links = page.get_links()
            if jobs:
                page.apply_redactions(images=0, graphics=0, text=0)
            for rect, zh, size, color, bold, rotation, identity in jobs:
                css = f'*{{margin:0;padding:0}} body{{font-family:serif;font-size:{size}pt;line-height:1.12;color:#{color:06x};font-weight:{"bold" if bold else "normal"}}}'
                spare, scale = page.insert_htmlbox(rect, html.escape(' '.join(zh.split())), css=css, scale_low=.35, rotate=rotation)
                if spare < 0:
                    raise ValueError(f'第 {number} 页文本块 {identity} 译文无法排入原位置（{rect.width:.1f}×{rect.height:.1f} pt，方向 {rotation}°），未登记 PDF')
                if size * scale < 5:
                    warnings.append(f'第 {number} 页一处译文字号较小（{size * scale:.1f} pt）')
                translated += 1
            for block in [b for b in data['blocks'] if b['page']==number and b['kind']=='figure-text']:
                zh=data['translations'].get(block['id'],{}).get('zh','')
                if not zh.strip():
                    raise ValueError(f'第 {number} 页图片文字尚未翻译')
                rect=pymupdf.Rect(block['bbox']) & page.rect
                page.draw_rect(rect,color=None,fill=tuple(block.get('background',[1,1,1])),overlay=True)
                spare,scale=page.insert_htmlbox(rect,html.escape(zh),css=f'*{{margin:0;padding:0}} body{{font-family:serif;font-size:{block.get("fontSize",8)}pt;line-height:1}}',scale_low=.3,rotate=block.get('rotation',0))
                if spare<0:
                    raise ValueError(f'第 {number} 页图中文字无法排入原位置')
                if block.get('confidence',1)<.8:
                    warnings.append(f'第 {number} 页图中文字识别置信度较低，请对照原图复核')
                if block.get('fontSize',8)*scale<5:
                    warnings.append(f'第 {number} 页一处图片译文字号较小，请放大阅读')
                translated += 1
            for link in links:
                # Redaction removes intersecting links. Restore their source targets.
                if any(pymupdf.Rect(link['from']).intersects(job[0]) for job in jobs):
                    link.pop('xref', None)
                    link.pop('id', None)
                    page.insert_link(link)
        if not translated:
            raise ValueError('没有可排版译文块')
        doc.set_metadata({**doc.metadata, 'subject': 'iBM Agent Chinese translation; source layout preserved'})
        temp = out / 'translated.pdf.tmp'
        doc.subset_fonts()
        doc.save(temp, garbage=4, deflate=True)
        with pymupdf.open(temp) as check:
            if len(check) != len(doc) or not any(p.get_text().strip() for p in check):
                raise ValueError('译文 PDF 完整性校验失败')
        os.replace(temp, out / 'translated.pdf')
        result = {'pageCount': len(doc), 'blocks': translated, 'warnings': warnings, 'layoutVersion': 3}
        (out / 'pdf-layout.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
        emit_result(result)

def main():
    mode, source = sys.argv[1:3]
    if mode == 'compose':
        compose_pdf(source, sys.argv[3])
        return
    if mode == 'zip-list':
        with zipfile.ZipFile(source) as archive:
            entries = [{'name': x.filename, 'bytes': x.file_size, 'index': i, 'pdf': x.filename.lower().endswith('.pdf')}
                       for i, x in enumerate(archive.infolist()) if not x.is_dir()]
            if len(entries) > 2000:
                raise ValueError('SI 压缩包超过 2000 个文件')
            emit_result({'entries': entries})
        return
    if mode == 'zip-pdf':
        import base64
        with zipfile.ZipFile(source) as archive:
            info = archive.infolist()[int(sys.argv[3])]
            if not info.filename.lower().endswith('.pdf') or info.file_size > 100 * 1024 * 1024 or info.flag_bits & 1:
                raise ValueError('仅支持未加密、100 MB 内的 SI PDF')
            data = archive.read(info)
            if not data.startswith(b'%PDF'):
                raise ValueError('SI 文件不是有效 PDF')
            emit_result({'base64': base64.b64encode(data).decode(), 'name': pathlib.PurePosixPath(info.filename).name})
        return
    import pymupdf
    out = pathlib.Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    blocks, scanned, dimensions = [], [], []
    engine = None
    with pymupdf.open(source) as doc:
        if doc.needs_pass or len(doc) > 2000:
            raise ValueError('PDF 加密或超过 2000 页')
        for page_no, page in enumerate(doc, 1):
            dimensions.append((page_no,page.rect.width,page.rect.height))
            page_blocks = page.get_text('dict', sort=True)['blocks']
            text_count = 0
            for index, block in enumerate(page_blocks, 1):
                block_id = f'p{page_no}-b{index}'
                if block['type'] == 0:
                    text = '\n'.join(''.join(span['text'] for span in line['spans']) for line in block['lines']).strip()
                    if not text:
                        continue
                    text = re.sub(r'(?<=[A-Za-z])-\s*\n\s*(?=[a-z])','',text)
                    text = re.sub(r'\s*\n\s*',' ',text)
                    text_count += len(text)
                    # Bound model batch sizes without silently dropping text.
                    for part, start in enumerate(range(0, len(text), 3000), 1):
                        spans=[s for line in block['lines'] for s in line['spans']]
                        blocks.append({'id': f'{block_id}-{part}', 'page': page_no, 'kind': 'text', 'original': text[start:start+3000], 'bbox':list(block['bbox']), 'fontSize':max(s['size'] for s in spans)})
                elif block['type'] == 1:
                    image_name = f'{block_id}.png'
                    clip = pymupdf.Rect(block['bbox']) & page.rect
                    if clip.is_empty:
                        continue
                    scale = min(1.5, 1600 / max(clip.width, clip.height, 1))
                    page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip, alpha=False).save(out / image_name)
                    blocks.append({'id': block_id, 'page': page_no, 'kind': 'image', 'image': image_name})
                    if engine is None:
                        from rapidocr_onnxruntime import RapidOCR
                        engine=RapidOCR(intra_op_num_threads=1,inter_op_num_threads=1)
                    blocks.extend(figure_ocr(out/image_name,clip,block_id,page_no,engine))
            if text_count < 8:
                scanned.append(page_no)
                image_name = f'p{page_no}-scan.png'
                page.get_pixmap(matrix=pymupdf.Matrix(min(1.5, 1600/max(page.rect.width, page.rect.height)),
                                                     min(1.5, 1600/max(page.rect.width, page.rect.height))), alpha=False).save(out/image_name)
                blocks.append({'id': f'p{page_no}-scan', 'page': page_no, 'kind': 'scan', 'image': image_name,
                               'original': '[此页无可靠文本层，请读取页面图像并逐段转写、翻译，勿概括] '})
            else:
                # Retain vector figures/tables as source crops, including labels.
                groups = []
                for drawing in page.get_drawings()[:3000]:
                    rect = pymupdf.Rect(drawing['rect'])
                    rect = (rect + (-2, -2, 2, 2)) & page.rect
                    if rect.is_empty:
                        continue
                    merged = True
                    while merged:
                        merged = False
                        for previous in list(groups):
                            if (rect + (-6, -6, 6, 6)).intersects(previous):
                                rect |= previous
                                groups.remove(previous)
                                merged = True
                    groups.append(rect)
                raster = [pymupdf.Rect(b['bbox']) for b in page_blocks if b['type'] == 1]
                for index, rect in enumerate(groups, 1):
                    if rect.width < 40 or rect.height < 30 or any((rect & image).get_area() > rect.get_area() * .6 for image in raster):
                        continue
                    image_name = f'p{page_no}-v{index}.png'
                    scale = min(1.5, 1600 / max(rect.width, rect.height, 1))
                    page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=rect, alpha=False).save(out/image_name)
                    blocks.append({'id': f'p{page_no}-v{index}', 'page': page_no, 'kind': 'image', 'image': image_name})
        blocks,groups=reading_context(blocks,dimensions)
        result = {'schemaVersion': 2, 'pageCount': len(doc), 'scannedPages': scanned, 'blocks': blocks,'continuityGroups':groups,'ocrEngine':'rapidocr-onnxruntime-1.4.4' if engine else None}
    (out / 'source.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    emit_result({'pageCount': result['pageCount'], 'blockCount': len(blocks), 'scannedPages': scanned})

if __name__ == '__main__':
    main()
