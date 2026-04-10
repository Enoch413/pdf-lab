# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
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
TEXT_LINE_TOLERANCE = 2.3
QUESTION_MARKER_PATTERN = re.compile(r"\d+\.")
RANGE_MARKER_PATTERN = re.compile(r"\[(\d+)-(\d+)\]")
QUESTION_PREFIX_PATTERN = re.compile(r"^\d+\.\s*")
SHARED_PREFIX_PATTERN = re.compile(r"^\[(\d+)-(\d+)\]\s*")
OPTION_LINE_PATTERN = re.compile(r"^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]")
PASSAGE_MARKER_LINE_PATTERN = re.compile(r"^\([A-Z]\)$")
ANSWER_PAGE_PATTERN = re.compile(r"정답지")
QUESTION_INDEX_TAG_PATTERN = re.compile(r"\[(?:\d+(?:[-~]\d+)*)\]$")
WORKSHEET_REF_PATTERN = re.compile(r"\[(?=[^\]]*\d)[^\]]+\]")
MIN_PASSAGE_SIGNATURE_LENGTH = 90

PROBLEM_TYPE_OTHER = "기타"
PROBLEM_TYPE_TAIL = "꼬리문제"
PROBLEM_TYPE_SUBJECTIVE = "주관식"
PROBLEM_TYPE_GRAMMAR = "어법"
PROBLEM_TYPE_VOCAB = "어휘"
PROBLEM_TYPE_ODD_SENTENCE = "무관문"
SUBJECTIVE_TYPE_WRITING = "영작"
SUBJECTIVE_TYPE_SUMMARY = "요약(주관식)"
SUBJECTIVE_TYPE_GRAMMAR = "어법(주관식)"
SUBJECTIVE_TYPE_BLANK = "빈칸(주관식)"
SUBJECTIVE_TYPE_CONNECTION = "연결사(주관식)"
SUBJECTIVE_TYPE_ARRANGEMENT = "배열"
SUBJECTIVE_TYPE_OTHER = "기타주관식"
PROBLEM_TYPE_RULES = [
    ("연결사", [
        "다음 글의 빈칸 (A), (B)에",
        "다음 글의 빈칸(A), (B)에",
        "다음 글의 빈칸 (A),(B)에",
        "다음 글의 빈칸(A),(B)에",
        "윗글의 빈칸 (B)에 들어갈",
        "윗글의 빈칸(B)에 들어갈",
        "(A), 다음 빈칸에 들어갈",
        "(A) 다음 빈칸에 들어갈",
    ]),
    ("선택어법", ["어법에 맞는 표현으로"]),
    ("선택어휘", ["문맥에 맞는 낱말로", "문맥에 맡는 낱말로"]),
    ("밑줄어법", ["어법상", "문법적 쓰임"]),
    ("밑줄어휘", ["문맥상 낱말", "밑줄 친 부분 중 흐름상 어색한 것은", "밑줄 친 부분 중 문맥상 어색한 것은", "밑줄 친 부분 중 어색한 것은"]),
    ("순서", [
        "이어질 글의 순서",
        "주어진 글 다음에 이어질 글의 순서",
        "글의 순서로 가장 적절한 것은",
        "이어질 순서로 가장 적절한 것은",
        "이어진 순서로 가장 적절한 것은",
    ]),
    ("삽입", [
        "주어진 문장이 들어가기에",
        "다음 문장이 들어갈 위치로",
        "문장이 들어갈 위치로 가장 적절한 곳은",
        "들어갈 위치로 가장 적절한 곳은",
    ]),
    ("무관", [
        "전체 흐름과",
        "글의 흐름으로 보아, 문맥상 적절하지 않은 것은",
        "글의 흐름으로 보아 문맥상 적절하지 않은 것은",
        "문맥상 적절하지 않은 것은",
        "글의 흐름으로 보아, 문맥상 적절하지 않은 문장은",
        "글의 흐름으로 보아 문맥상 적절하지 않은 문장은",
        "문맥상 적절하지 않은 문장은",
        "문맥상 적절하지 않은 문장",
    ]),
    ("요약", ["한 문장으로 요약"]),
    ("빈칸", ["빈칸에 들어갈"]),
    ("내용일치", ["내용과 일치", "내용과 일치하지 않는", "내용으로 일치하지 않는", "내용으로 일치하는", "대답할 수 없는 질문", "답할 수 없는 질문"]),
    ("함축의미", ["의미하는", "함축적 의미"]),
    ("지칭", ["밑줄 친 부분이 가리키는 대상이", "가리키는 대상이", "지칭하는 대상이"]),
    ("심경", ["심경", "어조로 가장 적절한", "필자의 어조"]),
    ("주제", ["주제"]),
    ("제목", ["제목"]),
    ("주장", ["주장"]),
    ("요지", ["요지"]),
    ("목적", ["목적"]),
]


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_type_token(value: str) -> str:
    return normalize_text(value).replace(" ", "")


