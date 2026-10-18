# AI가 수행할 학습 시작 설정

목표는 회계 자동화와 회계 흐름을 공부하려는 한 사람의 학습 환경 준비다. 이 문서는 시작 요청문을 받은 **Codex 또는 Claude Code가 읽는 실행 지침**이다. 사람에게 아래 명령과 파일 경로를 일일이 입력하게 하지 않는다.

## 1. 현재 앱과 작업 공간 확인

- 현재 사용 중인 Codex 또는 Claude Code 하나를 사용한다. 모델 API 키·다른 AI 앱·DB·서버·스케줄러는 추가하지 않는다.
- 공개 저장소 `https://github.com/osh3772-star/ledgerflow-ai`의 현재 `main`을 읽는다. 기존 checkout이면 먼저 변경 여부를 확인하고 강제 reset·덮어쓰기를 하지 않는다. 없으면 AI가 접근할 수 있는 작업 위치에 저장소를 받는다. Git이 없으면 GitHub 소스 ZIP을 내려받아 안전한 폴더에 푼다.
- 현재 앱에서 파일 작업이나 설정 변경을 할 수 없다면 그 상태를 명확히 알린다. 일반 웹 대화만으로 설치됐다고 보고하지 않는다. 앱 설치가 필요한 경우 공식 시작 안내를 한 번에 하나씩 제시한다.

## 2. 별도 학습 폴더 준비

저장소에는 서버·DB를 설치하지 않고 연결·역할 파일만 준비하는 `scripts/create-learning-workspace.ts`가 있다. 앱이 사용하는 기존 Node 24 런타임이 있으면 재사용한다. 명령은 AI가 실행한다.

```text
node scripts/create-learning-workspace.ts --directory <별도의-절대-학습-폴더-경로>
```

- 이 스크립트는 외부 패키지를 설치하거나 서버를 켜지 않는다. `.env.local`·토큰·키·DB를 읽지 않는다.
- 공용 원격 MCP 설정 하나, 양 앱의 기존 6역할 skill·agent 파일, 회계 업무 지침을 준비한다. 글로벌 앱 설정과 원래 저장소의 localhost 설정은 바꾸지 않는다.
- 이미 같은 파일이 있는 학습 폴더는 재사용하고, 출처 표시가 없거나 수정된 폴더는 덮어쓰지 않는다. 충돌 시 다른 빈 학습 폴더를 선택해 원래 파일을 보존한다.
- Node 런타임이 없어도 Node/DB 설치를 학습 준비 조건으로 만들지 않는다. AI의 파일 도구로 아래 allowlist 파일을 별도 학습 폴더에 복사하고 두 연결 설정의 URL만 공용 주소로 지정할 수 있다. 기존 파일을 덮어쓰지 않고 내용과 폴더를 검토한다. 자동 도구로 가능한 작업이 없다면 ‘준비 미완료’로 보고한다.

allowlist: `.agents/skills/ledgerflow-<role>/SKILL.md`, `.claude/skills/ledgerflow-<role>/SKILL.md`, `.claude/agents/ledgerflow-<role>.md`, `.codex/agents/ledgerflow-<role>.toml`, `docs/CLIENT_ROLES.md`. 역할은 `supervisor`, `sales`, `purchase`, `treasury`, `closing`, `audit`다. 이 파일 복사는 역할 지침을 재사용하는 것이며 새로운 역할이나 추가 MCP 서버를 만드는 것이 아니다.

수동 파일 도구 경로에서는 스크립트의 AGENTS.md·CLAUDE.md와 같은 안전 규칙을 학습 폴더에 기록한다. 금액은 도구에 맡기고, 직접 승인 금지·Task/Result 계약·공공자료와 합성 거래 구분·Posted 확인·위임 요청 없는 하위 에이전트 금지를 보존한다.

공용 endpoint: `https://ledgerflow-public-reference-gateway.eric5833.workers.dev/mcp`
서버 이름: `ledgerflow-accounting-mcp`

Codex: `.codex/config.toml`의 기존 단일 MCP table과 41개 도구 allowlist를 사용하되 URL을 공용 주소로 지정한다. Claude Code: `.mcp.json`의 HTTP 서버 하나에 공용 주소를 지정한다. `command`, API key, bearer token, DB URL은 클라이언트 설정에 넣지 않는다.

## 3. 사람이 해야 하는 화면만 한 번에 하나씩 안내

1. 현재 앱에서 학습 폴더를 열고 프로젝트·MCP 연결 신뢰를 확인한다. 현재 채팅에서 새 설정을 못 읽으면 필요한 재시작·새 연결 읽기 화면만 안내한다. 기존 다른 프로젝트나 동일 서버의 다른 scope를 삭제하지 않는다. 프로젝트 설정이 실제로 선택됐는지 확인한다.
2. 공개 사이트 `https://ledgerflow-public-reference-gateway.eric5833.workers.dev/`에서 본인이 Google 로그인한다. 비밀번호·인증 코드·쿠키·access/refresh token을 요청·수집·출력하지 않는다.
3. 앱의 공식 MCP 인증 절차를 열어 같은 Google 계정으로 **내 장부 연결 허용**을 직접 누르게 한다. Codex CLI를 쓸 수 있으면 학습 폴더에서 `codex mcp login ledgerflow-accounting-mcp`; Claude Code는 `/mcp`의 Authenticate를 사용한다. CLI를 못 찾으면 앱의 연결·로그인 화면을 사용한다. 사용자의 로그인·동의를 대신 실행하거나 승인된 것으로 추정하지 않는다.

공식 근거: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Claude Code MCP](https://code.claude.com/docs/en/mcp).

## 4. 실제 연결 확인과 완료 보고

학습 폴더의 역할 지침을 읽고 **실제 MCP 도구** `get_system_status` → `get_company_context`를 순서대로 호출한다. 설정 파일 읽기, URL 응답, CLI 목록, SDK 테스트는 현재 앱 호출 성공의 대체 증거가 아니다. 회계 업무는 도구로만 수행하며 SQL·셸·DB 직접 접근으로 우회하지 않는다.

사람에게는 짧게 다음을 알려준다.

- 설정 준비: 완료/미완료, 사용 중인 학습 폴더와 앱.
- Google 로그인·연결 허용: 확인됨/대기/미확인. 비밀값 없이 보고한다.
- 실제 연결: 두 도구의 성공 여부, 회사 이름, 현재 도구 수. 실제 회사나 거래 수는 반환값으로 확인된 경우에만 보고한다.
- 역할 준비: 실제 파일 6개 역할 준비 여부와 현재 앱에서 발견·사용 여부를 구분한다. 여섯 AI 동시 실행을 주장하지 않는다.
- 다음 학습: `docs/learning-start.json`의 `firstRequest`를 그대로 보여준다. 이번 설치에서 거래·분개·승인·장부 반영은 실행하지 않는다.

로그인·연결 허용을 기다리면 ‘로그인 대기’, 설정만 준비되면 ‘설정 준비됨’, **두 도구가 성공한 경우에만** ‘실제 연결 확인됨’으로 보고한다. 유료 서비스·청구 계정 등록은 하지 않는다.
