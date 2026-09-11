#!/usr/bin/env python3

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
STYLE_DIR = ROOT / "print-styles"
DEFAULT_SOURCE = ROOT / "layer2-scores-research.md"
DEFAULT_OUTPUT_DIR = ROOT / "rendered-pdfs"

PLAYWRIGHT_PDF_SCRIPT = """
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(process.argv[1], { waitUntil: 'networkidle' });
  await page.pdf({
    path: process.argv[2],
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    preferCSSPageSize: true
  });
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
""".strip()


VARIANTS = {
    "github-raw": {
        "suffix": "github-raw",
        "title_suffix": "GitHub Raw",
        "css": "github-raw.css",
        "toc": False,
    },
    "print-memo": {
        "suffix": "print-memo",
        "title_suffix": "Print Memo",
        "css": "print-memo.css",
        "toc": True,
    },
    "editorial": {
        "suffix": "editorial",
        "title_suffix": "Editorial",
        "css": "editorial.css",
        "toc": True,
    },
    "technical-brief": {
        "suffix": "technical-brief",
        "title_suffix": "Technical Brief",
        "css": "technical-brief.css",
        "toc": True,
    },
}


def run(command: list[str]) -> None:
    subprocess.run(command, check=True, cwd=ROOT)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a markdown document into one or more print-ready PDF variants."
    )
    parser.add_argument(
        "source",
        nargs="?",
        default=str(DEFAULT_SOURCE),
        help="Path to the markdown file. Defaults to layer2-scores-research.md.",
    )
    parser.add_argument(
        "--variant",
        action="append",
        choices=sorted(VARIANTS),
        help="Render only the selected variant. Repeat to render multiple variants.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory for generated HTML and PDF files.",
    )
    parser.add_argument(
        "--title",
        help="Override the document title used in PDF metadata and browser tab title.",
    )
    parser.add_argument(
        "--author",
        help="Override the document author metadata.",
    )
    parser.add_argument(
        "--date",
        help="Override the document date metadata.",
    )
    parser.add_argument(
        "--pdf-only",
        action="store_true",
        help="Delete intermediate HTML files after PDF generation.",
    )
    return parser.parse_args()


def read_markdown_title(source: Path) -> str:
    for line in source.read_text(encoding="utf-8").splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return source.stem.replace("-", " ").replace("_", " ").title()


def slugify_stem(source: Path) -> str:
    return source.stem.replace(" ", "-")


def build_html(
    source: Path,
    variant_name: str,
    variant: dict[str, object],
    html_path: Path,
    title: str,
    author: str | None,
    date_value: str | None,
) -> None:
    command = [
        "pandoc",
        str(source),
        "--from",
        "gfm",
        "--to",
        "html5",
        "--standalone",
        "--embed-resources",
        "--metadata",
        f"pagetitle={title} - {variant['title_suffix']}",
        "--metadata",
        f"title={title}",
        "--css",
        str(STYLE_DIR / str(variant["css"])),
        "-o",
        str(html_path),
    ]
    if author:
        command.extend(["--metadata", f"author={author}"])
    if date_value:
        command.extend(["--metadata", f"date={date_value}"])
    if variant["toc"]:
        command.extend(["--toc", "--toc-depth=2"])
    run(command)


def build_pdf(html_path: Path, pdf_path: Path) -> None:
    run(["node", "-e", PLAYWRIGHT_PDF_SCRIPT, html_path.as_uri(), str(pdf_path)])


def main() -> None:
    args = parse_args()
    source = Path(args.source).resolve()
    output_dir = Path(args.output_dir).resolve()
    variants = args.variant or list(VARIANTS.keys())

    if not source.exists():
        raise FileNotFoundError(f"Source file does not exist: {source}")

    output_dir.mkdir(exist_ok=True, parents=True)

    title = args.title or read_markdown_title(source)
    base_slug = slugify_stem(source)

    for variant_name in variants:
        variant = VARIANTS[variant_name]
        html_path = output_dir / f"{base_slug}.{variant['suffix']}.html"
        pdf_path = output_dir / f"{base_slug}.{variant['suffix']}.pdf"
        build_html(source, variant_name, variant, html_path, title, args.author, args.date)
        build_pdf(html_path, pdf_path)
        if args.pdf_only:
            html_path.unlink(missing_ok=True)
        print(pdf_path.name)


if __name__ == "__main__":
    main()
