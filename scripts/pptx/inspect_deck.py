#!/usr/bin/env python3
"""体检一份**成品** .pptx：字体三槽、字号下限、图片是否被拉伸、是否越界、是否有没填的占位符。

为什么需要它：0.5.4 现场的 Agent 为了核对成品，自己写了一次性脚本查 XML —— 正则写错过
一次、被 PowerShell 引号坑过一次，各失败一轮。而这些检查**根本不需要读图**：

  * 字体三槽（latin/ea/cs）与字号 → 读 run 的 rPr 即可，精确且零视觉 token；
  * 图片是否被拉伸 → 比较 shape 几何比例与图片像素比例；
  * 越界 → 比较 shape 包围盒与幻灯片尺寸；
  * 占位符没填 → 幻灯片上的文字仍等于版式里的提示文字。

读图只应留给"版面好不好看"这类真正需要眼睛的事（配合 scripts/render-deck.mjs 的
contact sheet 一次看全套）。

用法：
    python inspect_deck.py --deck deck.pptx [--json] [--strict] [--min-font-pt 20]
                           [--expect-ea 微软雅黑] [--expect-latin Arial]
                           [--expect-cs Arial]

退出码：0 无 error 级发现；1 有 error 级发现（--strict 时 warning 也算失败）；2 读不了文件。
"""

from __future__ import annotations

import argparse
import json
import os
import sys

EMU_PER_INCH = 914400
DEFAULT_MIN_FONT_PT = 20.0


def _typeface(run, tag):
    """读 run 的 a:latin / a:ea / a:cs 字体名（缺失返回 None）。"""
    from pptx.oxml.ns import qn

    rPr = run.font._rPr
    if rPr is None:
        return None
    element = rPr.find(qn(tag))
    if element is None:
        return None
    return element.get("typeface")


def _bullet_marker(paragraph):
    """段落 pPr 里的项目符号直接证据：'none' / 'char' / 'auto' / None。"""
    from pptx.oxml.ns import qn

    pPr = paragraph._p.find(qn("a:pPr"))
    if pPr is None:
        return None
    if pPr.find(qn("a:buNone")) is not None:
        return "none"
    if pPr.find(qn("a:buChar")) is not None:
        return "char"
    if pPr.find(qn("a:buAutoNum")) is not None:
        return "auto"
    return None


