# 기존 Supabase 연결: 단계별 진행

2026-10-16. 사용자가 선택한 기존 `회계자동화` 프로젝트를 재사용한다. 새 프로젝트·유료 옵션·추가 MCP 서버를 만들지 않는다. 설정값은 ignored `.env.local`에만 두며 기존 공공 API 키를 보존한다.

현재 실제 진단: 세 연결값 입력과 프로젝트 일치 검사를 통과했다. Auth health는 HTTP 200/GoTrue로 응답했으며 DB는 `TLS_CERTIFICATE_ERROR`로 연결되지 않았다. 사용자 인증·DB 비밀번호·장부 schema는 이 결과로 검증되지 않는다. 마이그레이션·초기 적재·장부 변경은 0회다.

## 지금 사용자 작업 한 가지

[Aside 명령 2-1번](ASIDE_TASKS.md#2-1-db-루트-ca-인증서-등록--현재-사용자-작업)으로 공개 DB 루트 CA 인증서와 파일 경로를 등록한다. 세 연결값 입력은 완료했으므로 다시 입력하지 않는다. 이미 선택한 프로젝트 URL은 `https://tbmdjifuqnnevduhbagd.supabase.co`다. 키·비밀번호·전체 연결 문자열을 채팅으로 전달하지 않는다.

이 PC의 지속 Node 프로세스에는 Connect 화면의 **Session pooler / 5432** 문자열을 사용한다. IPv4에서도 사용할 수 있으며 host를 리전 이름으로 조합하지 않는다. DB 비밀번호의 예약 문자는 URL 인코딩한다. Direct 연결은 IPv6 또는 유료 IPv4 옵션 여부를 따로 확인해야 하며, 이 프로젝트를 위해 유료 옵션을 켜지 않는다. [공식 연결 명세](https://supabase.com/docs/guides/database/connecting-to-postgres)

사용자/회사 UUID, 실행 mode와 인간 세션 설정은 아직 바꾸지 않는다. 현재 demo 서버도 재시작하지 않는다. 지속 DB의 실제 Auth 신원과 최소 권한 준비 후 명시적으로 전환한다.

## Codex의 연결 진단

```powershell
pnpm supabase:check
```

값이 없거나 서로 다른 프로젝트의 URL/DB 문자열이면 네트워크 호출 전에 거절한다. 신규 Publishable key 또는 legacy anon key만 허용하며 `service_role`/secret key로 우회하지 않는다. legacy key의 로컬 claim 해석은 형식·권한 확인이며 서명 검증이나 사용자 인증을 대신하지 않는다.

정상 설정에서는 두 검사만 수행한다.

1. `GET /auth/v1/health`에 `apikey`를 보낸다. 8초 제한, redirect 거절, 최대 8 KiB 응답, GoTrue health 확인 후 원문을 버린다. [공식 Auth 명세](https://github.com/supabase/auth/blob/master/openapi.yaml)
2. 한 개의 PostgreSQL 연결에서 `BEGIN READ ONLY`로 버전·Auth/Storage 테이블 존재·필수 LedgerFlow 테이블/RPC·RLS 활성 상태·전표 컬럼을 조회한다. 장부 행·Auth 사용자 목록·증빙 파일은 읽지 않는다. 끝나면 rollback과 pool 정리를 수행한다.

공식 [2026년 변경](https://supabase.com/changelog/42949-breaking-change-removing-access-to-openapi-spec-via-the-anon-key)에 따라 Publishable/anon key의 `/rest/v1/` OpenAPI 접근 거절을 연결 실패로 오판하지 않는다. 이 진단은 해당 endpoint를 사용하지 않는다.

결과는 콘솔과 ignored `.ledgerflow/supabase/latest.json`에 비밀값 없이 저장한다. `connectionChecksPassed`와 `ledgerflowSchemaReady`를 분리하며, schema가 없다는 이유로 자동 migration/seed를 하지 않는다. schema readiness는 구조적 gate이며 migration 파일 해시·전체 K-IFRS 준수의 인증이 아니다. `hostedAuthUserVerified`/`hostedStorageVerified`는 이 단계에서 false다.

## 인증서 오류가 나올 때만 다음 사용자 단계

현재 `TLS_CERTIFICATE_ERROR`가 반환되어 [별도 Aside 명령](ASIDE_TASKS.md#2-1-db-루트-ca-인증서-등록--현재-사용자-작업)으로 Database Settings → SSL Configuration의 서버 CA 다운로드를 안내했다. 기존 SSL enforcement 설정을 변경하거나 DB를 재부팅하지 않는다. 공개 CA 파일을 ignored `.ledgerflow/certs/` 아래 보관하고 `LEDGERFLOW_DATABASE_CA_FILE`에 그 경로만 설정한다. 등록 후 Codex가 같은 읽기 진단을 다시 실행한다.

연결 진단과 지속 runtime은 같은 설정 함수를 사용한다. Supabase DB에는 항상 `rejectUnauthorized: true`를 적용하고 CA/hostname을 검증한다. URL의 SSL 옵션으로 검증이 사라지지 않도록 hosted 연결은 명시적 필드를 사용한다. CA는 필요하면 별도 PEM 인증서로 제공하며 값·원문은 출력하지 않는다. [Supabase SSL/CA](https://supabase.com/docs/guides/platform/ssl-enforcement), [node-postgres SSL 옵션 주의사항](https://node-postgres.com/features/ssl)

## 연결 후 Codex의 다음 최소 단위

연결 성공 후 먼저 기존 schema와 migration 충돌 여부를 읽기 전용으로 확인하고 적용 계획을 만든다. 로컬의 `auth-bootstrap.sql`이나 Auth 사용자 직접 INSERT를 Supabase에 적용하지 않는다. 기존 001~006 migration은 보존하며, 실제 Auth 사용자와 최소 scope를 준비한 다음 별도의 hosted 초기화 절차를 검증한다. 이때까지 회사·사용자 UUID를 임의로 `.env.local`에 넣지 않는다.

실제 Auth JWT 검증, private Storage 업로드/회사 격리, 1,000건의 hosted 초기 적재, 서버 profile 전환은 각각 후속 검증이다. 접속 성공이나 구조 점검만으로 승인·전기까지 완료했다고 보고하지 않는다.
