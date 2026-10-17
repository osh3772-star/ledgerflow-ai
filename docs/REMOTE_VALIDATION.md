# 원격 배포 및 사용 안내 검증 기록

**Google 로그인 후속 변경:** 현재 방문자 진입은 Google 버튼이고 이메일·비밀번호 가입은 종료했다. 서버 PKCE·단일 사용 flow·기존 승인/격리 통합 테스트 10개가 통과했다. 소유자의 Google OAuth 앱·Supabase Provider 등록과 실제 Google 계정 로그인이 필요하다. [설정 및 Aside 전달문](GOOGLE_LOGIN_SETUP.md). 아래 표는 Google 전환 전 배포의 연결 검증 기록이며, 이메일/SMTP 항목은 현재 Google 흐름의 준비 조건이 아니다.

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

남은 수용 검증:

1. 실제 이메일 인증·로그인과 일반 방문자의 메일 수신 확인. 필요하면 운영자가 SMTP·redirect allowlist를 설정합니다.
2. 본인 Codex·Claude Code의 원격 OAuth 동의 후 `get_system_status` → `get_company_context` 실제 호출.
3. 본인 장부의 첫 매출 초안·검증·승인 요청, 사용자가 직접 웹 승인, 앱의 게시 요청 후 DB `Posted`·시산표 확인.
4. 별도 실제 계정의 장부가 바뀌지 않는지 확인. 테스트 소유 PostgreSQL A/B 격리 성공과 구분합니다.

[전체 워크플로우](https://ledgerflow-public-reference-gateway.eric5833.workers.dev/workflow/) · [원격 연결·운영 상세](REMOTE_USAGE.md)

기술 근거: [Hyperdrive Supabase 연결](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/), [CA·호스트명 검증](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/), [무료 쿼터](https://developers.cloudflare.com/hyperdrive/platform/pricing/).
