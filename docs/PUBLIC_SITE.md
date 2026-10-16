# Cloudflare 공개 사이트

공개 주소: **https://ledgerflow-public-reference-gateway.eric5833.workers.dev/**

2026-10-16 배포 후 실제 HTTPS 화면과 API를 확인했다. 12개월·중복 없는 거래 1,000건이 조회됐으며 공개 승인/세션 요청은 403, MCP 경로는 404, 무인증 공공 API 중계 요청은 401이었다. 인앱 브라우저에서 화면을 열어 표시도 확인했다. 로컬 전체 회귀는 242개/35개 파일을 통과했다.

한빛유통 주식회사의 **조회용 미리보기**다. 방문자는 설치·로그인 없이 가상 원천 거래 1,000건을 기간별로 조회하고, 사용법과 미리 수집한 공공자료 예시를 볼 수 있다. 각 자료의 조회 시각과 실제/샘플 출처를 표시한다.

| 할 일 | 공개 사이트 | 내 PC에서 실행한 프로젝트 |
| --- | --- | --- |
| 가상 거래 1,000건·기간·페이지 조회 | 가능, 배포 시 준비한 자료 | 가능, 현재 로컬 DB 자료 |
| 처음 사용하기·앱에 보낼 요청문 | 가능 | 가능 |
| 공공자료 | 2026-01-10 거래의 보관된 예시 | 거래별 실조회·캐시 재사용 |
| 분개 초안·검증·승인 요청 | 앱에 연결할 로컬 프로젝트 설치 안내 | 연결된 Claude Code·Codex에서 실행 |
| 사용자 승인·반려·장부 반영 | 제공하지 않음 | 웹에서 직접 승인한 뒤 앱에 반영 요청 |
| 원장·시산표·재무제표 | 미전기 fixture이므로 ‘장부 반영 전’ 표시 | 실제 Posted 전표를 집계 |

공개 자료는 방문자의 로컬 작업 장부와 동기화하지 않는다. 별도의 실시간 원격 장부 서버를 구현했다고 표시하지 않는다. **로그인 없는 로컬 승인자를 인터넷에 노출하지 않는다.** Cloudflare의 `/api/human/*`와 모든 공개 변경 요청은 403이며 `/mcp`는 계속 404다. 실제 MCP 서버는 기존 로컬 서버 하나를 유지한다.

## 전체 회계 흐름을 사용하려면

1. [설치 안내](GETTING_STARTED.md)대로 프로젝트를 자신의 PC에서 실행한다.
2. 기존 MCP 연결을 확인하고 앱에 2026년 1월 미처리 거래의 초안·검증·승인 요청을 맡긴다.
3. 로컬 사이트에서 직접 검토·승인한 뒤 앱에 장부 반영을 요청한다.

공공 API 중계 연결에는 운영자가 별도로 전달하는 전용 접속 토큰을 사용한다. 공개 사이트에 원본 API 키나 접속 토큰을 포함하지 않는다. [공유 API 연결](PUBLIC_GATEWAY.md)

## 운영자가 갱신하기

```sh
pnpm check
pnpm site:deploy
```

`site:deploy`는 웹 build → 별도 임시 DB의 공개 자료 준비 → 배포 파일 키 노출 검사 → 기존 Worker 배포 순서다. 기존 `gateway:deploy`도 이 경로를 사용한다. 기존 공공 API 키 4개와 Cloudflare 로그인이 필요하며 키는 ignored `.env.local`에 둔다.

`site:prepare`는 테스트 소유 PostgreSQL fixture를 생성하고 기존 ERP·회계 서비스의 조회 결과를 내보낸다. 실제 장부에 연결하거나 전표·승인·전기를 만들지 않는다. 회사 문맥·거래·월별 조회 모델·공공자료 예시만 허용 목록으로 구성하고 임시 DB를 닫는다. 사용자 인증정보·DB URL·API 키·MCP 토큰은 내보내지 않는다. 결과 `apps/web/dist/public-preview.json`은 의도적으로 공개되는 합성 자료이며 Git에서는 ignored다.

`pnpm site:prepare`는 명시적인 mock 출처를 사용한다. `--live-references`를 지정하면 1건의 예시 증빙에 대해 실조회하고, 자료가 불완전하면 실패한다. 방문자의 화면 조회는 이 기록을 재사용하며 기관 API를 호출하지 않는다. 운영자 실조회 예시는 실제 사업자번호가 없는 국세청 항목을 제외하고 DART·거래일 법령·ECOS 자료를 포함한다.

기존 Worker에 `WEB_ASSETS` binding과 `/api/*` 읽기 전용 route를 추가했다. 정적 자산은 Cloudflare가 제공하고 공개 API는 생성된 파일만 조회한다. Node/native PostgreSQL을 Workers 안에서 기동하지 않는다. 기존 인증된 `/v1/query`와 원본 키 보관 방식은 유지한다. [Cloudflare Assets binding](https://developers.cloudflare.com/workers/static-assets/binding/), [Worker/자산 경로 선택](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
