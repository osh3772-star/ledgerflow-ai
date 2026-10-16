# LedgerFlow 로컬 포트폴리오 실행판

2026-10-16. 사용자 요청에 따라 추가 클라우드 설정을 기다리지 않고 로컬 시연 버전을 마무리한다. Supabase 연결정보·CA는 보존하고 DB 인증정보 거절은 보류 상태로 기록한다. 현재 버전의 완료 기준은 아래 로컬 회계 플랫폼이다.

## 실행

```powershell
pnpm install --frozen-lockfile
pnpm start
```

Node 24/pnpm 11.25가 필요하다. `start`는 Astro 화면을 build한 뒤 기존 단일 `ledgerflow-accounting-mcp` 서버를 foreground로 실행한다. `.env.local`을 수정하지 않고 해당 프로세스에만 demo DB/memory session을 명시적으로 선택하므로 Supabase 설정을 입력한 PC에서도 실행된다. 기존 서버가 실행 중이면 그 터미널에 `stop`과 Enter를 입력한 후 시작한다.

- 대시보드: `http://127.0.0.1:8787/`
- Claude Code/Codex 공유 MCP: `http://127.0.0.1:8787/mcp`
- 종료: 서버 터미널에 `stop`과 Enter

로컬 데모는 로그인 없이 쓴다. 데이터는 실제 native PostgreSQL에 저장되며 종료 시 제거된다. 다음 실행은 같은 1,000건의 가상회사 ERP와 별도 격리회사 1건으로 시작한다. 지속 장부가 필요할 때 쓰는 postgres profile과 외부 JWT 통제는 변경하지 않았다.

## 시연 순서

1. 대시보드에서 회사/기간·거래·증빙을 확인한다. 공공 API 자료는 참고자료이고 ERP는 합성 데이터다.
2. 프로젝트의 두 앱 연결 설정을 사용한다. 연결된 앱이 `get_system_status` → `get_company_context`를 먼저 호출하고 매출 역할로 거래 조회 → Draft → 검증 → 승인 요청을 수행한다. 앱별 추론은 앱 구독에서 실행하며 유료 모델 API/자체 runner는 없다.
3. 사용자가 화면에서 해당 전표의 증빙·금액·version/hash를 검토해 승인 또는 반려한다. AI는 대신 결정하지 않는다.
4. 승인 후 앱이 상태를 재확인하고 전기한다. DB `Posted`와 원장/시산표/BS·IS를 확인한다. 초기 fixture를 자동 승인/전기해 채워두지 않는다.

6개 역할은 `.agents/skills`/`.claude/skills`와 native agent 설정에 있으며 사용자가 요청한 역할만 사용한다. 서버 제품은 하나이고 앱 둘이 같은 DB를 공유한다.

## 포함된 기능

ERP 1,000건, 10종 거래의 Decimal 분개·독립 검증, 증빙/hash/version, 인간 승인·원자적 전기·불변성, 원장/시산표/BS·IS, 감가상각·선급 수정·역분개·기간 마감, 은행 대사, 회사 RLS·감사 로그, 4종 공공 API/11개 참고 도구, 총 41개 MCP 도구, Astro/React 화면, Windows/Linux/Docker CI 기반을 포함한다. [상세 검증 결과](IMPLEMENTATION_STATUS.md).

실행 명령 추가 후 최종 로컬 전체 검사 211개/30 files(359.19초), 실제 `pnpm start`·웹 build·SDK 읽기 진단 41개 도구를 확인했다. 고정 ERP 평가 1,000/1,000·수기 gold 10/10·주입 오류 5/5도 재현했다. 실제 앱 추론/사용자 승인을 대신 수행한 결과는 아니다. 기존 원격 기준 CI 192개와 구분한다.

## 현재 제한

- 실제 Supabase는 CA 등록 뒤 DB 인증정보를 거절했다. 원격 초기 적재/실제 Auth 사용자 매핑은 미구현이고 hosted Auth/Storage/RLS와 실제 앱의 추론 수용 검증은 남아 있다. 이번 로컬 완료 범위와 구분한다.
- 원격 OAuth/HTTPS·Cloudflare backend는 미배포다. 로컬 demo를 인터넷에 직접 노출하지 않는다.
- 제한된 합성 회계 정책으로 K-IFRS 적용을 연습하는 포트폴리오이며 완전한 K-IFRS 준수·실제 세금 신고·실제 기업 회계 정확도를 주장하지 않는다.

공공 API live 진단과 Supabase 도구는 남겨둔다. `pnpm check`/`pnpm evaluate`로 코드와 합성 데이터 성능을 재현할 수 있다. 프로젝트의 유료 모델 API 호출은 0회다.
