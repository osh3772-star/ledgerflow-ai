# 기존 Supabase 연결: 단계별 진행

2026-10-16. 사용자가 선택한 기존 `회계자동화` 프로젝트를 재사용한다. 새 프로젝트·유료 옵션·추가 MCP 서버를 만들지 않는다. 설정값은 ignored `.env.local`에만 두며 기존 공공 API 키를 보존한다.

현재 실제 진단: 세 연결값 입력과 프로젝트 일치 검사를 통과했다. 공개 CA 등록 후 인증서 오류 대신 `DATABASE_AUTHENTICATION_FAILED`가 반환됐다. Auth health는 HTTP 200/GoTrue로 응답했다. 사용자명·DB 비밀번호·URL 인코딩 확인이 필요하며, 비밀번호가 원인이라고 단정하지 않는다. 사용자 인증·DB schema는 미검증이며 실제 마이그레이션·초기 적재·장부 변경은 0회다.

## 현재 우선순위: 로컬 실행판 마무리

연결값 입력·공개 CA 등록은 완료한 작업이다. 사용자는 반복 설정 요청보다 시연판 마무리를 우선하도록 요청했다. 현재 추가 Aside 작업은 없으며 [로컬 실행판](PORTFOLIO_READY.md)을 `pnpm start`로 사용한다. Supabase 인증 오류는 미완료로 남기고 설정은 보존한다. 이후 명시적으로 재개할 때만 연결정보를 대조한다. 프로젝트 URL은 `https://tbmdjifuqnnevduhbagd.supabase.co`다. 키·비밀번호·전체 연결 문자열을 채팅으로 전달하지 않는다.

