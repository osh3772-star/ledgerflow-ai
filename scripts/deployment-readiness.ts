import {validateSessionEncryptionKey} from '../apps/mcp-server/src/human-session-store.js';
export type PrerequisiteStatus='ready'|'needed'|'unverified';
export interface Prerequisite{id:string;owner:'user'|'codex'|'shared';status:PrerequisiteStatus;nextAction:string}
export interface LocalDeploymentFacts{
  dockerInstalled:boolean;dockerDaemonReady:boolean;githubInstalled:boolean;githubAuthenticated:boolean;
  gitHasCommit:boolean;gitHasRemote:boolean;dashboardBuilt:boolean;projectClientsMatch:boolean;
}
export function deploymentReadiness(environment:NodeJS.ProcessEnv,facts:LocalDeploymentFacts){
  const present=(name:string)=>Boolean(environment[name]?.trim());
  const profile=environment.LEDGERFLOW_MCP_MODE??'demo';
  const profileValid=['demo','postgres'].includes(profile);
  const databaseConfigured=['LEDGERFLOW_DATABASE_URL','LEDGERFLOW_USER_ID','LEDGERFLOW_COMPANY_ID'].every(present);
  const externalAuthConfigured=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY'].every(present);
  const sessionStore=environment.LEDGERFLOW_HUMAN_SESSION_STORE??'memory';
  let sessionKeyValid=false;
  try{validateSessionEncryptionKey(environment.LEDGERFLOW_SESSION_ENCRYPTION_KEY??'');sessionKeyValid=true;}catch{/* Presence and format only. */}
  const sessionConfigReady=sessionStore==='memory'||sessionStore==='postgres'&&profile==='postgres'&&externalAuthConfigured&&sessionKeyValid;
  const profileReady=profileValid&&sessionConfigReady&&(profile==='demo'?!present('LEDGERFLOW_DATABASE_URL'):databaseConfigured);
  const tasks:Prerequisite[]=[
    {id:'github-login',owner:'user',status:facts.githubAuthenticated?'ready':'needed',nextAction:'CLI 경로를 사용할 때만 gh auth login을 직접 수행한다. 연결된 GitHub 앱을 사용하는 경우 생략할 수 있다.'},
    {id:'github-repository',owner:'shared',status:facts.gitHasCommit&&facts.gitHasRemote?'ready':'needed',nextAction:'사용자가 공개 저장소를 정하면 Codex가 공개 파일 검토·연결·push·CI 결과 확인을 수행한다.'},
    {id:'docker-engine',owner:'user',status:facts.dockerDaemonReady?'ready':'needed',nextAction:'Docker 실행 환경을 준비하고 엔진을 켠다. GitHub Linux CI로도 검증할 수 있다.'},
    {id:'docker-image-verification',owner:'codex',status:'unverified',nextAction:'실제 Docker build와 비관리자 foreground MCP smoke 결과를 확인한다.'},
    {id:'supabase-project',owner:'user',status:databaseConfigured&&externalAuthConfigured?'ready':'needed',nextAction:'개발 프로젝트 연결값과 사용자 UUID를 ignored .env.local에만 설정한다.'},
    {id:'supabase-live-verification',owner:'codex',status:'unverified',nextAction:'설정 후 Auth·Storage·회사 격리와 기존 DB 연결을 실제 개발 프로젝트에서 검증한다.'},
    {id:'native-app-acceptance',owner:'shared',status:'unverified',nextAction:'사용자가 두 앱을 설치·로그인·재로드하고 앱별 도구/역할 실행 증거를 확인한다.'},
    {id:'human-ledger-decision',owner:'user',status:'unverified',nextAction:'각 승인 대상의 내용·version/hash를 직접 검토하고 웹 승인/반려를 결정한다.'},
    {id:'remote-security',owner:'codex',status:'needed',nextAction:'선택적 암호화 DB 세션을 구현했다. 클라이언트별 OAuth·HTTPS와 실제 외부 인증/배포 검증을 이어간다.'},
    {id:'deployment-account-and-target',owner:'user',status:'needed',nextAction:'배포가 필요하면 계정·도메인·비용 한도를 정한다. 로컬 포트폴리오에는 필요 없다.'},
  ];
  return {profile:profileValid?profile:'invalid',configuration:{databaseConfigured,externalAuthConfigured,
    humanSessionStore:['memory','postgres'].includes(sessionStore)?sessionStore:'invalid',sessionConfigReady},facts,tasks,
    localPreparationPassed:profileReady&&facts.dashboardBuilt&&facts.projectClientsMatch,
    externalVerificationComplete:false,remoteMcpImplemented:false,cloudflareBackendVerified:false,
    accountingMutations:0,publicApiCalls:0,paidModelApiCalls:0};
}
