# 공공자료 공유 연결

회계 프로그램은 각 사용자의 PC에서 실행하고, 공공 API 키 4개는 운영자의 Cloudflare Worker가 보관한다. **기존 MCP 서버는 하나**다. Worker는 MCP 서버가 아니라 11개 공공 조회만 중계하는 HTTP 서비스다. AI 추론·장부·사용자 승인·DB를 클라우드 중계기에 올리지 않는다.

**2026-10-16 실제 배포 완료:** `https://ledgerflow-public-reference-gateway.eric5833.workers.dev`. 주소는 `config/public-gateway.json`에 포함되어 있다. 인증된 네 기관의 주요 조회 6개와 과거 거래일 근거 수집을 확인했다. 접속 토큰은 저장소에 포함하지 않는다. 이 URL은 공공자료 API 주소이며 회계 대시보드 주소가 아니다.

## 처음 사용하는 사람

1. [설치 안내](GETTING_STARTED.md)대로 저장소를 받고 의존성을 설치한다.
2. 운영자에게 **중계 주소와 전용 접속 토큰**을 받는다. 원본 국세청·DART·법령·ECOS 키는 필요 없다. 토큰은 공개 게시물·GitHub·AI 대화창에 붙이지 않는다.
3. 프로젝트 터미널에서 아래 명령을 실행하고, 토큰 입력 안내에 직접 입력한다. 입력값은 화면에 표시되지 않는다. 공개 배포 주소가 저장소에 등록되어 있으면 주소 인수는 생략할 수 있다.

현재 공개 주소가 등록되어 있으므로 **`pnpm gateway:connect`**만 실행하면 된다. 접속 토큰은 운영자에게 별도로 받아 입력한다.

```sh
pnpm gateway:connect https://운영자가-알려준-주소
pnpm start
```

연결 명령은 ECOS 금리 요청 1회로 실제 응답을 확인한 뒤, ignored `.env.local`에 URL·토큰 두 값만 기록한다. 다른 설정을 보존한다. 서버가 이미 실행 중이면 그 터미널에 `stop`과 Enter를 입력한 뒤 다시 실행한다. demo 종료 시 임시 장부가 초기화되므로 필요한 시연 결과는 먼저 확인한다.

수동 설정도 가능하다. **MCP 클라이언트 설정에는 공공 키나 접속 토큰을 넣지 않는다.**

```dotenv
LEDGERFLOW_PUBLIC_GATEWAY_URL=https://운영자가-알려준-주소
LEDGERFLOW_PUBLIC_GATEWAY_TOKEN=운영자에게-별도로-받은-토큰
```

이후 Claude Code·Codex는 기존 `http://127.0.0.1:8787/mcp` 하나에 연결한다. `get_system_status.publicApiConfiguration.mode=gateway`를 확인한다. 새 분개를 요청하면 공공 참고자료가 함께 조회된다. ‘공공자료’ 메뉴에서는 전표를 만들지 않고 거래별 참고자료만 확인할 수 있다.

**저장소만 받으면 자동 실조회가 되는 것은 아니다.** 공유 서버가 아직 배포되지 않았거나 토큰을 받지 않았다면 기본 샘플 모드를 사용한다. 개인의 공공 API 키 4개를 직접 등록하고 `pnpm api:live`로 켜는 방식도 유지한다. gateway URL을 비우면 직접 mock/live 방식으로 돌아간다.

## 회계에서 사용하는 범위

| 자료 | 자동 조회 / 검토 근거 | 자동 확정하지 않는 것 |
| --- | --- | --- |
| 국세청 | 운영자가 별도로 지정한 실사업자 매핑이 있을 때만 현재 상태 참고. 현재 가상 거래처는 실사업자번호가 없어 제외 | 가상 거래처 정상 영업·과거 상태·매입세액 공제. 진위확인은 별도 필수 입력으로 도구 호출 |
| DART | 지정 기업의 연간 연결 재무계정 일부. 기본 기업코드 `00126380`, 1~3월 거래는 전전년도, 이후 전년도 | 동종업계 적합성·거래 당시 공개 여부·정정 여부 보증. 외부 매출을 우리 장부에 합산하지 않음 |
| 법령 | 세액이 있는 거래는 부가가치세법 제30조, 나머지는 법인세법 제1조. 현재→필요 시 연혁 검색 후 거래일 이전 시행 버전 선택 | 모든 법조문·부칙·개별 적용요건의 완전 검토, 세금 산출·K-IFRS 결론 |
| ECOS | 거래 월의 기준금리 | 계약 이율·할인율 산정·외화평가. 기존 환율/통계 도구는 별도로 호출 가능 |

법령의 `nw=1`은 연혁, `2`는 시행예정, `3`은 현행이다. 검색 20건 안에 적합한 버전이 없거나 조문 본문 시행일이 다르면 `unavailable`로 남긴다. 보고서의 `humanReviewRequired=true`, `affectsAmounts=false`는 항상 유지된다.

`get_accounting_source`와 **새로운** `propose_journal_entry`는 같은 `AccountingReferenceService`를 사용한다. 새 전표의 `payload.publicReferences`에 조회 시각·적용일·원문 SHA·실제/샘플 origin·캐시 여부·실패 사유를 저장하며, 기존 JSONB 전표 내용 hash에 포함한다. 한 번 저장한 전표는 나중 조회로 바꾸지 않는다. 기존 전표에는 snapshot이 없을 수 있다. 결산·역분개 초안은 각 귀속일 기준으로 조회한다. 기존 fixture와 금액 규칙은 바꾸지 않는다.

