# 보안 수정·검증 현황

## 2026-10-28 초기화 문서 조회 호환 수정

현재 운영 Firestore 규칙은 2026-10-22에 갱신됐으며 `portalContent/*`는 활성 전체 관리자(`role: admin`, `adminScope: all`)만 읽을 수 있다. PDF LAB이 담당 관리자에게도 `portalContent/exam-state`를 요청해 발생하던 권한 오류를 호출 조건에서 수정했다. 전체 관리자의 기존 초기화 동작은 유지하고, 응답 도중 계정·역할·관리 범위가 바뀌면 결과를 적용하지 않는다. 서버 규칙·프로필·운영 문서는 변경하지 않는다.

`node tests/exam_reset_access.test.cjs`는 담당 관리자·학생·비활성 계정의 조회 생략, 전체 관리자 호환성, 로그아웃·권한 회수 중 늦은 응답, 예기치 않은 서버 거부의 전파를 검사한다. 이전 커밋에서 실패하고 수정 후 통과하는 것을 확인했다. 로컬 실제 로그인에서는 반 목록 조회를 유지하며 해당 권한 경고가 사라졌다.

주의: 아래 `firestore.rules`, `deployed-20261020/` 및 10월 20일 검증 기록은 당시의 이력이다. 현재 운영 규칙을 덮어쓰는 배포 원본으로 사용하지 않는다. 이번 수정은 Firestore/Storage 규칙 재배포를 포함하지 않는다.

## 2026-10-20 이력

최신 결과는 [HARDENING_20261020.md](HARDENING_20261020.md)에 있다.

- jsPDF 두 vendor를 4.2.1로 교체했고, 확인했던 advisory 12건은 정확 버전 재검사에서 해소됐다.
- Firebase 규칙은 67개 인가 검사와 실제 SDK/앱 저장 흐름 통과 후 사용자 승인에 따라 운영에 적용했다. 적용 소스 일치·비로그인 읽기 거부·Storage 규칙 불변을 확인했다.
- CODE LAB 호환 패치는 main `b4e7ed9`로 먼저 배포하고 운영 소스 일치를 확인했다. 배포한 Firestore 규칙도 CODE LAB `db63b2b`에 보존했다.
- PDF LAB의 웹/포터블 수정도 main Pages 배포와 운영 PDF/ZIP 출력 검증을 완료했다. Auth 승인 목록에 실제 운영 호스트를 추가해 사용자 로그인 성공과 관리자 읽기도 확인했다. 운영 문서 데이터는 변경하지 않았다.

파일:

- `firestore.rules`: 운영 적용 검토용 수정안
- `storage.rules`: 기존 Storage 규칙, 검증만 수행
- `firebase.emulators.json`: demo 프로젝트 에뮬레이터 전용
- `firebase.production-review.json`: Firestore 규칙만 포함한 운영 검토 설정. 실행 전 승인 필요
- `code-lab-compat.patch`, `code-lab-compat-base.json`: CODE LAB 호환 패치와 기준 파일 해시
- `dependencies.json`, `jspdf-package-integrity.json`: 실제 버전·해시·npm 원본 무결성
- `deployed-20261020/`: 읽기 전용으로 보존한 기존 운영 규칙
- [이전 17~20 검토 기록](REVIEW_17_20_20261020.md): 후속 수정 전의 역사적 판정

공개 검사: `node tests/run_checks.cjs`. Firebase 검사 준비·실행 명령과 운영 반영 순서는 최신 결과 문서를 따른다.
