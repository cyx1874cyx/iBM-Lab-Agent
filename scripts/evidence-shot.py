#!/usr/bin/env python3
"""dsh-lab-agent PDF page → PNG renderer for synthesis Evidence screenshots.

Renders a PDF page (optionally clipped to a bbox) to a PNG at a chosen zoom,
so the 合成路线工作台 Evidence card can show the original-literature excerpt
region for human review.

Usage:
  evidence-shot.py --pdf <path> --page <1-based int> --out <png path>
                   [--zoom <float=2.0>] [--bbox x1,y1,x2,y2]

Output: JSON on stdout: {"ok": true, "width", "height", "bytes"}
Exit codes: 0 ok, 1 error, 2 PyMuPDF (fitz) unavailable.
"""
import argparse
import json
import os
import sys


def parse_bbox(text: str):
    parts = [p.strip() for p in text.split(",") if p.strip()]
    if len(parts) != 4:
        raise ValueError("bbox must be x1,y1,x2,y2 (4 comma-separated numbers)")
    return tuple(float(p) for p in parts)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--page", type=int, required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--zoom", type=float, default=2.0)
    parser.add_argument("--bbox", default=None)
    args = parser.parse_args()

    try:
        import fitz  # PyMuPDF
    except ImportError:
        print(json.dumps({"ok": False, "error": "PyMuPDF (fitz) is not installed in this python"}))
        return 2

    try:
        if args.page < 1:
            raise ValueError("page must be >= 1")
        if not os.path.isfile(args.pdf):
            raise ValueError(f"pdf file not found: {args.pdf}")
        clip = parse_bbox(args.bbox) if args.bbox else None
        doc = fitz.open(args.pdf)
        try:
            if args.page > doc.page_count:
                raise ValueError(f"page {args.page} out of range (pdf has {doc.page_count} pages)")
            page = doc.load_page(args.page - 1)  # 1-based → 0-based
            matrix = fitz.Matrix(args.zoom, args.zoom)
            pix = page.get_pixmap(matrix=matrix, clip=clip)
            pix.save(args.out)
        finally:
            doc.close()
        print(json.dumps({
            "ok": True,
            "width": pix.width,
            "height": pix.height,
            "bytes": os.path.getsize(args.out),
        }))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
