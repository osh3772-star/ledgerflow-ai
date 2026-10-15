# Phase 2-A — 최소 ERP 기반 구현·검증

검증일: 2026-10-14 (Asia/Seoul). 범위: 한 달의 가상 거래 10건과 별도 회사 격리 fixture 1건.

## 구현

- pnpm workspace: contracts, test-data, data-access, application-services.
- Zod strict schema: UUID·달력일·금액 문자열·거래 합계·지원 KRW 범위.
- Decimal 계산: Number로 금액 계산하지 않고 고정소수 문자열을 사용.
- SQL: companies, company_memberships, principals, principal_scopes, fiscal_periods, accounts, source_documents, business_transactions. private seed manifest 포함.
- 고정 시드·namespace UUID v5·증빙 SHA-256·canonical manifest.
- 트랜잭션 seed 재적재, 기존 증빙/거래의 hash 충돌 거절과 전체 rollback.
- 공통 ERP 거래 조회 서비스, 회사·조회 조건에 바인딩한 cursor.
- 서버 전용 .env.local, 공개 빈 .env.example, 키 값 없는 설정 확인 CLI.
- 사전 매출 정답 fixture. 회계 엔진 결과로 정답을 생성하지 않았고 전문가 검토 여부는 false로 명시.

거래처·계약·재고·은행·전표·원장은 아직 구현하지 않았다. JSON 증빙은 DB content에 저장하며 storage_path=NULL은 Supabase Storage 미업로드를 뜻한다.

## 수행한 검사

| 검사 | 결과 |
| --- | --- |
| pnpm typecheck | 통과 |
| pnpm test / pnpm check | Vitest 4파일, **48개 테스트 통과** |
| native SQL 환경 | PostgreSQL **17.10**, Windows x64, Node **24.19.0** |
| pnpm demo | 회사 A 10건 / 회사 B 1건, 타사 조회 거절, 반복 seed 재사용 |
| 별도 프로세스 seed:mini 2회 | 동일 manifest hash |
| git check-ignore | .env.local과 .ledgerflow 제외 확인 |
| 공개 .env.example | Git 제외 대상이 아니며 키 값은 비어 있음 |
| env:check | 키 설정 여부만 출력, 전체 환경변수·키 값 출력 없음 |
| 외부 API·AI 호출 | **0회** |

manifest:

~~~text
generatorVersion: lf-mini-v1
seed: 20261014
sha256: 79ab1f1553def4259ca48c5bcb15397f466d71fc59f6131cbd02f8859b542abc
demoTransactions: 10
isolationTransactions: 1
totalTransactions: 11
~~~

DB 테스트는 필터 없는 SELECT의 RLS, 타사 INSERT WITH CHECK, 권한 상승·상태 조작 거절, 타사/누락 증빙·기간 복합 FK, 합계·음수·소수 원 금액, 큰 정수의 정확성, public API origin 혼입, 중복 키, 기간 중복, 닫힌 기간, membership 만료·principal 취소, cursor 재사용, pool의 주체 초기화, seed 충돌 rollback을 포함한다.

시간은 로컬 마지막 전체 테스트 14.32초다. 회계 자동화 1,000건 처리 성능이나 공공 API 처리 시간의 측정값이 아니다.

## 구현 결정과 설계 차이

금액 저장에서 numeric(24,6)는 CHECK 전에 입력을 scale에 맞춰 반올림할 수 있다. 0.0000001원이 0으로 바뀌어 부적절한 값이 통과하지 않도록 이 단계의 **KRW 원거래 열은 unconstrained numeric + 정수·비음수·18자리 상한 CHECK**를 사용했다. 정확한 입력을 유지한 상태에서 검증하며 해당 음성 SQL 테스트가 통과했다. 후속 분개·환율 모델도 RPC 입력 검증과 저장 타입을 함께 검토한다.

현재 서비스는 검증된 사용자 주체를 repository 생성 시 바인딩하고 SET LOCAL ROLE/claim을 트랜잭션 안에서만 설정한다. 이는 native 테스트 환경용 신뢰 경계다. 실제 HTTP/MCP 주체 검증은 후속 인증 계층에서 수행해야 한다. 사용자 입력으로 userId를 받아 서비스 주체를 결정하는 API는 만들지 않았다.

## 남은 검증

이번 검사는 실제 PostgreSQL 계산·제약·RLS 검증이다. **Supabase 전체 스택 테스트는 아니다.**

- tests/support/auth-bootstrap.sql은 auth.uid()/auth.users의 테스트용 대체 객체다.
- 이 파일은 실제 Supabase에 적용하지 않는다.
- seedMiniDatabase는 private.native_test_bootstrap marker가 없는 DB에 쓰기를 거절한다. 실제 Supabase 사용자 생성은 별도 Auth provisioning 절차가 필요하다.
- Supabase Auth JWT·PostgREST·Storage·원격 회사 격리·실키 공공 API·Cloudflare는 미검증이다.
- 개발 PC에 Docker/Supabase CLI가 없어 계획의 Supabase local 전체 gate는 보류했다. native PostgreSQL 경로로 SQL 검증과 구현을 진행했고 이 대체 경로를 명시했다.
- 회계 엔진이 없으므로 분개 정확도·K-IFRS 준수·전기 성공률을 보고하지 않는다.

## 다음 단위

P2-B에서 가상 거래 1,000건과 거래처·계약·재고·은행의 참조 일관성을 확장한다. 실제 Supabase 개발 환경에서 Auth·RLS·Storage 검증을 병행하고, 그 이후 Phase 3의 Draft/검증/승인/전기 최소 흐름을 구현한다.

실행·키 입력 방법은 [README](../README.md), 전체 설계는 [ARCHITECTURE](ARCHITECTURE.md)를 참조한다.

참고: [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [Supabase RLS와 grants](https://supabase.com/docs/guides/database/postgres/row-level-security), [embedded-postgres](https://github.com/leinelissen/embedded-postgres).
