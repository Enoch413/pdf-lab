"""Check actual PDF text, separately from DOM assertions and visual review."""
import hashlib
import json
from pathlib import Path
import re
import sys
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
before = '--before' in sys.argv
directory = root / ('output/hanbujang-compat-review-20260928/evidence' if before else 'tmp/hanbujang-verification')
cases = []
for name in ('index', 'final_test', 'general_exam'):
    file = directory / f'{name}-canonical.pdf'
    reader = PdfReader(file)
    # Restrict to the question pages: answer/explanation text is tested separately.
    pages = [(i + 1, p.extract_text()) for i, p in enumerate(reader.pages)]
    matches = [(i, text) for i, text in pages if 'The street was quiet.' in text]
    assert len(matches) == 1, (name, matches)
    page, text = matches[0]
    body = re.search(r'The street was quiet\.[\s\S]*?People gathered together\.', text).group()
    positions = re.findall('[①-⑳]', body)
    assert positions == (['①', '①', '②'] if before else ['①', '②', '③']), (name, positions)
    answers = [(i, re.search(r'195번\s+답:\s*([①-⑳])', text)) for i, text in pages]
    answers = [(i, match.group(1)) for i, match in answers if match]
    assert len(answers) == 1 and answers[0][1] == '①', (name, answers)
    assert positions.count(answers[0][1]) == (2 if before else 1)
    assert '문항 195' in text
    if not before:
        for group in ((134, 135), (141, 142)):
            locations = [{i for i, t in pages if re.search(rf'문항\s*{n}(?!\d)', t)} for n in group]
            assert all(len(found) == 1 for found in locations) and locations[0] == locations[1], (name, group, locations)
    cases.append(dict(screen=name, pages=len(reader.pages), questionPage=page, outputNumber=195,
        positions=positions, answerPage=answers[0][0], answer=answers[0][1],
        answerTargets=positions.count(answers[0][1]), extractedBody=body,
        sha256=hashlib.sha256(file.read_bytes()).hexdigest()))
result = dict(status='BASELINE_FAILURE_REPRODUCED' if before else 'PASS', method='pypdf actual PDF text/answer assertions, not visual review', cases=cases)
out = root / 'tmp/hanbujang-fix-verification' / ('BEFORE_PDF_CHECKS.json' if before else 'AFTER_PDF_CHECKS.json')
out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
