#!/usr/bin/env python3
"""dsh-lab-agent PPTX template builder + template-conformance checker.

Builds a real .pptx from an imported template's source.pptx and plan.json and
emits a conformance report; `--check` validates without importing pptx.

Role → layout precedence (the `layout_resolution` finding): plan.roles[role]
when mapped to an existing layout; else cover → the title layout, other roles
→ the previous slide's layout, else slide_layouts[0].

Writing into placeholders:
  * `item.texts`: [{ prompt | idx | name, paragraphs: [...], mode: "paragraph"|"bullets",
    align?, sizePt? }] — 定位优先用**提示文字**，其次 idx，最后形状名。
    compiled.json 由编译器生成，Agent 只写 plan.json 的槽位写法。
  * Every written run gets latin/ea/cs typefaces (default Arial / 微软雅黑 /
    Arial) and a size floor (`placeholderRules.minFontPt`, default 20pt), so a
    Chinese body never inherits a 14pt template default.
  * mode="paragraph" strips a:buChar/a:buAutoNum/a:buFont and adds a:buNone —
    “one or two natural paragraphs, no bullet points”.
  * `item.image` 默认按 **contain** 放进图片占位符：显式写 `a:xfrm`（等比缩放 + 居中）
    并清空 `a:srcRect`。不写几何的话，`insert_picture()` 只会把图塞进占位符并把它裁成
    占位符比例，且两个渲染器表现不一致（PowerPoint 裁切 / LibreOffice 撑高溢出）。
    `placeholderRules.cropMode="cover"` 可切回裁切填满（行为未变）。

Input: **只有一条标准路径** —— `--compiled compiled.json`，即
`scripts/compile-ppt-plan.mjs` 的产物（kind=compiled-plan：角色→版式、槽位→texts[]
带 prompt+idx/mode/align/sizePt）。编译期诊断会并入符合性报告（前缀 `compiled_`），
error 同样使退出码为 1。
旧的手写计划入口 `item.title/subtitle/bullets` 与 `--plan` 已**移除**：它们绕过编译期的
必填槽/容量/选版式校验，正是 0.5.4 试用复盘里"溢出磨 10 轮"的成因。

CLI: --template <source.pptx> --parse <parse.json> --compiled <compiled.json>
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
    parser.add_argument("--plan", default=None)
    parser.add_argument("--compiled", default=None)
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

def load_plan(args):
    """读取计划输入：`--plan`（手写语义计划）与 `--compiled`（编译器产物）二选一。

    compiled.json 本身就是一份带 `kind: "compiled-plan"` 标记的 plan —— 同样的字段
    （roles/slides[].role/texts[]/image/notes），所以构建路径完全复用，只是多了一层
    来源校验 + 编译期诊断并入报告。
    """
    if args.plan:
        # 旧的手写计划入口已移除：它不经过编译期校验（必填槽/容量/按图片比例选版式），
        # 正是 0.5.4 试用复盘里"溢出磨 10 轮"的成因。这里明确报出该怎么走。
        raise BuildError(
            "--plan 旧路径已移除：请先编译 —— "
            "node scripts/compile-ppt-plan.mjs --plan <plan.json> --template <模板目录> "
            "--out <compiled.json>，再用 --compiled 构建"
        )
    if not args.compiled:
        raise BuildError("--compiled is required（编译产物 compiled.json；不要手写 plan 直接构建）")
    compiled = read_json(args.compiled, "compiled.json")
    kind = compiled.get("kind")
    if kind != "compiled-plan":
        raise BuildError(
            f"not a compiled plan (kind={kind!r}); regenerate it with "
            "scripts/compile-ppt-plan.mjs"
        )
    return compiled, "compiled"


def apply_compiled_diagnostics(report, compiled):
    """把编译期诊断并入符合性报告：error 会让构建整体判定为失败（退出码 1）。"""
    diagnostics = compiled.get("diagnostics")
    if not isinstance(diagnostics, list):
        return
    rows = []
    for entry in diagnostics:
        if not isinstance(entry, dict):
            continue
        severity = entry.get("severity")
        level = "error" if severity == "error" else ("warning" if severity == "warning" else "pass")
        code = str(entry.get("code") or "diagnostic")
        message = str(entry.get("message") or "")
        location = entry.get("location")
        if isinstance(location, dict):
            where = ", ".join(f"{key}={value}" for key, value in location.items() if value is not None)
            if where:
                message = f"{message} ({where})"
        rows.append({"level": level, "code": f"compiled_{code}", "message": message})
    report["findings"].extend(rows)
    report["findings"].append({
        "level": "pass",
        "code": "compiled_plan",
        "message": f"compiled plan consumed (schemaVersion={compiled.get('schemaVersion')})",
    })


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

def fit_contain(source_width, source_height, box_width, box_height):
    """contain 几何：按比例缩进占位符内并居中，返回相对占位符的偏移与尺寸（EMU）。

    纯函数（不依赖 python-pptx），单测可直接调用它验证四种宽高比组合。
    返回 None 表示几何不可用（源图尺寸或占位符尺寸非正），调用方应保持原样。
    """
    if source_width <= 0 or source_height <= 0 or box_width <= 0 or box_height <= 0:
        return None
    box_w, box_h = int(box_width), int(box_height)
    scale = min(box_w / float(source_width), box_h / float(source_height))
    width = min(int(round(source_width * scale)), box_w)
    height = min(int(round(source_height * scale)), box_h)
    if width <= 0 or height <= 0:
        return None
    return {"left": (box_w - width) // 2, "top": (box_h - height) // 2, "width": width, "height": height}

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
    """Return (layout id to use, finding code or None, the raw mapping value).

    0.5.4+：`scripts/compile-ppt-plan.mjs` 产出的 roles 用**版式名**（例如 "Fig1"）
    作为值 —— pptx-cli manifest 的版式 id 是从版式名 slug 出来的（item/abs/fig1），
    与 parse.json 的 slideLayoutN **不是同一套 id 空间**。所以除了 id，还接受
    「版式名唯一匹配」；同名多个版式时明确报错，绝不猜。
    """
    mapping = roles_map.get(role)
    fallback = title_id if role == "cover" and title_id is not None else (previous_id if previous_id is not None else order[0])
    if not isinstance(mapping, str) or not mapping:
        return fallback, "role_unmapped", mapping
    if mapping in by_id:
        return mapping, None, mapping
    wanted = mapping.strip()
    matches = [layout_id for layout_id, layout in by_id.items()
               if isinstance(layout, dict) and str(layout.get("name") or "").strip() == wanted]
    if len(matches) == 1:
        return matches[0], "role_layout_by_name", mapping
    if len(matches) > 1:
        return fallback, "ambiguous_role_layout_name", mapping
    return fallback, "unknown_role_layout", mapping

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
        texts = slide.get("texts") if isinstance(slide.get("texts"), list) else []
        paragraphs = [p for entry in texts if isinstance(entry, dict) for p in (entry.get("paragraphs") or []) if isinstance(p, str)]
        rows.append({
            "index": index + 1, "role": role, "layoutId": resolved,
            "layoutName": by_id[resolved].get("name") or resolved, "notesChars": len(notes),
            "slotCount": len(texts), "paragraphCount": len(paragraphs),
            "textChars": sum(len(p) for p in paragraphs)
        })
        if code == "role_unmapped":
            add("error", code, f"slide {index + 1} role '{role}' is not mapped in plan.roles; using fallback '{resolved}'")
        elif code == "unknown_role_layout":
            add("error", code, f"slide {index + 1} role '{role}' maps to unknown layout '{mapping}'; using fallback '{resolved}'")
        elif code == "ambiguous_role_layout_name":
            add("error", code, f"slide {index + 1} role '{role}' maps to layout name '{mapping}', which is not unique in this template; using fallback '{resolved}'")
        elif code == "role_layout_by_name":
            add("pass", code, f"slide {index + 1} role '{role}' resolved by layout name '{mapping}' -> '{resolved}'")
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

    def normalize_layout_fonts(presentation):
        """把**版式上的静态文字**也统一成 latin/ea/cs。

        为什么需要：页标题"摘要 Abstract"这类文本挂在版式上、且只有 `a:latin=Arial`、
        没有 `a:ea`，中文只能靠系统回退，不保证是微软雅黑；而 Agent 不写这些文字，
        所以"填充时设字体"覆盖不到它们。这里在成品副本里改版式（不改源模板），
        让整份 deck 满足「中文微软雅黑 / 英文 Arial」。
        只改字体、不动字号（版式里可能有刻意的小字，例如结尾页的辅助文字）。
        `placeholderRules.normalizeLayoutFonts: false` 可关闭。
        """
        for layout in presentation.slide_layouts:
            for shape in layout.shapes:
                if not getattr(shape, "has_text_frame", False):
                    continue
                for paragraph in shape.text_frame.paragraphs:
                    for run in paragraph.runs:
                        run.font.name = font_latin
                        rPr = run._r.get_or_add_rPr()
                        set_typeface(rPr, "a:ea", font_ea)
                        set_typeface(rPr, "a:cs", font_cs)

    def kind_of(shape):
        partial = getattr(getattr(shape, "placeholder_format", None), "type", None)
        return kinds.get(getattr(partial, "name", None) or str(partial).split(" ")[0], "other")

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

    def placeholder_by_prompt(slide, prompt):
        """按**版式里的提示文字**定位占位符，再映射回幻灯片的同 idx 占位符。

        为什么需要它：PowerPoint 会在增删占位符时重新分配 `p:ph/@idx`
        （实测同一模板三次修订：正文 11 → 15，总结页 12 → 14 → 15/16），
        而形状名又常常重复（本模板全部叫「文本占位符 20」）。相比之下
        **提示文字**（"【此处粘贴论文摘要的中文翻译全文…】"、"Fig.1图注"）是
        作者自己写的、语义稳定，是唯一可靠的定位键。
        """
        if not isinstance(prompt, str) or not prompt.strip():
            return None
        layout = getattr(slide, "slide_layout", None)
        if layout is None:
            return None
        candidates = [ph for ph in layout.placeholders if getattr(ph, "has_text_frame", False)]
        for match in ("startswith", "contains"):
            for layout_placeholder in candidates:
                text = (layout_placeholder.text_frame.text or "").strip()
                if not text:
                    continue
                hit = text.startswith(prompt.strip()) if match == "startswith" else prompt.strip() in text
                if hit:
                    return placeholder_by_idx(slide, layout_placeholder.placeholder_format.idx)
        return None

    def write_into_placeholder(slide, entry, index, findings):
        """按 idx（或形状名）定点写入一段或多段文字。"""
        idx = entry.get("idx")
        # 定位优先级：prompt（提示文字，最稳）→ idx（显式）→ name（形状名，可能重复）
        shape = placeholder_by_prompt(slide, entry.get("prompt"))
        if shape is None and isinstance(idx, int) and not isinstance(idx, bool):
            shape = placeholder_by_idx(slide, idx)
        if shape is None and isinstance(entry.get("name"), str) and entry["name"]:
            shape = next((candidate for candidate in slide.shapes if candidate.name == entry["name"]), None)
        if shape is None:
            findings.append({"level": "warning", "code": "placeholder_missing",
                             "message": f"slide {index + 1}: no placeholder for prompt={entry.get('prompt')!r} idx={idx!r} name={entry.get('name')!r}"})
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
        align = entry.get("align") if entry.get("align") in ("left", "center", "right", "justify") else None
        for position, text in enumerate(paragraphs):
            paragraph = frame.paragraphs[0] if position == 0 else frame.add_paragraph()
            paragraph.text = str(text)
            if align is not None:
                from pptx.enum.text import PP_ALIGN
                paragraph.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER,
                                       "right": PP_ALIGN.RIGHT, "justify": PP_ALIGN.JUSTIFY}[align]
            if mode == "paragraph":
                strip_bullet(paragraph)
        style_paragraphs(shape, entry.get("sizePt"))
        return True

    def placeholder_box(shape):
        """读形状几何（EMU）。读不到返回 None，由调用方兜底。"""
        try:
            return {"left": int(shape.left), "top": int(shape.top),
                    "width": int(shape.width), "height": int(shape.height)}
        except (AttributeError, TypeError, ValueError):
            return None

    def apply_contain_fit(picture, box):
        """contain：显式写几何并在占位符内居中，同时清掉 insert_picture 留下的裁切。

        必须显式算几何：`Placeholder.insert_picture()` 只把图片塞进占位符 —— 它既不写
        `a:xfrm`，还会用 `a:srcRect` 把图片**裁**成占位符比例（实测 600x690 的竖长图放进
        12.85x4.78in 的占位符，上下各裁 33.8%）。同一份 srcRect 在两个渲染器上表现还不一致：
        试用时竖长图被 LibreOffice 撑到 9.9 in 高（幻灯片只有 7.5 in）。显式写 width/height
        并清空 crop 后，PowerPoint 与 LibreOffice 看到同一份几何与同一张完整图片。
        """
        try:
            source_width, source_height = picture.image.size
        except (AttributeError, TypeError, ValueError, IndexError):
            return None
        fit = fit_contain(source_width, source_height, box["width"], box["height"])
        if fit is None:
            return None
        picture.left = box["left"] + fit["left"]
        picture.top = box["top"] + fit["top"]
        picture.width = fit["width"]
        picture.height = fit["height"]
        # insert_picture 会写 a:srcRect 把图片裁成占位符比例；contain 要的是完整图片。
        try:
            picture.crop_left = picture.crop_right = picture.crop_top = picture.crop_bottom = 0
        except (AttributeError, TypeError, ValueError):
            pass
        return {"mode": "contain", "source_width": source_width, "source_height": source_height}

    def place_picture(slide, image, caption, title_shape, index=None):
        top = safe if title_shape is None else max(safe, title_shape.top + title_shape.height + Inches(0.15))
        target = next((ph for ph in slide.placeholders if kind_of(ph) == "pic"), None)
        if target is not None:
            # 几何必须在 insert_picture **之前**读：insert_picture 会把占位符降级
            # （spPr/xfrm 被清掉），之后再读 target.width / target.left 会抛
            # AttributeError: 'NoneType' object has no attribute 'cx'。原 cover 分支正是
            # 因此在真模板上静默退化成"不设几何"，只留下一条误报 crop_* 不可用的 warning。
            box = placeholder_box(target)
            picture = target.insert_picture(image)
            if box is None:
                box = placeholder_box(picture)  # 图片自身可继承版式几何，通常仍可读
            applied = None
            if crop_mode == "cover":
                # 本分支保持 0.5.4 的行为不动（包括它读 target.* 会抛错这一点）。它在真模板上
                # 从未真正生效过：insert_picture 已经清掉占位符的 spPr/xfrm，这里读
                # target.width / target.left 必然抛 AttributeError，于是降级成 insert_picture
                # 自带的填充裁切（ext 继承占位符 + a:srcRect 裁掉溢出部分）——那本身就是正确
                # 的 cover 语义。把几何来源换成 box 去"复活"它反而会溢出：实测竖长图的 ext
                # 会是 12.85x14.78in，而幻灯片只有 7.5in 高。故不动，只在本报告里如实记录。
                try:
                    image_ratio, ratio = picture.image.size[0] / picture.image.size[1], target.width / target.height
                    picture.left, picture.top = target.left, target.top
                    if image_ratio > ratio:
                        picture.height, picture.width = int(target.height), int(round(target.height * image_ratio))
                        picture.crop_left = picture.crop_right = (1 - ratio / image_ratio) / 2.0
                    else:
                        picture.width, picture.height = int(target.width), int(round(target.width / image_ratio))
                        picture.crop_top = picture.crop_bottom = (1 - image_ratio / ratio) / 2.0
                    applied = {"mode": "cover", "source_width": picture.image.size[0], "source_height": picture.image.size[1]}
                except (AttributeError, TypeError, ValueError, ZeroDivisionError, IndexError):
                    findings.append({"level": "warning", "code": "image_crop_unsupported",
                                     "message": "python-pptx crop_* unavailable; image kept as contain"})
            elif box is not None:
                # contain（默认）：显式写几何，让两个渲染器看到同一份几何与同一张完整图片。
                applied = apply_contain_fit(picture, box)
            if applied is None:
                # cover 的降级是它自己的既有行为（见上），不该再报"几何无法解析"。
                if crop_mode != "cover":
                    findings.append({"level": "warning", "code": "image_geometry_unresolved",
                                     "message": "slide %s: picture placeholder geometry unresolved; image kept as inserted (%s)"
                                                % (index + 1 if isinstance(index, int) else "?", image)})
            else:
                # finding 词汇表只有 error/warning/pass（编译期诊断的 severity=info 也映射到
                # pass），所以"实际用了哪种 fit、最终几何是多少"这条记录用 pass 级，便于事后核对。
                findings.append({"level": "pass", "code": "image_fit",
                                 "message": "slide %s: fit=%s source=%dx%dpx geometry=%.2fx%.2fin at (%.2f, %.2f) box=%.2fx%.2fin"
                                            % (index + 1 if isinstance(index, int) else "?",
                                               applied["mode"], applied["source_width"], applied["source_height"],
                                               picture.width / 914400.0, picture.height / 914400.0,
                                               picture.left / 914400.0, picture.top / 914400.0,
                                               box["width"] / 914400.0, box["height"] / 914400.0)})
        else:
            picture = slide.shapes.add_picture(image, safe, top, width=prs.slide_width - 2 * safe)
            room = prs.slide_height - safe - top
            if room > 0 and picture.height > room:
                picture.width, picture.height = int(picture.width * (room / picture.height)), int(room)
        if caption:
            cap_top = min(picture.top + picture.height, prs.slide_height - safe - Inches(0.4))
            slide.shapes.add_textbox(safe, cap_top, prs.slide_width - 2 * safe, Inches(0.4)).text_frame.text = caption
        return picture

    # 版式静态文字的字体归一化（占位符正文在写入时处理，这里只管版式自带文本）。
    # 必须放在 helper 定义之后：Python 的局部变量在函数体内只要有赋值就视为局部。
    if rules.get("normalizeLayoutFonts", plan.get("normalizeLayoutFonts", True)) is not False:
        normalize_layout_fonts(prs)
    previous_id = None
    for index, item in enumerate(plan["slides"]):
        resolved, _code, _mapping = resolve_role_layout(item["role"], roles_map, by_id, previous_id, title_id, order)
        slide = prs.slides.add_slide(prs.slide_layouts[pptx_layout_index(prs, resolved, by_id[resolved].get("name"), order)])
        previous_id = resolved
        placeholders = list(slide.placeholders)
        title_shape = slide.shapes.title or next((ph for ph in placeholders if kind_of(ph) == "title"), None)
        # 定点写入：按提示文字（优先）/ idx / 形状名写多段文字。compiled.json 的 texts[]
        # 是唯一的内容来源（旧字段 title/subtitle/bullets 已移除）。
        texts = item.get("texts")
        if isinstance(texts, list):
            for entry in texts:
                if isinstance(entry, dict):
                    write_into_placeholder(slide, entry, index, findings)
        if item.get("image"):
            try:
                place_picture(slide, item["image"], None, title_shape, index)
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
    plan, plan_kind = load_plan(args)
    report = evaluate(parsed, plan, args, template_path, sha256_file(template_path))
    report["planKind"] = plan_kind
    if plan_kind == "compiled":
        apply_compiled_diagnostics(report, plan)
        refresh_summary(report)
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
