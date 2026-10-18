# AI가 수행할 학습 시작 설정

회계 자동화와 회계 흐름을 공부하는 한 사람의 환경을 현재 열린 폴더에 준비한다. Codex·Claude Code·Antigravity에서 파일 작업이 가능한 AI가 이 지침을 수행한다. 서버는 이미 실행 중이며 추가 서버·DB·모델 API·스케줄러를 설치하지 않는다.

## 1. 현재 앱과 CWD를 유지한다

공개 저장소 https://github.com/osh3772-star/ledgerflow-ai 의 main을 읽는다. checkout이 없으면 별도 캐시 위치에 소스를 내려받되 현재 앱의 열린 폴더는 바꾸지 않는다. 기존 checkout의 수정 사항을 강제 reset하지 않는다. 설치는 현재 폴더(CWD)를 대상으로 하며 소스 스크립트는 절대 경로로 실행한다. 사용하는 앱과 현재 폴더를 환경에서 확인한다. Node 24를 재사용하며 pnpm·DB 설치는 필요 없다.

```text
node <받아둔-저장소의-절대경로>/scripts/create-learning-workspace.ts --in-place --client codex
```

현재 앱에 따라 마지막 값은 codex, claude, antigravity 중 하나다. 앱을 추측해 세 앱 설정을 모두 변경하지 않는다. --directory를 생략하면 CWD에 설치한다. 기존 파일이 있다는 이유로 실패하지 않으며, 명시적으로 다른 경로를 선택할 때만 --directory를 사용한다.

## 2. 스크립트가 준비하는 것

- 기존 사용자 파일을 보존하며 .agents/skills의 6개 역할, CLAUDE.md·AGENTS.md·GEMINI.md의 관리 블록, docs/CLIENT_ROLES.md를 생성·병합한다. 수정된 기존 역할 파일은 보존하고 결과에 표시한다. 기존 역할 계약 문서가 다르면 덮어쓰지 않고 .ledgerflow/CLIENT_ROLES.md를 사용한다. 새 문서는 현재 대화에서 직접 읽는다. 앱의 다음 턴 자동 발견과 구분한다.
- 서버 POST /api/remote/guest에서 임시 회사와 합성 거래 1,000건을 발급받는다. 같은 bootstrap으로 재실행하면 같은 회사로 돌아간다. 키는 ignored .ledgerflow/guest-session.json에만 보관하고 출력·커밋하지 않는다. 서버의 공공 API 키나 .env.local은 읽지 않는다.
- 현재 앱의 활성 설정에 ledgerflow-accounting-mcp 하나를 등록한다. 다른 MCP 서버·프로젝트·개인 설정은 유지하며 변경 전 내용은 ignored .ledgerflow/install-backups에 보관한다. 잘못된 JSON, 해석하기 어려운 TOML, 심볼릭 링크 경로는 덮어쓰지 않는다.
- Codex: ~/.codex/config.toml 및 현재 .codex/config.toml의 해당 서버 테이블만 병합한다. http_headers_helper는 로컬 비공개 세션 파일을 읽는 작은 스크립트다. Claude Code: ~/.claude.json 및 .mcp.json에 같은 서버의 headersHelper를 병합한다. Antigravity: ~/.gemini/config/mcp_config.json에 serverUrl과 해당 세션의 Authorization 헤더를 병합한다. 공개 프로젝트 파일에는 원문 키를 넣지 않는다.
- Antigravity는 .agents/plugins/ledgerflow-learning에 공식 plugin.json, skills/의 6개 기존 스킬, rules/의 회계 통제를 준비한다. 플러그인 안에 MCP 설정을 중복 추가하지 않는다. 공식 workspace 플러그인 경로이며 실행 중 발견·활성화 여부는 실제 앱에서 별도로 확인한다.
- JSON-RPC initialize → tools/list → get_system_status → get_company_context를 실제 원격 MCP로 호출하고 결과의 회사가 발급된 회사와 같은지 확인한다. 이 검사에서는 분개·승인·전기를 하지 않는다.

