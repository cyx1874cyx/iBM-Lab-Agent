"""Lossless PNG output for image entries; originals are immutable."""
import hashlib
import math
import warnings
from pathlib import Path
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 40_000_000


def artifact(path):
    data = path.read_bytes()
    return {'path': str(path), 'fileName': path.name, 'byteLength': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def image_job(args):
    source = Path(args['path']).resolve(strict=True)
    output = Path(args['output']).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(source) as opened:
            if opened.format not in {'PNG', 'JPEG', 'WEBP', 'TIFF', 'BMP', 'GIF'}:
                raise ValueError('不支持的图片格式')
            if opened.width * opened.height > Image.MAX_IMAGE_PIXELS:
                raise ValueError('图片超过 4000 万像素，请缩小后导入')
            fmt = opened.format
            frames = getattr(opened, 'n_frames', 1)
            opened.seek(0)
            image = ImageOps.exif_transpose(opened).convert('RGBA')
    width, height = image.size
    spec = args.get('spec', {})
    crop = spec.get('crop', {'x': 0, 'y': 0, 'w': 1, 'h': 1})
    x, y, w, h = (crop[k] for k in ('x', 'y', 'w', 'h'))
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (x, y, w, h)) or min(x, y) < 0 or min(w, h) <= 0 or x+w > 1+1e-9 or y+h > 1+1e-9:
        raise ValueError('裁剪区域无效')
    rotation = spec.get('rotation', 0)
    if rotation not in (0, 90, 180, 270):
        raise ValueError('旋转角度必须是 90 度的倍数')
    left, top = round(x * width), round(y * height)
    right, bottom = round((x+w) * width), round((y+h) * height)
    if right <= left or bottom <= top:
        raise ValueError('裁剪区域至少为 1 × 1 像素')
    image = image.crop((left, top, right, bottom))
    if spec.get('flipH'):
        image = ImageOps.mirror(image)
    if spec.get('flipV'):
        image = ImageOps.flip(image)
    if rotation:
        image = image.transpose({90: Image.Transpose.ROTATE_270, 180: Image.Transpose.ROTATE_180, 270: Image.Transpose.ROTATE_90}[rotation])
    final = output / 'image.png'
    image.save(final, format='PNG')
    size = image.size
    image.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
    preview = output / 'preview.png'
    image.save(preview, format='PNG')
    return {'width': width, 'height': height, 'format': fmt,
            'warning': '多帧图片仅编辑并导出第一帧。' if frames > 1 else None,
            'saved': {'image': artifact(final), 'preview': artifact(preview), 'width': size[0], 'height': size[1]}}
