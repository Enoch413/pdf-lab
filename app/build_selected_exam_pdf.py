from __future__ import annotations

import copy
import html
import subprocess
from collections import defaultdict
from pathlib import Path

import fitz

from generate_repacked_html import (
    HEADER_HEIGHT_MM,
    analyze_page,
    build_entries,
    build_layout,
    choose_render_scale,
    reset_output_dir,
)

PROJECT_ROOT = Path(__file__).resolve().parent
OUTPUT_ROOT = PROJECT_ROOT / "artifacts" / "exam_selection"
OUTPUT_DIR = OUTPUT_ROOT / "2gangseoA_first_exam_fixed"
PRETENDARD_CDN = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
HTML_NAME = "index.html"
PDF_NAME = "2강서A_1차_문제지.pdf"

PAGE_PADDING_MM = 12
COLUMN_GAP_MM = 7
CARD_GAP_MM = 6
MAX_PER_COLUMN = 2


def find_source_root() -> Path:
    candidates = [
        Path(r"C:\Users\CHOI\Documents\카카오톡 받은 파일\문제0401 - 복사본\문제\2강서A 문제"),
        Path(r"C:\Users\CHOI\Documents\카카오톡 받은 파일\문제0401\문제\2강서A 문제"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("Could not find 2강서A 문제 source folder.")


SOURCE_ROOT = find_source_root()


SELECTION_ORDER = [
    {
        "kind": "single",
        "exam_number": 1,
        "source_pdf": "월_교과서 1과.pdf",
        "problem_number": 32,
        "title": "순서",
    },
    {
        "kind": "single",
        "exam_number": 2,
        "source_pdf": "월_교과서 1과.pdf",
        "problem_number": 2,
        "title": "연결사",
    },
    {
        "kind": "single",
        "exam_number": 3,
        "source_pdf": "월_교과서 1과.pdf",
        "problem_number": 22,
        "title": "요약",
    },
    {
        "kind": "single",
        "exam_number": 4,
        "source_pdf": "월_교과서 1과.pdf",
        "problem_number": 142,
        "title": "요약",
    },
    {
        "kind": "single",
        "exam_number": 5,
        "source_pdf": "금_교과서 1과_주관식.pdf",
        "problem_number": 18,
        "title": "주관식",
        "meta_text": "어법 고치기",
    },
    {
        "kind": "single",
        "exam_number": 6,
        "source_pdf": "월_교과서 1과.pdf",
        "problem_number": 73,
        "title": "주제",
    },
    {
        "kind": "single",
        "exam_number": 7,
        "source_pdf": "금_Q미니S 1강_어법어휘.pdf",
        "problem_number": 1,
        "title": "어휘",
    },
    {
        "kind": "single",
        "exam_number": 8,
        "source_pdf": "금_Q미니S 1강_어법어휘.pdf",
        "problem_number": 9,
        "title": "어법",
    },
    {
        "kind": "tail",
        "source_pdf": "화_Q미니S 1강.pdf",
        "group_label": "24-25",
        "exam_numbers": [9, 10],
        "problem_numbers": [24, 25],
    },
    {
        "kind": "single",
        "exam_number": 11,
        "source_pdf": "금_Q미니S 1강_어법어휘.pdf",
        "problem_number": 23,
        "title": "어법",
    },
    {
        "kind": "tail",
        "source_pdf": "화_Q미니S 1강.pdf",
        "group_label": "27-28",
        "exam_numbers": [12, 13],
        "problem_numbers": [27, 28],
    },
    {
        "kind": "tail",
        "source_pdf": "화_Q미니S 1강.pdf",
        "group_label": "34-35",
        "exam_numbers": [14, 15],
        "problem_numbers": [34, 35],
    },
    {
        "kind": "tail",
        "source_pdf": "화_Q미니S 1강.pdf",
        "group_label": "7-8",
        "exam_numbers": [16, 17],
        "problem_numbers": [7, 8],
    },
    {
        "kind": "single",
        "exam_number": 18,
        "source_pdf": "수_Q미니S 2강.pdf",
        "problem_number": 1,
        "title": "순서",
    },
    {
        "kind": "single",
        "exam_number": 19,
        "source_pdf": "금_Q미니S 2강_주관식.pdf",
        "problem_number": 7,
        "title": "주관식",
        "meta_text": "영작",
    },
    {
        "kind": "single",
        "exam_number": 20,
        "source_pdf": "수_Q미니S 2강.pdf",
        "problem_number": 3,
        "title": "삽입",
    },
    {
        "kind": "single",
        "exam_number": 21,
        "source_pdf": "수_Q미니S 2강.pdf",
        "problem_number": 4,
        "title": "내용일치",
    },
    {
        "kind": "single",
        "exam_number": 22,
        "source_pdf": "수_Q미니S 2강.pdf",
        "problem_number": 12,
        "title": "무관",
    },
    {
        "kind": "single",
        "exam_number": 23,
        "source_pdf": "수_Q미니S 2강.pdf",
        "problem_number": 13,
        "title": "제목",
    },
    {
        "kind": "single",
        "exam_number": 24,
        "source_pdf": "수_Q미니S 2강.pdf",
        "problem_number": 14,
        "title": "요지",
    },
]


def build_source_maps(pdf_path: Path) -> tuple[dict[int, dict], dict[str, dict]]:
    doc = fitz.open(pdf_path)
    page_infos = [analyze_page(index, doc.load_page(index)) for index in range(doc.page_count)]
    problems, entries = build_entries(page_infos)
    problem_map = {entry["number"]: entry for entry in entries if entry["kind"] == "problem"}
    shared_map = {entry["group_label"]: entry for entry in entries if entry["kind"] == "shared"}
    if len(problem_map) != len(problems):
        raise RuntimeError(f"Duplicate problem numbers detected in {pdf_path.name}")
    return problem_map, shared_map


def clone_entry(entry: dict, *, source_pdf_name: str, badge_text: str, meta_text: str = "", image_prefix: str = "") -> dict:
    cloned = copy.deepcopy(entry)
    cloned["source_pdf_name"] = source_pdf_name
    cloned["badge_text"] = badge_text
    cloned["meta_text"] = meta_text
    cloned["image_prefix"] = image_prefix or badge_text.replace(" ", "_")
    cloned["segment_images"] = []
    return cloned


def selection_to_entries() -> tuple[list[dict], dict[str, Path]]:
    selected_entries: list[dict] = []
    source_paths = {}
    source_maps = {}

    for source_name in sorted({item["source_pdf"] for item in SELECTION_ORDER}):
        pdf_path = SOURCE_ROOT / source_name
        if not pdf_path.exists():
            raise FileNotFoundError(pdf_path)
        source_paths[source_name] = pdf_path
        source_maps[source_name] = build_source_maps(pdf_path)

    for item in SELECTION_ORDER:
        problem_map, shared_map = source_maps[item["source_pdf"]]
        if item["kind"] == "single":
            entry = problem_map.get(item["problem_number"])
            if entry is None:
                raise KeyError(f"Problem {item['problem_number']} not found in {item['source_pdf']}")
            selected_entries.append(
                clone_entry(
                    entry,
                    source_pdf_name=item["source_pdf"],
                    badge_text=f"문항 {item['exam_number']}",
                    meta_text=item.get("meta_text", ""),
                    image_prefix=f"q{item['exam_number']:02d}",
                )
            )
            continue

        shared_entry = shared_map.get(item["group_label"])
        if shared_entry is None:
            raise KeyError(f"Shared block {item['group_label']} not found in {item['source_pdf']}")
        selected_entries.append(
            clone_entry(
                shared_entry,
                source_pdf_name=item["source_pdf"],
                badge_text=f"문항 {item['exam_numbers'][0]}-{item['exam_numbers'][1]} 공통 지문",
                image_prefix=f"q{item['exam_numbers'][0]:02d}_{item['exam_numbers'][1]:02d}_shared",
            )
        )
        for exam_number, problem_number in zip(item["exam_numbers"], item["problem_numbers"], strict=True):
            entry = problem_map.get(problem_number)
            if entry is None:
                raise KeyError(f"Problem {problem_number} not found in {item['source_pdf']}")
            selected_entries.append(
                clone_entry(
                    entry,
                    source_pdf_name=item["source_pdf"],
                    badge_text=f"문항 {exam_number}",
                    image_prefix=f"q{exam_number:02d}",
                )
            )

    return selected_entries, source_paths


def render_selected_segments(doc: fitz.Document, entries: list[dict], images_dir: Path, scale: float) -> None:
    for entry in entries:
        rendered = []
        for segment_index, segment in enumerate(entry["segments"], start=1):
            page = doc.load_page(segment["page_index"])
            clip = fitz.Rect(segment["x0"], segment["y0"], segment["x1"], segment["y1"])
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False)
            prefix = entry["image_prefix"]
            filename = f"{prefix}_seg_{segment_index:02d}.png"
            destination = images_dir / filename
            pix.save(destination)
            rendered.append(
                {
                    "path": f"images/{filename}",
                    "width": pix.width,
                    "height": pix.height,
                }
            )
        entry["segment_images"] = rendered


def copy_font_assets(output_dir: Path) -> None:
    return None


if __name__ == "__main__":
    main()
