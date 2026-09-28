"""Inspect real PDFs by case/question identity, then render comparison pages."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
out = root / 'tmp/question-layout-review'
checks = []
p05 = json.loads((root / 'tests/fixtures/hanbujang/P05_CANONICAL_ACTUAL.json').read_text(encoding='utf-8'))
p05_answers = [p['answerText'] for p in p05['problems'] if p['number'] in (134, 135, 141, 142)]
compact = lambda text: re.sub(r'\s+', '', text)
for phase in ('before', 'after'):
    browser = json.loads((out / phase / 'RESULTS.json').read_text(encoding='utf-8'))
    for screen_result in browser['cases']:
        screen = screen_result['screen']
        file = out / phase / f'{screen}.pdf'
        reader = PdfReader(file)
        texts = [page.extract_text() for page in reader.pages]
        names = [case['name'] for case in screen_result['cases']]
        starts = []
        for name in names:
            matches = [i for i, text in enumerate(texts) if compact('출력 배치 검증 · ' + name) in compact(text)]
            assert len(matches) == 1, (phase, screen, name, matches)
            starts.append(matches[0])
        case_checks = []
        for index, case in enumerate(screen_result['cases']):
            start, end = starts[index], starts[index + 1] if index + 1 < len(starts) else len(texts)
            pages = list(range(start, end))
            question_pages = [i for i in pages if 'ANSWERKEY' not in compact(texts[i])]
            answers = ''.join(texts[i] for i in pages if i not in question_pages)
            text = ''.join(texts[i] for i in question_pages)
            numbers = set(map(int, re.findall(r'문항\s*(\d+)', text)))
            assert numbers == set(range(1, case['questionCount'] + 1)), (phase, screen, case['name'], numbers)
            answer_numbers = list(map(int, re.findall(r'(\d+)번\s*답:', answers)))
            assert answer_numbers == list(range(1, case['questionCount'] + 1)), (screen, case['name'], answer_numbers)
            instruction_count = compact(text).count(compact('다음 글을 읽고 물음에 답하시오.'))
            if phase == 'after':
                assert 'NURNTER:' not in text and 'SYN-GROUP' not in text and '공통지문·[' not in compact(text)
                if not case['expected'].get('images') and not case['expected'].get('longImage'):
                    # DOM coordinates alone cannot catch physical PDF fragmentation
                    # dropping top padding on a continuation sheet.
                    for i in question_pages:
                        coordinates = []
                        def position(value, cm, tm, font, size):
                            # pypdf also emits inferred separators after resetting
                            # the text matrix; those callbacks are not glyph positions.
                            if value.strip() and font is not None and tm != [1, 0, 0, 1, 0, 0]:
                                y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
                                baseline = float(reader.pages[i].mediabox.height) - y
                                coordinates.append((baseline - size * abs(cm[3]), baseline))
                        reader.pages[i].extract_text(visitor_text=position)
                        assert min(y[0] for y in coordinates) >= 8 * 72 / 25.4 - 2, (screen, case['name'], i + 1, 'top margin')
                        assert max(y[1] for y in coordinates) <= float(reader.pages[i].mediabox.height) - 8 * 72 / 25.4 + 1, (screen, case['name'], i + 1, 'bottom margin')
                else:
                    # SVG text outside its clip can appear in extraction. The
                    # visible card's question badge still has real PDF coordinates.
                    for i in question_pages:
                        tops=[]
                        def image_badge(value, cm, tm, font, size):
                            if value.strip() in ('문', '항', '문항') and font is not None and tm != [1,0,0,1,0,0]:
                                y=tm[4]*cm[1]+tm[5]*cm[3]+cm[5]
                                tops.append(float(reader.pages[i].mediabox.height)-y-size*abs(cm[3]))
                        reader.pages[i].extract_text(visitor_text=image_badge)
                        assert tops and min(tops) >= 8*72/25.4-2, (screen,case['name'],i+1,'image top margin')
                if 'groups' in case['expected']:
                    assert instruction_count == case['expected']['groups'], (screen, case['name'], instruction_count)
                if case['name'] == 'P05-tail':
                    for pair in ((1, 2), (3, 4)):
                        assert any(all(re.search(rf'문항\s*{n}(?!\d)', texts[i]) for n in pair) for i in question_pages)
                    assert re.findall(r'답:\s*([①-⑳])', answers) == p05_answers
                if case['name'] == 'page-boundary':
                    assert not re.search(r'문항\s*2(?!\d)', texts[question_pages[0]])
                    assert all(re.search(rf'문항\s*{n}(?!\d)', texts[question_pages[1]]) for n in (2, 3))
                if case['expected'].get('samePage'):
                    assert len(question_pages) == 1
                if case['expected'].get('split'):
                    assert len(question_pages) > 1 and '계속' in text
                if case['expected'].get('sourceText'):
                    assert compact('원문 발문 [17-3]') in compact(text)
                    assert compact('(B) [what / that]') in compact(text)
            # First pages of every scenario; all question pages for groups/long cards.
            selected = question_pages if (case['expected'].get('groups') or case['expected'].get('longText') or case['expected'].get('longImage')) else question_pages[:1]
            pngs = []
            for i in selected:
                stem = out / phase / f'{screen}-{case["name"]}-page-{i + 1}'
                subprocess.run(['pdftoppm', '-f', str(i + 1), '-l', str(i + 1), '-scale-to', '1300', '-png', '-singlefile', str(file), str(stem)], check=True, capture_output=True)
                pngs.append(stem.name + '.png')
            case_checks.append(dict(name=case['name'], questionPages=[i+1 for i in question_pages], questionNumbers=sorted(numbers), answerNumbers=answer_numbers, instructionCount=instruction_count, rendered=pngs))
        checks.append(dict(phase=phase, screen=screen, pages=len(reader.pages), sha256=hashlib.sha256(file.read_bytes()).hexdigest(), cases=case_checks))
result = dict(status='PASS', method='Actual PDF text by case/question identity plus Poppler renders; visual review recorded separately', checks=checks)
(out / 'PDF_RESULTS.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
