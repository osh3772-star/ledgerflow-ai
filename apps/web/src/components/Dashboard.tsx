import {useEffect,useRef,useState} from 'react';
import '../styles/dashboard.css';
import '../styles/bilingual.css';
import BeginnerGuide,{GuideWelcome} from './BeginnerGuide.js';
import {FinancialMetrics,BalanceSheetPanel,TrialBalancePanel} from './FinancialReports.js';
import {PublicApiStatus,PublicReferences,PublicSiteNotice} from './PublicReferences.js';
import RemoteAccess from './RemoteAccess.js';
type Row=Record<string,unknown>;
type Company={companyId:string;name:string;periods:{id:string;from:string;to:string;status:string}[]};
type Journal={id:string;version:number;state:string;hash:string;discardedAt:string|null;payload:{transactionId:string;sourceDocumentIds:string[];description:string;recognitionOn:string;publicReferences?:unknown;lines:{accountCode:string;debit:string;credit:string}[];basis:{standards:string[];assumptions:string[];uncertainty:string}}};
// Korean presentation name for the synthetic demo; preserve fixture IDs and hashes.
const companyDisplayName='한빛유통 주식회사';
const money=(value:unknown)=>{try{return BigInt(String(value??'0')).toLocaleString('ko-KR');}catch{return String(value??'—');}};
async function api(path:string,init?:RequestInit){const r=await fetch(path,{...init,credentials:'same-origin'}),j=await r.json();
  if(!r.ok)throw new Error(String(j.error??'요청 실패'));return j;}