이 PC의 지속 Node 프로세스에는 Connect 화면의 **Session pooler / 5432** 문자열을 사용한다. IPv4에서도 사용할 수 있으며 host를 리전 이름으로 조합하지 않는다. DB 비밀번호의 예약 문자는 URL 인코딩한다. Direct 연결은 IPv6 또는 유료 IPv4 옵션 여부를 따로 확인해야 하며, 이 프로젝트를 위해 유료 옵션을 켜지 않는다. [공식 연결 명세](https://supabase.com/docs/guides/database/connecting-to-postgres)

`.env.local`의 사용자/회사 UUID·실행 mode·인간 세션 설정은 바꾸지 않는다. `pnpm start`는 해당 프로세스에만 명시적으로 폐기형 demo를 선택한다. 지속 DB 전환은 실제 Auth 신원과 최소 권한 준비 후 별도 수행한다.

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

첫 진단은 `TLS_CERTIFICATE_ERROR`였으며 공개 CA 파일을 ignored `.ledgerflow/certs/` 아래 등록했다. 재검사에서 인증서 오류는 사라졌고 DB 인증정보 거절로 진행했다. 기존 SSL enforcement 설정을 변경하거나 DB를 재부팅하지 않았다. 등록한 `LEDGERFLOW_DATABASE_CA_FILE`은 그대로 유지한다.

연결 진단과 지속 runtime은 같은 설정 함수를 사용한다. Supabase DB에는 항상 `rejectUnauthorized: true`를 적용하고 CA/hostname을 검증한다. URL의 SSL 옵션으로 검증이 사라지지 않도록 hosted 연결은 명시적 필드를 사용한다. CA는 필요하면 별도 PEM 인증서로 제공하며 값·원문은 출력하지 않는다. [Supabase SSL/CA](https://supabase.com/docs/guides/platform/ssl-enforcement), [node-postgres SSL 옵션 주의사항](https://node-postgres.com/features/ssl)

## 인증정보 거절의 처리

`DATABASE_AUTHENTICATION_FAILED`는 DB가 인증정보를 거절한 결과다. Connect 화면의 Session pooler 사용자명과 연결 대상부터 대조하고 사용자가 DB 비밀번호를 직접 입력한다. URI 예약문자는 한 번만 percent-encode하며 전체 URI를 다시 인코딩하지 않는다. 비밀번호 재설정·키 교체·TLS 해제를 자동 수행하지 않고, 수정 전 잘못된 인증을 반복 재시도하지 않는다. [공식 진단](https://supabase.com/docs/guides/troubleshooting/fatal-password-authentication-failed).

추가 네트워크 호출 없이 현재 설정 선택을 검사했다. DB 키 중복 없음, 상속된 DB URL 없음, 활성 URL/project/key와 파일 값 일치, Session pooler 사용자명/5432/postgres 일치, 드라이버 user/password의 URI decode 일치, 비밀번호 앞뒤 공백 없음, publishable key 오입력 아님을 boolean으로 확인했다. 실제 비밀번호·문자열은 출력하지 않았다. 이 결과는 DB의 실제 비밀번호가 맞다는 검증이 아니며 현재 단계에서 재입력을 반복 요구하지 않는다.

## 초기 schema 설치 명령

```powershell
# 네트워크/DB 호출 없이 원본 6개 파일의 순서·SHA256·transaction framing 확인
pnpm supabase:init --offline
# 연결 성공 후 읽기 전용으로 기존 namespace와 설치 receipt 점검
pnpm supabase:init
# Codex가 계획을 검토한 후 같은 bundleHash와 실제 프로젝트를 지정해 초기 적용
pnpm supabase:init --apply --project=tbmdjifuqnnevduhbagd --hash=<계획의-bundleHash>
```

이 명령은 소스 개발/초기 DB 설치용이며 MCP 도구·범용 SQL 실행 도구가 아니다. 현재 실제 DB에는 실행하지 않았으며 사용자가 Aside에서 수행할 작업도 아니다. 원본 001~006 파일을 변경하지 않고 메모리에서 최외곽 BEGIN/COMMIT만 묶어 **한 트랜잭션**으로 적용한다. 프로젝트·hash 불일치, 기존 public/private 사용자 객체, 로컬 Auth bootstrap 표식은 거절한다. Auth/Storage가 이미 제공되어야 하며 실제 Auth 사용자를 직접 INSERT하지 않는다.

잠금·statement timeout과 트랜잭션 단위 advisory lock을 적용한다. 오류면 전체 rollback, 성공하면 private/RLS `ledgerflow_initialization`에 hash/manifest receipt를 함께 기록한다. 동일 receipt/schema의 재실행은 쓰기 없이 종료한다. 기존 schema의 upgrade·adoption·repair나 Supabase CLI migration history 점검/변경은 지원하지 않는다. 기존 public/private 객체는 자동 거절한다. 이미 CLI migration을 사용하는 프로젝트는 이 명령을 적용하지 않고 별도로 history 정합성을 검토한다. 향후 CLI migration 관리 전환도 별도 작업이다. [공식 migration 관리](https://supabase.com/docs/guides/deployment/database-migrations).

검증은 테스트 소유 native DB에서 수행한다. 오류를 후기 DDL에 주입해 앞선 테이블까지 rollback됨을 확인하고 unrelated 데이터 보존·재실행·사용자/ERP/전표 0행을 확인한다. hosted DB 적용 성공이나 hosted Auth/Storage 서비스 성공의 증거로 사용하지 않는다.

## 초기화 후 Codex의 다음 최소 단위

연결 성공 후 위 읽기 계획을 확인한 다음 초기 schema를 적용한다. 로컬의 `auth-bootstrap.sql`이나 Auth 사용자 직접 INSERT를 Supabase에 적용하지 않는다. 기존 001~006 migration을 보존하며 실제 Auth 사용자와 최소 scope를 준비한 다음 별도의 hosted fixture 적재 절차를 구현·검증한다. 기존 `seedFullDatabase`는 native bootstrap 전용이며 hosted 적재로 우회하지 않는다. 이때까지 회사·사용자 UUID를 임의로 `.env.local`에 넣지 않는다.

실제 Auth JWT 검증, private Storage 업로드/회사 격리, 1,000건의 hosted 초기 적재, 서버 profile 전환은 각각 후속 검증이다. 접속 성공이나 구조 점검만으로 승인·전기까지 완료했다고 보고하지 않는다.
