# 검증 입력의 공개 범위

`HANBUJANG_SYNTHETIC_7.json`은 설명·검증용 합성 7문항이다. `derived/R1_BARE_MIXED_INPUT.json`과 `derived/R1_BARE_PLAIN_INPUT.json`은 이 합성 입력의 삽입 문항 본문만 변경한 R1 회귀 fixture다. 실제 시험 문항 원문이 아니다.

실제 191문항 `P05_CANONICAL_ACTUAL.json`은 로컬에 보존하고 공개 Git 저장소에는 포함하지 않는다. 전체 검토 검사의 재현에는 권한 있는 검토 ZIP의 해당 파일을 이 디렉터리에 준비해야 한다. 누락된 파일을 대체하거나 검사를 조용히 건너뛰지 않는다.

공개 합성 입력만 사용하는 검사는 `node tests/hanbujang_r1_bare_browser.cjs`다. 전체 검토 실행 방법·검증 범위·로컬 증거는 `docs/hanbujang-git-review.md`를 참고한다.
