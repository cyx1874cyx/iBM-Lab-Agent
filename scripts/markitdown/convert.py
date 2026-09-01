#!/usr/bin/env python3
"""dsh-lab-agent markitdown converter (optional; requires the `markitdown` package).

Input:  argv[1] = input file path; argv[2] (optional) = output markdown path.
Output: JSON on stdout: {"ok": true, "text": "..."} or {"ok": false, "error": "..."}.
Exit codes: 0 ok, 1 convert error, 2 markitdown unavailable.

Install (in the lab venv / any python):
    python -m pip install markitdown
"""
import json
import sys


def configure_utf8_stdio() -> None:
    """Keep JSON protocol and diagnostics Unicode-safe on legacy Windows code pages.

    MarkItDown's extracted text can contain symbols such as ✉ and non-breaking
    hyphens.  When this helper is launched by Node on a Chinese Windows system,
    Python may otherwise choose the GBK console encoding for its stdout pipe and
    fail while printing the JSON response.  Output files already use UTF-8; the
    process protocol must use the same encoding.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="backslashreplace")


def main() -> int:
    configure_utf8_stdio()
    if len(sys.argv) >= 2 and sys.argv[1] == "--check":
        try:
            from markitdown import MarkItDown  # noqa: F401
            print(json.dumps({"ok": True, "available": True}))
            return 0
        except ImportError:
            print(json.dumps({"ok": False, "available": False, "error": "markitdown not installed; run: python -m pip install markitdown"}))
            return 2

    try:
        from markitdown import MarkItDown
    except ImportError:
        print(json.dumps({"ok": False, "error": "markitdown is not installed; run: python -m pip install markitdown"}))
        return 2

    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: convert.py <input> [output.md]"}))
        return 1

    source = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else None
    try:
        converter = MarkItDown()
        result = converter.convert(source)
        text = result.text_content or ""
        if output:
            with open(output, "w", encoding="utf-8") as fh:
                fh.write(text)
        print(json.dumps({"ok": True, "text": text}, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001 - report any conversion failure as JSON
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
