# PC에서 따로 실행하며 코드 살펴보기

[공개 학습 사이트](https://ledgerflow-public-reference-gateway.eric5833.workers.dev/)의 시작 요청문으로 공부할 때는 이 절차가 필요하지 않습니다. 같은 학습 내용을 내 PC의 임시 장부에서 다시 실행하며 코드를 살펴보고 싶을 때만 사용합니다.

Node 24·pnpm 11.25·Git을 준비하고 저장소 폴더에서 실행합니다.

```text
git clone https://github.com/osh3772-star/ledgerflow-ai.git
cd ledgerflow-ai
pnpm install --frozen-lockfile
pnpm start
```

화면은 `http://127.0.0.1:8787/`, MCP는 `http://127.0.0.1:8787/mcp`입니다. 저장소의 기본 `.mcp.json`과 `.codex/config.toml`이 같은 로컬 서버 하나를 가리킵니다. 서버를 한 번만 실행하고 터미널을 켜 둡니다. 종료하려면 `stop`을 입력하고 Enter를 누릅니다.

임시 PostgreSQL·고정 시드 가상 거래 1,000건이 준비되고 공공자료는 기본 샘플 모드입니다. 서버를 종료하면 이 임시 장부는 정리되고 다음 실행에 같은 자료로 시작합니다. 이 장부는 Google로 여는 공개 사이트의 개인 장부와 별개입니다. 원격 학습 폴더를 준비하는 스크립트는 이 기본 설정을 변경하지 않습니다.

회계·보안 검증은 `pnpm check`, 웹 출력은 `pnpm web:build`로 확인합니다. 게시된 전표는 수정하지 않으며 사람의 승인은 항상 웹에서 별도로 진행합니다. 소스의 비밀값 파일과 인증 정보는 공유하지 않습니다.

[전체 구현 원리](ARCHITECTURE.md) · [회계 도구 명세](MCP_TOOLS.md) · [검증 결과](IMPLEMENTATION_STATUS.md)
