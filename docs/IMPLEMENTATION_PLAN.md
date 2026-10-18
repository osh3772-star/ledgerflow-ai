# Implementation plan

## 2026-10-18 개인 연결 보정

1. 원본 Git archive 백업 후 기존 41개 도구·6역할·ERP·독립 검증/승인 함수를 보존한다.
2. 010 migration + 검증된 웹 세션의 10분 단일 사용 setup ticket + 7일 작성 연결을 추가한다. 기존 OAuth와 익명 학습 경로도 보존한다.
3. 설치기 --claim-code 및 터미널 없는 bootstrap에 개인 연결 분기를 구현한다. 코드 실패 시 새 게스트 발급을 금지한다. 기존 게스트는 같은 폴더의 키 소유 증명으로 빈 개인 장부와 연결한다.
4. 웹 전용 요청문·회사 ID·최근 호출/작성 전표 표시와 생성 원본 문서까지 함께 수정한다.
5. 실제 PostgreSQL + SDK에서 동일 companyId/웹 승인 목록 일치, 재시도·만료·취소·타인 scope 거절, 연결만으로 미승인 전기 불가, 기존 양쪽 자료 보존을 검증한다. 전체 pnpm check 및 웹 build 후 receipt로 010을 적용해 원격 배포한다.
6. 테스트 fixture 신원과 실제 Google/네이티브 앱 검증을 구분한다. 운영자의 로그인 쿠키나 승인 링크를 개발자가 교환하지 않는다. 실제 사용자 확인은 새 요청문 → 앱의 status/context 회사 ID → 웹에서 직접 승인 순서다.

> 현재 기본 설치: 공개 GET /api/remote/bootstrap에서 임시 회사+핵심 스키마+6역할 번들을 받아 CWD 파일 도구로 병합한다. Git/Node 실행·홈 설정·외부 MCP 스키마 읽기는 기본 경로에서 제거했다. Antigravity는 workspace plugin의 mcp_config.json, Claude/Codex는 프로젝트 설정에 단기 guest URL을 등록한다. 첫 매출은 status/context/propose 통합 옵션의 정상 경로 3회다. 아래 이전 header helper/글로벌 설치 설명은 구형 기록이며 [현재 시작 지침](START_HERE.md)이 우선한다.


> 2026-10-18 최신 시작 방식: 현재 폴더에 비파괴적으로 역할/규칙을 병합하고, 공유 서버에서 24시간 임시 회사와 1,000건을 자동 발급한다. OAuth 없는 MCP 초기화와 비공개 guest 헤더를 지원한다. 009는 회사별 guest scope와 전표별 인간 웹 승인 티켓을 추가하며 기존 001~008은 수정하지 않는다. Google은 보관을 선택할 때만 연결한다. [현재 실행 지침](START_HERE.md) · [세션/승인/용량 경계](REMOTE_USAGE.md). 아래 Google 로그인 설명은 보관한 개인 장부에 해당한다.


최신 로그인 방식은 Google이다. 서버 PKCE·008 단일 사용 flow·기존 세션/회사 격리 통합 후 소유자가 Google OAuth ID·Secret과 callback 허용 주소를 등록한다. 이메일 가입·SMTP 준비는 현재 흐름에서 제외한다. [Google 설정·Aside 전달문](GOOGLE_LOGIN_SETUP.md)

2026-10-17 원격 확장은 [원격 사용·배포 계획](REMOTE_USAGE.md)을 따른다. 기존 41개 도구/6개 역할/공통 엔진을 보존하며 Auth → 계정별 회사 provisioning/RLS → OAuth MCP → 사람 웹 승인 → Posted/시산표 순서로 검증한다. 실제 DB 접속·TLS·Auth health는 15:41 KST에 성공했다. 실제 Google 로그인·네이티브 앱·인간 승인 수용 검증은 코드 검증과 구분한다.

2026-10-16 현재 사용자가 요청한 미구현 기능을 작은 검증 단위로 추가했다. 단일 공유 MCP, 앱 주도 추론, 기존 ERP/Decimal/PostgreSQL/공공 API probe를 유지한다. 수정 전 공개 소스 99개를 키 제외 백업했으며 이전 M1 백업 58개도 보존한다.

