from __future__ import annotations

import json
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

import fitz

from build_selected_exam_pdf import (
    CARD_GAP_MM,
    COLUMN_GAP_MM,
    MAX_PER_COLUMN,
    PAGE_PADDING_MM,
    PROJECT_ROOT,
    SOURCE_ROOT,
    build_exam_html,
    build_source_maps,
    build_layout,
    choose_render_scale,
    clone_entry,
    edge_executable,
    render_selected_segments,
    reset_output_dir,
)
from generate_repacked_html import analyze_page, build_entries


OUTPUT_ROOT = PROJECT_ROOT / "artifacts" / "exam_selection"
OUTPUT_DIR = OUTPUT_ROOT / "2gangseoA_second_exam"
HTML_NAME = "index.html"
PDF_NAME = "\u0032\uac15\uc11cA_\u0032\ucc28_\ubb38\uc81c\uc9c0.pdf"
SELECTION_JSON_NAME = "2gangseoA_second_exam_selection.json"
SELECTION_MD_NAME = "2gangseoA_second_exam_selection.md"

CORPUS_NAME = "\u0032\uac15\uc11cA \ubb38\uc81c"
TITLE = "\u0032\uac15\uc11cA \u0032\ucc28 \ubb38\uc81c\uc9c0"
SUBTITLE = "\u0032\u0034\uc9c0\ubb38 \u0031\ud68c\uc529 \uc0ac\uc6a9 \u00b7 H2-2603 \ud3ec\ud568 \u00b7 \uaf2c\ub9ac\ubb38\uc81c \uc81c\uc678"
SOURCE_LABEL = "\u0032\uac15\uc11cA \u0032\ucc28 \uc120\uc815\ubcf8"

K_DETAIL = "\ub0b4\uc6a9\uc77c\uce58"
K_ODD = "\ubb34\uad00"
K_GRAMMAR_UNDERLINE = "\ubc11\uc904\uc5b4\ubc95"
K_VOCAB_UNDERLINE = "\ubc11\uc904\uc5b4\ud718"
K_BLANK = "\ube48\uce78"
K_INSERT = "\uc0bd\uc785"
K_GRAMMAR_CHOICE = "\uc120\ud0dd\uc5b4\ubc95"
K_VOCAB_CHOICE = "\uc120\ud0dd\uc5b4\ud718"
K_ORDER = "\uc21c\uc11c"
K_CONNECTION = "\uc5f0\uacb0\uc0ac"
K_SUMMARY = "\uc694\uc57d"
K_GIST = "\uc694\uc9c0"
K_TITLE = "\uc81c\ubaa9"
K_SUBJECT = "\uc8fc\uc81c"
K_TAIL = "\uaf2c\ub9ac\ubb38\uc81c"
K_SUBJECTIVE = "\uc8fc\uad00\uc2dd"
K_WRITING = "\uc601\uc791"

TOKEN_TO_LABEL = {
    "SUBJECT": K_SUBJECT,
    "GIST": K_GIST,
    "TITLE": K_TITLE,
    "BLANK": K_BLANK,
    "ORDER": K_ORDER,
    "INSERT": K_INSERT,
    "ODD": "\ubb34\uad00\ubb38",
    "GRAMMAR": "\uc5b4\ubc95",
    "VOCAB": "\uc5b4\ud718",
    "DETAIL": K_DETAIL,
    "WRITING": "\uc601\uc791(\uc8fc\uad00\uc2dd)",
    "SUMMARY": "\uc694\uc57d(\uc8fc\uad00\uc2dd)",
}

OBJECTIVE_TOKEN_MAP = {
    K_SUBJECT: "SUBJECT",
    K_GIST: "GIST",
    K_TITLE: "TITLE",
    K_BLANK: "BLANK",
    K_ORDER: "ORDER",
    K_INSERT: "INSERT",
    K_ODD: "ODD",
    K_GRAMMAR_UNDERLINE: "GRAMMAR",
    K_GRAMMAR_CHOICE: "GRAMMAR",
    K_VOCAB_UNDERLINE: "VOCAB",
    K_VOCAB_CHOICE: "VOCAB",
    K_DETAIL: "DETAIL",
}

OBJECTIVE_TARGET = Counter(
    {
        "SUBJECT": 1,
        "GIST": 1,
        "TITLE": 1,
        "BLANK": 5,
        "ORDER": 3,
        "INSERT": 2,
        "ODD": 2,
        "GRAMMAR": 3,
        "VOCAB": 3,
        "DETAIL": 1,
    }
)
FULL_TARGET = OBJECTIVE_TARGET + Counter({"WRITING": 1, "SUMMARY": 1})

