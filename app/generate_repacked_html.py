from __future__ import annotations

import argparse
import html
import math
import re
from pathlib import Path

import fitz

HEADER_CUTOFF = 38
FOOTER_CUTOFF = 28
COLUMN_COUNT = 2
FIRST_SEGMENT_TOP_PAD = 8
NEXT_START_GAP = 10
MARKER_HEIGHT_SLACK = 0.75
MARKER_LINE_TOLERANCE = 3.5
MARKER_LINE_START_TOLERANCE = 12
SHARED_MARKER_TOP_PAD = 6
SHEET_WIDTH_MM = 210
SHEET_HEIGHT_MM = 297
HEADER_HEIGHT_MM = 24
FOOTER_HEIGHT_MM = 8
CARD_FIXED_HEIGHT_MM = 10.2
SEGMENT_GAP_MM = 1.8
MIN_FIT_SCALE = 0.66
QUESTION_MARKER_PATTERN = re.compile(r"\d+\.")
RANGE_MARKER_PATTERN = re.compile(r"\[(\d+)-(\d+)\]")
PRETENDARD_CDN = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
ANSWER_PAGE_PATTERN = re.compile(r"정답지")


def slugify(value: str) -> str:
    safe = re.sub(r"[^\w\-]+", "-", value, flags=re.UNICODE)
    safe = re.sub(r"-{2,}", "-", safe).strip("-")
    return safe or "output"


def choose_render_scale(page_count: int, problem_count: int) -> float:
    if page_count >= 40 or problem_count >= 140:
        return 1.4
    if page_count >= 20 or problem_count >= 80:
        return 1.65
    return 2.1


def empty_column(page_index: int, column_index: int, col_start: float, col_end: float, page_height: float) -> dict:
    return {
        "key": f"{page_index}-{column_index}",
        "page_index": page_index,
        "column_index": column_index,
        "items": [],
        "x0": col_start,
        "x1": col_end,
        "top_y": HEADER_CUTOFF,
        "bottom_y": page_height - FOOTER_CUTOFF,
        "markers": [],
        "range_markers": [],
    }


def collect_markers(column_words: list[dict]) -> list[dict]:
    candidates = [word for word in column_words if QUESTION_MARKER_PATTERN.fullmatch(word["text"])]
    if not candidates:
        return []

    max_height = max(word["height"] for word in candidates)
    min_height = max_height - MARKER_HEIGHT_SLACK
    markers = []
    for word in candidates:
        if word["height"] + 1e-6 < min_height:
            continue

        line_words = [item for item in column_words if abs(item["y0"] - word["y0"]) <= MARKER_LINE_TOLERANCE]
        line_left_x = min(item["x0"] for item in line_words)
        if word["x0"] - line_left_x > MARKER_LINE_START_TOLERANCE:
            continue

        markers.append({"number": int(word["text"][:-1]), "item": word})

    markers.sort(key=lambda item: item["item"]["y0"])
    return markers


def collect_range_markers(column_words: list[dict]) -> list[dict]:
    markers = []
    for word in column_words:
        match = RANGE_MARKER_PATTERN.fullmatch(word["text"])
        if not match:
            continue
        start_number = int(match.group(1))
        end_number = int(match.group(2))
        if end_number <= start_number:
            continue
        markers.append(
            {
                "label": word["text"],
                "start_number": start_number,
                "end_number": end_number,
                "item": word,
            }
        )

    markers.sort(key=lambda item: item["item"]["y0"])
    return markers


def analyze_page(page_index: int, page: fitz.Page) -> dict:
    rect = page.rect
    midpoint = rect.width / COLUMN_COUNT
    if ANSWER_PAGE_PATTERN.search(page.get_text("text")):
        return {
            "page_index": page_index,
            "is_answer_page": True,
            "columns": [
                empty_column(page_index, column_index, midpoint * column_index, midpoint * (column_index + 1), rect.height)
                for column_index in range(COLUMN_COUNT)
            ],
        }

    words = []
    for entry in page.get_text("words"):
        x0, y0, x1, y1, text, *_ = entry
        text = text.strip()
        if not text:
            continue
        if y0 <= HEADER_CUTOFF or y1 >= rect.height - FOOTER_CUTOFF:
            continue
        words.append(
            {
                "text": text,
                "x0": x0,
                "y0": y0,
                "x1": x1,
                "y1": y1,
                "cx": (x0 + x1) / 2,
                "height": y1 - y0,
            }
        )

    columns = []
    for column_index in range(COLUMN_COUNT):
        col_start = midpoint * column_index
        col_end = midpoint * (column_index + 1)
        column_words = [word for word in words if col_start <= word["cx"] < col_end]
        if not column_words:
            columns.append(empty_column(page_index, column_index, col_start, col_end, rect.height))
            continue

        columns.append(
            {
                "key": f"{page_index}-{column_index}",
                "page_index": page_index,
                "column_index": column_index,
                "items": column_words,
                "x0": max(0, min(word["x0"] for word in column_words) - 10),
                "x1": min(rect.width, max(word["x1"] for word in column_words) + 10),
                "top_y": max(HEADER_CUTOFF, min(word["y0"] for word in column_words) - 6),
                "bottom_y": min(rect.height - FOOTER_CUTOFF, max(word["y1"] for word in column_words) + 6),
                "markers": collect_markers(column_words),
                "range_markers": collect_range_markers(column_words),
            }
        )

    return {"page_index": page_index, "is_answer_page": False, "columns": columns}


