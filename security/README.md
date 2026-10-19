# 보안 수정·검증 현황

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
