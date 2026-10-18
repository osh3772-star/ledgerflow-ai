import {useEffect,useState} from 'react';

export type CodexConnectionView={connectionId:string;companyId:string;server:string;mcpUrl:string;settingsUrl:string;resumeUrl:string|null;
 verificationPrompt:string;workspacePath:string|null;clientName:string|null;checks:{get_system_status:string|null;get_company_context:string|null};verified:boolean;evidence:string};
const storageKey='lf-codex-pending-setup';
export function CodexConnectionContent({view,copied,onCopy}:{view:CodexConnectionView;copied:string;onCopy:(value:string,label:string)=>void}){
 return <><div className={'connection-status '+(view.verified?'complete':'pending')} role="status"><strong>{view.verified?'두 확인 도구 호출이 도착했어요':'설정 준비 완료 · Codex 연결 적용이 남았어요'}</strong><p>{view.verified?'아래 회사 ID가 Codex의 응답과 같으면 첫 거래 공부를 시작하세요.':'새 파일을 만드는 것과 지금 대화에 회계 도구가 나타나는 것은 별개예요. 아래 순서로 한 번만 적용하세요.'}</p></div>
 <section className="connection-company"><span>지금 연결할 장부의 회사 ID</span><code>{view.companyId}</code><small>이미 준비한 같은 장부입니다. 다시 설치하거나 새 장부를 만들 필요 없어요.</small></section>
 <ol className="connection-steps">
  <li><h2>Codex에서 회계 연결을 확인해요</h2><p><a className="connection-button secondary" href="codex://settings">Codex 설정 열기</a></p><p><b>MCP servers</b>(MCP 서버)에서 <b>ledgerflow-accounting-mcp</b>를 찾으세요. 이미 보이면 그 서버를 확인하고, 없으면 <b>Add server</b>(서버 추가)를 누르세요. 같은 이름을 두 번 등록하지 마세요.</p><dl><dt>이름</dt><dd>ledgerflow-accounting-mcp</dd><dt>연결 방식</dt><dd>Streamable HTTP</dd><dt>서버 주소</dt><dd><input aria-label="내 장부 전용 비공개 MCP 주소" type="password" readOnly value={view.mcpUrl} /><button onClick={()=>onCopy(view.mcpUrl,'서버 주소')}>내 장부 주소 복사</button></dd></dl><p className="connection-note">이 주소에 내 장부 연결 키가 들어 있어요. Codex 설정의 URL 칸에만 붙여 넣고 다른 사람에게 공유하지 마세요.</p></li>
  <li><h2>저장하고 연결을 적용해요</h2><p><b>Save</b>(저장) → <b>Restart</b>(다시 시작)를 누르세요. 앱에 프로젝트 신뢰 확인이 나오면 본인이 선택하세요. 현재 대화의 도구 목록은 파일을 쓴 것만으로 갱신되지 않을 수 있어요.</p></li>
  <li><h2>같은 폴더에서 두 도구를 확인해요</h2>{view.workspacePath&&<p>사용하던 폴더: <code>{view.workspacePath}</code></p>}<p>아래 요청문을 Codex에 보내세요. 이 단계에서는 거래나 장부를 바꾸지 않아요.</p><textarea readOnly aria-label="Codex 연결 확인 요청문" value={view.verificationPrompt} rows={5}/><div className="connection-actions"><button onClick={()=>onCopy(view.verificationPrompt,'확인 요청문')}>확인 요청문 복사</button>{view.resumeUrl&&<a className="connection-button secondary" href={view.resumeUrl}>같은 폴더에서 확인 대화 열기</a>}</div><p className="connection-note">대화 열기는 요청문을 미리 넣어 줍니다. 보내기 버튼은 직접 눌러 주세요.</p></li>
 </ol><p className="connection-copy-status" role="status">{copied}</p>
 <section className="connection-receipts"><h2>서버에서 확인한 실제 호출</h2><p>페이지를 켜 둔 동안 5초마다 확인해요. 설치기의 별도 연결 검사는 여기에 성공으로 표시하지 않아요.</p><ul>{(['get_system_status','get_company_context'] as const).map(name=><li key={name}><code>{name}</code><strong>{view.checks[name]?'호출 성공 · '+new Date(view.checks[name]!).toLocaleTimeString('ko-KR'):'아직 도착하지 않음'}</strong></li>)}</ul>{view.clientName&&<p>연결 앱이 알려 준 이름: {view.clientName}</p>}<small>{view.evidence}</small></section>
 <details><summary>계속 도구가 없다고 나오면</summary><p>설정에 같은 이름의 서버가 있는지, URL이 방금 복사한 주소인지, 현재 폴더를 신뢰했는지 확인하세요. Save → Restart 후 같은 폴더에서 새 대화를 열고 확인 요청문을 보내세요. 여전히 실패하면 오류 메시지와 위 회사 ID만 AI에 보내세요. 비공개 주소는 보내지 마세요.</p><p>Google 장부의 연결을 취소했거나 유효 기간이 지났다면 사이트에서 새 개인 연결 요청문을 받으세요. 게스트 장부로 바꿔서 해결하지 마세요.</p></details>
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
 return <main className="codex-connect"><a className="connection-home" href="/">한빛유통 · 회계 자동화 학습실</a><header><span>처음 연결 · Codex</span><h1>Codex 연결 마치기</h1><p>준비한 내 장부를 Codex의 실제 회계 도구에 연결하는 마지막 단계예요.</p></header>{error&&<div className="connection-error" role="alert">{error}{login&&<p><button onClick={()=>void google()}>같은 Google 계정으로 로그인</button></p>}</div>}{view?<CodexConnectionContent view={view} copied={copied} onCopy={(value,label)=>void copy(value,label)}/>:!error&&<p role="status">내 장부 연결 안내를 불러오는 중…</p>}</main>;
}
