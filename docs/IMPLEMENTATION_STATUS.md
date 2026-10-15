# Implementation and verification status

2026-10-15 KST. 사용자가 요청한 기존 프로젝트 유지·미구현 회계 기능 추가 작업의 결과다. 실제 장부 운영을 수행한 보고가 아니라 소스 개발과 합성 fixture 테스트 결과다.

## 구현 완료

- 단일 MCP 제품 `ledgerflow-accounting-mcp`, foreground HTTP/stdio, 두 앱 공유 DB·연결 설정.
- 읽기 전용 `mcp:doctor`: 프로젝트/현재 Codex 등록, 41개 도구·회사 범위 읽기, 비밀값 없는 진단 파일.
- 기존 PostgreSQL 기동 schema gate와 실패 시 연결 정리, 서버 재기동 후 Draft/hash 보존.
- ERP 1,000건과 보조자료, 원본 001~003 migration, 기존 테스트·공통 ERP 서비스·Decimal·공공 probe 보존.
- 10종 원천 거래의 결정론 Draft, 차대변·계정·증빙 hash·기간·중복 검증.
- 웹의 명시적 승인/반려, 별도 DB 승인자·CSRF·version/hash, 권한 철회 재검사, 원자적 Posted, 불변 전표.
- 원장·시산표·누적 BS·기간 IS, 승인받는 역분개, 반려/미게시 폐기 이력.
- 자산·선급 월말 차액 Draft, 모든 거래/결산 전기 후 기간 마감.
- 은행·ERP 배분·게시 현금 대사, 금액/방향/날짜/원천 일치 조건의 멱등 match.
- 무료 공공 API 4종 Adapter와 11개 도구, timeout/retry/rate/cache/provenance, live 장애의 mock 성공 전환 금지.
- 두 앱 각각 native agent/skill 6역할, Zod terminal Result 영속 기록과 허위 Posted 주장 거절.
- Astro React 대시보드, 실제 전표·근거·귀속일·버전·hash·증빙 원문 검토.
- Supabase Auth/Storage 연결 코드, private evidence bucket/회사 RLS, 인간 JWT·canonical JSON/hash 보관과 멱등 재시도.
- 공개용 아키텍처/계획/연결/역할/도구 명세, 41개 도구의 전체 schema와 합성 요청/응답 예시, CI/Docker 실행 초안.
- 사용자/Codex 담당표와 `deploy:check`, 비관리자 Docker/단일 Compose/health/foreground smoke 코드, Windows/Linux CI와 이미지 내부 smoke 단계.
- Aside AI용 단계별 명령 5개, 소스/DB 병행 수정 방지와 인간 승인 경계.
- 외부 JWT profile의 선택적 PostgreSQL 세션: 006 private/RLS·AES-GCM·토큰 해시·회사 AAD·재기동 복원·JWT 재검증.
- ignored `.env.local`의 비출력 `session:key`, 유효한 기존 키/설정 보존, 서버 키/MCP bearer/DB URL 노출 검사 확대.

## 검증 결과

| 검사 | 결과 |
| --- | --- |
| `pnpm check` | Windows 임시 DB 정리 재시도 보강 후 전체 192 tests / 26 files 통과, 약 223초 |
| `pnpm web:build` | Astro static build 통과 |
| `pnpm evaluate` | Draft 성공 1,000/1,000, 계정 set 분류 1,000/1,000 |
| 수기 분개 gold | 10/10 line exact match, 기존 매출 gold 유지 |
| 합성 오류 holdout | 오류 5개 모두 탐지, 정상 10개 false positive 0 |
| HTTP SDK 공유 | 클라이언트 2개, 도구 41개, 같은 회사/DB, 거래 조회 성공 |
| stdio SDK | 같은 foreground 프로세스의 stdio Draft를 HTTP에서 조회 성공 |
| 승인/전기 통합 | 로그인 없는 local browser test session + CSRF 결정 전에는 post 거절, 결정 후 DB Posted/TB 확인 |
| 결산 통합 | 완결된 2월의 원천/수정 전표를 테스트 인간 신원으로 승인·전기 후 마감, 이후 쓰기 거절 |
| 회계 방어 | 중복·외국 회사·마감·승인 hash 오류·권한 철회·라인 변조·Posted 변조 차단 |
| native 설정 | 두 앱 동일 endpoint·현재 allowlist, role/skill 동기화 |
| `pnpm mcp:doctor` | 실행 서버 41개 도구·회사 범위 1건 조회, 두 프로젝트 설정 일치, Codex CLI의 enabled HTTP 등록 일치 |
| 기존 PostgreSQL runtime | 3개 통합 검사: Draft/hash 재기동 보존, 미완성 schema 무변경 거절, 익명 승인/회사 위조 거절과 실패 시 pool 정리 |
| `pnpm deploy:check` | 로컬 준비 확인; GitHub 로그아웃·commit/remote 없음·Docker 미발견·Supabase 미설정을 담당자별로 출력 |
| `pnpm container:smoke` | Windows 호스트의 테스트 소유 DB/mock에서 health·41개 도구·회사 내 1건 읽기 후 정상 종료; 실제 Docker 검증 아님 |
| CI/Compose 파일 | YAML 파싱 확인, Windows/Linux matrix·contents:read·단일 host-network 서비스; 원격 실행 아님 |
| PostgreSQL 세션 집중 검사 | 5개 통합 테스트: runtime 재연결·같은 Cookie/CSRF, 암호문 비노출, 회사/해시 복사·변조·만료·직접 접근·잘못된 RLS 거절; Auth는 stub |
| 세션 단위 검사 | TTL/삭제/암호화·키·JWT 철회·저장소 장애·CSRF·HTTPS Cookie·키 파일 보존/lock 검증 |
| skill validator | 12/12 유효 |
| 키 노출 검사 | 공개 대상 169개 파일에서 실제 API/서버 키 raw/encoded 노출 0 |
| 수정 전 백업 | 99개 source/doc, SHA mismatch 0, 키 미포함 |
| 원본 보존 재검사 | migration 001~003과 ERP 생성 코드 2개가 기존 백업의 SHA와 일치 |

