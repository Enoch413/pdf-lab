# 실행 및 공개 회귀 검사

검증 환경은 Windows, Python 3.14.7, Node.js 24.20.0이다. 기존 Python 3.13 안내 환경은 별도 호환 검증이 필요하며, 이 변경으로 업그레이드를 강제하지 않는다.

JSON 텍스트 업무의 최소 서버 설치·실행:

```powershell
python -m pip install -r requirements-core.txt
python local_server.py --port 8762
```

OCR이 필요할 때만 기존 requirements.txt와 Tesseract 설치 경로를 사용한다. 현재 OCR 패키지 전체 조합은 검증하지 않았다. 최소 설치는 검증된 Pillow 버전을 고정하며 Node 기본 검사에는 추가 패키지가 없다.

```powershell
node tests/run_checks.cjs
```

이 명령은 JS 구문, 학생 식별/계정 격리, 삭제·동시 저장, 로컬 교체 롤백, 답안 편집, 미저장 작업 보호, 차수형 JSON, 렌더러, 공개 canonical 계약, 로컬 HTTP 경계 및 EXE 패키징 목록/브라우저 fallback을 검사한다. 외부 Firebase·브라우저 프로필·운영 DB에는 연결하지 않는다. Python 실행 파일이 다르면 PDFLAB_PYTHON을 지정한다.

공개 계약 검사와 비공개 전체 문항 검사는 명시적으로 구분한다.

```powershell
node tests/hanbujang_contract.test.cjs
node tests/hanbujang_contract.test.cjs --with-private
```

기본 검사는 합성 자료만 사용한다. --with-private는 권한 있는 P05 fixture가 없으면 안내 오류로 실패한다. 과거 실문항을 자동 복원하거나 Git에 포함하지 않는다. 기존 전체 브라우저/PDF runner 역시 비공개 fixture와 Playwright 환경이 필요하며 공개 기본 검사 통과와 별개다.

학생 오답 로컬 상태는 UID별로 저장한다. 기존 owner 없는 상태는 로컬 영역에 남고 로그인 계정으로 자동 이관되지 않는다. 폴더 백업도 로그인 UID별 파일을 사용하며 기존 파일은 삭제하지 않는다. 원격 삭제는 deletedAt 표시로 보존하며 오래된 기기가 재생성하지 않도록 문서 트랜잭션으로 확인한다. 적용 중인 Firebase 규칙의 transaction·해당 필드 허용은 운영 반영 전에 별도 검증해야 한다.

EXE는 app/build_exe.ps1에서 하나의 spec 목록으로 빌드한다. 빌드 환경에는 PyInstaller와 pywebview 및 서버 의존성이 필요하다. 이 수정에서는 실제 EXE 생성·설치를 하지 않았으며 패키징 목록과 서버 수명을 격리 검사했다. fallback 안내창은 브라우저 작업이 끝날 때까지 열어 둬야 한다.

GitHub Pages는 현재 main 푸시로 자동 배포된다. 공개 검사 실행은 배포를 하지 않는다. analysis 변경을 main에 반영하는 작업은 배포 범위를 확인한 후 별도로 수행한다.

17~20번 이후 보안 검증은 security/README.md와 security/HARDENING_20261020.md를 따른다. 공개 runner는 vendor 해시·CDN SRI·범위별 users 쿼리·대량 batch·공통 답안 파서·공통 화면 메뉴·실제 jsPDF 출력 및 CODE LAB CHECK 계약·부분 제출 회귀까지 포함한다(14개 Node suite + 5개 Python test). 기존 Firebase 인가와 실제 SDK/앱 저장 흐름은 demo 프로젝트의 Firestore/Storage emulator에서 별도로 실행하며, 격리된 테스트 SDK와 CODE LAB 소스가 필요하다. 운영 규칙 적용 결과와 검증 범위는 security/HARDENING_20261020.md의 운영 검증 기록을 확인한다. UI 통일 및 추가 검증은 docs/ui-unification.md에 기록한다.

## CODE LAB 새 권한 계약 — 로컬 호환 후보

CHECK 업로드는 `accessSchemaVersion: 1`, 단일 `classIds`, `class/personal` 배정 방식을 루트와 payload에 맞춘다. 개인 대상은 Auth UID를 요구하고 업로드 전에 서버의 `users/{uid}` 문서 ID·활성 학생 상태·반 배정을 확인한다. 이름·이메일·로그인 ID는 권한 키로 대체하지 않는다. 기존 개인 `student` 형식은 업로드할 새 문서에서 `personal`로 정규화한다. 다중 반 초안은 학생과 교집합인 반마다 문서를 나누고 ID 충돌은 저장 전에 거부한다. 모든 초안과 대상 검증을 첫 쓰기 전에 마치지만, 여러 문서의 전송 자체는 원자적 트랜잭션이 아니므로 네트워크 실패 시 일부 업로드됐을 수 있다.

제한 강사의 자료 쿼리는 검토 버전과 담당 반, 응답 쿼리는 CHECK ID와 담당 반을 서버에서 제한한다. 반은 30개씩 나누고 문서 ID로 중복 제거한다. 전체 관리자는 구형 자료 조회를 유지한다. 계정·권한 변경 후 늦은 결과는 가져오거나 반영하지 않는다. 구형 자료에 검토 표식을 일괄 추가하지 않으며 제한 강사가 구형 문서를 승격하는 요청은 새 서버 규칙에서 거부된다.

인접한 최신 CODE LAB 체크아웃과 Java 21·Firebase CLI 15.34.0이 있는 PDF LAB 루트에서 새 계약 통합 검사를 실행한다:

```powershell
node "../CODE LAB/tools/firebase-cli/node_modules/firebase-tools/lib/bin/firebase.js" emulators:exec --config "../CODE LAB/firebase.local.json" --project demo-codelab-reaudit --only firestore "node tests/check_contract_rules.test.cjs"
```

이 검사는 `127.0.0.1:8786`만 허용하고 실제 PDF LAB 함수와 합성 프로필·문서를 REST 어댑터로 연결한다. 인접 CODE LAB의 실제 자료 쿼리·정규화 함수로 배정 학생·강사·전체 관리자 조회, 비배정·비활성 거부도 확인한다. 앱 시작·CLI 로그인·운영 계정·DB를 사용하지 않는다. 실제 브라우저 Firebase SDK 검증과 구분한다. 기존 `security/firestore.rules`·`security/storage.rules` 및 배포 규칙 보존본은 변경하지 않았다. CODE LAB 새 규칙·인덱스와 두 앱을 함께 검토한 후 별도 승인으로 전환해야 하며, 이전 규칙 사본으로 덮어쓰면 안 된다. `checkResponses(checkSetId, classIds)` 및 `portalCheckSets(accessSchemaVersion, classIds)` 인덱스 준비는 에뮬레이터 통과만으로 확인되지 않는다.

CHECK 응답에서 실제 매핑되고 boolean으로 채점된 문항만 오답 차수에 반영한다. 누락·미채점·매핑 실패·상충하는 중복 답안은 이전 결과를 유지한다. 한 원문항에 여러 문항이 매핑되면 명시적 오답이 하나라도 있을 때 틀림이며, 모두 명시적 정답일 때만 맞음으로 바꾼다. 부분 제출·답 수정 이후 실제 2차 오답 생성 입력에 누락된 기존 오답이 남는지도 `check_response_retry.test.cjs`에서 확인한다. 기존 자기 채점·화면 디자인은 유지한다.
