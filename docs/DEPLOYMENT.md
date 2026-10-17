# 배포 준비와 실행 검증

> 원격 운영은 [원격 배포 절차](REMOTE_USAGE.md)와 pnpm remote:deploy를 사용한다. 실제 DB TLS/Auth 연결 → schema/007 upgrade → secrets 등록 → 같은 Worker 활성화 순서다. 현재 DB 인증 오류로 활성화는 보류다. 아래는 기존 로컬/컨테이너 경로다.

2026-10-16. 검증 대상은 Node 24의 localhost 개발 서버, Windows/Linux 회귀 CI와 Linux 이미지 내부 foreground smoke다. 실제 실행 결과와 검증 대상 커밋은 [CI 실행 기록](CI_VALIDATION.md)에 구분한다. [담당 작업](WORK_ASSIGNMENTS.md)

## 호스트에서 준비 확인

```powershell
pnpm deploy:check
pnpm check
pnpm web:build
pnpm container:smoke
```

`deploy:check`는 설치된 Docker/엔진, GitHub CLI 로그인, commit/remote의 존재, 두 앱 프로젝트 설정 일치와 대시보드 build 파일을 검사한다. 외부 연결값은 존재 여부만 출력하고 GitHub CLI 원문·DB URL·키를 출력하지 않는다. `.ledgerflow/deployment/latest.json`은 ignored다. 로컬 설정/파일 누락에는 종료 코드 1을 반환한다. Docker나 외부 계정이 없다는 이유로 SDK 수용 테스트를 완료로 표시하지 않는다. build 존재 확인은 최신 소스의 build 성공을 대신하지 않으므로 변경 후 `web:build`를 따로 실행한다.

사용자는 로컬 Docker 설치를 생략하고 GitHub Linux CI로 검증하기로 했다. 이 경로에서 `docker-engine: needed`는 로컬 도구 감지 결과이며 추가 설치 요청이 아니다. 원격 CI 증거는 위 실행 기록에서 확인한다. CLI 로그인·commit·origin·코드 업로드는 완료했다.

`container:smoke`는 현재 실행 환경에서 foreground 테스트를 수행한다. 테스트가 소유한 폐기형 PostgreSQL/mock만 사용하고 MCP 제품 하나를 기동한 뒤 health → SDK status/context → catalog/회사 내 최대 1건 읽기를 확인하고 종료한다. 인간 세션·승인·전기·외부 API·추론 호출은 하지 않는다. Linux root 실행은 거절한다. Windows 호스트에서 통과한 결과는 Docker/Linux 실행 증거가 아니다.

## Docker 이미지와 로컬 Compose

Dockerfile은 고정 pnpm 11.25로 설치/웹 build한 뒤 `USER node`로 같은 소스를 실행한다. Node를 직접 기동해 종료 신호가 package-manager wrapper를 거치지 않는다. health check는 loopback `/health`의 제품명과 `ready: true`만 확인한다. 이는 프로세스 liveness이며 DB·앱 추론·장부 전기의 수용 검증이 아니다. 이 검사는 agent runner나 작업 스케줄러를 실행하지 않는다.

```sh
docker build --tag ledgerflow-local .
docker run --rm --init ledgerflow-local node --import tsx scripts/container-smoke.ts
```

그다음 동일 호스트에서 실행할 때는 Compose 서비스 **하나**를 사용한다. 기존 `pnpm mcp:start` 프로세스를 종료하고 `.env.local`에 `LEDGERFLOW_MCP_MODE=demo` 또는 `postgres`를 명시한 뒤 실행한다. 이미지 자체의 기본 모드는 안전하게 기존 DB를 요구하는 `postgres`다.

```sh
docker compose up --build
# 종료: 터미널 Ctrl+C 또는 다른 터미널의 docker compose stop
```

Compose는 기존 `.env.local`을 컨테이너 실행 환경으로 전달하며 이미지에는 넣지 않는다. `demo`에 DB URL이 있으면 실행을 거절한다. `postgres`에는 준비된 DB와 사용자/회사 설정이 필요하며 자동 migration·seed를 수행하지 않는다. 명명된 audit volume만 보존하고 demo DB는 종료 시 제거한다.

