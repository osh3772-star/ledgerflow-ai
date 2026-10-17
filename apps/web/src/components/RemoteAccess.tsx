import {useEffect,useState} from 'react';
import '../styles/remote-access.css';
type Identity={signedIn:boolean;email?:string;csrf?:string};
async function api(path:string,init?:RequestInit){
 const r=await fetch(path,{...init,credentials:'same-origin'}),data=await r.json();
 const errors:Record<string,string>={AUTH_FAILED:path.endsWith('/signup')?'인증 이메일을 보내지 못했습니다. 운영자의 메일 발송 설정을 확인하거나 잠시 후 다시 시도하세요.':'이메일 인증과 비밀번호를 확인하세요.',
  EMAIL_VERIFICATION_REQUIRED:'확인 이메일의 링크로 이메일을 인증한 뒤 다시 로그인하세요.',RATE_LIMITED:'잠시 후 다시 시도하세요.',
  UNAUTHENTICATED:'세션이 만료됐습니다. 다시 로그인하세요.',REMOTE_SERVICE_UNAVAILABLE:'원격 장부 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.',
  WORKSPACE_CAPACITY_REACHED:'체험 계정 정원이 찼습니다. 운영자에게 문의해 주세요.'};
 if(!r.ok)throw new Error(errors[String(data.error)]??'요청을 완료하지 못했습니다. 연결과 로그인 상태를 확인하세요.');
 return data;
}
export default function RemoteAccess(){
 const [config,setConfig]=useState<{available:boolean;mcpUrl?:string}>(),[identity,setIdentity]=useState<Identity>({signedIn:false});
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[signup,setSignup]=useState(false);
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false);
 const [consent,setConsent]=useState<{clientName:string;redirectUri:string}>();
 const [connections,setConnections]=useState<{id:string;name:string;revoked:boolean}[]>([]);
 const authorizing=typeof window!=='undefined'&&window.location.pathname==='/oauth/authorize';
 const authorization=typeof window==='undefined'?'':window.location.pathname+window.location.search;
 const authPath='/api/remote/authorization?request='+encodeURIComponent(authorization);
 useEffect(()=>{void(async()=>{
  // Supabase email confirmation may redirect with a provider token fragment.
  // Login uses server-held cookies; never retain that fragment or store it.
  if(window.location.hash.includes('access_token='))window.history.replaceState(null,'',window.location.pathname+window.location.search);
  try{const value=await api('/api/remote/config');setConfig(value);if(!value.available)return;
   const session=await api('/api/remote/session');setIdentity(session);
   if(session.signedIn){if(authorizing)setConsent(await api(authPath));setConnections(await api('/api/remote/connections'));}
  }catch(e){if(authorizing)setMessage(String(e));}
 })();},[]);
 async function login(event:React.FormEvent){
  event.preventDefault();setBusy(true);setMessage('');
  try{const data=await api('/api/remote/'+(signup?'signup':'login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
   setPassword('');if(data.confirmationRequired)setMessage('확인 이메일의 링크로 이메일을 인증한 뒤, 로그인해 주세요.');
   else window.location.reload();
  }catch(e){setPassword('');setMessage(String(e));}finally{setBusy(false);}
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
 const origin=config.mcpUrl?.replace(/\/mcp$/u,'')??'';
 return <section className={'remote-access '+(authorizing?'remote-authorize':'')} aria-label="내 장부와 AI 앱 연결">
  <div className="remote-title"><div><strong>{authorizing?'AI 앱에 내 장부 연결':identity.signedIn?'내 전용 장부':'설치 없이 내 장부 사용하기'}</strong>
   <p>{identity.signedIn?identity.email:'같은 예제 거래로 시작해도, 로그인한 계정마다 전표·승인·장부가 따로 저장됩니다.'}</p></div>
   {!authorizing&&config.available&&<button className="secondary" onClick={()=>setExpanded(!expanded)}>{expanded?'접기':identity.signedIn?'AI 연결·계정 관리':'로그인·시작하기'}</button>}</div>
  {!config.available&&<p className="muted">현재는 공개 샘플 조회 모드입니다. 운영자의 원격 DB 설정이 완료되면 이곳에서 로그인하고 AI 앱을 연결할 수 있습니다.</p>}
  {config.available&&(expanded||authorizing)&&<>
   {!identity.signedIn?<form onSubmit={event=>void login(event)} className="remote-form">
    <label>이메일<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>비밀번호<input type="password" autoComplete={signup?'new-password':'current-password'} required minLength={8} maxLength={200} value={password} onChange={e=>setPassword(e.target.value)}/></label>
    <button type="submit" disabled={busy}>{busy?'확인 중…':signup?'인증 이메일 받기':'로그인'}</button>
    <button type="button" className="text-button" onClick={()=>{setSignup(!signup);setPassword('');setMessage('');}}>{signup?'기존 계정으로 로그인':'처음 방문 · 회원가입'}</button>
    <p className="muted">본인 확인은 장부 분리를 위한 절차입니다. 비밀번호·공공 API 키를 AI 대화창에 보내지 마세요.</p>
   </form>:authorizing?<div className="remote-consent">
    {consent&&<><h3>{consent.clientName} 연결을 허용하시겠어요?</h3><p>이 앱은 내 가상회사의 거래 조회·전표 초안·검증·승인 요청과, 내가 승인한 전표의 장부 반영을 요청할 수 있습니다.</p>
     <p><strong>사용자 승인 권한은 포함되지 않습니다.</strong> 전표 승인은 이 사이트에서 직접 진행합니다.</p>
     <p>연결을 마치면 돌아갈 주소: <code>{consent.redirectUri}</code></p>
     <button disabled={busy} onClick={()=>void connect()}>내 장부 연결 허용</button> <a href="/">취소하고 사이트로 돌아가기</a></>}
   </div>:<div className="remote-connection">
    <p>① 아래 주소를 사용 중인 AI 앱의 원격 MCP 설정에 추가 → ② 브라우저에서 이 계정으로 로그인·연결 허용 → ③ AI에게 분개 요청 → ④ 이 사이트에서 직접 승인 → ⑤ AI에게 장부 반영 요청.</p>
    <label>MCP 서버 주소<input readOnly value={config.mcpUrl??''}/></label><button className="secondary" onClick={()=>void copy(config.mcpUrl??'')}>주소 복사</button>
    <details><summary>Codex · 코덱스 연결</summary><p>MCP 설정에서 HTTP 서버를 추가하세요. CLI를 사용하는 경우:</p><pre>{'codex mcp add ledgerflow-accounting-mcp --url '+origin+'/mcp\ncodex mcp login ledgerflow-accounting-mcp'}</pre></details>
    <details><summary>Claude Code · 클로드 코드 연결</summary><pre>{'claude mcp add --transport http ledgerflow-accounting-mcp '+origin+'/mcp'}</pre><p>이후 Claude Code의 <code>/mcp</code>에서 인증합니다. Claude 웹·데스크톱에서 원격 커넥터를 지원하는 계정은 같은 URL을 등록할 수 있습니다.</p></details>
    <p>서버·Node.js·DB·공공 API 키 설치는 필요 없습니다. AI 앱과 사용 가능한 계정은 별도로 필요하며, 사이트가 앱의 연결 설정을 자동 변경하지는 않습니다.</p>
    <details><summary>연결한 앱과 접근 취소</summary>{connections.filter(c=>!c.revoked).map(c=><p key={c.id}>{c.name} <button className="secondary" onClick={()=>void revoke(c.id)}>이 연결 취소</button></p>)}</details>
    <button className="secondary" onClick={()=>void logout()}>로그아웃</button>
   </div>}
  </>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
