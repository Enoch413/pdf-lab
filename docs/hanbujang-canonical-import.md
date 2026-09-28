# 한부장 canonical-16 가져오기

기존 legacy JSON과 별도 경로다. 계약 원본은 `hanbujang-contract/`의 세 파일이며 `app/hanbujang_canonical.js`가 앱 경계에서 검사한다. 현재 16필드 객체가 편집 가능한 기준이다. 처음 가져온 값을 나중의 수정 위에 덮어쓰지 않는다.

## 데이터와 식별

- 최상위 `sourceName`, `textbookName`, `problems`만 허용한다. sourceName은 원본 PDF명, 실제 업로드 JSON 파일명은 별도 보존한다.
- 문항의 정확한 필드: `number, passageLabel, questionGroupId, groupOrder, groupSize, problemType, tailSubType, isSubjective, questionText, bodyText, summaryText, givenText, choices, answerText, explanationText, rawText`.
- 타입·누락·null·추가 필드·중복 번호·그룹 불일치는 문항 번호/필드 오류로 거부한다. 번호는 중복 없는 1..N이며 출력 번호는 별도다.
- 선택지는 marker/text 객체 배열이다. 0/4/6개도 강제 보충·절단하지 않는다. marker는 빈 값/중복을 거부하고 입력 순서를 보존한다. boolean 문자열은 boolean으로 추측하지 않는다.
- 교재 분류는 화면 선택값이다. JSON 교재명은 별도 보존하며 불일치를 표시한다. 교재 미선택은 거부한다.
- 문서 키는 기존 sourceId 알고리즘(출처·화면 교재·업로드 파일명)을 유지한다. 같은 source의 재등록은 기존 교체 정책 그대로다.
- `canonical`, `canonicalDocumentId`, `canonicalSource`는 레코드 메타데이터다. 외부 16필드와 혼합하지 않는다. DB 일괄 마이그레이션은 없다.

## 그룹과 편집

- 독립문항은 빈 그룹 ID, 순서 0, 크기 1, 빈 tailSubType이다.
- 꼬리는 `problemType="꼬리"`, 실제 유형은 tailSubType. 같은 문서 안에서 동일 ID·본문·실제 구성 수·중복 없는 순서 1..N을 검증한다.
- 그룹 키는 문서 ID와 그룹 ID다. 같은 passageLabel만으로 묶지 않는다. 다른 문서의 같은 그룹 ID도 분리한다.
- 저장 레코드는 `sourceId`가 문서 범위의 기준이고 `canonicalDocumentId`는 동일한 값으로 저장한다. 저장 작업에는 선택한 출처·교재·파일명으로 만든 문서 ID를 담는다. 출처를 바꿔 같은 작업을 저장해도 다른 출처의 그룹/공통지문/지문 키와 섞이지 않으며, JSON provenance는 바꾸지 않는다. 오래된 불일치 레코드는 조회 시 sourceId로 구분할 뿐 DB를 자동 수정하지 않는다.
- 출력 복사본에서만 공통지문/자식을 파생하고 지문을 한 번 출력한다. 저장 canonical 각 문항의 반복 본문은 삭제하지 않는다. 부분 출력이나 미리보기 제한도 지문을 동반하며 원래 크기·순서를 바꾸지 않는다.
- 편집창에서 네 텍스트 필드, 라벨, 선택지 JSON, 실제 유형, 주관식 여부, 정답·해설을 독립 편집한다. 빈 값으로 지울 수 있다. rawText는 읽기 전용 원문 증거다.
- 공통 bodyText 편집은 전체 그룹에 적용한다. 발문·정답은 해당 문항만 수정한다. 한 그룹은 IndexedDB 한 transaction / Firebase 한 batch로 저장한다. 서로 다른 저장소 사이의 분산 트랜잭션은 제공하지 않는다.
- canonical 그룹 단독 삭제는 차단한다. 그룹 전체를 제외한 JSON으로 같은 source를 재등록하거나 교재 전체 삭제 경로를 사용한다. 새 그룹 전용 삭제 UI는 추가하지 않았다.

