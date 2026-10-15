import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {generateFullErpSeed} from '@ledgerflow/test-data';
import {generateJournal,validateJournal,type SourceSnapshot} from '@ledgerflow/accounting-core';
const seed=generateFullErpSeed(),companyId=seed.companies[0]!.id;
const gold=JSON.parse(await readFile('tests/fixtures/accounting-gold.json','utf8')) as {
  cases:{ref:string;lines:string[][]}[];accountSets:Record<string,string[]>};
const started=performance.now();let succeeded=0,classified=0,goldMatched=0;
const payloads=new Map<string,ReturnType<typeof generateJournal>>(),sources=new Map<string,SourceSnapshot>();
for(const t of seed.transactions.filter(t=>t.companyId===companyId)){
  const doc=seed.documents.find(d=>d.id===t.sourceDocumentId)!,p=seed.periods.find(p=>p.id===t.periodId)!;
  const source:SourceSnapshot={transaction:t,documentIds:[doc.id],documentHashes:[{documentId:doc.id,sha256:doc.sha256}],document:doc.content,period:{id:p.id,from:p.start,to:p.end,status:'open'},
    accounts:seed.accounts.filter(a=>a.companyId===companyId).map(a=>({...a,active:true,validFrom:'2026-01-01',validTo:null}))};
  const inv=seed.invoices.find(i=>i.transactionId===t.id);if(inv)source.invoice={net:inv.net,tax:inv.tax,gross:inv.gross};
  const contract=seed.contracts.find(c=>c.transactionId===t.id);if(contract)source.contract=contract;
  const movement=seed.inventoryMovements.find(m=>m.transactionId===t.id&&m.direction==='out');if(movement)source.inventory=movement;
  const payroll=seed.payrolls.find(p=>p.transactionId===t.id);if(payroll)source.payroll={gross:payroll.gross,withholding:payroll.withholding,netPay:payroll.netPay};
  const adj=seed.adjustments.find(a=>a.transactionId===t.id);if(adj)source.adjustment=adj;
  const asset=seed.fixedAssets.find(a=>a.transactionId===t.id||a.id===adj?.assetId);if(asset)source.asset=asset;
  const prepay=seed.prepayments.find(a=>a.transactionId===t.id||a.id===adj?.prepaymentId);if(prepay)source.prepayment=prepay;
  try{
    const payload=generateJournal(source);payloads.set(t.externalRef,payload);sources.set(t.externalRef,source);succeeded++;
    const expected=gold.accountSets[adj?.type??t.kind]!;
    const actual=[...new Set(payload.lines.map(l=>l.accountCode))].sort();
    if(JSON.stringify(actual)===JSON.stringify([...expected].sort()))classified++;
  }catch{/* A failure contributes to the denominator rather than being skipped. */}
}
for(const test of gold.cases){
  const actual=payloads.get(test.ref)?.lines.map(l=>[l.accountCode,l.debit,l.credit]);
  if(JSON.stringify(actual)===JSON.stringify(test.lines))goldMatched++;
}
const faults=JSON.parse(await readFile('tests/fixtures/accounting-errors.json','utf8')) as {sourceExternalRef:string;cases:{id:string;field:string;line?:number;value:unknown;expectedError:string}[]};
const source=sources.get(faults.sourceExternalRef)!,payload=payloads.get(faults.sourceExternalRef)!;
const errorCases=faults.cases.map(test=>{
  const candidate=structuredClone(payload);
  if(test.line===undefined)Object.assign(candidate,{[test.field]:test.value});
  else Object.assign(candidate.lines[test.line]!,{[test.field]:test.value});
  return {candidate,expectedError:test.expectedError};
});
const tp=errorCases.filter(p=>validateJournal(p.candidate,source).includes(p.expectedError)).length,fp=gold.cases.filter(c=>{
  const s=sources.get(c.ref),p=payloads.get(c.ref);return s&&p?validateJournal(p,s).length>0:true;
}).length;
const report={generatedAt:new Date().toISOString(),fixtureHash:seed.manifest.sha256,transactions:1000,
  deterministicProcessingSuccess:{numerator:succeeded,denominator:1000,rate:succeeded/1000},
  classificationAccuracy:{numerator:classified,denominator:1000,rate:classified/1000},
  handAuthoredJournalExactMatch:{numerator:goldMatched,denominator:gold.cases.length,rate:goldMatched/gold.cases.length},
  injectedErrorDetection:{normalCases:gold.cases.length,errorCases:errorCases.length,precision:tp/(tp+fp),recall:tp/errorCases.length},
  deterministicDraftRatio:succeeded/1000,postingApprovalPolicy:'100% of postings require separate human approval',
  wallTimeMs:Math.round(performance.now()-started),paidModelApiCalls:0,paidModelApiCost:0,
  nativeAppInferenceCost:null,nativeAppReasoningQualityEvaluated:false,
  limits:['10 hand-authored exact examples; remaining 990 rows test classifications, not independent line-level gold',
    '5 injected fault cases are small synthetic holdout, not production accounting precision/recall',
    'DB approval/post/duplicate/close/HTTP tool metrics are verified separately in integration tests']};
await mkdir('.ledgerflow/evaluation',{recursive:true});
await writeFile('.ledgerflow/evaluation/latest.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(succeeded!==1000||classified!==1000||goldMatched!==gold.cases.length||tp!==errorCases.length||fp!==0)process.exitCode=1;
