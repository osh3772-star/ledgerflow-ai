# 공공 API 사양 조사 — 보존 문서

2026-10-14 공식 명세 조사 내용을 보존한다. 앱 실행 구조와 현재 도구 상태는 ARCHITECTURE.md 및 CLIENT_SETUP.md를 따른다.

## 2. 외부 공공 API 설계

### 공통 Adapter 계약

~~~ts
type Origin = "synthetic_erp" | "public_api_live" | "public_api_sample" | "mock";
type Provenance = {
  provider: "nts" | "dart" | "law" | "ecos";
  origin: Exclude<Origin, "synthetic_erp">;
  sourceUrl: string;               // key/query 민감정보 제거된 URL
  fetchedAt: string;               // UTC ISO timestamp
  effectiveDate: string | null;    // 통계관측일/법령시행일, 미제공은 null
  referencePeriod: string | null;  // DART 사업연도·분기/ECOS 기간
  rawSha256: string;
  cacheHit: boolean;
  stale: boolean;
  schemaVersion: string;
  termsCheckedAt: string | null;
};
type AdapterResult<T> = { data: T; provenance: Provenance[]; warnings: string[] };
~~~

effectiveDate를 조회시각으로 채우지 않는다. NTS 현재 상태는 과거 특정 거래일의 상태를 보증하지 않아 effectiveDate=null과 asOfLimit 경고를 준다. 기록에는 거래일도 별도로 저장한다. sample은 기관이 공개한 실응답이지만 사용자 키로 인증된 live와 구별한다.

정책 (기관 공통 명세가 아니라 프로젝트 기본값):

- 개별 요청 timeout 8초, 최대 3회 시도, full jitter 0.5/1/2초 기반. 전체 도구 deadline 25초.
- 조회성 POST 인 NTS만 안전한 재시도 대상으로 인정한다. ERP 생성/전기는 외부 HTTP 재시도 로직을 쓰지 않고 멱등성 계약으로 복구한다.
- 429/Retry-After, 5xx, timeout과 기관별 제한·장애 코드를 해석한다. 인증/입력 오류는 재시도하지 않는다. 기다림이 deadline을 넘으면 retryAt와 함께 작업 큐로 반환한다.
- provider 별 token bucket 기본 1 request/sec, 동시성 2, 내부 일일 상한 500회. 실제 승인된 상한보다 작은 값으로 설정한다. API 전체 승인키 기준 제한은 DB lease/카운터로 공유한다.
- 동일 캐시 키의 동시 요청은 single-flight, 장애 누적 시 circuit breaker 60초 후 probe. 캐시 쓰기 실패와 조회 실패를 분리 기록한다.
- JSON의 HTTP 200에도 업무 오류가 있을 수 있으므로 payload code를 검사한다. XML DTD/외부엔터티 금지, JSON singleton/array 정규화, 응답 크기·압축해제 크기 제한.
- cache key = provider + operation + canonical params hash + mode + schemaVersion + tenantScope(개인정보 조회). secret 원문은 key·URL·로그에 남기지 않는다.
- live 장애에 mock으로 자동 전환하지 않는다. 실패를 표시하고 읽기용 stale cache의 사용 여부를 명시한다. 법령/환율 적용 및 고위험 승인에 stale 자료 사용을 차단한다.
- key 없는 개발은 명시적 ADAPTER_MODE=mock. 기관별 partial live 모드는 provider 설정으로 드러낸다.
- 증빙은 private Storage, raw API payload는 접근 제한 DB JSON/Storage에 저장한다. 공개 repo에는 비식별 fixture만 포함한다.

### 2.1 국세청 사업자등록정보

