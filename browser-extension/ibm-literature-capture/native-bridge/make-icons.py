"""生成 iBM Lab 文献捕获扩展图标（纯 Python，无第三方依赖）。"""
import struct
import zlib
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
os.makedirs(OUT_DIR, exist_ok=True)

BG = (38, 134, 109, 255)      # 深绿
ARROW = (240, 252, 247, 255)  # 近白
SHADE = (21, 86, 70, 255)     # 深绿阴影


def png_chunk(tag, data):
    chunk = tag + data
    return struct.pack(">I", len(data)) + chunk + struct.pack(">I", zlib.crc32(chunk) & 0xFFFFFFFF)


def make_icon(size):
    # 圆角矩形（简单 alpha 掩码）
    radius = size // 4
    pixels = bytearray()
    for y in range(size):
        row = bytearray()
        for x in range(size):
            def inside(cx, cy, r):
                dx, dy = cx - x, cy - y
                return dx * dx + dy * dy <= r * r
            corner = None
            if x < radius and y < radius:
                corner = inside(radius - 0.5, radius - 0.5, radius)
            elif x >= size - radius and y < radius:
                corner = inside(size - radius - 0.5, radius - 0.5, radius)
            elif x < radius and y >= size - radius:
                corner = inside(radius - 0.5, size - radius - 0.5, radius)
            elif x >= size - radius and y >= size - radius:
                corner = inside(size - radius - 0.5, size - radius - 0.5, radius)
            if corner is False:
                row += bytes((0, 0, 0, 0))
                continue
            # 垂直渐变
            t = y / max(1, size - 1)
            color = tuple(int(BG[i] * (1 - t) + SHADE[i] * t) for i in range(3))
            row += bytes(color + (255,))
        pixels += row
    # 叠加白色向下箭头（下载语义）
    u = size / 128.0
    shaft_x0, shaft_x1 = int(58 * u), int(70 * u)
    arrow_top = int(46 * u)
    head_y = int(70 * u)
    head_h = int(22 * u)
    for y in range(size):
        for x in range(size):
            in_shaft = arrow_top <= y <= head_y and shaft_x0 <= x <= shaft_x1
            rel_y = y - head_y
            in_head = 0 <= rel_y <= head_h and abs(x - 64 * u) <= rel_y * 0.75
            if in_shaft or in_head:
                idx = (y * size + x) * 4
                pixels[idx:idx + 3] = ARROW[:3]
                pixels[idx + 3] = 255
    raw = zlib.compress(bytes(pixels), 9)
    png = (b"\x89PNG\r\n\x1a\n"
           + png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + png_chunk(b"IDAT", raw)
           + png_chunk(b"IEND", b""))
    with open(os.path.join(OUT_DIR, f"icon{size}.png"), "wb") as handle:
        handle.write(png)
    print(f"icon{size}.png written ({len(png)} bytes)")


for s in (16, 48, 128):
    make_icon(s)