FIRST_EXAM_BANS = {
    "passage-5": {"VOCAB"},
    "passage-6": {"GRAMMAR"},
    "passage-7": {"DETAIL", "BLANK"},
    "passage-8": {"GRAMMAR"},
    "passage-9": {"BLANK", "TITLE"},
    "passage-10": {"GIST", "BLANK"},
    "passage-11": {"DETAIL", "SUBJECT"},
    "passage-12": {"ORDER"},
    "passage-13": {"WRITING"},
    "passage-14": {"INSERT"},
    "passage-15": {"DETAIL"},
    "passage-16": {"ODD"},
    "passage-17": {"TITLE"},
    "passage-18": {"GIST"},
    "passage-19": {"ORDER"},
    "passage-20": {"CONN"},
    "passage-21": {"SUMMARY"},
    "passage-22": {"SUMMARY"},
    "passage-23": {"GRAMMAR"},
    "passage-24": {"SUBJECT"},
}

FAMILY_ORDER = {
    "\uad50\uacfc\uc11c \u0031\uacfc": 0,
    "Q\ubbf8\ub2c8S \u0031\uac15": 1,
    "Q\ubbf8\ub2c8S \u0032\uac15": 2,
    "H2-2603": 3,
}


def load_analysis() -> dict:
    analysis_dir = PROJECT_ROOT / "artifacts" / "corpus_analysis"
    candidates = sorted(analysis_dir.glob("*analysis.json"))
    for candidate in candidates:
        if "2" in candidate.name and "A" in candidate.name:
            return json.loads(candidate.read_text(encoding="utf-8"))
    raise FileNotFoundError("Could not find 2gangseoA corpus analysis JSON.")


def normalize_token(entry: dict) -> str | None:
    problem_type = entry["problem_type"]
    prompt_text = entry.get("prompt_text", "") or ""
    if not entry["is_subjective"]:
        return OBJECTIVE_TOKEN_MAP.get(problem_type)
    if K_WRITING in prompt_text:
        return "WRITING"
    if problem_type == K_SUMMARY or K_SUMMARY in prompt_text:
        return "SUMMARY"
    return None


def build_passage_options(analysis: dict) -> dict[str, dict[str, list[dict]]]:
    options: dict[str, dict[str, list[dict]]] = {}
    for group in analysis["passage_groups"]:
        group_options: defaultdict[str, list[dict]] = defaultdict(list)
        banned = FIRST_EXAM_BANS.get(group["id"], set())
        for entry in group["entries"]:
            token = normalize_token(entry)
            if token is None:
                continue
            if token in banned:
                continue
            if not entry["is_subjective"] and token not in OBJECTIVE_TARGET:
                continue
            if entry["problem_type"] == K_TAIL:
                continue
            group_options[token].append(entry)
        options[group["id"]] = {
            token: sorted(entries, key=lambda item: (item["file_name"], item["problem_number"]))
            for token, entries in group_options.items()
        }
    return options


def feasible(counts: Counter, passage_order: list[str], options: dict[str, dict[str, list[dict]]], start_index: int) -> bool:
    remaining = passage_order[start_index:]
    for token, need in counts.items():
        if need <= 0:
            continue
        supply = sum(1 for passage_id in remaining if token in options[passage_id])
        if supply < need:
            return False
    return True


def solve_selection(analysis: dict) -> dict[str, dict]:
    options = build_passage_options(analysis)
    passage_order = sorted(
        (group["id"] for group in analysis["passage_groups"]),
        key=lambda passage_id: (len([token for token in options[passage_id] if token in FULL_TARGET]), int(passage_id.split("-")[1])),
    )

    counts = Counter(FULL_TARGET)
    memo: set[tuple[int, tuple[tuple[str, int], ...]]] = set()
    solution: dict[str, dict] = {}

    def search(index: int) -> bool:
        if index == len(passage_order):
            return all(value == 0 for value in counts.values())

        key = (index, tuple(sorted(counts.items())))
        if key in memo:
            return False

        passage_id = passage_order[index]
        remaining = passage_order[index:]
        choices: list[tuple[int, int, str, dict]] = []
        for token, entries in options[passage_id].items():
            if counts[token] <= 0:
                continue
            supply = sum(1 for gid in remaining if token in options[gid])
            choices.append((supply - counts[token], entries[0]["problem_number"], token, entries[0]))
        choices.sort()

        for _, _, token, entry in choices:
            counts[token] -= 1
            if feasible(counts, passage_order, options, index + 1):
                solution[passage_id] = {"token": token, "entry": entry}
                if search(index + 1):
                    return True
                solution.pop(passage_id, None)
            counts[token] += 1

        memo.add(key)
        return False

    if not feasible(counts, passage_order, options, 0) or not search(0):
        raise RuntimeError("Could not solve the second exam selection with the requested constraints.")
    return solution