참고자료 누락은 Draft에 명시되며 사람이 검토한다. 외부 조회가 성공했다고 회계 검증·사용자 승인이 끝난 것은 아니다. 분개 금액·차대변·기간·권한 검사는 독립 엔진/DB가 수행한다. 조회 실패를 샘플 성공으로 바꾸지 않는다.

## 운영자 배포

Node 24와 고정 Wrangler 4.151.0을 사용한다. 기존 프로젝트의 환경값은 ignored `.env.local`에 있어야 한다. 먼저 코드 검사를 마친 뒤 배포한다.

```sh
pnpm check
pnpm gateway:build
pnpm --filter @ledgerflow/public-api-gateway exec wrangler login
pnpm gateway:deploy
pnpm gateway:secrets
```

처음 배포한 Worker는 키와 토큰이 없어 조회를 거절한다. `gateway:secrets`가 기존 키 4개와 별도 무작위 접속 토큰을 **stdin으로** Wrangler에 전달한다. 명령 인수·출력·공개 파일에 키를 쓰지 않는다. 토큰은 운영자의 ignored `.env.local`에 보관하며 재실행 시 재사용한다. 이 명령은 기존 공공 API 키·DB 설정을 바꾸지 않는다. 운영자는 서비스 주소를 `config/public-gateway.json`에 공개할 수 있으나 토큰은 별도로 전달한다.

실제 서비스에 URL과 토큰을 설정한 후 `pnpm api:references --gateway`로 합성 증빙 기반 실조회 연동을 진단한다. 진단은 장부 생성·승인·전기를 하지 않는다. `/health` 성공은 프로세스 확인이며 네 기관 실조회 성공과 구분한다. 공급기관별 성공은 `origin=public_api_live`인 실제 결과로 확인한다.

이번 운영자 PC는 공유 연결 설정까지 마쳤고, 새 foreground MCP에서 `publicApiConfiguration.mode=gateway`와 ECOS 도구의 실제 응답을 SDK로 확인했다. 이는 Claude Code·Codex 앱 자체의 추론 수용 테스트와 구분한다.

## 접근 제한과 비용

- HTTPS bearer 토큰이 없으면 조회 불가. 토큰은 소수의 신뢰하는 시연 사용자에게만 전달한다. 계정별 토큰/OAuth·개별 정산은 미구현이다. 유출 시 토큰을 교체하고 Worker secrets를 다시 등록한다.
- 도구 11개·입력 스키마·공식 URL만 허용한다. SQL·임의 URL·장부 도구·사용자 승인 기능은 없다. 요청 16 KiB, 기관 응답 1 MiB 제한, timeout·retry·Cache API를 사용한다.
- 토큰+접속 IP별 지역적 30회/분 제한을 적용한다. Cloudflare rate limiter/캐시는 지역별 best effort이고 제공자별 500회/일 소프트 상한도 isolate 메모리 기준이다. **전 세계 공통의 엄격한 일일 쿼터가 아니다.** 기관별 발급 계정의 한도·재배포/가공 조건을 확인하고 대규모 공개 서비스 전에는 전역 예산 저장소와 사용자별 인증을 추가해야 한다.
- 기관 인증값이 들어간 URL, 원문 오류·입력·응답은 서비스 로그에 남기지 않는다. 안전한 도구명·결과코드·시간만 기록하며 Worker 로그 영속 수집은 기본 비활성이다. 각 PC MCP는 기존 도구 감사 로그를 유지한다.
- Cloudflare Free 범위에서 월 예상 추가 비용은 $0이다. 공식 기준 일 100,000 요청, 요청당 CPU 10ms 제한이며 CPU/기관 할당량을 넘으면 실패할 수 있다. 유료 전환은 하지 않는다. 기존 AI 앱 구독·별도 Supabase 비용은 별개다. 이 작은 실조회 검증은 부하 시험이나 월 청구액 보증이 아니다.

## 근거와 검증 범위

2026-10-16 공식 문서와 설치된 SDK/CLI를 확인했다. `pnpm gateway:build`는 실제 Wrangler bundle 검증으로 Node crypto·Buffer 호환과 rate-limit binding을 확인한다. 기존 PostgreSQL/native child process를 Workers에 올릴 수 있다고 가정하지 않는다. HTTP 중계기에는 MCP SDK·DB 연결·서버 파일 접근을 포함하지 않는다.

실배포 검증에서 workerd의 `redirect:'error'` 미지원과 DART의 요청 헤더 차이를 확인했다. Worker 경계에서 `manual`로 변환하고 모든 비정상 HTTP 상태를 거절해 리다이렉트 대상에 키를 전달하지 않는다. 외부 요청에는 정직한 제품명 User-Agent와 JSON Accept를 명시한다. DART 302 오류가 사라진 뒤 2025 CFS 229행과 2024 참고 계정을 실제로 확인했다. [workerd 공식 구현의 redirect 지원 범위](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c%2B%2B)

- [Workers Node crypto 지원](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Wrangler stdin secret bulk](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
- [Wrangler bundle 검증](https://developers.cloudflare.com/workers/wrangler/bundling/)
- [Rate limiting binding 및 지역 제한](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Workers 요금·무료 한도](https://developers.cloudflare.com/workers/platform/pricing/)
- [법령 시행일 목록의 nw 명세](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdListGuide)

단위 테스트는 인증 누락·과대 본문·임의 도구/URL·쿼터·mock 위장·키 비노출·캐시·법령 거래일을 검사한다. 별도 폐기형 PostgreSQL 테스트는 참조자료 hash 결합·기존 금액 보존·동시 멱등·승인 필요를 검사한다. 실제 배포/실조회 결과와 미확인 범위는 [최신 구현 상태](IMPLEMENTATION_STATUS.md)에 기록한다.