def classify_subjective_type(problem_text: str, base_type: str) -> str:
    searchable_text = normalize_type_token(problem_text)[:2400]
    if not searchable_text:
        return SUBJECTIVE_TYPE_OTHER
    if any(
        normalize_type_token(keyword) in searchable_text
        for keyword in ("영영표현", "영영풀이")
    ):
        return SUBJECTIVE_TYPE_OTHER
    if any(
        normalize_type_token(keyword) in searchable_text
        for keyword in ("영작", "영어로완성", "영어로작성")
    ):
        return SUBJECTIVE_TYPE_WRITING
    if any(
        normalize_type_token(keyword) in searchable_text
        for keyword in ("재배열", "배열하시오", "바르게배열")
    ):
        return SUBJECTIVE_TYPE_ARRANGEMENT
    if base_type == "요약" or normalize_type_token("요약") in searchable_text:
        return SUBJECTIVE_TYPE_SUMMARY
    if base_type == "연결사":
        return SUBJECTIVE_TYPE_CONNECTION
    if base_type == "빈칸":
        return SUBJECTIVE_TYPE_BLANK
    if (
        base_type in {"밑줄어법", "선택어법"}
        or any(
            normalize_type_token(keyword) in searchable_text
            for keyword in ("어법상", "바르게고치시오", "틀린부분을찾아")
        )
    ):
        return SUBJECTIVE_TYPE_GRAMMAR
    return SUBJECTIVE_TYPE_OTHER


def build_type_tags(problem_type: str, is_subjective: bool, subjective_type: str = "") -> list[str]:
    tags: list[str] = []
    if problem_type:
        tags.append(problem_type)
    if problem_type == "무관":
        tags.append(PROBLEM_TYPE_ODD_SENTENCE)
    if problem_type in {"밑줄어법", "선택어법"}:
        tags.append(PROBLEM_TYPE_GRAMMAR)
    if problem_type in {"밑줄어휘", "선택어휘"}:
        tags.append(PROBLEM_TYPE_VOCAB)
    if is_subjective:
        tags.append(PROBLEM_TYPE_SUBJECTIVE)
        if subjective_type:
            tags.append(subjective_type)
    return list(dict.fromkeys(tag for tag in tags if tag))


def normalize_worksheet_ref(value: str) -> str:
    trimmed = str(value or "").strip()
    if trimmed.startswith("[") and trimmed.endswith("]"):
        trimmed = trimmed[1:-1]
    trimmed = normalize_text(trimmed)
    trimmed = re.sub(r"\s*[-~]\s*", "-", trimmed)
    return trimmed.lower()


def extract_worksheet_ref(text: str) -> str:
    match = WORKSHEET_REF_PATTERN.search(str(text or "")[:260])
    if not match:
        return ""
    return normalize_worksheet_ref(match.group(0))


def normalize_worksheet_family(file_name: str) -> str:
    stem = Path(file_name).stem
    parts = stem.split("_")
    family = "_".join(parts[1:]) if len(parts) > 1 else stem
    for suffix in ("어법어휘", "주관식", "서술형"):
        if family.endswith(f"_{suffix}"):
            family = family[: -(len(suffix) + 1)]
            break
    return normalize_text(family)


PROBLEM_TYPE_MATCHERS = [
    (problem_type, [normalize_type_token(phrase) for phrase in phrases])
    for problem_type, phrases in PROBLEM_TYPE_RULES
]


@dataclass
class Word:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    cx: float
    height: float


def count_matches(value: str, pattern: str) -> int:
    return len(re.findall(pattern, value))