## 출력과 표기

- 반별 출제와 파이널테스트에서 텍스트 모드를 선택한다. 일반 출제는 canonical을 텍스트로 출력하고 기존 이미지 문항은 이미지 경로를 사용한다.
- known tokens: `[[u:...]]`, `[[blank]]`, `[[blank:A]]`, `[[box:A:is|are]]`, `[[s]]`, `[[slot]]`.
- `____`, `(A) ____`, `( ① )`, `[what / that]`, `[[u:[working / to work]]]`는 원본 문자열을 저장하며 토큰으로 재작성하지 않는다. 미지원/불완전 토큰은 안전하게 문자로 표시하고 경고한다.
- 삽입(꼬리의 실제 유형 포함)은 문항 단위로 본문의 `( ① )` 같은 명시 위치와 `[[s]]`/`[[slot]]`을 함께 센다. 발문·보기에서 인용한 동그라미는 위치로 바꾸지 않는다. 관련 필드의 익명 토큰 카운터도 공유한다. 명시 위치 중복·혼합 순서 충돌·정답 위치 불명확은 문항 번호/이유를 표시하고 출력을 중단한다. 렌더링만 달라지고 저장 본문·정답은 그대로다. 위치는 ①..⑳, 답안은 대응하는 동그라미 또는 숫자(복수는 공백/쉼표/슬래시/세미콜론 구분)를 확인하며, 해석 불가능한 서술 답은 추측하지 않는다.
- 괄호 없는 명시 위치도 본문의 시작·문장 끝(. ! ?)·줄 경계에서 인식한다. 평문 위치만 있거나 익명 토큰과 섞여 있어도 같은 문항 카운터를 사용한다. 따옴표로 감싼 인용과 밑줄 토큰 속 번호는 제외하며, 문장 중간에서 역할이 불명확한 괄호 없는 번호는 출력 전에 확인하도록 차단한다. 원문에 괄호를 삽입하거나 canonical을 고치지 않는다.
- 여러 줄 답안과 해설은 정답지에서도 줄바꿈을 보존한다. 장문은 기존 텍스트 paginator로 다음 단/페이지에 이어 출력한다.
- JSON 내보내기/붙여넣기 UI는 이번 변경 범위에 없다. 기존 legacy 입력은 이전 정규화 경로 그대로이며 canonical 보존을 소급해서 보장하지 않는다.

## 격리 검증

`node tests/hanbujang_canonical_browser.cjs` (Playwright가 설치된 기존 프로젝트 환경 또는 `PDFLAB_NODE_MODULES` 지정).

`node tests/run_hanbujang_review.cjs`는 기존 6개 검사와 R1/R2/R3 회귀를 다시 실행하고 `PDF_LAB_HANBUJANG_COMPAT_FIX_TEST_RESULTS.json`을 작성한다. `tests/hanbujang_review_fixes_browser.cjs --before`는 `output/hanbujang-compat-review-20260928`에 풀린 이전 제출본의 알려진 실패를 기대하는 비교 진단이며 수정본 PASS 검사가 아니다.

`node tests/run_hanbujang_review.cjs --r1-final`은 위 7개 검사와 괄호 없는 삽입 위치 회귀를 함께 실행한다. 파생 입력은 `tests/fixtures/hanbujang/derived/`에 원본과 분리되어 있다. `PDF_LAB_HANBUJANG_COMPAT_R1_FINAL_TEST_RESULTS.json` 및 `tmp/hanbujang-r1-final-verification/`에 이번 결과/PDF를 기록한다.

실제 P05 191문항과 명시된 합성 7문항은 `tests/fixtures/hanbujang/`에 있다. 이는 추출 의미 정확성의 golden이 아니다. 테스트는 새 브라우저 프로필, 차단된 외부 요청, Firebase 메모리 SDK, `tmp/hanbujang-verification/folder/` 시험 폴더만 사용한다. 실서버 권한·쿼터·운영 기기별 출력은 별도 검증 사항이다.
