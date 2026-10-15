# 공공 API 실키 연결 검증

이 문서는 최초 P2 진단 기록이다. 2026-10-15에는 정식 Adapter·MCP 도구 구현과 DART 재무제표/법령 조문/ECOS 환율·금리 실조회 검증을 추가했다. 최신 범위는 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)를 따른다. 아래 “후속/미구현” 문장은 당시 상태를 보존한 것이다.

2026-10-14 19:07 KST에 사용자 발급 키로 **4/4 인증·JSON 응답 검증**을 통과했다.
실제 HTTP 요청은 총 4회, 각 제공자 1회였다. 모두 HTTP 200과 정상 서비스 코드를 받았다.
공개 문서에는 인증값·인증값이 포함된 URL·원문 응답을 저장하지 않는다.

| 제공자 | 검증 엔드포인트 | 요청 범위 | 결과 |
| --- | --- | --- | --- |
| 국세청 | `POST /api/nts-businessman/v1/status` | 테스트 번호 `0000000000` 1건 | `status_code=OK`, 데이터 1건 |
| DART | `GET /api/list.json` | 기업코드 `00126380`, 2025년, page_count=1 | `status=000`, 공시 1건, 전체 수 827 |
| 국가법령정보 | `GET /DRF/lawSearch.do` | `target=eflaw`, 법인세법, `nw=3`, display=1 | `resultCode=00`, 1건, 반환 버전 시행일 2026-07-01 |
| ECOS | `GET /api/StatisticSearch` | `200Y101/A/2020/2023/10101`, 행 1~3 | 정상 관측값 3건, 반환 연도 2020~2022, 전체 수 4 |

국세청 테스트 번호는 의도적으로 미등록 번호다. **인증과 상태조회 응답을 확인한 것이며 실제 거래처의 정상 영업을 확인한 결과가 아니다.**
`verify_business`에 해당하는 진위확인에는 사업자번호·개업일·대표자명이 필요하며 이번에 호출하지 않았다.

DART 재무제표·기업 비교, 법령 본문·개정 비교, ECOS 환율·기준금리 조회는 아직 구현·실키 검증하지 않았다.
법령 반환 버전의 시행일은 거래일과 별도로 검토해야 하며 이번 검색만으로 가상회사 거래의 회계·세무처리를 확정하지 않는다.
공공 API 결과는 ERP 거래 1,000건에 혼합하지 않았다.

## 설정과 재실행

루트 `.env.local`의 서버 전용 변수:
`NTS_SERVICE_KEY`, `DART_API_KEY`, `LAW_OC`, `ECOS_API_KEY`.
첨부 파일의 `NTS_API_KEY`는 가져올 때 `NTS_SERVICE_KEY`로 변환했다.
실제 환경 파일은 Git에서 제외되고 `.env.example`에는 빈 값만 있다.
기존 `ADAPTER_MODE=mock` 설정을 유지했다.

```powershell
pnpm env:check
pnpm api:check
# 필요할 때만 새 요청을 보내기
pnpm api:check --refresh
# 추후 다른 파일에서 네 키만 가져오기
pnpm env:import 'C:\path\to\private.env'
```

`api:check`는 기본 모드와 별개로 명시적으로 실키를 사용하는 진단 명령이다.
없는 키·잘못된 인증을 mock 성공으로 대체하지 않는다.
성공 결과는 키의 SHA-256 fingerprint별로 24시간 캐시한다.
재실행에서 `attempts=0, cache=true`가 4개 모두 출력되어 추가 요청 **0회**를 확인했다.
실패 결과도 기록하지만 성공 캐시로 재사용하지 않는다.

로컬 기록은 Git에서 제외된 `.ledgerflow/api-probes/*.json`에 있다.
최초 4회 실요청 결과에는 `origin=public_api_live`, 조회 시각, 인증값을 제거한 엔드포인트,
조회 기준, HTTP·서비스 코드, 응답 SHA-256, 건수가 있다.
원문과 키는 기록하지 않으며 캐시를 사용한 검사는 최초 조회 시각과 `cacheHit`을 유지한다.

## 구현·테스트 범위

`scripts/public-api-probe.ts`의 진단 요청은 12초 타임아웃, 최대 2회 시도,
429/502/503/504 및 네트워크 오류의 제한된 재시도, 긴 Retry-After의 이연, 리다이렉트 차단을 적용한다.
인증 오류·스키마 불일치에는 재시도하지 않는다.
오류 메시지에 원문 URL·제공자 메시지·키를 포함하지 않는다.
알려진 응답 필드만 점검하고 반환 텍스트를 프롬프트나 명령으로 실행하지 않는다.

단위 테스트는 국세청 Encoding/Decoding 처리, 인증 거절, no-data 구분,
응답 구조 불일치, 법령 시행일, ECOS 인증 오류, 재시도 상한, 키 포함 예외의 마스킹,
HTML 응답, dotenv 변수 주입 방지를 검증한다. 자동 테스트에서 실키 요청을 보내지 않는다.
실키 smoke 결과는 위 표와 로컬 기록으로 별도 확인한다.

이 진단 코드는 **전체 API Adapter·MCP 도구 구현의 완료를 의미하지 않는다.**
후속 Phase 5에서 정식 Zod 입력·출력 계약, DB 캐시, 제공자별 제한 큐,
정규화된 자료 저장과 출처 추적을 공통 Adapter 서비스로 옮긴다.

## 확인한 공식 명세

- [국세청 포털](https://www.data.go.kr/data/15081808/openapi.do), [공식 Swagger](https://infuser.odcloud.kr/api/stages/28493/api-docs)
- [DART 공시검색](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001)
- [법령 시행일 목록 조회](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdListGuide)
- [ECOS StatisticSearch](https://ecos.bok.or.kr/api/#/DevGuide/DevSpeciflcation/OA-1040)
