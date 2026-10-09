#!/usr/bin/env python3
"""Rewrite the built marketing site so its links read /security, not /security.html.

GitHub Pages serves security.html at /security, so only the links change; the
files stay where Jekyll put them, which keeps old .html links working. A link
is rewritten only when the page it names exists in the artifact. The source
keeps .html so any plain local server still finds every page.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SITE_HOST = "https://mediforce.ai/"
DOCUSAURUS_DIR = "docs"

ABSOLUTE = re.compile(r"https://mediforce\.ai/(?!docs/)((?:[\w-]+/)*)([\w-]+)\.html")
LINK = re.compile(r'href="(?![a-z]+:|//|#|/docs/)(/?(?:\.\./|[\w-]+/)*)([\w-]+)\.html([#?][^"]*)?"')


def clean(folder: str, name: str) -> str:
    return (folder or "./") if name == "index" else f"{folder}{name}"


def page_exists(base: Path, folder: str, name: str, site: Path) -> bool:
    root = site if folder.startswith("/") else base
    return (root / folder.lstrip("/") / f"{name}.html").resolve().is_file()


def rewrite_links(page: Path, text: str, site: Path) -> str:
    def replace(match: re.Match[str]) -> str:
        folder, name, suffix = match.group(1), match.group(2), match.group(3) or ""
        if page_exists(page.parent, folder, name, site) is False:
            return match.group(0)
        return f'href="{clean(folder, name)}{suffix}"'
    return LINK.sub(replace, text)


def rewrite_absolute(text: str, site: Path) -> str:
    def replace(match: re.Match[str]) -> str:
        folder, name = match.group(1), match.group(2)
        if (site / folder / f"{name}.html").is_file() is False:
            return match.group(0)
        return SITE_HOST + clean(folder, name).removeprefix("./")
    return ABSOLUTE.sub(replace, text)


def marketing_files(site: Path) -> list[Path]:
    return [
        path for path in site.rglob("*")
        if path.is_file()
        and path.relative_to(site).parts[0] != DOCUSAURUS_DIR
        and path.suffix in {".html", ".xml", ".txt"}
    ]


def main() -> int:
    site = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
    changed = 0
    for page in marketing_files(site):
        text = page.read_text(encoding="utf-8")
        updated = rewrite_absolute(text, site)
        if page.suffix == ".html":
            updated = rewrite_links(page, updated, site)
        if updated != text:
            page.write_text(updated, encoding="utf-8")
            changed += 1

    nav = site / "nav.js"
    script = nav.read_text(encoding="utf-8").replace("${p}index.html", "${p}./")
    names = [name for name in re.findall(r"\b([\w-]+)\.html\b", script) if (site / f"{name}.html").is_file()]
    missing = sorted(set(re.findall(r"\b([\w-]+)\.html\b", script)) - set(names))
    if missing:
        print(f"nav.js links to pages that are not in the site: {missing}", file=sys.stderr)
        return 1
    nav.write_text(re.sub(r"\b([\w-]+)\.html\b", r"\1", script), encoding="utf-8")

    print(f"[urls] {changed} files rewritten to extensionless links")
    return 0


if __name__ == "__main__":
    sys.exit(main())