def character_profile(value: str) -> tuple[int, int, int]:
    return (
        count_matches(value, r"[A-Za-z]"),
        count_matches(value, r"[가-힣]"),
        count_matches(value, r"\d"),
    )


def sort_words_by_reading_order(words: list[Word]) -> list[Word]:
    return sorted(words, key=lambda word: (round(word.y0 / 1.6), word.y0, word.x0))


def collect_markers(column_words: list[Word]) -> list[dict]:
    candidates = [word for word in column_words if QUESTION_MARKER_PATTERN.fullmatch(word.text)]
    if not candidates:
        return []
    max_height = max(word.height for word in candidates)
    min_height = max_height - MARKER_HEIGHT_SLACK
    markers = []
    for word in candidates:
        if word.height + 1e-6 < min_height:
            continue
        line_words = [other for other in column_words if abs(other.y0 - word.y0) <= MARKER_LINE_TOLERANCE]
        line_left_x = min(other.x0 for other in line_words)
        if word.x0 - line_left_x > MARKER_LINE_START_TOLERANCE:
            continue
        markers.append({"number": int(word.text[:-1]), "item": word})
    return sorted(markers, key=lambda marker: marker["item"].y0)


def collect_range_markers(column_words: list[Word]) -> list[dict]:
    markers = []
    for word in column_words:
        match = RANGE_MARKER_PATTERN.fullmatch(word.text)
        if not match:
            continue
        start_number = int(match.group(1))
        end_number = int(match.group(2))
        if end_number <= start_number:
            continue
        markers.append(
            {
                "label": word.text,
                "start_number": start_number,
                "end_number": end_number,
                "item": word,
            }
        )
    return sorted(markers, key=lambda marker: marker["item"].y0)


def build_empty_column(page_index: int, column_index: int, col_start: float, col_end: float, page_height: float) -> dict:
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


def analyze_page(page_index: int, page: fitz.Page) -> dict:
    rect = page.rect
    midpoint = rect.width / COLUMN_COUNT
    if ANSWER_PAGE_PATTERN.search(page.get_text("text")):
        return {
            "page_index": page_index,
            "is_answer_page": True,
            "columns": [
                build_empty_column(page_index, column_index, midpoint * column_index, midpoint * (column_index + 1), rect.height)
                for column_index in range(COLUMN_COUNT)
            ],
        }

    words: list[Word] = []
    for entry in page.get_text("words"):
        x0, y0, x1, y1, text, *_ = entry
        text = text.strip()
        if not text:
            continue
        if y0 <= HEADER_CUTOFF or y1 >= rect.height - FOOTER_CUTOFF:
            continue
        words.append(Word(text=text, x0=x0, y0=y0, x1=x1, y1=y1, cx=(x0 + x1) / 2, height=y1 - y0))

    columns = []
    for column_index in range(COLUMN_COUNT):
        col_start = midpoint * column_index
        col_end = midpoint * (column_index + 1)
        column_words = [word for word in words if col_start <= word.cx < col_end]
        if not column_words:
            columns.append(build_empty_column(page_index, column_index, col_start, col_end, rect.height))
            continue
        columns.append(
            {
                "key": f"{page_index}-{column_index}",
                "page_index": page_index,
                "column_index": column_index,
                "items": column_words,
                "x0": max(0, min(word.x0 for word in column_words) - 10),
                "x1": min(rect.width, max(word.x1 for word in column_words) + 10),
                "top_y": max(HEADER_CUTOFF, min(word.y0 for word in column_words) - 6),
                "bottom_y": min(rect.height - FOOTER_CUTOFF, max(word.y1 for word in column_words) + 6),
                "markers": collect_markers(column_words),
                "range_markers": collect_range_markers(column_words),
            }
        )
    return {"page_index": page_index, "is_answer_page": False, "columns": columns}


def event_position(event: dict) -> tuple[int, float]:
    return event["order_index"], event["item"].y0


def collect_segments(ordered_columns: list[dict], start_event: dict, end_event: dict | None) -> list[dict]:
    end_order_index = end_event["order_index"] if end_event else len(ordered_columns) - 1
    top_pad = SHARED_MARKER_TOP_PAD if start_event["type"] == "shared" else FIRST_SEGMENT_TOP_PAD
    segments = []
    for order_index in range(start_event["order_index"], end_order_index + 1):
        column = ordered_columns[order_index]
        y0 = column["top_y"]
        y1 = column["bottom_y"]
        if order_index == start_event["order_index"]:
            y0 = max(column["top_y"], start_event["item"].y0 - top_pad)
        if end_event and order_index == end_event["order_index"]:
            y1 = min(column["bottom_y"], end_event["item"].y0 - NEXT_START_GAP)
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