def event_position(event: dict) -> tuple[int, float]:
    return event["order_index"], event["item"]["y0"]


def collect_segments(ordered_columns: list[dict], start_event: dict, end_event: dict | None) -> list[dict]:
    end_order_index = end_event["order_index"] if end_event else len(ordered_columns) - 1
    top_pad = SHARED_MARKER_TOP_PAD if start_event["type"] == "range" else FIRST_SEGMENT_TOP_PAD
    segments = []
    for order_index in range(start_event["order_index"], end_order_index + 1):
        column = ordered_columns[order_index]
        y0 = column["top_y"]
        y1 = column["bottom_y"]
        if order_index == start_event["order_index"]:
            y0 = max(column["top_y"], start_event["item"]["y0"] - top_pad)
        if end_event and order_index == end_event["order_index"]:
            y1 = min(column["bottom_y"], end_event["item"]["y0"] - NEXT_START_GAP)
        if y1 - y0 >= 16:
            segments.append(
                {
                    "page_index": column["page_index"],
                    "column_index": column["column_index"],
                    "x0": column["x0"],
                    "x1": column["x1"],
                    "y0": y0,
                    "y1": y1,
                }
            )
    return segments


def build_entries(page_infos: list[dict]) -> tuple[list[dict], list[dict]]:
    ordered_columns = [column for page in page_infos if not page.get("is_answer_page") for column in page["columns"] if column["items"]]
    column_map = {column["key"]: {**column, "order_index": idx} for idx, column in enumerate(ordered_columns)}

    question_events = []
    range_events = []
    for column in ordered_columns:
        order_index = column_map[column["key"]]["order_index"]
        for marker in column["markers"]:
            question_events.append(
                {
                    "type": "question",
                    "number": marker["number"],
                    "item": marker["item"],
                    "order_index": order_index,
                }
            )
        for marker in column.get("range_markers", []):
            range_events.append(
                {
                    "type": "range",
                    "label": marker["label"],
                    "start_number": marker["start_number"],
                    "end_number": marker["end_number"],
                    "item": marker["item"],
                    "order_index": order_index,
                }
            )

    question_events.sort(key=event_position)
    if not question_events:
        raise RuntimeError("문항 시작 번호를 찾지 못했습니다.")

    valid_range_events = []
    for range_event in range_events:
        target_question = next(
            (
                question_event
                for question_event in question_events
                if question_event["number"] == range_event["start_number"] and event_position(question_event) > event_position(range_event)
            ),
            None,
        )
        if target_question:
            valid_range_events.append({**range_event, "target_question": target_question})

    grouped_labels = {}
    for range_event in valid_range_events:
        group_label = f"{range_event['start_number']}-{range_event['end_number']}"
        for number in range(range_event["start_number"], range_event["end_number"] + 1):
            grouped_labels[number] = group_label

    ordered_events = sorted(question_events + valid_range_events, key=event_position)
    problem_entries = []
    all_entries = []

    for index, event in enumerate(ordered_events):
        if event["type"] == "range":
            segments = collect_segments(ordered_columns, event, event["target_question"])
            if not segments:
                continue
            all_entries.append(
                {
                    "id": f"shared-{event['start_number']}-{event['end_number']}",
                    "kind": "shared",
                    "number": None,
                    "group_label": f"{event['start_number']}-{event['end_number']}",
                    "segments": segments,
                    "page_count": len({segment["page_index"] for segment in segments}),
                    "segment_images": [],
                }
            )
            continue

        next_event = ordered_events[index + 1] if index + 1 < len(ordered_events) else None
        segments = collect_segments(ordered_columns, event, next_event)
        if not segments:
            continue
        problem = {
            "id": f"problem-{event['number']}",
            "kind": "problem",
            "number": event["number"],
            "group_label": grouped_labels.get(event["number"], ""),
            "segments": segments,
            "page_count": len({segment["page_index"] for segment in segments}),
            "segment_images": [],
        }
        problem_entries.append(problem)
        all_entries.append(problem)

    return problem_entries, all_entries


def calculate_metrics(segments: list[dict], column_width_mm: float) -> tuple[float, float]:
    scalable = 0.0
    for segment in segments:
        width = max(1.0, segment["x1"] - segment["x0"])
        height = max(1.0, segment["y1"] - segment["y0"])
        scalable += column_width_mm * (height / width)
    fixed = CARD_FIXED_HEIGHT_MM + max(0, len(segments) - 1) * SEGMENT_GAP_MM
    return scalable, fixed


def estimate_height(metrics: tuple[float, float], fit_scale: float) -> float:
    scalable, fixed = metrics
    return fixed + scalable * fit_scale


