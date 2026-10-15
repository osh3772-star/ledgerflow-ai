# 사용자와 Codex의 남은 작업

2026-10-16. 단일 foreground MCP·앱 주도 추론·로그인 없는 폐기형 로컬 demo를 유지한다. 계정 로그인과 인간 장부 결정은 사용자가 수행하고, 소스 구현·연결·검증·배포 준비는 Codex가 수행한다. 두 앱이 담당하는 6개 회계 역할은 병렬 실행 지시가 아니다.

| 작업 | 사용자가 할 일 | Codex가 할 일 | 현재 상태 |
| --- | --- | --- | --- |
| 실제 두 앱 수용 테스트 | Claude Code 설치/로그인, 두 앱 프로젝트 신뢰·MCP 허용·재로드 | 동일 endpoint/역할 설정 관리, 도구 실행 결과와 공유 전표 흐름 검증 | Codex CLI 등록/SDK 검증 완료; 실제 앱 추론 미검증 |
| 전표 승인 | 화면에서 전표·증빙·version/hash를 검토하고 승인 또는 반려 | 승인 요청 생성·검증, 사용자 결정 후 MCP로 상태 확인·전기·시산표 검증 | 개발 테스트 완료; 실제 사용자의 승인은 대신 수행하지 않음 |
| Supabase | 기존 `회계자동화` 프로젝트의 연결값을 `.env.local`에 직접 입력, 테스트 Auth 사용자 준비 | migration/회사·principal·scope 준비 지원, Auth/Storage/RLS·재연결 테스트 | 기존 프로젝트 재사용 결정; 연결 코드와 로컬 DB 검증 완료, hosted 연결 미설정 |
| GitHub | 저장소 생성·CLI 인증 완료, 추가 입력 없음 | 공개 파일/키 검사, push와 CI 실행 결과 확인 완료 | [공개 저장소](https://github.com/osh3772-star/ledgerflow-ai)에 업로드, Windows/Linux CI 통과 |
| Docker | 로컬 설치 생략, 추가 설치 없음 | GitHub Linux CI 이미지 build·일반 사용자 foreground smoke 검증 완료 | 실제 Docker/CI 통과; Desktop·Compose 실행은 별도 미검증 |
| 원격 배포 | 필요할 때 계정·도메인·비용 한도와 대상 선택 | HTTPS·클라이언트별 OAuth·영속 세션·배포/회귀 테스트 구현 | 선택적 암호화 PostgreSQL 세션 구현; OAuth/HTTPS·실제 provider/배포 검증 남음 |
| 전문 회계 확장 | 실제 사용/전문가 검토가 필요한 범위 결정 | 결정된 범위의 세금·현금흐름표·주석 등 구현/검증 | 포트폴리오의 현재 제한 범위 밖 |

## 지금 사용자가 준비할 최소 항목

1. GitHub 저장소 생성·CLI 인증·코드 업로드·Windows/Linux CI·이미지 smoke 검증은 완료했다. [실행 결과](CI_VALIDATION.md). 사용자가 다시 로그인하거나 토큰을 전달할 필요는 없다.
2. Supabase 실검증에는 기존 `회계자동화` 프로젝트의 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `LEDGERFLOW_DATABASE_URL`을 ignored `.env.local`에 직접 입력한다. 프로젝트 설정 후 테스트용 Auth 사용자를 준비한다. 실제 사용자 UUID와 회사 UUID가 준비된 다음 `LEDGERFLOW_USER_ID`/`LEDGERFLOW_COMPANY_ID`를 설정한다. 존재하지 않는 UUID나 테스트 fixture의 Auth UUID를 그대로 적용하지 않는다.
3. 실제 두 앱의 수용 테스트는 앱 로그인·프로젝트 허용·재로드 후 진행한다. 전표 승인 단계만 사용자가 화면에서 직접 결정한다.

위 항목을 기다리는 동안 로컬 개발·문서·테스트는 계속할 수 있다. 기존 4개 공공 API 키를 다시 발급받거나 전송할 필요는 없다. Docker 설치와 유료 배포는 로컬 포트폴리오 실행의 필수 조건이 아니다.

## 이번에 Codex가 시작한 단위

- `pnpm deploy:check`: 장부/외부 API 호출 없이 도구·로그인·프로젝트 설정의 준비 여부와 담당자를 출력한다. ignored `.ledgerflow/deployment/latest.json`에 저장한다.
- Node 일반 사용자 이미지, 직접 Node 기동과 health check, 단일 Compose 서비스.
- Windows/Linux 회귀 CI와 Linux 컨테이너 foreground MCP smoke 단계.
- [배포 실행 방법과 검증 경계](DEPLOYMENT.md), [현재 검증 결과](IMPLEMENTATION_STATUS.md).
- [Aside에 하나씩 붙여 넣는 명령](ASIDE_TASKS.md): 완료된 GitHub 준비, 기존 Supabase/앱/승인 검토/Linux CI 확인. 실제 승인은 사용자만 수행한다.
- [외부 JWT 세션의 PostgreSQL 저장](SECURITY_SESSIONS.md): 006 migration·암호화·회사 격리·재기동/만료/JWT 재검증, 기존 demo 유지.

`deploy:check`의 준비 통과는 로컬 설정/기존 build 확인일 뿐이다. 실제 앱 추론·사용자 승인·Docker 이미지·Supabase·원격 배포는 각각 별도 증거가 필요하다. source에서 `container:smoke`를 실행한 결과를 Docker 이미지 실행 결과로 바꾸지 않는다.

이 로컬 명령은 GitHub CLI 인증만 검사한다. Codex의 연결된 GitHub 앱 인증을 검사하지 않으므로 CLI의 `needed`만 보고 앱도 미연결이라고 판단하지 않는다.
