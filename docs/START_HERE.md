# AI가 수행할 학습 시작 설정

기본 설치는 **터미널 없이 URL 읽기와 현재 폴더 파일 쓰기만** 사용한다. 회계 자동화와 회계 흐름을 공부하는 한 사람을 위한 학습 공간이다. 현재 CWD를 유지하고 홈 디렉토리·글로벌 앱 설정·호스트 MCP 스키마에 접근하지 않는다.

## 1. 현재 앱에 맞는 번들을 한 번 받는다

현재 앱을 codex, claude, antigravity 중 하나로 정한다. 기본 URL 읽기 도구로 다음 공개 endpoint를 GET한다. requestId는 **이번 요청용 새 UUID**로 바꾸며 예시 문자열을 그대로 쓰거나 다른 사람의 URL/응답을 재사용하지 않는다. requestId는 캐시 혼선을 피하기 위한 값이고 서버가 발급하는 비밀 키는 별도의 암호학적 난수다.

```text
https://ledgerflow-public-reference-gateway.eric5833.workers.dev/api/remote/bootstrap?client=<현재앱>&requestId=<새-UUID>
```

응답에는 임시 회사 ID·만료 시각, 기존 6개 역할, 규칙 문서, 로컬 핵심 도구 명세, 해당 앱의 MCP 설정 파일 내용이 함께 있다. 회사는 세션별로 격리되고 합성 거래 1,000건이 준비된다. Google·API 키·Node·Git 설치는 필요 없다. GET도 학습 공간을 하나 만들므로 필요 없이 다시 열거나 검색엔진·공개 링크에 등록하지 않는다. 이전 설치가 유효하면 현재 폴더의 기존 연결을 재사용한다. 잘리거나 실패한 응답을 성공으로 취급하지 않는다.

이 응답의 MCP URL은 24시간 비밀 권한이다. **전체 응답이나 세션 URL을 채팅·로그·스크린샷에 출력하지 않는다.** 해당 URL은 /mcp/g/<guestToken> 형식이며 인증 헤더나 홈의 자격증명 파일이 필요 없다. URL 경로도 호스트/클라이언트 로그에 남을 수 있으므로 합성 임시 장부에만 사용하고 공개하지 않는다. 보관한 개인 장부의 기존 OAuth는 유지한다.

## 2. 현재 폴더에만 파일을 병합한다

응답의 files/mergePolicies/sensitivePaths를 사용한다. 새 폴더로 이동하거나 git clone·node·run_command를 호출하지 않는다. mkdir/파일 쓰기는 앱의 현재 폴더 파일 도구로 수행한다. 앱이 파일 쓰기나 MCP 갱신 자체를 허용하지 않는 경우 무제한 권한/샌드박스 우회 설정을 바꾸지 않고 그 한계를 알린다.