[공공데이터포털 서비스·이용조건](https://www.data.go.kr/data/15081808/openapi.do), [공식 Swagger](https://infuser.odcloud.kr/api/stages/28493/api-docs)를 확인했다.

| 항목 | 공식 계약 및 프로젝트 매핑 |
| --- | --- |
| Base | https://api.odcloud.kr/api/nts-businessman/v1 |
| 인증 | serviceKey query를 기본 사용, 환경변수 NTS_SERVICE_KEY. Swagger에 Authorization header 대안도 있으나 header 형식은 live로 확인 전 사용하지 않음 |
| 상태 | POST /status?serviceKey=…&returnType=JSON, body {"b_no":["10자리 숫자"]} |
| 진위 | POST /validate?serviceKey=…&returnType=JSON, body {"businesses":[{"b_no":"10 자리","start_dt":"YYYYMMDD","p_nm":"대표자명"}]} |
| 선택 진위 필드 | p_nm2, b_nm, corp_no, b_sector, b_type, b_adr. 미입력과 빈 문자열 의미를 구분하고 선택값을 임의 생성하지 않음 |
| 응답 | status_code, request_cnt, match_cnt 또는 valid_cnt, data[]; 상태 b_stt_cd/tax_type_cd/end_dt 및 과세유형 변경 정보; 진위 valid=01/02, valid_msg, status |
| 오류 | BAD_JSON_REQUEST, REQUEST_DATA_MALFORMED, TOO_LARGE_REQUEST, 기관/GW 인증·제한 오류; HTTP 400/411/413/500 등과 body를 함께 해석 |
| 확인된 제한·조건 | 1회 최대 100건, 설명상 1일 100만건 제한, 무료·이용허락범위 제한 없음. 계정 승인 트래픽은 발급 후 재확인 |
| 데이터 시차 | 설명상 30분 동기화, 신규 개업 반영 1~2일 소요 가능 |
| 캐시 | 상태 30분, 진위 24 시간 (입력 hash 기준), 고위험 거래는 최신성 재조회 |
| MCP | get_business_status → status, verify_business → validate |

정규화는 businessNo, statusCode, taxTypeCode, closedDate, verification="matched"|"unconfirmed", asOfLimit으로 한다. valid=02는 모든 상황에서 가짜 회사라는 뜻으로 단정하지 않는다. API는 세금계산서 목록·신고서·대표자 역조회 API가 아니다. 가상 거래처는 mock에서 검증하고 실제 조회 시에는 승인된 실사업자 테스트 fixture를 별도로 사용한다.

### 2.2 금융감독원 OpenDART

[공시검색 공식 가이드](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001), [전체 재무제표 가이드](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS003&apiId=2019020), [기업 고유번호](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019018), [이용약관](https://opendart.fss.or.kr/intro/terms.do)를 확인했다. 일부 크롤러 요청 timeout은 직접 HTTPS HTML 조회로 보완했다.

| 작업 | 요청 | 응답·제약 |
| --- | --- | --- |
| 공시/감사보고서 검색 | GET https://opendart.fss.or.kr/api/list.json; crtfc_key, corp_code?, bgn_de/end_de, last_reprt_at, pblntf_ty?, pblntf_detail_ty?, page_no/page_count | status/message, total_count/total_page, list의 corp_code/report_nm/rcept_no/rcept_dt. 감사보고서는 F001/F002 검색과 뷰어 링크 제공 |
| 재무제표 | GET /api/fnlttSinglAcntAll.json; crtfc_key, corp_code(8자리), bsns_year, reprt_code, fs_div | account_id/account_nm/account_detail/sj_div, thstrm_amount/thstrm_add_amount, 이전기간 금액, currency, ord, rcept_no |
| 기업 코드 사전 | GET /api/corpCode.xml?crtfc_key=… | 확장자는 xml이지만 실제 ZIP binary 안 XML. 크기·파일명 검사 후 사전만 적재 |

환경변수 DART_API_KEY를 crtfc_key로 매핑한다. reprt_code는 11013(1분기),11012(반기),11014(3분기),11011(사업보고서); fs_div는 CFS/OFS. 회사 코드 없이 공시검색 시 기간 3개월 제한, page_count 최대 100이다. 공급기관은 일반적으로 20,000건 이상 요청에 020을 반환할 수 있고 계정별 제한이 다를 수 있다고 안내한다. 이를 모든 계정의 고정 상한으로 단정하지 않는다.

status 000=성공, 013=자료없음, 010/011/012/901=인증·접근, 020=제한, 100=입력, 800/900=장애로 정규화한다. 빈 금액은 0으로 대체하지 않고 null로 보관한다. 분기 손익의 누적/당기 금액을 구분하고 BS의 시점 잔액과 혼합하지 않는다.

compare_company_financials는 우리 서비스에서 같은 기간·통화·CFS/OFS의 계정 매핑을 검증해 유동비율/부채비율/영업이익률을 계산하는 **파생 기능**이다. 분모 0·음수자본·비교불가에는 null과 이유를 반환한다. 산업 자동분류·전수 업종 벤치마킹을 이 엔드포인트가 제공한다고 주장하지 않는다. 처음에는 사람이 승인한 비교기업 목록과 분류 근거를 사용한다.

감사보고서 원문 추출은 현재 도구 계약에 포함하지 않는다. search_disclosures는 목록과 공식 뷰어 링크를 제공한다. 원문 다운로드·감사의견 추출을 추가하려면 별도 공식 엔드포인트/이용조건/파서 테스트를 선행한다. 공시 데이터는 external evidence에만 저장한다. 최근 공시 목록 cache 1 시간, 재무정보 24 시간, 코드 사전 7일은 프로젝트 TTL이며 정정공시 확인으로 무효화한다.

### 2.3 국가법령정보 공동활용

[이용안내](https://open.law.go.kr/LSO/information/guide.do), [시행일 목록](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdListGuide), [시행일 본문](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdInfoGuide), [연혁 목록](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsHstListGuide)를 확인했다.

| 작업 | 공식 요청 형태 | 설계 선택 |
| --- | --- | --- |
| 검색 | GET www.law.go.kr/DRF/lawSearch.do; OC, target=eflaw, type=JSON, query, nw, LID?, page/display, efYd/ancYd? | HTTPS 사용 (공개 sample 응답 확인). 법인세법·부가가치세법·관련 시행령 query 허용 |
| 조문 | GET /DRF/lawService.do; OC, target=eflaw, type=JSON, ID 또는 MST, efYd, JO? | 과거 적용은 ID의 현재법 조회 대신 검색에서 얻은 MST+그 버전 efYd 사용 |
| 개정 점검 | eflaw 목록의 nw=1,2,3 및 시행일/공포일 범위 조회 후 버전 비교 | check_law_amendment는 파생 기능. 별도 가상 “회계처리 판정 API”를 만들지 않음 |

OC는 현재 가이드의 **신청한 API 인증값**이며 LAW_OC로 관리한다. 과거의 이메일 ID 관행을 현재 사양으로 가정하지 않는다. 회원가입·공동활용 신청 및 승인 후 이용하며 법제처 출처를 표시한다. 구체적인 승인 트래픽과 선택 서비스 조건은 승인 화면으로 재확인한다.

nw=1 연혁,2 시행예정,3 현행; display 최대 100. JO는 조번호 4 자리+가지번호 2자리 (예: 제 10 조의 2=001002). ID로 본문 조회하면 현행 본문이고 efYd가 무시될 수 있다는 가이드를 반영한다. 연혁 별도 target=lsHistory가이드는 HTML을 명시하므로 JSON 지원을 임의로 가정하지 않는다.

정규화 LawVersion={lawId,mst,name,promulgatedDate,effectiveDate,status,articleText,articleEffectiveDate,supplementaryText,sourceUrl}. resultCode/resultMsg 및 예상 JSON 구조를 함께 검사한다.

거래일에 대해 시행일≤거래일인 후보를 조회하고 조문별 시행일·부칙의 적용례/경과조치를 검토한다. 단순 “마지막 시행일”만으로 적용을 확정하지 않는다. ambiguous/needs_review를 반환하면 승인으로 이동한다. 조회시각만으로 과거 시행기간을 증명하지 않는다. 검색 cache24 시간, MST+시행일 본문 7일, 개정 점검 24 시간을 기본으로 하고 출처 snapshot을 보존한다.

공개 OC=test로 JSON 목록 HTTP200·resultCode00을 확인했다. 기본 검색 첫 항목이 시행예정 2028-01-01 법령이었다. 공개 샘플의 검색 성공만 입증하며 인증키 승인·실제 법령 적용의 정확성을 입증하지 않는다.

### 2.4 한국은행 ECOS

[서비스 목록](https://ecos.bok.or.kr/api/#/ServiceUse/ServiceList), [StatisticSearch 명세](https://ecos.bok.or.kr/api/#/DevGuide/DevSpeciflcation/OA-1040), [StatisticItemList 명세](https://ecos.bok.or.kr/api/#/DevGuide/DevSpeciflcation/OA-1030), [FAQ](https://ecos.bok.or.kr/api/#/ParticipatoryCommunication/FAQ)를 확인했다.

~~~text
GET https://ecos.bok.or.kr/api/StatisticTableList/{key}/json/kr/{start}/{end}/{statCode?}
GET https://ecos.bok.or.kr/api/StatisticItemList/{key}/json/kr/{start}/{end}/{statCode}
GET https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/{start}/{end}/{statCode}/{cycle}/{from}/{to}/{item1?}/{item2?}/{item3?}/{item4?}
~~~

환경변수 ECOS_API_KEY는 URL 경로에 들어가므로 reverse proxy·APM·error trace에서 경로 key도 마스킹한다. 주기는 A,S,Q,M,SM,D이며 날짜 형식을 주기에 맞춰 검증한다. 생략한 항목의 wildcard 동작은 미검증이므로 첫 구현은 검증된 항목 코드 세트를 명시한다.

응답은 서비스명 루트의 list_total_count,row[]이며 STAT_CODE, ITEM_CODE1~4, UNIT_NAME, TIME, DATA_VALUE 등을 정규화한다. 오류 RESULT의 CODE/MESSAGE를 검사하며 INFO-100/200, ERROR-101/400/602 등을 인증·자료없음·날짜·timeout·제한으로 매핑한다.

get_exchange_rate/get_interest_rate는 StatisticSearch의 검증된 시계열을 조회하는 래퍼다. 정확한 환율/기준금리 표·항목·단위는 StatisticTableList와 StatisticItemList로 탐색하고 registry에 승인된 series definition과 검증일을 저장한 후 활성화한다. 검증 전 해당 시리즈는 SERIES_NOT_VERIFIED로 응답한다. 존재를 확인하지 않은 코드나 지원 통화를 고정 기능으로 홍보하지 않는다. get_economic_indicator는 승인된 registry 시리즈를 조회한다.

금액 단위 (예: 1 USD 인지 100 JPY 인지), 매매기준율/종가, 관측 주기, 기준일을 응답에 포함한다. 휴일은 strict 모드에서 NO_DATA, previous_available 모드에서는 requestedDate와 observedDate 및 lagDays를 모두 반환한다. 참고환율 적합성을 승인해야 분개에 사용 가능하다.

공개 sample을 이용한 StatisticSearch 200Y101/A/2020~2023/10101과 StatisticItemList 601Y002 호출이 HTTP200 및 비어 있지 않은 row를 반환했다. 이것은 범용 통계 엔드포인트·샘플키 smoke 증거이며 환율·금리 코드, 사용자 인증키, 장기 안정성 테스트는 아직 아니다. 통계 개정으로 값이 달라질 수 있어 원본 hash·조회시각을 보존한다.

FAQ는 과도한 row 추출·호출횟수에 대한 제한과 비영리 자동발급/영리 담당자 확인을 안내한다. 고정 일일 quota 숫자는 이번 확인자료로 확정하지 않는다. 인증키 신청 페이지의 전체 약관은 조회 실패로 미확인이다. 발급 시 조건과 요금을 재확인하며 공공 API 월비용 예산은 일단 0 달러 가정이다. 통계 cache24 시간, series metadata7일, 최근 관측일 24 시간이 프로젝트 기본값이다.


## 11. 조사 출처와 남은 검증

공식 페이지 확인일은 모두 2026-10-14이다. 문서의 지원 안내와 실제 API 호출 성공은 별도의 증거다.

| 출처 | 확인내용 | 현재 증거수준 |
| --- | --- | --- |
| [MCP SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/) / [Workers](https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard.html) / [Auth](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization.html) / [Tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html) | package 명,stdio/fetch 모드, 구조화 schema,auth 전달 | 공식문서조회, 우리서버실행미검증 |
| npm registry: @modelcontextprotocol/server,client | version2.3.1,Node>=20,workerd/cf-worker exports | npm view 및공개 dist 선언조회;install/build 미실행 |
| [국세청 서비스](https://www.data.go.kr/data/15081808/openapi.do) / [Swagger](https://infuser.odcloud.kr/api/stages/28493/api-docs) | POST validate/status, 인증·필드·한도·무료조건 | 명세확인;인증연결미검증 |
| [DART 검색](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001) / [재무](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS003&apiId=2019020) / [코드](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019018) / [약관](https://opendart.fss.or.kr/intro/terms.do) | GET 계약·오류·보고서코드·ZIP | 가이드/직접 HTML 조회;인증연결미검증 |
| [법령 시행일목록](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdListGuide) / [본문](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdInfoGuide) / [조건](https://open.law.go.kr/LSO/information/guide.do) | OC,eflaw,MST/efYd,JO, 승인·출처 | 명세+공개 test 검색성공;개인키·조문본문미검증 |
| [ECOS OA-1040](https://ecos.bok.or.kr/api/#/DevGuide/DevSpeciflcation/OA-1040) / [OA-1030](https://ecos.bok.or.kr/api/#/DevGuide/DevSpeciflcation/OA-1030) / [FAQ](https://ecos.bok.or.kr/api/#/ParticipatoryCommunication/FAQ) | 조회·항목·코드변경·제한·키신청 | 공개 sample 2 요청성공;환율/금리코드·개인키미검증, 전체신청약관미확인 |
| [Astro adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/) / [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/) | SSR 경로·CPU·가격 | 문서확인;프로젝트호환성미검증 |
| [Supabase 요금](https://supabase.com/pricing) | free 한도,pause,Pro 비용 | 문서확인;DB/RLS/Storage 구동미검증 |
| [OpenAI API 요금](https://developers.openai.com/api/docs/pricing) | 비용 계산단가 | 문서확인;모델사용 권한·품질미검증 |
| [KASB](https://www.kasb.or.kr/front/board/ingAccountingList.do) / [IAS1](https://www.ifrs.org/issued-standards/list-of-standards/ias-1-presentation-of-financial-statements/) | 시행중기준서확인경로, 재무제표범위 | 전체기준서문단 review 미완료 |

구체적인 검증 결과·Phase 별 gate·다음 최소 단위는 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)를 참조한다.