def collect_segment_lines(column_lookup: dict, segment: dict) -> list[str]:
    column = column_lookup[f"{segment['page_index']}-{segment['column_index']}"]
    words = sort_words_by_reading_order(
        [
            word
            for word in column["items"]
            if word.y1 > segment["y0"] - 0.8 and word.y0 < segment["y1"] + 0.8
        ]
    )
    lines: list[dict] = []
    for word in words:
        if not lines or abs(lines[-1]["y0"] - word.y0) > TEXT_LINE_TOLERANCE:
            lines.append({"y0": word.y0, "words": [word]})
            continue
        lines[-1]["words"].append(word)
    normalized_lines = []
    for line in lines:
        line_text = normalize_text(" ".join(word.text for word in sorted(line["words"], key=lambda item: item.x0)))
        if line_text:
            normalized_lines.append(line_text)
    return normalized_lines


def collect_problem_lines(column_lookup: dict, segments: list[dict], max_lines: int = 90) -> list[str]:
    lines: list[str] = []
    for segment in segments:
        lines.extend(collect_segment_lines(column_lookup, segment))
        if len(lines) >= max_lines:
            break
    return lines[:max_lines]


def classify_problem_type(problem_text: str) -> str:
    searchable_text = normalize_type_token(problem_text)[:1800]
    if not searchable_text:
        return PROBLEM_TYPE_OTHER
    if any(
        normalize_type_token(keyword) in searchable_text
        for keyword in ("영영표현", "영영풀이")
    ):
        return PROBLEM_TYPE_OTHER
    if normalize_type_token("한 문장으로 요약") in searchable_text:
        return "요약"
    if any(
        normalize_type_token(phrase) in searchable_text
        for phrase in ("한 문장으로 정리", "요약할 때", "요약할때")
    ):
        return "요약"
    if any(
        normalize_type_token(phrase) in searchable_text
        for phrase in ("요약문", "요약한 문장", "요약하고자 한다", "요약한 것이다", "요약문을 읽고")
    ):
        return "요약"
    if normalize_type_token("주제문") in searchable_text:
        return "주제"
    if "빈칸" in searchable_text and "(A)" in searchable_text and "(B)" in searchable_text:
        return "연결사"
    for problem_type, matchers in PROBLEM_TYPE_MATCHERS:
        if any(matcher in searchable_text for matcher in matchers):
            return problem_type
    return PROBLEM_TYPE_OTHER


def has_objective_options(lines: list[str], problem_text: str) -> bool:
    if any(is_option_line(line) for line in lines):
        return True
    normalized = normalize_text(problem_text)
    return count_matches(normalized, r"[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]") >= 2


def is_subjective_problem(lines: list[str], prompt_text: str, problem_text: str) -> bool:
    searchable_text = normalize_type_token(f"{prompt_text} {problem_text}")[:2400]
    if any(
        normalize_type_token(keyword) in searchable_text
        for keyword in ("주관식", "서술형", "영작")
    ):
        return True
    return not has_objective_options(lines, problem_text or prompt_text)


def is_option_line(text: str) -> bool:
    normalized = normalize_text(text)
    if not normalized:
        return False
    if OPTION_LINE_PATTERN.match(normalized):
        return True
    return count_matches(normalized, r"[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]") >= 2


def is_question_header_line(text: str) -> bool:
    normalized = normalize_text(text)
    if not normalized:
        return False
    if QUESTION_PREFIX_PATTERN.match(normalized) or SHARED_PREFIX_PATTERN.match(normalized):
        return True
    latin, hangul, _ = character_profile(normalized)
    return hangul > latin * 1.5 and len(normalized) <= 160


def is_passage_continuation_line(text: str, has_started_passage: bool) -> bool:
    normalized = normalize_text(text)
    if not normalized or is_option_line(normalized):
        return False
    if PASSAGE_MARKER_LINE_PATTERN.match(normalized):
        return True
    latin, hangul, _ = character_profile(normalized)
    if latin >= 8 and latin >= hangul:
        return True
    if not has_started_passage:
        return False
    if latin >= 3:
        return True
    return len(normalized) <= 12 and bool(re.fullmatch(r"[\s\"'“”‘’()[\].,;:!?-]+", normalized))


