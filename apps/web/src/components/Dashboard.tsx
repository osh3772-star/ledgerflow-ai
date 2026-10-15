import {useEffect,useState} from 'react';
import '../styles/dashboard.css';
type Row=Record<string,unknown>;
type Company={companyId:string;name:string;periods:{id:string;from:string;to:string;status:string}[]};
type Journal={id:string;version:number;state:string;hash:string;discardedAt:string|null;payload:{transactionId:string;sourceDocumentIds:string[];description:string;recognitionOn:string;lines:{accountCode:string;debit:string;credit:string}[];basis:{standards:string[];assumptions:string[];uncertainty:string}}};
const money=(value:unknown)=>{try{return BigInt(String(value??'0')).toLocaleString('ko-KR');}catch{return String(value??'—');}};
async function api(path:string,init?:RequestInit){const r=await fetch(path,{...init,credentials:'same-origin'}),j=await r.json();
  if(!r.ok)throw new Error(String(j.error??'요청 실패'));return j;}
const tabs=[['overview','개요','◈'],['transactions','거래','↗'],['journals','분개전표','▤'],['approval','사용자 승인','✓'],['reports','재무 보고서','▥'],['audit','감사 점검','◎']] as const;
export default function Dashboard(){
  const [tab,setTab]=useState<string>('overview'),[company,setCompany]=useState<Company>(),[period,setPeriod]=useState(0);
  const [rows,setRows]=useState<Row[]>([]),[journals,setJournals]=useState<Row[]>([]),[trial,setTrial]=useState<Row>({}),[financial,setFinancial]=useState<Row>({});
  const [audit,setAudit]=useState<Row>({}),[selected,setSelected]=useState<Journal>(),[approval,setApproval]=useState<Row|null>(null);
  const [error,setError]=useState(''),[loading,setLoading]=useState(true),[csrf,setCsrf]=useState<string>();
  const [cursor,setCursor]=useState<string|null>(null);
  const [storageConfigured,setStorageConfigured]=useState(false),[archived,setArchived]=useState(false);
  const [evidence,setEvidence]=useState<Row[]>([]);
  const current=company?.periods[period],query=current?'from='+current.from+'&to='+current.to:'from=2026-01-01&to=2026-01-31';
  async function refresh(){
    setLoading(true);setError('');
    try{
      const context=await api('/api/context');setCompany(context.company);setStorageConfigured(context.evidenceStorageConfigured);
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
  async function archiveEvidence(){
    if(!selected||!company||!csrf)return;
    try{for(const documentId of selected.payload.sourceDocumentIds)await api('/api/human/evidence',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
      body:JSON.stringify({companyId:company.companyId,transactionId:selected.payload.transactionId,documentId})});setArchived(true);}catch(e){setError(String(e));}
  }
  const pending=journals.filter(j=>j.state==='Approval'&&!j.discardedAt),posted=journals.filter(j=>j.state==='Posted'),bs=financial.balanceSheet as Row|undefined,is=financial.incomeStatement as Row|undefined;
  return <div className="workspace">
    <aside><a className="brand" href="/"><span className="mark">L</span><div>LedgerFlow<small>ACCOUNTING WORKSPACE</small></div></a>
      <div className="company-card"><span className="company-icon">LT</span><strong>LedgerFlow Trading<small>가상 도소매 법인 · KRW</small></strong></div>
      <nav aria-label="주요 메뉴">{tabs.map(([key,title,icon])=><button key={key} className={tab===key?'active':''} onClick={()=>{setTab(key);setSelected(undefined);}}><span>{icon}</span>{title}{key==='approval'&&pending.length>0&&<b>{pending.length}</b>}</button>)}</nav>
      <div className="sidebar-footer"><span className="dot"/>사용자 주도 실행<small>거래는 모두 가상 데이터입니다.</small></div>
    </aside>
    <main><header><div className="breadcrumb">워크스페이스 <span>/</span> {tabs.find(t=>t[0]===tab)?.[1]}</div><span className="synthetic">가상회사</span><span className="avatar">LF</span></header>
      <section className="heading"><div><p className="eyebrow">LEDGERFLOW TRADING CO., LTD.</p><h1>{tabs.find(t=>t[0]===tab)?.[1]}</h1><p>거래의 근거부터 승인된 장부까지, 한 곳에서 확인하세요.</p></div><div className="toolbar">
        <label className="sr-only" htmlFor="period">회계기간</label><select id="period" value={period} onChange={e=>{setPeriod(Number(e.target.value));setSelected(undefined);}}>
          {company?.periods.map((p,index)=><option key={p.id} value={index}>{p.from.slice(0,7)} · {p.status==='closed'?'마감':'열림'}</option>)}</select>
        <button className="secondary" onClick={()=>void refresh()} disabled={loading}>↻ 새로고침</button></div></section>
      {error&&<div className="notice error" role="alert">{error}</div>}
      {loading&&<div className="notice" role="status">회계 자료를 불러오는 중입니다.</div>}
      {(tab==='overview'||tab==='reports')&&<>
        <div className="kpis"><Kpi label="기간 매출" value={money(is?.revenue)} hint="게시된 전표 기준"/><Kpi label="기간 순이익" value={money(is?.profit)} hint="세전 · 가상 시나리오"/>
          <Kpi label="승인 대기" value={String(pending.length)} hint="전표 목록 최대 100건" unit="건"/><Kpi label="게시된 전표" value={String(posted.length)} hint="전표 목록 최대 100건" unit="건"/></div>
        <div className="two-column"><section className="panel"><div className="panel-title"><h2>재무상태표</h2><span>{current?.to}</span></div>
          <div className="statement"><Statement label="자산" value={bs?.assets}/><Statement label="부채" value={bs?.liabilities}/><Statement label="자본" value={bs?.equity}/></div>
          <div className={'balance-note '+(bs?.balanced?'balanced':'')}>{bs?.balanced?'✓ 자산 = 부채 + 자본':'계정 잔액을 확인하세요.'}</div></section>
        <section className="panel"><div className="panel-title"><h2>처리 흐름</h2><span>사용자 요청으로 진행</span></div>
          <ol className="flow">{['거래·증빙 조회','분개 Draft 생성','독립 규칙 검증','사용자 승인','장부 반영'].map((step,index)=><li key={step}><span>{index+1}</span><strong>{step}</strong></li>)}</ol>
          <p className="muted">Claude Code·Codex에서 작업을 요청하고, 이 화면에서 전표를 검토·승인합니다.</p></section></div>
      </>}
      {(tab==='overview'||tab==='transactions')&&<section className="panel"><div className="panel-title"><h2>거래 내역</h2><span>{current?.from} — {current?.to}</span></div>
        <div className="table-scroll"><table><thead><tr><th>거래일</th><th>거래 참조</th><th>거래 유형</th><th className="num">공급가액</th><th className="num">세액</th><th className="num">합계</th></tr></thead><tbody>
          {rows.slice(0,tab==='overview'?8:100).map(r=><tr key={String(r.id)}><td>{String(r.recognitionOn)}</td><td className="mono">{String(r.externalRef)}</td><td><span className="kind">{String(r.kind)}</span></td><td className="num">{money(r.net)}</td><td className="num">{money(r.tax)}</td><td className="num strong">{money(r.gross)}</td></tr>)}
        </tbody></table></div>{rows.length===0&&!loading&&<Empty text="선택한 기간에 거래가 없습니다."/>}
        {tab==='transactions'&&<div className="panel-bottom"><span>페이지당 최대 50건 · 가상 ERP</span><button className="secondary" disabled={!cursor} onClick={()=>void nextPage()}>다음 페이지 →</button></div>}</section>}
      {(tab==='journals'||tab==='approval')&&<section className="panel"><div className="panel-title"><h2>{tab==='approval'?'검토할 전표':'분개전표 목록'}</h2><span>최대 100건</span></div>
        <div className="table-scroll"><table><thead><tr><th>귀속일</th><th>설명</th><th>상태</th><th>검토</th></tr></thead><tbody>{(tab==='approval'?pending:journals).map(j=><tr key={String(j.id)}><td>{String(j.recognitionOn)}</td><td>{String(j.description)}</td><td><span className={'state '+j.state}>{String(j.state)}</span></td><td><button className="text-button" onClick={()=>void inspect(String(j.id))}>전표 보기 →</button></td></tr>)}</tbody></table></div>
        {(tab==='approval'?pending:journals).length===0&&<Empty text="표시할 전표가 없습니다. AI 앱에서 거래의 분개 생성·검증·승인 요청을 진행하세요."/>}</section>}
      {selected&&<section className="panel journal-detail"><div className="panel-title"><h2>전표 검토</h2><span className={'state '+selected.state}>{selected.state}</span></div><p>{selected.payload.description}</p>
        <p>귀속일 {selected.payload.recognitionOn} · 버전 {selected.version}</p>
        <table><thead><tr><th>계정 코드</th><th className="num">차변</th><th className="num">대변</th></tr></thead><tbody>{selected.payload.lines.map((l,index)=><tr key={index}><td className="mono">{l.accountCode}</td><td className="num">{money(l.debit)}</td><td className="num">{money(l.credit)}</td></tr>)}</tbody></table>
        <div className="basis"><strong>적용 근거·가정</strong><p>{selected.payload.basis.standards.join(' · ')}</p><ul>{selected.payload.basis.assumptions.map(a=><li key={a}>{a}</li>)}</ul><p>{selected.payload.basis.uncertainty}</p></div>
        <div className="basis"><strong>원천 증빙 · 가상자료</strong>{evidence.map(doc=><details key={String(doc.id)}><summary>{String(doc.type)} · {String(doc.issueDate)}</summary>
          <p className="hash mono">{String(doc.sha256)}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(doc.content,null,2)}</pre></details>)}</div>
        <p className="hash mono">승인 대상 hash: {selected.hash}</p><p>사용자 승인 상태: <strong>{selected.discardedAt?'폐기됨':String(approval?.status??'요청 전')}</strong></p>
        {csrf&&storageConfigured&&<button className="secondary" disabled={archived} onClick={()=>void archiveEvidence()}>{archived?'증빙 보관 완료':'증빙 원문 보관'}</button>}
        {tab==='approval'&&!selected.discardedAt&&selected.state==='Approval'&&approval?.status==='pending'&&<>
          <div className="decision"><p>전표와 증빙을 검토한 뒤 승인하거나 반려하세요. 승인 후 앱에서 전기를 요청합니다.</p>
            <button className="secondary danger" disabled={!csrf} onClick={()=>void decide('rejected')}>반려</button>
            <button className="primary" disabled={!csrf} onClick={()=>void decide('approved')}>이 전표 승인</button>
            {!csrf&&<p className="muted">승인 화면 연결을 확인하세요. 지속 DB에서는 외부 인증 세션이 필요합니다.</p>}</div>
        </>}</section>}
      {tab==='reports'&&<section className="panel"><div className="panel-title"><h2>시산표</h2><span>게시된 전표의 계정별 집계</span></div><table><thead><tr><th>계정 코드</th><th className="num">차변 합계</th><th className="num">대변 합계</th><th className="num">잔액</th></tr></thead><tbody>
        {(trial.items as Row[]??[]).map(r=><tr key={String(r.accountCode)}><td>{String(r.accountCode)}</td><td className="num">{money(r.debit)}</td><td className="num">{money(r.credit)}</td><td className="num">{money(r.balance)}</td></tr>)}</tbody>
        <tfoot><tr><td>합계</td><td className="num">{money(trial.totalDebit)}</td><td className="num">{money(trial.totalCredit)}</td><td/></tr></tfoot></table></section>}
      {tab==='audit'&&<section className="panel"><div className="panel-title"><h2>감사 점검 결과</h2><span>결정론적 검사</span></div><div className="audit-stats"><p>중복 증빙 후보 <strong>{(audit.duplicateEvidence as unknown[]??[]).length}</strong></p><p>차대변 불일치 전표 <strong>{(audit.unbalancedJournals as unknown[]??[]).length}</strong></p><p>미전기 거래 표시 <strong>{(audit.unpostedSources as unknown[]??[]).length}</strong></p></div>
        <p className="muted">{String(audit.note??'')}</p><table><thead><tr><th>미전기 거래 참조</th><th>유형</th></tr></thead><tbody>{(audit.unpostedSources as Row[]??[]).map(r=><tr key={String(r.id)}><td className="mono">{String(r.reference)}</td><td>{String(r.kind)}</td></tr>)}</tbody></table></section>}
      <footer>LedgerFlow · 합성 거래 데이터 · 전문가 검토 미완료 · 법정 신고 및 완전한 K-IFRS 보고서가 아닙니다.</footer>
    </main>
  </div>;
}
function Kpi({label,value,hint,unit='원'}:{label:string;value:string;hint:string;unit?:string}){return <section className="kpi"><p>{label}</p><h2>{value}<small>{unit}</small></h2><span>{hint}</span></section>;}
function Statement({label,value}:{label:string;value:unknown}){return <div><span>{label}</span><strong>{money(value)} <small>원</small></strong></div>;}
function Empty({text}:{text:string}){return <div className="empty"><span>▤</span><p>{text}</p></div>;}
