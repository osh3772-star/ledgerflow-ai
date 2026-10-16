type Row=Record<string,unknown>;
type LoadState={loading:boolean;error:string};
type FinancialProps=LoadState&{financial:Row};
const hasEntries=(value:unknown)=>Array.isArray(value)&&value.length>0;
const money=(value:unknown)=>{if(value===undefined||value===null)return '—';try{return BigInt(String(value)).toLocaleString('ko-KR');}catch{return '—';}};
function stateTitle({loading,error}:LoadState,empty='장부 반영 전'){
  return loading?'자료 확인 중':error?'자료 조회 실패':empty;
}
function ReportEmpty({loading,error,message,emptyTitle}:LoadState&{message:string;emptyTitle?:string}){
  return <div className="report-empty"><span aria-hidden="true">▥</span><h3>{stateTitle({loading,error},emptyTitle)}</h3>
    <p>{loading?'장부 자료를 불러오고 있습니다.':error?'새로고침 후 다시 확인하세요.':message}</p></div>;
}
function Metric({label,value,hint,unit='원'}:{label:string;value:string;hint:string;unit?:string}){
  return <section className="kpi"><p>{label}</p><h2>{value}<small>{unit}</small></h2><span>{hint}</span></section>;
}
export function FinancialMetrics({financial,loading,error,pendingCount,postedCount}:FinancialProps&{pendingCount:number;postedCount:number}){
  const income=financial.incomeStatement as Row|undefined,balance=financial.balanceSheet as Row|undefined;
  // The service returns all posted period account rows, including asset-only entries.
  // Account rows distinguish an empty ledger from a genuine zero after a reversal.
  const ready=!loading&&!error,periodHasEntries=hasEntries(income?.accounts);
  return <div className="kpis">
    {ready&&periodHasEntries?<><Metric label="기간 매출" value={money(income?.revenue)} hint="장부 반영된 전표 기준"/>
      <Metric label="기간 순이익" value={money(income?.profit)} hint="세전 · 가상 시나리오"/></>:
      <section className="kpi financial-pending"><p>재무 지표</p><h2>{stateTitle({loading,error},hasEntries(balance?.accounts)?'이 기간의 장부 기록 없음':'장부 반영 전')}</h2>
        <span>{loading?'장부 자료를 확인하고 있습니다.':error?'새로고침 후 다시 확인하세요.':'거래 목록의 샘플 금액은 포함하지 않습니다. 선택한 기간에 장부로 반영된 전표가 있어야 금액을 표시합니다.'}</span></section>}
    <Metric label="승인 대기" value={ready?String(pendingCount):'—'} hint="전표 목록 최대 100건" unit="건"/>
    <Metric label="장부 반영된 전표" value={ready?String(postedCount):'—'} hint="전표 목록 최대 100건" unit="건"/>
  </div>;
}
export function BalanceSheetPanel({financial,loading,error,asOf}:FinancialProps&{asOf:string|undefined}){
  const balance=financial.balanceSheet as Row|undefined,available=!loading&&!error&&hasEntries(balance?.accounts);
  return <section className="panel"><div className="panel-title"><h2>재무상태표</h2><span>{asOf}</span></div>
    {available?<><div className="statement">{([['자산','assets'],['부채','liabilities'],['자본','equity']] as const).map(([label,key])=><div key={key}><span>{label}</span><strong>{money(balance?.[key])} <small>원</small></strong></div>)}</div>
      <div className={'balance-note '+(balance?.balanced?'balanced':'')}>{balance?.balanced?'✓ 자산 = 부채 + 자본':'계정 잔액을 확인하세요.'}</div></>:
      <ReportEmpty loading={loading} error={error} message="기준일까지 장부에 반영된 전표가 없습니다. 전표 검증·사용자 승인·장부 반영 후 재무상태표를 표시합니다."/>}
  </section>;
}
export function TrialBalancePanel({trial,loading,error}:LoadState&{trial:Row}){
  const items=trial.items as Row[]|undefined,available=!loading&&!error&&hasEntries(items);
  return <section className="panel"><div className="panel-title"><h2>시산표</h2><span>장부 반영된 전표의 계정별 집계</span></div>
    {available?<table><thead><tr><th>계정 코드</th><th className="num">차변 합계</th><th className="num">대변 합계</th><th className="num">잔액</th></tr></thead><tbody>
      {items!.map(row=><tr key={String(row.accountCode)}><td>{String(row.accountCode)}</td><td className="num">{money(row.debit)}</td><td className="num">{money(row.credit)}</td><td className="num">{money(row.balance)}</td></tr>)}</tbody>
      <tfoot><tr><td>합계</td><td className="num">{money(trial.totalDebit)}</td><td className="num">{money(trial.totalCredit)}</td><td/></tr></tfoot></table>:
      <ReportEmpty loading={loading} error={error} emptyTitle="이 기간의 장부 기록 없음" message="선택한 기간에 장부로 반영된 전표가 없습니다. 전표를 반영한 뒤 새로고침하면 시산표가 표시됩니다."/>}
  </section>;
}
