# PDF 없이 AI JSON 등록하기

## 사용 순서

1. 문제 라이브러리에서 문제 출처와 새 교재 이름 또는 기존 교재를 선택합니다.
2. 현재 불러온 문항이 있다면 먼저 저장한 후 **초기화**합니다. 초기화는 현재 불러온 작업만 비우며 저장된 라이브러리는 삭제하지 않습니다.
3. **AI JSON 업로드**로 JSON 파일을 선택합니다. PDF는 필요하지 않습니다.
4. 문항 텍스트·유형·정답을 검수한 후 **문제 라이브러리에 저장**합니다. Firebase/폴더 저장 대상과 로그인 조건은 기존과 같습니다.
5. 반별 출제 또는 파이널테스트에서 저장한 문항을 고르고 **텍스트 출제**를 선택합니다. 이미지가 없는 JSON 전용 문항은 이미지 출제로 출력할 수 없습니다.

현재 문항이 남아 있을 때 JSON을 올리면 기존과 같이 번호가 일치하는 문항의 텍스트·유형·정답을 덮어씁니다. 기존 PDF와 이미지 조각은 유지됩니다. 번호가 없는 JSON은 초기화 후 새 텍스트 문항으로 불러오세요.

## JSON 형식

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
