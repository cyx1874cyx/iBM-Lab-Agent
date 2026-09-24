#!/usr/bin/env python3
"""dsh-lab-agent PPTX template builder + template-conformance checker.

Builds a real .pptx from an imported template's source.pptx and plan.json and
emits a conformance report; `--check` validates without importing pptx.

Role → layout precedence (the `layout_resolution` finding): plan.roles[role]
when mapped to an existing layout; else cover → the title layout, other roles
→ the previous slide's layout, else slide_layouts[0].

Writing into placeholders (0.1.16+):
  * legacy: item.title / item.subtitle / item.bullets / item.image —
    addressed by placeholder *kind* (first match wins).
  * `item.texts`: [{ idx | name, paragraphs: [...], mode: "paragraph"|"bullets",
    sizePt? }] — addressed by placeholder **idx** (or shape name). Required for
    templates whose cover has several body placeholders and no title, and for
    summary pages with more than one body placeholder.
  * Every written run gets latin/ea/cs typefaces (default Arial / 微软雅黑 /
    Arial) and a size floor (`placeholderRules.minFontPt`, default 20pt), so a
    Chinese body never inherits a 14pt template default.
  * mode="paragraph" strips a:buChar/a:buAutoNum/a:buFont and adds a:buNone —
    “one or two natural paragraphs, no bullet points”.

CLI: --template <source.pptx> --parse <parse.json> --plan <plan.json>
     [--out <deck.pptx>] [--report <conformance.json>] [--check] [--max-pages N]
     [--required cover,summary] [--ratio 16:9] [--notes-required true|false]
Output: conformance JSON on stdout (and in --report).  Exit codes: 0 clean,
1 conformance errors, 2 usage/IO/parse error or missing python-pptx.
"""

import argparse
import hashlib
import json
import os
import re
import sys

DEFAULT_SAFE_AREA_INCHES = 0.5
LAYOUT_RESOLUTION_NOTE = (
    "role → layout precedence: plan.roles[role]; unmapped cover → template title layout, "
    "other unmapped roles → previous slide's layout, else slide_layouts[0]"
)

class BuildError(Exception):
    """Any expected failure (usage/IO/parse/missing pptx) — JSON error, exit 2."""

class JsonArgumentParser(argparse.ArgumentParser):
    """argparse that raises BuildError so callers still get JSON, not a traceback."""

    def error(self, message):
        raise BuildError(f"{message} (see --help)")

def configure_utf8_stdio():
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="backslashreplace")

def parse_args(argv):
    parser = JsonArgumentParser(prog="build_from_template.py")
    parser.add_argument("--template", required=True)
    parser.add_argument("--parse", required=True, dest="parse_path")
    parser.add_argument("--plan", required=True)
    parser.add_argument("--out", default=None)
    parser.add_argument("--report", default=None)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--max-pages", type=int, default=None, dest="max_pages")
    parser.add_argument("--required", default=None)
    parser.add_argument("--ratio", default=None)
    parser.add_argument("--notes-required", default=None, dest="notes_required")
    return parser.parse_args(argv)

def parse_bool(text, flag):
    values = {"true": True, "1": True, "yes": True, "on": True, "false": False, "0": False, "no": False, "off": False}
    if text is None:
        return None
    if text.strip().lower() not in values:
        raise BuildError(f"--{flag} must be true or false (got {text!r})")
    return values[text.strip().lower()]

def read_json(path, label):
    if not path or not os.path.isfile(path):
        raise BuildError(f"{label} file not found: {path}")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as exc:
        raise BuildError(f"cannot read {label} {path}: {type(exc).__name__}: {exc}")
    if not isinstance(data, dict):
        raise BuildError(f"{label} must be a JSON object: {path}")
    return data

def write_json(path, payload):
    try:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    except OSError as exc:
        raise BuildError(f"cannot write {path}: {exc}")

def sha256_file(path):
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
    except OSError as exc:
        raise BuildError(f"cannot read template {path}: {exc}")
    return digest.hexdigest()

def plan_slides(plan):
    slides = plan.get("slides")
    if not isinstance(slides, list) or not slides:
        raise BuildError("plan has no slides (empty plan)")
    for index, slide in enumerate(slides):
        if not isinstance(slide, dict) or not isinstance(slide.get("role"), str) or not slide["role"].strip():
            raise BuildError(f"plan.slides[{index}] must be an object with a non-empty role")
    return slides

