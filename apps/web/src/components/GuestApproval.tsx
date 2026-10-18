import {useEffect,useState,useRef} from 'react';
import type {Journal} from '@ledgerflow/contracts';
import '../styles/guest-approval.css';

type Review={journal:Journal;accounts:Record<string,string>;approval:{status:string};documents:unknown[];csrf:string;expiresAt:string};
const money=(value:string)=>BigInt(value).toLocaleString('ko-KR');
export default function GuestApproval(){
 const started=useRef(false),[data,setData]=useState<Review>(),[message,setMessage]=useState('승인할 전표를 불러옵니다.'),[busy,setBusy]=useState(false);
 async function api(path:string,body?:unknown,csrf?:string){
  const r=await fetch(path,{credentials:'same-origin',...(body?{method:'POST',headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},body:JSON.stringify(body)}:{})});
  const value=await r.json();
  if(!r.ok)throw new Error(({REVIEW_LINK_EXPIRED:'링크가 만료되었거나 이미 사용됐어요. AI에게 승인 링크를 다시 요청하세요.',GUEST_EXPIRED:'임시 학습 시간이 끝났어요. AI에게 새 연습 공간을 요청하세요.',REVIEW_CHANGED:'전표 내용이 달라졌어요. AI에게 새 승인 링크를 요청하세요.',FORBIDDEN:'이 화면에서 직접 승인해 주세요.',GUEST_PENDING_POSTING:'승인한 전표를 AI에게 장부 반영해 달라고 요청한 뒤 보관하세요.',WORKSPACE_SELECTION_REQUIRED:'두 장부에 작업 기록이 있어 자동으로 합치지 않았어요. 내 장부 연결 요청문으로 개인 장부에 연결하거나 보관할 장부를 먼저 확인해 주세요.'} as Record<string,string>)[value.error]??'요청하지 못했어요. 새 승인 링크를 요청해 주세요.');
  return value;
 }
 useEffect(()=>{if(started.current)return;started.current=true;void(async()=>{
  // Remove the credential before any network request or navigation.
  const ticket=new URLSearchParams(location.hash.slice(1)).get('ticket');history.replaceState(null,'',location.pathname);
  try{if(ticket)await api('/api/remote/guest-review/open',{ticket});setData(await api('/api/remote/guest-review'));setMessage('내용을 확인하고 직접 승인하거나 반려해 주세요. 아직 장부에는 반영되지 않았어요.');}
  catch(e){setMessage(e instanceof Error?e.message:'전표를 불러오지 못했어요.');}
 })();},[]);
 async function decide(decision:'approved'|'rejected'){
  if(!data)return;setBusy(true);
  try{await api('/api/remote/guest-review/decision',{decision},data.csrf);setData(await api('/api/remote/guest-review'));
   setMessage(decision==='approved'?'승인했어요. 이제 AI에게 이 전표를 장부에 반영해 달라고 요청하세요.':'반려했어요. AI에게 수정할 내용을 알려 주세요.');}
  catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 async function keep(){setBusy(true);try{const session=await api('/api/remote/session');if(session.mode==='personal'){await api('/api/remote/link-guest',{},session.csrf);location.assign('/');return;}const r=await api('/api/remote/google/start',{returnTo:'/',claimGuest:true});location.assign(r.redirect);}
  catch(e){setMessage(e instanceof Error?e.message:String(e));setBusy(false);}}
 const j=data?.journal;
 return <main className="guest-review"><a href="/">한빛유통 · 회계 자동화 학습실</a><h1>내 연습 전표 확인</h1>
  <p className="guest-note">로그인 없이 사용하는 임시 학습 장부입니다. 이 링크를 가진 사람은 해당 전표를 검토할 수 있으므로 공유하지 마세요. 실제 인물의 신원을 확인하는 승인이 아니며, 합성 거래 연습에만 사용합니다.</p>
  <p role="status" className="guest-status">{message}</p>
  {j&&data&&<><article><h2>{j.payload.description}</h2><dl><div><dt>거래일</dt><dd>{j.payload.recognitionOn}</dd></div><div><dt>전표 상태</dt><dd>{j.state==='Posted'?'장부 반영 완료':'장부 반영 전'} · {data.approval?.status==='approved'?'승인':data.approval?.status==='rejected'?'반려':'승인 대기'}</dd></div></dl>
   <table><caption>분개 내용 · 금액 단위: 원</caption><thead><tr><th>계정과목</th><th>차변</th><th>대변</th></tr></thead><tbody>{j.payload.lines.map((line,i)=><tr key={i}><th scope="row">{data.accounts[line.accountCode]??line.accountCode}<small> {line.accountCode}</small></th><td>{money(line.debit)}</td><td>{money(line.credit)}</td></tr>)}</tbody></table>
   <h3>판단 근거와 가정</h3><p>{j.payload.basis.standards.join(', ')}</p><ul>{j.payload.basis.assumptions.map((a,i)=><li key={i}>{a}</li>)}</ul><p>{j.payload.basis.uncertainty}</p>
   <p>연결 증빙 {data.documents.length}개. 계정이나 금액을 이해하지 못했다면 먼저 AI에게 설명을 요청하세요.</p>
   <details><summary>증빙과 공공 참고자료 펼치기</summary><pre>{JSON.stringify({documents:data.documents,publicReferences:j.payload.publicReferences??'이 전표에 첨부된 조회 결과 없음'},null,2)}</pre></details>
   <details><summary>내용 고정 확인값</summary><p>버전 {j.version}</p><code>{j.hash}</code></details>
   <div className="guest-actions"><button disabled={busy||j.state!=='Approval'||data.approval?.status!=='pending'} onClick={()=>void decide('approved')}>내용 확인 · 승인</button><button className="reject" disabled={busy||j.state!=='Approval'||data.approval?.status!=='pending'} onClick={()=>void decide('rejected')}>수정 필요 · 반려</button></div>
   <p>버튼을 눌러도 장부 반영은 별도입니다. 승인 후 AI에게 “승인한 전표를 장부에 반영하고 시산표를 보여줘”라고 요청하세요.</p></article>
   <p><a href="/">거래·보고서 화면으로 →</a></p><aside><h2>연습 기록을 계속 보관하고 싶다면</h2><p>현재 임시 연결은 {new Date(data.expiresAt).toLocaleString('ko-KR')}까지입니다. 승인한 전표를 먼저 장부에 반영한 뒤 보관하세요. Google에 빈 연습 장부가 이미 있어도 이 기록을 그대로 연결합니다. 기존 AI 연결은 원래 만료 시각까지 유지되며, 사이트의 내 장부 전용 요청문으로 7일 연결을 다시 준비할 수 있어요.</p><button disabled={busy} onClick={()=>void keep()}>Google로 이 장부 연결·보관하기</button></aside></>}
 </main>;
}
