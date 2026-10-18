import {useEffect,useState} from 'react';
import {PromptBox} from './LearningStart.js';
import '../styles/remote-access.css';
import {personalSetupPrompt,isPersonalSession,type LearningAccess,type LearningSetup} from './PersonalSetup.js';
type Identity={signedIn:boolean;email?:string;csrf?:string;mode?:string;companyId?:string;expiresAt?:string};
async function api(path:string,init?:RequestInit){
 const r=await fetch(path,{...init,credentials:'same-origin'}),data=await r.json();
 const errors:Record<string,string>={AUTH_FAILED:'Google 로그인을 다시 시작하세요.',GOOGLE_PROVIDER_NOT_CONFIGURED:'Google 로그인을 준비 중입니다. 잠시 후 다시 확인해 주세요.',
  GOOGLE_PROVIDER_UNAVAILABLE:'Google 로그인 설정을 확인하지 못했습니다. 잠시 후 다시 시도하세요.',
  EMAIL_VERIFICATION_REQUIRED:'Google 계정의 이메일 확인 상태를 확인하세요.',RATE_LIMITED:'잠시 후 다시 시도하세요.',
  UNAUTHENTICATED:'세션이 만료됐습니다. 다시 로그인하세요.',REMOTE_SERVICE_UNAVAILABLE:'원격 장부 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.',
  WORKSPACE_CAPACITY_REACHED:'현재 학습 계정 정원이 찼습니다. 잠시 후 다시 확인해 주세요.'};
 errors.WORKSPACE_SELECTION_REQUIRED='두 장부에 작업 기록이 있어 자동으로 합치지 않았습니다. 보관할 장부를 먼저 확인하세요.';
 if(!r.ok)throw new Error(errors[String(data.error)]??'요청을 완료하지 못했습니다. 연결과 로그인 상태를 확인하세요.');
 return data;
}
export default function RemoteAccess({onAccess}:{onAccess?:(access:LearningAccess)=>void}){
 const [config,setConfig]=useState<{available:boolean;mcpUrl?:string;googleLogin?:{enabled:boolean;checked:boolean}}>(),[identity,setIdentity]=useState<Identity>({signedIn:false});
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false);
 const [consent,setConsent]=useState<{clientName:string;redirectUri:string}>();
 const [connections,setConnections]=useState<{id:string;name:string;revoked:boolean}[]>([]);
 const [setup,setSetup]=useState<LearningSetup|null>(null);
 const [access,setAccess]=useState<LearningAccess>({mode:'checking'});
 function report(value:LearningAccess){setAccess(value);onAccess?.(value);}
 const authorizing=typeof window!=='undefined'&&window.location.pathname==='/oauth/authorize';
 const authorization=typeof window==='undefined'?'':window.location.pathname+window.location.search;
 const authPath='/api/remote/authorization?request='+encodeURIComponent(authorization);
 useEffect(()=>{void(async()=>{
  // Discard legacy implicit-token fragments. Google uses server-side PKCE.
  if(window.location.hash.includes('access_token='))window.history.replaceState(null,'',window.location.pathname+window.location.search);
  if(window.location.pathname==='/'&&new URLSearchParams(window.location.search).get('auth_error')==='google_failed'){
   setMessage('Google 로그인을 완료하지 못했습니다. 취소·만료되었거나 연결 설정에 문제가 있을 수 있습니다. 다시 시도하세요.');setExpanded(true);
   window.history.replaceState(null,'',window.location.pathname);
  }
  try{const value=await api('/api/remote/config');setConfig(value);if(!value.available){report({mode:'unavailable'});return;}
   const session=await api('/api/remote/session');
   if(authorizing&&session.mode==='guest'){setIdentity({signedIn:false});report({mode:'guest',companyId:session.companyId??''});return;}
   setIdentity(session);
   if(isPersonalSession(session)){report({mode:'personal',setup:null});if(!authorizing)await issueSetup(session).catch(e=>setMessage(String(e)));}
   else if(session.mode==='guest')report({mode:'guest',companyId:session.companyId??''});
   else{report({mode:'anonymous'});setExpanded(true);}
   if(session.signedIn){try{if(authorizing)setConsent(await api(authPath));setConnections(await api('/api/remote/connections'));}catch(e){setMessage(String(e));}}
  }catch(e){report({mode:'error'});setMessage(String(e));}
 })();},[]);
 async function issueSetup(session=identity){
  report({mode:'personal',setup:null});setSetup(null);setMessage('');
  const ticket=await api('/api/remote/setup-ticket',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf??''},body:'{}'});
  const value={personal:true,prompt:personalSetupPrompt(window.location.origin,ticket.claimCode),companyId:ticket.companyId,expiresAt:ticket.expiresAt};setSetup(value);report({mode:'personal',setup:value});
 }
 async function login(){
  setBusy(true);setMessage('');
  try{const data=await api('/api/remote/google/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnTo:authorizing?authorization:'/'})});
   window.location.assign(data.redirect);
  }catch(e){setMessage(String(e));setBusy(false);}
 }
 async function mutation(path:string,body?:unknown){
  return api(path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':identity.csrf??''},body:JSON.stringify(body??{})});
 }
 async function connect(){setBusy(true);try{const result=await mutation(authPath);window.location.assign(result.redirect);}
  catch(e){setMessage(String(e));setBusy(false);}}
 async function logout(){try{await mutation('/api/remote/logout');window.location.assign('/');}catch(e){setMessage(String(e));}}
 async function revoke(id:string){try{await mutation('/api/remote/connections',{id});setConnections(await api('/api/remote/connections'));}catch(e){setMessage(String(e));}}
 async function copy(text:string){try{await navigator.clipboard.writeText(text);setMessage('복사했습니다.');}catch{setMessage('아래 주소나 명령을 직접 복사하세요.');}}
 if(!config)return null;
 return <section id="remote-access" className={'remote-access '+(authorizing?'remote-authorize':'')} aria-label="내 장부와 AI 앱 연결">
  <div className="remote-title"><div><strong>{authorizing?'AI 앱에 내 장부 연결':access.mode==='checking'?'로그인 상태 확인 중':access.mode==='error'?'로그인 상태 확인 필요':access.mode==='guest'?'연결된 임시 장부 · 이어서 학습':access.mode==='personal'?'Google 로그인 완료 · 내 장부 연결':'비로그인 · 새 임시 장부로 체험'}</strong>
   <p>{access.mode==='guest'?'이미 연결된 임시 장부를 사용합니다. 새 장부를 만들 필요가 없어요.':access.mode==='personal'?identity.email:access.mode==='checking'?'상태를 확인한 뒤 알맞은 연결 요청문만 표시합니다.':access.mode==='error'?'잘못된 장부에 연결되지 않도록 요청문 복사를 중단했습니다. 사이트를 새로고침해 주세요.':'비로그인은 24시간 임시 체험입니다. 내 Google 장부를 쓰려면 먼저 아래에서 로그인하세요.'}</p></div>
   {!authorizing&&config.available&&<button className="secondary" onClick={()=>setExpanded(!expanded)}>{expanded?'접기':identity.signedIn?'AI 연결·장부 관리':'시작 안내·선택적 보관'}</button>}</div>
  {!config.available&&<p className="muted">지금은 예시 자료를 살펴볼 수 있습니다. 개인 장부 연결은 준비 중입니다. 먼저 ‘처음 사용하기’에서 학습 순서를 확인하세요.</p>}
  {config.available&&access.mode==='error'&&<button type="button" className="remote-google-button" disabled={busy||!config.googleLogin?.enabled} onClick={()=>void login()}>Google로 다시 로그인</button>}
  {config.available&&access.mode!=='checking'&&access.mode!=='error'&&(expanded||authorizing)&&<>
   {!identity.signedIn?<div className="remote-google-login">
    <p>아래에서 Google 로그인하면 <strong>내 장부 전용 요청문</strong>으로 바뀝니다. 로그인 없이 체험하려면 아래 ‘비로그인 · 새 임시 장부 시작’ 요청문을 사용하세요.</p>
    <button type="button" className="remote-google-button" onClick={()=>void login()} disabled={busy||!config.googleLogin?.enabled}><span aria-hidden="true">G</span>{busy?'Google로 이동 중…':'Google 로그인 · 내 장부 사용'}</button>
    {!config.googleLogin?.enabled&&<p className="remote-google-setup">{config.googleLogin?.checked?'Google 로그인을 준비 중입니다. 잠시 후 다시 확인해 주세요.':'Google 로그인 상태를 확인하지 못했습니다. 잠시 후 새로고침해 주세요.'}</p>}
    <p className="muted">로그인: 이 사이트의 ‘사용자 승인’에서 검토합니다. 비로그인: AI가 준 임시 승인 링크에서 검토합니다. 기존 임시 장부를 보관하려면 그 승인 화면의 Google 연결 버튼을 사용하세요.</p>
   </div>:authorizing?<div className="remote-consent">
    {consent&&<><h3>{consent.clientName} 연결을 허용하시겠어요?</h3><p>이 앱은 내 가상회사의 거래 조회·전표 초안·검증·승인 요청과, 내가 승인한 전표의 장부 반영을 요청할 수 있습니다.</p>
     <p><strong>사용자 승인 권한은 포함되지 않습니다.</strong> 전표 승인은 이 사이트에서 직접 진행합니다.</p>
     <p>연결을 마치면 돌아갈 주소: <code>{consent.redirectUri}</code></p>
     <button disabled={busy} onClick={()=>void connect()}>내 장부 연결 허용</button> <a href="/">취소하고 사이트로 돌아가기</a></>}
   </div>:<div className="remote-connection">
    <p>{access.mode==='personal'?'아래 요청문은 지금 로그인한 내 장부 전용입니다. 같은 폴더에서 보내면 기존 임시 연결도 이어 줍니다. 새 게스트 장부를 만들지 않습니다.':'현재 연결된 임시 장부에서 학습을 계속합니다. 기록을 보관할 때는 전용 승인 화면에서 Google을 연결하세요.'}</p>
    {access.mode==='personal'?<>{setup?<PromptBox title="Google 로그인 · 내 장부 연결 요청문" prompt={setup.prompt} copyLabel="내 장부 연결 요청문 복사" hint={'10분 안에 AI에게 보내세요. 연결 키는 7일 유효하며 아래에서 접근을 취소할 수 있습니다. 회사 ID: '+setup.companyId}/>:<p role="status">내 장부 연결 요청문을 준비 중입니다. 실패했다면 다시 발급해 주세요.</p>}<button className="secondary" onClick={()=>void issueSetup().catch(e=>setMessage(String(e)))}>내 장부 요청문 다시 발급</button></>:<p>임시 장부가 이미 연결되어 있어 새 설치 요청문을 표시하지 않습니다. 같은 AI 작업 폴더에서 학습을 계속하세요. 기록 보관은 해당 전표의 임시 승인 화면에서 Google을 연결합니다.</p>}
    <details><summary>연결 주소가 필요한 경우</summary><label>회계 도구 연결 주소<input readOnly value={config.mcpUrl??''}/></label><button className="secondary" onClick={()=>void copy(config.mcpUrl??'')}>주소 복사</button><p>처음 사용하기의 시작 요청문이 이 주소를 사용합니다. 주소가 저장된 것과 실제 로그인·연결 성공은 다릅니다.</p></details>
    <p><a href="/workflow/">연결 후 첫 거래부터 보고서까지 배우기 →</a></p>
    <details><summary>연결한 앱과 접근 취소</summary>{connections.filter(c=>!c.revoked).map(c=><p key={c.id}>{c.name} <button className="secondary" onClick={()=>void revoke(c.id)}>이 연결 취소</button></p>)}</details>
    <button className="secondary" onClick={()=>void logout()}>로그아웃</button>
   </div>}
  </>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
