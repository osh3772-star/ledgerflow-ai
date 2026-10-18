import {useEffect,useState} from 'react';
import {codexRepairPrompt} from './PersonalSetup.js';

export type CodexConnectionView={connectionId:string;companyId:string;server:string;mcpUrl:string;settingsUrl:string;resumeUrl:string|null;
 verificationPrompt:string;workspacePath:string|null;clientName:string|null;checks:{get_system_status:string|null;get_company_context:string|null};verified:boolean;evidence:string};
const storageKey='lf-codex-pending-setup';
export function CodexConnectionContent({view,copied,onCopy}:{view:CodexConnectionView;copied:string;onCopy:(value:string,label:string)=>void}){
 return <><div className={'connection-status '+(view.verified?'complete':'pending')} role="status"><strong>{view.verified?'두 확인 도구 호출이 도착했어요':'설정 준비 완료 · 실제 앱 연결 확인 대기'}</strong><p>{view.verified?'아래 회사 ID가 Codex의 응답과 같으면 첫 거래 공부를 시작하세요.':'현재 학습 폴더 신뢰와 주소 등록은 AI가 자동으로 처리합니다. 직접 MCP 등록 메뉴를 찾을 필요 없어요. 앱이 자동 재읽기를 지원하지 않으면 그 상태를 따로 알려줍니다.'}</p></div>
 <section className="connection-company"><span>지금 연결할 장부의 회사 ID</span><code>{view.companyId}</code><small>이미 준비한 같은 장부입니다. 다시 설치하거나 새 장부를 만들 필요 없어요.</small></section>
 <section className="connection-company"><h2>기존 AI 대화에서 자동으로 복구해요</h2>{view.workspacePath&&<p>사용하던 폴더: <code>{view.workspacePath}</code></p>}<p>최신 시작 요청문에는 자동 등록이 포함되어 있어요. 이전 안내에서 멈췄다면 아래 요청문을 같은 Codex 대화에 보내세요. 같은 회사와 기존 연결 키를 재사용합니다.</p><textarea readOnly aria-label="Codex 자동 연결 복구 요청문" value={codexRepairPrompt(view.companyId)} rows={7}/><p><button onClick={()=>onCopy(codexRepairPrompt(view.companyId),'자동 연결 복구 요청문')}>자동 연결 복구 요청문 복사</button></p><p className="connection-note">AI가 연결 도우미를 한 번 실행합니다. 앱 자체의 실행 허용이 나타나면 앱 정책을 따릅니다. 등록 완료와 실제 앱의 도구 호출 성공은 따로 확인하며, 새 회사·분개·승인을 만들지 않습니다.</p></section><p className="connection-copy-status" role="status">{copied}</p>
 <section className="connection-receipts"><h2>서버에서 확인한 실제 호출</h2><p>페이지를 켜 둔 동안 5초마다 확인해요. 설치기의 별도 연결 검사는 여기에 성공으로 표시하지 않아요.</p><ul>{(['get_system_status','get_company_context'] as const).map(name=><li key={name}><code>{name}</code><strong>{view.checks[name]?'호출 성공 · '+new Date(view.checks[name]!).toLocaleTimeString('ko-KR'):'아직 도착하지 않음'}</strong></li>)}</ul>{view.clientName&&<p>연결 앱이 알려 준 이름: {view.clientName}</p>}<small>{view.evidence}</small></section>
 <details><summary>자동 연결 결과가 대기라고 나오면</summary><p>configurationRegistered는 Codex에 주소를 자동 등록했다는 뜻이고, nativeClientVerified는 실제 실행 중 앱의 같은 대화에서 확인 도구 두 개가 성공했다는 뜻이에요. CODEX_CONTROL_UNAVAILABLE은 실행 중 앱의 자동 재읽기용 제어 연결에 접속하지 못했다는 뜻입니다. 등록을 반복하거나 새 장부를 만들지 말고 그 결과를 AI에게 보여 주세요. 이 경우 완전 자동 완료가 확인된 것은 아닙니다.</p><p>Google 장부의 연결을 취소했거나 유효 기간이 지났다면 사이트에서 새 개인 연결 요청문을 받으세요. 게스트 장부로 바꿔서 해결하지 마세요.</p></details>
 <p><a href="/">사이트로 돌아가기 →</a></p></>;
}
export default function CodexConnection(){
 const [view,setView]=useState<CodexConnectionView|null>(null),[error,setError]=useState(''),[login,setLogin]=useState(false),[copied,setCopied]=useState('');
 useEffect(()=>{
  let disposed=false,busy=false;const hash=new URLSearchParams(window.location.hash.slice(1)),ticket=hash.get('ticket');
  let pendingTicket:string|null=null,connectionId:string|null=null;
  try{pendingTicket=sessionStorage.getItem(storageKey);connectionId=sessionStorage.getItem(storageKey+'-id');}catch{}
  if(ticket&&/^[A-Za-z0-9_-]{43}$/u.test(ticket)){pendingTicket=ticket;try{sessionStorage.setItem(storageKey,ticket);history.replaceState(null,'',location.pathname);}catch{}}
  async function read(){
   if(busy||disposed||document.visibilityState==='hidden')return;busy=true;
   try{
    if(!pendingTicket&&!connectionId){setError('AI가 준 “Codex 연결 마치기” 링크를 열어 주세요.');return;}
    const response=pendingTicket?await fetch('/api/remote/client-setup/open',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:pendingTicket})}):await fetch('/api/remote/client-setup/status?connectionId='+encodeURIComponent(connectionId!),{credentials:'same-origin',cache:'no-store'});
    const body=await response.json();if(disposed)return;
    if(!response.ok){setView(null);setLogin(body.error==='UNAUTHENTICATED');setError(body.error==='UNAUTHENTICATED'?'개인 장부 연결입니다. 연결 요청문을 만든 같은 Google 계정으로 로그인하세요.':body.error==='FORBIDDEN'?'다른 Google 계정의 연결 안내입니다. 원래 계정으로 사이트에 로그인한 뒤 이 안내를 다시 열어 주세요.':body.error==='CONNECTION_EXPIRED'?'연결이 만료·취소되었거나 회사가 바뀌었습니다. 사이트에서 새 연결 요청문을 받으세요.':'이 안내가 만료되었거나 이미 사용됐습니다. 설치한 AI에게 “기존 장부의 Codex 연결 마치기 안내를 다시 보여줘”라고 요청하세요.');return;}
    pendingTicket=null;connectionId=body.connectionId;history.replaceState(null,'',location.pathname);
    try{sessionStorage.removeItem(storageKey);sessionStorage.setItem(storageKey+'-id',body.connectionId);}catch{}
    setLogin(false);setError('');setView(body);if(body.verified)clearInterval(timer);
   }catch{if(!disposed)setError('연결 상태를 불러오지 못했어요. 잠시 후 자동으로 다시 확인합니다.');}finally{busy=false;}
  }
  const timer=setInterval(()=>void read(),5000);void read();
  return ()=>{disposed=true;clearInterval(timer);};
 },[]);
 async function google(){
  try{const response=await fetch('/api/remote/google/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnTo:'/connect/codex/'})});const body=await response.json();if(!response.ok)throw new Error();location.assign(body.redirect);}catch{setError('Google 로그인을 시작하지 못했어요. 사이트에서 로그인한 뒤 이 안내를 다시 열어 주세요.');}
 }
 async function copy(value:string,label:string){try{await navigator.clipboard.writeText(value);setCopied(label+'를 복사했어요.');}catch{setCopied('자동 복사가 제한됐어요. 입력칸의 내용을 직접 선택해 복사하세요.');}}
 return <main className="codex-connect"><a className="connection-home" href="/">한빛유통 · 회계 자동화 학습실</a><header><span>연결 상태 · Codex</span><h1>Codex 자동 연결 확인</h1><p>AI가 등록하고, 이 화면에서는 같은 장부에 도구 호출이 도착했는지 확인해요.</p></header>{error&&<div className="connection-error" role="alert">{error}{login&&<p><button onClick={()=>void google()}>같은 Google 계정으로 로그인</button></p>}</div>}{view?<CodexConnectionContent view={view} copied={copied} onCopy={(value,label)=>void copy(value,label)}/>:!error&&<p role="status">내 장부 연결 안내를 불러오는 중…</p>}</main>;
}