- AGENTS.md·CLAUDE.md·GEMINI.md는 기존 내용 뒤 관리 블록으로 병합한다. 같은 블록이 있으면 해당 블록만 갱신한다.
- 기존 사용자 코드·스킬·문서는 보존한다. 같은 경로의 역할/계약 문서가 다른 내용이면 덮어쓰지 말고 .ledgerflow 아래 대체 경로에 넣어 관리 블록의 참조를 바꾼다.
- docs/MCP_CATALOG.json은 핵심 도구의 **현재 input schema**와 출력 요약이다. 카탈로그 전체 41개 도구의 복제가 아니라 첫 거래와 후속 전기에 필요한 부분집합이다. 다른 기능의 스키마는 앱이 이미 제공하는 MCP 목록을 사용한다. ~/.gemini/antigravity/mcp/*.json을 view_file로 읽지 않는다.
- 비밀 MCP 설정을 쓰기 **전에** 해당 경로를 현재 .gitignore에 병합한다. 다른 서버의 항목은 유지하고 ledgerflow-accounting-mcp 하나만 병합한다. 이미 Git 추적 중인 설정은 .gitignore만으로 보호되지 않으므로 비밀 URL을 커밋 대상으로 두지 않는다. 안전하게 제외됐는지 확인할 수 없으면 그 파일 쓰기를 보류하고 상태를 보고한다.

앱별 프로젝트 설정:

| 앱 | 현재 폴더의 경로 | 연결 필드 |
| --- | --- | --- |
| Antigravity | .agents/plugins/ledgerflow-learning/mcp_config.json | mcpServers.ledgerflow-accounting-mcp.serverUrl |
| Claude Code | .mcp.json | type:http, url |
| Codex | .codex/config.toml | mcp_servers.ledgerflow-accounting-mcp.url |

Antigravity 플러그인에는 plugin.json·skills·rules와 위 MCP 설정 하나가 들어간다. 같은 서버를 글로벌 설정에 추가하지 않는다. ~/.gemini·~/.claude·~/.codex의 파일을 읽거나 쓰지 않는다. 기존 글로벌 연결이 앱에서 우선 선택되더라도 홈 파일을 뒤져 고치지 말고 실제 회사가 일치하는지 확인하고 필요한 앱 화면만 설명한다.

## 3. 현재 앱에서 실제 연결을 확인한다

새로 쓴 AGENTS/역할 계약을 현재 대화에서 직접 읽는다. 현재 폴더의 카탈로그로 get_system_status → get_company_context를 실제 호출하고, 회사 ID가 bootstrap 응답과 같은지 비교한다. 외부 스키마 파일 읽기나 터미널의 별도 SDK smoke 검사를 기본 설치 절차에 추가하지 않는다.

앱이 제공하는 공식 연결 갱신이 있으면 사용한다. 설정 파일 준비와 실제 앱 호출 성공은 별도다. 모든 앱/버전의 즉시 hot reload·도구 허용 팝업 0회를 보장하지 않으며 권한 확인을 대신 승인하거나 보안 설정을 끄지 않는다. 일반 웹 채팅처럼 현재 폴더 파일을 쓸 수 없는 환경에서도 설치됐다고 주장하지 않는다.

## 4. 첫 매출은 정상 경로 3회로 준비한다

처음부터 시작하면 다음 3회의 실제 MCP 도구 호출로 준비한다.

1. get_system_status({})
2. get_company_context({})
3. propose_journal_entry의 통합 옵션

```json
{
  "companyId": "<get_company_context가 반환한 회사 UUID>",
  "idempotencyKey": "first-sale-2026-01",
  "firstSale": {"from":"2026-01-01","to":"2026-01-31"},
  "validateAndRequestApproval": true,
  "client": "antigravity"
}
```

client는 현재 앱에 맞게 codex/claude_code/antigravity로 바꾼다. transactionId를 이미 알면 firstSale 대신 지정한다. 새 요청의 첫 매출 선택은 게시/진행 중인 초안이 없는 매출 한 건을 선택한다. **같은 학습의 재시도는 같은 idempotencyKey**를 사용해 기존 초안을 이어 쓴다.

통합 응답의 preparation에는 증빙·거래·독립 검증 결과·승인 상태와 기계적 준비 결과 기록이 있다. 같은 준비 작업에 대해 거래 조회·증빙 조회·validate·request·record_agent_result를 다시 호출하지 않는다. 서버의 기계적 기록을 AI가 검토했다는 증거로 표현하지 않는다. AI는 반환된 자료를 읽고 쉬운 설명과 Task/Result를 대화에 남긴다. 실패/불충분한 증빙/추가 AI 판단은 필요한 추가 호출을 허용하며 3회 성공을 꾸미지 않는다.

approvalUrl은 사람에게만 보여주고 멈춘다. AI는 링크를 열거나 교환·결정 API를 호출하지 않는다. 승인 요청 생성은 인간 승인이나 전기가 아니다. 사람이 웹에서 승인하고 장부 반영을 따로 요청한 뒤에만 상태/hash를 확인해 전기한다. DB가 Posted일 때만 완료를 보고한다.

## 5. 완료 보고와 선택적 CLI

설정 준비/실제 앱 두 도구 호출/역할 파일 준비를 성공 또는 미확인으로 짧게 보고한다. 원문 세션 URL이나 키는 제외한다. 설치 단계에서는 분개·승인·전기를 하지 않고 docs/learning-start.json의 firstRequest를 보여준다.

터미널을 **사용자가 별도로 원하고 허용한 경우에만** 기존 create-learning-workspace.ts --in-place --client <현재앱>을 선택적으로 사용할 수 있다. 이 경로도 CWD 안의 설정만 변경하며 홈·글로벌 설정·header helper를 쓰지 않는다. 기본 설치의 필수 단계가 아니다.

공식 경로 근거: [Antigravity 플러그인](https://antigravity.google/docs/plugins), [Antigravity MCP](https://antigravity.google/docs/mcp), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp).