최근 evaluation은 약 59ms였으며 메모리 내 합성 Draft 생성/분류만 측정한다. DB round trip·앱 AI 추론·인간 승인 대기 시간을 포함하지 않는다. 이전 측정 70~191ms와 같은 환경에서도 변동하므로 운영 처리량 보장으로 사용하지 않는다. [측정 JSON](EVALUATION.json)

MCP 도구 호출의 duration/outcome/errorCode는 `mcp_tool_calls`와 ignored JSONL에 기록한다. 고의적인 validation/권한 거절과 정상 처리 실패를 분리해 성공률을 계산해야 한다. 프로젝트가 호출한 유료 모델 API는 0회/0원이며 구독 앱의 추론량·비용은 미측정(null)이다.

수기 gold는 10개뿐이다. 나머지 990개는 독립 line-level 정답이 아닌 계정 분류 검증이다. 작은 합성 정상/오류 표본의 Precision/Recall=1을 실제 기업 회계 정확도나 AI 판단 정확도라고 주장하지 않는다.

Storage policy는 회사 A writer 생성/A reader 조회 성공, 회사 B의 유효 preparer 조회 0, read-only writer·외국 회사 prefix·잘못된 UUID 경로 거절을 확인했다. PostgreSQL stand-in 테이블 검사이며 hosted Storage의 인증/업로드 서비스 검증은 아니다.

## 실제 공공 API 확인 범위

2026-10-14 실키 진단과 이후 Adapter 읽기 요청으로 확인했다. 최초 4회 진단 기록은 [API_CONNECTIONS.md](API_CONNECTIONS.md)에 보존한다.

| API / 실제 확인 | 증거 | 남은 범위 |
| --- | --- | --- |
| 국세청 상태조회 | HTTP 200/status_code OK, 미등록 테스트 번호 정상 응답 | 실제 거래처 정상 영업·진위 매칭 미검증 |
| DART 공시검색 | status 000, 공시 응답 | 실제 감사보고서 문서 다운로드 미구현 |
| DART 전체 재무제표 | 2025/CFS/연간, status 000, 계정 229행 | 기업 비교는 mock/파생 로직, 실제 업종 자동 매칭 없음 |
| 법령 검색·제1조 | 법인세법 시행 버전과 6자리 JO 응답, 시행일 2026-07-01 | 모든 과거 개정/부칙 적용 판단은 인간 검토 |
| ECOS GDP | 검증한 registry와 실제 연도 관측 | 임의 통계 자동 발견 없음 |
| ECOS USD 환율 | 2026-10-14 관측, 단위 원, 요청/관측일 기록 | JPY 100엔은 metadata/단위 registry 검증; 모든 통화 live 아님 |
| ECOS 기준금리 | 2026년 1~9월 9개 관측 | 시장금리/별도 일별 시리즈 없음 |

전체 11개 공공 도구는 네트워크 없는 mock에서 테스트한다. 공공 자료는 `public_api_live`/`mock` 출처이고 가상 장부로 적재하지 않는다. 조회 결과만으로 법령 적용·세금·K-IFRS 결론이 확정되지 않는다.

## 미검증 / 미구현 구분