def ref_sort_key(ref: str) -> tuple[int, ...]:
    return tuple(int(part) for part in ref.split("-"))


def passage_sort_key(item: dict) -> tuple[int, tuple[int, ...], int]:
    family = item["worksheet_family"]
    ref = item["worksheet_ref"]
    passage_id = item["passage_group_id"]
    return (FAMILY_ORDER.get(family, 99), ref_sort_key(ref), int(passage_id.split("-")[1]))


def build_selection_records(analysis: dict, solution: dict[str, dict]) -> list[dict]:
    group_map = {group["id"]: group for group in analysis["passage_groups"]}
    records: list[dict] = []
    for passage_id, picked in solution.items():
        group = group_map[passage_id]
        entry = picked["entry"]
        token = picked["token"]
        records.append(
            {
                "passage_group_id": passage_id,
                "worksheet_family": group["worksheet_family"],
                "worksheet_ref": group["worksheet_ref"],
                "group_source": group["group_source"],
                "source_pdf": entry["file_name"],
                "problem_number": entry["problem_number"],
                "problem_type": entry["problem_type"],
                "selected_token": token,
                "selected_label": TOKEN_TO_LABEL[token],
                "is_subjective": entry["is_subjective"],
                "prompt_text": entry.get("prompt_text", ""),
                "banned_from_first_exam": sorted(FIRST_EXAM_BANS.get(passage_id, set())),
            }
        )
    records.sort(key=passage_sort_key)
    return records


def build_selection_payload(records: list[dict]) -> dict:
    subjective = [record for record in records if record["is_subjective"]]
    objective = [record for record in records if not record["is_subjective"]]
    type_distribution = Counter(record["selected_label"] for record in records)
    return {
        "corpus": CORPUS_NAME,
        "scope": "include H2-2603, use all 24 passage groups exactly once, no tail sets",
        "constraints": {
            "exclude_first_exam_problem_reuse": True,
            "exclude_first_exam_type_per_passage": True,
            "include_h2_2603": True,
            "tail_sets_allowed": False,
        },
        "second_exam_selection": {
            "objective": objective,
            "subjective": subjective,
        },
        "type_distribution": dict(type_distribution),
        "third_exam_exclusion": {
            "used_passage_group_ids": [record["passage_group_id"] for record in records],
            "note": "Exclude these 24 passage groups entirely for the next test, or at minimum exclude the selected problem numbers and selected type families.",
        },
    }


def build_selection_markdown(records: list[dict]) -> str:
    objective = [record for record in records if not record["is_subjective"]]
    subjective = [record for record in records if record["is_subjective"]]
    distribution = Counter(record["selected_label"] for record in records)

    lines = [
        "# 2\uac15\uc11cA 2\ucc28 \ubb38\uc81c\uc9c0 \uc120\uc815\ud45c",
        "",
        "- \uad6c\uc131: 24\uc9c0\ubb38 1\ud68c\uc529, H2-2603 \ud3ec\ud568, \uaf2c\ub9ac\ubb38\uc81c \uc81c\uc678",
        "- \uae08\uc9c0: 1\ucc28 \uc0ac\uc6a9 \ubb38\ud56d \uc7ac\uc0ac\uc6a9 \uae08\uc9c0, \uac19\uc740 \uc9c0\ubb38\uc5d0\uc11c 1\ucc28 \uc0ac\uc6a9 \uc720\ud615 \uc7ac\uc0ac\uc6a9 \uae08\uc9c0",
        "",
        "## \uc720\ud615 \ubd84\ud3ec",
        "",
    ]
    for label in [
        TOKEN_TO_LABEL["SUBJECT"],
        TOKEN_TO_LABEL["GIST"],
        TOKEN_TO_LABEL["TITLE"],
        TOKEN_TO_LABEL["BLANK"],
        TOKEN_TO_LABEL["ORDER"],
        TOKEN_TO_LABEL["INSERT"],
        TOKEN_TO_LABEL["ODD"],
        TOKEN_TO_LABEL["GRAMMAR"],
        TOKEN_TO_LABEL["VOCAB"],
        TOKEN_TO_LABEL["DETAIL"],
        TOKEN_TO_LABEL["WRITING"],
        TOKEN_TO_LABEL["SUMMARY"],
    ]:
        lines.append(f"- {label}: {distribution.get(label, 0)}")

    lines.extend(["", "## \uac1d\uad00\uc2dd", ""])
    for record in objective:
        lines.append(
            f"- {record['worksheet_family']} {record['worksheet_ref']} -> {record['selected_label']} "
            f"(source: {record['source_pdf']} #{record['problem_number']})"
        )

    lines.extend(["", "## \uc8fc\uad00\uc2dd", ""])
    for record in subjective:
        lines.append(
            f"- {record['worksheet_family']} {record['worksheet_ref']} -> {record['selected_label']} "
            f"(source: {record['source_pdf']} #{record['problem_number']})"
        )

    lines.extend(["", "## \ub2e4\uc74c \ucc28\uc218 \uc81c\uc678", ""])
    lines.append(
        "- \uc774 \uc120\uc815\ud45c\uc5d0 \ud3ec\ud568\ub41c 24\uac1c \uc9c0\ubb38(passages 1-24)\uc740 \ub2e4\uc74c \ubb38\uc81c\uc9c0\uc5d0\uc11c \uc804\uccb4 \uc81c\uc678 \uad8c\uc7a5"
    )
    return "\n".join(lines) + "\n"