def index_layouts(parsed):
    layouts = parsed.get("layouts")
    if not isinstance(layouts, list):
        raise BuildError("parse.json has no slide layouts")
    order, by_id = [], {}
    for index, layout in enumerate(layouts):
        if isinstance(layout, dict):
            layout_id = layout["id"] if isinstance(layout.get("id"), str) and layout["id"] else f"slideLayout{index + 1}"
            order.append(layout_id)
            by_id[layout_id] = layout
    if not order:
        raise BuildError("parse.json has no usable slide layouts")
    return order, by_id

def title_layout_id(order, by_id):
    for layout_id in order:
        placeholders = by_id[layout_id].get("placeholders")
        types = {p.get("type") for p in placeholders if isinstance(p, dict)} if isinstance(placeholders, list) else set()
        if "title" in types or "ctrTitle" in types:
            return layout_id
    return None

def resolve_role_layout(role, roles_map, by_id, previous_id, title_id, order):
    """Return (layout id to use, finding code or None, the raw mapping value)."""
    mapping = roles_map.get(role)
    fallback = title_id if role == "cover" and title_id is not None else (previous_id if previous_id is not None else order[0])
    if not isinstance(mapping, str) or not mapping:
        return fallback, "role_unmapped", mapping
    if mapping not in by_id:
        return fallback, "unknown_role_layout", mapping
    return mapping, None, mapping

def refresh_summary(report):
    errors = sum(1 for row in report["findings"] if row["level"] == "error")
    warnings = sum(1 for row in report["findings"] if row["level"] == "warning")
    report["summary"] = {"slideCount": len(report["slides"]), "errors": errors, "warnings": warnings}
    report["ok"] = errors == 0

def evaluate(parsed, plan, args, template_path, template_sha):
    """Build the conformance report; raises BuildError on unusable input."""
    order, by_id = index_layouts(parsed)
    slides = plan_slides(plan)
    roles_map = plan.get("roles") or {}
    if not isinstance(roles_map, dict):
        raise BuildError("plan.roles must be an object")
    title_id = title_layout_id(order, by_id)
    ratio = (parsed.get("page") or {}).get("ratio") if isinstance(parsed.get("page"), dict) else None
    required = args.required if args.required is not None else ",".join(
        role for role in (plan.get("requiredPages") or []) if isinstance(role, str))
    max_pages = args.max_pages if args.max_pages is not None else plan.get("maxPages")
    if not isinstance(max_pages, int) or isinstance(max_pages, bool):
        max_pages = None
    flagged = parse_bool(args.notes_required, "notes-required")
    notes_required = bool(plan.get("notesRequired", False)) if flagged is None else flagged
    findings = []

    def add(level, code, message):
        findings.append({"level": level, "code": code, "message": message})

    add("pass", "template_applied", f"template applied: {template_path}")
    add("pass", "layout_resolution", LAYOUT_RESOLUTION_NOTE)
    rows, previous_id = [], None
    for index, slide in enumerate(slides):
        role = slide["role"]
        resolved, code, mapping = resolve_role_layout(role, roles_map, by_id, previous_id, title_id, order)
        previous_id = resolved
        notes = slide.get("notes") if isinstance(slide.get("notes"), str) else ""
        rows.append({
            "index": index + 1, "role": role, "layoutId": resolved,
            "layoutName": by_id[resolved].get("name") or resolved, "notesChars": len(notes),
            "titleChars": len(slide["title"]) if isinstance(slide.get("title"), str) else 0,
            "bulletCount": len(slide["bullets"]) if isinstance(slide.get("bullets"), list) else 0
        })
        if code == "role_unmapped":
            add("error", code, f"slide {index + 1} role '{role}' is not mapped in plan.roles; using fallback '{resolved}'")
        elif code == "unknown_role_layout":
            add("error", code, f"slide {index + 1} role '{role}' maps to unknown layout '{mapping}'; using fallback '{resolved}'")
        if notes_required and not notes.strip():
            add("error", "missing_notes", f"slide {index + 1} role '{role}' has empty notes but notes are required")
    present_roles = {row["role"] for row in rows}
    for role in [r.strip() for r in required.split(",") if r.strip()]:
        if role not in present_roles:
            add("error", "missing_required_page", f"required page '{role}' does not appear in plan slides")
    if max_pages is not None and len(slides) > max_pages:
        add("error", "too_many_pages", f"plan has {len(slides)} slides, exceeding maxPages {max_pages}")
    declared = plan.get("slideCount")
    if isinstance(declared, int) and not isinstance(declared, bool) and declared != len(slides):
        add("error", "slide_count_mismatch", f"plan.slideCount {declared} differs from {len(slides)} plan slides")
    if args.ratio and ratio and args.ratio != ratio:
        add("warning", "page_ratio_mismatch", f"requested ratio {args.ratio} differs from template ratio {ratio}; deck keeps the template size")
    layout_count = parsed.get("layoutCount")
    report = {
        "ok": True, "mode": "check" if args.check else "build",
        "template": {"path": template_path, "sha256": template_sha, "ratio": ratio,
                     "layoutCount": layout_count if isinstance(layout_count, int) else len(order)},
        "summary": {"slideCount": len(slides), "errors": 0, "warnings": 0},
        "slides": rows, "findings": findings
    }
    refresh_summary(report)
    return report