def normalize_prompt_text(text: str) -> str:
    trimmed = normalize_text(text)
    trimmed = QUESTION_PREFIX_PATTERN.sub("", trimmed)
    trimmed = SHARED_PREFIX_PATTERN.sub("", trimmed)
    trimmed = re.sub(r"\s+\[(?:\d+(?:[-~]\d+)*)\]\s*$", "", trimmed)
    return normalize_text(trimmed)


def trim_question_lead(text: str) -> str:
    trimmed = normalize_prompt_text(text)
    question_mark_index = trimmed.find("?")
    if 0 <= question_mark_index < 260:
        trimmed = trimmed[question_mark_index + 1 :]
    return normalize_text(trimmed)


def extract_prompt_and_passage(lines: list[str]) -> tuple[str, str]:
    if not lines:
        return "", ""

    prompt_lines: list[str] = []
    passage_lines: list[str] = []
    started_passage = False

    for line in lines:
        normalized = normalize_text(line)
        if not normalized:
            continue
        if is_option_line(normalized):
            break
        if not started_passage:
            if is_passage_continuation_line(normalized, False):
                started_passage = True
                passage_lines.append(normalized)
                continue
            prompt_lines.append(normalized)
            continue
        if is_passage_continuation_line(normalized, True):
            passage_lines.append(normalized)
            continue
        latin, hangul, _ = character_profile(normalized)
        if passage_lines and hangul > latin * 2:
            break

    prompt_text = normalize_prompt_text(" ".join(prompt_lines))
    passage_text = normalize_text(" ".join(passage_lines))
    if len(passage_text) < 80:
        fallback = trim_question_lead(" ".join(lines)).split("①")[0].strip()
        passage_text = normalize_text(fallback[:1200])
    return prompt_text, passage_text


def build_passage_signature(text: str) -> str:
    return normalize_type_token(
        re.sub(r"[^\w가-힣\s]+", " ", re.sub(r"\d", " ", str(text or "").lower()))
    )


def common_prefix_length(left: str, right: str) -> int:
    limit = min(len(left), len(right))
    index = 0
    while index < limit and left[index] == right[index]:
        index += 1
    return index


def same_passage_signature(left: str, right: str) -> bool:
    if not left or not right:
        return False
    shorter_length = min(len(left), len(right))
    if shorter_length < MIN_PASSAGE_SIGNATURE_LENGTH:
        return left == right
    prefix_length = common_prefix_length(left, right)
    if prefix_length >= 180:
        return True
    return prefix_length >= 120 and prefix_length >= shorter_length * 0.72