| 단계 | 현재 코드 | 완료 기준 / 검증 방법 |
| --- | --- | --- |
| M1 공유 연결 | HTTP + stdio 단일 제품, 두 앱 설정, 읽기 전용 `mcp:doctor` | SDK initialize/list/call, 공유 회사/DB, Host/Origin/bearer, 클라이언트 설정/현재 Codex 등록 진단 |
| M2 결정론 엔진 | 10종 거래 Draft·증빙·계정·차대변 검증 | 기존 매출 gold, 수기 10종 gold, 1,000건 분류, 주입 오류, LLM 호출 0 |
| M3 승인·전기 | 로그인 없는 demo 세션·외부 JWT/CSRF, DB hash/version, post RPC | 자기 승인·미승인·권한 철회·내용 변조·정규화 라인 변조·회사 위조 차단, 원자적 재요청 |
| M4 원장 | Posted 원장·시산표·BS/IS·역분개 | 차대변 일치, 자산=부채+자본, 손익 gold, 원전표 불변·역분개 추적 |
| M5 API·대사 | 4 Adapter / 11 공공 도구, DB cache, 현금 대사 | 전체 mock + 일부 live, 오류 미캐시·timeout/retry·출처 분리, 금액/방향/날짜 match |
| M6 native 역할 | 두 앱 각각 6 agent/skill, 구조화 Result 기록 | 설정·skill 유효성, 실제 DB Posted 근거 검사; 실제 앱 추론 실행은 별도 수동 검증 |
| M7 결산·웹 | 상각·선급 차액 Draft, 마감 gate, Astro React | 완결된 월을 독립 승인 후 마감, 마감 후 전기 금지, UI build/브라우저 검토 |
| M8 배포 검증 | 기존 PostgreSQL 재기동 보존·schema gate, Supabase Auth/Storage 코드·RLS, 비관리자 Docker/Compose·Windows/Linux CI·deploy:check | 실제 Windows/Linux CI와 Linux Docker smoke 통과. hosted Supabase 인증/Storage/RLS·Desktop/Compose는 별도 후속 검증 |
| M9 공공자료 회계 근거 | 공통 AccountingReferenceService, 거래일 법령·DART·ECOS·국세청 제외 사유, 선택 JSONB snapshot | 실제 과거 거래일 조회, 기존 gold 금액 불변, hash 결합·동시 멱등·인간 승인 통합 테스트 |
| M10 공유 API 중계 | Cloudflare 읽기 전용 Worker, 로컬 gateway client, 토큰 연결/비밀값 등록 CLI | 실제 Wrangler dry build, 인증·쿼터·입력·캐시 테스트, 실제 배포 후 origin 확인. MCP 1개·원본 키 비공개 유지 |
| M11 공개 웹 미리보기 | 기존 Worker Assets, 공통 서비스의 합성 자료 export, 공개 읽기 전용 route·화면 안내 | 1,000건·12개월 조회, 공개 세션/변경 차단, 배포 파일 비밀값 검사, 실제 HTTPS 페이지/API 확인. 장부 운영은 로컬에 유지 |
| M12 계정별 원격 장부 | 외부 Auth·계정별 회사/ERP·OAuth PKCE·웹 승인·같은 MCP 팩토리 | 기존 248개 검사에 격리·승인 후 Posted 포함. 실제 Worker DB 연결·메일·앱 연결은 별도 확인 |
| M13 전체 사용 안내 | 기존 빠른 시작 보강 + `/workflow/` 전체 안내, 동일 원본의 오프라인 HTML | 웹 build, 21개 목차·12개 복사 블록·링크 무결성·비밀값 검사, 실제 공개 화면·문서 확인 |

## 임시 학습 수용 기준

1. 기존 파일이 있는 CWD에서 같은 설치를 반복해도 사용자 파일·타 서버 설정을 보존한다.
2. Google 없이 고정 guest 키와 무키 initialize 양쪽에서 status/context를 실제 호출한다.
3. 키별 1,000건·회사 분리·RLS·만료·재사용 거부를 실제 PostgreSQL에서 확인한다.
4. 전표 링크 열기는 pending을 유지하고 명시적 웹 결정 후에만 전기를 허용한다.
5. 앱 설정/프로토콜 검사와 실제 네이티브 앱의 도구 갱신 성공은 별도 증거로 기록한다.

## 테스트 전략

`pnpm check`는 타입 검사와 전체 Vitest 회귀 테스트다. PostgreSQL 테스트는 실제 17.10 binary에서 제약·scope·회사 격리·회계 RPC·승인/중복/불변성을 검증한다. `tests/support/auth-bootstrap.sql`은 로컬 테스트 객체이며 Supabase에 적용하지 않는다. baseline 테스트의 금융 assertion과 원본 001~003 migration을 유지한다.

