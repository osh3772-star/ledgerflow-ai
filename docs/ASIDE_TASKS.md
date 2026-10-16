# Aside AI에 하나씩 전달할 명령

아래 블록을 한 번에 하나씩 실행한다. Aside는 계정/설치 준비를 맡고 Codex는 같은 프로젝트의 소스 구현과 테스트를 계속한다. Aside에게 저장소 소스·DB·회계 상태를 동시에 수정시키지 않는다. 전표 승인/반려 결정은 사용자가 화면에서 직접 수행한다.

## 1. GitHub 저장소 준비 — 완료

`osh3772-star/ledgerflow-ai` 공개 저장소 생성과 Codex의 코드 업로드를 완료했다. 아래 블록은 최초 준비 기록이며 현재 다시 실행할 필요가 없다.

```text
LedgerFlow 포트폴리오용 GitHub 저장소를 준비해 줘.
현재 로그인한 내 계정에서 ledgerflow-ai 저장소를 찾아줘. 이미 있으면 기존 내용을 변경하지 말고 URL과 공개 여부만 알려줘.
없으면 ledgerflow-ai라는 Public 저장소를 만들고 README·.gitignore·license 초기화는 모두 끈 상태로 생성해 줘.
아직 코드 업로드·commit·push·기존 저장소 삭제는 하지 마. 코드는 작업 중인 Codex가 올릴 거야.
로그인이나 2단계 인증이 필요한 단계는 내가 직접 처리하게 넘겨줘. 토큰·비밀번호를 읽거나 채팅에 출력하지 마.
완료하면 저장소 URL, 새로 만들었는지 여부, 공개 여부만 알려줘.
```

## 1-1. GitHub CLI 인증 — 완료

초기 연결 앱의 파일 생성은 403으로 거절됐으며, 2026-10-16 사용자가 GitHub CLI 인증을 완료했다. Codex가 코드를 업로드하고 Windows/Linux·Docker CI 통과를 확인했다. 아래 블록은 새 PC 등에서 재인증이 필요한 경우에만 사용한다.

Codex가 이미 기기 인증을 시작했다면 전달받은 GitHub 인증 화면에서 사용자가 완료한다. 같은 로그인을 중복 실행하지 않는다. 일회용 코드는 이 문서에 저장하지 않는다.

```text
LedgerFlow 업로드를 위한 GitHub CLI 로그인만 준비해 줘.
내 PC 터미널에서 gh --version을 확인하고 gh auth login --web --git-protocol https --scopes workflow를 실행해 줘. workflow 권한은 CI 파일 업로드용이야.
GitHub 계정 로그인·2단계 인증·OAuth 동의는 내가 직접 처리하게 넘겨줘. 토큰·비밀번호를 조회하거나 출력하지 마.
CLI나 내 터미널에 접근할 권한이 없으면 설치/로그인 상태를 추정하지 말고 내가 직접 실행할 명령 한 줄만 알려줘.
코드 업로드·push·저장소 변경은 하지 마. 인증이 끝나면 Codex가 준비한 커밋을 업로드할 거야.
완료하면 gh auth status의 성공 여부만 알려줘.
```

## 2. 기존 Supabase 프로젝트 설정

사용자는 기존 `회계자동화` 프로젝트를 재사용하기로 했다. 아래 안내로 새 프로젝트를 만들지 않는다. Healthy/Free/싱가포르 상태는 사용자가 전달한 결과이며 Codex가 hosted 연결로 검증한 결과가 아니다.

```text
LedgerFlow의 기존 Supabase 프로젝트 ‘회계자동화’ 연결 설정만 도와줘.
프로젝트 URL은 https://tbmdjifuqnnevduhbagd.supabase.co 야. 새 프로젝트는 만들지 마.
아래 파일에서 내가 직접 세 값을 입력하도록 설정 위치와 편집 화면을 준비해 줘.
C:\Users\eric5\Documents\Codex\2026-10-14\ledgerflow-ai-mcp-ai-1-api\.env.local
SUPABASE_URL: 위 프로젝트 URL
SUPABASE_PUBLISHABLE_KEY: Project Settings → API Keys의 Publishable key
LEDGERFLOW_DATABASE_URL: 상단 Connect → Session pooler, 포트 5432의 연결 문자열
키·DB 비밀번호·연결 문자열의 실제 값은 읽거나 채팅에 출력하지 마.
DB 비밀번호는 내가 직접 입력하고, 예약문자는 URL 인코딩해야 한다고 안내해 줘.
기존 공공 API 키 4개와 다른 설정은 보존해.
사용자/회사 UUID와 실행 모드는 바꾸지 말고 서버 재시작·SQL·migration·데이터 적재도 하지 마.
파일에 접근할 수 없으면 내가 직접 편집하도록 안내해 줘.
완료하면 세 항목 각각 ‘입력 완료/미완료/미확인’ 여부만 알려줘.
```

2026-10-16 세 값 입력 확인 완료. 실제 `supabase:check`는 설정의 프로젝트 일치와 Auth health HTTP 200을 확인했고, DB는 인증서 검증에서 멈췄다. 이 블록을 다시 실행하지 않고 다음 한 단계만 수행한다. [연결 절차와 검증 범위](SUPABASE_SETUP.md)

## 2-1. DB 루트 CA 인증서 등록 — 현재 사용자 작업