def write_selection_artifacts(records: list[dict]) -> tuple[Path, Path]:
    payload = build_selection_payload(records)
    json_path = OUTPUT_ROOT / SELECTION_JSON_NAME
    md_path = OUTPUT_ROOT / SELECTION_MD_NAME
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(build_selection_markdown(records), encoding="utf-8")
    return json_path, md_path


def build_exam_html_second(source_label: str, title: str, subtitle: str, sheets: list[dict], column_height_mm: float) -> str:
    html_text = build_exam_html(source_label, title, subtitle, sheets, column_height_mm)
    return html_text.replace("2Gangseo A First Exam", "2Gangseo A Second Exam")


def selection_to_entries(records: list[dict]) -> tuple[list[dict], dict[str, Path]]:
    selected_entries: list[dict] = []
    source_paths: dict[str, Path] = {}
    source_maps: dict[str, tuple[dict[int, dict], dict[str, dict]]] = {}

    for source_name in sorted({record["source_pdf"] for record in records}):
        pdf_path = SOURCE_ROOT / source_name
        if not pdf_path.exists():
            raise FileNotFoundError(pdf_path)
        source_paths[source_name] = pdf_path
        source_maps[source_name] = build_source_maps(pdf_path)

    for exam_number, record in enumerate(records, start=1):
        problem_map, _ = source_maps[record["source_pdf"]]
        entry = problem_map.get(record["problem_number"])
        if entry is None:
            raise KeyError(f"Problem {record['problem_number']} not found in {record['source_pdf']}")
        selected_entries.append(
            clone_entry(
                entry,
                source_pdf_name=record["source_pdf"],
                badge_text=f"\ubb38\ud56d {exam_number}",
                image_prefix=f"q{exam_number:02d}",
            )
        )
    return selected_entries, source_paths


def render_second_exam(records: list[dict]) -> tuple[Path, Path]:
    selected_entries, source_paths = selection_to_entries(records)

    reset_output_dir(OUTPUT_ROOT, OUTPUT_DIR)
    images_dir = OUTPUT_DIR / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    entries_by_source: defaultdict[str, list[dict]] = defaultdict(list)
    for entry in selected_entries:
        entries_by_source[entry["source_pdf_name"]].append(entry)

    for source_name, entries in entries_by_source.items():
        doc = fitz.open(source_paths[source_name])
        page_infos = [analyze_page(index, doc.load_page(index)) for index in range(doc.page_count)]
        problems, _ = build_entries(page_infos)
        render_scale = choose_render_scale(doc.page_count, len(problems))
        render_selected_segments(doc, entries, images_dir, render_scale)

    sheets, column_height_mm = build_layout(
        selected_entries,
        max_per_column=MAX_PER_COLUMN,
        page_padding=PAGE_PADDING_MM,
        column_gap=COLUMN_GAP_MM,
        card_gap=CARD_GAP_MM,
    )

    html_text = build_exam_html_second(
        source_label=SOURCE_LABEL,
        title=TITLE,
        subtitle=SUBTITLE,
        sheets=sheets,
        column_height_mm=column_height_mm,
    )
    html_path = OUTPUT_DIR / HTML_NAME
    html_path.write_text(html_text, encoding="utf-8")

    pdf_path = OUTPUT_DIR / PDF_NAME
    browser = edge_executable()
    subprocess.run(
        [
            str(browser),
            "--headless",
            "--disable-gpu",
            f"--print-to-pdf={pdf_path}",
            "--print-to-pdf-no-header",
            "--allow-file-access-from-files",
            html_path.resolve().as_uri(),
        ],
        check=True,
        timeout=120,
    )
    return html_path, pdf_path


def main() -> None:
    analysis = load_analysis()
    solution = solve_selection(analysis)
    records = build_selection_records(analysis, solution)
    json_path, md_path = write_selection_artifacts(records)
    html_path, pdf_path = render_second_exam(records)
    print(f"selection_json: {json_path}")
    print(f"selection_md: {md_path}")
    print(f"html: {html_path}")
    print(f"pdf: {pdf_path}")


if __name__ == "__main__":
    main()