공용 주소: https://ledgerflow-public-reference-gateway.eric5833.workers.dev/mcp

공개 서버는 Authorization 없는 initialize 요청에도 임시 회사를 자동 발급하고 Mcp-Session-Id로 연결한다. 세션 ID를 유지하지 않는 앱은 반드시 설치 스크립트가 발급한 Authorization 키를 사용한다. guest 헤더가 거절되면 Google 로그인으로 바꿔 잘못된 회사에 연결하지 말고 만료/등록 오류부터 확인한다.

## 3. 현재 앱에서 바로 연결을 확인한다

설정 후 현재 앱의 공식 MCP 갱신 기능이 있으면 사용하고 실제 도구 get_system_status → get_company_context를 순서대로 호출한다. CLI가 있으면 codex mcp list 또는 claude mcp list로 등록 상태를 점검할 수 있지만 목록 자체는 호출 성공의 증거가 아니다. 이미 등록된 다른 OAuth 자격증명이 helper보다 우선할 수 있으므로 반환된 companyId가 설치 결과와 같은지도 비교한다. 기존 OAuth 연결을 임의로 로그아웃하거나 다른 계정으로 바꾸지 않는다.

Google 로그인·MCP OAuth 동의·폴더 다시 열기를 학습 시작 필수 단계로 안내하지 않는다. 글로벌 설정 변경과 임시 Authorization 헤더 등록은 이 시작 요청의 허용 범위다. 사용자 키·브라우저 쿠키·Google 비밀번호를 요청하지 않는다.

앱 자체의 프로젝트 신뢰·도구 실행 권한·기업 정책은 우회하거나 임의로 허용 처리하지 않는다. 일부 앱은 실행 중 설정을 다시 읽지 못하므로 **모든 앱의 100% 무클릭·동일 턴 연결 성공은 보장할 수 없다**. 가능한 갱신을 먼저 시도하고 남은 앱 절차만 정확히 안내한다. 일반 웹 채팅은 로컬 설정에 접근하지 못할 수 있다.

공식 근거: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Codex header helper](https://learn.chatgpt.com/docs/config-file/config-reference), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Antigravity MCP](https://antigravity.google/docs/mcp), [Antigravity 플러그인](https://antigravity.google/docs/plugins).

## 4. 회계 작업과 직접 승인은 분리한다

회계 작업 전에 역할 계약과 해당 스킬만 읽는다. request_journal_approval의 approvalUrl은 사람이 직접 열어 해당 전표를 확인하고 승인/반려하는 화면이다. 링크를 열기만 해서는 승인되지 않는다. AI는 링크 교환 API·브라우저 승인·SQL·사용자 쿠키를 이용해 자신이 만든 전표를 승인하지 않는다. 링크는 임시 학습용 권한이며 실명 확인을 대체하지 않는다.

승인 후 사용자가 장부 반영을 요청하면 도구로 승인/hash를 재확인하고 Posted일 때만 완료를 보고한다. 보관하려는 경우에만 승인 화면에서 Google을 연결한다. 이때 기존 계정 장부가 있으면 자동 병합하지 않는다. 보관 후 AI 앱은 Google 개인 장부 OAuth로 연결을 전환한다.

## 5. 완료 보고

짧게 설정 준비, MCP 프로토콜 두 도구 호출, 현재 앱의 두 도구 호출을 각각 성공/미확인으로 보고한다. 회사·도구 수·만료 시각은 실제 반환값으로 확인한다. 설정·SDK/HTTP 검사만 성공했는데 현재 앱 연결까지 성공했다고 쓰지 않는다. 역할 6개 파일 준비와 실제 사용 역할도 구분한다. 마지막에 docs/learning-start.json의 firstRequest를 보여준다. 설치 단계에서 거래·분개·승인·전기는 실행하지 않는다.
