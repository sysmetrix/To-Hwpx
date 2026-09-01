#!/usr/bin/env python3
"""Render every PDF page to thumbnails and numbered contact sheets for visual QA."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pymupdf as fitz
from PIL import Image, ImageDraw


def render(pdf_path: Path, output_dir: Path, columns: int = 4, rows: int = 5) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    document = fitz.open(pdf_path)
    thumb_width = 300
    thumbnails: list[Path] = []
    ink_coverage: list[float] = []

    for index, page in enumerate(document):
        scale = thumb_width / page.rect.width
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        target = output_dir / f"thumb-{index + 1:03d}.png"
        pixmap.save(target)
        thumbnails.append(target)
        rendered = Image.open(target).convert("L")
        histogram = rendered.histogram()
        ink_coverage.append(sum(histogram[:245]) / (rendered.width * rendered.height))

    cell_width, cell_height = 330, 460
    per_sheet = columns * rows
    sheets: list[Path] = []
    for sheet_index in range(0, len(thumbnails), per_sheet):
        group = thumbnails[sheet_index : sheet_index + per_sheet]
        sheet = Image.new("RGB", (cell_width * columns, cell_height * rows), "#d9dee7")
        draw = ImageDraw.Draw(sheet)
        for offset, thumbnail in enumerate(group):
            image = Image.open(thumbnail).convert("RGB")
            max_height = cell_height - 34
            image.thumbnail((cell_width - 18, max_height))
            x = (offset % columns) * cell_width + (cell_width - image.width) // 2
            y = (offset // columns) * cell_height + 25
            sheet.paste(image, (x, y))
            page_number = sheet_index + offset + 1
            draw.text((offset % columns * cell_width + 8, offset // columns * cell_height + 5),
                      f"page {page_number}", fill="#111827")
        target = output_dir / f"contact-{sheet_index // per_sheet + 1:02d}.png"
        sheet.save(target, optimize=True)
        sheets.append(target)

    return {
        "pdf": str(pdf_path.resolve()),
        "pages": len(document),
        "thumbnails": len(thumbnails),
        "inkCoverage": {
            "minimum": round(min(ink_coverage, default=0), 6),
            "maximum": round(max(ink_coverage, default=0), 6),
            "lowInkPagesBelow0_5Percent": [
                index + 1 for index, coverage in enumerate(ink_coverage) if coverage < 0.005
            ],
        },
        "contactSheets": [str(path.resolve()) for path in sheets],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--rows", type=int, default=5)
    args = parser.parse_args()
    print(json.dumps(render(args.pdf, args.output_dir, args.columns, args.rows), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
