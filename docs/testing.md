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

17~20번 이후 보안 검증은 security/README.md와 security/HARDENING_20261020.md를 따른다. 공개 runner는 vendor 해시·CDN SRI·범위별 users 쿼리·대량 batch·공통 답안 파서·공통 화면 메뉴·실제 jsPDF 출력 검사까지 포함한다(12개 Node suite + 5개 Python test). Firebase 인가와 실제 SDK/앱 저장 흐름은 demo 프로젝트의 Firestore/Storage emulator에서 별도로 실행하며, 격리된 테스트 SDK와 CODE LAB 소스가 필요하다. 운영 규칙 적용 결과와 검증 범위는 security/HARDENING_20261020.md의 운영 검증 기록을 확인한다. UI 통일 및 추가 검증은 docs/ui-unification.md에 기록한다.
