# Firebase·jsPDF 보안 수정 결과 및 운영 적용 전 안내

2026-10-20 검증 기록. 이후 사용자가 CODE LAB → Firestore → PDF LAB 순서의 운영 반영을 승인했다. CODE LAB 호환 패치 `b4e7ed9`의 Pages 배포·운영 소스 일치를 확인한 뒤 Firestore ruleset `11894317-eeaa-4563-9909-04c8389f1b18`을 적용했다. 운영 규칙 소스 일치·익명 읽기 거부·Storage 규칙 불변도 확인했다. 운영 문서 데이터는 변경하지 않았다. 아래의 미적용·원본 보존 표현은 배포 전 검증 당시의 기록이다. PDF LAB 웹/포터블 수정은 이번 배포 대상이다.

## 결과

| 묶음 | 수정 | 확인 | 남은 단계 |
|---|---|---|---|
| Firebase 인가 | admin 자가 생성·권한 필드 추가 차단, 담당 반 users 쿼리, 개인 오답 ownerUid 고정, 다른 계정 문서 ID 선점 차단, 신고 소유권 탈취 차단 | 인가 67조건 + 신규 문서 7개 get, 실제 SDK/앱 201명 저장·수정·삭제·오래된 기록 재전송·이력·작업 저장 통과 | CODE LAB 호환 패치와 함께 운영 적용 필요 |
| jsPDF | 두 vendor 2.5.2 → 4.2.1, 캐시 버전·해시 갱신 | 정확 버전 collector의 기존 12 advisory 해소. 실제 PDF/ZIP 다운로드, 한글·로고·문항·답안 통과 | 웹/포터블 배포 필요 |
| 공유 앱 호환 | CODE LAB의 관리자 연결로 학생 프로필 생성, 담당 반 쿼리, 첫 로그인 무단 반 배정 제거 | 실제 소스 사본에 패치 적용 후 Firestore SDK로 검증 | 원본/운영 앱에는 미적용 |

기존 글꼴·로고·다른 vendor 버전과 디자인·문항 스키마를 유지했다. 원 jsPDF 두 사본은 로컬 `tmp/security-hardening-20261020/original-vendor/`에 보존했다. `tmp/`와 emulator 로그를 Git에서 제외하고, vendor는 `.gitattributes`로 줄바꿈 자동 변환을 막아 해시가 체크아웃 후에도 유지되도록 했다.

## Firebase 수정과 호환성

기존 로컬 수정안에 문서 ID 선점 방지도 추가했다. 개인 설정 새 문서는 실제 UID를 ID로 사용하고, 나머지 오답 새 문서는 기존 앱의 `UID 소문자__...` 형식을 강제한다. 기존 문서의 ownerUid를 바꾸는 업데이트는 거부한다. 기존 소유 문서 조회/수정과 신규 transaction 읽기를 유지한다. 일반 student의 비활성 권한값 `adminScope: assigned`는 CODE LAB과 호환되지만 admin 역할·임의 반·문법 접근 권한의 자기 부여는 허용하지 않는다.

운영 사전 확인은 GET/필드 선택 쿼리만 사용했다. 전체 관리자 프로필 1개, 제한 관리자 프로필 2개를 확인했다. 학생 이름·이메일·문항·답안은 읽지 않았다. 오답 7컬렉션의 ownerUid 메타데이터 검사에서 기존 40문서의 owner 누락·ID 형식 불일치는 없었다. 나머지 5컬렉션은 비어 있었다. 따라서 이 검사 범위에서는 데이터 마이그레이션이 필요하지 않다. 운영 ruleset은 기존 사본과 같은 ID였으며 변경되지 않았다.

CODE LAB 실제 소스 `../CODE LAB/rotation_portal_enhancements.js`에서 다음 호환 문제를 확인해 `code-lab-compat.patch`로 준비했다. `index.html`의 해당 script 캐시 버전 갱신도 패치에 포함했다. 두 원본 파일은 그대로다. 검토 기준은 CODE LAB의 변경 없는 `main` 커밋 `bb76ad7`이다.

