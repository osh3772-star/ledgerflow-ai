# M1 — 앱 주도 실행 구조와 공유 MCP 연결

검증일: 2026-10-14. 기존 P2-C 코드 위에 연결 계층을 추가했다.

## 변경 전 분석·백업

Git 저장소는 초기 commit이 없는 상태였다. 기존 공개 소스/문서 58개를
`.ledgerflow/backups/2026-10-14-client-runtime-1791977811894`에 저장하고
`BACKUP_MANIFEST.json`의 SHA-256 58개를 다시 대조했다.
키 파일·DB 파일·캐시·node_modules는 백업에서 제외했다.

기존 파일 중 변경한 것은 다음 10개다:
`.env.example`, `README.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`,
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `scripts/server-env.ts`,
`scripts/public-api-probe.ts`의 후속 재시도 설명 주석, `tsconfig.json`.
기존 packages의 ERP·Decimal·DB 서비스와 migration 3개, 기존 테스트 10개 파일은 변경하지 않았다.
공공 API 4개 실키는 ignored `.env.local`에 유지하며 선택적 모델 키 설정만 제거했다.
기존 실행 코드에 삭제할 유료 모델 호출·오케스트레이터·스케줄러는 없었다.

## 구현 완료

| 항목 | 결과 |
| --- | --- |
| 아키텍처·개발 계획 | AI 실행을 Claude Code/Codex의 native 역할로 변경, 자체 runner/model API/cron 제외 |
| MCP 제품 | `ledgerflow-accounting-mcp` 한 개, SDK v2 server/client 2.3.1 |
| 연결 | 한 Node 프로세스의 `http://127.0.0.1:8787/mcp`를 두 클라이언트가 공유 |
| 조회 도구 | system status, company context, transactions, unprocessed, invoices, bank, inventory, counterparties: 8개 |
| 기존 서비스 | 기존 ErpService 조회 6개를 직접 재사용, create service는 보존하고 MCP에는 노출하지 않음 |
| 데이터 | 주회사 1,000건과 격리회사 1건, 고정 seed/hash, synthetic origin 유지 |
| 보안 | 서버 고정 회사/reader, DB RLS/scope, strict 입력·출력, Host/Origin, body/page 제한, 내부 오류 마스킹 |
| 감사 | 기존 DB 조회 audit와 safe MCP handler 파일 로그, 감사 실패 시 결과 반환 차단 |
| 앱 설정 | Claude `.mcp.json`, Codex `.codex/config.toml` 같은 이름/URL; 이 PC Codex CLI에도 공식 전역 등록 |
| 여섯 역할 | 앱마다 native agent 6개/skill 6개; 역할별 조회 범위와 Task/Result 문서 |
| 로컬 실행 | demo profile, 선택 server-only postgres profile, `mcp:start` / `mcp:smoke` |

다른 전역 MCP 설정은 유지했다. 프로젝트 설정만으로 Codex CLI에서 조회되지 않아
`codex mcp add ledgerflow-accounting-mcp --url http://127.0.0.1:8787/mcp`를 실행했다.
`codex mcp get … --json` 결과는 enabled/Streamable HTTP/같은 URL이었다.
이는 등록 검증이며 앱에서 AI가 도구를 실행한 증거는 아니다.

## 검증 결과

- `pnpm check`: TypeScript 통과, **12개 파일 / 129개 테스트 통과**, 75.04초.
- 기존 119개 테스트 유지 + MCP/클라이언트 설정 10개 테스트 추가.
- 실제 HTTP: 두 SDK client 연결, 2025 legacy와 v2 auto negotiation 경로,
  같은 DB 회사/기간, 1,000건 페이지 조회, 금액·증빙 hash·은행 배분·재고 골드값.
- 회사 위조, 잘못된 limit, 미등록 쓰기 도구, hostile Host/Origin, 64 KiB 초과,
  감사 저장 실패에 대한 차단 검증.
- TOML/JSON/YAML 설정, 여섯 역할의 등록된 도구 범위와 양쪽 skill 동기화 검증.
- skill-creator의 `quick_validate.py`로 12개 SKILL.md 검증.
- 실제 `pnpm mcp:start` 후 `pnpm mcp:smoke`: 독립 SDK client 2개, 도구 8개,
  sharedCompany=true, 거래 조회 성공. 해당 실행의 외부 공공 API/모델 호출 0.
- Windows batch wrapper의 Ctrl+C가 비동기 DB 정리를 중단하는 문제를 확인해
  콘솔 `stop` 명령을 추가했다. 변경 후 타입 검사와 실제 서버 시작/`stop` 종료 코드 0,
  해당 실행의 임시 DB 정리와 PostgreSQL 프로세스 종료를 확인했다.
  강제 중단된 이전 실행의 ignored 임시 폴더는 정상 종료와 별도로 남을 수 있다.
- 공공 API 4개 환경 변수는 설정 유지. 기존 실키 4/4 성공 기록은
  [API_CONNECTIONS.md](API_CONNECTIONS.md)에 보존하며 이번 작업에서 재호출하지 않았다.
- 공개 대상 파일의 실키/인코딩된 실키 노출 검사: 0건.

도구 목록의 JSON Schema 변환 오류를 발견해 수정했다. 기존 Decimal 변환을
삭제하지 않고 기존 Zod runtime 검증을 유지하면서 MCP의 JSON Schema adapter를 추가했다.
정확한 금액 문자열 검증과 기존 fixture 결과는 유지됐다.

## 미구현·미검증

| 구분 | 상태 |
| --- | --- |
| 자동 분개 Draft·독립 전표 검증 | 미구현 |
| 전표 사용자 승인·원자적 전기·Posted 불변성 | 미구현 |
| 총계정원장·시산표·역분개·마감·재무제표 | 미구현 |
| 정식 공공 API MCP 도구·DB API 캐시 | 미구현; 기존 4종 진단/캐시는 유지 |
| 증빙 원문/계약/자산 상세 조회 도구 | 미구현 |
| native 앱에서 실제 역할 추론·업무 완료 | 미검증; 정의 파일/skill은 작성·정적 검증 |
| 실제 Claude Code 앱 연결 | 미검증; 이 환경에서 Claude CLI 설치를 찾지 못함 |
| 실제 Codex 앱에서의 도구 호출 | 미검증; CLI 등록과 SDK 프로토콜 검증만 완료 |
| postgres profile의 실제 외부 DB 연결 | 미검증; 설정/실패 조건 검증, demo는 실제 native PostgreSQL 사용 |
| Supabase Auth JWT/PostgREST/Storage | 미검증 |
| 원격 인증/OAuth·stdio·Cloudflare | 미구현/미검증 |
| 영속 agent_tasks/agent_runs·MCP 로그 DB 저장 | 미구현; Task/Result 문서와 로컬 handler 로그만 있음 |

초기 서버는 신뢰된 로컬 개발 환경에서 가상 ERP를 읽는다. 앱별 사용자 인증과
회계 승인 구현 전에 인터넷 공개/실제 장부 전기를 지원한다고 표시하지 않는다.
회계 정확도·K-IFRS 완전 준수 평가를 통과했다고 주장하지 않는다.

## 다음 최소 단위

M2: 기존 `LF26-SAL-0101` 거래와 증빙/계정을 읽고, 결정론적 매출 분개
`Draft`를 생성·검증하는 공통 서비스와 MCP 도구를 추가한다.
수기 gold의 계정·차대변·정확한 금액 비교와 차대변/계정/증빙/기간 오류 차단을
먼저 통과시킨다. 승인·전기·시산표는 M3/M4에서 순서대로 구현한다.