const tabs=[['overview','개요','◈'],['guide','처음 사용하기','?'],['transactions','거래','↗'],['journals','분개전표','▤'],['approval','사용자 승인','✓'],['references','공공자료','↗'],['reports','재무 보고서','▥'],['audit','감사 점검','◎']] as const;
const koreanLabels:Record<string,string>={
  Draft:'초안',Validated:'검증 완료',Approval:'승인 요청',Posted:'장부 반영 완료',
  pending:'검토 대기',approved:'승인됨',rejected:'반려됨',Discarded:'폐기됨',
  opening_capital:'자본금 납입',purchase:'상품 매입',sale:'상품 매출',receipt:'수금',payment:'대금 지급',
  payroll:'급여',asset_acquisition:'유형자산 취득',prepayment:'선급비용',accrual:'미지급비용',adjustment:'결산 수정',
  tax_invoice:'세금계산서',invoice:'청구서',bank_statement:'은행 거래 내역',delivery_note:'인도 확인서',
};
function BilingualText({english,korean,className=''}:{english:string;korean:string;className?:string}){
  return <span className={'bilingual '+className}><span className="bilingual-en" lang="en">{english}</span><small className="bilingual-ko" lang="ko">{korean}</small></span>;
}
function CodeLabel({value}:{value:unknown}){
  const english=String(value),korean=Object.hasOwn(koreanLabels,english)?koreanLabels[english]:undefined;
  return korean?<BilingualText english={english} korean={korean}/>:<>{english}</>;
}
export default function Dashboard(){
  const [tab,setTab]=useState<string>('guide'),[company,setCompany]=useState<Company>(),[period,setPeriod]=useState(0);
  const [rows,setRows]=useState<Row[]>([]),[journals,setJournals]=useState<Row[]>([]),[trial,setTrial]=useState<Row>({}),[financial,setFinancial]=useState<Row>({});
  const [audit,setAudit]=useState<Row>({}),[selected,setSelected]=useState<Journal>(),[approval,setApproval]=useState<Row|null>(null);
  const [error,setError]=useState(''),[loading,setLoading]=useState(true),[csrf,setCsrf]=useState<string>();
  const [cursor,setCursor]=useState<string|null>(null);
  const [storageConfigured,setStorageConfigured]=useState(false),[archived,setArchived]=useState(false);
  const [evidence,setEvidence]=useState<Row[]>([]);
  const [publicConfiguration,setPublicConfiguration]=useState<unknown>(),[referenceReport,setReferenceReport]=useState<unknown>();
  const [referenceLoading,setReferenceLoading]=useState(false);
  const [referenceTransactionId,setReferenceTransactionId]=useState('');
  const [publicPreview,setPublicPreview]=useState(false),[snapshotAt,setSnapshotAt]=useState(''),[previewReference,setPreviewReference]=useState<unknown>();
  const [hosted,setHosted]=useState(false),[guestWorkspace,setGuestWorkspace]=useState(false);
  const referenceRequest=useRef(0);
  const current=company?.periods[period],query=current?'from='+current.from+'&to='+current.to:'from=2026-01-01&to=2026-01-31';
  async function refresh(){
    setLoading(true);setError('');
    try{
      const context=await api('/api/context');setCompany(context.company);setStorageConfigured(context.evidenceStorageConfigured);setPublicConfiguration(context.publicApi);
      setPublicPreview(context.publicPreview===true);setSnapshotAt(String(context.snapshotAt??''));setPreviewReference(context.publicReferenceExample?.report);
      setHosted(context.publicPreview===true||context.remoteWorkspace===true);
      setGuestWorkspace(context.guestWorkspace===true);
      if(context.humanApprovalMode!=='unavailable'){
        try{const session=await api('/api/human/session');setCsrf(session.csrf);}catch{setCsrf(undefined);}
      }else setCsrf(undefined);
      const [transactions,list,balance,statements,checks]=await Promise.all([
        api('/api/transactions?'+query),api('/api/journals'),api('/api/trial-balance?'+query),
        api('/api/financial-statements?'+query),api('/api/audit?'+query)]);
      setRows(transactions.items);setCursor(transactions.nextCursor);setJournals(list);setTrial(balance);setFinancial(statements);setAudit(checks);
    }catch(e){setError(e instanceof Error?e.message:'서버를 확인하세요.');}finally{setLoading(false);}
  }
  useEffect(()=>{void refresh();},[period]);
  async function inspect(id:string){try{setArchived(false);const journal=await api('/api/journal?id='+id);setSelected(journal);
    setApproval(await api('/api/approval?id='+id));setEvidence(await api('/api/documents?transactionId='+journal.payload.transactionId));}catch(e){setSelected(undefined);setError(String(e));}}
  async function decide(decision:'approved'|'rejected'){
    if(!selected||!company||!csrf)return;setError('');
    try{await api('/api/human/decision',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
      body:JSON.stringify({companyId:company.companyId,journalId:selected.id,expectedHash:selected.hash,decision})});
      await inspect(selected.id);await refresh();
    }catch(e){setError(String(e));}
  }
  async function nextPage(){if(!cursor)return;try{const result=await api('/api/transactions?'+query+'&cursor='+encodeURIComponent(cursor));setRows(result.items);setCursor(result.nextCursor);}catch(e){setError(String(e));}}
  function clearReference(){referenceRequest.current++;setReferenceReport(undefined);setReferenceLoading(false);}
  async function inspectReferences(){const id=referenceTransactionId||String(rows[0]?.id??'');if(!id)return;
    const request=++referenceRequest.current;setReferenceLoading(true);setReferenceReport(undefined);setError('');
    try{const result=await api('/api/public-references?transactionId='+encodeURIComponent(id));if(request===referenceRequest.current)setReferenceReport(result.publicReferences);}
    catch(e){if(request===referenceRequest.current)setError(String(e));}finally{if(request===referenceRequest.current)setReferenceLoading(false);}}
  async function archiveEvidence(){
    if(!selected||!company||!csrf)return;
    try{for(const documentId of selected.payload.sourceDocumentIds)await api('/api/human/evidence',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
      body:JSON.stringify({companyId:company.companyId,transactionId:selected.payload.transactionId,documentId})});setArchived(true);}catch(e){setError(String(e));}
  }
  const pending=journals.filter(j=>j.state==='Approval'&&!j.discardedAt),posted=journals.filter(j=>j.state==='Posted');
  return <div className="workspace">
    <aside><a className="brand" href="/"><span className="mark" aria-hidden="true">한</span><div className="brand-wordmark"><span className="brand-name">한빛유통</span><span className="brand-tagline">회계 자동화 학습실</span></div></a>
      <div className="company-card"><span className="company-icon" aria-hidden="true">한빛</span><div><strong>{companyDisplayName}</strong><div className="company-meta">가상 도소매 법인 · <BilingualText english="KRW" korean="대한민국 원"/></div></div></div>
      <nav aria-label="주요 메뉴">{tabs.map(([key,title,icon])=><button key={key} className={tab===key?'active':''} onClick={()=>{setTab(key);setSelected(undefined);}}><span>{icon}</span>{title}{key==='approval'&&pending.length>0&&<b>{pending.length}</b>}</button>)}</nav>
      <div className="sidebar-footer"><span className="dot"/>사용자 주도 실행<small>거래는 모두 가상 데이터입니다.</small></div>
    </aside>
    <main><header><div className="breadcrumb">워크스페이스 <span>/</span> {tabs.find(t=>t[0]===tab)?.[1]}</div><span className="synthetic">가상회사</span><span className="avatar">한빛</span></header>
      <section className="heading"><div><p className="eyebrow">{companyDisplayName} · 가상 한국회사</p><h1>{tabs.find(t=>t[0]===tab)?.[1]}</h1><p>거래가 분개·장부·재무제표로 이어지는 과정을 AI와 함께 배워보세요.</p></div><div className="toolbar">
        <label className="sr-only" htmlFor="period">회계기간</label><select id="period" value={period} onChange={e=>{setPeriod(Number(e.target.value));setSelected(undefined);setReferenceTransactionId('');clearReference();}}>
          {company?.periods.map((p,index)=><option key={p.id} value={index}>{p.from.slice(0,7)} · {p.status==='closed'?'마감':'열림'}</option>)}</select>
        <button className="secondary" onClick={()=>void refresh()} disabled={loading}>↻ 새로고침</button></div></section>
      <RemoteAccess/>
      {error&&<div className="notice error" role="alert">{error}</div>}
      {loading&&<div className="notice" role="status">회계 자료를 불러오는 중입니다.</div>}
      {publicPreview&&tab!=='guide'&&<PublicSiteNotice snapshotAt={snapshotAt}/>}
      {(tab==='overview'||tab==='transactions')&&<section className="notice data-origin-note" aria-label="거래 데이터 안내"><strong>처음부터 보이는 거래는 연습용 샘플입니다.</strong><p>기본 시연 데이터는 미리 만든 가상 거래 1,000건입니다. 실제 회사 거래나 은행에서 자동 수집한 내역이 아닙니다. 거래 조회와 장부 반영은 별개이며, 검증·사용자 승인·장부 반영을 거친 전표만 재무 보고서에 집계됩니다.</p></section>}
      {tab==='overview'&&<GuideWelcome onOpen={()=>{setTab('guide');setSelected(undefined);}}/>}
      {(tab==='overview'||tab==='references')&&<PublicApiStatus configuration={publicConfiguration}/>}
      {tab==='references'&&publicPreview&&<><section className="panel"><h2>공공자료 예시 · 2026-01-10 매출</h2><p>이 가상 거래를 기준으로 미리 수집한 자료입니다. 상단 회계기간 선택과 별개인 예시이며 공개 샘플 조회 시 기관 API를 새로 호출하지 않습니다. 원격 장부가 활성화되면 로그인한 계정에서 다른 거래의 참고자료를 조회할 수 있습니다.</p></section><PublicReferences report={previewReference}/></>}
      {tab==='references'&&!publicPreview&&<><section className="panel"><div className="panel-title"><h2>거래와 공공자료 함께 확인</h2><button className="secondary" disabled={loading||referenceLoading||!rows.length} onClick={()=>void inspectReferences()}>{referenceLoading?'조회 중…':'선택한 거래의 참고자료 조회'}</button></div><label htmlFor="reference-transaction">참고자료를 확인할 거래</label> <select id="reference-transaction" value={referenceTransactionId||String(rows[0]?.id??'')} disabled={loading||referenceLoading} onChange={e=>{setReferenceTransactionId(e.target.value);clearReference();}}>{rows.map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.externalRef)} · {String(row.recognitionOn)}</option>)}</select><p className="muted">현재 페이지의 거래를 선택해 조회합니다. 거래·전표 생성이나 승인·장부 반영은 하지 않습니다. 분개 초안 생성에서도 같은 공통 서비스가 실행됩니다.</p></section>{referenceReport!==undefined&&<PublicReferences report={referenceReport}/>}</>}
      {tab==='guide'&&<BeginnerGuide hosted={hosted} onNavigate={target=>{setTab(target);setSelected(undefined);window.scrollTo({top:0});}}/>}
      {(tab==='overview'||tab==='reports')&&<>
        <FinancialMetrics financial={financial} loading={loading} error={error} pendingCount={pending.length} postedCount={posted.length}/>
        <div className="two-column"><BalanceSheetPanel financial={financial} loading={loading} error={error} asOf={current?.to}/>
        <section className="panel"><div className="panel-title"><h2>처리 흐름</h2><span>사용자 요청으로 진행</span></div>
          <ol className="flow">{['거래·증빙 조회','Draft','독립 규칙 검증','사용자 승인','장부 반영'].map((step,index)=><li key={step}><span>{index+1}</span><strong>{step==='Draft'?<BilingualText english="Draft" korean="분개 초안 생성"/>:step}</strong></li>)}</ol>
          <p className="muted"><BilingualText english="Claude Code · Codex" korean="클로드 코드 · 코덱스"/>에서 작업을 요청하고, 이 화면에서 전표를 검토·승인합니다.</p></section></div>
      </>}
      {(tab==='overview'||tab==='transactions')&&<section className="panel"><div className="panel-title"><h2>연습용 거래 내역</h2><span>{current?.from} — {current?.to}</span></div>
        <div className="table-scroll"><table><thead><tr><th>거래일</th><th>거래 참조</th><th>거래 유형</th><th className="num">공급가액</th><th className="num">세액</th><th className="num">합계</th></tr></thead><tbody>
          {rows.slice(0,tab==='overview'?8:100).map(r=><tr key={String(r.id)}><td>{String(r.recognitionOn)}</td><td className="mono">{String(r.externalRef)}</td><td><span className="kind"><CodeLabel value={r.kind}/></span></td><td className="num">{money(r.net)}</td><td className="num">{money(r.tax)}</td><td className="num strong">{money(r.gross)}</td></tr>)}
        </tbody></table></div>{rows.length===0&&!loading&&<Empty text="선택한 기간에 거래가 없습니다."/>}
        {tab==='transactions'&&<div className="panel-bottom"><span>페이지당 최대 50건 · 가상 <BilingualText english="ERP" korean="전사적 자원관리"/></span><button className="secondary" disabled={!cursor} onClick={()=>void nextPage()}>다음 페이지 →</button></div>}</section>}
      {(tab==='journals'||tab==='approval')&&<section className="panel"><div className="panel-title"><h2>{tab==='approval'?'검토할 전표':'분개전표 목록'}</h2><span>최대 100건</span></div>
        <div className="table-scroll"><table><thead><tr><th>귀속일</th><th>설명</th><th>상태</th><th>검토</th></tr></thead><tbody>{(tab==='approval'?pending:journals).map(j=><tr key={String(j.id)}><td>{String(j.recognitionOn)}</td><td>{String(j.description)}</td><td><span className={'state '+j.state}><CodeLabel value={j.state}/></span></td><td><button className="text-button" onClick={()=>void inspect(String(j.id))}>전표 보기 →</button></td></tr>)}</tbody></table></div>
        {(tab==='approval'?pending:journals).length===0&&<Empty text="표시할 전표가 없습니다. AI 앱에서 거래의 분개 생성·검증·승인 요청을 진행하세요."/>}</section>}
      {selected&&<section className="panel journal-detail"><div className="panel-title"><h2>전표 검토</h2><span className={'state '+selected.state}><CodeLabel value={selected.state}/></span></div><p>{selected.payload.description}</p>
        <p>귀속일 {selected.payload.recognitionOn} · 버전 {selected.version}</p>
        <table><thead><tr><th>계정 코드</th><th className="num">차변</th><th className="num">대변</th></tr></thead><tbody>{selected.payload.lines.map((l,index)=><tr key={index}><td className="mono">{l.accountCode}</td><td className="num">{money(l.debit)}</td><td className="num">{money(l.credit)}</td></tr>)}</tbody></table>
        <div className="basis"><strong>적용 근거·가정</strong><p>{selected.payload.basis.standards.join(' · ')}</p><ul>{selected.payload.basis.assumptions.map(a=><li key={a}>{a}</li>)}</ul><p>{selected.payload.basis.uncertainty}</p></div>
        <PublicReferences report={selected.payload.publicReferences}/>
        <div className="basis"><strong>원천 증빙 · 가상자료</strong>{evidence.map(doc=><details key={String(doc.id)}><summary><CodeLabel value={doc.type}/> · {String(doc.issueDate)}</summary>
          <p className="hash mono">{String(doc.sha256)}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(doc.content,null,2)}</pre></details>)}</div>
        <p className="hash mono">승인 대상 <BilingualText english="hash" korean="내용 검증값"/>: {selected.hash}</p><p>사용자 승인 상태: <strong><CodeLabel value={selected.discardedAt?'Discarded':approval?.status??'요청 전'}/></strong></p>
        {csrf&&storageConfigured&&<button className="secondary" disabled={archived} onClick={()=>void archiveEvidence()}>{archived?'증빙 보관 완료':'증빙 원문 보관'}</button>}
        {guestWorkspace&&tab==='approval'&&<p className="notice">임시 장부의 승인은 AI가 준 해당 전표의 전용 승인 링크에서 진행하세요. 링크가 만료됐다면 AI에게 새 링크를 요청하세요.</p>}
        {!guestWorkspace&&tab==='approval'&&!selected.discardedAt&&selected.state==='Approval'&&approval?.status==='pending'&&<>
          <div className="decision"><p>전표와 증빙을 검토한 뒤 승인하거나 반려하세요. 승인 후 앱에서 전기를 요청합니다.</p>
            <button className="secondary danger" disabled={!csrf} onClick={()=>void decide('rejected')}>반려</button>
            <button className="primary" disabled={!csrf} onClick={()=>void decide('approved')}>이 전표 승인</button>
            {!csrf&&<p className="muted">승인 화면 연결을 확인하세요. 지속 DB에서는 외부 인증 세션이 필요합니다.</p>}</div>
        </>}</section>}
      {tab==='reports'&&<TrialBalancePanel trial={trial} loading={loading} error={error}/>}
      {tab==='audit'&&<section className="panel"><div className="panel-title"><h2>감사 점검 결과</h2><span>결정론적 검사</span></div><div className="audit-stats"><p>중복 증빙 후보 <strong>{(audit.duplicateEvidence as unknown[]??[]).length}</strong></p><p>차대변 불일치 전표 <strong>{(audit.unbalancedJournals as unknown[]??[]).length}</strong></p><p>미전기 거래 표시 <strong>{(audit.unpostedSources as unknown[]??[]).length}</strong></p></div>
        <p className="muted">{String(audit.note??'')}</p><table><thead><tr><th>미전기 거래 참조</th><th>유형</th></tr></thead><tbody>{(audit.unpostedSources as Row[]??[]).map(r=><tr key={String(r.id)}><td className="mono">{String(r.reference)}</td><td><CodeLabel value={r.kind}/></td></tr>)}</tbody></table></section>}
      <footer><span>{companyDisplayName}</span><span>합성 거래 데이터 · 전문가 검토 미완료 · 법정 신고 및 완전한 <BilingualText english="K-IFRS" korean="한국채택국제회계기준"/> 보고서가 아닙니다.</span></footer>
    </main>
  </div>;
}
function Empty({text}:{text:string}){return <div className="empty"><span>▤</span><p>{text}</p></div>;}