기존 PostgreSQL profile의 테스트는 테스트가 직접 준비한 DB에 서버를 두 번 연결해 Draft 보존을 검사한다. 서버 자체의 migration·seed·권한 변경은 허용하지 않는다. 누락 schema, 잘못된 외부 Auth 설정, 회사 위조 시 거절과 연결 해제를 확인한다. `mcp:doctor`는 실행 서버에 status/context를 먼저 호출한 뒤 catalog와 제한된 ERP 조회만 수행한다. 실제 앱 추론·인간 결정의 증거로 사용하지 않는다.

`pnpm evaluate`는 고정 fixture 1,000건과 `accounting-gold.json` 10개 수기 분개, 별도 `accounting-errors.json` 5개 오류를 사용한다. 분류와 line exact 비교를 구분하며 성과를 실제 기업/AI 판단 정확도로 확대하지 않는다. 앱 LLM의 native 추론 gold 비교는 아직 수행하지 않았다.

공공자료 연동의 기본 테스트는 mock/fake fetch와 테스트 소유 임시 DB만 사용한다. `pnpm api:references`는 별도로 명시 실행하는 실조회 진단이며 사용자 장부에 접근하지 않는다. Cloudflare 코드는 `pnpm gateway:build`로 CI에서도 검증하고, 계정 로그인·배포·비밀값 등록은 운영자가 요청한 배포 작업에서만 수행한다. [공유 연결과 한계](PUBLIC_GATEWAY.md)

| 지표 | 구현 측정 / 한계 |
| --- | --- |
| 자동 분개 정확도 | 수기 line gold 10건 exact match; 990건 독립 line gold 없음 |
| 계정 분류 정확도 | 1,000건의 거래종류별 사전 계정 set 비교 |
| 처리 성공률 | 1,000건 결정론 Draft 생성 분모; 인간 승인 후 Posted율과 별도 |
| 중복 차단 | DB UNIQUE·동시 재시도·중복 source 테스트; 운영 표본 차단율 없음 |
| 오류 Precision/Recall | 정상 gold 10 + 주입 오류 5의 작은 합성 holdout |
| 자동 처리/승인 비율 | 결정론 Draft 비율 측정, 모든 전기는 독립 인간 승인 필요 |
| 처리 시간 | evaluation wall time, MCP audit duration_ms, DB 통합 테스트 |
| AI 비용 | 유료 모델 API 호출 0, 앱 구독 추론 비용은 null/미측정 |
| MCP 성공률 | mcp_tool_calls의 success/error; 의도한 거절도 별도 분류 필요 |

## 외부 연결 검증 순서

1. `pnpm web:build`, `pnpm mcp:start`로 로컬 화면과 MCP를 켠다.
2. 다른 터미널에서 `pnpm mcp:doctor`를 실행해 설정/등록과 MCP 읽기 연결을 확인한다. 두 실제 앱을 재로드하고 status/context, 매출 Draft, validation, approval request를 실행한다.
3. 인간 승인자가 화면에서 hash·금액·근거를 확인하고 승인 버튼을 누른다.
4. 앱이 approval 상태를 다시 조회한 뒤 post를 호출하고 DB Posted·시산표를 확인한다.
5. Supabase 개발 프로젝트에서 Auth 사용자와 membership/principal/scopes를 명시적으로 provision하고 migration을 적용한다. source seed는 테스트용 Auth UUID 그대로 운영에 적재하지 않는다.
6. Storage 원문 보관·다른 회사 JWT 접근 거절·권한 철회·로그아웃·만료를 실제 환경에서 확인한다.
7. 구현된 Cloudflare HTTPS·OAuth/클라이언트별 신원·DB 세션 저장소를 실제 배포에서 검증한다. 현재 loopback 서버를 인터넷에 직접 노출하지 않는다.

새 도구/기능은 catalog → 공통 서비스 → 독립 엔진/제한 RPC → 테스트 → 문서 순서로 추가한다. 배포 자체를 구현 완료 증거로 대체하지 않는다. foreground 사용자 요청을 벗어난 자동 승인·상시 agent runner·cron을 도입하지 않는다.

## 다음 최소 단위

