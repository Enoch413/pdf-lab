"""Check visible positions/answers in regenerated representative PDFs, then render evidence."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
out = root / 'tmp/hanbujang-r1-final-verification'
results = []
for screen in ('index', 'final_test', 'general_exam'):
    file = out / f'{screen}-r1-bare.pdf'
    reader = PdfReader(file)
    pages = [(i + 1, p.extract_text()) for i, p in enumerate(reader.pages)]
    questions = [(n, re.search(r'The street was quiet\.[\s\S]*?People gathered together\.', text)) for n, text in pages]
    questions = [(n, match.group()) for n, match in questions if match]
    assert len(questions) == 3
    checks = []
    evidence_pages = set()
    for (page, body), number in zip(questions, (4, 11, 18)):
        positions = re.findall('[①-⑳]', body)
        assert positions == ['①', '②', '③'], (screen, number, body)
        answers = [(n, re.search(rf'(?<!\d){number}번\s+답:\s*([①-⑳])', text)) for n, text in pages]
        answers = [(n, match.group(1)) for n, match in answers if match]
        assert len(answers) == 1 and answers[0][1] == '①'
        assert positions.count(answers[0][1]) == 1
        assert f'문항 {number}' in pages[page - 1][1]
        assert ('( ① )' in body) == (number == 4)
        checks.append(dict(outputNumber=number, questionPage=page, body=body, positions=positions,
            answerPage=answers[0][0], answer=answers[0][1], answerTargets=1))
        evidence_pages.update((page, answers[0][0]))
    for page in sorted(evidence_pages):
        subprocess.run(['pdftoppm', '-f', str(page), '-l', str(page), '-scale-to', '1500', '-png', '-singlefile',
            str(file), str(out / f'{screen}-r1-page-{page}')], check=True, capture_output=True)
    results.append(dict(screen=screen, pdf=file.name, sha256=hashlib.sha256(file.read_bytes()).hexdigest(),
        pages=len(reader.pages), checks=checks, renderedPages=sorted(evidence_pages)))
result = dict(status='PASS', method='Actual PDF text/answer assertions plus Poppler renders; visual review separately reported', cases=results)
(out / 'R1_PDF_RESULTS.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
