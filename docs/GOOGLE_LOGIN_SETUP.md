# Google 로그인 운영 설정 — 한 번만

방문자는 **Google로 계속하기 → 계정 선택**으로 장부를 엽니다. 별도의 이메일·비밀번호 회원가입과 가입 확인메일은 사용하지 않습니다. Google 인증 후 확인된 Supabase 사용자 UUID로 기존 회사·권한을 선택하며, 전표 승인은 여전히 사용자가 사이트에서 직접 합니다.

**2026-10-18 현재:** 공개 사이트 `/api/remote/config`에서 `googleLogin.enabled:true`, `checked:true`를 확인했습니다. 사용자가 전달한 운영 확인 보고에서는 실제 Google 로그인 후 개인 장부가 열렸습니다. 아래 설정은 신규 운영자용이며, 현재 운영 프로젝트에 OAuth 키를 중복 생성할 필요는 없습니다. 네이티브 MCP 앱 연결과 실제 웹 전표 승인은 별도로 확인해야 합니다.

코드는 실제 PostgreSQL에서 Google PKCE·브라우저 결합·단일 사용·만료·세션·기존 회계 흐름을 테스트합니다. 제공자 설정 전에는 로그인 버튼을 비활성화하고 준비 중으로 안내합니다. 가짜 성공이나 이메일 인증 해제로 우회하지 않습니다.

## 운영자가 등록할 주소

| 항목 | 값 |
| --- | --- |
| Google OAuth 앱 유형 | Web application |
| Authorized JavaScript origins | https://ledgerflow-public-reference-gateway.eric5833.workers.dev |
| Google Authorized redirect URI | https://tbmdjifuqnnevduhbagd.supabase.co/auth/v1/callback |
| Supabase Site URL | https://ledgerflow-public-reference-gateway.eric5833.workers.dev |
| Supabase Redirect URLs | https://ledgerflow-public-reference-gateway.eric5833.workers.dev/api/remote/google/callback |
| 기본 로그인 범위 | openid, email, profile |

Google Client ID와 Client Secret은 **Supabase → Authentication → Sign In / Providers → Google**에 등록합니다. Supabase 화면이 제공하는 정확한 callback URL과 위 값을 대조하세요. 일반 방문자는 아무 키도 발급하거나 입력하지 않습니다. Google Secret을 사이트 코드·Git·대화창·공개 문서에 넣지 않습니다. 기존 공공 API 키 4개와 DB 비밀번호는 변경할 필요가 없습니다.

Google Auth Platform의 Audience가 Testing이면 허용된 테스트 사용자만 사용하도록 제한될 수 있습니다. 다른 사람에게 공개하려면 해당 프로젝트의 Audience·Publishing 상태와 Google의 요구사항을 확인하세요. 유료 요금제·청구 계정·불필요한 Gmail/Drive 권한은 추가하지 않습니다. Google 계정이나 비밀번호를 이 사이트에 직접 입력하지 않습니다.

## Aside에 보낼 명령어

아래를 한 번에 전달하세요. 소유자 계정의 로그인·약관·자격증명 입력이 필요한 지점은 사용자가 직접 처리합니다.

~~~text
기존 한빛유통 사이트의 Google 로그인 운영 설정을 진행해 줘.
프로젝트는 C:\Users\eric5\Documents\Codex\2026-10-14\ledgerflow-ai-mcp-ai-1-api이고,
docs/GOOGLE_LOGIN_SETUP.md를 먼저 읽어.
기존 Supabase ‘회계자동화’(tbmdjifuqnnevduhbagd)를 유지하고, 적합한 기존 Google Cloud 프로젝트가 있으면 재사용해.
Google Auth Platform에서 Web application OAuth 클라이언트를 준비하고 문서 표의 origin과 Supabase callback URL을 정확히 등록해.
기본 신원 범위 openid·email·profile만 사용해. 사이트 비밀번호나 가입 확인메일 방식은 켜지 마.
Client ID·Secret을 Supabase Google Provider에 등록하고 활성화하며, Site URL과 Redirect URLs도 문서대로 설정해.
키·시크릿·토큰·비밀번호는 채팅, 캡처, GitHub, 클라이언트 코드에 노출하지 마.
새 보안 권한 동의·약관·자격증명 입력이 사용자 직접 작업을 요구하면 그 단계에서 인계하고, 인증을 우회하지 마.
유료 전환·청구 계정 연결·다른 프로젝트 삭제·이메일 확인 해제·회계 거래 생성·장부 승인은 하지 마.
공개 사용에 필요한 Audience/Publishing 상태도 확인해. 테스트 모드라면 접근 가능한 범위를 알려줘.
마지막에 공개 사이트 /api/remote/config의 googleLogin.enabled가 true인지와 로그인 버튼 활성 여부만 확인해 줘.
실제 본인의 Google 로그인·MCP 앱 접근 동의·전표 최종 승인은 사용자에게 맡겨.
완료 여부와 막힌 화면만 보고하고 비밀값은 보고하지 마.
~~~

