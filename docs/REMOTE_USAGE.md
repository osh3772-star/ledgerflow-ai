# 설치 없이 사용하는 원격 장부

2026-10-17. **원격 코드와 PostgreSQL 통합 검증은 준비했지만, 공개 운영 활성화는 Supabase DB 인증 오류로 보류 중이다.** 사이트의 /api/remote/config가 available:true일 때 실제 회계 흐름을 시작한다. false이면 공통 샘플 조회만 가능하다.

사이트: https://ledgerflow-public-reference-gateway.eric5833.workers.dev/

MCP: https://ledgerflow-public-reference-gateway.eric5833.workers.dev/mcp

## 방문자의 사용 순서

1. 사이트 상단에서 회원가입 → 확인 이메일 링크로 인증 → 로그인한다.
2. **AI 연결·계정 관리**에서 MCP 주소를 복사해 사용하는 앱의 원격 HTTP MCP 설정에 추가한다.
3. 앱이 연 브라우저에서 같은 계정으로 로그인하고 **내 장부 연결 허용**을 누른다.
4. 앱에 아래 요청문을 보낸다. Git·Node.js·DB·공공 API 키 설치는 필요 없다. 사용하는 AI 앱과 본인 이용 계정은 필요하며, 사이트가 앱 설정을 자동 변경하지는 않는다.
5. 사이트에서 **새로고침 → 사용자 승인 → 전표 보기**를 열고 직접 검토·승인한다.
6. 같은 앱 대화에서 승인된 전표의 장부 반영을 요청하고 시산표를 조회한다.

Codex CLI를 이미 사용하는 사람:

    codex mcp add ledgerflow-accounting-mcp --url https://ledgerflow-public-reference-gateway.eric5833.workers.dev/mcp
    codex mcp login ledgerflow-accounting-mcp

