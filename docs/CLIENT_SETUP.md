# Shared MCP and approval setup

Node 24 / pnpm 11.25 환경에서 실행한다. 발급받은 4개 API 키는 프로젝트 루트의 ignored `.env.local`에만 둔다. 실제 값을 앱 config/문서/채팅에 복사하지 않는다.

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm web:build
pnpm mcp:start
```

localhost `http://127.0.0.1:8787/`가 대시보드, `/mcp`가 두 앱의 공유 endpoint다. `stop` 입력 후 Enter로 종료하면 임시 DB도 정상 정리된다. demo는 종료 시 장부가 제거되고 동일 fixture로 재생성된다.

## 두 앱 HTTP 연결

프로젝트 `.mcp.json`(Claude Code)과 `.codex/config.toml`(Codex)이 같은 서버 이름/주소와 현재 도구 목록을 사용한다. 서버를 한 번만 켜고 프로젝트 신뢰·MCP 허용을 설정해 앱을 재로드한다. 각 앱에서 먼저 status/context를 요청한다. 6역할 skill은 `.agents/skills`와 `.claude/skills`, agent는 각 앱의 agents 폴더다.

`pnpm mcp:smoke`는 모델 호출 없이 SDK 클라이언트 두 개로 공유 DB를 검사한다. 클라이언트 이름 문자열은 실제 앱 로그인/추론 검증 증거가 아니다. `pnpm mcp:catalog`는 실행 서버의 JSON Schema를 `docs/MCP_CATALOG.json`에 기록한다.

