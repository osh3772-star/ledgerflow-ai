# 원격 배포 및 사용 안내 검증 기록

## 2026-10-18 첫 매출 통합 준비와 터미널 없는 설치

기본 첫 매출 학습을 get_system_status → get_company_context → propose_journal_entry의 정상 경로 3회로 묶었다. validateAndRequestApproval:true는 기존 독립 엔진/DB 검증과 승인 요청을 사용하고, firstSale은 아직 게시/진행 중인 초안이 없는 첫 매출을 선택한다. 같은 idempotencyKey로 부분 완료를 재개한다. client를 지정하면 서버의 **기계적 준비 결과**도 한 번만 기록하므로 별도 거래·증빙·validate·request·기계적 record 호출이 필요 없다. 응답에 거래·증빙·검증·승인 상태·사람 전용 approvalUrl을 포함한다. AI의 판단이나 인간의 결정을 자동화했다는 뜻이 아니다.

기본 설치는 공개 GET /api/remote/bootstrap?client=...&requestId=<이번 요청의 새 UUID>에서 임시 회사와 파일 번들을 한 번 받아 현재 폴더의 파일 도구로 병합한다. Node/Git/터미널·홈 파일·외부 MCP 스키마 조회는 기본 단계에서 제거했다. Antigravity는 workspace plugin의 mcp_config.json, Claude/Codex는 프로젝트 설정에 24시간 /mcp/g/<guestToken> 주소를 넣는다. 세션 URL은 비밀이므로 공개/커밋하지 않는다. 이미 추적 중인 파일은 .gitignore만으로 보호되지 않는다고 명시했다. 선택적 Node 스크립트도 글로벌 설정·header helper 사용을 제거하고 홈 파일 보존 테스트로 바꿨다.