Codex 앱에서는 MCP 서버 설정에 같은 HTTP URL을 추가하고 OAuth 로그인한다. 제품 버전·관리자 정책에 따라 설정 화면이 다를 수 있다. [공식 OpenAI 문서](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

Claude Code를 이미 사용하는 사람:

    claude mcp add --transport http ledgerflow-accounting-mcp https://ledgerflow-public-reference-gateway.eric5833.workers.dev/mcp

이후 /mcp에서 인증한다. Claude 웹·데스크톱은 원격 사용자 지정 커넥터를 지원하는 계정에서 같은 URL을 추가한다. 앱/요금제별 지원을 일괄 보장하지 않는다. [공식 Claude Code 문서](https://code.claude.com/docs/en/mcp)

같은 이름의 로컬 서버가 이미 등록돼 있다면 해당 앱 설정의 URL을 원격 주소로 교체한다. 별도 MCP 서버 항목을 중복 추가하지 않는다. 저장소를 연 개발자의 프로젝트 설정은 localhost를 우선할 수 있으므로 실제 연결 URL을 확인한다.

첫 요청:

> 연결된 MCP의 get_system_status와 get_company_context를 먼저 호출해 줘. 매출 역할로 2026년 1월 미처리 매출 한 건의 증빙과 공공자료를 확인하고 분개 초안 → 검증 → 승인 요청까지 준비해 줘. 전표 ID·버전·hash, 차변·대변 합계, 근거와 불확실성을 설명하고 사용자 웹 승인 대기에서 멈춰 줘. 직접 승인하지 마.

직접 웹 승인한 뒤:

> 방금 내가 사이트에서 승인한 전표의 승인 상태·버전·hash를 다시 확인하고 장부에 반영해 줘. DB가 Posted를 반환한 경우에만 완료로 보고하고 2026년 1월 시산표와 재무제표를 보여 줘.

다른 PC에서도 같은 계정으로 로그인하면 **내 장부**를 이어 본다. 다른 계정의 회사·거래·초안·승인·원장은 분리된다. 로그인 전 공개 샘플은 공통 조회 자료이며 개인 장부와 동기화하지 않는다.

## 여섯 역할

동일한 MCP 서버의 초기 instructions와 prompts/list, prompts/get으로 총괄·매출·매입·자금·결산·감사 지침을 제공한다. 기존 도구 41개와 로컬 agent/skill 파일은 유지한다.

MCP 연결이 앱에 native agent·skill 파일을 자동 설치하거나 독립 에이전트 6개를 자동 실행하지는 않는다. 필요한 역할만 현재 앱 대화에서 적용하고, 명시적인 사용자 요청이 있을 때만 위임/병렬 기능을 사용한다. 프롬프트 UI가 없는 앱도 서버 지침과 위 요청문을 이용할 수 있다.

## 운영자만 준비할 사항

1. ignored .env.local의 Supabase URL·publishable key·유효한 DB URL·CA 파일 경로·공공 API 키 4개를 확인한다.
2. Supabase Auth의 Email provider·회원가입·이메일 확인을 활성화한다. URL Configuration의 Site URL과 Redirect URLs에 공개 사이트의 정확한 HTTPS 주소를 등록한다. [이메일 인증](https://supabase.com/docs/guides/auth/passwords), [redirect 허용 목록](https://supabase.com/docs/guides/auth/redirect-urls)
3. 일반 방문자에게 인증 이메일을 보낼 수 있는 SMTP 구성을 확인한다. 기본 메일 서비스에는 수신자·발송량 제한이 있다. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
4. Cloudflare 로그인 상태에서 pnpm check 후 pnpm remote:deploy를 실행한다.

remote:deploy는 웹 build·공개 snapshot·키 노출 검사 후 실제 DB TLS/Auth 연결을 확인한다. 최초 빈 DB에는 기존 001~006 migration을 manifest 검증 방식으로 적용하고, 007은 별도 hash receipt로 원자적 upgrade한다. 기존 설치/receipt 불일치는 초기화하지 않고 중단한다. Auth 사용자를 SQL로 만들어 넣지 않는다.

DB 정보·공개 CA·Supabase 설정·32바이트 세션 암호화 키는 **Cloudflare secrets**로 등록한다. 비밀값은 CLI 인자·Git·웹 자산에 넣지 않는다. 암호화 키는 ignored .env.local에 보관한다.

pnpm site:deploy는 **공개 미리보기 전용**으로 원격 기능을 끈다. 실제 원격 장부 갱신은 pnpm remote:deploy를 사용한다. DB 인증 실패 시 원격 secrets 업로드·활성화 전에 중단한다.

활성화 후 실제 이메일 인증/로그인, 서로 다른 실제 계정 격리, Codex·Claude OAuth와 status/context 호출, 사용자의 직접 웹 승인 후 Posted를 확인해야 한다. 테스트용 Auth와 SDK 성공은 실제 앱 검증을 대신하지 않는다.

## 구조와 보안 경계

- 기존 MCP 팩토리·공통 ERP/AccountingService·Decimal 엔진을 Cloudflare fetch transport에 재사용한다. 별도 MCP 제품·LLM API·오케스트레이터·스케줄러를 추가하지 않는다. Node 로컬 HTTP/stdio도 보존한다.
- Worker는 native PostgreSQL을 기동하지 않고 pg 8.23.1로 외부 DB에 접속한다. [Cloudflare 공식 pg 연결](https://developers.cloudflare.com/workers/tutorials/postgres/)과 SDK Web Standard handler를 사용한다. build와 실제 Workerd DB/TLS 성공은 구분한다.
- 외부 Auth getUser와 이메일 인증으로 확인한 계정만 provisioning한다. 도구 입력의 사용자 ID·회사 ID로 신원을 선택하지 않는다.
- 계정별 UUID의 회사·원천 거래 1,000건·증빙·보조자료를 원자적으로 적재한다. 원본 fixture/hash는 변경하지 않고 재로그인은 재적재하지 않는다. 소규모 포트폴리오용 최초 25개 작업공간 상한을 둔다.
- 사람은 실제 Supabase user, MCP 작성자는 로그인 없는 서비스 actor다. 작성자 FK를 private actor registry로 확장하되 인간 결정자 FK·자기 승인 금지·승인 scope·hash·불변성·원자적 전기를 보존한다.
- MCP actor에는 승인 권한과 원천 ERP 생성 권한이 없다. 준비된 거래부터 회계 처리하며 create_transaction은 원격 신원에서 거절된다.
- 서버 토큰별 회사 바인딩과 DB RLS로 중복 검사한다. 다른 회사 UUID/cursor를 알아도 권한이 생기지 않는다.
- OAuth discovery/DCR/code, 필수 PKCE S256, 정확한 callback 대조, resource binding, 5분 단일 사용 code, 1시간 access token, 회전형 refresh token과 사용자별 취소를 구현한다. refresh는 30일 만료다. code/token은 SHA-256 hash로 저장한다.
- 웹은 Secure/HttpOnly/SameSite=Lax cookie, AES-256-GCM 암호화 provider 세션, 동일 출처+CSRF를 사용한다. DB 세션은 7일 만료이고 매 요청 외부 Auth 신원을 검증한다. AI 토큰으로 웹 승인을 할 수 없다.
- 증빙은 회사별 DB에 저장한다. 기존 Supabase Storage 코드는 유지하되 원격 Storage 업로드는 활성화하지 않았다.
- 원문 SQL·키를 포함한 오류를 노출하지 않고 Worker 지역별 IP rate limit을 적용한다. 전역 쿼터·완전한 남용 방어·상용 SaaS 인증을 주장하지 않는다.
- 공공 API 키는 서버가 공유하고 방문자에게 배포하지 않는다. 국세청 합성 번호 제외, 거래일 법령, DART/ECOS 참고자료의 한계와 실패 표시를 유지한다.