2026-10-18 Google Provider 활성화를 직접 확인했고 사용자에게 실제 Google 로그인 후 개인 장부 진입 성공 보고를 받았다. 운영 Worker의 암호화 호환성 수정도 원본에 반영했다. 현재 다음 최소 단위는 본인 Codex 또는 Claude의 앱 OAuth 연결 후 `get_system_status` → `get_company_context` 실제 호출을 확인하는 것이다. 이후 사용자 직접 웹 승인 후 Posted와 별도 실사용자 격리를 확인한다. Supabase 회계 schema와 원격 장부는 같은 Worker에 배포했다. 운영자의 사용자 신원이나 장부 승인 결정을 개발자가 만들어 대신하지 않는다. 기존 `pnpm start` 로컬 demo도 보존한다.

핵심 회계 구현은 [현재 검증 결과](IMPLEMENTATION_STATUS.md)에 기록했다. 사용자 지시에 따라 현재 최소 단위는 **기존 Supabase 연결값 3개 준비 → TLS/Auth health/DB metadata 읽기 전용 진단**이다. [단계별 연결 계획](SUPABASE_SETUP.md)을 따른다. 실제 Claude Code/Codex 공유 Draft·인간 승인·Posted 수용 테스트도 남아 있으며 DB 접속만으로 완료 처리하지 않는다.

2026-10-15 연결 진단에서는 Codex CLI의 동일 HTTP 서버 등록과 실행 서버의 41개 도구·회사 범위 읽기를 확인했다. Claude Code 실행 파일과 외부 DB/Auth 연결값은 현재 환경에서 발견되지 않았다. 설정/프로토콜 검증이 통과해도 실제 앱 추론 수용 테스트는 완료로 바꾸지 않는다.

## 담당 분리 후 진행 단위

[담당표](WORK_ASSIGNMENTS.md)에 사용자의 계정 로그인·개발 프로젝트/저장소 선택·인간 결정과 Codex의 구현/테스트/연결/배포 준비를 구분했다. 사용자는 4개 공공 API 키를 다시 보내지 않는다.

첫 단위는 배포 준비 진단과 Docker/CI 코드 보강이다. `deploy:check`는 구성 여부만 확인하고 실제 외부 검증은 항상 별도로 남긴다. `container:smoke`는 소유한 폐기형 DB/mock만 사용해 단일 MCP의 health/status/context/catalog/읽기를 검증한다. Dockerfile은 비관리자·직접 Node 기동·health check를 제공하고 Compose는 host network의 서비스 하나다. CI는 Windows/Linux 회귀 후 Linux 이미지 내부 smoke를 실행하도록 작성했다. 현재 Windows 호스트에서 이 smoke를 실행한 결과를 실제 이미지/Linux 검증으로 표시하지 않는다. [실행 방법](DEPLOYMENT.md)

사용자의 CLI 인증과 GitHub 업로드를 완료하고 Windows/Linux·이미지 CI를 통과했다. [실행 증거](CI_VALIDATION.md). Supabase는 기존 `회계자동화`를 재사용한다. 세 연결값·공개 CA 등록을 완료했으며 Auth health HTTP 200을 확인했다. DB는 현재 인증정보 거절로 미연결이다. Aside 작업은 Connect 대조와 DB 비밀번호 직접 입력 한 가지다. `supabase:init`의 offline manifest·기본 read-only 계획·명시적 project/hash 최초 설치 코드는 구현했다. 이후 연결 재진단 → 기존 객체 검토/최초 schema 적용 → 실제 Auth 신원/회사 scope → hosted fixture 적재 구현/검증 → Auth/Storage/RLS → 단일 서버 profile 전환을 진행한다. 준비가 필요한 사용자 작업은 그때 한 가지씩 전달한다. 원격 OAuth/HTTPS는 별도 후속 범위다.

다음 원격 보안 단위로 선택적 PostgreSQL 인간 세션 저장을 구현했다. 006 migration을 기존 DB에서 명시적으로 적용하고 외부 JWT/서버 암호화 키가 있을 때만 선택한다. 완료 기준은 Node/MCP 재기동 후 동일 세션 복원, 회사/토큰 해시 결합, 변조·만료·직접 DB 접근·JWT 철회 거절, 키 생성 시 기존 설정 보존과 비출력이다. 실제 provider/OAuth/HTTPS는 별도 후속 단위다. 사용자 준비는 [Aside용 단계별 명령](ASIDE_TASKS.md)으로 전달하며 Aside가 사용자 장부 승인을 대신하지 않는다.
