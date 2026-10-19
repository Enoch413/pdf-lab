# PDF 없이 AI JSON 등록하기

## 사용 순서

1. 문제 라이브러리에서 문제 출처와 새 교재 이름 또는 기존 교재를 선택합니다.
2. 현재 불러온 문항이 있다면 먼저 저장한 후 **초기화**합니다. 초기화는 현재 불러온 작업만 비우며 저장된 라이브러리는 삭제하지 않습니다.
3. **AI JSON 업로드**로 JSON 파일을 선택합니다. PDF는 필요하지 않습니다.
4. 문항 텍스트·유형·정답을 검수한 후 **문제 라이브러리에 저장**합니다. Firebase/폴더 저장 대상과 로그인 조건은 기존과 같습니다.
5. 반별 출제 또는 파이널테스트에서 저장한 문항을 고르고 **텍스트 출제**를 선택합니다. 한부장 canonical 문항은 일반 출제에서도 텍스트로 출력됩니다. 이미지가 없는 JSON 전용 문항은 이미지 출제로 출력할 수 없습니다.

**AI JSON 업로드 (여러 파일)**에서 Ctrl/Shift로 여러 JSON을 선택할 수 있습니다. 초기화된 작업에서 같은 교재·재출제 방식으로 함께 가져오며, 파일별 지문과 차수 연결을 유지합니다. 문항 번호는 선택한 파일 순서대로 전체 연속 번호를 부여합니다. 모든 파일을 검증한 후에만 현재 작업에 반영하며, 오류에는 파일 이름을 표시합니다. 한 파일씩 기존 번호로 덮어쓰는 기능은 유지합니다. canonical JSON은 문서·그룹 대응 보존을 위해 한 파일씩 등록하세요.

현재 문항이 남아 있을 때 **legacy JSON**을 올리면 기존과 같이 번호가 일치하는 문항의 텍스트·유형·정답을 덮어씁니다. canonical JSON은 원본 문서명·전체 문항 번호·그룹 대응이 모두 맞아야 적용됩니다. 불명확하면 현재 작업을 그대로 두고 새 가져오기를 안내합니다. 기존 PDF와 이미지 조각은 유지됩니다. 번호가 없는 legacy JSON은 초기화 후 새 텍스트 문항으로 불러오세요.

## 일반형 / 차수형 선택

업로드 전에 **JSON 오답 재출제 방식**을 선택합니다. 기본값인 **일반형**은 너른터·이그잼포유 등 기존 자료의 같은 지문·유형에서 미사용 대체 문항을 선택합니다. 기존에 등록한 자료도 일반형으로 동작합니다.

직접 만든 쏠북 JSON은 **차수형**으로 등록할 수 있습니다. 같은 파일·지문·원래 유형·난이도마다 정확히 3문항을 배열 순서대로 1·2·3차로 연결합니다. 내용 일치와 불일치는 별도 묶음이며, 난이도가 없는 유형은 미지정끼리 묶습니다. 3문항이 아니면 등록 전에 오류를 표시합니다. 순서가 실제 차수와 일치하는지 먼저 확인하세요.

반별 최초 출제에는 차수형의 1차 문항만 사용합니다. 학생별 오답 재출제는 직전 차수의 오답만 같은 묶음의 다음 차수로 연결하며, 3차 이후에는 종료합니다. 일반형 재출제는 차수형 문항을 섞어 선택하지 않습니다. 난이도와 차수 연결은 라이브러리·폴더·Firebase 저장 및 작업 저장에 보존됩니다. 원본 JSON은 수정하지 않습니다.

차수형은 초기화 후 파일 전체를 새로 가져와야 하며 부분 덮어쓰기를 지원하지 않습니다. 기존에 일반형으로 등록한 파일을 차수형으로 쓰려면 초기화 후 차수형을 선택해 다시 가져와 저장하세요. 이 변경이 기존 라이브러리를 자동 변환하지는 않습니다. canonical JSON은 일반형으로 등록합니다.

검증: `node tests/json_retry_series.test.cjs`. 선택적으로 `PDFLAB_JSON_CHECK_DIR`에 JSON 폴더를 지정하면 그 폴더도 검사합니다. 테스트는 Firebase에 연결하지 않습니다.

## 한부장 canonical-16 형식

[canonical 가져오기 안내](hanbujang-canonical-import.md)와 [계약 스키마](hanbujang-contract/CANONICAL_SCHEMA.json)를 따릅니다. 그룹 필드가 하나라도 있으면 canonical 후보이며 16필드 완전성 검사에 실패한 파일을 legacy로 우회하지 않습니다.

## 기존 legacy JSON 형식 (canonical에는 적용하지 않음)

최상위 문항 배열 또는 `problems`, `items`, `questions`, `data`, `문항`, `문제` 배열을 지원합니다.

```json
{
  "questions": [
    {
      "number": 1,
      "type": "주제",
      "passageLabel": "2학기-01",
      "stem": "다음 글의 주제로 가장 적절한 것은?",
      "body": "People learn from one another. Sharing ideas helps a community grow.",
      "choices": ["Learning together", "Travel alone", "Saving time", "Buying books", "Making machines"],
      "answer": "1",
      "explanation": "함께 배우고 생각을 나누는 것의 가치를 설명한다."
    }
  ]
}
```

- 문항 번호가 없으면 배열 순서대로 1번부터 붙입니다. 지정 번호는 양의 정수여야 하며 중복 번호·빈 문항·잘못된 JSON은 신규 등록 전에 거부합니다.
- `questionText`/`stem`/`question`/`prompt`/`발문`, `bodyText`/`body`/`passage`/`본문` 등 기존 AI JSON 필드명을 지원합니다.
- 기존 `textStructure` 구조와 `givenText`, `summaryText`, 쏠북 마커 `[[blank]]`, `[[u:...]]`, `[[box:A:left|right]]`, `[[s]]`도 사용할 수 있습니다.
- 유형은 한글 또는 쏠북의 `title`, `topic`, `blank`, `order`, `insertion` 등의 유형 코드를 사용할 수 있습니다.
- 주관식은 `isSubjective: true` 또는 `type: "영작"`/`"주관식"`/`"서술형"`처럼 지정합니다.
- `passageLabel`/`worksheetRef`/`지문번호`로 지문을 묶습니다. 생략하면 같은 JSON 파일의 문항을 파일명 기준 한 지문으로 묶습니다. 여러 지문이 들어 있는 파일은 문항마다 지문번호를 넣으세요.
- JSON 전용 레코드에는 `textOnly: true`가 저장됩니다. 이미지 필수 검사와 OCR 보정만 이 레코드에 한해 건너뜁니다. 일반 PDF 문항의 이미지 누락 검사는 유지합니다.

## 검증

```powershell
node tests/solbook_text_renderer.test.cjs
$env:PDFLAB_NODE_MODULES = 'C:\Users\CHOI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
node tests/json_only_import_browser.cjs
node tests/firebase_email_login_browser.cjs
```

JSON 업로드, 오류 처리, 이미지 없는 저장, IndexedDB 새로고침 복원, 기존 PDF 덮어쓰기, 양쪽 출제 화면의 HTML/PDF 및 주관식 정답을 격리 브라우저에서 검사합니다. Firebase SDK 경계는 메모리 모형을 사용하며 실제 Firebase 데이터는 변경하지 않습니다. PDF 검증 산출물은 `tmp/pdfs/json-only-qa/`에 생성되며 커밋 대상이 아닙니다.