1. 관리자 학생 생성 함수는 별도 Auth 인스턴스로 계정을 만든 뒤 **학생 권한의 Firestore**로 반 정보를 저장했다. 강화 규칙에서는 거부되므로 프로필 쓰기는 로그인된 전체 관리자의 기존 DB 연결로 수행한다. 관리자 Auth 세션은 바꾸지 않는다.
2. 제한 강사도 users 전체를 가져와 UI에서 반을 걸렀다. 담당 반 `array-contains-any` 쿼리로 바꾸고 전체 관리자는 전체 조회를 유지한다.
3. 첫 로그인은 첫 번째 반에 자동 배정했다. 신규 일반 로그인은 빈 반 목록으로 생성해 관리자 배정을 기다린다. 관리자가 학생을 생성할 때 지정하는 반은 정상 저장된다. **이 동작 변경은 운영 반영 전에 확인해야 한다.**
4. 프로필 문서의 uid 필드가 실제 Auth/문서 ID를 덮지 않도록 순서를 수정한다.

`code-lab-compat-base.json`의 파일 SHA-256을 검사한 뒤 임시 사본에만 `git apply --check`와 적용을 수행해 테스트한다. 원본이 바뀌면 임의 적용하지 않고 검사가 실패한다. 이 패치를 생략한 채 규칙만 운영에 적용하면 CODE LAB 가입·학생 관리·제한 강사 조회가 실패할 수 있다.

## jsPDF 출처·경고 검증

