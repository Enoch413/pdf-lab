# 한부장 호환성 Git 보관 범위

독립 검토 판정은 `PDF_LAB_HANBUJANG_COMPAT_LOCAL_REVIEW_PASSED`다. 기준본은 `PDF_LAB_HANBUJANG_COMPAT_R1_FINAL_REVIEW.zip`, SHA-256은 `8ae832a21f0c5b6bf7d35f5448351b5e7cd0966ece18c2f2299688c1f8694376`다.

이번 Git 보관 시 앱 실행 소스 5개와 관련 테스트·문서를 기준 ZIP과 대조했다. 실행 소스는 동일하며, Git 보관 안내 문서만 추가했다. 기존 최종 검사 8개와 세 화면 PDF 검증의 PASS 결과를 재사용한다. 검사 원본 결과·로그·PDF·PNG·검토 ZIP은 로컬에 보존한다.

작업 파일의 실행 소스 SHA-256은 최종 검사 기록과 일치한다. 기존 `core.autocrlf=true` 설정에 따라 Git index에서 일부 파일의 CRLF가 LF로 변환되며, LF 기준 바이트 대조로 모든 검토 파일이 일치함을 확인했다. 줄바꿈 설정과 실행 로직은 변경하지 않았다.

## 공개 저장소에 포함하는 자료

canonical 입력·저장·편집·작업 복원·세 화면 출력 코드, R1 삽입 위치 번호 처리, R2 sourceId 기준 그룹 분리, R3 canonical OCR 정답 보정 제외, 회귀 검사 코드, 스키마·필드 의미, legacy/canonical 안내, 합성 7문항 및 합성 R1 파생 입력을 포함한다.

## 로컬에만 보존하는 자료

- 실제 191문항 fixture `tests/fixtures/hanbujang/P05_CANONICAL_ACTUAL.json`은 공개하지 않는다. 원본 PDF·사용자 DB·개인정보·백업·인증정보·운영 설정·임시 산출물도 포함하지 않는다.
- `docs/hanbujang-contract/PROBLEM_TYPE_RULES.md` 전체는 private reader 관련 설명의 공개 범위가 불명확하므로 로컬 계약 원본으로 보존한다. 공개 유형 목록은 `CANONICAL_SCHEMA.json`과 앱 코드에 있다. 공개하지 않은 계약 파일을 앱이 실행 시 읽지는 않는다.
- 7개 외부 스킬은 수정·설치·커밋 대상이 아니다.

## 검사의 재현

Playwright가 이미 설치된 Node 환경에서 실행한다. 프로젝트 별도 manifest·lockfile·필수 CI 검사는 없으며 의존성을 새로 설치하지 않았다. 필요한 경우 `PDFLAB_NODE_MODULES`에 기존 Playwright 설치 디렉터리를 지정한다.

```text
node tests/hanbujang_r1_bare_browser.cjs
node tests/run_hanbujang_review.cjs --r1-final
python tests/hanbujang_r1_bare_pdf_check.py
python tests/hanbujang_review_pdf_check.py
```

첫 검사는 공개 합성 fixture만으로 실행할 수 있다. 전체 검토 runner와 일부 회귀 검사는 로컬 P05 fixture가 필요하며, 파일이 없으면 실패한다. 검사를 건너뛰어 PASS로 처리하지 않는다. P05를 재현하려면 권한 있는 검토 기준 ZIP에서 해당 파일을 로컬 경로에 준비한다. 최종 검토에 사용한 P05 SHA-256은 `295ab699dc4359e06e37f442e0e4cb39dd206cec92d81245be1d7a52a8dc4e06`다.

Firebase 검증은 외부 요청을 차단한 메모리 SDK와 격리된 브라우저/시험 폴더를 사용했다. 운영 Firebase 권한·rules·쿼터, 실제 사용자 브라우저 복원, 강사 PC, 물리 프린터, 원본 PDF와 추출 의미의 일치 여부는 검증하지 않았다.

## 배포 경계

GitHub API 확인 시 GitHub Pages는 legacy 방식으로 `main`의 `/`를 배포하며, 실행 중인 workflow는 `pages-build-deployment`뿐이다. 현재 운영 기준 커밋은 `44c446ac6cebc36e430e2371c9a47dbfbb356cce`다. Git 보관은 `codex/hanbujang-canonical-16` 작업 브랜치를 대상으로 하며 운영 브랜치 병합·푸시·수동 배포는 범위에 없다. 보호 규칙과 배포 설정은 변경하지 않는다.