```text
기존 Supabase ‘회계자동화’ 프로젝트에서 DB 연결용 루트 CA 인증서 등록만 도와줘.
프로젝트: tbmdjifuqnnevduhbagd
프로젝트 폴더: C:\Users\eric5\Documents\Codex\2026-10-14\ledgerflow-ai-mcp-ai-1-api
Database Settings → SSL Configuration에서 제공하는 공개 루트 CA 인증서를 내려받아 프로젝트의 .ledgerflow\certs\supabase-root.crt에 저장해 줘.
.env.local의 LEDGERFLOW_DATABASE_CA_FILE에 그 인증서의 절대 경로를 등록해 줘.
기존 키와 연결 문자열은 보존하고 비밀값은 읽거나 출력하지 마.
SSL 검증을 끄거나 SSL enforcement 설정을 변경하지 마. 서버 재시작·SQL·마이그레이션·데이터 적재도 하지 마.
인증서 다운로드 또는 파일 편집이 불가능하면 필요한 화면만 열고 내가 직접 하도록 안내해 줘.
완료 여부와 인증서 파일 경로만 보고해 줘.
```

이 공개 CA 파일은 비밀번호가 아니다. 등록 후 Codex가 TLS peer 검증을 유지한 채 같은 진단을 다시 실행한다. 사용자/회사 UUID·profile 전환과 hosted 초기화는 아직 다음 작업으로 넘기지 않는다.

## 3. 두 앱 연결 확인

```text
LedgerFlow 프로젝트를 Claude Code와 Codex에서 사용할 수 있게 앱 상태를 확인해 줘.
프로젝트 폴더는 C:\Users\eric5\Documents\Codex\2026-10-14\ledgerflow-ai-mcp-ai-1-api 야.
설치 여부를 확인하고, 설치가 필요하면 공식 배포 경로로 준비해 줘. 로그인·2단계 인증·관리자 권한 요청은 내가 직접 처리하게 넘겨줘. 새 유료 모델 API 키나 결제는 만들지 마.
기존 .mcp.json과 .codex/config.toml을 이용해 프로젝트를 신뢰하고 MCP 허용 후 재로드해 줘. 서버 이름은 ledgerflow-accounting-mcp, 공유 URL은 http://127.0.0.1:8787/mcp 하나야. 추가 MCP 서버를 만들거나 소스/설정 파일을 덮어쓰지 마.
서버가 꺼져 있으면 Codex에게 시작이 필요하다고 알려줘. 별도 서버를 임의로 추가 실행하지 마.
각 앱에 먼저 get_system_status, 다음 get_company_context를 실제 도구로 호출하도록 요청해 줘. 설정 화면만 보고 연결 성공이라고 쓰지 마.
거래 생성·승인·전기는 하지 말고, 앱별 실제 도구 호출 성공 여부와 서버 이름·도구 수만 알려줘. 호출할 수 없으면 미확인으로 표시해 줘.
```

## 4. 승인 화면 검토 준비

```text
LedgerFlow의 승인 화면을 내가 직접 검토할 수 있게 준비해 줘.
공유 서버가 실행 중일 때 http://127.0.0.1:8787/ 를 열고, Codex가 알려준 journal ID/version/hash의 전표를 찾아줘.
다른 전표를 임의로 고르거나 거래/DB를 변경하지 마. 차변·대변·금액·귀속일·증빙을 내가 볼 수 있게 표시해 줘.
Aside를 포함한 AI는 승인·반려 버튼을 누르거나 승인 API·전기 도구를 호출하지 마. 승인 요청이나 앱 도구 실행 허용은 장부 승인이 아니야.
내가 화면에서 직접 승인/반려를 결정할 때까지 멈춰. 이후에도 Aside는 대신 전기하지 말고, Codex가 MCP로 승인 상태와 Posted 여부를 확인하도록 넘겨줘.
해당 전표가 없거나 서버가 꺼져 있으면 현재 상태만 알려줘.
```

## 5. GitHub Linux CI 확인 — 완료

사용자는 로컬 Docker 설치를 생략하고 GitHub Linux CI를 이용하기로 했다. [실제 실행](https://github.com/osh3772-star/ledgerflow-ai/actions/runs/38819739533)에서 Windows/Linux check와 Linux container가 모두 통과했다. 아래 블록은 추후 실행 확인이 필요한 경우에만 사용한다. 실제 앱 연결과 Supabase 접속은 이 결과로 완료 처리하지 않는다.

```text
LedgerFlow는 로컬 Docker 설치 없이 GitHub Linux CI로 검증할 거야.
https://github.com/osh3772-star/ledgerflow-ai/actions 에서 Codex가 업로드한 커밋의 LedgerFlow checks 실행 상태만 확인해 줘.
업로드나 실행 기록이 없으면 미실행으로 알려줘. Windows·Ubuntu check와 Linux container 작업을 구분하고, 실패하면 실행 링크와 실패한 단계만 알려줘.
소스·workflow·저장소 설정을 수정하거나 별도 실행 환경·Docker를 설치하지 마. 실패 수정과 재실행은 Codex가 할 거야.
계정 로그인·2단계 인증은 내가 직접 처리하게 넘겨줘. 인증 정보는 조회하거나 출력하지 마.
```

Cloudflare/원격 공개는 OAuth·HTTPS·영속 세션과 실제 배포 대상 검증이 끝난 뒤 별도 명령으로 진행한다. 현재 localhost demo를 인터넷에 노출하지 않는다.
