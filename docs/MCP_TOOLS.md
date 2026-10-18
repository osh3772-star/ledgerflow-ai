# MCP tool specification

서버 제품: `ledgerflow-accounting-mcp`. SDK v2. HTTP/stdio 공통 registry. 현재 **41개 도구**이며 `tools/list`의 전체 input/output JSON Schema는 [MCP_CATALOG.json](MCP_CATALOG.json)에 저장한다. 이 문서의 입력 요약보다 catalog와 strict Zod 계약을 우선한다.

## 공통 계약

호출 전에 `get_system_status`와 `get_company_context`를 사용한다. companyId를 받는 도구는 서버에 묶인 회사만 허용한다. 도구별 readOnlyHint를 설정한다. 공개 API 입력에는 회사/전표 쓰기 권한이 없다.

```json
{"ok":true,"data":{},"meta":{"traceId":"<uuid>","origin":"synthetic_erp","schemaVersion":"1"}}
```

실패는 `ok:false, error:{code,message}`, MCP `isError:true`다. 공개 도구 meta origin은 `public_reference`이며 실제/mock 구분은 data의 provenance.origin을 본다. Journal 응답은 ID/company/payload/hash/version/state/idempotencyKey/postedAt/discardedAt/discardReason이다. public과 일부 보고서 data는 JSON Schema의 일반 JSON 값으로 선언하며 도메인 결과는 서비스 normalize와 테스트로 검증한다.

`get_system_status.publicApiConfiguration`은 서버의 `mock/live/gateway` 모드와 각 제공자의 설정 여부만 노출한다. 실제 연결 성공은 개별 조회의 provenance로 확인한다. 키·접속 토큰은 반환하지 않는다. `get_accounting_source`는 선택 공공 검토 보고서를 반환하고 신규 `propose_journal_entry`의 `payload.publicReferences`는 전표 hash에 포함된다. [공공자료 적용 범위·공유 연결](PUBLIC_GATEWAY.md)

Authentication: localhost 고정 서버 신원, 선택 bearer. Permission: ERP 조회 erp:read, ERP 생성 erp:write + preparer/admin, 회계 쓰기 accounting:write, 마감 accounting:close. 인간 approve 권한은 web 전용이다. AI role prompt는 scope를 대체하지 않는다.

원격 임시 학습은 OAuth 없이 `POST /api/remote/guest`의 세션 키 또는 최초 MCP initialize의 `Mcp-Session-Id`로 회사가 고정된다. 키는 24시간 후 만료된다. 영구 개인 장부의 기존 Google/OAuth도 유지한다. 발급 API는 MCP 도구가 아니므로 도구 수는 41개 그대로다.

임시 모드의 `request_journal_approval` 성공 `data`에는 선택 필드 `approvalUrl`이 추가된다. URL은 `https://<site>/guest/approval/#ticket=<일회용 검토 티켓>`이며 회사·전표·version·hash에 묶인다. payload/hash에는 URL을 넣지 않는다. 사용자가 링크를 직접 열고 명시적으로 승인/반려한다. AI는 링크를 교환하거나 결정 API를 호출하지 않는다. 15분이 지나거나 사용한 링크는 같은 도구로 재발급받는다. 이 학습용 capability는 Google로 확인한 인간 신원과 동등하지 않다. [전체 보안 경계](REMOTE_USAGE.md)

`record_agent_result.client`는 `codex | claude_code | antigravity`다. 역할 6개·기존 Task/Result·허용 scope는 동일하다.

Audit: `{at,server,actor,profile,traceId,tool,companyId,outcome,durationMs,errorCode?}`. 인자·인증키·민감 원문을 기록하지 않는다. 파일/DB audit 실패는 `AUDIT_UNAVAILABLE`로 응답하며 이미 원자적으로 완료된 command는 멱등성 키/DB 상태로 재확인한다.

공통 오류: `INVALID_INPUT/FORBIDDEN/NOT_FOUND`. 회계 오류: `UNBALANCED/ACCOUNT_INVALID/EVIDENCE_MISMATCH/HASH_MISMATCH/LINE_PAYLOAD_MISMATCH/PERIOD_CLOSED/DUPLICATE_POSTING/APPROVAL_REQUIRED/JOURNAL_DISCARDED/IDEMPOTENCY_CONFLICT/CLOSE_INCOMPLETE`. 외부: `PROVIDER_REJECTED/PROVIDER_UNAVAILABLE/RATE_LIMITED/API_BUDGET_EXHAUSTED/SCHEMA_MISMATCH/NO_DATA`. 원문 에러/키 URL은 반환하지 않는다.

## ERP / 문맥

| 도구 | 입력 요약 | 응답·기능 | scope |
| --- | --- | --- | --- |
| get_system_status | {} | 제품/현재 catalog/capabilities/모델 비용 경로 없음 | 개발 연결 |
| get_company_context | {} | 고정 회사·기간·통화·합성 출처 | erp:read |
| get_transactions | companyId/from/to/kind?/limit?/cursor? | 거래 page | erp:read |
| get_unprocessed_transactions | 동일 | Posted source 없는 거래 page, ERP 상태 불변 | erp:read |
| get_invoices | companyId/from/to/transactionId?/direction?/limit?/cursor? | 합성 세금계산서·품목·증빙 page | erp:read |
| get_bank_transactions | companyId/from/to/unmatchedOnly?/limit?/cursor? | 은행·ERP 배분 page | erp:read |
| get_inventory | companyId/asOf/productId?/limit?/cursor? | 원천 입출고/원가 추정 page | erp:read |
| get_counterparties | companyId/query?/limit?/cursor? | 가상 거래처 page | erp:read |
| create_transaction | companyId/transaction/document/idempotencyKey 등 catalog | 거래·증빙 원자적 생성/재요청 | erp:write + preparer/admin |

