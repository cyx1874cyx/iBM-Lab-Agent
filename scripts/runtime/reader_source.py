"""Fixed, local PDF extraction. No network or model credentials."""
import json, pathlib, sys, zipfile

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
                # Allow a little leading without crossing neighbouring artwork/text.
                bottom = min(page.rect.y1 - 2, rect.y1 + max(2, size * .5))
                for other in native:
                    r = pymupdf.Rect(other['bbox'])
                    if r.y0 >= rect.y1 - .2 and r.x0 < rect.x1 and r.x1 > rect.x0:
                        bottom = min(bottom, r.y0 - .5)
                rect.y1 = max(rect.y1, bottom)
                flags = spans[0].get('flags', 0)
                jobs.append((rect, zh, size, color, bool(flags & 16)))
                # No white paint over figures/backgrounds; remove only source text.
                page.add_redact_annot(block['bbox'], fill=None, cross_out=False)
            scanned = [b for b in data['blocks'] if b['page'] == number and b['kind'] == 'scan']
            if scanned:
                raise ValueError(f'第 {number} 页为扫描页，需要带位置的 OCR 后才能生成保留版式 PDF；已保存译文，可继续处理')
            links = page.get_links()
            if jobs:
                page.apply_redactions(images=0, graphics=0, text=0)
            for rect, zh, size, color, bold in jobs:
                css = f'*{{margin:0;padding:0}} body{{font-family:serif;font-size:{size}pt;line-height:1.12;color:#{color:06x};font-weight:{"bold" if bold else "normal"}}}'
                spare, scale = page.insert_htmlbox(rect, html.escape(' '.join(zh.split())), css=css, scale_low=.35)
                if spare < 0:
                    raise ValueError(f'第 {number} 页译文无法排入原位置，未登记 PDF')
                if size * scale < 5:
                    warnings.append(f'第 {number} 页一处译文字号较小（{size * scale:.1f} pt）')
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
        result = {'pageCount': len(doc), 'blocks': translated, 'warnings': warnings, 'layoutVersion': 1}
        (out / 'pdf-layout.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=True))

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
            print(json.dumps({'entries': entries}, ensure_ascii=True))
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
            print(json.dumps({'base64': base64.b64encode(data).decode(), 'name': pathlib.PurePosixPath(info.filename).name}))
        return
    import pymupdf
    out = pathlib.Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    blocks, scanned = [], []
    with pymupdf.open(source) as doc:
        if doc.needs_pass or len(doc) > 2000:
            raise ValueError('PDF 加密或超过 2000 页')
        for page_no, page in enumerate(doc, 1):
            page_blocks = page.get_text('dict', sort=True)['blocks']
            text_count = 0
            for index, block in enumerate(page_blocks, 1):
                block_id = f'p{page_no}-b{index}'
                if block['type'] == 0:
                    text = '\n'.join(''.join(span['text'] for span in line['spans']) for line in block['lines']).strip()
                    if not text:
                        continue
                    text_count += len(text)
                    # Bound model batch sizes without silently dropping text.
                    for part, start in enumerate(range(0, len(text), 3000), 1):
                        blocks.append({'id': f'{block_id}-{part}', 'page': page_no, 'kind': 'text', 'original': text[start:start+3000]})
                elif block['type'] == 1:
                    image_name = f'{block_id}.png'
                    clip = pymupdf.Rect(block['bbox']) & page.rect
                    if clip.is_empty:
                        continue
                    scale = min(1.5, 1600 / max(clip.width, clip.height, 1))
                    page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip, alpha=False).save(out / image_name)
                    blocks.append({'id': block_id, 'page': page_no, 'kind': 'image', 'image': image_name})
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
        result = {'schemaVersion': 1, 'pageCount': len(doc), 'scannedPages': scanned, 'blocks': blocks}
    (out / 'source.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'pageCount': result['pageCount'], 'blockCount': len(blocks), 'scannedPages': scanned}))

if __name__ == '__main__':
    main()
