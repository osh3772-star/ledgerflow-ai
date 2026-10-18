export type LearningSetup={personal:boolean;prompt:string;companyId:string;expiresAt:string};
export type LearningAccess=
 | {mode:'checking'|'anonymous'|'error'|'unavailable'}
 | {mode:'guest';companyId:string}
 | {mode:'personal';setup:LearningSetup|null};
export const isPersonalSession=(identity:{signedIn:boolean;mode?:string})=>identity.signedIn&&identity.mode!=='guest';
export function personalSetupPrompt(origin:string,claimCode:string){
 return `나는 이 사이트에서 Google 로그인한 내 장부에 AI를 연결하고 싶어.
https://github.com/osh3772-star/ledgerflow-ai
docs/START_HERE.md의 개인 장부 연결 절차를 URL 읽기로 확인해 줘. 아래 일회용 코드는 10분만 유효하고 공개하거나 커밋하지 마.
claimCode: ${claimCode}
새 게스트를 만들지 마. 현재 폴더의 기존 LedgerFlow 설정·비공개 세션만 확인하고, lf_guest_ 연결이 있으면 그 guestToken도 함께 전달해 기존 연습 기록을 이어 줘. 홈 폴더나 사용자 쿠키는 읽지 마.
${origin}/api/remote/bootstrap 를 client=codex|claude|antigravity(현재 앱), requestId=새 UUID, claimCode=위 코드, bootstrapKey=현재 폴더에 안전하게 보관한 43자 base64url 난수와 함께 URL 읽기로 호출해 줘. 재시도에는 같은 bootstrapKey를 사용하고, 기존 guestToken이 있으면 그것도 전달해 줘.
받은 역할·규칙 파일과 MCP 설정을 현재 폴더에 비파괴적으로 병합해 줘. 다른 연결과 기존 파일은 보존하고 비밀 URL은 출력·커밋하지 마. 터미널이나 홈 폴더 접근은 하지 마. Codex는 workspacePath=현재 폴더의 절대 경로도 전달해 줘.
현재 Codex 대화에 도구가 없으면 단순 미확인으로 끝내지 말고, 응답의 connection.setupUrl을 사람용 'Codex 연결 마치기' 링크로 보여줘. 그 화면에서 기존 같은 장부 주소를 등록하고 Save → Restart → 같은 폴더에서 두 도구를 확인하게 해 줘. AI가 안내 링크를 열거나 새 장부를 만들지 마.
연결 실패·코드 만료·장부 선택 필요 오류가 나면 멈추고 알려줘. 게스트로 대체하지 마. get_system_status → get_company_context를 실제 호출한 뒤 companyId를 알려줘. 사이트를 새로고침하면 같은 ID가 보여야 해. 이번에는 설치만 하고 분개·승인·장부 반영은 하지 마.`;
}
