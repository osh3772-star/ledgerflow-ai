# GitHub 실행 검증

2026-10-16 KST. [공개 저장소](https://github.com/osh3772-star/ledgerflow-ai)의 실제 GitHub Actions 실행을 로컬 테스트 및 실제 앱 수용 테스트와 구분해 기록한다.

## 최신 실행: 로컬 포트폴리오 실행판

- 검증 소스: `1b944ef5733a0808f02eea8acadb018034f58fa5`
- 실행: [LedgerFlow checks](https://github.com/osh3772-star/ledgerflow-ai/actions/runs/38849513756), 전체 성공.
- Windows/Linux: 각각 211/211 tests, 30/30 files와 타입 검사·합성 평가·Astro build 통과. 테스트 본문은 91.89초/56.75초였다.
- Linux container: 실제 Docker build와 이미지 내부 `passed: true`, `toolCount: 41`, 회사 범위 1건 조회, `nonRoot: true` 확인.
- 이미지 smoke의 장부 변경·공공 API·유료 모델 API 호출은 0, 실제 앱 추론·외부 Supabase 검증은 false다.

아래 192개 기록은 이전 소스의 이력을 보존한다. 최신 CI 성공도 실제 공공 API 실조회나 hosted Supabase 연결 성공을 뜻하지 않는다.

## 이전 실행: 초기 공개 기준

- 검증 대상 소스: `7b3b4baf0bee588685afe2a513dcc8de4495d986`
- 실행: [LedgerFlow checks #3](https://github.com/osh3772-star/ledgerflow-ai/actions/runs/38819739533)
- 결과: 전체 성공. Windows/Linux check와 Linux container 세 작업이 모두 완료됐다.

| 작업 | 확인 범위 | 결과 |
| --- | --- | --- |
| Windows check | 타입 검사, 전체 PostgreSQL/단위 테스트, 합성 평가, Astro build | 192/192 tests, 26/26 files 통과; job 7분 11초 |
| Ubuntu 24.04 check | 같은 타입 검사·테스트·평가·build | 통과, 1분 25초 |
| Linux container | 실제 Docker build와 일반 사용자 이미지 내부 foreground MCP smoke | 통과, 34초 |

테스트 본문 시간은 Windows 393.75초, Ubuntu 62.33초였다. Ubuntu도 192/192 tests, 26/26 files가 통과했으며 건너뛴 테스트는 없다. 이 시간은 CI 환경의 전체 회귀 검사 소요이며 실제 거래 처리량이 아니다.

컨테이너의 실제 출력은 `passed: true`, `toolCount: 41`, `companyScopeVerified: true`, `transactionRowsRead: 1`, `nonRoot: true`다. 장부 변경·공공 API·유료 모델 API 호출은 모두 0이며 앱 추론·외부 Supabase 검증은 각각 false로 남았다. 이미지 공개나 서버 배포는 수행하지 않았다.

## Windows 문제와 수정

[최초 실행](https://github.com/osh3772-star/ledgerflow-ai/actions/runs/38819015603)의 Windows 작업은 `initdb`가 이미 만든 임시 디렉터리의 권한을 바꾸지 못해 실패했다. `.ledgerflow/tmp`에 실행 사용자 SID의 상속 권한을 명시한 [다음 실행](https://github.com/osh3772-star/ledgerflow-ai/actions/runs/38819311906)에서는 초기화 단계를 지났으나 서버 기동이 실패했다. Linux check는 두 실행 모두 통과했다.

Windows에서는 관리 권한을 내리는 PostgreSQL 프로세스와 기본 디렉터리 소유권의 조합이 문제를 일으킬 수 있다. [PostgreSQL 개발 기록](https://www.postgresql.org/message-id/20240707064046.blgjxoqiywunbebl@awork3.anarazel.de)과 [Microsoft icacls 명세](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)를 확인하고 CI 임시 데이터 경로에만 사용자 권한을 추가했다.

또한 고정 버전 라이브러리는 `postgres.exe`를 직접 실행한다. 이 구조와 Windows CI의 관리 계정 때문에 실패할 가능성을 확인해, Windows의 폐기형 DB 기동·종료를 같은 패키지에 포함된 `pg_ctl`로 변경했다. `pg_ctl`은 [Windows 제한 토큰 기동](https://doxygen.postgresql.org/pg__ctl_8c_source.html)을 제공한다. 이 변경 후 위 재실행에서 Windows의 192개 테스트가 통과했다.

`pg_ctl`의 기동·종료 대기에는 제한 시간을 두고, 실패 후 정리도 해당 테스트가 소유한 PID 파일·디렉터리에 한정한다. 마이그레이션·회계 검증·테스트 assertion·인간 승인 조건은 바꾸지 않았다. 로컬에서 Windows CI의 ACL 변경을 실행하거나 계정을 추가하지 않았다.

## 증거의 범위

CI는 키 없는 mock과 테스트 소유 합성 DB를 사용한다. Docker smoke는 health → SDK status/context → 도구 목록 → 회사 내 최대 1건 조회를 확인한다. 실제 Claude Code/Codex 앱 추론, hosted Supabase Auth/Storage, 인간 승인, 원격 OAuth/HTTPS 또는 Cloudflare 배포의 성공 증거는 아니다.

실행 결과를 기록하는 문서만 변경하는 후속 커밋은 검증 대상 소스를 바꾸지 않는다. 해당 문서 커밋은 중복 회귀 실행을 줄이기 위해 GitHub의 [문서화된 skip 지시](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)를 사용하며, 이후 코드 변경에는 일반 CI를 실행한다.
