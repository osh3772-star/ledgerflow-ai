# 외부 JWT 세션의 선택적 PostgreSQL 저장

2026-10-15. 원격 보안의 첫 구현 단위다. 로컬 폐기형 demo는 로그인 없는 memory 세션을 유지한다. 외부 JWT 인증을 사용하는 기존 PostgreSQL profile에서만 암호화 DB 세션을 선택할 수 있다. 원격 MCP OAuth/HTTPS나 공개 배포를 완료한 기능은 아니다.

## 구성과 실행

기존 DB에 migration `202610150006_human_sessions.sql`을 먼저 적용한다. 기본 회계 schema는 001~005이며, 기존 파일은 수정하지 않았다. 서버는 기존 DB에 006을 자동 적용하지 않는다.

ignored `.env.local`에서 기존 PostgreSQL/Supabase 연결값과 실제 사용자/회사 설정을 준비한 뒤 아래 구성을 선택한다. 기존 공공 API 키는 유지한다.

```dotenv
LEDGERFLOW_MCP_MODE=postgres
LEDGERFLOW_HUMAN_SESSION_STORE=postgres
# session:key가 서버 전용 키를 생성/보존한다. 실제 값을 문서에 넣지 않는다.
```

```powershell
pnpm session:key
pnpm deploy:check
pnpm mcp:start
```

`session:key`는 Git에서 ignored인 기존 `.env.local`만 대상으로 32 random bytes의 canonical base64 키를 추가하고, 실제 키는 출력하지 않는다. 기존 설정 전체를 다시 쓰거나 유효한 기존 키를 교체하지 않는다. 키가 잘못되었거나 `.env.local.lock`이 다른 작업에 의해 존재하면 덮어쓰지 않고 실패한다. mode를 자동 변경하거나 외부 인증을 활성화하지 않는다. 로컬 demo에는 실행할 필요가 없다.

동일 DB 세션을 공유하는 Node 프로세스는 동일한 `LEDGERFLOW_SESSION_ENCRYPTION_KEY`를 서버 환경에 사용해야 한다. 키를 변경하면 기존 암호문을 복원할 수 없어 외부 JWT로 세션을 다시 준비해야 한다. 키를 클라이언트 MCP config·저장소·채팅에 넣지 않는다. 키 노출 검사에는 공공 키뿐 아니라 이 키/MCP bearer/DB URL도 포함한다.

기동 시 006의 테이블·필수 컬럼·강제 RLS와 anon/authenticated 읽기/삽입 차단을 점검한다. 누락/잘못된 접근 권한에는 `SESSION_SCHEMA_INCOMPLETE`로 종료하고 연결을 정리한다. 사용 중 저장소 장애에는 비밀값 없는 `SESSION_STORE_UNAVAILABLE`/503을 반환하며 memory/demo로 우회하지 않는다. 기본 memory profile은 006을 기존 DB에 요구하지 않는다.

## 저장 경계

`private.human_sessions`는 다음 항목만 저장한다.

| 항목 | 의미 |
| --- | --- |
| company_id / token_hash | 회사와 SHA-256 세션 토큰 해시의 복합 PK |
| nonce / ciphertext / auth_tag | AES-256-GCM, random 12-byte nonce, 16-byte tag |
| expires_at / created_at | 고정 최대 30분 수명, 만료 검사/인덱스 |

JWT·인간 사용자 UUID·CSRF·원래 만료 시각은 암호문 안에 있다. 원본 Cookie 토큰은 DB에 저장하지 않는다. GCM의 AAD는 버전·회사 UUID·토큰 해시에 연결되어 다른 회사/다른 Cookie 해시로 행을 복사해도 복호화를 거절한다. nonce는 매 암호화마다 새로 생성한다. [Node crypto의 GCM/AAD](https://nodejs.org/docs/latest-v24.x/api/crypto.html)

테이블은 private schema에 있고 강제 RLS를 적용한다. PUBLIC/anon/authenticated는 직접 권한을 받지 않으며 migration 소유자/신뢰 서버 DB 역할의 정책만 준비한다. 다른 서버 DB 역할을 쓸 때는 배포 담당자가 해당 역할의 최소 권한과 전용 정책을 별도로 준비해야 한다. 기존 authenticated 역할이나 에이전트에게 이 테이블 권한을 주지 않는다. MCP 도구·public SQL RPC로 노출하지 않는다. [PostgreSQL RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)

## 요청과 만료

1. 같은 출처의 `GET /api/human/session`에 외부 JWT를 제출한다. provider의 getUser로 신원을 확인한 다음에만 세션을 저장한다.
2. 브라우저는 random 32-byte 토큰의 HttpOnly/SameSite=Strict Cookie를 받는다. HTTPS 요청 자체에는 Secure도 설정한다. 서버의 loopback listener/Origin 검사는 그대로다.
3. 이후 요청은 회사와 토큰 해시로 행을 조회하고 GCM 검증을 거친다. 저장된 신원을 그대로 신뢰하지 않고 외부 JWT를 매번 다시 검증한다. JWT 철회·신원 불일치에는 해당 세션을 제거하고 거절한다.
4. POST 결정은 여전히 세션과 CSRF가 모두 필요하고 DB의 다른 승인자·scope·전표 version/hash 검사를 통과해야 한다. 세션 준비/복원은 장부 승인이 아니다.
5. 30분 수명은 재조회로 연장하지 않는다. 만료 행은 읽지 않고 같은 회사의 새 세션 저장 시 정리한다. 별도 스케줄러/상시 agent를 만들지 않는다.

CSRF 비교는 SHA-256 고정 길이 digest의 timingSafeEqual을 사용한다. 사용자 로그인을 위한 폼/API와 자동 승인/전기는 추가하지 않는다. [OWASP 세션 관리](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

## 검증과 남은 범위

native PostgreSQL과 stubbed Auth를 사용해 같은 Node/MCP runtime을 닫고 다시 열었을 때 동일 Cookie/CSRF 복원을 검사한다. 실제 Supabase Auth 서비스를 검증한 결과가 아니다. 회사/토큰 해시 복사, 암호문/키 변조, 만료·삭제, anon/authenticated 직접 접근, RLS가 꺼진 schema의 기동 거절을 테스트한다. 테스트는 장부 전표를 만들거나 승인/전기하지 않는다.

원격 배포에는 클라이언트별 MCP OAuth/신원·허용 HTTPS Origin/프록시·TLS·실제 provider 검증이 더 필요하다. Node가 보는 요청이 HTTP일 때 X-Forwarded-Proto를 임의 신뢰해 Secure/TLS를 완료했다고 주장하지 않는다. 이 단계는 기존 loopback 경계를 바꾸지 않았다.