## 설정 후 사용자 확인

1. 공개 사이트에서 **로그인·시작하기 → Google로 계속하기**를 누릅니다.
2. 본인 Google 계정으로 로그인합니다. 최초 사용은 해당 신원에 대한 개인 회사와 합성 원천 거래 1,000건을 준비합니다.
3. 사이트에 내 이메일이 보이고 재로그인해도 같은 장부인지 확인합니다. 사용자 이름·이메일 문자열을 임의로 장부 ID에 매핑하지 않습니다.
4. AI 앱의 MCP OAuth 인증 브라우저에서도 같은 Google 계정을 선택하고, 원래의 **내 장부 연결 허용** 화면으로 돌아오는지 확인합니다. Google 로그인이 MCP 접근 동의나 전표 승인을 자동으로 대신하지 않습니다.

Google의 Supabase callback과 AI 앱의 localhost callback은 서로 다른 단계입니다. Google에 Codex·Claude의 임의 localhost 주소를 등록하지 않습니다. MCP client callback은 기존 서버의 OAuth 등록·검증을 따릅니다.

## 설정 중 권한 오류 또는 Worker 암호화 오류

- Google Cloud에서 `iam.serviceAccounts.list` 또는 `oauthconfig.verification.get` 권한 오류가 나면 현재 계정이 OAuth 설정을 관리할 수 있는 프로젝트인지 확인합니다. 서비스 계정 생성이나 토큰 생성자 권한 추가로 해결하지 않습니다. 본인이 관리하는 프로젝트를 선택하거나 새 로그인 전용 프로젝트를 만든 뒤 **Google Auth Platform → 클라이언트 → 웹 애플리케이션**을 사용합니다. 이 변경으로 기존 Supabase 프로젝트나 DB를 새로 만들 필요는 없습니다.
- Workerd에서 `cipher.update()`에 문자열만 넘기면 `ERR_INVALID_ARG_VALUE`가 발생할 수 있습니다. Google PKCE flow와 브라우저 세션 두 곳 모두 `cipher.update(Buffer.from(JSON.stringify(value),'utf8'))`로 명시적인 바이트를 전달합니다. 암호화 키·AES-GCM 포맷·브라우저 결합·기존 암호문은 그대로 유지합니다. Node 테스트만으로 이 런타임 차이를 확인할 수 없으므로 `tests/integration/remote-auth-workerd.test.ts`가 Wrangler에 고정된 Workerd에서 두 경로를 검사합니다. [보고된 런타임 문제](https://github.com/cloudflare/workerd/issues/6920)

기술 구조: 서버 측 S256 PKCE, 10분 해시 쿠키와 암호화 DB flow, 원자적 단일 사용, Supabase getUser 검증, Google identity 확인, 기존 Secure/HttpOnly/CSRF 세션 재사용. Google access token은 보관하지 않습니다. 이전 Supabase UUID가 유지되는 계정은 기존 회사 연결을 사용하고, 다른 신원이면 별도 회사로 취급합니다. 이메일만 같다고 사이트가 자체 계정 병합을 하지 않습니다.

근거: [Supabase Google 로그인 공식 안내](https://supabase.com/docs/guides/auth/social-login/auth-google), [서버 PKCE 흐름](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