## 회계 / 감사

| 도구 | 입력 요약 | 응답·기능 | scope |
| --- | --- | --- | --- |
| get_source_documents | companyId/transactionId | 증빙 원문·hash·출처 | erp:read |
| get_accounting_source | 동일 | 계정·기간·계약·보조자료 + 공공자료 검토 snapshot | erp:read |
| propose_journal_entry | companyId/transactionId/idempotencyKey | 결정론 Draft Journal + hash에 결합된 공공 근거 | accounting:write |
| get_journal_entry | companyId/journalId | 실제 DB Journal | erp:read |
| list_journal_entries | companyId/state?/limit?/after? | 전표 요약 최대 100 | erp:read |
| validate_journal_entry | companyId/journalId | 독립 검증 후 Journal | accounting:write |
| request_journal_approval | 동일 | 승인 요청 후 Approval Journal | accounting:write |
| get_approval_status | 동일 | version/hash/status/결정시각 또는 null | erp:read |
| post_journal_entry | companyId/journalId/expectedHash | 승인 재검사 후 Posted Journal | accounting:write |
| get_general_ledger | companyId/from/to | Posted 원장 라인 | erp:read |
| get_trial_balance | 동일 | 계정 합계·잔액·차대변 총액 | erp:read |
| get_company_financial_statements | 동일 | 가상 BS/IS·한계 | erp:read |
| create_adjusting_entries | companyId/periodId | 상각/선급 차액 Draft 목록 | accounting:write |
| reverse_journal_entry | companyId/journalId/recognitionOn/idempotencyKey | 반대 라인 역분개 Draft | accounting:write |
| close_fiscal_period | companyId/periodId | 완결성 검사 후 closed | accounting:close |
| calculate_depreciation | cost/residual/months | 월 원 단위 정액 금액 | 조회/계산 |
| run_audit_checks | companyId/from/to | 중복 증빙·불균형·미전기 후보 | erp:read |
| record_agent_result | companyId/client/runId?/result | immutable run/task 결과 기록 | accounting:write |
| discard_journal_entry | companyId/journalId/expectedHash/reason | 미게시·미승인 폐기 이력 | accounting:write |
| get_reconciliation_report | companyId/from/to | 은행·원장·배분 잔액/검토 대상 | erp:read |
| match_bank_transaction | companyId/bankTransactionId/journalId | 정확히 일치하는 게시 현금 전표 링크 | accounting:write |

## 공공 참고자료

| 도구 | 입력 예시 필드 | 응답·제한 |
| --- | --- | --- |
| verify_business | businesses[{businessNumber,startDate,representative,name?}] | 진위 매칭/미확인, 실제 사업자 자료 필요 |
| get_business_status | businessNumbers[10자리] | 현재 상태·과세유형·폐업일, masked 번호 |
| search_disclosures | corpCode/from/to/detailType?/page?/limit? | 공시 목록/링크, corpCode 필수 |
| get_financial_statements | corpCode/year/reportCode?/fsDiv? | DART 계정 금액, 가상회사 FS와 다른 이름 |
| compare_company_financials | companies[2~5]/year/reportCode?/fsDiv? | 선택 회사 비율, 미확정 null |
| search_tax_law | query/status?/page?/limit? | 법인세법·부가가치세법과 시행령 버전 |
| get_law_article | mst/effectiveDate/article/transactionDate | 6자리 JO 조문, 시행일/거래일 검토 |
| check_law_amendment | query/knownMst | 현행 검색 버전 차이, 법적 적용 결론 아님 |
| get_exchange_rate | currency USD 또는 JPY/date/policy? | 관측일/lag/단위, JPY100엔 |
| get_interest_rate | from/to | 월 기준금리 관측 최대 100 |
| get_economic_indicator | series/from/to | registry 통계, A/M/D 날짜 길이 |

## 요청 / 응답 예시

전 도구의 유효 예시 인자는 [MCP_EXAMPLES.json](MCP_EXAMPLES.json)에 기록한다. fixture UUID는 합성 테스트용이고 postgres mode에서는 context/조회로 얻은 ID를 사용한다. 각 행의 응답 유형은 위 표와 catalog outputSchema를 따른다.

```json
{"name":"propose_journal_entry","arguments":{"companyId":"<context>","transactionId":"<조회한 매출>","idempotencyKey":"sales/2026-01/001"}}
```

```json
{"ok":true,"data":{"state":"Draft","version":1,"hash":"<64자리 sha256>","payload":{"lines":[{"accountCode":"1100","debit":"3080","credit":"0"},{"accountCode":"4010","debit":"0","credit":"2800"},{"accountCode":"2100","debit":"0","credit":"280"},{"accountCode":"5010","debit":"2000","credit":"0"},{"accountCode":"1200","debit":"0","credit":"2000"}]}},"meta":{"traceId":"<uuid>","origin":"synthetic_erp","schemaVersion":"1"}}
```

예시는 가독성을 위해 전체 Journal의 일부 필드를 생략했다. 실제 응답은 journal schema 필드를 모두 포함한다. 같은 서버에 인간 결정 tool/범용 SQL/모델 호출 tool은 없다.