서버가 켜진 상태에서 다른 터미널의 `pnpm mcp:doctor`로 연결을 자가진단한다. 두 프로젝트 설정의 단일 서버 주소·Codex 41개 allowlist, 설치된 CLI와 Codex의 현재 등록, 실행 MCP의 status/context/catalog와 회사 내 거래 최대 1건을 확인한다. 장부 생성·승인·전기·공공 API·모델 호출은 하지 않는다. 실제 앱의 추론 실행 여부는 항상 별도 미검증으로 기록한다. Codex 설정 확인에는 공식 읽기 명령 [`codex mcp get --json`](https://learn.chatgpt.com/docs/developer-commands)을 사용하며 인증 헤더 원문은 출력하지 않는다.

출력과 ignored `.ledgerflow/readiness/latest.json`에는 설정 여부·일치 여부와 안전한 결과만 남는다. 프로젝트 설정 또는 MCP 프로토콜 검사 실패 시 종료 코드는 1이다. CLI 설치나 외부 DB 설정이 없으면 수동 후속 항목으로 표시한다. 선택 `LEDGERFLOW_MCP_URL`은 localhost HTTP `/mcp` 주소만 허용하며 실제 서버 주소와 두 앱 설정을 함께 맞춰야 한다. 이 명령은 서버를 새로 실행하거나 `.env.local`의 인증키를 앱 설정으로 복사하지 않는다.

선택 `LEDGERFLOW_MCP_TOKEN`은 서버 측 bearer 설정이다. Codex에서는 공식 설정의 `bearer_token_env_var`에 클라이언트가 별도 환경에서 받은 token 변수명을 지정하고 Claude에서는 HTTP header의 환경변수 참조를 사용한다. 실제 token은 config에 쓰지 않는다. bearer 인증은 인간 승인 인증과 별개다. 현재 기본 config는 localhost 신뢰 개발 경계용이며 원격 OAuth 인증은 미구현이다.

[Codex MCP 설정](https://learn.chatgpt.com/docs/extend/mcp), [Claude Code 환경변수와 HTTP header](https://code.claude.com/docs/en/mcp)에 문법이 명시되어 있다. 클라이언트의 token 환경변수는 서버 `.env.local`을 읽어 가져오는 방식 대신 사용자가 각 앱의 실행 환경에 직접 제공한다.

서버를 나중에 켰는데 현재 채팅에 도구가 보이지 않으면 앱의 MCP 서버 설정에서 기존 `ledgerflow-accounting-mcp`를 다시 연결/Restart한 뒤 도구 노출을 확인한다. 이미 있는 서버를 추가로 만들지 않는다. 공식 OpenAI 문서의 desktop 설정은 Settings → MCP servers → Save/Restart 경로와 `/mcp` 연결 목록을 설명한다. 실제 메뉴가 보이지 않거나 이 채팅에 도구가 노출되지 않으면 앱 호출은 미확인으로 남긴다. CLI 설정/SDK 검사나 셸·DB 접근으로 실제 앱 호출을 대신했다고 보고하지 않는다. Claude 데스크톱의 설치 여부는 Claude Code 설치/도구 호출 증거와 구분한다.

## 독립 인간 승인

로컬 demo는 로그인 없이 전표 검토 후 승인·반려 버튼을 사용한다. 화면이 같은 출처의 브라우저 세션과 CSRF token을 자동 준비하며 세션 생성만으로 승인하거나 전기하지 않는다. 이 모드는 폐기 가능한 합성 DB와 동일 PC의 신뢰 경계에만 적용하며 사람의 신원을 암호학적으로 인증하지 않는다.

1. 앱에서 거래/증빙 조회 → `propose_journal_entry` → `validate_journal_entry` → `request_journal_approval`.
2. 사람이 화면에서 전표·근거·hash를 검토하고 승인/반려 버튼을 누른다.
3. 앱이 `get_approval_status`를 확인하고 `post_journal_entry` 호출.
4. `get_journal_entry`의 Posted와 `get_trial_balance`로 결과 확인.

demo MCP 신원은 fixture viewer에 accounting:write/close만 추가하며 인간 신원은 다른 preparer에 approve/close를 준다. MCP 신원은 ERP create 권한이 없어 `create_transaction`은 FORBIDDEN이다. 실제 postgres 환경에서 해당 ERP 권한을 부여한 preparer만 생성할 수 있다. 역할 prompt를 변경해 이 권한을 얻을 수 없다.

## 기존 PostgreSQL / Supabase

`LEDGERFLOW_MCP_MODE=postgres`, server-only `LEDGERFLOW_DATABASE_URL`, `LEDGERFLOW_USER_ID`, `LEDGERFLOW_COMPANY_ID`를 설정한다. 이 모드는 자동 migration·seed·권한 부여를 수행하지 않는다. 001~005 migration, 실제 Auth 사용자/membership/principal/scopes, 회사/계정/원천자료를 개발 프로젝트에서 준비해야 한다. 테스트용 auth-bootstrap과 seed UUID를 실제 Supabase Auth에 직접 적용하지 않는다.

기동 시 필요한 테이블·제한 RPC·현재 전표 컬럼을 읽기 전용으로 점검한다. 누락되면 `DATABASE_SCHEMA_INCOMPLETE`로 종료하고 DB를 자동 수정하지 않는다. 기존 DB 연결 모드는 독립 PostgreSQL 통합 테스트에서 동일 Draft/hash의 재기동 후 보존, 합성 1,001행의 비변경, 익명 승인 거절과 초기화 실패 시 연결 정리를 검증했다. 이는 실제 hosted Supabase 인증·Storage 검증과 구분한다.

postgres profile에서 `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`를 설정하면 외부에서 발급한 인간 JWT를 getUser로 검증한다. 앱 자체의 로그인 API·폼은 제공하지 않는다. 외부 인증 연동은 같은 출처의 `GET /api/human/session`에 Bearer JWT를 전달해 세션을 준비해야 하며, 익명 세션을 제공하지 않는다. DB Auth 사용자와 같은 신원이어야 한다. `accounting:approve`와 활성 membership이 필요하고 Draft 작성자와 달라야 한다. 이 publishable key는 서버 환경에 두며 service-role key는 필요하지 않다.

외부 JWT 세션을 Node/MCP 재기동 후에도 유지하려면 migration 006과 `LEDGERFLOW_HUMAN_SESSION_STORE=postgres`, 서버 전용 암호화 키를 선택한다. `pnpm session:key`는 ignored `.env.local`에 키를 출력 없이 생성/보존한다. 기본 demo/memory는 그대로이며, 선택 기능의 [구성과 보안 검증](SECURITY_SESSIONS.md)을 먼저 확인한다. 세션 복원 후에도 외부 JWT와 인간 승인 통제는 다시 검사한다.

Storage migration은 private `ledgerflow-evidence` bucket/RLS를 추가한다. 외부 인증으로 검증한 인간 JWT에 erp:read/write가 있을 때 화면에서 기존 합성 증빙 JSON을 보관한다. source_documents는 수정하지 않고 evidence_objects에 링크를 기록한다. 실제 클라우드 연결은 아직 미검증이다. 세부 조건은 [아키텍처](ARCHITECTURE.md)를 본다.

## 선택 stdio

default HTTP 공유 방식을 권장한다. stdio로 앱 하나가 프로세스를 소유해야 하는 경우 **같은 main entry 하나**를 직접 Node로 실행한다. pnpm wrapper의 출력이 stdio protocol에 섞이지 않도록 client command는 `node`, args는 아래로 구성한다.

```text
--import tsx <프로젝트 절대경로>/apps/mcp-server/src/main.ts --stdio
```

cwd는 프로젝트 루트로 설정한다. 같은 프로세스가 8787 HTTP 화면/MCP도 제공하므로 다른 앱은 같은 HTTP endpoint에 연결한다. `pnpm mcp:start`를 동시에 추가 실행하지 않는다. stdout는 MCP만, readiness는 stderr로 출력한다. 클라이언트가 stdin을 닫으면 종료한다. stdio/HTTP 공유 DB를 실제 SDK 통합 테스트로 확인한다.

## 운영 범위

현재는 loopback Node 서버다. 선택적 암호화 DB 세션은 구현했으며 외부 배포 전에 HTTPS/OAuth·실제 provider/서버 세션·Supabase 권한 검증이 필요하다. Cloudflare는 정적 Astro 출력만 적합성 검토했으며 이 Node/native DB backend를 Workers에 배포하지 않았다. [구현 결과](IMPLEMENTATION_STATUS.md)

`pnpm deploy:check`는 GitHub/Docker/DB 설정의 준비 여부와 담당자를 확인한다. 계정 로그인·프로젝트/저장소 선택·인간 결정은 [사용자 담당표](WORK_ASSIGNMENTS.md), Node 이미지/Compose/CI 실행은 [배포 문서](DEPLOYMENT.md)에 정리했다. Docker 실제 실행과 Linux CI 결과는 아직 확인하지 않았다.
