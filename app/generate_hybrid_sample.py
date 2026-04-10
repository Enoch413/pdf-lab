from __future__ import annotations

import argparse
import html
import importlib.util
from pathlib import Path

import fitz

PRETENDARD_CDN = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"


def load_repacker_module(script_path: Path):
    spec = importlib.util.spec_from_file_location("repacker", script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def extract_segment_lines(page: fitz.Page, rect: fitz.Rect) -> list[str]:
    lines: list[str] = []
    for block in page.get_text("blocks", clip=rect):
        text = str(block[4]).replace("\xa0", " ").strip()
        if not text:
            continue
        lines.extend([line.strip() for line in text.splitlines() if line.strip()])
    return lines


def merge_wrapped_lines(lines: list[str]) -> str:
    return " ".join(line.strip() for line in lines if line.strip()).strip()


def parse_question(lines: list[str], number: int) -> dict:
    filtered = [line for line in lines if line.strip() and line.strip() != f"{number}."]
    if not filtered:
        return {"prompt": "", "choices": []}

    prompt = filtered[0]
    choices: list[str] = []
    current: list[str] = []
    option_markers = tuple("①②③④⑤")
    for line in filtered[1:]:
        stripped = line.strip()
        if stripped.startswith(option_markers):
            if current:
                choices.append(merge_wrapped_lines(current))
            current = [stripped]
        elif current:
            current.append(stripped)
        else:
            prompt = f"{prompt} {stripped}".strip()
    if current:
        choices.append(merge_wrapped_lines(current))
    return {"prompt": prompt, "choices": choices}


def save_segment_images(doc: fitz.Document, entry: dict, images_dir: Path, prefix: str, scale: float = 2.0) -> list[str]:
    image_paths: list[str] = []
    for index, segment in enumerate(entry["segments"], start=1):
        page = doc.load_page(segment["page_index"])
        clip = fitz.Rect(segment["x0"], segment["y0"], segment["x1"], segment["y1"])
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False)
        filename = f"{prefix}_seg_{index:02d}.png"
        destination = images_dir / filename
        pix.save(destination)
        image_paths.append(f"images/{filename}")
    return image_paths


def copy_font_assets(output_dir: Path) -> None:
    return None


if __name__ == "__main__":
    main()