현재 Node listener는 `127.0.0.1`과 localhost Host/Origin만 허용한다. 따라서 Compose는 **Linux Docker Engine의 host network**를 사용하고 `ports`를 설정하지 않는다. Docker Desktop은 공식 host-network 지원 활성화가 필요하며 이 프로젝트에서 실제 Desktop 실행을 검증하지 않았다. 일반 bridge의 `-p 8787:8787`만 추가하는 구성은 현재 loopback listener에 연결하는 방법으로 제공하지 않는다. [Docker host network](https://docs.docker.com/engine/network/drivers/host/), [Compose env_file/network_mode](https://docs.docker.com/reference/compose-file/services/)

비관리자 사용자·다단계 build와 실제 소스 제외 규칙은 [Docker Node 가이드](https://docs.docker.com/guides/nodejs/) 및 [Node 공식 이미지](https://github.com/nodejs/docker-node/blob/main/24/bookworm-slim/Dockerfile)를 확인해 구성했다. 설치/이미지/종료 동작은 별도의 실제 Docker 실행 결과로 검증해야 한다.

## GitHub CI

`.github/workflows/ci.yml`은 main push/PR에서 Windows와 Ubuntu 24.04의 `pnpm check`, 합성 evaluation, Astro build를 실행한다. OS별 artifact 이름을 구분한다. 두 회귀 job이 통과하면 Linux에서 Docker build 후 위 foreground smoke를 이미지 안에서 실행한다. workflow token은 `contents: read`만 사용하며 공공/모델/DB 인증키를 요구하지 않는다. 계정 자동 로그인·이미지 공개·배포·사용자 장부 승인은 수행하지 않는다. [GitHub runner 선택](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)

2026-10-16 사용자가 CLI 인증을 완료한 뒤 [공개 저장소](https://github.com/osh3772-star/ledgerflow-ai)에 실제 코드를 push했다. 초기 연결 앱의 쓰기 403과 CLI 권한은 별개이며, 거절된 앱의 다른 API로 우회하지 않았다. Windows CI의 임시 디렉터리 ACL과 `pg_ctl` 기동 수정은 [실패 및 재검증 기록](CI_VALIDATION.md)에 남긴다. 로컬 `deploy:check`의 CLI 상태만으로 연결 앱의 인증을 판단하지 않는다.

## 원격/Cloudflare 후속 범위

Cloudflare 루트에 정적 대시보드·읽기 전용 합성 데이터 route를 추가했다. 이 [공개 미리보기](PUBLIC_SITE.md)는 설치 없이 열어 볼 수 있으나 원격 장부 운영과는 구분한다. 데이터는 별도 임시 fixture DB에서 기존 공통 서비스로 내보내며 사용자 장부·인증정보를 내보내지 않는다. 공개 승인·세션·변경 route는 제공하지 않고 기존 로컬 승인 경계를 보존한다.

공공자료만 공유하기 위한 Cloudflare Worker와 로컬 gateway client는 별도로 구현했다. **장부 backend 원격 배포와 다른 범위**다. Worker에는 MCP endpoint·회계 도구·DB·인간 세션이 없고 기존 공공 Adapter만 재사용한다. 빌드, 인증·쿼터 검증, 배포·비밀값 등록·수신자 연결 명령은 [공유 중계 안내](PUBLIC_GATEWAY.md)를 따른다. 실제 배포 여부는 [구현 상태](IMPLEMENTATION_STATUS.md)에 구분한다.

선택적 [암호화 PostgreSQL 인간 세션](SECURITY_SESSIONS.md)은 구현했다. 원격 운영 전에는 외부 인증 발급자·클라이언트별 MCP 신원/회사 scope, HTTPS/허용 Origin과 실제 provider/세션을 검증해야 한다. localhost 고정 MCP 신원과 로그인 없는 demo 운영자를 원격 환경에 그대로 적용하지 않는다. 원격 OAuth/HTTPS 부분은 아직 구현하지 않았다. 컨테이너 재기동 사이에 세션을 보존하려면 동일한 서버 전용 암호화 키와 기존 DB profile을 사용한다.

Workers의 Node 호환 기능에는 지원 범위가 있으므로 Node 프로세스·native PostgreSQL 자식 프로세스·로컬 파일·in-memory 세션이 함께 동작한다고 가정하지 않는다. 현재 Astro 정적 build는 가능하지만 화면의 `/api`는 동일 출처 Node 서비스에 의존하므로 정적 업로드만으로 전체 회계 앱이 동작하는 것은 아니다. 배포 대상 결정 후 API/인증 라우팅을 별도로 검증한다. [Cloudflare Node 호환성](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
