# 로그인 없이 시작하는 원격 회계 학습

공개 사이트: https://ledgerflow-public-reference-gateway.eric5833.workers.dev/

MCP: https://ledgerflow-public-reference-gateway.eric5833.workers.dev/mcp

[처음 시작하기](GETTING_STARTED.md)의 요청문을 현재 AI 앱에 보내면 설치 스크립트가 현재 폴더에 역할 파일을 병합하고 임시 회사를 발급받는다. Node 24와 파일 설정이 가능한 AI 앱이 필요하다. 서버·DB·공공 API 키를 새로 설치하지 않는다. Google 로그인·폴더 이동·MCP OAuth는 임시 연습의 필수 단계에서 제거했다.

## 실제 흐름

1. AI가 docs/START_HERE.md를 읽고 현재 CWD에서 create-learning-workspace.ts --in-place --client <현재앱>을 실행한다.
2. 서버가 키별로 회사·합성 ERP 1,000건·작성자와 검토자 주체를 원자적으로 만든다. Supabase Auth에 가짜 사용자를 추가하지 않는다.
3. 키는 ignored .ledgerflow/guest-session.json에 저장한다. Codex·Claude 설정에는 비공개 파일을 읽는 header helper를, Antigravity의 비공개 글로벌 설정에는 해당 Authorization 헤더를 등록한다. 다른 서버와 개인 파일은 유지한다.
4. 스크립트가 initialize·목록·get_system_status·get_company_context를 실제 호출한다. 현재 앱에서도 두 도구를 호출해 회사가 일치하는지 별도로 검사한다. 실행 중 도구 갱신·신뢰 확인은 앱 정책을 따르며 모든 앱의 무클릭 성공을 보장하지 않는다.
5. 첫 거래를 요청하면 초안→검증→request_journal_approval에서 approvalUrl을 돌려준다. 사람이 링크를 열어 내용을 확인하고 승인/반려한다. 링크 열기 자체는 승인이나 전기가 아니다.
6. 사용자가 승인 후 반영을 요청하면 AI가 승인/hash를 확인해 post_journal_entry를 호출하고 실제 Posted와 시산표를 확인한다.

## 세션과 승인 경계

- 공개 /mcp의 무키 initialize도 자동 회사를 배정하고 Mcp-Session-Id를 반환한다. 이를 유지하지 않는 클라이언트는 설치 스크립트의 고정 키를 사용한다. 무키 일반 도구 호출은 428로 초기화를 요구하며 기존 OAuth를 강제하지 않는다.
- 임시 접근은 24시간이다. 승인 링크는 15분·단일 교환이며 회사/전표/version/hash에 결합한다. 웹 검토 세션은 최대 1시간이고 동일 출처·CSRF를 확인한다. 잘못된 키·만료 세션은 다른 회사나 공개 샘플로 넘어가지 않는다.
- 링크의 fragment 티켓은 HTTP URL·Referer에 보내지 않고 페이지가 읽은 즉시 지운다. 사람이 버튼을 눌러야 결정된다. MCP 도구에 승인 명령은 없고 작성자는 DB에서도 승인 scope가 없다.
- 임시 링크를 가진 사람의 실명은 검증하지 않는다. AI도 반환된 링크를 볼 수 있으므로 이 모드는 악의적 AI에 대해 Google 인증과 동등한 독립 신원 확인을 제공하지 않는다. 역할 지침은 링크 교환·승인 API 호출을 금지한다. 합성 데이터 학습에만 제공한다.
- 영구 보관을 원할 때만 승인 화면의 Google 보관 버튼을 누른다. 승인 후 아직 전기하지 않은 전표는 먼저 반영해야 한다. 기존 개인 장부가 있으면 병합/덮어쓰지 않는다. 전환 후 옛 임시 키는 폐기되고 앱은 개인 OAuth로 다시 연결한다.
- 만료는 접근 철회이며 물리적 삭제가 아니다. 게시/감사 불변 기록을 임의 삭제하거나 무인 정리 작업을 추가하지 않는다. 포트폴리오 용량 보호를 위해 임시 회사 누적 20개, 기존 개인 회사 25개 상한이다. 만원 시 GUEST_CAPACITY_REACHED를 반환하며 무제한 무료 서비스를 주장하지 않는다.
- 승인 전표는 기존 Decimal·RLS·기간·증빙·차대변·중복·불변성·원자적 전기 검사를 그대로 사용한다.