def inspect(deck_path, min_font_pt, expect):
    from pptx import Presentation

    prs = Presentation(deck_path)
    slide_w, slide_h = int(prs.slide_width), int(prs.slide_height)
    findings = []
    slides = []

    for index, slide in enumerate(prs.slides, start=1):
        layout = slide.slide_layout
        layout_placeholders = {}
        for shape in layout.placeholders:
            try:
                layout_placeholders[int(shape.placeholder_format.idx)] = shape
            except (AttributeError, ValueError):
                continue

        entry = {
            "slide": index,
            "layout": layout.name,
            "shapes": [],
            "minFontPt": None,
            "fonts": {"latin": set(), "ea": set(), "cs": set()},
            "pictures": [],
            "bullets": []
        }

        for shape in slide.shapes:
            geometry = {
                "name": shape.name,
                "left": int(shape.left or 0),
                "top": int(shape.top or 0),
                "width": int(shape.width or 0),
                "height": int(shape.height or 0)
            }
            if shape.is_placeholder:
                geometry["placeholderIdx"] = int(shape.placeholder_format.idx)
                geometry["placeholderType"] = str(shape.placeholder_format.type)
            entry["shapes"].append(geometry)

            # 越界检查（允许 0.02 in 的舍入余量）
            slack = int(0.02 * EMU_PER_INCH)
            if (
                geometry["left"] < -slack
                or geometry["top"] < -slack
                or geometry["left"] + geometry["width"] > slide_w + slack
                or geometry["top"] + geometry["height"] > slide_h + slack
            ):
                findings.append({
                    "level": "error",
                    "code": "off-canvas",
                    "slide": index,
                    "shape": shape.name,
                    "message": "形状超出幻灯片边界（PowerPoint 会裁掉，LibreOffice 可能溢出画布）",
                    "geometry": geometry,
                    "slideSize": {"width": slide_w, "height": slide_h}
                })

            if shape.shape_type == 13 or shape.__class__.__name__ == "Picture":  # PICTURE
                try:
                    px_w, px_h = shape.image.size
                    image_ratio = px_w / px_h if px_h else 0
                    shape_ratio = geometry["width"] / geometry["height"] if geometry["height"] else 0
                    stretched = bool(shape_ratio and image_ratio and abs(shape_ratio - image_ratio) / image_ratio > 0.02)
                    entry["pictures"].append({
                        "name": shape.name,
                        "widthIn": round(geometry["width"] / EMU_PER_INCH, 2),
                        "heightIn": round(geometry["height"] / EMU_PER_INCH, 2),
                        "imagePx": [px_w, px_h],
                        "stretched": stretched
                    })
                    if stretched:
                        findings.append({
                            "level": "error",
                            "code": "picture-stretched",
                            "slide": index,
                            "shape": shape.name,
                            "message": "图片比例与占位符比例不一致且未被裁切/留白处理，渲染器之间会不一致",
                            "shapeRatio": round(shape_ratio, 3),
                            "imageRatio": round(image_ratio, 3)
                        })
                except (AttributeError, ValueError, ZeroDivisionError) as exc:
                    findings.append({
                        "level": "warning",
                        "code": "picture-unreadable",
                        "slide": index,
                        "shape": shape.name,
                        "message": "无法读取图片像素尺寸：%s" % exc
                    })

            if not shape.has_text_frame:
                continue
            layout_shape = None
            if shape.is_placeholder:
                layout_shape = layout_placeholders.get(int(shape.placeholder_format.idx))
            prompt = (layout_shape.text_frame.text.strip() if layout_shape is not None and layout_shape.has_text_frame else "")

            for paragraph in shape.text_frame.paragraphs:
                text = "".join(run.text for run in paragraph.runs)
                marker = _bullet_marker(paragraph)
                if text.strip():
                    entry["bullets"].append({"shape": shape.name, "marker": marker, "textHead": text.strip()[:24]})
                    if marker in ("char", "auto"):
                        findings.append({
                            "level": "warning",
                            "code": "bullet-present",
                            "slide": index,
                            "shape": shape.name,
                            "message": "该段落带项目符号（若这是摘要/图注/正文自然段，应当显式 a:buNone）",
                            "textHead": text.strip()[:24]
                        })
                for run in paragraph.runs:
                    if not run.text.strip():
                        continue
                    fonts = {
                        "latin": _typeface(run, "a:latin"),
                        "ea": _typeface(run, "a:ea"),
                        "cs": _typeface(run, "a:cs")
                    }
                    for key, value in fonts.items():
                        if value:
                            entry["fonts"][key].add(value)
                        else:
                            findings.append({
                                "level": "error",
                                "code": "font-%s-missing" % key,
                                "slide": index,
                                "shape": shape.name,
                                "message": "run 未显式声明 %s 字体（会走继承链，跨机器可能回退）" % key,
                                "textHead": run.text.strip()[:24]
                            })
                    for key, wanted in expect.items():
                        if wanted and fonts.get(key) and fonts[key] != wanted:
                            findings.append({
                                "level": "warning",
                                "code": "font-%s-unexpected" % key,
                                "slide": index,
                                "shape": shape.name,
                                "message": "%s 字体为 %s，期望 %s" % (key, fonts[key], wanted),
                                "textHead": run.text.strip()[:24]
                            })
                    size = run.font.size
                    if size is None:
                        findings.append({
                            "level": "warning",
                            "code": "font-size-inherited",
                            "slide": index,
                            "shape": shape.name,
                            "message": "run 未显式声明字号：实际值取决于继承链，无法从文件断言",
                            "textHead": run.text.strip()[:24]
                        })
                        continue
                    points = float(size.pt)
                    if entry["minFontPt"] is None or points < entry["minFontPt"]:
                        entry["minFontPt"] = points
                    if points < min_font_pt:
                        findings.append({
                            "level": "error",
                            "code": "font-size-below-floor",
                            "slide": index,
                            "shape": shape.name,
                            "message": "字号 %.1fpt 低于下限 %.1fpt" % (points, min_font_pt),
                            "textHead": run.text.strip()[:24]
                        })

            # 没填的占位符：文字仍然等于版式里的提示文字
            if prompt and shape.has_text_frame and shape.text_frame.text.strip() == prompt:
                findings.append({
                    "level": "error",
                    "code": "placeholder-prompt-left",
                    "slide": index,
                    "shape": shape.name,
                    "message": "占位符仍是版式提示文字，未被填充：%s" % prompt[:30]
                })

        entry["fonts"] = {key: sorted(value) for key, value in entry["fonts"].items()}
        slides.append(entry)

    errors = [f for f in findings if f["level"] == "error"]
    warnings = [f for f in findings if f["level"] == "warning"]
    return {
        "ok": len(errors) == 0,
        "deck": os.path.abspath(deck_path),
        "slideCount": len(slides),
        "slideSize": {"width": slide_w, "height": slide_h},
        "minFontPt": min([s["minFontPt"] for s in slides if s["minFontPt"] is not None], default=None),
        "slides": slides,
        "findings": findings,
        "summary": {"errors": len(errors), "warnings": len(warnings)}
    }


def render_human(report):
    lines = [
        "成品体检：%s" % report["deck"],
        "  %d 页 | 最小显式字号 %s | error %d | warning %d" % (
            report["slideCount"],
            ("%.1fpt" % report["minFontPt"]) if report["minFontPt"] is not None else "（无显式字号）",
            report["summary"]["errors"],
            report["summary"]["warnings"],
        )
    ]
    for slide in report["slides"]:
        fonts = slide["fonts"]
        lines.append("  p%-2d %-10s 字体 latin=%s ea=%s cs=%s%s" % (
            slide["slide"],
            slide["layout"][:10],
            ",".join(fonts["latin"]) or "-",
            ",".join(fonts["ea"]) or "-",
            ",".join(fonts["cs"]) or "-",
            ("  图片 %d 张" % len(slide["pictures"])) if slide["pictures"] else "",
        ))
    for finding in report["findings"][:40]:
        lines.append("  [%s] p%s %s: %s" % (finding["level"], finding.get("slide", "?"), finding["code"], finding["message"]))
    if len(report["findings"]) > 40:
        lines.append("  ...（其余 %d 条见 --json）" % (len(report["findings"]) - 40))
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description="成品 .pptx 体检（字体/字号/拉伸/越界/未填占位符）")
    parser.add_argument("--deck", required=True)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--strict", action="store_true", help="warning 也视为失败")
    parser.add_argument("--min-font-pt", type=float, default=DEFAULT_MIN_FONT_PT)
    parser.add_argument("--expect-latin", default=None)
    parser.add_argument("--expect-ea", default=None)
    parser.add_argument("--expect-cs", default=None)
    args = parser.parse_args(argv)

    if not os.path.isfile(args.deck):
        print("找不到文件：%s" % args.deck, file=sys.stderr)
        return 2
    expect = {"latin": args.expect_latin, "ea": args.expect_ea, "cs": args.expect_cs}
    report = inspect(args.deck, args.min_font_pt, expect)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=1))
    else:
        print(render_human(report))
    if not report["ok"]:
        return 1
    if args.strict and report["summary"]["warnings"] > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