def build_problem_entries(pdf_path: Path) -> list[dict]:
    document = fitz.open(pdf_path)
    worksheet_family = normalize_worksheet_family(pdf_path.name)
    page_infos = [analyze_page(page_index, document[page_index]) for page_index in range(document.page_count)]
    ordered_columns = [column for page in page_infos if not page["is_answer_page"] for column in page["columns"] if column["items"]]
    column_lookup = {column["key"]: {**column, "order_index": index} for index, column in enumerate(ordered_columns)}

    question_events = []
    shared_events = []
    for column in ordered_columns:
        order_index = column_lookup[column["key"]]["order_index"]
        for marker in column["markers"]:
            question_events.append(
                {
                    "type": "problem",
                    "number": marker["number"],
                    "item": marker["item"],
                    "order_index": order_index,
                }
            )
        for marker in column["range_markers"]:
            shared_events.append(
                {
                    "type": "shared",
                    "group_label": f"{marker['start_number']}-{marker['end_number']}",
                    "start_number": marker["start_number"],
                    "end_number": marker["end_number"],
                    "item": marker["item"],
                    "order_index": order_index,
                }
            )

    question_events.sort(key=event_position)
    valid_shared_events = []
    for shared_event in shared_events:
        target_question = next(
            (
                question_event
                for question_event in question_events
                if question_event["number"] == shared_event["start_number"]
                and event_position(question_event) > event_position(shared_event)
            ),
            None,
        )
        if target_question:
            valid_shared_events.append({**shared_event, "target_question": target_question})

    grouped_labels: dict[int, str] = {}
    for shared_event in valid_shared_events:
        for number in range(shared_event["start_number"], shared_event["end_number"] + 1):
            grouped_labels[number] = shared_event["group_label"]

    ordered_events = sorted(question_events + valid_shared_events, key=event_position)
    entries = []
    for index, event in enumerate(ordered_events):
        if event["type"] == "shared":
            continue
        next_event = ordered_events[index + 1] if index + 1 < len(ordered_events) else None
        segments = collect_segments(ordered_columns, event, next_event)
        if not segments:
            continue
        lines = collect_problem_lines(column_lookup, segments)
        full_text = normalize_text(" ".join(lines))
        prompt_text, passage_text = extract_prompt_and_passage(lines)
        worksheet_ref = extract_worksheet_ref(full_text)
        is_subjective = is_subjective_problem(lines, prompt_text or full_text, full_text)
        problem_type = PROBLEM_TYPE_TAIL if grouped_labels.get(event["number"], "") else classify_problem_type(prompt_text or full_text)
        subjective_type = classify_subjective_type(full_text, problem_type) if is_subjective and problem_type != PROBLEM_TYPE_TAIL else ""
        entries.append(
            {
                "file_name": pdf_path.name,
                "worksheet_family": worksheet_family,
                "worksheet_ref": worksheet_ref,
                "problem_number": event["number"],
                "group_label": grouped_labels.get(event["number"], ""),
                "prompt_text": prompt_text,
                "analysis_text": full_text,
                "problem_type": problem_type,
                "is_subjective": is_subjective,
                "subjective_type": subjective_type,
                "type_tags": build_type_tags(problem_type, is_subjective, subjective_type),
                "passage_text": passage_text,
                "passage_signature": build_passage_signature(passage_text),
            }
        )
    return entries


def group_passages(entries: list[dict]) -> list[dict]:
    groups: list[dict] = []
    ref_index: dict[str, dict] = {}
    for entry in entries:
        signature = entry["passage_signature"]
        worksheet_family = entry.get("worksheet_family", "")
        worksheet_ref = entry.get("worksheet_ref", "")
        ref_key = f"{worksheet_family}::{worksheet_ref}" if worksheet_family and worksheet_ref else ""

        group = ref_index.get(ref_key) if ref_key else None
        if not group:
            group = next(
                (
                    candidate
                    for candidate in groups
                    if not candidate.get("source_ref_key") and same_passage_signature(candidate["signature"], signature)
                ),
                None,
            )
        if not group:
            group = {
                "id": f"passage-{len(groups) + 1}",
                "signature": signature,
                "excerpt": entry["passage_text"][:260],
                "worksheet_family": worksheet_family,
                "worksheet_ref": worksheet_ref,
                "source_ref_key": ref_key,
                "group_source": "tag" if ref_key else "similarity",
                "entries": [],
            }
            groups.append(group)
            if ref_key:
                ref_index[ref_key] = group
        elif ref_key and not group.get("source_ref_key"):
            group["worksheet_family"] = worksheet_family
            group["worksheet_ref"] = worksheet_ref
            group["source_ref_key"] = ref_key
            group["group_source"] = "tag"
            ref_index[ref_key] = group
        group["entries"].append(entry)
        if len(entry["passage_text"]) > len(group["excerpt"]):
            group["excerpt"] = entry["passage_text"][:260]
        entry["passage_group_id"] = group["id"]
    return groups