## 현재 앱 설정의 근거

[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Codex header helper](https://learn.chatgpt.com/docs/config-file/config-reference), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Antigravity MCP](https://antigravity.google/docs/mcp), [Antigravity 플러그인](https://antigravity.google/docs/plugins).

Antigravity 플러그인은 .agents/plugins/ledgerflow-learning/plugin.json과 기존 skills/rules로 구성하며 MCP 정의를 중복하지 않는다. 실제 앱의 플러그인 발견·갱신과 SDK 프로토콜 테스트를 구분한다. 설치기는 기존 프로젝트 신뢰/허용 플래그를 임의 수정하지 않는다.

아래는 보관한 Google 개인 장부와 소스 배포의 기존 구조다. 연습 시작 시 따라 할 단계가 아니다.

## 소스 배포 기록과 관리 명령

1. ignored .env.local의 Supabase URL·publishable key·유효한 DB URL·CA 파일 경로·공공 API 키 4개를 확인한다.
2. Google Web OAuth 클라이언트의 ID·Secret을 Supabase Google Provider에 등록한다. Google의 redirect URI는 Supabase `/auth/v1/callback`, Supabase의 Redirect URL은 사이트 `/api/remote/google/callback`으로 구분한다. [정확한 주소·Aside 명령어](GOOGLE_LOGIN_SETUP.md)
3. Google Audience·Testing/Publishing 상태와 최소 openid/email/profile 범위를 확인한다. 이 로그인에는 SMTP가 필요하지 않고 기존 이메일 확인을 비활성화해 우회하지 않는다.
4. Cloudflare 로그인 상태에서 pnpm check 후 pnpm remote:deploy를 실행한다.

remote:deploy는 웹 build·공개 snapshot·키 노출 검사 후 실제 DB TLS/Auth 연결을 확인한다. 최초 빈 DB에는 기존 001~006 migration을 manifest 검증 방식으로 적용하고, 007·008·009는 각각 hash receipt로 원자적 upgrade한다. 기존 설치/receipt 불일치는 초기화하지 않고 중단한다. Auth 사용자를 SQL로 만들어 넣지 않는다.

DB 접속은 **Cloudflare Hyperdrive**를 사용한다. 배포 스크립트가 공개 Supabase CA를 등록하고 Direct connection origin에 verify-full을 적용하며, SQL 응답 캐시는 끈다. DB 비밀번호는 HTTPS 관리 API 본문으로 전달하며 OS 명령줄·Git·웹 자산에 넣지 않는다. 기존 Wrangler 인증은 메모리에서만 사용하고 해당 자격증명 조회의 디스크 로그도 끈다. Supabase URL·publishable key·32바이트 세션 암호화 키는 Cloudflare secrets로 등록한다. 암호화 키는 ignored .env.local에 보관한다.

일반 Workerd의 node:tls에 로컬 Node용 CA 옵션을 그대로 전달하는 경로는 배포 검사에서 실패했다. Hyperdrive의 CA·호스트명 검증을 쓰는 경로에서 실제 OAuth client 설정 저장을 확인했다. TLS 검증을 끄지 않는다. [공식 Supabase 연결](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/), [인증서 검증](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/)

pnpm site:deploy는 **공개 미리보기 전용**으로 원격 기능을 끈다. 실제 원격 장부 갱신은 pnpm remote:deploy를 사용한다. DB 인증 실패 시 원격 secrets 업로드·활성화 전에 중단한다.

Google 제공자 활성화 후 실제 Google 로그인, 서로 다른 실제 계정 격리, Codex·Claude OAuth와 status/context 호출, 사용자의 직접 웹 승인 후 Posted를 확인해야 한다. 테스트용 Auth와 SDK 성공은 실제 앱 검증을 대신하지 않는다.

## 구조와 보안 경계

- 기존 MCP 팩토리·공통 ERP/AccountingService·Decimal 엔진을 Cloudflare fetch transport에 재사용한다. 별도 MCP 제품·LLM API·오케스트레이터·스케줄러를 추가하지 않는다. Node 로컬 HTTP/stdio도 보존한다.
- Worker는 native PostgreSQL을 기동하지 않고 pg 8.23.1과 Hyperdrive binding으로 외부 DB에 접속한다. 원본 CA와 verify-full 검증은 Hyperdrive가 담당하고 SQL 응답 캐시는 사용하지 않는다. 기존 트랜잭션과 SET LOCAL 회사 scope를 유지한다. SDK Web Standard handler와 실제 OAuth 설정 저장까지 확인했으며 실제 사용자 로그인·장부 처리 검증은 별도다.
- Google의 서버 PKCE 코드 교환 후 외부 Auth getUser의 확인된 이메일·Google identity로 사용자 신원을 검증한다. 008 migration의 10분 단일 사용 flow는 암호화·쿠키 해시/AAD로 결합한다. callback의 open redirect·중복 code·다른 브라우저·만료를 거절하고 Google provider token은 보관하지 않는다. 도구 입력의 사용자 ID·회사 ID로 신원을 선택하지 않는다.
- 계정별 UUID의 회사·원천 거래 1,000건·증빙·보조자료를 원자적으로 적재한다. 원본 fixture/hash는 변경하지 않고 재로그인은 재적재하지 않는다. 소규모 포트폴리오용 최초 25개 작업공간 상한을 둔다.
- 보관한 개인 장부의 사람은 실제 Supabase user, MCP 작성자는 별도 서비스 actor다. 임시 학습은 009의 별도 writer/reviewer 주체를 사용한다. 작성자 FK를 private actor registry로 확장하되 결정자 FK를 실행 주체 레지스트리에 연결하고 자기 승인 금지·승인 scope·hash·불변성·원자적 전기를 보존한다.
- MCP actor에는 승인 권한과 원천 ERP 생성 권한이 없다. 준비된 거래부터 회계 처리하며 create_transaction은 원격 신원에서 거절된다.
- 서버 토큰별 회사 바인딩과 DB RLS로 중복 검사한다. 다른 회사 UUID/cursor를 알아도 권한이 생기지 않는다.
- OAuth discovery/DCR/code, 필수 PKCE S256, 정확한 callback 대조, resource binding, 5분 단일 사용 code, 1시간 access token, 회전형 refresh token과 사용자별 취소를 구현한다. refresh는 30일 만료다. code/token은 SHA-256 hash로 저장한다.
- 웹은 Secure/HttpOnly/SameSite=Lax cookie, AES-256-GCM 암호화 provider 세션, 동일 출처+CSRF를 사용한다. DB 세션은 7일 만료이고 매 요청 외부 Auth 신원을 검증한다. MCP 작성자 토큰 자체로 웹 승인을 할 수 없다. 임시 승인 링크는 별도 검토 권한이므로 AI가 사용하지 않는다.
- 증빙은 회사별 DB에 저장한다. 기존 Supabase Storage 코드는 유지하되 원격 Storage 업로드는 활성화하지 않았다.
- 원문 SQL·키를 포함한 오류를 노출하지 않고 Worker 지역별 IP rate limit을 적용한다. 전역 쿼터·완전한 남용 방어·상용 SaaS 인증을 주장하지 않는다.
- 공공 API 키는 서버가 공유하고 방문자에게 배포하지 않는다. 국세청 합성 번호 제외, 거래일 법령, DART/ECOS 참고자료의 한계와 실패 표시를 유지한다.