| 항목 | 상태 / 필요한 다음 작업 |
| --- | --- |
| 실제 Claude Code와 Codex의 연결·역할 추론 | 설정/SDK/자가진단 완료, Codex CLI 등록 일치; Claude Code 실행 파일 미발견, 실제 앱 추론 수용 테스트 미수행 |
| 실제 Supabase Auth/Storage/PostgREST | 연결 코드·policy 구현, URL/publishable/DB 연결 정보 미설정으로 hosted 검증 미수행 |
| Storage RLS SQL | PostgreSQL stand-in 테이블에서 policy 검증, 실제 Storage 서비스/JWT 검증과 구분 |
| 외부 지속 PostgreSQL runtime | 기존 DB profile의 재연결·보존을 테스트 소유 native DB로 검증; 실제 외부 서버 연결값 미설정 |
| 원격 MCP OAuth·HTTPS·외부 세션 저장소 | 암호화 PostgreSQL 세션은 구현/로컬 검증; 실제 provider·MCP OAuth/HTTPS는 미구현/미검증, loopback 유지 |
| GitHub 공개/CI 실행 | 공개 `osh3772-star/ledgerflow-ai`·origin 준비; 앱 초기 파일 생성이 403으로 거절됐으며 CLI 미인증, 원격 업로드/CI 미수행 |
| Docker 이미지 실행 | 비관리자 이미지·Compose·health·smoke 작성; Windows source smoke 통과, Docker 미설치 환경에서 실제 build/run 미검증 |
| Cloudflare backend | 미배포; native DB/fs/Node HTTP/session 때문에 Workers 전체 호환 미입증 |
| 전문 회계/세무 범위 | 세금 산출·현금흐름표·주석·전문가 K-IFRS 검토·실제 은행/정부 세금계산서 연동 미구현 |

무료 개발 경로는 로컬 Node+DB+기존 앱 구독이다. Supabase Free/Pro와 배포 제약은 [ARCHITECTURE.md](ARCHITECTURE.md)에 공식 출처와 함께 정리했다.

## 재현 및 다음 최소 단위

```powershell
pnpm check
pnpm evaluate
pnpm web:build
pnpm deploy:check
pnpm container:smoke
pnpm mcp:start
# 다른 터미널
pnpm mcp:smoke
pnpm mcp:doctor
pnpm mcp:catalog
```

`pnpm mcp:examples`는 **폐기 가능한 demo + mock에서만** 문서용 Draft/승인 요청과 오류 예시를 생성한다. 인간 승인/Posted는 수행하지 않는다. 출력은 `MCP_EXAMPLES.json`이며 영구 DB/live 환경에서는 실행을 거절한다.

다음 최소 단위는 실제 두 앱에서 공유 매출 Draft 하나를 조회·검증·승인 요청하고, 사람이 화면에서 결정한 뒤 앱이 DB Posted와 시산표를 확인하는 수용 테스트다. 로컬 demo는 로그인 없이 바로 승인·반려 버튼을 사용할 수 있다. 같은 출처 브라우저 세션을 자동 준비하지만 자동 승인·전기는 하지 않는다. 이 개발 모드는 인간 신원 인증이 아니며 지속 DB에는 외부 인증이 필요하다. Supabase 실검증에는 개발 프로젝트 연결값과 실제 Auth 사용자 provision이 필요하다.

2026-10-15 변경: 로그인 폼·로그인 API·데모 비밀번호 설정을 제거했다. 로컬 브라우저 세션만으로 사용자의 명시적 승인/반려가 가능하고, 지속 DB는 외부 JWT 검증을 유지한다. 누락 CSRF·다른 출처 세션 요청·익명 지속 DB 요청 거절과 실제 PostgreSQL 전기 흐름을 테스트했다. 이번 브라우저 화면 검증은 자동 승인 검사의 localhost URL 접근 거절로 수행하지 못했으며 웹 build는 통과했다.

후속 변경: `mcp:doctor`의 실행 서버 진단을 통과했으며 `.ledgerflow/readiness/latest.json`에 비밀값 없는 결과를 저장했다. 기존 PostgreSQL profile은 독립 native DB에서 재기동 보존과 초기화 실패 시 pool 정리를 검증했다. 이 단계에서 공공 API/유료 모델 API 호출과 실제 사용자 장부의 승인·전기는 수행하지 않았다. 검증용 foreground 서버는 정상 종료했다.

담당 분리 후 [사용자 작업과 Codex 작업](WORK_ASSIGNMENTS.md), [배포 실행 문서](DEPLOYMENT.md)를 추가했다. 배포 준비 명령과 smoke는 장부 승인/전기를 하지 않는다. Docker/CI 관련 수정 전 공개 source/doc 9개를 실제 키 없이 별도 백업했다.

Aside용 [독립 명령 5개](ASIDE_TASKS.md)와 [선택적 세션 저장 설계](SECURITY_SESSIONS.md)를 추가했다. 세션 관련 기존 source/doc 11개를 실제 키 없이 백업한 뒤 006만 새로 추가했다. 이 구현은 로그인 UI/API·자동 승인·전기·새 MCP 서버·스케줄러를 추가하지 않았으며 실제 사용자 환경의 DB/키 설정도 변경하지 않았다.

GitHub 초기 공개 점검에서 native 역할 frontmatter의 LF와 기존 migration/generator의 원본 bytes를 Git 속성으로 고정했다. CI는 main push와 PR만 대상으로 같은 변경의 중복 branch-push 실행을 줄였다. Windows의 임시 DB 정리 `EBUSY`를 재현해 소유한 임시 경로의 삭제에만 제한된 재시도를 적용했다. 계정 저장소 push 권한과 연결 앱의 실제 쓰기 권한은 구분하며, 403 이후 다른 API로 우회하지 않았다.

아래 이미지는 로그인 제거 전의 검증 기록이다.

![이전 승인 검토 화면: 합성 Draft, 승인 미수행](screenshots/approval-review.png)
