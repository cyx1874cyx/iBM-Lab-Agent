#!/usr/bin/env python3
"""把 PDF 逐页栅格化成 PNG，并可选合成一张 contact sheet（网格总览图）。

为什么单独一个脚本：Agent 核对幻灯片版式时，最贵的开销是"逐页读图"。一张 contact
sheet 能让它在**一次**读图里看完整套页面（版面、溢出、静态层是否被破坏），只在发现
异常时才回到单页细看。

栅格化用 PyMuPDF（`fitz`），contact sheet 用 Pillow —— 两者都在软件自带的 Python 里，
不引入任何新依赖。

用法：
    python pdf_to_png.py --pdf deck.pdf --out DIR [--dpi 110] [--pages 1,2,5]
                         [--contact-sheet] [--sheet-cols 3] [--sheet-width 1920]
                         [--json]

输出（--json 时打到 stdout，其余情况只打印人类可读摘要）：
    {"ok": true, "pages": [{"page": 1, "path": "..."}], "contactSheet": "...", "errors": []}
"""

from __future__ import annotations

import argparse
import json
import os
import sys


def parse_pages(text):
    """`1,2,5-7` → 排序去重的页号集合（1 基）；空表示全部。"""
    if not text:
        return None
    pages = set()
    for chunk in str(text).split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            start, _, end = chunk.partition("-")
            pages.update(range(int(start), int(end) + 1))
        else:
            pages.add(int(chunk))
    return pages or None


def rasterize(pdf_path, out_dir, dpi, wanted):
    # PyMuPDF >=1.24 的正式模块名是 pymupdf；旧版本只有 fitz 别名。
    try:
        import pymupdf as fitz
    except ImportError:  # pragma: no cover - 老版本回退
        import fitz

    written = []
    doc = fitz.open(pdf_path)
    try:
        for index, page in enumerate(doc, start=1):
            if wanted is not None and index not in wanted:
                continue
            pixmap = page.get_pixmap(dpi=dpi)
            target = os.path.join(out_dir, "page%02d.png" % index)
            pixmap.save(target)
            written.append({"page": index, "path": target, "width": pixmap.width, "height": pixmap.height})
    finally:
        doc.close()
    return written


def contact_sheet(images, out_path, cols, sheet_width):
    """把逐页 PNG 拼成一张网格图，每格左上角标页号。

    刻意把整张图限制在 sheet_width 宽：contact sheet 是给"版面核对"用的，不是给读
    文字用的 —— 缩得太小反而两边都做不好。需要看清文字时再读单页。
    """
    from PIL import Image, ImageDraw, ImageFont

    if not images:
        return None
    cols = max(1, min(cols, len(images)))
    rows = (len(images) + cols - 1) // cols
    cell_w = max(1, sheet_width // cols)
    # 以第一页的宽高比推算单元格高度，保持各页等宽等高。
    first = Image.open(images[0]["path"])
    ratio = first.height / first.width if first.width else 1.4
    first.close()
    cell_h = max(1, int(cell_w * ratio))
    label_h = max(18, cell_w // 24)

    sheet = Image.new("RGB", (cell_w * cols, (cell_h + label_h) * rows), "white")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default(size=max(14, label_h - 6))
    except TypeError:  # 老版本 Pillow 不支持 size 参数
        font = ImageFont.load_default()

    for position, entry in enumerate(images):
        row, col = divmod(position, cols)
        image = Image.open(entry["path"]).convert("RGB")
        image.thumbnail((cell_w, cell_h))
        x = col * cell_w
        y = row * (cell_h + label_h)
        sheet.paste(image, (x + (cell_w - image.width) // 2, y + label_h))
        draw.text((x + 6, y + 4), "page %d" % entry["page"], fill="black", font=font)
        image.close()

    sheet.save(out_path)
    return out_path


def main(argv=None):
    parser = argparse.ArgumentParser(description="PDF → PNG（可含 contact sheet）")
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--dpi", type=int, default=110)
    parser.add_argument("--pages", default="")
    parser.add_argument("--contact-sheet", action="store_true")
    parser.add_argument("--sheet-cols", type=int, default=3)
    parser.add_argument("--sheet-width", type=int, default=1920)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    os.makedirs(args.out, exist_ok=True)
    result = {"ok": False, "pdf": args.pdf, "pages": [], "contactSheet": None, "errors": []}
    try:
        pages = rasterize(args.pdf, args.out, args.dpi, parse_pages(args.pages))
    except Exception as exc:  # noqa: BLE001 - 诊断必须原样带回给 Agent
        result["errors"].append("%s: %s" % (type(exc).__name__, exc))
        print(json.dumps(result, ensure_ascii=False))
        return 2
    if not pages:
        result["errors"].append("没有渲染出任何页面（--pages 是否超出了文档页数？）")
        print(json.dumps(result, ensure_ascii=False))
        return 2
    result["pages"] = pages
    if args.contact_sheet:
        try:
            sheet = contact_sheet(pages, os.path.join(args.out, "contact-sheet.png"), args.sheet_cols, args.sheet_width)
            result["contactSheet"] = sheet
        except Exception as exc:  # noqa: BLE001
            result["errors"].append("contact sheet 生成失败：%s: %s" % (type(exc).__name__, exc))
    result["ok"] = True

    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print("渲染 %d 页 → %s" % (len(pages), args.out))
        if result["contactSheet"]:
            print("contact sheet: %s" % result["contactSheet"])
        for message in result["errors"]:
            print("警告：%s" % message, file=sys.stderr)
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