def build_report(folder: Path, entries: list[dict], passage_groups: list[dict]) -> str:
    subjective_count = sum(1 for entry in entries if entry.get("is_subjective"))
    lines = [
        f"# 2강서A 문제 코퍼스 분석",
        "",
        f"- 폴더: `{folder}`",
        f"- PDF 수: `{len(sorted([path for path in folder.glob('*.pdf') if '답지' not in path.name]))}`",
        f"- 문항 수: `{len(entries)}`",
        f"- 주관식 문항 수: `{subjective_count}`",
        f"- 객관식 문항 수: `{len(entries) - subjective_count}`",
        f"- 반복 지문 그룹 수: `{len([group for group in passage_groups if len(group['entries']) >= 2])}`",
        "",
        "## 유형 분포",
        "",
    ]

    type_counter = Counter(entry["problem_type"] for entry in entries)
    for problem_type, count in sorted(type_counter.items(), key=lambda item: (-item[1], item[0])):
        lines.append(f"- {problem_type}: {count}")

    lines.extend(["", "## 파일별 유형 분포", ""])
    entries_by_file: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        entries_by_file[entry["file_name"]].append(entry)
    for file_name in sorted(entries_by_file):
        counter = Counter(entry["problem_type"] for entry in entries_by_file[file_name])
        summary = ", ".join(f"{problem_type} {count}" for problem_type, count in sorted(counter.items(), key=lambda item: (-item[1], item[0])))
        lines.append(f"- {file_name}: {summary}")

    lines.extend(["", "## 유형별 대표 문구", ""])
    prompts_by_type: dict[str, list[str]] = defaultdict(list)
    for entry in entries:
        if entry["prompt_text"]:
            prompts_by_type[entry["problem_type"]].append(entry["prompt_text"])
    for problem_type in sorted(prompts_by_type):
        lines.append(f"### {problem_type}")
        seen = set()
        added = 0
        for prompt in prompts_by_type[problem_type]:
            normalized = normalize_text(prompt)
            if normalized in seen:
                continue
            seen.add(normalized)
            lines.append(f"- {normalized[:180]}")
            added += 1
            if added >= 5:
                break
        lines.append("")

    other_entries = [entry for entry in entries if entry["problem_type"] == PROBLEM_TYPE_OTHER]
    if other_entries:
        lines.extend(["## 기타로 남은 문항", ""])
        for entry in other_entries[:30]:
            lines.append(f"- {entry['file_name']} #{entry['problem_number']}: {entry['prompt_text'][:200] or entry['analysis_text'][:200]}")
        lines.append("")

    repeated_groups = [group for group in passage_groups if len(group["entries"]) >= 2]
    repeated_groups.sort(key=lambda group: (-len(group["entries"]), group["id"]))
    lines.extend(["## 반복 지문 상위 그룹", ""])
    for group in repeated_groups[:20]:
        type_summary = Counter(entry["problem_type"] for entry in group["entries"])
        files = sorted({entry["file_name"] for entry in group["entries"]})
        problems = ", ".join(f"{entry['file_name']} #{entry['problem_number']}" for entry in group["entries"][:8])
        lines.append(f"### {group['id']} ({len(group['entries'])}문항)")
        lines.append(f"- 유형: {', '.join(f'{problem_type} {count}' for problem_type, count in sorted(type_summary.items(), key=lambda item: (-item[1], item[0])))}")
        lines.append(f"- 파일: {', '.join(files)}")
        lines.append(f"- 예시 문항: {problems}")
        lines.append(f"- 지문 앞부분: {normalize_text(group['excerpt'])[:220]}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze a worksheet PDF corpus for type phrases and repeated passages.")
    parser.add_argument("folder", type=Path, help="Folder containing the source PDFs.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "artifacts" / "corpus_analysis",
        help="Directory for the generated report files.",
    )
    args = parser.parse_args()

    pdf_paths = sorted(path for path in args.folder.glob("*.pdf") if "답지" not in path.name)
    if not pdf_paths:
        raise SystemExit(f"No source PDFs found in {args.folder}")

    entries: list[dict] = []
    for pdf_path in pdf_paths:
        entries.extend(build_problem_entries(pdf_path))

    passage_groups = group_passages(entries)
    report_text = build_report(args.folder, entries, passage_groups)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    slug = normalize_text(args.folder.name).replace(" ", "-")
    json_path = args.output_dir / f"{slug}-analysis.json"
    md_path = args.output_dir / f"{slug}-analysis.md"
    json_path.write_text(
        json.dumps(
            {
                "folder": str(args.folder),
                "pdf_count": len(pdf_paths),
                "problem_count": len(entries),
                "entries": entries,
                "passage_groups": passage_groups,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    md_path.write_text(report_text, encoding="utf-8")

    print(f"Saved report: {md_path}")
    print(f"Saved data: {json_path}")
    print(f"Problems: {len(entries)}")
    print(f"Repeated passage groups: {len([group for group in passage_groups if len(group['entries']) >= 2])}")


if __name__ == "__main__":
    main()