def split_entry_into_cards(entry: dict, column_width_mm: float, column_height_mm: float) -> list[dict]:
    if entry["kind"] != "shared" or len(entry["segments"]) <= 1:
        return [
            {
                "id": f"{entry['id']}-card-1",
                "entry": entry,
                "segments": entry["segments"],
                "segment_start": 0,
                "segment_end": len(entry["segments"]),
                "continuation": False,
                "slot_cost": 1 if entry["kind"] == "problem" else 0,
            }
        ]

    segment_heights = [
        column_width_mm * (max(1.0, segment["y1"] - segment["y0"]) / max(1.0, segment["x1"] - segment["x0"]))
        for segment in entry["segments"]
    ]
    cards = []
    start_index = 0
    part_index = 0
    while start_index < len(entry["segments"]):
        used_height = CARD_FIXED_HEIGHT_MM
        end_index = start_index
        while end_index < len(entry["segments"]):
            next_height = segment_heights[end_index]
            gap_before = SEGMENT_GAP_MM if end_index > start_index else 0
            projected = used_height + gap_before + next_height
            if end_index == start_index or projected <= column_height_mm + 0.4:
                used_height = projected
                end_index += 1
                continue
            break
        cards.append(
            {
                "id": f"{entry['id']}-card-{part_index + 1}",
                "entry": entry,
                "segments": entry["segments"][start_index:end_index],
                "segment_start": start_index,
                "segment_end": end_index,
                "continuation": part_index > 0,
                "slot_cost": 0,
            }
        )
        start_index = end_index
        part_index += 1
    return cards


def build_layout(entries: list[dict], max_per_column: int, page_padding: int, column_gap: int, card_gap: int) -> tuple[list[dict], float]:
    inner_width = SHEET_WIDTH_MM - page_padding * 2
    inner_height = SHEET_HEIGHT_MM - page_padding * 2
    column_width = (inner_width - column_gap) / 2
    column_height = inner_height - HEADER_HEIGHT_MM - FOOTER_HEIGHT_MM
    cards = [card for entry in entries for card in split_entry_into_cards(entry, column_width, column_height)]

    def new_column() -> dict:
        return {"items": [], "used_height": 0.0, "used_slots": 0}

    sheets = [{"columns": [new_column(), new_column()]}]
    sheet_index = 0
    column_index = 0

    def advance() -> None:
        nonlocal sheet_index, column_index
        if column_index == 0:
            column_index = 1
            return
        sheets.append({"columns": [new_column(), new_column()]})
        sheet_index += 1
        column_index = 0

    for card in cards:
        metrics = calculate_metrics(card["segments"], column_width)
        placed = False
        while not placed:
            column = sheets[sheet_index]["columns"][column_index]
            gap_before = card_gap if column["items"] else 0
            full_height = estimate_height(metrics, 1.0)
            remaining = column_height - column["used_height"] - gap_before

            if column["used_slots"] + card["slot_cost"] <= max_per_column and full_height <= remaining:
                column["items"].append({"card": card, "fit_scale": 1.0})
                column["used_height"] += gap_before + full_height
                column["used_slots"] += card["slot_cost"]
                placed = True
                continue

            if not column["items"] and remaining > metrics[1] + 18:
                fit_scale = min(1.0, max(MIN_FIT_SCALE, (remaining - metrics[1]) / metrics[0]))
                adjusted = estimate_height(metrics, fit_scale)
                if adjusted <= remaining + 0.4:
                    column["items"].append({"card": card, "fit_scale": fit_scale})
                    column["used_height"] += adjusted
                    column["used_slots"] += card["slot_cost"]
                    placed = True
                    continue

            advance()

    return sheets, column_height


def render_segments(doc: fitz.Document, entries: list[dict], images_dir: Path, scale: float) -> None:
    for entry_index, entry in enumerate(entries, start=1):
        rendered = []
        for segment_index, segment in enumerate(entry["segments"], start=1):
            page = doc.load_page(segment["page_index"])
            clip = fitz.Rect(segment["x0"], segment["y0"], segment["x1"], segment["y1"])
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False)
            prefix = f"problem_{entry['number']:03d}" if entry["kind"] == "problem" else f"shared_{entry['group_label'].replace('-', '_')}"
            filename = f"{prefix}_{entry_index:03d}_seg_{segment_index:02d}.png"
            destination = images_dir / filename
            pix.save(destination)
            rendered.append(
                {
                    "path": f"images/{filename}",
                    "width": pix.width,
                    "height": pix.height,
                }
            )
            pix = None
            page = None
        entry["segment_images"] = rendered


def reset_output_dir(output_root: Path, output_dir: Path) -> None:
    resolved_root = output_root.resolve()
    resolved_output = output_dir.resolve()
    if resolved_output == resolved_root or resolved_root not in resolved_output.parents:
        raise RuntimeError(f"Unsafe output path: {resolved_output}")
    if resolved_output.exists():
        shutil.rmtree(resolved_output)
    resolved_output.mkdir(parents=True, exist_ok=True)


def copy_font_assets(output_dir: Path) -> None:
    return None


if __name__ == "__main__":
    main()
