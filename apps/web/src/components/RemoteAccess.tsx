import {useEffect,useState} from 'react';
import {PromptBox} from './LearningStart.js';
import learning from '../../../../docs/learning-start.json' with {type:'json'};
import '../styles/remote-access.css';
type Identity={signedIn:boolean;email?:string;csrf?:string};
async function api(path:string,init?:RequestInit){
 const r=await fetch(path,{...init,credentials:'same-origin'}),data=await r.json();
 const errors:Record<string,string>={AUTH_FAILED:'Google 로그인을 다시 시작하세요.',GOOGLE_PROVIDER_NOT_CONFIGURED:'Google 로그인을 준비 중입니다. 잠시 후 다시 확인해 주세요.',
  GOOGLE_PROVIDER_UNAVAILABLE:'Google 로그인 설정을 확인하지 못했습니다. 잠시 후 다시 시도하세요.',
  EMAIL_VERIFICATION_REQUIRED:'Google 계정의 이메일 확인 상태를 확인하세요.',RATE_LIMITED:'잠시 후 다시 시도하세요.',
  UNAUTHENTICATED:'세션이 만료됐습니다. 다시 로그인하세요.',REMOTE_SERVICE_UNAVAILABLE:'원격 장부 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.',
  WORKSPACE_CAPACITY_REACHED:'현재 학습 계정 정원이 찼습니다. 잠시 후 다시 확인해 주세요.'};
 if(!r.ok)throw new Error(errors[String(data.error)]??'요청을 완료하지 못했습니다. 연결과 로그인 상태를 확인하세요.');
 return data;
}
export default function RemoteAccess(){
 const [config,setConfig]=useState<{available:boolean;mcpUrl?:string;googleLogin?:{enabled:boolean;checked:boolean}}>(),[identity,setIdentity]=useState<Identity>({signedIn:false});
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false);
 const [consent,setConsent]=useState<{clientName:string;redirectUri:string}>();
 const [connections,setConnections]=useState<{id:string;name:string;revoked:boolean}[]>([]);
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
  try{const value=await api('/api/remote/config');setConfig(value);if(!value.available)return;
   const session=await api('/api/remote/session');setIdentity(session);
   if(session.signedIn){if(authorizing)setConsent(await api(authPath));setConnections(await api('/api/remote/connections'));}
  }catch(e){if(authorizing)setMessage(String(e));}
 })();},[]);
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
 return <section className={'remote-access '+(authorizing?'remote-authorize':'')} aria-label="내 장부와 AI 앱 연결">
  <div className="remote-title"><div><strong>{authorizing?'AI 앱에 내 장부 연결':identity.signedIn?'내 전용 장부':'Google로 내 연습 장부 열기'}</strong>
   <p>{identity.signedIn?identity.email:'같은 예제 거래로 시작해도, 로그인한 계정마다 전표·승인·장부가 따로 저장됩니다.'}</p></div>
   {!authorizing&&config.available&&<button className="secondary" onClick={()=>setExpanded(!expanded)}>{expanded?'접기':identity.signedIn?'AI 연결·계정 관리':'로그인·시작하기'}</button>}</div>
  {!config.available&&<p className="muted">지금은 예시 자료를 살펴볼 수 있습니다. 개인 장부 연결은 준비 중입니다. 먼저 ‘처음 사용하기’에서 학습 순서를 확인하세요.</p>}
  {config.available&&(expanded||authorizing)&&<>
   {!identity.signedIn?<div className="remote-google-login">
    <p>Google 계정으로 내 장부를 여세요. 처음 로그인하면 내 전용 가상회사가 준비됩니다. 별도 비밀번호나 가입 확인메일은 필요 없습니다.</p>
    <button type="button" className="remote-google-button" onClick={()=>void login()} disabled={busy||!config.googleLogin?.enabled}><span aria-hidden="true">G</span>{busy?'Google로 이동 중…':'Google로 계속하기'}</button>
    {!config.googleLogin?.enabled&&<p className="remote-google-setup">{config.googleLogin?.checked?'Google 로그인을 준비 중입니다. 잠시 후 다시 확인해 주세요.':'Google 로그인 상태를 확인하지 못했습니다. 잠시 후 새로고침해 주세요.'}</p>}
    <p className="muted">사이트와 AI 앱 연결 화면에서 같은 Google 계정을 선택하세요. 장부 승인은 로그인 후에도 사이트에서 직접 진행합니다.</p>
   </div>:authorizing?<div className="remote-consent">
    {consent&&<><h3>{consent.clientName} 연결을 허용하시겠어요?</h3><p>이 앱은 내 가상회사의 거래 조회·전표 초안·검증·승인 요청과, 내가 승인한 전표의 장부 반영을 요청할 수 있습니다.</p>
     <p><strong>사용자 승인 권한은 포함되지 않습니다.</strong> 전표 승인은 이 사이트에서 직접 진행합니다.</p>
     <p>연결을 마치면 돌아갈 주소: <code>{consent.redirectUri}</code></p>
     <button disabled={busy} onClick={()=>void connect()}>내 장부 연결 허용</button> <a href="/">취소하고 사이트로 돌아가기</a></>}
   </div>:<div className="remote-connection">
    <p>처음이면 아래 요청문을 코덱스 또는 클로드 코드에 보내세요. AI가 학습에 필요한 연결과 역할 파일을 준비합니다. Google 로그인과 ‘내 장부 연결 허용’은 같은 계정으로 직접 진행하세요.</p>
    <PromptBox title="AI와 회계 공부 시작하기" prompt={learning.setupPrompt} hint="이미 연결했다면 다시 설치하지 않아도 됩니다. AI에게 첫 거래 연습을 요청하세요."/>
    <details><summary>연결 주소가 필요한 경우</summary><label>회계 도구 연결 주소<input readOnly value={config.mcpUrl??''}/></label><button className="secondary" onClick={()=>void copy(config.mcpUrl??'')}>주소 복사</button><p>처음 사용하기의 시작 요청문이 이 주소를 사용합니다. 주소가 저장된 것과 실제 로그인·연결 성공은 다릅니다.</p></details>
    <p><a href="/workflow/">연결 후 첫 거래부터 보고서까지 배우기 →</a></p>
    <details><summary>연결한 앱과 접근 취소</summary>{connections.filter(c=>!c.revoked).map(c=><p key={c.id}>{c.name} <button className="secondary" onClick={()=>void revoke(c.id)}>이 연결 취소</button></p>)}</details>
    <button className="secondary" onClick={()=>void logout()}>로그아웃</button>
   </div>}
  </>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