def pptx_layout_index(prs, layout_id, name, order):
    """Map a parse.json layout id to python-pptx's 0-based index: numeric id, then name, then order."""
    match = re.search(r"(\d+)$", layout_id or "")
    if match and 0 <= int(match.group(1)) - 1 < len(prs.slide_layouts):
        return int(match.group(1)) - 1
    for index, layout in enumerate(prs.slide_layouts):
        if name and getattr(layout, "name", None) == name:
            return index
    return order.index(layout_id) if layout_id in order else 0

def build_deck(template_path, parsed, plan, findings):
    """Build the deck from the template; raises BuildError without python-pptx."""
    try:
        from pptx import Presentation
        from pptx.util import Emu, Inches
    except ImportError as exc:
        raise BuildError("python-pptx is not installed; run: python -m pip install python-pptx") from exc
    from pptx.oxml.ns import qn
    from pptx.util import Pt
    rules = plan.get("placeholderRules") if isinstance(plan.get("placeholderRules"), dict) else {}
    fonts = rules.get("fonts") if isinstance(rules.get("fonts"), dict) else {}
    font_latin = str(fonts.get("latin") or plan.get("fontLatin") or "Arial")
    font_ea = str(fonts.get("ea") or plan.get("fontEa") or "微软雅黑")
    font_cs = str(fonts.get("cs") or plan.get("fontCs") or "Arial")
    try:
        min_font_pt = float(rules.get("minFontPt", plan.get("minFontPt", 20.0)))
    except (TypeError, ValueError):
        min_font_pt = 20.0
    if min_font_pt <= 0:
        min_font_pt = 20.0
    safe_inches = rules.get("safeAreaInches", plan.get("safeAreaInches", DEFAULT_SAFE_AREA_INCHES))
    if not isinstance(safe_inches, (int, float)) or isinstance(safe_inches, bool) or safe_inches < 0:
        safe_inches = DEFAULT_SAFE_AREA_INCHES
    crop_mode = rules.get("imageCrop", plan.get("imageCrop", "contain"))
    def drop_template_slides(presentation):
        """删掉模板自带的幻灯片，只保留本次生成的页。

        模板的静态装饰在**版式/母版**上，不在这几页里，所以删掉引用不影响底图/蓝线/logo。
        不删的话，模板里老师放的示例页会原样留在成品里（实测：8 页模板 + 5 页计划 = 13 页）。
        `placeholderRules.keepTemplateSlides: true` 可保留（用于"在模板页上续写"的场景）。
        """
        sldIdLst = presentation.slides._sldIdLst
        for sldId in list(sldIdLst):
            rId = sldId.get(qn("r:id"))
            if rId:
                presentation.part.drop_rel(rId)
            sldIdLst.remove(sldId)

    safe = Emu(int(Inches(safe_inches)))
    prs = Presentation(template_path)
    if not (rules.get("keepTemplateSlides", plan.get("keepTemplateSlides", False)) is True):
        drop_template_slides(prs)
    order, by_id = index_layouts(parsed)
    title_id = title_layout_id(order, by_id)
    roles_map = plan.get("roles") or {}
    if not isinstance(roles_map, dict):
        raise BuildError("plan.roles must be an object")
    kinds = {"TITLE": "title", "CENTER_TITLE": "title", "SUBTITLE": "subtitle",
             "BODY": "body", "OBJECT": "body", "PICTURE": "pic"}

    def kind_of(shape):
        partial = getattr(getattr(shape, "placeholder_format", None), "type", None)
        return kinds.get(getattr(partial, "name", None) or str(partial).split(" ")[0], "other")

    def set_typeface(rPr, tag, face):
        """设置 a:ea / a:cs（python-pptx 只建模了 a:latin）。必须遵守 schema 顺序：
        latin → ea → cs → sym → hlink*，所以插在 a:latin 之后。"""
        element = rPr.find(qn(tag))
        if element is None:
            element = rPr.makeelement(qn(tag), {})
            latin = rPr.find(qn("a:latin"))
            if latin is not None:
                latin.addnext(element)
            else:
                rPr.append(element)
        element.set("typeface", face)

    def style_paragraphs(shape, size_pt=None):
        """给形状里每个 run 统一字体，并保证字号不低于 min_font_pt。

        字号策略（只升不降）：run 已有且 >= 下限 → 保持；已有但低于下限 → 提到下限；
        未显式设置 → 用 sizePt（plan 显式给的）否则下限。模板里更大的字号请用
        sizePt 显式声明，否则会被收到下限。"""
        explicit = size_pt if isinstance(size_pt, (int, float)) and not isinstance(size_pt, bool) and size_pt > 0 else None
        for paragraph in shape.text_frame.paragraphs:
            for run in paragraph.runs:
                run.font.name = font_latin
                rPr = run._r.get_or_add_rPr()
                set_typeface(rPr, "a:ea", font_ea)
                set_typeface(rPr, "a:cs", font_cs)
                current = run.font.size
                if current is not None and current >= Pt(min_font_pt):
                    continue
                run.font.size = Pt(explicit if explicit is not None else min_font_pt)

    def strip_bullet(paragraph):
        """去掉项目符号：删 a:buChar/a:buAutoNum/a:buFont，补 a:buNone（插在 defRPr 前）。"""
        pPr = paragraph._p.get_or_add_pPr()
        for tag in ("a:buChar", "a:buAutoNum", "a:buBlip", "a:buFont"):
            element = pPr.find(qn(tag))
            if element is not None:
                pPr.remove(element)
        if pPr.find(qn("a:buNone")) is None:
            buNone = pPr.makeelement(qn("a:buNone"), {})
            defRPr = pPr.find(qn("a:defRPr"))
            if defRPr is not None:
                defRPr.addprevious(buNone)
            else:
                pPr.append(buNone)

    def placeholder_by_idx(slide, idx):
        for placeholder in slide.placeholders:
            if placeholder.placeholder_format.idx == idx:
                return placeholder
        return None

    def write_into_placeholder(slide, entry, index, findings):
        """按 idx（或形状名）定点写入一段或多段文字。"""
        idx = entry.get("idx")
        shape = placeholder_by_idx(slide, idx) if isinstance(idx, int) and not isinstance(idx, bool) else None
        if shape is None and isinstance(entry.get("name"), str) and entry["name"]:
            shape = next((candidate for candidate in slide.shapes if candidate.name == entry["name"]), None)
        if shape is None:
            findings.append({"level": "warning", "code": "placeholder_missing",
                             "message": f"slide {index + 1}: no placeholder for idx={idx!r} name={entry.get('name')!r}"})
            return False
        if not getattr(shape, "has_text_frame", False):
            findings.append({"level": "warning", "code": "placeholder_not_text",
                             "message": f"slide {index + 1}: placeholder idx={idx} has no text frame"})
            return False
        paragraphs = entry.get("paragraphs")
        if not isinstance(paragraphs, list) or not paragraphs:
            return False
        mode = entry.get("mode") if entry.get("mode") in ("paragraph", "bullets") else "paragraph"
        frame = shape.text_frame
        frame.word_wrap = True
        frame.clear()
        for position, text in enumerate(paragraphs):
            paragraph = frame.paragraphs[0] if position == 0 else frame.add_paragraph()
            paragraph.text = str(text)
            if mode == "paragraph":
                strip_bullet(paragraph)
        style_paragraphs(shape, entry.get("sizePt"))
        return True

    def place_picture(slide, image, caption, title_shape):
        top = safe if title_shape is None else max(safe, title_shape.top + title_shape.height + Inches(0.15))
        target = next((ph for ph in slide.placeholders if kind_of(ph) == "pic"), None)
        if target is not None:
            picture = target.insert_picture(image)
            if crop_mode == "cover":
                try:
                    image_ratio, ratio = picture.image.size[0] / picture.image.size[1], target.width / target.height
                    picture.left, picture.top = target.left, target.top
                    if image_ratio > ratio:
                        picture.height, picture.width = int(target.height), int(round(target.height * image_ratio))
                        picture.crop_left = picture.crop_right = (1 - ratio / image_ratio) / 2.0
                    else:
                        picture.width, picture.height = int(target.width), int(round(target.width / image_ratio))
                        picture.crop_top = picture.crop_bottom = (1 - image_ratio / ratio) / 2.0
                except (AttributeError, TypeError, ValueError, ZeroDivisionError, IndexError):
                    findings.append({"level": "warning", "code": "image_crop_unsupported",
                                     "message": "python-pptx crop_* unavailable; image kept as contain"})
        else:
            picture = slide.shapes.add_picture(image, safe, top, width=prs.slide_width - 2 * safe)
            room = prs.slide_height - safe - top
            if room > 0 and picture.height > room:
                picture.width, picture.height = int(picture.width * (room / picture.height)), int(room)
        if caption:
            cap_top = min(picture.top + picture.height, prs.slide_height - safe - Inches(0.4))
            slide.shapes.add_textbox(safe, cap_top, prs.slide_width - 2 * safe, Inches(0.4)).text_frame.text = caption
        return picture

    previous_id = None
    for index, item in enumerate(plan["slides"]):
        resolved, _code, _mapping = resolve_role_layout(item["role"], roles_map, by_id, previous_id, title_id, order)
        slide = prs.slides.add_slide(prs.slide_layouts[pptx_layout_index(prs, resolved, by_id[resolved].get("name"), order)])
        previous_id = resolved
        placeholders = list(slide.placeholders)
        title_shape = slide.shapes.title or next((ph for ph in placeholders if kind_of(ph) == "title"), None)
        for key, shape in (("title", title_shape), ("subtitle", next((ph for ph in placeholders if kind_of(ph) == "subtitle"), None))):
            if isinstance(item.get(key), str) and item[key] and shape is not None and shape.has_text_frame:
                shape.text_frame.text = item[key]
                style_paragraphs(shape)
        body_shape = next((ph for ph in placeholders if kind_of(ph) == "body"), None)
        bullets = item.get("bullets") if isinstance(item.get("bullets"), list) else []
        if bullets and body_shape is not None and body_shape.has_text_frame:
            body_shape.text_frame.clear()
            frame = body_shape.text_frame
            frame.word_wrap = True
            for position, bullet in enumerate(bullets):
                (frame.paragraphs[0] if position == 0 else frame.add_paragraph()).text = str(bullet)
            style_paragraphs(body_shape)
        # 定点写入：按占位符 idx（或形状名）写多段文字，用于封面多占位符与总结页多段。
        texts = item.get("texts")
        if isinstance(texts, list):
            for entry in texts:
                if isinstance(entry, dict):
                    write_into_placeholder(slide, entry, index, findings)
        if item.get("image"):
            try:
                place_picture(slide, item["image"], item.get("imageCaption"), title_shape)
            except Exception as exc:  # noqa: BLE001 - one bad image must not abort the deck
                findings.append({"level": "warning", "code": "image_unreadable",
                                 "message": f"slide {index + 1}: cannot insert image {item['image']}: {type(exc).__name__}: {exc}"})
        if isinstance(item.get("notes"), str) and item["notes"]:
            slide.notes_slide.notes_text_frame.text = item["notes"]
    return prs

def run(argv):
    args = parse_args(argv)
    template_path = os.path.abspath(args.template)
    if not os.path.isfile(template_path):
        raise BuildError(f"template file not found: {template_path}")
    parsed = read_json(args.parse_path, "parse.json")
    plan = read_json(args.plan, "plan.json")
    report = evaluate(parsed, plan, args, template_path, sha256_file(template_path))
    if not args.check:
        if not args.out:
            raise BuildError("--out is required unless --check is used")
        try:
            build_deck(template_path, parsed, plan, report["findings"]).save(args.out)
        except OSError as exc:
            raise BuildError(f"cannot write deck {args.out}: {exc}")
        refresh_summary(report)
    if args.report:
        write_json(args.report, report)
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["ok"] else 1

def main(argv=None):
    configure_utf8_stdio()
    try:
        return run(argv)
    except BuildError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
    except Exception as exc:  # noqa: BLE001 - expected problems must never traceback
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
