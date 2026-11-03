"""Compose a millimetre page from immutable image / vector PDF snapshots."""
import io
import math
from pathlib import Path
from PIL import Image
import pymupdf as pdf
from plot_image import artifact

MM = 72 / 25.4


def font(page, text):
    unicode = any(ord(c) > 255 for c in text)
    choices = ['C:/Windows/Fonts/msyh.ttc'] if unicode else ['C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
    for name in choices:
        if Path(name).is_file():
            key = 'LayoutUnicode' if unicode else 'LayoutSans'
            page.insert_font(fontname=key, fontfile=name)
            return key
    return 'china-s' if unicode else 'helv'


def rgb(value):
    return tuple(int(value[i:i+2], 16)/255 for i in (1, 3, 5))


def label(index):
    text = ''
    while True:
        text = chr(97+index % 26) + text
        index = index//26-1
        if index < 0:
            return '('+text+')'


def compose_layout(args):
    doc, dpi = args['doc'], args.get('dpi', 300)
    page_spec = doc['page']
    width, height = page_spec['w'], page_spec['h']
    if dpi not in (150, 300, 600) or not 10 <= width <= 600 or not 10 <= height <= 600:
        raise ValueError('页面尺寸或分辨率无效')
    if math.ceil(width/25.4*dpi)*math.ceil(height/25.4*dpi) > 40_000_000:
        raise ValueError('导出超过 4000 万像素，请缩小页面或降低分辨率')
    output = Path(args['output']).resolve()
    output.mkdir(parents=True, exist_ok=True)
    assets = {a['id']: a for a in args['assets']}
    document = pdf.open()
    page = document.new_page(width=width*MM, height=height*MM)
    if not page_spec.get('transparent'):
        page.draw_rect(page.rect, color=None, fill=rgb(page_spec.get('background', '#FFFFFF')))
    vector_count = 0
    panel_index = 0
    for obj in doc['objects']:
        x, y, w, h = (obj[k] for k in ('x', 'y', 'w', 'h'))
        if not all(math.isfinite(v) for v in (x, y, w, h)) or min(x, y) < 0 or min(w, h) <= 0 or x+w > width+.001 or y+h > height+.001:
            raise ValueError('有对象超出页面，请调整位置或尺寸')
        rect = pdf.Rect(x*MM, y*MM, (x+w)*MM, (y+h)*MM)
        opacity = obj.get('opacity', 1)
        if obj['type'] == 'panel':
            asset = assets[obj['assetId']]
            crop = obj.get('crop', {'x': 0, 'y': 0, 'w': 1, 'h': 1})
            if min(crop['x'], crop['y']) < 0 or min(crop['w'], crop['h']) <= 0 or crop['x']+crop['w'] > 1+1e-9 or crop['y']+crop['h'] > 1+1e-9:
                raise ValueError('图片裁剪区域无效')
            rotation = obj.get('rotation', 0)
            if rotation not in (0, 90, 180, 270):
                raise ValueError('旋转角度无效')
            if asset.get('vector') and not obj.get('flipH') and not obj.get('flipV') and opacity == 1:
                with pdf.open(asset['vector']['path']) as source:
                    native = source[0].rect
                    clip = pdf.Rect(native.x0+crop['x']*native.width, native.y0+crop['y']*native.height,
                                    native.x0+(crop['x']+crop['w'])*native.width, native.y0+(crop['y']+crop['h'])*native.height)
                    page.show_pdf_page(rect, source, 0, keep_proportion=False, rotate=(360-rotation) % 360, clip=clip)
                vector_count += 1
            else:
                with Image.open(asset['image']['path']) as source:
                    image = source.convert('RGBA')
                iw, ih = image.size
                box = (round(crop['x']*iw), round(crop['y']*ih), round((crop['x']+crop['w'])*iw), round((crop['y']+crop['h'])*ih))
                if box[2] <= box[0] or box[3] <= box[1]:
                    raise ValueError('裁剪区域至少需要一个像素')
                image = image.crop(box)
                if obj.get('flipH'):
                    image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                if obj.get('flipV'):
                    image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                if rotation:
                    image = image.transpose({90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180, 270: Image.Transpose.ROTATE_90}[rotation])
                if opacity < 1:
                    image.putalpha(image.getchannel('A').point(lambda a: round(a*opacity)))
                stream = io.BytesIO()
                image.save(stream, format='PNG')
                page.insert_image(rect, stream=stream.getvalue(), keep_proportion=False)
            labels = doc.get('labels', {})
            if labels.get('enabled', True):
                text = label(panel_index)
                size = labels.get('size', 10)
                px = max(0, min(rect.x0+labels.get('dx', 0)*MM, page.rect.width-len(text)*size*.6))
                py = rect.y0+labels.get('dy', 1)*MM+size if labels.get('position', 'outside') == 'inside' else rect.y0-labels.get('dy', 1)*MM
                if py < size*1.1:
                    py = rect.y0+labels.get('dy', 1)*MM+size
                py = max(size*1.1, min(py, page.rect.height-size*.2))
                page.insert_text((px, py), text,
                                 fontname=font(page, text), fontsize=size, color=rgb(labels.get('color', '#000000')))
            panel_index += 1
        else:
            color = rgb(obj.get('color', '#000000'))
            stroke = obj.get('lineWidth', .5)
            if obj['type'] == 'rect':
                page.draw_rect(rect, color=color, width=stroke, stroke_opacity=opacity)
            elif obj['type'] == 'arrow':
                ax, ay, bx, by = {'se': (0, 0, 1, 1), 'sw': (1, 0, 0, 1), 'ne': (0, 1, 1, 0), 'nw': (1, 1, 0, 0), 'right': (0, .5, 1, .5), 'left': (1, .5, 0, .5), 'up': (.5, 1, .5, 0), 'down': (.5, 0, .5, 1)}[obj.get('direction', 'se')]
                start, end = pdf.Point(rect.x0+ax*rect.width, rect.y0+ay*rect.height), pdf.Point(rect.x0+bx*rect.width, rect.y0+by*rect.height)
                page.draw_line(start, end, color=color, width=stroke, stroke_opacity=opacity)
                angle = math.atan2(end.y-start.y, end.x-start.x)
                head = 5+stroke*2
                points = [end, pdf.Point(end.x-head*math.cos(angle-.45), end.y-head*math.sin(angle-.45)), pdf.Point(end.x-head*math.cos(angle+.45), end.y-head*math.sin(angle+.45)), end]
                page.draw_polyline(points, color=color, fill=color, width=stroke, stroke_opacity=opacity, fill_opacity=opacity)
            elif obj['type'] == 'scale':
                py = rect.y1-stroke
                page.draw_line((rect.x0, py), (rect.x1, py), color=color, width=stroke*3, stroke_opacity=opacity)
            if obj['type'] in ('text', 'scale'):
                text = obj.get('text', '')
                size = obj.get('fontSize', 10)
                page.insert_text((rect.x0, rect.y0+size), text, fontname=font(page, text), fontsize=size, color=color, fill_opacity=opacity, lineheight=1.2)
    pdf_file = output/'figure.pdf'
    document.save(pdf_file, garbage=4, deflate=True)
    pixmap = page.get_pixmap(dpi=dpi, alpha=bool(page_spec.get('transparent')))
    # MuPDF exposes premultiplied samples. Pillow's RGBa conversion restores
    # straight alpha, avoiding darkened translucent panels in PNG and TIFF.
    image = Image.frombytes('RGBa' if pixmap.alpha else 'RGB', (pixmap.width, pixmap.height), pixmap.samples)
    if pixmap.alpha:
        image = image.convert('RGBA')
    png_file, tiff_file, preview_file = output/'figure.png', output/'figure.tiff', output/'preview.png'
    image.save(png_file, dpi=(dpi, dpi))
    image.save(tiff_file, compression='tiff_deflate', dpi=(dpi, dpi))
    image.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
    image.save(preview_file)
    document.close()
    return {'saved': {'png': artifact(png_file), 'tiff': artifact(tiff_file), 'pdf': artifact(pdf_file), 'preview': artifact(preview_file)},
            'vectorPanels': vector_count}
