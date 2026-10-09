#!/usr/bin/env python3
"""Write the marketing site's sitemap.xml from the built pages.

Every page with a canonical URL and no noindex is listed, so a new page is in
the sitemap without anyone remembering to add it. lastmod is the date of the
last commit that touched the page's source, which needs a full git history
(fetch-depth: 0 in pages.yml).
"""

from __future__ import annotations

import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

DOCUSAURUS_DIR = "docs"

RULES = [
    ("/", "weekly", "1.0", True),
    ("/news", "weekly", "0.7", False),
    ("/case-studies/", "monthly", "0.8", False),
    ("/setup/", "monthly", "0.8", False),
    ("/contact", "yearly", "0.6", False),
]
DEFAULT = ("monthly", "0.7")


def classify(path: str) -> tuple[str, str]:
    for prefix, changefreq, priority, exact in RULES:
        if (path == prefix) if exact else path.startswith(prefix):
            return changefreq, priority
    return DEFAULT


def last_commit_date(source: Path, repo: Path) -> str:
    result = subprocess.run(
        ["git", "log", "-1", "--format=%cs", "--", str(source)],
        cwd=repo, capture_output=True, text=True, check=False,
    )
    return result.stdout.strip() or date.today().isoformat()


def main() -> int:
    site = Path(sys.argv[1] if len(sys.argv) > 1 else "_site").resolve()
    source_root = Path(sys.argv[2] if len(sys.argv) > 2 else "docs").resolve()
    repo = source_root.parent

    entries = []
    for page in sorted(site.rglob("*.html")):
        relative = page.relative_to(site)
        if relative.parts[0] == DOCUSAURUS_DIR:
            continue
        html = page.read_text(encoding="utf-8")
        if re.search(r'<meta[^>]+name="robots"[^>]+content="[^"]*noindex', html, re.I):
            continue
        canonical = re.search(r'<link[^>]+rel="canonical"[^>]+href="([^"]+)"', html, re.I)
        if canonical is None:
            continue
        loc = canonical.group(1)
        path = "/" + loc.split("://", 1)[1].split("/", 1)[1]
        source = source_root / relative
        changefreq, priority = classify(path)
        entries.append((loc, last_commit_date(source, repo), changefreq, priority))

    entries.sort(key=lambda entry: (-float(entry[3]), entry[0]))
    body = "\n".join(
        f"  <url>\n    <loc>{escape(loc)}</loc>\n    <lastmod>{lastmod}</lastmod>\n"
        f"    <changefreq>{changefreq}</changefreq>\n    <priority>{priority}</priority>\n  </url>"
        for loc, lastmod, changefreq, priority in entries
    )
    (site / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n</urlset>\n",
        encoding="utf-8",
    )
    print(f"[sitemap] {len(entries)} pages -> sitemap.xml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