현재 폴더의 핵심 input schema 7개와 역할/규칙을 함께 제공한다. 호스트의 ~/.gemini/antigravity/mcp/*.json을 읽는 대신 이 문서를 참조하도록 AGENTS/GEMINI/매출 스킬에 명시했다. 실제 registry에서 전체 41개 카탈로그와 학습 bundle을 build하며 모델·DB·추가 MCP listener를 실행하지 않는다.

검증: 전체 pnpm check 278개/42개 파일을 통과했다. 이후 매입 통합 준비를 매출 역할로 잘못 기록하지 않는 회귀를 추가하고 해당 통합 suite 10개와 타입 검사를 별도 재실행해 통과했다. CWD 설정 병합/홈 파일 보존 unit 6개도 통과했다. 통합 옵션의 재시도·승인 pending·전표/Result 각 1개·미승인 전기 거부·다른 회사 거부와 path 자격증명/혼합 신원 거부를 확인했다. 최초 동시 요청에서도 전표·준비 기록 각 1개인 회귀도 전체 검사에 포함해 통과했다. 기존 fixture·migrations는 수정하지 않았으며 추가 migration은 없다.

2026-10-18 14:41 KST 공개 서버에서 GET 한 번으로 파일 21개·핵심 스키마 7개를 받았고, 인증 헤더 없이 path URL로 연결해 실제 status/context 성공과 발급 회사 일치·도구 41개·통합 옵션 명세를 확인했다. no-store/no-referrer 응답, 웹 3페이지/Worker build, 비밀값 노출 0건도 확인했다. 운영 분개 생성·승인·전기는 실행하지 않았다.

실제 Antigravity/Codex/Claude UI에서 팝업 횟수를 측정한 것은 아니다. CWD 파일 도구·앱의 플러그인 갱신·최초 도구 허용 정책은 호스트가 관리하며 임의로 끄지 않는다. 오류·추가 판단·자료 부족은 3회보다 많은 호출이 필요할 수 있다. [현재 시작 지침](START_HERE.md) · [도구 계약](MCP_TOOLS.md)

## 2026-10-18 로그인 없는 임시 학습 시작

공유 MCP 하나와 기존 6역할·1,000건 fixture·회계 엔진·공공 API를 유지한 채, 현재 폴더에 역할/규칙을 병합하는 설치와 24시간 guest 회사 자동 발급을 추가했다. Google과 MCP OAuth는 임시 연습 시작에서 제외하고, 보관한 개인 장부의 기존 인증으로 남겨 두었다. 009는 기존 001~008을 수정하지 않고 guest scope·검토 티켓·결정 주체 FK를 추가한다.

- 현재 CWD에 설치하고 수정된 기존 역할/계약·개인 파일을 보존한다. AGENTS/CLAUDE/GEMINI는 관리 블록을 병합한다. 선택한 앱의 활성 설정만 백업 후 변경한다. Codex·Claude는 비공개 header helper, Antigravity는 비공개 글로벌 Authorization과 공식 workspace plugin 구조를 사용한다.
- 무키 MCP initialize는 세션별 회사를 배정한다. 설치 스크립트는 고정 guest 키로 initialize→목록→status→context를 실제 호출해 회사 일치를 확인한다. 재실행은 같은 bootstrap/회사로 돌아간다. 앱 신뢰·보안 설정은 우회하지 않는다.
- request_journal_approval은 해당 회사/전표/version/hash의 15분 단일 교환 approvalUrl을 반환한다. 사람은 전용 페이지에서 확인 후 승인/반려한다. 열기만으로 승인하지 않고 작성자 scope에 approve를 추가하지 않는다. Google로 확인한 신원과 같은 보장은 없는 합성 학습용 링크이며 AI에게 열기/교환/결정 실행을 금지한다.
- Google 보관은 선택이다. 기존 개인 장부와의 충돌은 덮어쓰지 않으며 승인 후 미전기 건은 먼저 반영해야 한다. 보관 전환 후 옛 guest 키는 폐기한다. 만료는 접근 철회이며 불변 기록 자동 삭제가 아니다. 누적 guest 20개·개인 25개 포트폴리오 상한을 둔다.

실제 Cloudflare 배포 후 2026-10-18 14:03 KST 검사에서 세 앱용 설정 생성과 실제 MCP status/context 호출이 같은 한빛유통 회사·41개 도구로 성공했다. **설정 검사는 별도 테스트 홈에서 수행했으며 현재 앱의 글로벌 설정을 바꾸거나 앱 안의 도구를 실제 실행했다는 뜻이 아니다.** SDK로 거래 1,000건의 UUID 중복 없음, 무키 initialize 성공, 세션 회사 유지, 다른 guest 회사 분리, 타사 회사 조회 FORBIDDEN을 확인했다. 첫 운영 probe는 실패했고 같은 세션 재실행에서 성공했으므로 무중단/100% 성공을 주장하지 않는다. 운영 전표 생성·승인·전기는 실행하지 않았다.

`pnpm check` 275개/42개 파일 통과, Astro 3페이지 build, Worker dry build 및 공개 키 노출 0건을 확인했다. 실제 PostgreSQL fixture에서 guest 격리·작성자 승인 scope 차단·승인 전 전기 거부·티켓 재사용/잘못된 Origin/CSRF 차단·테스트 인간 승인 후 Posted/시산표·권한 철회·만료·Google 보관 충돌/키 철회를 검사한다. 기존 Google/OAuth 10개와 Workerd 암호화 2개도 유지한다. 예전 별도 폴더 전용 테스트는 CWD 기본값·명시 앱·기존 디렉터리·인자 거부·순수 Node 실행으로 변경하고 기존 파일 보존/설정 병합 검사는 별도로 확장했다.

현재 실행 중인 Codex·Claude Code·Antigravity의 도구 hot reload와 실제 네이티브 호출은 **미확인**이다. 현재 대화의 제공 도구에는 LedgerFlow가 노출돼 있지 않았다. SDK·HTTP 호출 성공을 네이티브 앱 성공으로 표시하지 않는다. 공식 앱 갱신/신뢰 절차가 필요한 환경의 완전 무클릭 보장은 하지 않는다. 실제 사람의 운영 승인과 Google 보관 전환도 테스트 harness 결과와 구분한다.

[시작 실행 지침](START_HERE.md) · [현재 사용 흐름과 보안 경계](REMOTE_USAGE.md)

## 2026-10-18 Google 로그인 수정 후 확인

| 항목 | 결과 | 근거와 범위 |
| --- | --- | --- |
| 공개 Google 제공자 | 활성화 | 직접 조회한 `/api/remote/config`: `enabled:true`, `checked:true`, `available:true` |
| 실제 Google 로그인 → 개인 장부 | 성공 보고 수신 | 사용자가 전달한 Aside 운영 확인 보고. 이번 소스 검증에서 실제 계정 로그인을 다시 실행한 것은 아님 |
| 원본 암호화 두 경로 | 운영 수정과 동일하게 반영 | PKCE flow와 브라우저 세션이 UTF-8 Buffer를 전달. 기존 암호문 포맷·키·브라우저 결합 유지 |
| Workerd 회귀 테스트 | 2개 통과 | 실제 소스 번들의 PKCE→세션·한글 왕복·키/브라우저 결합·재사용 거부. 네트워크 차단된 로컬 runtime과 fixture 사용 |
| 수정 전 Workerd 비교 실험 | 두 경로 HTTP 500 재현 | 테스트 번들에서 두 호출만 기존 문자열 입력으로 되돌린 결과. 수정 후 두 경로 HTTP 200 |
| `pnpm check` | 258개 / 39개 파일 통과 | 타입 검사와 기존 회계·MCP·승인·격리·신규 Workerd 회귀 테스트 |
| Worker dry build / 비밀값 검사 | 성공 / 노출 0건 | 운영 배포를 다시 실행하지 않았으며 공개 대상과 웹 build를 검사 |
| 네이티브 Codex·Claude 원격 호출 | 미확인 | 실제 클라이언트의 OAuth 동의 및 도구 호출 수용 검증 필요 |
| 실사용자 웹 승인 → Posted | 미확인 | 이번 작업에서 승인·전기 수행 없음 |

운영 Worker는 사용자가 전달한 보고에서 이미 수정됐으므로 이번에는 원본 수정과 재배포 회귀 방지에 집중한다. 현재 운영자의 OAuth 키를 다시 만들거나 암호화 키를 교체할 필요는 없다. [설정·문제 해결](GOOGLE_LOGIN_SETUP.md)

## 2026-10-17 배포 기록

**Google 로그인 후속 변경:** 방문자 진입은 Google 버튼이고 이메일·비밀번호 가입은 종료했다. 서버 PKCE·단일 사용 flow·기존 승인/격리 통합 테스트 10개가 통과했다. 당시에는 소유자의 Google OAuth 앱·Supabase Provider 등록과 실제 Google 계정 로그인이 남아 있었다. 아래 표는 Google 전환 전 배포의 연결 검증 기록이며, 이메일/SMTP 항목은 현재 Google 흐름의 준비 조건이 아니다.

Google 전환 후 최종 `pnpm check`: **256개/38개 파일 통과**. 웹 build·Worker build·공개 파일 비밀값 검사도 통과했다. 실제 서버의 Google 설정 조회는 성공했고 제공자는 비활성이다. password/signup 경로는 HTTP 410, 쿠키 없는 Google callback은 오류를 노출하지 않고 303 복귀, 미인증 MCP는 401을 확인했다. 실제 Google 제공자 설정 성공이나 실제 Google 계정 로그인 성공을 이 테스트 결과로 대신하지 않는다.

2026-10-17 KST. 실제 장부를 대신 처리한 보고가 아니라 배포·연결·소스 검증 기록입니다.

| 항목 | 결과 | 확인 범위 |
| --- | --- | --- |
| Supabase DB | 접속 성공·TLS peer 검증 성공 | 실제 session pooler의 읽기 전용 schema 검사 |
| 회계 schema | 기존 001~006 + 원격 007 설치 완료 | 누락 table·RPC 0, 대상 table RLS 비활성 0, 기존 파일 보존 |
| Supabase Auth | health HTTP 200, 이메일 가입 활성·자동 확인 꺼짐 | 실제 메일 발송·수신·사용자 로그인 성공은 미확인 |
| Worker DB 연결 | OAuth 앱 등록 HTTP 201 | Hyperdrive의 Supabase CA·verify-full, SQL 응답 캐시 꺼짐 |
| 원격 MCP 보호 | 미인증 HTTP 401, OAuth discovery HTTP 200 | OAuth 안내 확인이며 인증된 MCP 도구 호출 성공의 증거는 아님 |
| 전체 사용 안내 | `/workflow/` HTTP 200 | 20개 단계·참고 문서, 목차 21개·복사 블록 12개·깨진 앵커 0 |
| 기존 빠른 시작 | 보강 후 실제 공개 화면 확인 | 전체 안내 진입·주요 단계·승인 체크·보고서 확인·중단 재개 |
| 브라우저 동작 | 전체 안내 이동·목차 이동·요청문 복사 피드백 확인 | 사용자의 회계 작업이나 승인은 실행하지 않음 |
| `pnpm check` | 251개 / 37개 파일 통과 | 타입 검사와 기존 회계·MCP·보안 회귀, Hyperdrive 설정 검사 포함 |
| 웹 build | 성공 | 대시보드·워크플로우 두 페이지, 동일 원본에서 오프라인 HTML 생성 |
| 비밀값 검사 | Git 공개 대상 및 웹 build 노출 0건 | 로컬 env의 키·DB URL·서버 토큰·암호화 키를 공개 파일과 대조 |
| 공공자료 샘플 | 실제 참고자료 수집 후 공개 자료 재사용 | 합성 ERP 1,000건·12개월, 공공 API 추가 반복 호출 없이 문서 갱신 |

배포 검증은 공개 OAuth client 설정 1건을 만들었습니다. Auth 사용자·개인 회사·거래·전표·승인·전기는 만들지 않았습니다. 실제 개인 장부 1,000건은 인증된 사용자의 최초 로그인에서 준비하도록 구현돼 있습니다.

당시 남은 수용 검증(현재 Google 로그인 상태는 문서 상단 참조):

1. 실제 이메일 인증·로그인과 일반 방문자의 메일 수신 확인. 필요하면 운영자가 SMTP·redirect allowlist를 설정합니다.
2. 본인 Codex·Claude Code의 원격 OAuth 동의 후 `get_system_status` → `get_company_context` 실제 호출.
3. 본인 장부의 첫 매출 초안·검증·승인 요청, 사용자가 직접 웹 승인, 앱의 게시 요청 후 DB `Posted`·시산표 확인.
4. 별도 실제 계정의 장부가 바뀌지 않는지 확인. 테스트 소유 PostgreSQL A/B 격리 성공과 구분합니다.

[전체 워크플로우](https://ledgerflow-public-reference-gateway.eric5833.workers.dev/workflow/) · [원격 연결·운영 상세](REMOTE_USAGE.md)

기술 근거: [Hyperdrive Supabase 연결](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/), [CA·호스트명 검증](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/), [무료 쿼터](https://developers.cloudflare.com/hyperdrive/platform/pricing/).
