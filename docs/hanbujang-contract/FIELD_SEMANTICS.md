# HANBUJANG Canonical Field Semantics

## Top level
- `sourceName`: 입력 PDF의 원본 파일명. 임의로 재명명하지 않는다.
- `textbookName`: 원본에 명확히 제시된 교재/단원명. 없으면 빈 문자열.
- `problems`: 실제 문제 순서의 배열.

## Problem 16 fields
1. `number`: JSON 내부 연속 문제번호 1..N.
2. `passageLabel`: 원본이 제공하는 출전/지문 식별 라벨. 없으면 "".
3. `questionGroupId`: 공통지문 꼬리문항 그룹 ID. 독립문항은 "".
4. `groupOrder`: 그룹 내 순서. 독립문항은 0.
5. `groupSize`: 그룹 크기. 독립문항은 1.
6. `problemType`: canonical 21종 중 하나.
7. `tailSubType`: `problemType=="꼬리"`일 때 실제 의미 유형. 그 외는 보통 "".
8. `isSubjective`: 직접 작성/서술 응답이면 true.
9. `questionText`: 발문 + 해당 문항의 `<조건>`, `<보기>`, word bank, 답안 scaffold.
10. `bodyText`: 학생이 읽는 본문/대화/자료. 문항 보조조건·정답표·페이지 장식은 제외.
11. `summaryText`: 원본에 별도 제시된 요약/요약완성 frame만.
12. `givenText`: 삽입/순서 등에서 본문과 별도로 제시된 주어진 문장/블록만.
13. `choices`: 실제 선택지 배열. 객관식은 marker/text 전체, 주관식은 원칙적으로 [].
14. `answerText`: 해당 문항 정답 전체. 복수답·(1)/(2) 등 누락 금지.
15. `explanationText`: 해당 문항 해설만. 다른 문항 정답/해설 침범 금지.
16. `rawText`: 원본 evidence용 raw extraction. semantic field correctness를 대신하지 않는다.

## Fundamental rule
PDF의 실제 시각 구조가 최상위 source of truth다. 텍스트 레이어 읽기 순서, OCR 순서, 기존 JSON, validator는 보조 근거다.