[공식 v4.2.1 릴리스](https://github.com/parallax/jsPDF/releases/tag/v4.2.1)를 기준으로 npm 공식 registry의 고정 버전 tarball을 받고 registry의 SHA-512 integrity와 비교한 뒤 UMD 파일만 추출했다. 두 런타임 사본의 SHA-256은 동일하며 `jspdf-package-integrity.json`과 `dependencies.json`에 기록했다. 브라우저 script URL에 `?v=4.2.1`을 붙여 이전 번들 캐시를 회피한다. 파일 시스템 읽기 opt-in은 사용하지 않는다.

Supply Chain Risk Auditor collector를 정확 버전 manifest로 다시 실행했다. 현재 jsPDF 4.2.1의 알려진 advisory는 검사 결과 0이며 이전 2.5.2의 12건은 모두 영향 범위에서 벗어났다. 함께 검사한 직접 의존성은 6개(PyPI 1/npm 5)다. 이 결과는 vendor 내부 전이 패키지 전체 검사가 아니며 html2canvas/jsPDF의 기존 publisher·maintenance 판정까지 해소했다는 뜻도 아니다.

산출물: `C:/Users/CHOI/.codex/visualizations/2026/10/19/01a1534c-2d90-7bb3-8f87-4bfa8987a123/pdflab-secured-runtime/{findings.json,report.md}`. 이전 12건의 상세·호출 대조는 `REVIEW_17_20_20261020.md`에 보존했다.

## 실행한 검사

- 공개 Node suite **11개**, Python test **5개**, 작성 JS 구문·Git diff 공백 검사 통과. 사용자 JSON 23파일 **2,307문항** 검사 통과.
- Firestore/Storage 인가 **67조건**, 신규 문서 7개 get 확인 통과. 담당 반/다른 반, 자기 역할·반·UID 위조, 타 소유자 조회/쓰기·ID 선점, Storage 비로그인/학생 거부와 관리자 허용을 포함한다.
- 앱과 같은 Firebase **10.12.2 SDK**로 실제 `saveStudentRetryStateToFirebase`, `loadStudentRetryStateFromFirebase`, transaction 기반 저장을 실행했다. 201명으로 100문서 단위 transaction을 넘겨 검사했고, 변경·삭제 표시·오래된 재전송, 개인 이력 생성/삭제와 작업 저장을 확인했다. VM 경계에서만 `structuredClone`으로 객체 realm을 맞추며 undefined 등 데이터 값은 보존한다.
- CODE LAB 패치 적용 사본의 함수로 관리자 학생 프로필 생성, 신규 로그인 프로필 생성, 제한 강사 담당 반 조회를 실제 Firestore emulator에 실행했다. Auth 계정 생성/프로필 변경 API 자체는 합성 Auth로 대체했다. 운영 Auth 가입은 하지 않았다.
- 실제 메이커 함수·동일 인쇄용 한글 폰트/로고로 교체 전/후 1~3차 PDF 각 2쪽을 생성했다. **6쪽 쌍의 72dpi 렌더링 픽셀이 완전히 동일**하고 추출 텍스트도 동일했다. 문제와 답지 PNG를 직접 확인했다.
- 실제 브라우저에서 21문항을 가져와 정답 포함 PDF 4쪽, 1~3차 ZIP을 다운로드했다. ZIP 내부 PDF 3개는 각각 2쪽이며 해당 차수의 해설만 포함한다. 콘솔 warn/error 없음. 시험 자료는 합성이며 라이브러리/운영 DB에 저장하지 않았다.

증거: `tmp/security-hardening-20261020/`의 `public-checks.log`, `firebase-checks.log`, `production-readonly-preflight.json`, `pdf-before/`, `pdf-after/`, `browser-single.pdf`, `browser-rounds.zip`, `maker-output-after.png`.

공개 검사:

```powershell
$env:PDFLAB_JSON_CHECK_DIR='C:/Users/CHOI/Desktop/2단원 문제' # 실제 자료 검사는 있을 때만
node tests/run_checks.cjs
```

Firebase 검사는 Java 21, Firebase CLI, 별도 테스트용 SDK가 필요하다. SDK는 앱 의존성에 추가하지 않았고 공식 npm 설치에서 script를 실행하지 않는다.

```powershell
$sdkDir='C:/Users/CHOI/.codex/visualizations/2026/10/19/01a1534c-2d90-7bb3-8f87-4bfa8987a123/pdflab-firebase-test-sdk'
npm install --ignore-scripts --no-audit --no-fund --save-exact --prefix $sdkDir firebase@10.12.2
$env:PDFLAB_FIREBASE_TEST_SDK=$sdkDir
$env:PDFLAB_CODE_LAB_SOURCE='C:/Users/CHOI/Documents/프로그래밍/CODE LAB/rotation_portal_enhancements.js'
$env:JAVA_HOME='C:/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot'
$env:PATH="$env:JAVA_HOME/bin;$env:PATH"
firebase.cmd emulators:exec --project demo-pdflab-audit --config security/firebase.emulators.json --only firestore,storage 'node tests/firebase_rules.test.cjs'
```

테스트는 정확한 loopback emulator 주소와 demo 프로젝트에 한정하며 운영 자격 증명을 쓰지 않는다. Firebase CLI 로그인 없이도 emulator 검사를 할 수 있다. CODE LAB 원본이나 SDK가 없으면 명시적으로 실패하므로 공개 오프라인 runner와 분리했다.

## 운영 적용 전 안내와 적용 순서

**현재 운영에는 기존 취약한 규칙이 적용 중이며 이번 JS 수정도 운영에 배포하지 않았다. 아래 단계는 실행하지 않았다.**

1. CODE LAB 호환 패치와 신규 로그인 반 배정 변경을 승인한 후 소스 기준 해시와 현재 운영 규칙을 재확인한다. GitHub Pages API에서 두 프로젝트 모두 `main`의 루트(`/`)를 배포하는 legacy Pages임을 확인했다. CODE LAB main 푸시도 배포이므로 승인 전 수행하지 않는다.
2. CODE LAB 호환 패치를 먼저 반영한다. 기존 규칙에서도 동작하므로 호환 코드를 먼저 배포할 수 있다. 학생 생성의 반 정보는 관리자 연결이 저장하고, 신규 Google 계정은 반 배정을 기다린다. 새 script 캐시 버전의 배포 완료를 확인하고 기존 열린 화면을 새로고침한 뒤 규칙을 전환한다.
3. 검토용 `firebase.production-review.json`으로 **Firestore rules만** 적용한다. Storage는 변경이 없어 재배포하지 않는다. 문서·학생·역할 데이터 변경이나 마이그레이션은 하지 않는다. 운영 적용 직전 다시 알린다.
4. PDF LAB 웹/포터블 jsPDF 4.2.1 자산을 반영한다. 현재 main 푸시에는 Pages 자동 배포가 연결돼 있으므로 승인 없이 main 반영·푸시하지 않는다. 이후 실제 관리자/제한 강사/학생 로그인으로 읽기와 탐색을 확인한다. 운영에 쓰는 시험 데이터는 별도 허가가 있어야 한다.

실계정 로그인·실제 Auth 신규 가입·권한 오남용 과거 이력·외부 CODE LAB 전체 화면·실제 EXE 빌드/물리 인쇄는 확인하지 않았다. 이 저장소 밖의 동영상·상담 등 전체 포털 권한 정책을 새로 감사하거나 재설계한 작업은 아니다. 롤백이 필요하면 호환 코드를 유지하고 우선 규칙 차이를 검토한다. 취약한 구버전 규칙·라이브러리 복원을 정상 복구 절차로 자동 실행하지 않는다.
